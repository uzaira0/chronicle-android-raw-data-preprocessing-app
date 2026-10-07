import "fake-indexeddb/auto";
import { IDBFactory as FreshIDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BROWSER_OPTIONS,
  OPENER_SET_VALUES,
} from "@/lib/generatedContract";
import {
  clearLastRun,
  clearLastComponentManifest,
  loadLastComponentManifest,
  saveLastComponentManifest,
  loadResearchMethodSelection,
  saveResearchMethodSelection,
  detectLegacyLastRunState,
  LAST_RUN_DB_NAME,
  LAST_RUN_DB_VERSION,
  LAST_RUN_RECORD_ID,
  LAST_RUN_SCHEMA_VERSION,
  LAST_RUN_STORE_NAME,
  loadArchivedLastRun,
  loadLastRun,
  loadLastRunOutcome,
  LAST_RUN_ARCHIVE_ID,
  saveLastRun,
  toLightweightResults,
  type LastRunRecord,
} from "@/lib/lastRunStore";
import type {
  BrowserProcessingOptions,
  ProcessedFileResult,
} from "@/lib/types";

const INVALID_OPENERS = [
  { label: "missing", present: false, value: undefined },
  { label: "unknown", present: true, value: "unknown_opener" },
  { label: "wrong type", present: true, value: 1 },
  { label: "null", present: true, value: null },
] as const;

function optionsWithOpener(value: unknown, present = true): BrowserProcessingOptions {
  const options = { ...DEFAULT_BROWSER_OPTIONS } as Record<string, unknown>;
  if (present) options.openerSet = value;
  else delete options.openerSet;
  return options as BrowserProcessingOptions;
}

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

async function rawLastRunStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LAST_RUN_DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error instanceof Error
          ? request.error
          : new Error(String(request.error)),
      );
  });
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(LAST_RUN_STORE_NAME, mode);
    const request = operation(transaction.objectStore(LAST_RUN_STORE_NAME));
    transaction.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    transaction.onerror = () => {
      db.close();
      reject(
        transaction.error instanceof Error
          ? transaction.error
          : new Error(String(transaction.error)),
      );
    };
  });
}

