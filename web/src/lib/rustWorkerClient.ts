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
import type { RegisteredLiteratureComponentExecution } from "@/lib/literatureInputAdapters";
import type { LiteratureComponentRuntimeExecution } from "@/lib/rustPipelineRuntime";
import type { ChronicleWorkerApi } from "@/workers/chronicle-worker";
import type { OpfsCapability } from "@/lib/opfsArtifactStore";
import type { RawFileInspection } from "@/lib/fileInspection";
import type {
  ParticipantPartitionTransport,
  RawFileInspectionBatch,
} from "@/lib/fileInspection";
export { comparisonSupportCacheKey } from "@/lib/comparisonSupportKey";
import runtimeWasmUrl, { packedWasmIdentity } from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm?chronicle-runtime-asset";
import { loadPackedAssetBytes } from "@/lib/packedJsonAsset";
import { requireDefined } from "@/lib/invariant";
import { rehydrateScientificPreflightRefusal } from "@/lib/scientificPreflightTransport";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { requiresLiveScientificPreflight } from "@/lib/inputCapabilityEvidence";
import { adaptiveWorkerBudgetBytes, WORKER_BASELINE_BYTES } from "@/lib/concurrency";
import {
  parseWorkerBackgroundFailure,
  type WorkerBackgroundFailure,
} from "@/lib/workerBackgroundFailure";

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
  wasmMemoryBytes: number;
  /** Last support-cache key confirmed loaded on this worker. */
  lastSupportCacheKey: string | undefined;
  /** SHA-256 of the last reviewed input, for workspace affinity in acquire(). */
  lastInputSha256: string | undefined;
};

/** Never settles — stand-in fault for spawns (e.g. test stubs) that provide none. */
const NEVER_FAULT: Promise<never> = new Promise<never>(() => {});
let compiledRuntimeModule: Promise<WebAssembly.Module> | undefined;

function exactPartitionSecret(
  participantPartition: ParticipantPartitionTransport,
  inspectionBatch: RawFileInspectionBatch | undefined,
): ArrayBuffer {
  if (
    !inspectionBatch ||
    inspectionBatch.participantPartitionBatchId !==
      participantPartition.participantPartitionBatchId ||
    inspectionBatch.secret.byteLength !== 32
  ) {
    throw new Error(
      "Participant partition metadata expired; re-select and re-inspect the raw files.",
    );
  }
  return inspectionBatch.secret.slice().buffer;
}

function activePartitionTransport(
  options: Partial<BrowserProcessingOptions> | undefined,
  participantPartition: ParticipantPartitionTransport | undefined,
  inspectionBatch: RawFileInspectionBatch | undefined,
): {
  partition: ParticipantPartitionTransport | undefined;
  secret: ArrayBuffer | undefined;
} {
  const effectiveOptions = { ...DEFAULT_BROWSER_OPTIONS, ...options };
  if (!requiresLiveScientificPreflight(effectiveOptions)) {
    return { partition: undefined, secret: undefined };
  }
  return participantPartition
    ? {
        partition: participantPartition,
        secret: exactPartitionSecret(participantPartition, inspectionBatch),
      }
    : { partition: undefined, secret: undefined };
}

function wipeTransientSecret(secret: ArrayBuffer | undefined): void {
  if (secret && secret.byteLength > 0) new Uint8Array(secret).fill(0);
}

async function withTransientSecret<T>(
  secret: ArrayBuffer | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } finally {
    // A successful Comlink transfer detaches the buffer (byteLength=0) and the
    // worker owns its wipe. A readiness/fetch/pool fault before transfer leaves
    // it attached here, so the main thread must erase its ephemeral copy.
    wipeTransientSecret(secret);
  }
}

