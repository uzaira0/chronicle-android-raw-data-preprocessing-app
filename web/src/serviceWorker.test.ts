import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import type { Page } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForServiceWorkerControl } from "../e2e/helpers";

afterEach(() => vi.unstubAllGlobals());

const scope = "https://chronicle.example/";
const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const absolute = (value: string | Request) =>
  new URL(typeof value === "string" ? value : value.url, scope).href;

function worker(options: { missingAdd?: string; emptyAdd?: string; missingReadback?: string; extraStatus?: number } = {}) {
  const handlers = new Map<string, (event: unknown) => void>();
  const stored = new Map<string, Response>();
  const put = vi.fn((request: string | Request, response: Response) => {
    stored.set(absolute(request), response.clone());
    return Promise.resolve();
  });
  const cache = {
    add: vi.fn((request: string) => {
      if (request === absolute(options.missingAdd ?? "__absent__")) return Promise.reject(new Error("cache add failed"));
      stored.set(absolute(request), new Response(`bytes:${request}`));
      return Promise.resolve();
    }),
    addAll: vi.fn((requests: string[]) => {
      // The platform batch does not commit partial writes on a failed add.
      if (requests.includes(absolute(options.missingAdd ?? "__absent__"))) return Promise.reject(new Error("cache add failed"));
      for (const request of requests) stored.set(absolute(request),
        new Response(request === absolute(options.emptyAdd ?? "__absent__") ? "" : `bytes:${request}`));
      return Promise.resolve();
    }),
    match: vi.fn((request: string | Request) =>
      Promise.resolve(absolute(request) === absolute(options.missingReadback ?? "__absent__")
        ? undefined : stored.get(absolute(request))?.clone())),
    put,
  };
  const skipWaiting = vi.fn(() => Promise.resolve());
  const claim = vi.fn(() => Promise.resolve());
  const open = vi.fn(() => Promise.resolve(cache));
  const fetch = vi.fn((request: string | Request) => {
    const url = absolute(request);
    if (url.endsWith("/.vite/manifest.json")) {
      return Promise.resolve(Response.json({ "index.html": { file: "assets/main.js", css: ["assets/main.css"] } }));
    }
    if (url.endsWith("/sw-precache-extra.json")) {
      return Promise.resolve(Response.json(["./assets/worker.js", "./assets/runtime.wasm", "./assets/authority.json.pack"],
        { status: options.extraStatus ?? 200 }));
    }
    return Promise.resolve(new Response(`network:${url}`));
  });
  runInNewContext(source, {
    self: { location: new URL("sw.js", scope), registration: { scope: new URL("./", new URL("sw.js", scope)).href },
      skipWaiting, clients: { claim },
      addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler) },
    caches: { open, match: cache.match, keys: () => Promise.resolve([]), delete: () => Promise.resolve(true) },
    fetch, URL, Request, Response,
  });
  return {
    stored, cache, open, fetch, skipWaiting, claim,
    install() {
      let completion: Promise<unknown> | undefined;
      handlers.get("install")!({ waitUntil: (promise: Promise<unknown>) => { completion = promise; } });
      return completion!;
    },
    request(url: string, mode = "cors", cacheMode = "default") {
      let response: Promise<Response> | undefined;
      const lifetime: Promise<unknown>[] = [];
      handlers.get("fetch")!({ request: { url: absolute(url), method: "GET", mode, cache: cacheMode },
        respondWith: (promise: Promise<Response>) => { response = promise; },
        waitUntil: (promise: Promise<unknown>) => lifetime.push(promise) });
      return { response: response!, lifetime };
    },
  };
}

