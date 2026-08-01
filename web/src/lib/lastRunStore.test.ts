import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  clearLastRun,
  loadLastRun,
  saveLastRun,
  toLightweightResults,
} from "@/lib/lastRunStore";
import type { ProcessedFileResult } from "@/lib/types";

function result(): ProcessedFileResult {
  return {
    inputFileName: "Raw P01.csv",
    outputs: [
      {
        kind: "app",
        outputFileName: "Raw P01 App Usage.csv",
        blob: new Blob(["a,b\n1,2\n"], { type: "text/csv" }),
        rowCount: 1,
        previewRows: [
          ["a", "b"],
          ["1", "2"],
        ],
      },
      {
        kind: "lineage",
        outputFileName: "Raw P01 Row Lineage.arrow",
        blob: null,
        persistedArtifact: {
          workspaceId: `sha256:${"1".repeat(64)}`,
          workspaceRootDigest: `sha256:${"2".repeat(64)}`,
          kind: "row-lineage-arrow",
          mediaType: "application/vnd.apache.arrow.file",
          size: 123,
        },
        rowCount: 2,
        previewRows: [],
      },
    ],
    originalRowCount: 2,
    processedRowCount: 1,
    availableTimezones: ["America/Chicago"],
    timezone: "America/Chicago",
    appRowCount: 1,
    screenRowCount: 0,
    timezoneAction: "none",
    rowsBeforeTimezoneHandling: 2,
    rowsAfterTimezoneHandling: 2,
    rowsRemovedByTimezone: 0,
    duplicateTimestampsCorrected: 0,
    exactDuplicateRowsRemoved: 0,
    inputSha256: "abc123",
    persistedPlotRequest: {
      workspaceId: `sha256:${"1".repeat(64)}`,
      workspaceRootDigest: `sha256:${"2".repeat(64)}`,
      inputFileName: "Raw P01.csv",
      timezone: "America/Chicago",
      preprocessorVersion: "1.0.0",
      options: {
        processAppUsage: true,
        processScreenUsage: false,
        enablePlotting: true,
        includeFilteredAppUsageInPlots: false,
        enableActivityHeatmap: false,
        exportPlotsAsSvg: false,
      },
    },
    persistedTimelineRequest: {
      workspaceId: `sha256:${"1".repeat(64)}`,
      workspaceRootDigest: `sha256:${"2".repeat(64)}`,
      inputFileName: "Raw P01.csv",
      timezone: "America/Chicago",
      preprocessorVersion: "1.0.0",
      options: {
        processAppUsage: true,
        processScreenUsage: false,
        includeFilteredAppUsageInPlots: false,
        enableInteractiveTimeline: true,
      },
    },
    timelineView: {
      timezone: "America/Chicago",
      app: [
        {
          participantId: "P01",
          scene: { width: 1, height: 1, primitives: [] },
          regions: [],
        },
      ],
      screen: [],
    },
    reviewSummary: { participants: [] },
  };
}

