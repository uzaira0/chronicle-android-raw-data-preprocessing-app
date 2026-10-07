/**
 * OPFS-backed spill storage for the Rust payload store.
 *
 * The runtime keeps only a budgeted share of its row tables resident in WASM
 * memory; the rest is serialized and handed here. Everything lives in one
 * private file per worker, opened through a sync access handle so the Rust
 * side can read and write without yielding. Regions are reused first-fit
 * once their payload is dropped. Worker.terminate() runs no teardown, so a
 * dead worker's file is reclaimed by the stale sweep: once at every boot and
 * again after every file a live worker finishes ({@link PayloadSpill.sweep}).
 */

declare global {
  // Sync access handles are worker-only and absent from lib.dom.
  interface FileSystemSyncAccessHandle {
    read(buffer: ArrayBufferView, options?: { at?: number }): number;
    write(buffer: ArrayBufferView, options?: { at?: number }): number;
    truncate(size: number): void;
    flush(): void;
    close(): void;
  }
  interface FileSystemFileHandle {
    createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
  }
  interface FileSystemDirectoryHandle {
    keys(): AsyncIterableIterator<string>;
  }
}

import { OPFS_PAYLOAD_SPILL_DIRECTORY } from "@/lib/opfsArtifactStore";
import type { PayloadSpillStats } from "@/lib/types";

export type PayloadSpillBridge = {
  put(id: number, bytes: Uint8Array): void;
  get(id: number): Uint8Array;
  remove(id: number): void;
};

type Region = { offset: number; length: number };

const SPILL_DIRECTORY = OPFS_PAYLOAD_SPILL_DIRECTORY;

/**
 * Minimum resident payload budget and the old fixed benchmark budget. The native
 * profile of the 580,793-row export (docs/perf/BASELINE.md) peaks at
 * 2,185 MiB with a 1 GiB budget, 1,607 MiB at 512 MiB and 1,485 MiB at
 * 256 MiB, at 159 / 196 / 238 s; the browser's spill I/O for that file is
 * about 1-3 s in total. Production passes a device-sized threshold during
 * worker initialization; benchmark runs can still pin 512 MiB.
 */
export const PAYLOAD_BUDGET_BYTES = 512 * 1024 * 1024;

export type PayloadSpill = {
  bridge: PayloadSpillBridge;
  /** Cumulative bridge traffic since the handle opened. */
  stats(): PayloadSpillStats;
  /** Remove other workers' spill files that aged past the boot window. */
  sweep(): Promise<void>;
  close(): Promise<void>;
};

/**
 * Field-wise difference of two {@link PayloadSpill.stats} snapshots. The
 * counters run for the worker's lifetime, so per-file traffic is the delta
 * across that file's run, not the reading taken after it.
 */
export function payloadSpillDelta(
  before: PayloadSpillStats,
  after: PayloadSpillStats,
): PayloadSpillStats {
  return {
    puts: after.puts - before.puts,
    gets: after.gets - before.gets,
    putBytes: after.putBytes - before.putBytes,
    getBytes: after.getBytes - before.getBytes,
    putMs: after.putMs - before.putMs,
    getMs: after.getMs - before.getMs,
  };
}

function syncAccessHandlesSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function" &&
    typeof FileSystemFileHandle !== "undefined" &&
    "createSyncAccessHandle" in FileSystemFileHandle.prototype
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Returns null where OPFS sync access handles are unavailable (older Safari,
 * some private modes); the runtime then keeps every payload resident.
 *
 * `onSweepFailure` hears about a stale-file sweep that failed for a reason
 * other than a live worker's lock or a file already gone: those files keep
 * taking storage, and the user is told (the worker forwards it to the page).
 */