describe("production service-worker cache completion", () => {
  it("does not activate after a required extra asset fails to cache", async () => {
    const w = worker({ missingAdd: "assets/authority.json.pack" });
    w.stored.set(absolute("index.html"), new Response("old valid shell"));
    await expect(w.install()).rejects.toThrow();
    expect(w.skipWaiting).not.toHaveBeenCalled();
    expect(await w.stored.get(absolute("index.html"))!.text()).toBe("old valid shell");
  });

  it("does not activate when cache.add resolves but readback is absent", async () => {
    const w = worker({ missingReadback: "assets/runtime.wasm" });
    await expect(w.install()).rejects.toThrow();
    expect(w.skipWaiting).not.toHaveBeenCalled();
  });

  it.each(["index.html", "assets/main.js"])("restores an already-cached %s after a committed empty replacement", async (path) => {
    const w = worker({ emptyAdd: path });
    w.stored.set(absolute(path), new Response("old valid bytes", { headers: { "X-Old-Response": "preserved" } }));
    await expect(w.install()).rejects.toThrow("no readable bytes");
    expect(w.skipWaiting).not.toHaveBeenCalled();
    const restored = w.stored.get(absolute(path))!;
    expect(await restored.text()).toBe("old valid bytes");
    expect(restored.headers.get("X-Old-Response")).toBe("preserved");
  });

  it("awaits all prior-response restorations and refuses a rollback failure", async () => {
    const w = worker({ emptyAdd: "assets/main.js" });
    w.stored.set(absolute("index.html"), new Response("old shell"));
    w.stored.set(absolute("assets/main.js"), new Response("old hashed bytes"));
    w.cache.put.mockRejectedValueOnce(new Error("rollback cache unavailable"));
    await expect(w.install()).rejects.toThrow("could not all be restored");
    expect(w.skipWaiting).not.toHaveBeenCalled();
    expect(w.cache.put).toHaveBeenCalledTimes(2);
    expect(await w.stored.get(absolute("assets/main.js"))!.text()).toBe("old hashed bytes");
  });

  it("does not silently drop an unavailable supplementary precache list", async () => {
    const w = worker({ extraStatus: 503 });
    await expect(w.install()).rejects.toThrow();
    expect(w.skipWaiting).not.toHaveBeenCalled();
  });

  it("installs the complete shell and build-derived worker, WASM and packed assets", async () => {
    const w = worker();
    await w.install();
    expect(w.skipWaiting).toHaveBeenCalledOnce();
    for (const path of ["./", "index.html", "assets/main.js", "assets/main.css", "assets/worker.js",
      "assets/runtime.wasm", "assets/authority.json.pack"]) expect(w.stored.has(absolute(path))).toBe(true);
  });

  it.each(["cors", "navigate"])("keeps a %s network cache write in the event lifetime", async (mode) => {
    const w = worker();
    let finish: (() => void) | undefined;
    let started: (() => void) | undefined;
    const putStarted = new Promise<void>((resolve) => { started = resolve; });
    w.cache.put.mockImplementationOnce(async (request, response) => {
      started!();
      await new Promise<void>((resolve) => { finish = resolve; });
      w.stored.set(absolute(request), response.clone());
    });
    const event = w.request("assets/uncached.js", mode);
    await putStarted;
    expect(event.lifetime).toHaveLength(1);
    finish!();
    await expect(event.response).resolves.toHaveProperty("ok", true);
    await Promise.all(event.lifetime);
  });

  it.each(["cors", "navigate"])("preserves a %s online response when runtime cache writes fail", async (mode) => {
    const w = worker();
    w.cache.put.mockRejectedValueOnce(new Error("cache unavailable"));
    const event = w.request("assets/uncached.js", mode);
    // Observe the rejection before consuming the independent response.
    const cacheFailure = expect(Promise.all(event.lifetime)).rejects.toThrow("cache unavailable");
    await expect(event.response).resolves.toHaveProperty("ok", true);
    await cacheFailure;
  });

  it.each(["cors", "navigate"])("captures a %s cache copy before a delayed open and consumer body read", async (mode) => {
    const w = worker();
    let finish: (() => void) | undefined;
    let started: (() => void) | undefined;
    const openStarted = new Promise<void>((resolve) => { started = resolve; });
    w.open.mockImplementationOnce(async () => {
      started!();
      await new Promise<void>((resolve) => { finish = resolve; });
      return w.cache;
    });
    const event = w.request("assets/uncached.js", mode);
    const completion = Promise.all(event.lifetime);
    // Attach both outcomes before releasing the delayed Cache API operation.
    const outcome = completion.then(() => "cached", (error: Error) => error.message);
    await openStarted;
    expect(await (await event.response).text()).toBe(`network:${absolute("assets/uncached.js")}`);
    finish!();
    expect(await outcome).toBe("cached");
    expect(await w.stored.get(absolute("assets/uncached.js"))!.text())
      .toBe(`network:${absolute("assets/uncached.js")}`);
  });

  it("does not call a runtime ghost write successful", async () => {
    const w = worker();
    w.cache.put.mockResolvedValueOnce(undefined);
    const event = w.request("assets/uncached.js");
    const cacheFailure = expect(Promise.all(event.lifetime)).rejects.toThrow("no readable bytes");
    await expect(event.response).resolves.toHaveProperty("ok", true);
    await cacheFailure;
  });

  it("honors no-store so current readiness metadata cannot come from a stale cache", async () => {
    const w = worker();
    w.stored.set(absolute("sw-precache-extra.json"), Response.json(["./assets/old-worker.js"]));
    const event = w.request("sw-precache-extra.json", "cors", "no-store");
    expect(await (await event.response).json()).toEqual([
      "./assets/worker.js", "./assets/runtime.wasm", "./assets/authority.json.pack",
    ]);
    await Promise.all(event.lifetime);
    expect(w.cache.put).not.toHaveBeenCalled();
  });
});

