import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
        previewRows: [["a", "b"], ["1", "2"]],
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
    timelineView: {
      timezone: "America/Chicago",
      app: [
        { participantId: "P01", scene: { width: 1, height: 1, primitives: [] }, regions: [] },
      ],
      screen: [],
    },
    reviewSummary: { participants: [] },
  };
}

beforeEach(async () => {
  await clearLastRun();
});

describe("toLightweightResults", () => {
  it("drops heavy artifacts, keeps counts + reviewSummary, flags the result", () => {
    const [light] = toLightweightResults([result()]);
    expect(light.outputs).toEqual([]);
    expect(light.timelineView).toBeUndefined();
    expect(light.restoredWithoutArtifacts).toBe(true);
    expect(light.appRowCount).toBe(1);
    expect(light.timezone).toBe("America/Chicago");
    expect(light.reviewSummary).toBeTruthy();
  });

  it("does not mutate the live result — this session's downloads still work", () => {
    const live = result();
    toLightweightResults([live]);
    expect(live.outputs).toHaveLength(1);
    expect(live.timelineView).toBeDefined();
    expect(live.restoredWithoutArtifacts).toBeUndefined();
  });
});

describe("lastRunStore", () => {
  it("persists only the lightweight shape (no blobs/timeline) but keeps counts", async () => {
    await saveLastRun({
      options: { ...DEFAULT_BROWSER_OPTIONS, studyName: "Study A" },
      results: [result()],
      discoveredTimezones: ["America/Chicago"],
      savedAt: "2026-06-05T00:00:00Z",
    });

    const loaded = await loadLastRun();
    expect(loaded?.options.studyName).toBe("Study A");
    expect(loaded?.results[0]?.inputFileName).toBe("Raw P01.csv");
    // The multi-hundred-MB artifacts are NOT round-tripped — that's the point.
    expect(loaded?.results[0]?.outputs).toEqual([]);
    expect(loaded?.results[0]?.timelineView).toBeUndefined();
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
      saveLastRun({ options: unsavable, results: [result()], discoveredTimezones: [] }),
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
          objectStore: () => { put: () => object; get: () => object; delete: () => object };
          onerror?: () => void;
          oncomplete?: () => void;
        } = {
          error: new Error("quota exhausted"),
          objectStore: () => ({ put: () => ({}), get: () => ({}), delete: () => ({}) }),
        };
        queueMicrotask(() => tx.onerror?.());
        return tx;
      },
    };
    return {
      open: () => {
        const request: { result: typeof db; onsuccess?: () => void; onerror?: () => void } = {
          result: db,
        };
        queueMicrotask(() => request.onsuccess?.());
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
      saveLastRun({ options: DEFAULT_BROWSER_OPTIONS, results: [result()], discoveredTimezones: [] }),
    ).rejects.toThrow("quota exhausted");
  });

  it("loadLastRun self-heals to undefined instead of throwing on every boot", async () => {
    await expect(loadLastRun()).resolves.toBeUndefined();
  });
});
