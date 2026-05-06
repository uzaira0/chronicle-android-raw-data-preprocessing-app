import * as Comlink from "comlink";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFiles,
  ProcessedFileResult,
  ProgressEvent,
} from "@/lib/types";
import type { ChronicleWorkerApi } from "@/workers/chronicle-worker";

export type WorkerSpawn = () => {
  api: Comlink.Remote<ChronicleWorkerApi>;
  worker: { terminate: () => void };
};

type WorkerSlot = {
  api: Comlink.Remote<ChronicleWorkerApi>;
  worker: { terminate: () => void };
  busy: boolean;
};

function spawnWorker(): {
  api: Comlink.Remote<ChronicleWorkerApi>;
  worker: Worker;
} {
  const worker = new Worker(new URL("../workers/chronicle-worker.ts", import.meta.url), {
    type: "module",
  });
  return { api: Comlink.wrap<ChronicleWorkerApi>(worker), worker };
}

let sharedWorkerPromise: Promise<Comlink.Remote<ChronicleWorkerApi>> | null = null;

function getSharedWorkerApi(): Promise<Comlink.Remote<ChronicleWorkerApi>> {
  if (!sharedWorkerPromise) {
    sharedWorkerPromise = Promise.resolve(spawnWorker().api);
  }
  return sharedWorkerPromise;
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
      const { api, worker } = spawn();
      this.slots.push({ api, worker, busy: false });
    }
  }

  get size(): number {
    return this.slots.length;
  }

  private acquire(): Promise<WorkerSlot> {
    if (this.terminated) {
      return Promise.reject(new Error("Worker pool has been terminated."));
    }
    const idle = this.slots.find((slot) => !slot.busy);
    if (idle) {
      idle.busy = true;
      return Promise.resolve(idle);
    }
    return new Promise<WorkerSlot>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  private release(slot: WorkerSlot): void {
    slot.busy = false;
    const next = this.waiters.shift();
    if (next) {
      slot.busy = true;
      next.resolve(slot);
    }
  }

  async submit<T>(action: (api: Comlink.Remote<ChronicleWorkerApi>) => Promise<T>): Promise<T> {
    const slot = await this.acquire();
    try {
      return await action(slot.api);
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

export async function getMatcherVersion(): Promise<string> {
  const api = await getSharedWorkerApi();
  return api.matcherVersion();
}

export async function warmUpWorker(): Promise<void> {
  await getSharedWorkerApi();
}

export async function discoverTimezones(
  csvText: string,
  runtime?: BrowserProcessingRuntime,
): Promise<string[]> {
  const api = await getSharedWorkerApi();
  return api.discoverTimezones(csvText, runtime);
}

export async function processRawCsv(
  inputFileName: string,
  csvText: string,
  options?: Partial<BrowserProcessingOptions>,
  supportFiles?: BrowserSupportFiles,
  runtime?: BrowserProcessingRuntime,
  onProgress?: (event: ProgressEvent) => void,
): Promise<ProcessedFileResult> {
  const api = await getSharedWorkerApi();
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
  return api.processRawCsv(inputFileName, csvText, options, supportFiles, runtime);
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
    return api.processRawCsv(inputFileName, csvText, options, supportFiles, runtime);
  });
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