describe("actual offline readiness helper", () => {
  async function readiness(missing?: string, metadataStatus = 200) {
    vi.stubGlobal("navigator", { serviceWorker: {
      controller: {}, ready: Promise.resolve({ active: { state: "activated" } }),
    } });
    vi.stubGlobal("location", new URL(scope));
    vi.stubGlobal("document", { querySelectorAll: () => [] });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json([
      "./assets/worker.js", "./assets/runtime.wasm", "./assets/authority.json.pack",
    ], { status: metadataStatus }))));
    vi.stubGlobal("caches", { match: (url: string) =>
      Promise.resolve(absolute(url) === absolute(missing ?? "__absent__") ? undefined : new Response("cached bytes")) });
    let result: boolean | undefined;
    // A Chromium-shaped page: the helper's WebKit-only Cache Storage skip never applies.
    const page = {
      context: () => ({ browser: () => null }),
      waitForFunction: async (callback: () => Promise<boolean>) => { result = await callback(); },
    };
    await waitForServiceWorkerControl(page as unknown as Page);
    return result;
  }

  it.each(["assets/worker.js", "assets/runtime.wasm", "assets/authority.json.pack"])(
    "does not certify a controlled shell without %s", async (missing) => {
      expect(await readiness(missing)).toBe(false);
    },
  );

  it("does not certify readiness without the current supplementary list", async () => {
    expect(await readiness(undefined, 503)).toBe(false);
  });

  it("accepts only the controlled shell with all required supplementary bytes", async () => {
    expect(await readiness()).toBe(true);
  });
});

describe("service-worker cache scoping on a shared origin", () => {
  // Every GitHub Pages site of one account shares one origin and one Cache
  // Storage; the preview build stamps the same CACHE_NAME literal. This app
  // lives at /app/, its preview at /preview/.
  const appScope = "https://pages.example/app/";
  const caches: Record<string, string[]> = {
    "chronicle-local-shell-v3@https://pages.example/app/": [],
    "chronicle-local-shell-v3-old@https://pages.example/app/": [],
    "chronicle-local-shell-v3@https://pages.example/preview/": [],
    "chronicle-local-shell-v2": ["https://pages.example/app/index.html"],
    "chronicle-local-shell-v1": ["https://pages.example/preview/index.html"],
    "unrelated-cache": ["https://pages.example/app/x.js"],
  };

  function load() {
    const handlers = new Map<string, (event: unknown) => void>();
    const deleted: string[] = [];
    const match = vi.fn(() => Promise.resolve(undefined));
    runInNewContext(source, {
      self: {
        location: new URL("sw.js", appScope),
        registration: { scope: appScope },
        skipWaiting: () => Promise.resolve(),
        clients: { claim: () => Promise.resolve() },
        addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
      },
      caches: {
        keys: () => Promise.resolve(Object.keys(caches)),
        open: (key: string) => Promise.resolve({
          keys: () => Promise.resolve((caches[key] ?? []).map((url) => ({ url }))),
        }),
        delete: (key: string) => { deleted.push(key); return Promise.resolve(true); },
        match,
      },
      fetch: () => Promise.resolve(new Response("network")), URL, Request, Response,
    });
    return { handlers, deleted, match };
  }

  it("activate deletes only this app's older shell caches", async () => {
    const { handlers, deleted } = load();
    let completion: Promise<unknown> | undefined;
    handlers.get("activate")!({ waitUntil: (promise: Promise<unknown>) => { completion = promise; } });
    await completion;
    expect(deleted.sort()).toEqual([
      "chronicle-local-shell-v2",
      "chronicle-local-shell-v3-old@https://pages.example/app/",
    ]);
  });

  it("serves cache hits only from this app's own cache", async () => {
    const { handlers, match } = load();
    let response: Promise<Response> | undefined;
    const lifetime: Promise<unknown>[] = [];
    handlers.get("fetch")!({
      request: { url: `${appScope}assets/main.js`, method: "GET", mode: "cors", cache: "default" },
      respondWith: (promise: Promise<Response>) => { response = promise; },
      waitUntil: (promise: Promise<unknown>) => { lifetime.push(promise); },
    });
    await response;
    await Promise.allSettled(lifetime);
    expect(match).toHaveBeenCalled();
    for (const call of match.mock.calls as unknown as Array<[unknown, { cacheName?: string }]>) {
      expect(call[1]?.cacheName).toBe(`chronicle-local-shell-v3@${appScope}`);
    }
  });
});
