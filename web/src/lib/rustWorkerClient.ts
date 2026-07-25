import * as Comlink from "comlink";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFiles,
  ProcessedFileResult,
  ProgressEvent,
  RustStageView,
} from "@/lib/types";
import type { ChronicleWorkerApi } from "@/workers/chronicle-worker";
import type { RawFileInspection } from "@/lib/fileInspection";

/**
 * Browser client for the authoritative Rust/WASM worker. This file owns worker
 * lifecycle, transferables, pooling, and fault handling only; it is not a
 * matcher or preprocessing engine.
 */

export type WorkerSpawn = () => {
  api: Comlink.Remote<ChronicleWorkerApi>;
  worker: { terminate: () => void };
  /** Rejects if the worker fails to load or throws uncaught (optional for stubs). */
  fault?: Promise<never>;
};

type WorkerSlot = {
  api: Comlink.Remote<ChronicleWorkerApi>;
  worker: { terminate: () => void };
  fault: Promise<never>;
  busy: boolean;
  /** Set when this slot's worker has faulted; the pool stops handing it out. */
  dead: boolean;
};

/** Never settles — stand-in fault for spawns (e.g. test stubs) that provide none. */
const NEVER_FAULT: Promise<never> = new Promise<never>(() => {});

function spawnWorker(): {
  api: Comlink.Remote<ChronicleWorkerApi>;
  worker: Worker;
  fault: Promise<never>;
} {
  const worker = new Worker(
    new URL("../workers/chronicle-worker.ts", import.meta.url),
    {
      type: "module",
    },
  );
  // A worker that fails to load (e.g. an offline cold start before its chunk is
  // cached) or throws uncaught would otherwise leave every awaited Comlink call
  // hanging forever — a silent stall with no result and no error. Surface it as
  // a loud rejection that the UI shows as a processing error.
  const fault = new Promise<never>((_, reject) => {
    worker.addEventListener("error", (event) => {
      reject(
        new Error(
          `Chronicle worker failed: ${event.message || "could not load the matcher worker"}`,
        ),
      );
    });
    worker.addEventListener("messageerror", () => {
      reject(new Error("Chronicle worker sent an unreadable message."));
    });
  });
  // Keep a handler attached so an un-raced fault never becomes an unhandled
  // rejection on the happy path; racing still observes the same rejection.
  fault.catch(() => {});
  return { api: Comlink.wrap<ChronicleWorkerApi>(worker), worker, fault };
}

type SharedWorker = {
  api: Comlink.Remote<ChronicleWorkerApi>;
  worker: { terminate: () => void };
  fault: Promise<never>;
};
let sharedWorker: SharedWorker | null = null;

function getSharedWorker(): SharedWorker {
  if (!sharedWorker) {
    const { api, worker, fault } = spawnWorker();
    const entry: SharedWorker = { api, worker, fault: fault ?? NEVER_FAULT };
    sharedWorker = entry;
    // If this worker dies, evict it from the singleton (and terminate it) so the
    // NEXT call re-spawns a fresh one instead of bricking the module forever on a
    // one-off crash. A normal processing rejection doesn't reject `fault`, so a
    // healthy worker is never evicted.
    entry.fault.catch(() => {
      if (sharedWorker === entry) sharedWorker = null;
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
    });
  }
  return sharedWorker;
}

/**
 * Run an operation on the shared worker, racing it against the worker's fault so
 * a dead/unloadable worker rejects loudly instead of hanging. On a fault the
 * singleton is evicted (see {@link getSharedWorker}), so a retry re-spawns.
 */
async function onSharedWorker<T>(
  fn: (api: Comlink.Remote<ChronicleWorkerApi>) => Promise<T>,
): Promise<T> {
  const { api, fault } = getSharedWorker();
  return Promise.race([fn(api), fault]);
}

/**
 * Persistent pool of Comlink-wrapped Chronicle workers. Each slot keeps its
 * WASM init and default-codebook fetch warm across many files, replacing the
 * old "fresh worker per file" behavior that hung on large batches.
 */
type WaiterEntry = {
  resolve: (slot: WorkerSlot) => void;
  reject: (error: Error) => void;
};

export class WorkerPool {
  private readonly slots: WorkerSlot[] = [];
  private readonly waiters: WaiterEntry[] = [];
  private terminated = false;

  constructor(size: number, spawn: WorkerSpawn = spawnWorker) {
    const safeSize = Math.max(1, Math.floor(size));
    for (let index = 0; index < safeSize; index += 1) {
      const { api, worker, fault } = spawn();
      const slot: WorkerSlot = {
        api,
        worker,
        fault: fault ?? NEVER_FAULT,
        busy: false,
        dead: false,
      };
      // A faulted worker must not keep getting handed queued work (which would
      // cascade-fail files a healthy slot could have processed). Mark it dead so
      // acquire/release skip it.
      slot.fault.catch(() => {
        slot.dead = true;
      });
      this.slots.push(slot);
    }
  }

  get size(): number {
    return this.slots.length;
  }