function getCompiledRuntimeModule(): Promise<WebAssembly.Module> {
  if (compiledRuntimeModule) return compiledRuntimeModule;
  const pending = (async () => {
    if (packedWasmIdentity) {
      const bytes = await loadPackedAssetBytes(runtimeWasmUrl, packedWasmIdentity.decodedBytes,
        packedWasmIdentity.decodedSha256, packedWasmIdentity.encodedSha256, packedWasmIdentity.encodedBytes);
      return WebAssembly.compile(new Uint8Array(bytes).buffer);
    }
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
  compiledRuntimeModule = pending;
  // A cold offline fetch or failed compilation is retryable. Keeping the
  // rejected promise would brick every worker spawn for the lifetime of the
  // page even after connectivity recovers.
  pending.catch(() => {
    if (compiledRuntimeModule === pending) compiledRuntimeModule = undefined;
  });
  return pending;
}

const backgroundFailureListeners = new Set<(failure: WorkerBackgroundFailure) => void>();

/**
 * Hear about failures inside any worker that no request is waiting on (see
 * `workerBackgroundFailure.ts`). Returns the unsubscribe.
 */
export function onWorkerBackgroundFailure(
  listener: (failure: WorkerBackgroundFailure) => void,
): () => void {
  backgroundFailureListeners.add(listener);
  return () => {
    backgroundFailureListeners.delete(listener);
  };
}

function spawnWorker(payloadBudgetBytes?: number): {
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
  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const failure = parseWorkerBackgroundFailure(event.data);
    if (failure) for (const listener of backgroundFailureListeners) listener(failure);
  });
  // Module imports may await lossless contract assets before Comlink installs
  // its listener. Sending initializeRuntime early loses that RPC permanently.
  const exposed = new Promise<void>((resolve) => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (data === null || typeof data !== "object" || !("type" in data)
        || data.type !== "chronicle-worker-api-ready/v1") return;
      worker.removeEventListener("message", onMessage);
      resolve();
    };
    worker.addEventListener("message", onMessage);
  });
  const api = Comlink.wrap<ChronicleWorkerApi>(worker);
  const ready = Promise.race([
    Promise.all([getCompiledRuntimeModule(), exposed]).then(([module]) =>
      payloadBudgetBytes === undefined
        ? api.initializeRuntime(module)
        : api.initializeRuntime(module, payloadBudgetBytes),
    ),
    fault,
  ]);
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
    let terminated = false;
    const evict = (): void => {
      if (sharedWorker === entry) {
        sharedWorker = null;
        sharedWorkerSupportCacheKey = undefined;
      }
      if (!terminated) {
        terminated = true;
        try {
          worker.terminate();
        } catch {
          // Terminating a worker that already died can throw; it is gone
          // either way, and the caller is reporting the reason it died.
        }
      }
    };
    entry.fault.catch(evict);
    // Initialization can reject without emitting Worker.error (for example a
    // cold offline WASM fetch or initializeRuntime refusal). Evict that worker
    // too, so the next explicit retry gets a fresh singleton.
    entry.ready.catch(evict);
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
  try {
    return await Promise.race([fn(api), fault]);
  } catch (error) {
    throw rehydrateScientificPreflightRefusal(error);
  }
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
  /** Pin to 512 MiB in tests or benchmarks that compare with the old store. */
  payloadBudgetBytes?: number;
  /** Called once a slot faults or fails initialization. */
  onFault?: () => void;
  /** Retire and replace a healthy slot after this many settled tasks. */
  maxTasksPerWorker?: number;
};

export class WorkerPool {
  private readonly slots: WorkerSlot[] = [];
  private readonly waiters: WaiterEntry[] = [];
  private readonly spawn: WorkerSpawn;
  private readonly onFault: (() => void) | undefined;
  private readonly maxTasksPerWorker: number;
  private terminated = false;
  private retainedMemoryBudgetBytes: number | undefined;
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
  private abort!: () => void;

