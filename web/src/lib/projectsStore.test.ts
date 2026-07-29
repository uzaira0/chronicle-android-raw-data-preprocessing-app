import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  buildProjectRecord,
  deleteProject,
  listProjects,
  loadProject,
  projectByteSize,
  saveProject,
  storedFileToFile,
} from "@/lib/projectsStore";

const file = (name: string, body = "data"): File => new File([body], name, { type: "text/csv" });

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
      supportFiles: { appCodebookFile: file("codebook.csv"), filterFile: null },
      includeFiles: true,
    });
    expect(record.includesFiles).toBe(true);
    expect(record.rawFiles.map((f) => f.name)).toEqual(["Raw P01.csv"]);
    expect(Object.keys(record.supportFiles)).toEqual(["appCodebookFile"]); // null filter skipped
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
      supportFiles: { appCodebookFile: file("codebook.csv", "cb") },
      includeFiles: true,
    });
    await saveProject(record);

    const summaries = await listProjects();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ id: "p1", name: "Resumable", includesFiles: true });
    expect(summaries[0].rawFileNames).toEqual(["Raw P01.csv"]);

    const loaded = await loadProject("p1");
    expect(loaded!.options.studyName).toBe("MyStudy");
    const restored = storedFileToFile(loaded!.rawFiles[0]);
    expect(restored).toBeInstanceOf(File);
    expect(restored.name).toBe("Raw P01.csv");
    expect(await restored.text()).toBe("hello");
    expect(await storedFileToFile(loaded!.supportFiles.appCodebookFile!).text()).toBe("cb");

    await deleteProject("p1");
    expect(await listProjects()).toHaveLength(0);
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