export async function openPayloadSpill(
  onSweepFailure?: (message: string) => void,
): Promise<PayloadSpill | null> {
  if (!syncAccessHandlesSupported()) return null;
  let directory: FileSystemDirectoryHandle;
  let handle: FileSystemSyncAccessHandle;
  const name = `${crypto.randomUUID()}.bin`;
  try {
    const root = await navigator.storage.getDirectory();
    directory = await root.getDirectoryHandle(SPILL_DIRECTORY, { create: true });
    const file = await directory.getFileHandle(name, { create: true });
    handle = await file.createSyncAccessHandle();
  } catch {
    // No usable OPFS here (denied, private mode, quota): the runtime keeps
    // every payload resident, exactly as where sync handles do not exist.
    return null;
  }
  const sweepStale = (): Promise<void> =>
    removeStaleSpills(directory, name).catch((error: unknown) => {
      onSweepFailure?.(errorText(error));
    });
  // After the handle is open, so the sweep cannot remove this worker's own file.
  await sweepStale();

  const regions = new Map<number, Region>();
  const free: Region[] = [];
  let end = 0;
  const stats: PayloadSpillStats = {
    puts: 0,
    gets: 0,
    putBytes: 0,
    getBytes: 0,
    putMs: 0,
    getMs: 0,
  };

  const allocate = (length: number): Region => {
    let best: { index: number; region: Region } | undefined;
    for (const [index, candidate] of free.entries()) {
      if (
        candidate.length >= length &&
        (best === undefined || candidate.length < best.region.length)
      ) {
        best = { index, region: candidate };
      }
    }
    if (best !== undefined) {
      const { index, region } = best;
      const remainder = region.length - length;
      if (remainder > 0) {
        free[index] = { offset: region.offset + length, length: remainder };
      } else {
        free.splice(index, 1);
      }
      return { offset: region.offset, length };
    }
    const region = { offset: end, length };
    end += length;
    return region;
  };

  const bridge: PayloadSpillBridge = {
    put(id, bytes) {
      const region = allocate(bytes.byteLength);
      const started = performance.now();
      let written: number;
      try {
        written = handle.write(bytes, { at: region.offset });
      } catch (error) {
        // The reservation would otherwise be lost for the rest of the
        // worker's files.
        free.push(region);
        throw error;
      }
      stats.putMs += performance.now() - started;
      stats.puts += 1;
      stats.putBytes += bytes.byteLength;
      if (written !== bytes.byteLength) {
        free.push(region);
        throw new Error(
          `payload spill wrote ${written} of ${bytes.byteLength} bytes`,
        );
      }
      regions.set(id, region);
    },
    get(id) {
      const region = regions.get(id);
      if (!region) throw new Error(`payload ${id} is not spilled`);
      const bytes = new Uint8Array(region.length);
      const started = performance.now();
      const read = handle.read(bytes, { at: region.offset });
      stats.getMs += performance.now() - started;
      stats.gets += 1;
      stats.getBytes += region.length;
      if (read !== region.length) {
        throw new Error(`payload spill read ${read} of ${region.length} bytes`);
      }
      return bytes;
    },
    remove(id) {
      const region = regions.get(id);
      if (!region) return;
      regions.delete(id);
      if (regions.size === 0) {
        // Every payload of the finished request is gone: give the file's
        // space back now. Worker.terminate() runs no teardown in the worker,
        // so a dead worker's file keeps only what its last request left,
        // and the next worker's stale sweep removes the file itself.
        free.length = 0;
        end = 0;
        try {
          handle.truncate(0);
        } catch {
          // The regions are free either way; the sweep reclaims the file.
        }
        return;
      }
      if (region.offset + region.length === end) {
        end = region.offset;
      } else {
        free.push(region);
      }
    },
  };

  return {
    bridge,
    stats: () => ({ ...stats }),
    async sweep() {
      await sweepStale();
    },
    async close() {
      handle.close();
      try {
        await directory.removeEntry(name);
      } catch {
        // Another open handle or a vanished directory: the next worker's
        // stale sweep retries.
      }
    },
  };
}

const BOOT_WINDOW_MS = 60_000;

/**
 * Spill files of workers that died without closing. A file another live
 * worker still holds open refuses removal, which is the right outcome — but
 * a worker booting right now has created its file and not yet opened its
 * handle, so removal would succeed and leave it with no spill at all. Files
 * younger than the boot window are therefore left alone; a genuinely dead
 * worker's file ages past it and the next boot reclaims it.
 *
 * Rejects when the directory cannot be listed, or (after trying every file)
 * when a file could not be removed for any reason other than a live worker's
 * lock or the file being gone already — the same classification
 * `removePayloadSpillFiles` (lib/localDataReset.ts) uses.
 */
async function removeStaleSpills(
  directory: FileSystemDirectoryHandle,
  keep: string,
): Promise<void> {
  const failures: string[] = [];
  for await (const entry of directory.keys()) {
    if (entry === keep) continue;
    try {
      const file = await directory.getFileHandle(entry);
      if (Date.now() - (await file.getFile()).lastModified < BOOT_WINDOW_MS) {
        continue;
      }
      await directory.removeEntry(entry);
    } catch (error) {
      const kind = error instanceof Error ? error.name : "";
      if (!EXPECTED_REMOVAL_FAILURES.has(kind)) failures.push(errorText(error));
    }
  }
  if (failures.length) {
    throw new Error(
      `${failures.length} leftover spill file${failures.length === 1 ? "" : "s"} could not be removed (${failures[0]})`,
    );
  }
}

/** A live worker's open handle refuses removal; a vanished file is done. */
const EXPECTED_REMOVAL_FAILURES = new Set([
  "NoModificationAllowedError",
  "InvalidModificationError",
  "NotFoundError",
]);
