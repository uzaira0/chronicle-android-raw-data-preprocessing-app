import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BROWSER_OPTIONS,
  OPENER_SET_VALUES,
} from "@/lib/generatedContract";
import {
  buildProjectRecord,
  deleteProject,
  listProjects,
  loadProject,
  PROJECTS_DB_NAME,
  projectByteSize,
  saveProject,
  storedFileToFile,
  type ProjectRecord,
} from "@/lib/projectsStore";
import {
  loadMethodReceiptValidation,
  SETTINGS_SCHEMA_VERSION,
} from "@/lib/settingsPersistence";
import { createSleepDiaryMethodProfileReceipt } from "@/lib/sleepDiaryReplication";
import type { BrowserProcessingOptions } from "@/lib/types";

// Receipt validation loads on demand in the app (see loadMethodReceiptValidation);
// these tests validate receipts synchronously, as App does once it has loaded.
beforeAll(async () => {
  await loadMethodReceiptValidation();
});

const file = (name: string, body = "data"): File => new File([body], name, { type: "text/csv" });

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

function projectRecord(
  id: string,
  options: BrowserProcessingOptions,
): ProjectRecord {
  return {
    id,
    name: id,
    createdAt: "2026-08-11T00:00:00Z",
    updatedAt: "2026-08-11T00:00:00Z",
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    options,
    includesFiles: false,
    rawFileNames: [],
    rawFiles: [],
    supportFiles: {},
  };
}

async function rawProjectStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(PROJECTS_DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error instanceof Error
          ? request.error
          : new Error(String(request.error)),
      );
  });
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction("projects", mode);
    const request = operation(transaction.objectStore("projects"));
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

beforeEach(async () => {
  // Clear any projects left by a previous test.
  for (const p of await listProjects()) await deleteProject(p.id);
});