  private acquire(): Promise<WorkerSlot> {
    if (this.terminated) {
      return Promise.reject(new Error("Worker pool has been terminated."));
    }
    const idle = this.slots.find((slot) => !slot.busy && !slot.dead);
    if (idle) {
      idle.busy = true;
      return Promise.resolve(idle);
    }
    if (this.slots.every((slot) => slot.dead)) {
      return Promise.reject(new Error("All Chronicle workers have failed."));
    }
    return new Promise<WorkerSlot>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  /** Hand idle live slots to queued waiters; fail waiters only if every slot is dead. */
  private pump(): void {
    while (this.waiters.length) {
      const idle = this.slots.find((slot) => !slot.busy && !slot.dead);
      if (!idle) break;
      idle.busy = true;
      this.waiters.shift()!.resolve(idle);
    }
    if (this.waiters.length && this.slots.every((slot) => slot.dead)) {
      while (this.waiters.length) {
        this.waiters
          .shift()!
          .reject(new Error("All Chronicle workers have failed."));
      }
    }
  }

  private release(slot: WorkerSlot): void {
    slot.busy = false;
    this.pump();
  }

  async submit<T>(
    action: (api: Comlink.Remote<ChronicleWorkerApi>) => Promise<T>,
  ): Promise<T> {
    const slot = await this.acquire();
    try {
      // Race the worker's fault so a dead worker rejects loudly, not silently.
      return await Promise.race([action(slot.api), slot.fault]);
    } finally {
      this.release(slot);
    }
  }

  terminate(): void {
    this.terminated = true;
    while (this.waiters.length) {
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter.reject(new Error("Worker pool has been terminated."));
      }
    }
    this.slots.forEach((slot) => {
      slot.worker.terminate();
    });
    this.slots.length = 0;
  }
}

export async function getRuntimeVersion(): Promise<string> {
  return onSharedWorker((api) => api.runtimeVersion());
}

export async function exportVerifiedWorkspaceClosure(
  workspaceId: string,
): Promise<Uint8Array> {
  return onSharedWorker((api) => api.exportWorkspaceClosure(workspaceId));
}

export async function importVerifiedWorkspaceClosure(
  archive: Uint8Array,
): Promise<{
  workspaceId: string;
  slot: { generation: number; workspaceRootDigest: string };
}> {
  const owned =
    archive.buffer instanceof ArrayBuffer &&
    archive.byteOffset === 0 &&
    archive.byteLength === archive.buffer.byteLength
      ? archive
      : Uint8Array.from(archive);
  return onSharedWorker((api) =>
    api.importWorkspaceClosureArchive(
      Comlink.transfer(owned, [owned.buffer as ArrayBuffer]),
    ),
  );
}

/**
 * Eagerly spawn + initialise the authoritative Rust runtime worker on boot. Two payoffs:
 * the first real run is faster (WASM is already warm), and a single-file run
 * after the network later drops reuses this still-live worker instead of trying
 * to fetch the worker chunk offline. Best-effort; swallows errors.
 */
export async function warmRuntime(): Promise<void> {
  try {
    await getRuntimeVersion();
  } catch {
    /* a real failure will surface when the user actually processes */
  }
}

export async function getPlanStageView(
  options: BrowserProcessingOptions,
): Promise<RustStageView> {
  return onSharedWorker((api) => api.planStageView(options));
}

export async function discoverTimezones(
  csvText: string,
  runtime?: BrowserProcessingRuntime,
): Promise<string[]> {
  // Preserve the injected-runtime parameter for the public browser API and
  // existing deterministic test callers. Timezone discovery itself is now
  // entirely owned by the Rust worker and needs no browser-runtime input.
  void runtime;
  return onSharedWorker((api) => api.discoverTimezones(csvText));
}

export async function discoverTimezonesBytes(
  csvBytes: ArrayBuffer,
  runtime?: BrowserProcessingRuntime,
): Promise<string[]> {
  void runtime;
  return onSharedWorker((api) =>
    api.discoverTimezonesBytes(Comlink.transfer(csvBytes, [csvBytes])),
  );
}

export async function inspectRawCsvBytes(
  fileName: string,
  sizeBytes: number,
  csvBytes: ArrayBuffer,
): Promise<RawFileInspection> {
  return onSharedWorker((api) =>
    api.inspectRawCsvBytes(
      fileName,
      sizeBytes,
      Comlink.transfer(csvBytes, [csvBytes]),
    ),
  );
}

export async function processRawCsv(
  inputFileName: string,
  csvText: string,
  options?: Partial<BrowserProcessingOptions>,
  supportFiles?: BrowserSupportFiles,
  runtime?: BrowserProcessingRuntime,
  onProgress?: (event: ProgressEvent) => void,
): Promise<ProcessedFileResult> {
  return onSharedWorker((api) => {
    if (onProgress) {
      const proxied = Comlink.proxy(onProgress);
      return api.processRawCsvWithProgress(
        inputFileName,
        csvText,
        options,
        supportFiles,
        runtime,
        proxied,
      );
    }
    return api.processRawCsv(
      inputFileName,
      csvText,
      options,
      supportFiles,
      runtime,
    );
  });
}

