import { beforeEach, describe, expect, it, vi } from "vitest";

import { LAST_RUN_DB_NAME } from "@/lib/lastRunStore";
import { OPFS_WORKSPACES_DIRECTORY } from "@/lib/opfsArtifactStore";
import { PROJECTS_DB_NAME } from "@/lib/projectsStore";
import { resetLocalData } from "@/lib/localDataReset";

const deleteDatabase = vi.fn(() => {
  const request: Record<string, (() => void) | undefined> = {};
  queueMicrotask(() => request.onsuccess?.());
  return request;
});

describe("local data reset", () => {
  beforeEach(() => {
    deleteDatabase.mockClear();
    vi.stubGlobal("window", {
      localStorage: { clear: vi.fn() },
      sessionStorage: { clear: vi.fn() },
    });
    vi.stubGlobal("indexedDB", {
      deleteDatabase,
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
    expect(deleteDatabase).toHaveBeenCalledWith(LAST_RUN_DB_NAME);
    expect(deleteDatabase).toHaveBeenCalledWith(PROJECTS_DB_NAME);
    expect(deleteDatabase).not.toHaveBeenCalledWith("chronicle-last-run");
  });

  it("still completes when OPFS cleanup is unavailable", async () => {
    vi.stubGlobal("navigator", {
      storage: { getDirectory: () => Promise.reject(new Error("denied")) },
      serviceWorker: { getRegistrations: () => Promise.resolve([]) },
    });
    await expect(resetLocalData()).resolves.toBeUndefined();
  });
});