describe("buildProjectRecord", () => {
  it("config-only: stores names but no blobs", () => {
    const record = buildProjectRecord({
      id: "1",
      name: "Study A",
      now: "2026-06-04T00:00:00Z",
      options: DEFAULT_BROWSER_OPTIONS,
      rawFiles: [file("Raw P01.csv"), file("Raw P02.csv")],
      supportFiles: { appCodebookFile: file("codebook.csv") },
      includeFiles: false,
    });
    expect(record.includesFiles).toBe(false);
    expect(record.rawFileNames).toEqual(["Raw P01.csv", "Raw P02.csv"]);
    expect(record.rawFiles).toEqual([]);
    expect(record.supportFiles).toEqual({});
  });

  it("with-files: bundles raw + support blobs", () => {
    const record = buildProjectRecord({
      id: "1",
      name: "Study A",
      now: "2026-06-04T00:00:00Z",
      options: DEFAULT_BROWSER_OPTIONS,
      rawFiles: [file("Raw P01.csv")],
      supportFiles: {
        appCodebookFile: file("codebook.csv"),
        inputCapabilityEvidenceFile: file("capabilities.csv"),
        analysisFeatureMatrixFile: file("analysis-feature-matrix.csv"),
        callSmsEligibilityFile: file("call-sms-eligibility.csv"),
        phoneStudyPsCommunicationFile: file("ps_communication.csv"),
        phoneStudyEsFile: file("es.csv"),
        anchorEventsFile: file("anchor-events.csv"),
        filterFile: null,
      },
      includeFiles: true,
    });
    expect(record.includesFiles).toBe(true);
    expect(record.rawFiles.map((f) => f.name)).toEqual(["Raw P01.csv"]);
    expect(Object.keys(record.supportFiles)).toEqual([
      "appCodebookFile",
      "inputCapabilityEvidenceFile",
      "analysisFeatureMatrixFile",
      "callSmsEligibilityFile",
      "phoneStudyPsCommunicationFile",
      "phoneStudyEsFile",
      "anchorEventsFile",
    ]); // null filter skipped
  });

  it("sanitizes valid and malformed opener values for direct builder callers", () => {
    for (const openerSet of OPENER_SET_VALUES) {
      const record = buildProjectRecord({
        id: openerSet,
        name: openerSet,
        now: "2026-08-11T00:00:00Z",
        options: optionsWithOpener(openerSet),
        rawFiles: [],
        supportFiles: {},
        includeFiles: false,
      });
      expect(record.options.openerSet).toBe(openerSet);
    }

    for (const { label, present, value } of INVALID_OPENERS) {
      const record = buildProjectRecord({
        id: label,
        name: label,
        now: "2026-08-11T00:00:00Z",
        options: optionsWithOpener(value, present),
        rawFiles: [],
        supportFiles: {},
        includeFiles: false,
      });
      expect(record.options.openerSet, label).toBe("strategy_defined");
    }
  });

  it("keeps a legal B06 vector and returns a partial one to omission for direct builder callers", () => {
    const legal = buildProjectRecord({
      id: "b06-legal",
      name: "b06-legal",
      now: "2026-08-17T00:00:00Z",
      options: {
        ...DEFAULT_BROWSER_OPTIONS,
        maximumDurationPolicy: "chronicle_observed_close_rejection_v1",
        maximumDurationDisposition: "not_applicable",
        maximumDurationThresholdSource: "chronicle_legacy_config",
      },
      rawFiles: [],
      supportFiles: {},
      includeFiles: false,
    });
    expect(legal.options).toMatchObject({
      maximumDurationPolicy: "chronicle_observed_close_rejection_v1",
      maximumDurationDisposition: "not_applicable",
      maximumDurationThresholdSource: "chronicle_legacy_config",
    });
    expect(legal.options).not.toHaveProperty("maximumDurationThresholdNs");

    const partial = buildProjectRecord({
      id: "b06-partial",
      name: "b06-partial",
      now: "2026-08-17T00:00:00Z",
      options: {
        ...DEFAULT_BROWSER_OPTIONS,
        maximumDurationDisposition: "drop_row",
        maximumDurationThresholdNs: "1",
      } as unknown as BrowserProcessingOptions,
      rawFiles: [],
      supportFiles: {},
      includeFiles: false,
    });
    for (const key of [
      "maximumDurationPolicy",
      "maximumDurationDisposition",
      "maximumDurationThresholdSource",
      "maximumDurationThresholdNs",
    ]) {
      expect(partial.options).not.toHaveProperty(key);
    }
  });

  it("defaults newly added research axes in old or malformed project records", () => {
    const options = { ...DEFAULT_BROWSER_OPTIONS } as unknown as Record<string, unknown>;
    delete options.microUseClassificationPolicy;
    options.minimumDurationComparator = "not-a-comparator";
    options.minimumDurationDisposition = null;
    options.screenSessionConstructionStrategy = [];
    const record = buildProjectRecord({
      id: "old-project",
      name: "old-project",
      now: "2026-08-11T00:00:00Z",
      options: options as unknown as BrowserProcessingOptions,
      rawFiles: [],
      supportFiles: {},
      includeFiles: false,
    });
    expect(record.options).toMatchObject({
      microUseClassificationPolicy: "none",
      minimumDurationComparator: "strict_lt",
      minimumDurationDisposition: "chronicle_blank_keep_row",
      screenSessionConstructionStrategy: "chronicle_screen_interactive_v1",
    });
  });
});

describe("projectByteSize", () => {
  it("is zero when files aren't bundled, sums sizes otherwise", () => {
    const args = {
      rawFiles: [file("a.csv", "12345")],
      supportFiles: {
        appCodebookFile: file("c.csv", "678"),
        filterFile: null,
      },
    };
    expect(projectByteSize({ ...args, includeFiles: false })).toBe(0);
    expect(projectByteSize({ ...args, includeFiles: true })).toBe(8);
  });
});

describe("storedFileToFile", () => {
  it("falls back to the blob MIME type when optional file metadata is absent", () => {
    const restored = storedFileToFile({
      name: "legacy.csv",
      blob: new Blob(["legacy"], { type: "text/csv" }),
    });

    expect(restored.name).toBe("legacy.csv");
    expect(restored.type).toBe("text/csv");
    expect(restored.lastModified).toBeGreaterThan(0);
  });
});

