import * as Comlink from "comlink";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFiles,
  ProcessedFileResult,
  ProgressEvent,
  RustWorkflowExplorerView,
  WorkflowExplorerSupportRole,
} from "@/lib/types";
import type { ChronicleWorkerApi } from "@/workers/chronicle-worker";
import type { OpfsCapability } from "@/lib/opfsArtifactStore";
import type { RawFileInspection } from "@/lib/fileInspection";
export { comparisonSupportCacheKey } from "@/lib/comparisonSupportKey";
import runtimeWasmUrl from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm?url";

/**
 * Browser client for the authoritative Rust/WASM worker. This file owns worker
 * lifecycle, transferables, pooling, and fault handling only; it is not a
 * matcher or preprocessing engine.
 */

export type WorkerSpawn = () => {
  api: Comlink.Remote<ChronicleWorkerApi>;
  worker: { terminate: () => void };
  /** Real workers receive one main-thread-compiled module before work starts. */
  ready?: Promise<void>;
  /** Rejects if the worker fails to load or throws uncaught (optional for stubs). */
  fault?: Promise<never>;
};

type WorkerSlot = {
  api: Comlink.Remote<ChronicleWorkerApi>;
  worker: { terminate: () => void };
  fault: Promise<never>;
  ready: Promise<void>;
  busy: boolean;
  /** Set when this slot's worker has faulted; the pool stops handing it out. */
  dead: boolean;
  /** A healthy slot deliberately retired at its task limit may be replaced. */
  retired: boolean;
  completedTasks: number;
  terminated: boolean;
  /** Last support-cache key confirmed loaded on this worker. */
  lastSupportCacheKey: string | undefined;
  /** SHA-256 of the last reviewed input, for workspace affinity in acquire(). */
  lastInputSha256: string | undefined;
};

/** Never settles — stand-in fault for spawns (e.g. test stubs) that provide none. */
const NEVER_FAULT: Promise<never> = new Promise<never>(() => {});
let compiledRuntimeModule: Promise<WebAssembly.Module> | undefined;

function getCompiledRuntimeModule(): Promise<WebAssembly.Module> {
  compiledRuntimeModule ??= (async () => {
    const response = await fetch(
      new URL(
        runtimeWasmUrl,
        typeof location === "undefined" ? "http://localhost/" : location.href,
      ),
    );
    if (!response.ok) {
      throw new Error(`Could not load the Rust runtime (${response.status}).`);
    }
    if (typeof WebAssembly.compileStreaming === "function") {
      try {
        return await WebAssembly.compileStreaming(response.clone());
      } catch {
        // Development servers with a wrong MIME type still get one compiled
        // module; production serves application/wasm and stays on streaming.
      }
    }
    return WebAssembly.compile(await response.arrayBuffer());
  })();
  return compiledRuntimeModule;
}

function spawnWorker(): {
  api: Comlink.Remote<ChronicleWorkerApi>;
  worker: Worker;
  fault: Promise<never>;
  ready: Promise<void>;
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
  const api = Comlink.wrap<ChronicleWorkerApi>(worker);
  const ready = getCompiledRuntimeModule().then((module) =>
    api.initializeRuntime(module),
  );
  return { api, worker, fault, ready };
}

type SharedWorker = {
  api: Comlink.Remote<ChronicleWorkerApi>;
  worker: { terminate: () => void };
  fault: Promise<never>;
  ready: Promise<void>;
};
let sharedWorker: SharedWorker | null = null;
let sharedWorkerSupportCacheKey: string | undefined;

