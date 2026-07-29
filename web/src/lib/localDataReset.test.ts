import { beforeEach, describe, expect, it, vi } from "vitest";

import { OPFS_WORKSPACES_DIRECTORY } from "@/lib/opfsArtifactStore";
import { resetLocalData } from "@/lib/localDataReset";

describe("local data reset", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      localStorage: { clear: vi.fn() },
      sessionStorage: { clear: vi.fn() },
    });
    vi.stubGlobal("indexedDB", {
      deleteDatabase: vi.fn(() => {
        const request: Record<string, (() => void) | undefined> = {};
        queueMicrotask(() => request.onsuccess?.());
        return request;
      }),
    });
    vi.stubGlobal("caches", { keys: vi.fn(() => []), delete: vi.fn() });
  });

  it("removes the complete OPFS workspace tree during a full reset", async () => {
    const removeEntry = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", {
      storage: { getDirectory: () => Promise.resolve({ removeEntry }) },
      serviceWorker: { getRegistrations: () => Promise.resolve([]) },
    });

    await resetLocalData();

    expect(removeEntry).toHaveBeenCalledWith(OPFS_WORKSPACES_DIRECTORY, {
      recursive: true,
    });
  });

  it("still completes when OPFS cleanup is unavailable", async () => {
    vi.stubGlobal("navigator", {
      storage: { getDirectory: () => Promise.reject(new Error("denied")) },
      serviceWorker: { getRegistrations: () => Promise.resolve([]) },
    });
    await expect(resetLocalData()).resolves.toBeUndefined();
  });
});