describe("IndexedDB CRUD round-trip", () => {
  it("saves, lists, loads (rehydrating File), and deletes", async () => {
    const record = buildProjectRecord({
      id: "p1",
      name: "Resumable",
      now: "2026-06-04T10:00:00Z",
      options: { ...DEFAULT_BROWSER_OPTIONS, studyName: "MyStudy" },
      rawFiles: [file("Raw P01.csv", "hello")],
      supportFiles: {
        appCodebookFile: file("codebook.csv", "cb"),
        anchorEventsFile: file(
          "anchors.csv",
          "participant_id,anchor_timestamp\nP1,2026-01-01 12:00:00\n",
        ),
      },
      includeFiles: true,
    });
    await saveProject(record);

    const summaries = await listProjects();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ id: "p1", name: "Resumable", includesFiles: true });
    expect(summaries[0]?.rawFileNames).toEqual(["Raw P01.csv"]);

    const loaded = await loadProject("p1");
    expect(loaded!.options.studyName).toBe("MyStudy");
    const firstStoredFile = loaded!.rawFiles[0];
    if (firstStoredFile === undefined) throw new Error("expected a stored raw file");
    const restored = storedFileToFile(firstStoredFile);
    expect(restored).toBeInstanceOf(File);
    expect(restored.name).toBe("Raw P01.csv");
    expect(await restored.text()).toBe("hello");
    expect(await storedFileToFile(loaded!.supportFiles.appCodebookFile!).text()).toBe("cb");
    expect(
      await storedFileToFile(loaded!.supportFiles.anchorEventsFile!).text(),
    ).toBe("participant_id,anchor_timestamp\nP1,2026-01-01 12:00:00\n");

    await deleteProject("p1");
    expect(await listProjects()).toHaveLength(0);
  });

  it("sanitizes opener values at both direct write and direct load boundaries", async () => {
    for (const openerSet of OPENER_SET_VALUES) {
      const id = `valid-${openerSet}`;
      await saveProject(projectRecord(id, optionsWithOpener(openerSet)));
      expect((await loadProject(id))?.options.openerSet).toBe(openerSet);
    }

    for (const { label, present, value } of INVALID_OPENERS) {
      const writeId = `write-${label}`;
      await saveProject(
        projectRecord(writeId, optionsWithOpener(value, present)),
      );
      const stored = await rawProjectStore<ProjectRecord | undefined>(
        "readonly",
        (store) =>
          store.get(writeId) as IDBRequest<ProjectRecord | undefined>,
      );
      expect(stored?.options.openerSet, `write ${label}`).toBe(
        "strategy_defined",
      );

      const loadId = `load-${label}`;
      await rawProjectStore("readwrite", (store) =>
        store.put(projectRecord(loadId, optionsWithOpener(value, present))),
      );
      expect((await loadProject(loadId))?.options.openerSet, `load ${label}`).toBe(
        "strategy_defined",
      );
    }
  });

  it("stamps the settings version on save and migrates a record by when it was saved", async () => {
    // Values that were the shipped defaults until 2026-07-15.
    const oldDefaults = { ...DEFAULT_BROWSER_OPTIONS, useFilterFile: true, minimumUsageDuration: 0, proximityIntervalSeconds: 0 };
    const migrated = {
      useFilterFile: DEFAULT_BROWSER_OPTIONS.useFilterFile,
      minimumUsageDuration: DEFAULT_BROWSER_OPTIONS.minimumUsageDuration,
      proximityIntervalSeconds: DEFAULT_BROWSER_OPTIONS.proximityIntervalSeconds,
    };
    const kept = { useFilterFile: true, minimumUsageDuration: 0, proximityIntervalSeconds: 0 };
    const unversioned = (id: string, updatedAt: string) => {
      const record = { ...projectRecord(id, oldDefaults), updatedAt } as Partial<ProjectRecord>;
      delete record.schemaVersion;
      return record;
    };

    expect(buildProjectRecord({
      id: "b", name: "b", now: "2026-10-03T00:00:00Z", options: oldDefaults, rawFiles: [], supportFiles: {}, includeFiles: false,
    }).schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);

    // Saved before projects carried a version: the save time decides. In
    // June these were the defaults of the day; by August they were choices.
    await rawProjectStore("readwrite", (store) => store.put(unversioned("june", "2026-06-30T12:00:00Z")));
    await rawProjectStore("readwrite", (store) => store.put(unversioned("august", "2026-08-01T12:00:00Z")));
    // A version written after the change settles it whatever the date says.
    await rawProjectStore("readwrite", (store) => store.put({ ...projectRecord("v13", oldDefaults), updatedAt: "2026-06-30T12:00:00Z", schemaVersion: 13 }));
    // Version 1 spans the change, so its save time splits it.
    await rawProjectStore("readwrite", (store) => store.put({ ...projectRecord("v1", oldDefaults), updatedAt: "2026-06-30T12:00:00Z", schemaVersion: 1 }));

    expect((await loadProject("june"))?.options).toMatchObject(migrated);
    expect((await loadProject("august"))?.options).toMatchObject(kept);
    expect((await loadProject("v1"))?.options).toMatchObject(migrated);
    const current = await loadProject("v13");
    expect(current?.options).toMatchObject(kept);
    expect(current?.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);

    // Saving the loaded (migrated) record writes the current version.
    await saveProject({ ...(await loadProject("june"))!, schemaVersion: 0 });
    const stored = await rawProjectStore<ProjectRecord | undefined>("readonly", (store) => store.get("june") as IDBRequest<ProjectRecord | undefined>);
    expect(stored?.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(stored?.options).toMatchObject(migrated);
  });

  it("rejects when the underlying transaction errors", async () => {
    // Drive openDb → runStore with a stub whose transaction fires onerror, so the
    // transaction.onerror branch (db.close + reject) runs.
    const makeErroringDb = () => {
      const tx: {
        oncomplete: (() => void) | null;
        onerror: (() => void) | null;
        error: Error;
        objectStore: () => { put: () => Record<string, never> };
      } = {
        oncomplete: null,
        onerror: null,
        error: new Error("tx boom"),
        objectStore: () => ({
          put: () => {
            void Promise.resolve().then(() => tx.onerror?.());
            return {};
          },
        }),
      };
      return { close: () => {}, transaction: () => tx };
    };
    const mockIndexedDB = {
      open: () => {
        const request: {
          onsuccess: (() => void) | null;
          onerror: (() => void) | null;
          onupgradeneeded: (() => void) | null;
          result: unknown;
        } = { onsuccess: null, onerror: null, onupgradeneeded: null, result: null };
        void Promise.resolve().then(() => {
          request.result = makeErroringDb();
          request.onsuccess?.();
        });
        return request;
      },
    };
    vi.stubGlobal("indexedDB", mockIndexedDB);
    try {
      await expect(
        saveProject(
          buildProjectRecord({
            id: "err",
            name: "Err",
            now: "2026-06-04T00:00:00Z",
            options: DEFAULT_BROWSER_OPTIONS,
            rawFiles: [],
            supportFiles: {},
            includeFiles: false,
          }),
        ),
      ).rejects.toThrow("tx boom");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("normalizes a non-Error transaction failure without recreating an existing store", async () => {
    const createObjectStore = vi.fn();
    const db = {
      close: vi.fn(),
      objectStoreNames: { contains: () => true },
      createObjectStore,
      transaction: () => {
        const tx: {
          error: string;
          oncomplete: (() => void) | null;
          onerror: (() => void) | null;
          objectStore: () => { put: () => Record<string, never> };
        } = {
          error: "string transaction failure",
          oncomplete: null,
          onerror: null,
          objectStore: () => ({
            put: () => {
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
          onupgradeneeded: (() => void) | null;
          onsuccess: (() => void) | null;
          onerror: (() => void) | null;
        } = {
          result: db,
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null,
        };
        queueMicrotask(() => {
          request.onupgradeneeded?.();
          request.onsuccess?.();
        });
        return request;
      },
    });

    try {
      await expect(
        saveProject(
          buildProjectRecord({
            id: "string-error",
            name: "String error",
            now: "2026-06-04T00:00:00Z",
            options: DEFAULT_BROWSER_OPTIONS,
            rawFiles: [],
            supportFiles: {},
            includeFiles: false,
          }),
        ),
      ).rejects.toThrow("string transaction failure");
      expect(createObjectStore).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects when the transaction aborts without a request error (commit-phase quota)", async () => {
    const db = {
      close: vi.fn(),
      objectStoreNames: { contains: () => true },
      transaction: () => {
        const tx: {
          error: null;
          oncomplete: (() => void) | null;
          onerror: (() => void) | null;
          onabort: (() => void) | null;
          objectStore: () => { put: () => Record<string, never> };
        } = {
          error: null,
          oncomplete: null,
          onerror: null,
          onabort: null,
          objectStore: () => ({
            put: () => {
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
        const request: { result: typeof db; onsuccess: (() => void) | null } = {
          result: db,
          onsuccess: null,
        };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    });
    try {
      await expect(
        saveProject(
          buildProjectRecord({
            id: "aborted",
            name: "Aborted",
            now: "2026-06-04T00:00:00Z",
            options: DEFAULT_BROWSER_OPTIONS,
            rawFiles: [],
            supportFiles: {},
            includeFiles: false,
          }),
        ),
      ).rejects.toThrow("project transaction aborted");
      expect(db.close).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([new Error("open boom"), "string open failure"])(
    "normalizes an IndexedDB open failure (%s)",
    async (error) => {
      vi.stubGlobal("indexedDB", {
        open: () => {
          const request: {
            error: unknown;
            onerror: (() => void) | null;
          } = { error, onerror: null };
          queueMicrotask(() => request.onerror?.());
          return request;
        },
      });

      try {
        await expect(listProjects()).rejects.toThrow(
          error instanceof Error ? error.message : error,
        );
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("orders projects by most-recently-updated first", async () => {
    await saveProject(
      buildProjectRecord({ id: "old", name: "Old", now: "2026-06-01T00:00:00Z", options: DEFAULT_BROWSER_OPTIONS, rawFiles: [], supportFiles: {}, includeFiles: false }),
    );
    await saveProject(
      buildProjectRecord({ id: "new", name: "New", now: "2026-06-03T00:00:00Z", options: DEFAULT_BROWSER_OPTIONS, rawFiles: [], supportFiles: {}, includeFiles: false }),
    );
    expect((await listProjects()).map((p) => p.id)).toEqual(["new", "old"]);
  });
});

/**
 * A project carries a method-profile receipt only while the receipt still
 * satisfies its own bindings against the project's saved options; the gate is
 * `sanitizeMethodProfileReceipt` plus `methodProfileReceiptMatchesOptions` in
 * `src/lib/settingsPersistence.ts`.
 */
describe("method profile receipt on a project", () => {
  beforeEach(async () => {
    await deleteProject("p-receipt");
  });

  it("keeps a runtime-issued diary receipt through save and load", async () => {
    const receipt = await createSleepDiaryMethodProfileReceipt();
    const record = buildProjectRecord({
      id: "p-receipt",
      name: "With receipt",
      now: "2026-06-04T10:00:00Z",
      options: DEFAULT_BROWSER_OPTIONS,
      methodProfileReceipt: receipt,
      rawFiles: [],
      supportFiles: {},
      includeFiles: false,
    });
    expect(record.methodProfileReceipt).toEqual(receipt);
    await saveProject(record);
    await expect(loadProject("p-receipt")).resolves.toMatchObject({
      methodProfileReceipt: receipt,
    });
  });

  it("drops a receipt whose bindings the saved options do not satisfy", async () => {
    const receipt = await createSleepDiaryMethodProfileReceipt();
    const record = buildProjectRecord({
      id: "p-receipt",
      name: "Unsatisfied receipt",
      now: "2026-06-04T10:00:00Z",
      options: DEFAULT_BROWSER_OPTIONS,
      methodProfileReceipt: {
        ...receipt,
        bindings: [
          {
            settingId: receipt.settingIds[0]!,
            slot: "minimum_usage_duration",
            value: 999,
            conformanceFixtureId: "fixture.v1",
            conformanceResultDigest: `sha256:${"a".repeat(64)}`,
          },
        ],
      },
      rawFiles: [],
      supportFiles: {},
      includeFiles: false,
    });
    expect(record.methodProfileReceipt).toBeUndefined();
    await saveProject(record);
    await expect(loadProject("p-receipt")).resolves.toMatchObject({
      methodProfileReceipt: undefined,
    });
  });

  it("returns nothing for a project id the store does not hold", async () => {
    await expect(loadProject("p-absent")).resolves.toBeUndefined();
  });

  it("drops a stored receipt the registries no longer vouch for", async () => {
    const receipt = await createSleepDiaryMethodProfileReceipt();
    await saveProject({
      ...buildProjectRecord({
        id: "p-receipt",
        name: "Forged receipt",
        now: "2026-06-04T10:00:00Z",
        options: DEFAULT_BROWSER_OPTIONS,
        rawFiles: [],
        supportFiles: {},
        includeFiles: false,
      }),
      methodProfileReceipt: { ...receipt, methodProfileId: "forged" },
    });
    await expect(loadProject("p-receipt")).resolves.toMatchObject({
      methodProfileReceipt: undefined,
    });
  });
});