beforeEach(async () => {
  await clearLastRun();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function persistedReceipt(): NonNullable<
  ProcessedFileResult["rustRuntimeReceipt"]
> {
  return {
    protocolVersion: "chronicle-preprocessing-runtime/v1",
    workspaceId: `sha256:${"1".repeat(64)}`,
    workspaceRootDigest: `sha256:${"2".repeat(64)}`,
    previousWorkspaceRootDigest: null,
    implementationDigest: `sha256:${"3".repeat(64)}`,
    buildEnvironmentDigest: `sha256:${"4".repeat(64)}`,
    planDigest: `sha256:${"5".repeat(64)}`,
    profileDigest: `sha256:${"6".repeat(64)}`,
    profileLockDigest: `sha256:${"7".repeat(64)}`,
    productContractDigest: `sha256:${"8".repeat(64)}`,
    journalDigest: `sha256:${"9".repeat(64)}`,
    openObligationCount: 0,
    persistedGeneration: 3,
  };
}

describe("toLightweightResults", () => {
  it("drops browser blobs and OPFS-recoverable review objects but keeps pinned Rust outputs", () => {
    const persisted = { ...result(), rustRuntimeReceipt: persistedReceipt() };
    const [light] = toLightweightResults([persisted]);
    if (light === undefined) throw new Error("expected one lightweight result");
    expect(light.outputs).toHaveLength(1);
    expect(light.outputs[0]?.persistedArtifact).toMatchObject({
      kind: "row-lineage-arrow",
      workspaceRootDigest: `sha256:${"2".repeat(64)}`,
    });
    expect(light.timelineView).toBeUndefined();
    expect(light.restoredWithoutArtifacts).toBe(true);
    expect(light.appRowCount).toBe(1);
    expect(light.timezone).toBe("America/Chicago");
    expect(light.reviewSummary).toBeUndefined();
    expect(light.persistedPlotRequest?.workspaceRootDigest).toBe(
      `sha256:${"2".repeat(64)}`,
    );
    expect(light.persistedTimelineRequest?.workspaceRootDigest).toBe(
      `sha256:${"2".repeat(64)}`,
    );
  });

  it("retains the compact review summary when OPFS persistence did not succeed", () => {
    // No rustRuntimeReceipt at all (persistence unavailable) — the in-memory
    // summary is the only copy, so it must survive the save.
    const [light] = toLightweightResults([result()]);
    if (light === undefined) throw new Error("expected one lightweight result");
    expect(light.reviewSummary).toEqual({ participants: [] });
    expect(light.reviewSummaryJsonBytes).toBeUndefined();

    // Receipt present but persistedGeneration missing (workspace commit
    // failed): same rule — the summary is not recoverable from OPFS.
    const receipt = persistedReceipt();
    delete receipt.persistedGeneration;
    const [unpersisted] = toLightweightResults([
      { ...result(), rustRuntimeReceipt: receipt },
    ]);
    if (unpersisted === undefined) throw new Error("expected one lightweight result");
    expect(unpersisted.reviewSummary).toEqual({ participants: [] });
    expect(unpersisted.reviewSummaryJsonBytes).toBeUndefined();
  });

  it("does not mutate the live result — this session's downloads still work", () => {
    const live = result();
    toLightweightResults([live]);
    expect(live.outputs).toHaveLength(2);
    expect(live.timelineView).toBeDefined();
    expect(live.restoredWithoutArtifacts).toBeUndefined();
  });
});

describe("lastRunStore", () => {
  it("sets a synchronous deletion fence and releases it after a successful save", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });

    const deletion = clearLastRun();
    expect([...values.values()]).toEqual(["1"]);
    await deletion;
    await expect(loadLastRun()).resolves.toBeUndefined();

    await saveLastRun({
      options: DEFAULT_BROWSER_OPTIONS,
      results: [result()],
      discoveredTimezones: [],
    });
    expect(values.size).toBe(0);
    await expect(loadLastRun()).resolves.toBeDefined();
  });

  it("keeps IndexedDB usable when localStorage fencing is unavailable", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });

    await clearLastRun();
    await saveLastRun({
      options: DEFAULT_BROWSER_OPTIONS,
      results: [result()],
      discoveredTimezones: [],
    });
    await expect(loadLastRun()).resolves.toBeDefined();
  });

  it("persists only the lightweight shape (no blobs/timeline) but keeps counts", async () => {
    await saveLastRun({
      options: { ...DEFAULT_BROWSER_OPTIONS, studyName: "Study A" },
      results: [{ ...result(), rustRuntimeReceipt: persistedReceipt() }],
      discoveredTimezones: ["America/Chicago"],
      savedAt: "2026-06-05T00:00:00Z",
    });

    const loaded = await loadLastRun();
    expect(loaded?.options.studyName).toBe("Study A");
    expect(loaded?.results[0]?.inputFileName).toBe("Raw P01.csv");
    // Browser blobs are not round-tripped; receipt-pinned Rust locators are.
    expect(loaded?.results[0]?.outputs).toHaveLength(1);
    expect(loaded?.results[0]?.outputs[0]?.blob).toBeNull();
    expect(loaded?.results[0]?.timelineView).toBeUndefined();
    expect(loaded?.results[0]?.reviewSummary).toBeUndefined();
    expect(
      loaded?.results[0]?.persistedPlotRequest?.options.enablePlotting,
    ).toBe(true);
    expect(
      loaded?.results[0]?.persistedTimelineRequest?.options
        .enableInteractiveTimeline,
    ).toBe(true);
    expect(loaded?.results[0]?.restoredWithoutArtifacts).toBe(true);
    // Counts survive so the restored summary still renders.
    expect(loaded?.results[0]?.appRowCount).toBe(1);
    expect(loaded?.discoveredTimezones).toEqual(["America/Chicago"]);
  });

  it("clears the cached run", async () => {
    await saveLastRun({
      options: DEFAULT_BROWSER_OPTIONS,
      results: [result()],
      discoveredTimezones: [],
    });
    await clearLastRun();
    expect(await loadLastRun()).toBeUndefined();
  });

  it("self-heals an empty cached run instead of re-reading it forever", async () => {
    await saveLastRun({
      options: DEFAULT_BROWSER_OPTIONS,
      results: [],
      discoveredTimezones: [],
    });
    expect(await loadLastRun()).toBeUndefined();
    // The stale record was cleared, not just skipped.
    expect(await loadLastRun()).toBeUndefined();
  });

  it("drops the record and rethrows when the write itself fails", async () => {
    const unsavable = {
      ...DEFAULT_BROWSER_OPTIONS,
      poison: () => {},
    } as unknown as typeof DEFAULT_BROWSER_OPTIONS;
    await expect(
      saveLastRun({
        options: unsavable,
        results: [result()],
        discoveredTimezones: [],
      }),
    ).rejects.toThrow();
    expect(await loadLastRun()).toBeUndefined();
  });
});