function getSharedWorker(): SharedWorker {
  if (!sharedWorker) {
    const { api, worker, fault, ready } = spawnWorker();
    const entry: SharedWorker = {
      api,
      worker,
      fault: fault ?? NEVER_FAULT,
      ready: ready ?? Promise.resolve(),
    };
    sharedWorker = entry;
    // If this worker dies, evict it from the singleton (and terminate it) so the
    // NEXT call re-spawns a fresh one instead of bricking the module forever on a
    // one-off crash. A normal processing rejection doesn't reject `fault`, so a
    // healthy worker is never evicted.
    entry.fault.catch(() => {
      if (sharedWorker === entry) {
        sharedWorker = null;
        sharedWorkerSupportCacheKey = undefined;
      }
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
  const { api, fault, ready } = getSharedWorker();
  await Promise.race([ready, fault]);
  return Promise.race([fn(api), fault]);
}

/**
 * Pool of Comlink-wrapped Chronicle workers. Slots are normally long-lived,
 * but callers processing large full exports can set a task limit so a worker's
 * non-shrinking WASM memory is released before the slot accepts another file.
 */
type WaiterEntry = {
  resolve: (slot: WorkerSlot) => void;
  reject: (error: Error) => void;
};

export type WorkerPoolOptions = {
  spawn?: WorkerSpawn;
  /** Retire and replace a healthy slot after this many settled tasks. */
  maxTasksPerWorker?: number;
};

export class WorkerPool {
  private readonly slots: WorkerSlot[] = [];
  private readonly waiters: WaiterEntry[] = [];
  private readonly spawn: WorkerSpawn;
  private readonly maxTasksPerWorker: number;
  private terminated = false;
  /**
   * Rejects the moment {@link terminate} is called. Every submission races it in
   * {@link runOnSlot}, because `Worker.terminate()` does NOT settle the Comlink
   * RPC promises already awaiting a reply from that worker: the worker simply
   * stops, no message ever comes back, and `onerror`/`onmessageerror` (which is
   * all `slot.fault` watches) never fires. Without this, cancelling a batch left
   * the caller's `await` pending forever — the run's `Promise.all` never
   * resolved and the UI stayed wedged on "Processing…" with no way out. That is
   * exactly the half-finished state cancellation exists to prevent, and
   * `App.tsx`'s runner already documents the opposite contract ("a terminate()
   * during cancel rejects the in-flight file").
   *
   * It is deliberately pool-scoped and created in the constructor rather than
   * being a per-slot hook installed by `runOnSlot`. `submit()` reaches
   * `runOnSlot` only after `await this.acquire()` yields a microtask, so a
   * `submit()` immediately followed by `terminate()` in the SAME synchronous
   * turn lands while no per-slot hook exists yet: `terminate()` would find
   * nothing to fire, empty `this.slots`, and the resumed continuation would then
   * await an RPC to an already-dead worker with no abort in the race at all.
   * A promise that exists for the pool's whole life cannot miss that window.
   */
  private readonly aborted: Promise<never>;
  private abort: () => void = () => {};

  constructor(
    size: number,
    spawnOrOptions: WorkerSpawn | WorkerPoolOptions = spawnWorker,
  ) {
    this.aborted = new Promise<never>((_, reject) => {
      this.abort = () =>
        reject(new Error("Worker pool has been terminated."));
    });
    // Pre-handle so an un-raced abort (a pool terminated with nothing in
    // flight) never surfaces as an unhandled rejection; racing still observes
    // the same rejection.
    this.aborted.catch(() => {});
    const options: WorkerPoolOptions =
      typeof spawnOrOptions === "function"
        ? { spawn: spawnOrOptions }
        : spawnOrOptions;
    this.spawn = options.spawn ?? spawnWorker;
    const taskLimit = options.maxTasksPerWorker;
    this.maxTasksPerWorker =
      typeof taskLimit === "number" && Number.isFinite(taskLimit)
        ? Math.max(1, Math.floor(taskLimit))
        : Number.POSITIVE_INFINITY;
    const safeSize = Math.max(1, Math.floor(size));
    for (let index = 0; index < safeSize; index += 1) {
      const slot = this.createSlot();
      this.slots.push(slot);
      this.watchSlot(slot);
    }
  }

  get size(): number {
    return this.slots.length;
  }

  private createSlot(): WorkerSlot {
    const { api, worker, fault, ready } = this.spawn();
    return {
      api,
      worker,
      fault: fault ?? NEVER_FAULT,
      ready: ready ?? Promise.resolve(),
      busy: false,
      dead: false,
      retired: false,
      completedTasks: 0,
      terminated: false,
      lastSupportCacheKey: undefined,
      lastInputSha256: undefined,
    };
  }

  private watchSlot(slot: WorkerSlot): void {
    const markDead = (): void => {
      slot.dead = true;
      this.pump();
    };
    // A faulted or uninitializable worker must never receive another task.
    slot.fault.catch(markDead);
    slot.ready.catch(markDead);
  }

  private terminateSlot(slot: WorkerSlot): boolean {
    if (slot.terminated) return true;
    try {
      slot.worker.terminate();
      slot.terminated = true;
      return true;
    } catch {
      slot.dead = true;
      return false;
    }
  }

  private replaceSlot(slot: WorkerSlot): WorkerSlot | undefined {
    const index = this.slots.indexOf(slot);
    if (
      this.terminated ||
      index < 0 ||
      slot.busy ||
      !slot.retired
    )
      return undefined;
    if (!this.terminateSlot(slot)) return undefined;
    try {
      const replacement = this.createSlot();
      this.slots[index] = replacement;
      this.watchSlot(replacement);
      return replacement;
    } catch {
      slot.dead = true;
      return undefined;
    }
  }

  private acquire(preferSha256?: string): Promise<WorkerSlot> {
    if (this.terminated) {
      return Promise.reject(new Error("Worker pool has been terminated."));
    }
    let idle: WorkerSlot | undefined;
    if (preferSha256) {
      idle = this.slots.find(
        (slot) =>
          !slot.busy && !slot.dead && slot.lastInputSha256 === preferSha256,
      );
    }
    idle ??= this.slots.find((slot) => !slot.busy && !slot.dead);
    if (!idle) {
      const retired = this.slots.find((slot) => !slot.busy && slot.retired);
      if (retired) idle = this.replaceSlot(retired);
    }
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
      let idle = this.slots.find((slot) => !slot.busy && !slot.dead);
      if (!idle) {
        const retired = this.slots.find((slot) => !slot.busy && slot.retired);
        if (retired) idle = this.replaceSlot(retired);
      }
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
    if (this.terminated || !this.slots.includes(slot)) return;
    slot.busy = false;
    slot.completedTasks += 1;
    if (!slot.dead && slot.completedTasks >= this.maxTasksPerWorker) {
      slot.dead = true;
      slot.retired = true;
      // Retire now, but initialize a replacement only when queued work needs
      // it. The old eager path spawned a final unused wave immediately before
      // a batch called terminate().
      this.terminateSlot(slot);
    }
    if (slot.dead && this.waiters.length) {
      this.replaceSlot(slot);
    }
    this.pump();
  }

  /**
   * Run one submission on an acquired slot, racing the worker's fault AND the
   * pool-wide {@link aborted} that `terminate()` fires. Terminating a worker
   * mid-call produces no error event and no Comlink reply, so that abort is the
   * only thing that settles the promise — without it a cancelled batch waits
   * forever.
   */
  private async runOnSlot<T>(
    slot: WorkerSlot,
    body: () => Promise<T>,
  ): Promise<T> {
    try {
      return await Promise.race([body(), slot.fault, this.aborted]);
    } finally {
      this.release(slot);
    }
  }

  async submit<T>(
    action: (api: Comlink.Remote<ChronicleWorkerApi>) => Promise<T>,
    preferSha256?: string,
  ): Promise<T> {
    const slot = await this.acquire(preferSha256);
    return this.runOnSlot(slot, async () => {
      // Race the worker's fault so a dead worker rejects loudly, not silently.
      await Promise.race([slot.ready, slot.fault]);
      if (preferSha256) slot.lastInputSha256 = preferSha256;
      return action(slot.api);
    });
  }

  async submitWithSupportCache<T>(
    supportCacheKey: string,
    setup: (api: Comlink.Remote<ChronicleWorkerApi>) => Promise<unknown>,
    action: (api: Comlink.Remote<ChronicleWorkerApi>) => Promise<T>,
    inputSha256?: string,
  ): Promise<T> {
    const slot = await this.acquire(inputSha256);
    return this.runOnSlot(slot, async () => {
      await Promise.race([slot.ready, slot.fault]);
      if (slot.lastSupportCacheKey !== supportCacheKey) {
        await Promise.race([setup(slot.api), slot.fault]);
        slot.lastSupportCacheKey = supportCacheKey;
      }
      if (inputSha256) slot.lastInputSha256 = inputSha256;
      return action(slot.api);
    });
  }

  async setComparisonCacheCapacity(capacity: number): Promise<void> {
    await Promise.all(
      this.slots
        .filter((slot) => !slot.dead && !slot.terminated)
        .map((slot) =>
          slot.ready.then(() => slot.api.setComparisonCacheCapacity(capacity)),
        ),
    );
  }

  terminate(): void {
    this.terminated = true;
    // Settle every submission FIRST — before killing the workers that owe them a
    // reply — so a cancel unwinds the batch instead of wedging it. One pool-wide
    // rejection covers all of them, including a submission still suspended in
    // `await this.acquire()` that has not reached `runOnSlot` yet.
    this.abort();
    while (this.waiters.length) {
      this.waiters
        .shift()!
        .reject(new Error("Worker pool has been terminated."));
    }
    this.slots.forEach((slot) => {
      this.terminateSlot(slot);
    });
    this.slots.length = 0;
  }
}

export async function getRuntimeVersion(): Promise<string> {
  return onSharedWorker((api) => api.runtimeVersion());
}

/**
 * Fail-closed durable-storage gate, evaluated in the worker that owns every
 * production OPFS write. An unreachable worker is itself a hard stop: there is
 * no other path that can persist a verified workspace, so it is reported as an
 * unavailable capability rather than thrown into a caller that might continue.
 */
export async function probeWorkerWorkspaceCapability(): Promise<OpfsCapability> {
  try {
    // Explicit type argument: Comlink's Remote<> distributes over the
    // ready/unavailable union, so inference would otherwise fix T to the
    // "ready" arm alone and reject the failure arm the gate depends on.
    return await onSharedWorker<OpfsCapability>((api) =>
      api.probeWorkspaceCapability(),
    );
  } catch (error) {
    return {
      status: "unavailable",
      reason: `The processing worker that owns durable storage could not be reached: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Both directions move the archive as a Blob. Structured cloning a Blob copies
 * a handle to browser-managed storage, not the bytes, so a multi-hundred-MB
 * backup never has to exist as a contiguous buffer on either side of the worker
 * boundary — which is exactly what the picked `File` already is on import.
 */
export async function exportVerifiedWorkspaceClosure(
  workspaceId: string,
): Promise<Blob> {
  return onSharedWorker((api) => api.exportWorkspaceClosure(workspaceId));
}

export async function importVerifiedWorkspaceClosure(archive: Blob): Promise<{
  workspaceId: string;
  slot: { generation: number; workspaceRootDigest: string };
}> {
  return onSharedWorker((api) => api.importWorkspaceClosureArchive(archive));
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

export async function getWorkflowExplorerView(
  options: BrowserProcessingOptions,
  supportRoles: WorkflowExplorerSupportRole[] = [],
): Promise<RustWorkflowExplorerView> {
  return onSharedWorker((api) => api.workflowExplorerView(options, supportRoles));
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
  verifiedInputSha256?: string,
): Promise<RawFileInspection> {
  return onSharedWorker((api) =>
    api.inspectRawCsvBytes(
      fileName,
      sizeBytes,
      Comlink.transfer(csvBytes, [csvBytes]),
      verifiedInputSha256,
    ),
  );
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
  verifiedInputSha256?: string,
): Promise<ProcessedFileResult> {
  return onSharedWorker((api) =>
    api.processRawCsvBytes(
      inputFileName,
      Comlink.transfer(csvBytes, [csvBytes]),
      options,
      supportFiles,
      runtime,
      onProgress ? Comlink.proxy(onProgress) : undefined,
      verifiedInputSha256,
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
  verifiedInputSha256?: string,
): Promise<ProcessedFileResult> {
  return onSharedWorker((api) =>
    api.processReviewCsvBytes(
      inputFileName,
      Comlink.transfer(csvBytes, [csvBytes]),
      options,
      supportFiles,
      runtime,
      verifiedInputSha256,
    ),
  );
}

/** Try verified OPFS review bases without reading the raw browser File. */
export async function processPersistedReview(
  inputFileName: string,
  inputSizeBytes: number,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime | undefined,
  verifiedInputSha256: string,
): Promise<ProcessedFileResult | null> {
  return onSharedWorker((api) =>
    api.processPersistedReview(
      inputFileName,
      inputSizeBytes,
      options,
      supportFiles,
      runtime,
      verifiedInputSha256,
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
  return pool.submit(
    (api) =>
      api.processReviewCsvBytes(
        inputFileName,
        Comlink.transfer(csvBytes, [csvBytes]),
        changedOptions,
        changedSupportFiles,
        runtime,
        verifiedInputSha256,
      ),
    verifiedInputSha256,
  );
}

/** Pool variant of the metadata-first persisted review probe. */
/**
 * Keep one comparison file on one worker while trying OPFS and, only on a
 * verified miss, falling back to its raw bytes. Releasing the slot between the
 * two attempts could move the fallback to another worker and repeat WASM and
 * support-file setup.
 */
/**
 * Recent review summaries the main thread received per verified input digest.
 * The digests ride each review request as `knownReviewSummaryDigests`; when
 * the recomputed summary matches any of them, the runtime ships no artifact
 * bytes and the cached copy is reattached here (ETag semantics for the 2+ MB
 * summary). A small per-input LRU rather than a single entry because the
 * comparison loop toggles settings A -> B -> A; with one slot the digest on
 * file is always the one just replaced.
 */
const REVIEW_SUMMARY_REUSE_LRU_CAPACITY = 8;
const reviewSummaryReuseCache = new Map<string, Map<string, Uint8Array>>();

export function clearReviewSummaryReuseCache(): void {
  reviewSummaryReuseCache.clear();
}

function knownReviewSummaryDigestsFor(
  verifiedInputSha256: string,
): string[] | undefined {
  const lru = reviewSummaryReuseCache.get(verifiedInputSha256);
  if (!lru?.size) return undefined;
  return [...lru.keys()];
}

function applyReviewSummaryReuse(
  verifiedInputSha256: string,
  result: ProcessedFileResult,
): ProcessedFileResult {
  const lru = reviewSummaryReuseCache.get(verifiedInputSha256);
  const digest = result.rustReviewReceipt?.reviewSummaryDigest;
  if (result.reviewSummaryReused) {
    const cachedBytes = digest ? lru?.get(digest) : undefined;
    if (!cachedBytes || !digest) {
      throw new Error(
        "runtime reused a review summary the client no longer holds",
      );
    }
    // Refresh LRU position: delete + set moves the digest to newest.
    lru!.delete(digest);
    lru!.set(digest, cachedBytes);
    result.reviewSummaryJsonBytes = cachedBytes;
  } else if (result.reviewSummaryJsonBytes && digest) {
    let target = lru;
    if (!target) {
      target = new Map();
      reviewSummaryReuseCache.set(verifiedInputSha256, target);
    }
    target.delete(digest);
    target.set(digest, result.reviewSummaryJsonBytes);
    while (target.size > REVIEW_SUMMARY_REUSE_LRU_CAPACITY) {
      target.delete(target.keys().next().value!);
    }
  }
  return result;
}

export async function processPersistedOrRawChangedReviewViaPool(
  pool: WorkerPool,
  inputFileName: string,
  inputSizeBytes: number,
  loadCsvBytes: () => Promise<ArrayBuffer>,
  changedOptions: BrowserProcessingOptions,
  changedSupportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime | undefined,
  verifiedInputSha256: string,
  supportCacheKey?: string,
): Promise<ProcessedFileResult> {
  const knownReviewSummaryDigests =
    knownReviewSummaryDigestsFor(verifiedInputSha256);
  const action = async (
    api: Comlink.Remote<ChronicleWorkerApi>,
  ): Promise<ProcessedFileResult> => {
    const persisted = await api.processPersistedReview(
      inputFileName,
      inputSizeBytes,
      changedOptions,
      supportCacheKey ? undefined : changedSupportFiles,
      runtime,
      verifiedInputSha256,
      supportCacheKey,
      knownReviewSummaryDigests,
    );
    if (persisted) return applyReviewSummaryReuse(verifiedInputSha256, persisted);
    const csvBytes = await loadCsvBytes();
    return applyReviewSummaryReuse(
      verifiedInputSha256,
      await api.processReviewCsvBytes(
        inputFileName,
        Comlink.transfer(csvBytes, [csvBytes]),
        changedOptions,
        supportCacheKey ? undefined : changedSupportFiles,
        runtime,
        verifiedInputSha256,
        supportCacheKey,
        knownReviewSummaryDigests,
      ),
    );
  };
  if (!supportCacheKey) return pool.submit(action);
  return pool.submitWithSupportCache(
    supportCacheKey,
    (api) =>
      api.cacheComparisonSupportFiles(
        supportCacheKey,
        changedSupportFiles ?? {},
      ),
    action,
    verifiedInputSha256,
  );
}

/**
 * Selected-file comparison on the long-lived worker. Setup, persisted lookup,
 * and raw fallback stay on one worker so unchanged support bytes cross the
 * main-thread boundary only after a cache miss.
 */
export async function processPersistedOrRawChangedReview(
  inputFileName: string,
  inputSizeBytes: number,
  loadCsvBytes: () => Promise<ArrayBuffer>,
  changedOptions: BrowserProcessingOptions,
  changedSupportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime | undefined,
  verifiedInputSha256: string,
  supportCacheKey: string,
): Promise<ProcessedFileResult> {
  const knownReviewSummaryDigests =
    knownReviewSummaryDigestsFor(verifiedInputSha256);
  return onSharedWorker(async (api) => {
    if (sharedWorkerSupportCacheKey !== supportCacheKey) {
      await api.cacheComparisonSupportFiles(
        supportCacheKey,
        changedSupportFiles ?? {},
      );
      sharedWorkerSupportCacheKey = supportCacheKey;
    }
    const persisted = await api.processPersistedReview(
      inputFileName,
      inputSizeBytes,
      changedOptions,
      undefined,
      runtime,
      verifiedInputSha256,
      supportCacheKey,
      knownReviewSummaryDigests,
    );
    if (persisted) return applyReviewSummaryReuse(verifiedInputSha256, persisted);
    const csvBytes = await loadCsvBytes();
    return applyReviewSummaryReuse(
      verifiedInputSha256,
      await api.processReviewCsvBytes(
        inputFileName,
        Comlink.transfer(csvBytes, [csvBytes]),
        changedOptions,
        undefined,
        runtime,
        verifiedInputSha256,
        supportCacheKey,
        knownReviewSummaryDigests,
      ),
    );
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
  verifiedInputSha256?: string,
): Promise<ProcessedFileResult> {
  return pool.submit(
    async (api) => {
      const proxied = onProgress ? Comlink.proxy(onProgress) : undefined;
      return api.processRawCsvBytes(
        inputFileName,
        Comlink.transfer(csvBytes, [csvBytes]),
        options,
        supportFiles,
        runtime,
        proxied,
        verifiedInputSha256,
      );
    },
    verifiedInputSha256,
  );
}