export async function processRawCsvViaPool(
  pool: WorkerPool,
  inputFileName: string,
  csvText: string,
  options?: Partial<BrowserProcessingOptions>,
  supportFiles?: BrowserSupportFiles,
  runtime?: BrowserProcessingRuntime,
  onProgress?: (event: ProgressEvent) => void,
): Promise<ProcessedFileResult> {
  return pool.submit(async (api) => {
    if (onProgress) {
      const proxied = Comlink.proxy(onProgress);
      return api.processRawCsvWithProgress(
        inputFileName,
        csvText,
        options,
        supportFiles,
        runtime,
        proxied,
      );
    }
    return api.processRawCsv(
      inputFileName,
      csvText,
      options,
      supportFiles,
      runtime,
    );
  });
}

/** Transfer a single raw-file buffer to the long-lived worker without first
 * materializing a UTF-16 string on the main thread. */
export async function processRawCsvBytes(
  inputFileName: string,
  csvBytes: ArrayBuffer,
  options?: Partial<BrowserProcessingOptions>,
  supportFiles?: BrowserSupportFiles,
  runtime?: BrowserProcessingRuntime,
  onProgress?: (event: ProgressEvent) => void,
): Promise<ProcessedFileResult> {
  return onSharedWorker((api) =>
    api.processRawCsvBytes(
      inputFileName,
      Comlink.transfer(csvBytes, [csvBytes]),
      options,
      supportFiles,
      runtime,
      onProgress ? Comlink.proxy(onProgress) : undefined,
    ),
  );
}

/** Execute the authoritative Rust graph but transfer back review metrics only. */
export async function processRawCsvReviewBytes(
  inputFileName: string,
  csvBytes: ArrayBuffer,
  options?: Partial<BrowserProcessingOptions>,
  supportFiles?: BrowserSupportFiles,
  runtime?: BrowserProcessingRuntime,
): Promise<ProcessedFileResult> {
  return onSharedWorker((api) =>
    api.processReviewCsvBytes(
      inputFileName,
      Comlink.transfer(csvBytes, [csvBytes]),
      options,
      supportFiles,
      runtime,
    ),
  );
}

/**
 * Transfer one raw file to a pool slot and compute Arm B. Arm A's review
 * summary and input digest already belong to the completed result, so a fresh
 * comparison worker must not rerun Arm A merely to warm an in-memory cache.
 */
export async function processRawCsvChangedReviewBytesViaPool(
  pool: WorkerPool,
  inputFileName: string,
  csvBytes: ArrayBuffer,
  changedOptions: BrowserProcessingOptions,
  changedSupportFiles?: BrowserSupportFiles,
  runtime?: BrowserProcessingRuntime,
  verifiedInputSha256?: string,
): Promise<ProcessedFileResult> {
  return pool.submit((api) =>
    api.processChangedReviewCsvBytes(
      inputFileName,
      Comlink.transfer(csvBytes, [csvBytes]),
      changedOptions,
      changedSupportFiles,
      runtime,
      verifiedInputSha256,
    ),
  );
}

/**
 * Zero-copy variant: pass the raw bytes (typically `await file.arrayBuffer()`)
 * and ownership transfers to the worker. The main thread no longer holds the
 * file's byte content, halving peak memory under parallel processing of
 * large batches.
 */
export async function processRawCsvBytesViaPool(
  pool: WorkerPool,
  inputFileName: string,
  csvBytes: ArrayBuffer,
  options?: Partial<BrowserProcessingOptions>,
  supportFiles?: BrowserSupportFiles,
  runtime?: BrowserProcessingRuntime,
  onProgress?: (event: ProgressEvent) => void,
): Promise<ProcessedFileResult> {
  return pool.submit(async (api) => {
    const proxied = onProgress ? Comlink.proxy(onProgress) : undefined;
    return api.processRawCsvBytes(
      inputFileName,
      Comlink.transfer(csvBytes, [csvBytes]),
      options,
      supportFiles,
      runtime,
      proxied,
    );
  });
}

/**
 * Backwards-compatible wrapper. Older call sites used `processRawCsvIsolated`
 * which spun up and tore down a fresh worker per call. That pattern caused the
 * 90-file hang. The replacement creates a one-shot pool of size 1 so behavior
 * is preserved for callers that still want a private worker, but typical
 * batches should construct a `WorkerPool` of the right size and call
 * `processRawCsvViaPool` directly.
 */
export async function processRawCsvIsolated(
  inputFileName: string,
  csvText: string,
  options?: Partial<BrowserProcessingOptions>,
  supportFiles?: BrowserSupportFiles,
  runtime?: BrowserProcessingRuntime,
  onProgress?: (event: ProgressEvent) => void,
): Promise<ProcessedFileResult> {
  const pool = new WorkerPool(1);
  try {
    return await processRawCsvViaPool(
      pool,
      inputFileName,
      csvText,
      options,
      supportFiles,
      runtime,
      onProgress,
    );
  } finally {
    pool.terminate();
  }
}