describe("lastRunStore under a failing IndexedDB", () => {
  /**
   * Fake indexedDB whose every transaction fires onerror — models quota
   * exhaustion / a corrupt store, where the transaction (not the request
   * call) is what fails.
   */
  function failingIndexedDB() {
    const db = {
      close: () => {},
      transaction: () => {
        const tx: {
          error: Error;
          objectStore: () => {
            put: () => object;
            get: () => object;
            delete: () => object;
          };
          onerror?: () => void;
          oncomplete?: () => void;
        } = {
          error: new Error("quota exhausted"),
          objectStore: () => ({
            put: () => ({}),
            get: () => ({}),
            delete: () => ({}),
          }),
        };
        queueMicrotask(() => tx.onerror?.());
        return tx;
      },
    };
    return {
      open: () => {
        const request: {
          result: typeof db;
          onsuccess?: () => void;
          onerror?: () => void;
        } = {
          result: db,
        };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    };
  }

  function failingOpenIndexedDB(error: unknown) {
    return {
      open: () => {
        const request: {
          error: unknown;
          onerror?: () => void;
        } = { error };
        queueMicrotask(() => request.onerror?.());
        return request;
      },
    };
  }

  beforeEach(() => {
    vi.stubGlobal("indexedDB", failingIndexedDB());
    return () => vi.unstubAllGlobals();
  });

  it("saveLastRun surfaces the transaction failure after attempting cleanup", async () => {
    await expect(
      saveLastRun({
        options: DEFAULT_BROWSER_OPTIONS,
        results: [result()],
        discoveredTimezones: [],
      }),
    ).rejects.toThrow("quota exhausted");
  });

  it("loadLastRun self-heals to undefined instead of throwing on every boot", async () => {
    await expect(loadLastRun()).resolves.toBeUndefined();
  });

  it.each([new Error("open failed"), "open failed"])(
    "normalizes an IndexedDB open failure and starts clean (%s)",
    async (error) => {
      vi.stubGlobal("indexedDB", failingOpenIndexedDB(error));
      await expect(loadLastRun()).resolves.toBeUndefined();
    },
  );

  it("swallows a fenced deletion failure and still starts clean", async () => {
    const values = new Map([["chronicle-last-run-deleted-v1", "1"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });

    await expect(loadLastRun()).resolves.toBeUndefined();
  });
});

describe("lastRunStore IndexedDB edge cases", () => {
  it("normalizes a string transaction failure without recreating an existing store", async () => {
    const createObjectStore = vi.fn();
    const db = {
      close: vi.fn(),
      objectStoreNames: { contains: () => true },
      createObjectStore,
      transaction: () => {
        const tx: {
          error: string;
          onerror?: () => void;
          oncomplete?: () => void;
          objectStore: () => {
            put: () => object;
            delete: () => object;
          };
        } = {
          error: "string transaction failure",
          objectStore: () => ({
            put: () => {
              queueMicrotask(() => tx.onerror?.());
              return {};
            },
            delete: () => {
              queueMicrotask(() => tx.onerror?.());
              return {};
            },
          }),
        };
        return tx;
      },
    };
    vi.stubGlobal("indexedDB", {
      open: () => {
        const request: {
          result: typeof db;
          onupgradeneeded?: () => void;
          onsuccess?: () => void;
          onerror?: () => void;
        } = { result: db };
        queueMicrotask(() => {
          request.onupgradeneeded?.();
          request.onsuccess?.();
        });
        return request;
      },
    });

    try {
      await expect(
        saveLastRun({
          options: DEFAULT_BROWSER_OPTIONS,
          results: [result()],
          discoveredTimezones: [],
        }),
      ).rejects.toThrow("string transaction failure");
      expect(createObjectStore).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ignores cleanup failure after reading an invalid record", async () => {
    let transactionNumber = 0;
    const db = {
      close: vi.fn(),
      transaction: () => {
        transactionNumber += 1;
        const tx: {
          error: Error;
          onerror?: () => void;
          oncomplete?: () => void;
          objectStore: () => {
            get: () => { result: unknown };
            delete: () => object;
          };
        } = {
          error: new Error("cleanup failed"),
          objectStore: () => ({
            get: () => {
              const request = {
                result: {
                  id: "last",
                  schemaVersion: 1,
                  savedAt: "2026-06-05T00:00:00Z",
                  options: DEFAULT_BROWSER_OPTIONS,
                  results: [],
                  discoveredTimezones: [],
                },
              };
              queueMicrotask(() => tx.oncomplete?.());
              return request;
            },
            delete: () => {
              queueMicrotask(() => tx.onerror?.());
              return {};
            },
          }),
        };
        return tx;
      },
    };
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubGlobal("indexedDB", {
      open: () => {
        const request: {
          result: typeof db;
          onsuccess?: () => void;
          onerror?: () => void;
          onupgradeneeded?: () => void;
        } = { result: db };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    });

    try {
      await expect(loadLastRun()).resolves.toBeUndefined();
      expect(transactionNumber).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