function rawLastRunRecord(options: BrowserProcessingOptions): LastRunRecord {
  return {
    id: LAST_RUN_RECORD_ID,
    schemaVersion: LAST_RUN_SCHEMA_VERSION,
    savedAt: "2026-08-11T00:00:00Z",
    options,
    results: [result()],
    discoveredTimezones: [],
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
    protocolVersion: "chronicle-preprocessing-runtime/v2",
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

describe("legacy last-run database boundary", () => {
  it("detects the retired database by enumeration without opening or deleting it", async () => {
    const databases = vi.fn(() =>
      Promise.resolve([
        { name: "chronicle-last-run", version: 1 },
        { name: LAST_RUN_DB_NAME, version: LAST_RUN_DB_VERSION },
      ]),
    );
    const open = vi.fn(() => {
      throw new Error("legacy databases must never be opened");
    });
    const deleteDatabase = vi.fn(() => {
      throw new Error("legacy databases must never be deleted");
    });
    const factory = {
      databases,
      open,
      deleteDatabase,
    } as unknown as IDBFactory;

    await expect(detectLegacyLastRunState(factory)).resolves.toEqual({
      detected: true,
      detectionSupported: true,
    });
    expect(databases).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(deleteDatabase).not.toHaveBeenCalled();
  });

  it("does not inspect legacy state when non-opening enumeration is unsupported", async () => {
    const open = vi.fn(() => {
      throw new Error("must not fall back to open");
    });
    const deleteDatabase = vi.fn();
    const factory = { open, deleteDatabase } as unknown as IDBFactory;

    await expect(detectLegacyLastRunState(factory)).resolves.toEqual({
      detected: false,
      detectionSupported: false,
    });
    expect(open).not.toHaveBeenCalled();
    expect(deleteDatabase).not.toHaveBeenCalled();
  });

  it("does not fall back to opening the legacy database when enumeration fails", async () => {
    const databases = vi.fn(() => Promise.reject(new Error("denied")));
    const open = vi.fn();
    const factory = { databases, open } as unknown as IDBFactory;

    await expect(detectLegacyLastRunState(factory)).resolves.toEqual({
      detected: false,
      detectionSupported: false,
    });
    expect(open).not.toHaveBeenCalled();
  });
});

describe("lastRunStore never deletes a saved run it cannot reopen", () => {
  it("moves a record of another format to the archive slot and says why", async () => {
    const stale = { ...rawLastRunRecord(DEFAULT_BROWSER_OPTIONS), schemaVersion: LAST_RUN_SCHEMA_VERSION + 1 };
    await rawLastRunStore("readwrite", (store) => store.put(stale));

    const outcome = await loadLastRunOutcome();

    expect(outcome).toEqual({
      status: "archived",
      reason: `it was saved in format ${LAST_RUN_SCHEMA_VERSION + 1} and this version reads format ${LAST_RUN_SCHEMA_VERSION}`,
    });
    expect(await rawLastRunStore("readonly", (store) => store.get(LAST_RUN_RECORD_ID))).toBeUndefined();
    const archived = await loadArchivedLastRun();
    expect(archived?.id).toBe(LAST_RUN_ARCHIVE_ID);
    expect(archived?.reason).toBe(outcome.status === "archived" ? outcome.reason : "");
    expect(JSON.stringify(archived?.record)).toBe(JSON.stringify(stale));
    // The next boot finds nothing to restore and nothing more to report.
    await expect(loadLastRunOutcome()).resolves.toEqual({ status: "none" });
    expect(await loadArchivedLastRun()).toBeDefined();
  });

  it("archives a record whose results are not a list", async () => {
    await rawLastRunStore("readwrite", (store) =>
      store.put({ ...rawLastRunRecord(DEFAULT_BROWSER_OPTIONS), results: "garbled" }),
    );
    await expect(loadLastRunOutcome()).resolves.toEqual({
      status: "archived",
      reason: "it has no list of results",
    });
  });

  it("restores a current record through the outcome API", async () => {
    await saveLastRun({ options: DEFAULT_BROWSER_OPTIONS, results: [result()], discoveredTimezones: [] });
    const outcome = await loadLastRunOutcome();
    expect(outcome.status).toBe("restored");
    expect(outcome.status === "restored" ? outcome.record.results : []).toHaveLength(1);
  });
});

describe("lastRunStore batch completeness", () => {
  it("records what a partial batch attempted, so a restore is not mistaken for a clean run", async () => {
    await saveLastRun({
      options: DEFAULT_BROWSER_OPTIONS,
      results: [result()],
      discoveredTimezones: [],
      attemptedFileCount: 10,
      unfinishedFileNames: ["b.csv", "c.csv"],
    });
    const record = await loadLastRun();
    expect(record?.attemptedFileCount).toBe(10);
    expect(record?.unfinishedFileNames).toEqual(["b.csv", "c.csv"]);
    // The shortfall the restore banner reports.
    expect((record?.attemptedFileCount ?? 0) - (record?.results.length ?? 0)).toBe(9);
  });

  it("defaults a complete batch to no shortfall", async () => {
    await saveLastRun({
      options: DEFAULT_BROWSER_OPTIONS,
      results: [result()],
      discoveredTimezones: [],
    });
    const record = await loadLastRun();
    expect(record?.attemptedFileCount).toBe(1);
    expect(record?.unfinishedFileNames).toEqual([]);
  });
});

describe("lastRunStore", () => {
  it("retains a component locator independently of ordinary results and removes only that pointer", async () => {
    await saveLastRun({ options: DEFAULT_BROWSER_OPTIONS, results: [result()], discoveredTimezones: [] });
    await saveLastComponentManifest('{"workspaceId":"verified-at-reopen"}');
    await saveResearchMethodSelection('{"profile":"validated-by-profile-parser","selectedLevels":{"axis":"level"}}');
    expect(await loadLastComponentManifest()).toBe('{"workspaceId":"verified-at-reopen"}');
    await clearLastComponentManifest();
    expect(await loadLastComponentManifest()).toBeUndefined();
    expect((await loadLastRun())?.results).toHaveLength(1);
    expect(await loadResearchMethodSelection()).toBe('{"profile":"validated-by-profile-parser","selectedLevels":{"axis":"level"}}');
  });

  it("opens only the workflow-namespaced current database", async () => {
    const open = vi.spyOn(indexedDB, "open");
    try {
      await saveLastRun({
        options: DEFAULT_BROWSER_OPTIONS,
        results: [result()],
        discoveredTimezones: [],
      });

      expect(open).toHaveBeenCalledWith(LAST_RUN_DB_NAME, LAST_RUN_DB_VERSION);
      expect(open).not.toHaveBeenCalledWith("chronicle-last-run", 1);
    } finally {
      open.mockRestore();
    }
  });

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

  it("sanitizes opener values at both direct write and direct load boundaries", async () => {
    for (const openerSet of OPENER_SET_VALUES) {
      await saveLastRun({
        options: optionsWithOpener(openerSet),
        results: [result()],
        discoveredTimezones: [],
      });
      expect((await loadLastRun())?.options.openerSet).toBe(openerSet);
    }

    for (const { label, present, value } of INVALID_OPENERS) {
      await saveLastRun({
        options: optionsWithOpener(value, present),
        results: [result()],
        discoveredTimezones: [],
      });
      const stored = await rawLastRunStore<LastRunRecord | undefined>(
        "readonly",
        (store) =>
          store.get(LAST_RUN_RECORD_ID) as IDBRequest<
            LastRunRecord | undefined
          >,
      );
      expect(stored?.options.openerSet, `write ${label}`).toBe(
        "strategy_defined",
      );

      await rawLastRunStore("readwrite", (store) =>
        store.put(
          rawLastRunRecord(optionsWithOpener(value, present)),
        ),
      );
      expect((await loadLastRun())?.options.openerSet, `load ${label}`).toBe(
        "strategy_defined",
      );
    }
  });

  it("keeps a legal B06 vector and returns a partial one to omission at both boundaries", async () => {
    const legal = {
      ...DEFAULT_BROWSER_OPTIONS,
      longDurationThresholdHoursExplicit: true,
      maximumDurationPolicy: "post_reconstruction_strict_max_v1",
      maximumDurationDisposition: "drop_row",
      maximumDurationThresholdSource: "fixed_parameter",
      maximumDurationThresholdNs: "9223372036854775807",
    } as BrowserProcessingOptions;
    await saveLastRun({ options: legal, results: [result()], discoveredTimezones: [] });
    expect((await loadLastRun())?.options).toMatchObject({
      longDurationThresholdHoursExplicit: true,
      maximumDurationPolicy: "post_reconstruction_strict_max_v1",
      maximumDurationDisposition: "drop_row",
      maximumDurationThresholdSource: "fixed_parameter",
      maximumDurationThresholdNs: "9223372036854775807",
    });

    // A policy without its siblings, and a threshold that is not exact
    // base-10 i64, are both illegal shapes: the whole vector (and the marker)
    // returns to omission rather than being repaired.
    for (const partial of [
      { maximumDurationPolicy: "strategy_native" },
      {
        maximumDurationPolicy: "post_reconstruction_strict_max_v1",
        maximumDurationDisposition: "truncate_to_threshold",
        maximumDurationThresholdSource: "fixed_parameter",
        maximumDurationThresholdNs: "9223372036854775808",
      },
    ]) {
      const malformed = {
        ...DEFAULT_BROWSER_OPTIONS,
        longDurationThresholdHoursExplicit: true,
        ...partial,
      } as unknown as BrowserProcessingOptions;
      await saveLastRun({ options: malformed, results: [result()], discoveredTimezones: [] });
      const stored = await rawLastRunStore<LastRunRecord | undefined>(
        "readonly",
        (store) => store.get(LAST_RUN_RECORD_ID) as IDBRequest<LastRunRecord | undefined>,
      );
      for (const key of [
        "maximumDurationPolicy",
        "maximumDurationDisposition",
        "maximumDurationThresholdSource",
        "maximumDurationThresholdNs",
        "longDurationThresholdHoursExplicit",
      ]) {
        expect(stored?.options, `write ${JSON.stringify(partial)}`).not.toHaveProperty(key);
      }
      await rawLastRunStore("readwrite", (store) => store.put(rawLastRunRecord(malformed)));
      const loaded = (await loadLastRun())?.options;
      for (const key of [
        "maximumDurationPolicy",
        "maximumDurationDisposition",
        "maximumDurationThresholdSource",
        "maximumDurationThresholdNs",
        "longDurationThresholdHoursExplicit",
      ]) {
        expect(loaded, `load ${JSON.stringify(partial)}`).not.toHaveProperty(key);
      }
    }
  });

  it("defaults new research axes at both last-run write and load boundaries", async () => {
    const malformed = {
      ...DEFAULT_BROWSER_OPTIONS,
      microUseClassificationPolicy: "unknown-micro",
      minimumDurationComparator: null,
      minimumDurationDisposition: [],
      screenSessionConstructionStrategy: 5,
    } as unknown as BrowserProcessingOptions;
    await saveLastRun({
      options: malformed,
      results: [result()],
      discoveredTimezones: [],
    });
    expect((await loadLastRun())?.options).toMatchObject({
      microUseClassificationPolicy: "none",
      minimumDurationComparator: "strict_lt",
      minimumDurationDisposition: "chronicle_blank_keep_row",
      screenSessionConstructionStrategy: "chronicle_screen_interactive_v1",
    });

    await rawLastRunStore("readwrite", (store) =>
      store.put(rawLastRunRecord(malformed)),
    );
    expect((await loadLastRun())?.options).toMatchObject({
      microUseClassificationPolicy: "none",
      minimumDurationComparator: "strict_lt",
      minimumDurationDisposition: "chronicle_blank_keep_row",
      screenSessionConstructionStrategy: "chronicle_screen_interactive_v1",
    });
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
    const unsavableResult = {
      ...result(),
      poison: () => {},
    } as unknown as ProcessedFileResult;
    await expect(
      saveLastRun({
        options: DEFAULT_BROWSER_OPTIONS,
        results: [unsavableResult],
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

  it("loadLastRun keeps an unreadable record, reports it, and never throws on boot", async () => {
    const deletes = vi.fn();
    const failing = failingIndexedDB();
    vi.stubGlobal("indexedDB", {
      open: () => {
        const request = failing.open();
        const transaction = request.result.transaction.bind(request.result);
        request.result.transaction = () => {
          const tx = transaction();
          const store = tx.objectStore();
          tx.objectStore = () => ({ ...store, delete: () => (deletes(), {}) });
          return tx;
        };
        return request;
      },
    });
    await expect(loadLastRunOutcome()).resolves.toEqual({
      status: "kept",
      reason: "it could not be read (quota exhausted)",
    });
    await expect(loadLastRun()).resolves.toBeUndefined();
    expect(deletes).not.toHaveBeenCalled();
  });

  it("keeps a record of another format in place when it cannot be moved aside", async () => {
    let transactionNumber = 0;
    const db = {
      close: vi.fn(),
      transaction: (_store: string, mode: IDBTransactionMode) => {
        transactionNumber += 1;
        const tx: {
          error: Error;
          onerror?: () => void;
          oncomplete?: () => void;
          objectStore: () => object;
        } = {
          error: new Error("quota exhausted"),
          objectStore: () => ({
            get: () => {
              queueMicrotask(() => tx.oncomplete?.());
              return { result: { ...rawLastRunRecord(DEFAULT_BROWSER_OPTIONS), schemaVersion: 0 } };
            },
            put: () => ({}),
            delete: () => {
              queueMicrotask(() => tx.onerror?.());
              return {};
            },
          }),
        };
        expect(mode).toBe(transactionNumber === 1 ? "readonly" : "readwrite");
        return tx;
      },
    };
    vi.stubGlobal("indexedDB", {
      open: () => {
        const request: { result: typeof db; onsuccess?: () => void } = { result: db };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    });
    await expect(loadLastRunOutcome()).resolves.toEqual({
      status: "kept",
      reason: `it was saved in format 0 and this version reads format ${LAST_RUN_SCHEMA_VERSION}, and it could not be moved aside (quota exhausted)`,
    });
  });

  it.each([new Error("open failed"), "open failed"])(
    "normalizes an IndexedDB open failure and starts clean (%s)",
    async (error) => {
      vi.stubGlobal("indexedDB", failingOpenIndexedDB(error));
      await expect(loadLastRun()).resolves.toBeUndefined();
    },
  );

  it("swallows a fenced deletion failure and still starts clean", async () => {
    const values = new Map([
      ["chronicle-workflow-last-run-deleted-v1", "1"],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });

    await expect(loadLastRun()).resolves.toBeUndefined();
  });
});

describe("lastRunStore under an aborted commit", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a save the browser aborts while committing instead of never settling", async () => {
    // Quota exhaustion at commit time aborts the transaction and fires no
    // request error: only onabort runs.
    const db = {
      close: vi.fn(),
      transaction: () => {
        const tx: {
          error: Error | null;
          onabort?: () => void;
          objectStore: () => { put: () => object; delete: () => object };
        } = {
          error: null,
          objectStore: () => ({
            put: () => {
              queueMicrotask(() => tx.onabort?.());
              return {};
            },
            delete: () => {
              queueMicrotask(() => tx.onabort?.());
              return {};
            },
          }),
        };
        return tx;
      },
    };
    vi.stubGlobal("indexedDB", {
      open: () => {
        const request: { result: typeof db; onsuccess?: () => void } = { result: db };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    });

    await expect(
      saveLastRun({
        options: DEFAULT_BROWSER_OPTIONS,
        results: [result()],
        discoveredTimezones: [],
      }),
    ).rejects.toThrow("The browser aborted the saved-run write.");
    await expect(clearLastRun()).rejects.toThrow("The browser aborted the saved-run write.");
    expect(db.close).toHaveBeenCalled();
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

describe("lastRunStore locator validation", () => {
  it.each([
    [
      "a component locator that is not a string",
      () => saveLastComponentManifest(1 as unknown as string),
      () => loadLastComponentManifest(),
      "Saved component locator is invalid",
    ],
    [
      "a research selection that is not a string",
      () => saveResearchMethodSelection(1 as unknown as string),
      () => loadResearchMethodSelection(),
      "Saved research selection is invalid",
    ],
  ])("refuses %s", async (_label, save, load, message) => {
    await save();
    await expect(load()).rejects.toThrow(message);
  });

  it("reports no research selection on a browser that never saved one", async () => {
    vi.stubGlobal("indexedDB", new FreshIDBFactory());
    await expect(loadResearchMethodSelection()).resolves.toBeUndefined();
    await saveResearchMethodSelection('{"profile":"first-save"}');
    await expect(loadResearchMethodSelection()).resolves.toBe('{"profile":"first-save"}');
  });

  it.each([
    ["there is no IndexedDB factory", undefined],
    ["the factory cannot enumerate databases", {} as IDBFactory],
  ])("reports legacy detection unsupported when %s", async (_label, factory) => {
    vi.stubGlobal("indexedDB", undefined);
    try {
      await expect(detectLegacyLastRunState(factory)).resolves.toEqual({
        detected: false,
        detectionSupported: false,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
