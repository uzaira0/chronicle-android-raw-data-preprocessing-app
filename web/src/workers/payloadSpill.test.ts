import { afterEach, expect, test, vi } from "vitest";

import { openPayloadSpill, payloadSpillDelta } from "./payloadSpill";

/** In-memory stand-in for the worker's sync access handle. */
type FakeSpillFile = {
  size: number;
  /** Makes the next write throw, or report one byte short. */
  fault: "throw" | "short" | null;
  read(view: ArrayBufferView, options?: { at?: number }): number;
  write(view: ArrayBufferView, options?: { at?: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
};

function createFakeSpillFile(): FakeSpillFile {
  let data = new Uint8Array(0);
  const grow = (needed: number): void => {
    if (needed <= data.length) return;
    const next = new Uint8Array(needed);
    next.set(data);
    data = next;
  };
  const file: FakeSpillFile = {
    size: 0,
    fault: null,
    read(view, options) {
      const at = options?.at ?? 0;
      const target = new Uint8Array(
        view.buffer,
        view.byteOffset,
        view.byteLength,
      );
      const count = Math.max(0, Math.min(target.length, file.size - at));
      target.set(data.subarray(at, at + count));
      return count;
    },
    write(view, options) {
      const at = options?.at ?? 0;
      const source = new Uint8Array(
        view.buffer,
        view.byteOffset,
        view.byteLength,
      );
      const fault = file.fault;
      file.fault = null;
      if (fault === "throw") {
        throw new DOMException("quota", "QuotaExceededError");
      }
      const count = fault === "short" ? source.length - 1 : source.length;
      grow(at + count);
      data.set(source.subarray(0, count), at);
      file.size = Math.max(file.size, at + count);
      return count;
    },
    truncate(size) {
      grow(size);
      data.fill(0, size);
      file.size = size;
    },
    flush() {},
    close() {},
  };
  return file;
}

/**
 * Minimal OPFS stand-in: one directory of named files with a modification
 * time, where removal succeeds unless the entry is already gone. It models
 * only what openPayloadSpill touches.
 */
function installFakeOpfs(
  files: Map<string, number>,
  faults: { remove?: Map<string, Error>; list?: Error } = {},
): FakeSpillFile {
  const file = createFakeSpillFile();
  const directory = {
    async *keys(): AsyncIterableIterator<string> {
      await Promise.resolve();
      if (faults.list) throw faults.list;
      for (const name of [...files.keys()]) yield name;
    },
    getFileHandle(name: string, options?: { create?: boolean }) {
      if (!files.has(name)) {
        if (!options?.create) {
          return Promise.reject(new DOMException("missing", "NotFoundError"));
        }
        files.set(name, Date.now());
      }
      return Promise.resolve({
        getFile: () => Promise.resolve({ lastModified: files.get(name) ?? 0 }),
        createSyncAccessHandle: () =>
          files.has(name)
            ? Promise.resolve(file)
            : Promise.reject(new DOMException("missing", "NotFoundError")),
      });
    },
    removeEntry(name: string) {
      const fault = faults.remove?.get(name);
      if (fault) return Promise.reject(fault);
      return files.delete(name)
        ? Promise.resolve()
        : Promise.reject(new DOMException("missing", "NotFoundError"));
    },
  };
  vi.stubGlobal("navigator", {
    storage: {
      getDirectory: () =>
        Promise.resolve({
          getDirectoryHandle: () => Promise.resolve(directory),
        }),
    },
  });
  vi.stubGlobal(
    "FileSystemFileHandle",
    class {
      createSyncAccessHandle() {
        return undefined;
      }
    },
  );
  vi.stubGlobal("crypto", { randomUUID: () => "self" });
  return file;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("the stale sweep spares a concurrently booting worker's fresh file", async () => {
  const files = new Map<string, number>([
    // Just created by a worker that has not opened its handle yet, so nothing
    // refuses its removal.
    ["peer.bin", Date.now()],
    // Left behind by a worker that died long ago.
    ["stale.bin", Date.now() - 10 * 60_000],
  ]);
  installFakeOpfs(files);

  const spill = await openPayloadSpill();

  expect(spill).not.toBeNull();
  expect([...files.keys()].sort()).toEqual(["peer.bin", "self.bin"]);
});

test("a later sweep removes a sibling's file once it has aged past the boot window", async () => {
  const files = new Map<string, number>([["peer.bin", Date.now()]]);
  installFakeOpfs(files);
  const spill = await openPayloadSpill();
  expect(spill).not.toBeNull();
  // The boot sweep kept the fresh peer file. The peer then dies without
  // closing, and its file ages past the window before the next file finishes.
  expect([...files.keys()].sort()).toEqual(["peer.bin", "self.bin"]);
  files.set("peer.bin", Date.now() - 10 * 60_000);

  await spill!.sweep();

  expect([...files.keys()]).toEqual(["self.bin"]);
});

test("a sweep is silent about locked or vanished files and reports every other failure", async () => {
  const old = Date.now() - 10 * 60_000;
  const files = new Map<string, number>([
    ["locked.bin", old],
    ["vanished.bin", old],
    ["broken.bin", old],
    ["stale.bin", old],
  ]);
  installFakeOpfs(files, {
    remove: new Map<string, Error>([
      ["locked.bin", new DOMException("held open", "NoModificationAllowedError")],
      ["vanished.bin", new DOMException("gone", "NotFoundError")],
      ["broken.bin", new DOMException("disk failure", "UnknownError")],
    ]),
  });
  const failures: string[] = [];

  const spill = await openPayloadSpill((message) => failures.push(message));

  expect(spill).not.toBeNull();
  // The good stale file is still removed; the sweep tries every file.
  expect(files.has("stale.bin")).toBe(false);
  expect(failures).toEqual(["1 leftover spill file could not be removed (disk failure)"]);

  files.set("other.bin", old);
  await spill!.sweep();
  expect(failures).toHaveLength(2);
});

test("a sweep that cannot list the directory is reported, and the spill still opens", async () => {
  installFakeOpfs(new Map(), { list: new Error("directory unreadable") });
  const failures: string[] = [];
  expect(await openPayloadSpill((message) => failures.push(message))).not.toBeNull();
  expect(failures).toEqual(["directory unreadable"]);
  // Without a listener the failure is still contained.
  await expect(openPayloadSpill()).resolves.not.toBeNull();
});

test("two failed removals are counted, and a non-Error rejection is described", async () => {
  const old = Date.now() - 10 * 60_000;
  installFakeOpfs(new Map([["a.bin", old], ["b.bin", old]]), {
    remove: new Map<string, Error>([
      ["a.bin", new DOMException("first", "UnknownError")],
      ["b.bin", "second" as unknown as Error],
    ]),
  });
  const failures: string[] = [];
  await openPayloadSpill((message) => failures.push(message));
  expect(failures).toEqual(["2 leftover spill files could not be removed (first)"]);
});

test("per-file spill traffic is the delta, not the worker's running total", () => {
  // What the second file of a reused worker sees: the first file already
  // moved every counter.
  const before = {
    puts: 4_000,
    gets: 1_000,
    putBytes: 400_000,
    getBytes: 100_000,
    putMs: 40,
    getMs: 10,
  };
  const after = {
    puts: 8_000,
    gets: 2_500,
    putBytes: 900_000,
    getBytes: 250_000,
    putMs: 90,
    getMs: 25,
  };

  expect(payloadSpillDelta(before, after)).toEqual({
    puts: 4_000,
    gets: 1_500,
    putBytes: 500_000,
    getBytes: 150_000,
    putMs: 50,
    getMs: 15,
  });
});

test("spill offsets round-trip and come back on write failure and on drain", async () => {
  const file = installFakeOpfs(new Map());
  const spill = await openPayloadSpill();
  if (!spill) throw new Error("spill unavailable");
  const { bridge } = spill;

  const first = new Uint8Array([1, 2, 3, 4]);
  const second = new Uint8Array([5, 6, 7, 8, 9, 10, 11, 12]);
  bridge.put(1, first);
  bridge.put(2, second);
  expect(bridge.get(1)).toEqual(first);
  expect(bridge.get(2)).toEqual(second);
  expect(file.size).toBe(12);

  // A throwing write and a short write both hand their reservation back, so
  // the retry reuses that offset instead of growing the file past 14.
  const third = new Uint8Array([13, 14]);
  file.fault = "throw";
  expect(() => bridge.put(3, third)).toThrow();
  file.fault = "short";
  expect(() => bridge.put(3, third)).toThrow(/wrote 1 of 2 bytes/);
  bridge.put(3, third);
  expect(file.size).toBe(14);
  expect(bridge.get(3)).toEqual(third);

  // Dropping a non-tail payload frees its offset for the next put that fits.
  const fourth = new Uint8Array([21, 22, 23, 24]);
  bridge.remove(1);
  bridge.put(4, fourth);
  expect(file.size).toBe(14);
  expect(bridge.get(4)).toEqual(fourth);
  expect(bridge.get(2)).toEqual(second);

  // The file resets only once the last payload is gone.
  bridge.remove(2);
  bridge.remove(3);
  expect(bridge.get(4)).toEqual(fourth);
  bridge.remove(4);
  expect(file.size).toBe(0);
  const fifth = new Uint8Array([31, 32]);
  bridge.put(5, fifth);
  expect(file.size).toBe(2);
  expect(bridge.get(5)).toEqual(fifth);
});
