import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LAST_RUN_DB_NAME, LEGACY_LAST_RUN_DB_NAME } from "@/lib/lastRunStore";
import {
  LEGACY_OPFS_DIRECTORIES,
  OPFS_CAPABILITY_PROBE_DIRECTORY,
  OPFS_PAYLOAD_SPILL_DIRECTORY,
  OPFS_WORKSPACES_DIRECTORY,
} from "@/lib/opfsArtifactStore";
import { PROJECTS_DB_NAME } from "@/lib/projectsStore";
import {
  clearCachedRun,
  consumeLocalDataDeletedMark,
  markLocalDataDeleted,
  removePayloadSpillFiles,
  resetLocalData,
} from "@/lib/localDataReset";

type DeleteOutcome = "success" | "error" | "blocked";
let deleteOutcome: DeleteOutcome = "success";
const deleteDatabase = vi.fn(() => {
  const request: Record<string, unknown> = { error: new Error("disk error") };
  queueMicrotask(() => {
    const handler =
      deleteOutcome === "success"
        ? request.onsuccess
        : deleteOutcome === "error"
          ? request.onerror
          : request.onblocked;
    (handler as (() => void) | undefined)?.();
  });
  return request;
});

function memoryStorage(entries: Record<string, string>): Storage & { map: Map<string, string> } {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
}

let localStore: ReturnType<typeof memoryStorage>;
let sessionStore: ReturnType<typeof memoryStorage>;
let deletedCaches: string[];
let unregistered: string[];
let removedRootEntries: string[];
let removedSpillFiles: string[];

function stubOpfs(options: { lockedSpillFile?: string; workspaceError?: Error } = {}): void {
  const spill = {
    keys: async function* () {
      await Promise.resolve();
      yield "live-worker.bin";
      yield "dead-worker.bin";
    },
    removeEntry: (name: string) => {
      if (name === options.lockedSpillFile) {
        return Promise.reject(new DOMException("locked", "NoModificationAllowedError"));
      }
      removedSpillFiles.push(name);
      return Promise.resolve();
    },
  };
  const root = {
    removeEntry: (name: string) => {
      if (name === OPFS_WORKSPACES_DIRECTORY && options.workspaceError) {
        return Promise.reject(options.workspaceError);
      }
      removedRootEntries.push(name);
      return Promise.resolve();
    },
    getDirectoryHandle: (name: string) =>
      name === OPFS_PAYLOAD_SPILL_DIRECTORY
        ? Promise.resolve(spill)
        : Promise.reject(new DOMException("missing", "NotFoundError")),
  };
  vi.stubGlobal("navigator", {
    storage: { getDirectory: () => Promise.resolve(root) },
    serviceWorker: {
      getRegistrations: () =>
        Promise.resolve(
          ["http://127.0.0.1/app/", "http://127.0.0.1/other-site/"].map((scope) => ({
            scope,
            unregister: () => {
              unregistered.push(scope);
              return Promise.resolve(true);
            },
          })),
        ),
    },
  });
}