  constructor(
    size: number,
    spawnOrOptions: WorkerSpawn | WorkerPoolOptions = spawnWorker,
  ) {
    this.aborted = new Promise<never>((_, reject) => {
      this.abort = () => reject(new Error("Worker pool has been terminated."));
    });
    // Pre-handle so an un-raced abort (a pool terminated with nothing in
    // flight) never surfaces as an unhandled rejection; racing still observes
    // the same rejection.
    this.aborted.catch(() => {});
    const options: WorkerPoolOptions =
      typeof spawnOrOptions === "function"
        ? { spawn: spawnOrOptions }
        : spawnOrOptions;
    this.spawn = options.spawn ?? (() => spawnWorker(options.payloadBudgetBytes));
    this.onFault = options.onFault;
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

  /** Whether a later submission can still reach at least one live slot. */
  get usable(): boolean {
    return (
      !this.terminated &&
      this.slots.some((slot) => !slot.dead && !slot.terminated)
    );
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
      wasmMemoryBytes: 0,
      lastSupportCacheKey: undefined,
      lastInputSha256: undefined,
    };
  }

  private watchSlot(slot: WorkerSlot): void {
    const markDead = (): void => {
      if (slot.dead || this.terminated) return;
      slot.dead = true;
      this.onFault?.();
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
    if (this.terminated || index < 0 || slot.busy || !slot.retired)
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
      requireDefined(this.waiters.shift(), "the pump loop runs only while a waiter is queued").resolve(idle);
    }
    if (this.waiters.length && this.slots.every((slot) => slot.dead)) {
      for (let waiter = this.waiters.shift(); waiter !== undefined; waiter = this.waiters.shift()) {
        waiter.reject(new Error("All Chronicle workers have failed."));
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
    this.trimRetainedSlots();
    this.pump();
  }

  /** Account for every live WASM heap, including workers idle between runs. */
  setRetainedMemoryBudget(deviceMemory: number | undefined): void {
    this.retainedMemoryBudgetBytes = adaptiveWorkerBudgetBytes(deviceMemory);
    this.trimRetainedSlots();
  }

  private trimRetainedSlots(): void {
    const budget = this.retainedMemoryBudgetBytes;
    if (budget === undefined || this.terminated) return;
    const retainedBytes = () => this.slots.reduce(
      (sum, slot) => sum +
        (slot.dead || slot.terminated ? 0 : slot.wasmMemoryBytes + WORKER_BASELINE_BYTES),
      0,
    );
    while (retainedBytes() > budget) {
      const liveCount = this.slots.filter(
        (slot) => !slot.dead && !slot.terminated,
      ).length;
      const idle = this.slots
        .filter((slot) => !slot.busy && !slot.dead && !slot.terminated)
        .sort((left, right) => left.wasmMemoryBytes - right.wasmMemoryBytes)[0];
      if (!idle) break;
      if (liveCount === 1) {
        // Even one oversized heap cannot be donated to the next run.
        idle.dead = true;
        idle.retired = true;
        this.terminateSlot(idle);
        break;
      }
      idle.dead = true;
      if (!this.terminateSlot(idle)) break;
      this.slots.splice(this.slots.indexOf(idle), 1);
    }
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
      const result = await Promise.race([body(), slot.fault, this.aborted]);
      const bytes = result && typeof result === "object" &&
        "workerWasmMemoryBytes" in result
        ? result.workerWasmMemoryBytes
        : undefined;
      if (typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0) {
        slot.wasmMemoryBytes = Math.max(slot.wasmMemoryBytes, bytes);
      }
      return result;
    } catch (error) {
      // A rejected task has no heap report. Its WASM memory may have grown
      // before rejection, so a pool that retains workers under a memory
      // budget retires it rather than trim from a stale reading.
      if (!this.terminated && this.retainedMemoryBudgetBytes !== undefined) {
        if (!slot.dead) {
          slot.dead = true;
          slot.retired = true;
        }
        this.terminateSlot(slot);
      }
      throw rehydrateScientificPreflightRefusal(error);
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
    for (let waiter = this.waiters.shift(); waiter !== undefined; waiter = this.waiters.shift()) {
      waiter.reject(new Error("Worker pool has been terminated."));
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

/** Reclaim old objects after the result is visible; the runtime takes the
 * workspace Web Lock before scanning, so a later Process cannot race it. */
export async function garbageCollectWorkspaceAfterResults(
  workspaceId: string,
): Promise<void> {
  await onSharedWorker((api) => api.garbageCollectWorkspace(workspaceId));
}

/**
 * Delete each workspace's persisted OPFS history (root slots and every
 * content-addressed object). Runs in the worker that owns OPFS writes; the
 * runtime takes each workspace's exclusive Web Lock, so it cannot interleave
 * with a run or a garbage-collection scan. Rejects on the first failure so the
 * caller never reports a deletion that did not happen.
 */
export async function deletePersistedWorkspaces(
  workspaceIds: readonly string[],
): Promise<void> {
  for (const workspaceId of new Set(workspaceIds)) {
    await onSharedWorker((api) => api.deleteWorkspace(workspaceId));
  }
}

/**
 * Durable-storage gate, evaluated in the worker that owns every production
 * OPFS write. The result is a CLASSIFIED capability, not a single yes/no: an
 * `unavailable` verdict carries {@link OpfsUnavailableKind} in its optional
 * `kind` field, and the two arms lead to different outcomes —
 * `kind: "unsupported"` (OPFS/Web Locks absent, or the origin refuses a
 * directory at all, as in Safari private browsing) degrades the run to the
 * runtime's non-persisted branch via `workspaceDegradesToEphemeral`, while
 * `kind: "indeterminate"` (exhausted quota, a worker that crashed mid-probe,
 * an unexplained failure) keeps the hard refusal via `workspaceRefusesRun`,
 * because those may succeed on retry and silently downgrading would lose the
 * batch on reload. Both predicates and the classifier live in
 * `lib/opfsArtifactStore.ts`.
 *
 * The catch below is the one producer that CANNOT classify: an unreachable
 * worker says nothing about whether the context can persist. It therefore
 * omits `kind` deliberately, and omission is the conservative arm — an
 * unclassified failure refuses the run rather than degrading it. Returning the
 * capability instead of rethrowing keeps that decision with the gate rather
 * than with a caller that might continue.
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
  expectedWorkspaceRootDigest?: string,
): Promise<Blob> {
  return onSharedWorker((api) => api.exportWorkspaceClosure(workspaceId, expectedWorkspaceRootDigest));
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
  return onSharedWorker((api) =>
    api.workflowExplorerView(options, supportRoles),
  );
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

export async function splitRawCsvByStudy(
  csvBytes: ArrayBuffer,
): Promise<Array<{ studyId: string; bytes: ArrayBuffer }>> {
  return onSharedWorker((api) =>
    api.splitRawCsvByStudy(Comlink.transfer(csvBytes, [csvBytes])),
  );
}

export async function inspectRawCsvBytes(
  fileName: string,
  sizeBytes: number,
  csvBytes: ArrayBuffer,
  verifiedInputSha256?: string,
  participantPartitionBatchId?: string,
): Promise<RawFileInspection> {
  return onSharedWorker((api) =>
    api.inspectRawCsvBytes(
      fileName,
      sizeBytes,
      Comlink.transfer(csvBytes, [csvBytes]),
      verifiedInputSha256,
      participantPartitionBatchId,
    ),
  );
}

/** Transfer the source activity CSV to the worker and run one registered component. */
export async function executeLiteratureComponentBytes(
  registration: RegisteredLiteratureComponentExecution,
  inputFileName: string,
  csvBytes: ArrayBuffer,
  supportFiles: BrowserSupportFiles,
  persistRustWorkspace: boolean,
  verifiedInputSha256?: string,
): Promise<LiteratureComponentRuntimeExecution> {
  return onSharedWorker((api) =>
    api.executeLiteratureComponentBytes(
      registration,
      inputFileName,
      Comlink.transfer(csvBytes, [csvBytes]),
      supportFiles,
      persistRustWorkspace,
      verifiedInputSha256,
    ),
  );
}

export async function beginRawInspectionBatch(
  secretBytes: ArrayBuffer,
): Promise<string> {
  return withTransientSecret(secretBytes, () =>
    onSharedWorker((api) =>
      api.beginRawInspectionBatch(Comlink.transfer(secretBytes, [secretBytes])),
    ),
  );
}

export async function disposeRawInspectionBatch(
  participantPartitionBatchId: string,
): Promise<boolean> {
  return onSharedWorker((api) =>
    api.disposeRawInspectionBatch(participantPartitionBatchId),
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
  participantPartition?: ParticipantPartitionTransport,
  inspectionBatch?: RawFileInspectionBatch,
): Promise<ProcessedFileResult> {
  const active = activePartitionTransport(
    options,
    participantPartition,
    inspectionBatch,
  );
  return withTransientSecret(active.secret, () =>
    onSharedWorker((api) =>
      api.processRawCsvBytes(
        inputFileName,
        Comlink.transfer(csvBytes, [csvBytes]),
        options,
        supportFiles,
        runtime,
        onProgress ? Comlink.proxy(onProgress) : undefined,
        verifiedInputSha256,
        active.partition,
        active.secret
          ? Comlink.transfer(active.secret, [active.secret])
          : undefined,
      ),
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
  participantPartition?: ParticipantPartitionTransport,
  inspectionBatch?: RawFileInspectionBatch,
): Promise<ProcessedFileResult> {
  const active = activePartitionTransport(
    options,
    participantPartition,
    inspectionBatch,
  );
  return withTransientSecret(active.secret, () =>
    onSharedWorker((api) =>
      api.processReviewCsvBytes(
        inputFileName,
        Comlink.transfer(csvBytes, [csvBytes]),
        options,
        supportFiles,
        runtime,
        verifiedInputSha256,
        undefined,
        undefined,
        active.partition,
        active.secret
          ? Comlink.transfer(active.secret, [active.secret])
          : undefined,
      ),
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
  participantPartition?: ParticipantPartitionTransport,
  inspectionBatch?: RawFileInspectionBatch,
): Promise<ProcessedFileResult> {
  const active = activePartitionTransport(
    changedOptions,
    participantPartition,
    inspectionBatch,
  );
  return withTransientSecret(active.secret, () =>
    pool.submit(
      (api) =>
        api.processReviewCsvBytes(
          inputFileName,
          Comlink.transfer(csvBytes, [csvBytes]),
          changedOptions,
          changedSupportFiles,
          runtime,
          verifiedInputSha256,
          undefined,
          undefined,
          active.partition,
          active.secret
            ? Comlink.transfer(active.secret, [active.secret])
            : undefined,
        ),
      verifiedInputSha256,
    ),
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
/**
 * Whole-cache ceiling on retained summary bytes, evicting whole
 * least-recently-touched inputs.
 *
 * The outer map needs a bound of its own: the post-run pre-warm in `App.tsx`
 * submits EVERY unique input digest of the batch through the comparison pool,
 * so with only the per-input cap a 124-file study batch retains up to
 * 124 x {@link REVIEW_SUMMARY_REUSE_LRU_CAPACITY} multi-MB summaries on the
 * main thread for the life of the tab (~2 GB at the 2 MB size this cache's
 * ETag comment cites).
 *
 * The number is derived from the comparison path's own memory design rather
 * than picked: `lib/concurrency.ts` sizes that pool at
 * `COMPARISON_WORKER_LIMIT - 1` = 7 warm review workers measured at
 * `WARM_REVIEW_WORKER_BYTES` (38 MB) + `WORKER_BASELINE_BYTES` (48 MB) each —
 * about 600 MB of worker heap that this cache exists to keep busy. Holding the
 * main-thread copy to 256 MB keeps a saving mechanism strictly cheaper than the
 * pool it serves while still covering a ~120-summary working set. Past the
 * ceiling the least-recently-touched input is dropped and its next review
 * recomputes and ships bytes — exactly what every input did before this cache
 * existed, so exceeding the bound costs wall-clock, never correctness.
 *
 * Two documented loosenesses of the bound, both transient and both bounded:
 * an in-flight offer pins its snapshot by strong reference, so while a
 * pre-warm sweep re-admits a second generation the true main-thread retention
 * can reach roughly twice the ceiling until those requests settle; and a
 * single input whose own {@link REVIEW_SUMMARY_REUSE_LRU_CAPACITY}-entry LRU
 * alone exceeds the ceiling is never evicted while it is the one being
 * touched, so the real invariant is "budget + one input's LRU", self-healing
 * on the next admit for a different input.
 */
const REVIEW_SUMMARY_REUSE_BUDGET_BYTES = 256 * 1024 * 1024;
/** One cached summary plus the size it was ADMITTED at. Eviction and refresh
 * subtract the stored size, never the live `byteLength`: a buffer detached
 * after admission reads 0 and would otherwise leak its bytes into the counter
 * forever. */
type ReviewSummaryEntry = { bytes: Uint8Array; size: number };
const reviewSummaryReuseCache = new Map<
  string,
  Map<string, ReviewSummaryEntry>
>();
let reviewSummaryReuseBytes = 0;
let reviewSummaryReuseBudgetBytes = REVIEW_SUMMARY_REUSE_BUDGET_BYTES;

export function clearReviewSummaryReuseCache(): void {
  reviewSummaryReuseCache.clear();
  reviewSummaryReuseBytes = 0;
}

/** Retained bytes, so the bound is asserted against the real accounting rather
 * than against a proxy for it. */
export function reviewSummaryReuseRetainedBytes(): number {
  return reviewSummaryReuseBytes;
}

/**
 * Lower the byte ceiling so the outer-map eviction path is exercised without a
 * unit test allocating a quarter of a gigabyte. Production never calls this;
 * a non-positive value restores {@link REVIEW_SUMMARY_REUSE_BUDGET_BYTES}.
 */
export function setReviewSummaryReuseBudgetBytesForTesting(
  bytes: number,
): void {
  reviewSummaryReuseBudgetBytes =
    bytes > 0 ? bytes : REVIEW_SUMMARY_REUSE_BUDGET_BYTES;
}

/**
 * The digests one in-flight request advertised, together with the byte buffers
 * they promised. The pinned buffers are the same objects the LRU holds, kept
 * alive by reference for the life of the request: a concurrent request for the
 * same input can evict any of them between the moment the digests are sent and
 * the moment the runtime answers "reused", and that must degrade to serving the
 * pinned copy (and re-admitting it), never to failing a valid review.
 */
type ReviewSummaryOffer = {
  digests: string[] | undefined;
  pinned: ReadonlyMap<string, Uint8Array>;
};

const EMPTY_REVIEW_SUMMARY_OFFER: ReviewSummaryOffer = {
  digests: undefined,
  pinned: new Map(),
};

/** Remove entries whose buffer was detached after admission (live
 * `byteLength` 0), subtracting the size they were admitted at. A digest that
 * is never advertised cannot come back as "reused", so the runtime recomputes
 * and ships bytes — the graceful arm, instead of promising bytes the client
 * can no longer hand over. */
function purgeDetachedReviewSummaries(
  verifiedInputSha256: string,
  lru: Map<string, ReviewSummaryEntry>,
): void {
  for (const [digest, entry] of lru) {
    if (entry.bytes.byteLength !== 0) continue;
    reviewSummaryReuseBytes -= entry.size;
    lru.delete(digest);
  }
  if (!lru.size) reviewSummaryReuseCache.delete(verifiedInputSha256);
}

function offerReviewSummaryDigests(
  verifiedInputSha256: string,
): ReviewSummaryOffer {
  const lru = reviewSummaryReuseCache.get(verifiedInputSha256);
  if (!lru?.size) return EMPTY_REVIEW_SUMMARY_OFFER;
  purgeDetachedReviewSummaries(verifiedInputSha256, lru);
  if (!lru.size) return EMPTY_REVIEW_SUMMARY_OFFER;
  const pinned = new Map<string, Uint8Array>();
  for (const [digest, entry] of lru) pinned.set(digest, entry.bytes);
  return { digests: [...pinned.keys()], pinned };
}

/** Drop whole least-recently-touched inputs until the cache is inside its byte
 * ceiling. The input just touched is never the one dropped; its own per-input
 * cap already bounds it. */
function enforceReviewSummaryReuseBudget(currentInput: string): void {
  for (const [input, lru] of reviewSummaryReuseCache) {
    if (reviewSummaryReuseBytes <= reviewSummaryReuseBudgetBytes) return;
    if (input === currentInput) continue;
    for (const entry of lru.values()) {
      reviewSummaryReuseBytes -= entry.size;
    }
    reviewSummaryReuseCache.delete(input);
  }
}

/** Insert (or refresh) one summary as newest for its input, apply both bounds,
 * and move the input itself to newest in the outer LRU. */
function admitReviewSummary(
  verifiedInputSha256: string,
  digest: string,
  bytes: Uint8Array,
): void {
  let target = reviewSummaryReuseCache.get(verifiedInputSha256);
  if (!target) {
    target = new Map();
    reviewSummaryReuseCache.set(verifiedInputSha256, target);
  }
  const existing = target.get(digest);
  if (existing) reviewSummaryReuseBytes -= existing.size;
  // Refresh LRU position: delete + set moves the digest to newest.
  target.delete(digest);
  target.set(digest, { bytes, size: bytes.byteLength });
  reviewSummaryReuseBytes += bytes.byteLength;
  while (target.size > REVIEW_SUMMARY_REUSE_LRU_CAPACITY) {
    const [oldest, entry] = requireDefined(
      target.entries().next().value,
      "a map holding more entries than the LRU capacity has an oldest entry",
    );
    reviewSummaryReuseBytes -= entry.size;
    target.delete(oldest);
  }
  reviewSummaryReuseCache.delete(verifiedInputSha256);
  reviewSummaryReuseCache.set(verifiedInputSha256, target);
  enforceReviewSummaryReuseBudget(verifiedInputSha256);
}

function applyReviewSummaryReuse(
  verifiedInputSha256: string,
  offer: ReviewSummaryOffer,
  result: ProcessedFileResult,
): ProcessedFileResult {
  const digest = result.rustReviewReceipt?.reviewSummaryDigest;
  if (result.reviewSummaryReused) {
    const lru = reviewSummaryReuseCache.get(verifiedInputSha256);
    // The offer is authoritative for what this request promised to honour; the
    // live LRU is only a fallback for a digest admitted after the offer.
    const cachedBytes = digest
      ? (offer.pinned.get(digest) ?? lru?.get(digest)?.bytes)
      : undefined;
    if (!digest || !cachedBytes) {
      throw new Error(
        "runtime reused a review summary the client no longer holds",
      );
    }
    if (cachedBytes.byteLength === 0) {
      // Presence is not possession: a transferred (detached) buffer is still a
      // truthy Uint8Array, and reattaching it would publish an empty summary.
      // Purge the dead entry first so the next offer stops advertising it and
      // the input recovers via the raw path instead of repeating this refusal.
      if (lru) purgeDetachedReviewSummaries(verifiedInputSha256, lru);
      throw new Error(
        "runtime reused a review summary whose cached bytes were released",
      );
    }
    admitReviewSummary(verifiedInputSha256, digest, cachedBytes);
    result.reviewSummaryJsonBytes = cachedBytes;
  } else if (result.reviewSummaryJsonBytes?.byteLength && digest) {
    admitReviewSummary(
      verifiedInputSha256,
      digest,
      result.reviewSummaryJsonBytes,
    );
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
  participantPartition?: ParticipantPartitionTransport,
  inspectionBatch?: RawFileInspectionBatch,
): Promise<ProcessedFileResult> {
  // Own the transient copy for the entire pool submission. Creating it only
  // after an awaited raw load lets pool termination win first, then leaves a
  // new secret posted to a dead worker whose RPC/finally never settles.
  const active = activePartitionTransport(
    changedOptions,
    participantPartition,
    inspectionBatch,
  );
  const action = async (
    api: Comlink.Remote<ChronicleWorkerApi>,
  ): Promise<ProcessedFileResult> => {
    // Snapshot the offer only once a pool slot is granted: a pre-warm sweep
    // maps every unique input into this function in one synchronous pass, so
    // an offer taken before submission would pin buffers for the whole queue
    // wait across ALL queued inputs at once. Inside the slot the pin is
    // bounded by in-flight requests, and the snapshot is fresher — it sees
    // digests admitted while this request was queued.
    const offer = offerReviewSummaryDigests(verifiedInputSha256);
    const knownReviewSummaryDigests = offer.digests;
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
    if (persisted)
      return applyReviewSummaryReuse(verifiedInputSha256, offer, persisted);
    const csvBytes = await loadCsvBytes();
    return applyReviewSummaryReuse(
      verifiedInputSha256,
      offer,
      await api.processReviewCsvBytes(
        inputFileName,
        Comlink.transfer(csvBytes, [csvBytes]),
        changedOptions,
        supportCacheKey ? undefined : changedSupportFiles,
        runtime,
        verifiedInputSha256,
        supportCacheKey,
        knownReviewSummaryDigests,
        active.partition,
        active.secret
          ? Comlink.transfer(active.secret, [active.secret])
          : undefined,
      ),
    );
  };
  return withTransientSecret(active.secret, () =>
    !supportCacheKey
      ? pool.submit(action)
      : pool.submitWithSupportCache(
          supportCacheKey,
          (api) =>
            api.cacheComparisonSupportFiles(
              supportCacheKey,
              changedSupportFiles ?? {},
            ),
          action,
          verifiedInputSha256,
        ),
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
  participantPartition?: ParticipantPartitionTransport,
  inspectionBatch?: RawFileInspectionBatch,
): Promise<ProcessedFileResult> {
  const offer = offerReviewSummaryDigests(verifiedInputSha256);
  const knownReviewSummaryDigests = offer.digests;
  const active = activePartitionTransport(
    changedOptions,
    participantPartition,
    inspectionBatch,
  );
  return withTransientSecret(active.secret, () =>
    onSharedWorker(async (api) => {
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
      if (persisted)
        return applyReviewSummaryReuse(verifiedInputSha256, offer, persisted);
      const csvBytes = await loadCsvBytes();
      return applyReviewSummaryReuse(
        verifiedInputSha256,
        offer,
        await api.processReviewCsvBytes(
          inputFileName,
          Comlink.transfer(csvBytes, [csvBytes]),
          changedOptions,
          undefined,
          runtime,
          verifiedInputSha256,
          supportCacheKey,
          knownReviewSummaryDigests,
          active.partition,
          active.secret
            ? Comlink.transfer(active.secret, [active.secret])
            : undefined,
        ),
      );
    }),
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
  verifiedInputSha256?: string,
  participantPartition?: ParticipantPartitionTransport,
  inspectionBatch?: RawFileInspectionBatch,
): Promise<ProcessedFileResult> {
  return pool.submit(async (api) => {
    const proxied = onProgress ? Comlink.proxy(onProgress) : undefined;
    const active = activePartitionTransport(
      options,
      participantPartition,
      inspectionBatch,
    );
    return withTransientSecret(active.secret, () =>
      api.processRawCsvBytes(
        inputFileName,
        Comlink.transfer(csvBytes, [csvBytes]),
        options,
        supportFiles,
        runtime,
        proxied,
        verifiedInputSha256,
        active.partition,
        active.secret
          ? Comlink.transfer(active.secret, [active.secret])
          : undefined,
      ),
    );
  }, verifiedInputSha256);
}