describe("local data reset", () => {
  beforeEach(() => {
    deleteOutcome = "success";
    deleteDatabase.mockClear();
    deletedCaches = [];
    unregistered = [];
    removedRootEntries = [];
    removedSpillFiles = [];
    localStore = memoryStorage({
      "chronicle.processingOptions.v1": "{}",
      "chronicle-web.activeWorkflow": "view",
      "another-site.settings": "keep",
    });
    sessionStore = memoryStorage({ "chronicle.x": "1", "other.session": "keep" });
    vi.stubGlobal("localStorage", localStore);
    vi.stubGlobal("sessionStorage", sessionStore);
    // The production build's base (vite.config.ts `base: "./"`).
    vi.stubEnv("BASE_URL", "./");
    vi.stubGlobal("location", { href: "http://127.0.0.1/app/" });
    vi.stubGlobal("indexedDB", { deleteDatabase });
    // Two apps on one origin (every GitHub Pages site of an account shares
    // one): this app at /app/, its preview build at /other-site/. Both stamp
    // the same shell-cache name, so ownership is decided by scope.
    const cacheEntries: Record<string, string[]> = {
      "chronicle-local-shell-v3-aaa@http://127.0.0.1/app/": [],
      "chronicle-local-shell-v3-bbb@http://127.0.0.1/other-site/": [],
      "chronicle-local-shell-v3": ["http://127.0.0.1/app/index.html"],
      "chronicle-local-shell-v2": ["http://127.0.0.1/other-site/index.html"],
      "other-app-cache": ["http://127.0.0.1/app/x.js"],
    };
    vi.stubGlobal("caches", {
      keys: () => Promise.resolve(Object.keys(cacheEntries)),
      open: (key: string) =>
        Promise.resolve({
          keys: () =>
            Promise.resolve((cacheEntries[key] ?? []).map((url) => ({ url }))),
        }),
      delete: (key: string) => {
        deletedCaches.push(key);
        return Promise.resolve(true);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("deletes every store the app writes and reports nothing left over", async () => {
    stubOpfs();

    await expect(resetLocalData()).resolves.toEqual([]);

    expect(removedRootEntries).toEqual(
      expect.arrayContaining([
        OPFS_WORKSPACES_DIRECTORY,
        OPFS_CAPABILITY_PROBE_DIRECTORY,
        ...LEGACY_OPFS_DIRECTORIES,
      ]),
    );
    expect(removedSpillFiles).toEqual(["live-worker.bin", "dead-worker.bin"]);
    expect(deleteDatabase).toHaveBeenCalledWith(LAST_RUN_DB_NAME);
    expect(deleteDatabase).toHaveBeenCalledWith(PROJECTS_DB_NAME);
    // An explicit wipe also removes the retired last-run database, unopened.
    expect(deleteDatabase).toHaveBeenCalledWith(LEGACY_LAST_RUN_DB_NAME);
  });

  it("touches only this app's keys, caches and service worker on a shared origin", async () => {
    stubOpfs();

    await resetLocalData();

    expect([...localStore.map.keys()]).toEqual(["another-site.settings"]);
    expect([...sessionStore.map.keys()]).toEqual(["other.session"]);
    expect(deletedCaches).toEqual([
      "chronicle-local-shell-v3-aaa@http://127.0.0.1/app/",
      "chronicle-local-shell-v3",
    ]);
    expect(unregistered).toEqual(["http://127.0.0.1/app/"]);
  });

  it("skips a spill file a live worker holds open instead of failing the reset", async () => {
    stubOpfs({ lockedSpillFile: "live-worker.bin" });

    await expect(resetLocalData()).resolves.toEqual([]);
    expect(removedSpillFiles).toEqual(["dead-worker.bin"]);
  });

  it("reports each step that did not delete, so the caller never claims success", async () => {
    stubOpfs({ workspaceError: new Error("quota backend gone") });
    deleteOutcome = "blocked";

    const failures = await resetLocalData();

    expect(failures).toEqual(
      expect.arrayContaining([
        `OPFS ${OPFS_WORKSPACES_DIRECTORY}: quota backend gone`,
        expect.stringContaining(`IndexedDB ${LAST_RUN_DB_NAME}: another open tab`),
      ]),
    );
  });

  it("treats a context without usable OPFS as having nothing stored there", async () => {
    vi.stubGlobal("navigator", {
      storage: { getDirectory: () => Promise.reject(new Error("denied")) },
      serviceWorker: { getRegistrations: () => Promise.resolve([]) },
    });
    await expect(resetLocalData()).resolves.toEqual([]);
  });

  it("removes a just-terminated worker's spill file once its lock is released", async () => {
    let lockedAttempts = 2;
    const remaining = new Set(["ended-worker.bin"]);
    const spill = {
      keys: async function* () {
        await Promise.resolve();
        yield* [...remaining];
      },
      removeEntry: (name: string) => {
        if (lockedAttempts > 0) {
          lockedAttempts -= 1;
          return Promise.reject(new DOMException("locked", "NoModificationAllowedError"));
        }
        remaining.delete(name);
        return Promise.resolve();
      },
    };
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: () => Promise.resolve({ getDirectoryHandle: () => Promise.resolve(spill) }),
      },
    });

    await expect(removePayloadSpillFiles(2_000)).resolves.toBeNull();
    expect(remaining.size).toBe(0);
  });

  it("clearCachedRun rejects when the database was not deleted", async () => {
    await expect(clearCachedRun()).resolves.toBeUndefined();
    deleteOutcome = "error";
    await expect(clearCachedRun()).rejects.toThrow(`IndexedDB ${LAST_RUN_DB_NAME}: disk error`);
  });

  it("carries a completed-wipe mark across the reload exactly once", () => {
    markLocalDataDeleted();
    expect(consumeLocalDataDeletedMark()).toBe(true);
    expect(consumeLocalDataDeletedMark()).toBe(false);
  });
});
