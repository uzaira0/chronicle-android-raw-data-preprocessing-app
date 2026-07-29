import { afterAll, describe, expect, it, vi } from "vitest";
import type * as Comlink from "comlink";
import {
  comparisonSupportCacheKey,
  discoverTimezonesBytes,
  exportVerifiedWorkspaceClosure,
  getRuntimeVersion,
  getPlanStageView,
  importVerifiedWorkspaceClosure,
  inspectRawCsvBytes,
  processPersistedReview,
  processPersistedOrRawChangedReviewViaPool,
  processPersistedReviewViaPool,
  processRawCsvBytes,
  processRawCsvChangedReviewBytesViaPool,
  processRawCsvReviewBytes,
  processRawCsvBytesViaPool,
  warmRuntime,
  WorkerPool,
  type WorkerSpawn,
} from "@/lib/rustWorkerClient";
import type { ChronicleWorkerApi } from "@/workers/chronicle-worker";
import type {
  BrowserProcessingOptions,
  ProcessedFileResult,
} from "@/lib/types";

type RemoteApi = Comlink.Remote<ChronicleWorkerApi>;

function makeSpawn(): {
  spawn: WorkerSpawn;
  apis: RemoteApi[];
  workers: Array<{ terminate: ReturnType<typeof vi.fn> }>;
} {
  const apis: RemoteApi[] = [];
  const workers: Array<{ terminate: ReturnType<typeof vi.fn> }> = [];
  const spawn: WorkerSpawn = () => {
    const api = {} as RemoteApi;
    const worker = { terminate: vi.fn() };
    apis.push(api);
    workers.push(worker);
    return { api, worker };
  };
  return { spawn, apis, workers };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Stub spawn with canned api methods and a controllable per-slot fault. */
function stubSpawn(
  overrides: Partial<Record<keyof ChronicleWorkerApi, unknown>> = {},
) {
  const terminated: boolean[] = [];
  const faults: Deferred<never>[] = [];
  const calls: string[] = [];
  const result = {
    outputFileName: "out.csv",
  } as unknown as ProcessedFileResult;
  const spawn: WorkerSpawn = () => {
    const supportCache = new Map<string, true>();
    const fault = deferred<never>();
    faults.push(fault);
    const index = terminated.push(false) - 1;
    const api = {
      runtimeVersion: () => Promise.resolve("stub"),
      hasComparisonSupportFiles: (key: string) =>
        Promise.resolve(supportCache.has(key)),
      cacheComparisonSupportFiles: (...args: unknown[]) => {
        const key = String(args[0]);
        calls.push(`support:${key}`);
        supportCache.delete(key);
        supportCache.set(key, true);
        while (supportCache.size > 2) {
          const oldest = supportCache.keys().next().value;
          if (oldest === undefined) break;
          supportCache.delete(oldest);
        }
        return Promise.resolve();
      },
      processRawCsvBytes: (...args: unknown[]) => {
        calls.push(
          `bytes:${String(args[0])}:${(args[1] as ArrayBuffer).byteLength}:${String(args[6])}`,
        );
        return Promise.resolve(result);
      },
      processReviewCsvBytes: (...args: unknown[]) => {
        calls.push(
          `changed:${String(args[0])}:${(args[1] as ArrayBuffer).byteLength}:${String(args[5])}`,
        );
        return Promise.resolve(result);
      },
      processPersistedReview: (...args: unknown[]) => {
        calls.push(
          `persisted:${String(args[0])}:${String(args[1])}:${String(args[5])}`,
        );
        return Promise.resolve(result);
      },
      ...overrides,
    } as unknown as RemoteApi;
    return {
      api,
      worker: {
        terminate: () => {
          terminated[index] = true;
        },
      },
      fault: fault.promise,
    };
  };
  return { spawn, terminated, faults, calls, result };
}

describe("WorkerPool", () => {
  it("creates exactly `size` workers regardless of submitted task count", async () => {
    const { spawn, workers } = makeSpawn();
    const pool = new WorkerPool(3, spawn);
    expect(workers).toHaveLength(3);

    const tasks = Array.from({ length: 50 }, (_, index) => index);
    await Promise.all(
      tasks.map((value) => pool.submit(() => Promise.resolve(value))),
    );

    expect(workers).toHaveLength(3);
    pool.terminate();
    workers.forEach((worker) => {
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    });
  });

  it("replaces a retired slot lazily after its configured task limit", async () => {
    const { spawn, apis, workers } = makeSpawn();
    const pool = new WorkerPool(1, { spawn, maxTasksPerWorker: 1 });

    await expect(pool.submit((api) => Promise.resolve(api))).resolves.toBe(
      apis[0],
    );

    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminate).toHaveBeenCalledTimes(1);
    await expect(pool.submit((api) => Promise.resolve(api))).resolves.toBe(
      apis[1],
    );
    expect(workers).toHaveLength(2);
    expect(apis[1]).not.toBe(apis[0]);
    pool.terminate();
    expect(workers[1]?.terminate).toHaveBeenCalledTimes(1);
  });

  it("replaces an idle retired lane while another lane is still busy", async () => {
    const { spawn, apis, workers } = makeSpawn();
    const pool = new WorkerPool(2, { spawn, maxTasksPerWorker: 1 });
    const firstGate = deferred<void>();
    const secondGate = deferred<void>();
    const first = pool.submit(() => firstGate.promise);
    const second = pool.submit(() => secondGate.promise);
    await Promise.resolve();

    firstGate.resolve();
    await first;
    expect(workers[0]?.terminate).toHaveBeenCalledTimes(1);

    let thirdStarted = false;
    const third = pool.submit((api) => {
      thirdStarted = true;
      return Promise.resolve(api);
    });
    await vi.waitFor(() => expect(thirdStarted).toBe(true));
    expect(workers).toHaveLength(3);
    await expect(third).resolves.toBe(apis[2]);

    secondGate.resolve();
    await second;
    pool.terminate();
  });

  it("never exceeds configured live count while recycling and preserves queue order", async () => {
    let live = 0;
    let peakLive = 0;
    let generation = 0;
    const spawn: WorkerSpawn = () => {
      const api = { generation: generation++ } as unknown as RemoteApi;
      let terminated = false;
      live += 1;
      peakLive = Math.max(peakLive, live);
      return {
        api,
        worker: {
          terminate: () => {
            if (!terminated) live -= 1;
            terminated = true;
          },
        },
      };
    };
    const pool = new WorkerPool(2, { spawn, maxTasksPerWorker: 1 });
    const startOrder: number[] = [];
    const values = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        pool.submit(async () => {
          startOrder.push(index);
          await Promise.resolve();
          return index;
        }),
      ),
    );

    expect(values).toEqual(Array.from({ length: 12 }, (_, index) => index));
    expect(startOrder).toEqual(Array.from({ length: 12 }, (_, index) => index));
    expect(peakLive).toBe(2);
    expect(live).toBe(0);
    pool.terminate();
    expect(live).toBe(0);
  });

  it("does not spawn a replacement after the pool is terminated", async () => {
    const gate = deferred<void>();
    const { spawn, workers } = makeSpawn();
    const pool = new WorkerPool(1, { spawn, maxTasksPerWorker: 1 });
    const running = pool.submit(() => gate.promise);
    await Promise.resolve();

    pool.terminate();
    gate.resolve();
    await expect(running).resolves.toBeUndefined();
    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminate).toHaveBeenCalledTimes(1);
  });

  it("recycles after an action failure but fails waiters if replacement spawning fails", async () => {
    const healthy = makeSpawn();
    const healthyPool = new WorkerPool(1, {
      spawn: healthy.spawn,
      maxTasksPerWorker: 1,
    });
    await expect(
      healthyPool.submit(() => Promise.reject(new Error("bad input"))),
    ).rejects.toThrow("bad input");
    expect(healthy.workers).toHaveLength(1);
    await expect(
      healthyPool.submit(() => Promise.resolve("fresh")),
    ).resolves.toBe("fresh");
    expect(healthy.workers).toHaveLength(2);
    healthyPool.terminate();

    const gate = deferred<void>();
    let spawnCount = 0;
    const firstWorker = { terminate: vi.fn() };
    const failingSpawn: WorkerSpawn = () => {
      spawnCount += 1;
      if (spawnCount > 1) throw new Error("replacement failed");
      return { api: {} as RemoteApi, worker: firstWorker };
    };
    const failingPool = new WorkerPool(1, {
      spawn: failingSpawn,
      maxTasksPerWorker: 1,
    });
    const first = failingPool.submit(() => gate.promise);
    await Promise.resolve();
    const waiting = failingPool.submit(() => Promise.resolve("never"));
    gate.resolve();
    await expect(first).resolves.toBeUndefined();
    await expect(waiting).rejects.toThrow("All Chronicle workers have failed");
    expect(firstWorker.terminate).toHaveBeenCalledTimes(1);
    failingPool.terminate();
    expect(firstWorker.terminate).toHaveBeenCalledTimes(1);
  });

  it("fails the slot without hanging when worker termination throws during recycling", async () => {
    const pool = new WorkerPool(1, {
      maxTasksPerWorker: 1,
      spawn: () => ({
        api: {} as RemoteApi,
        worker: {
          terminate: () => {
            throw new Error("termination failed");
          },
        },
      }),
    });

    await expect(pool.submit(() => Promise.resolve("done"))).resolves.toBe(
      "done",
    );
    await expect(pool.submit(() => Promise.resolve("never"))).rejects.toThrow(
      "All Chronicle workers have failed",
    );
    expect(() => pool.terminate()).not.toThrow();
  });

  it("queues tasks beyond pool size and drains them in submission order", async () => {
    const { spawn } = makeSpawn();
    const pool = new WorkerPool(2, spawn);

    let activeCount = 0;
    let peakActive = 0;
    const completionOrder: number[] = [];
    const releases: Array<() => void> = [];

    const tasks = Array.from({ length: 6 }, (_, index) =>
      pool.submit(async () => {
        activeCount += 1;
        peakActive = Math.max(peakActive, activeCount);
        await new Promise<void>((resolve) => {
          releases.push(() => {
            activeCount -= 1;
            completionOrder.push(index);
            resolve();
          });
        });
        return index;
      }),
    );

    // Wait for the first batch of 2 tasks to acquire slots.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(releases).toHaveLength(2);

    // Release tasks one at a time and let queued ones acquire slots.
    while (releases.length) {
      const next = releases.shift();
      next?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const results = await Promise.all(tasks);
    expect(results).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peakActive).toBeLessThanOrEqual(2);
    expect(completionOrder).toEqual([0, 1, 2, 3, 4, 5]);
    pool.terminate();
  });

  it("rejects pending waiters on terminate", async () => {
    const { spawn } = makeSpawn();
    const pool = new WorkerPool(1, spawn);

    let releaseBlocker: () => void = () => {};
    const blocker = pool.submit(
      () =>
        new Promise<void>((resolve) => {
          releaseBlocker = resolve;
        }),
    );
    // Yield once so the pool actually picks up the blocker before we queue the next task.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const queued = pool.submit(() => Promise.resolve("queued"));

    pool.terminate();
    releaseBlocker();
    await blocker;
    await expect(queued).rejects.toThrow(/terminated/);
    // A terminated pool refuses new work outright.
    await expect(pool.submit(() => Promise.resolve("late"))).rejects.toThrow(
      /terminated/,
    );
  });

  it("rounds non-integer or sub-1 sizes up to a single worker", () => {
    const { spawn, workers } = makeSpawn();
    const pool = new WorkerPool(0.4, spawn);
    expect(workers).toHaveLength(1);
    pool.terminate();
    expect(new WorkerPool(2.9, makeSpawn().spawn).size).toBe(2);
  });

  it("rejects (instead of hanging) when a worker faults mid-task", async () => {
    // A worker whose action never settles but whose `fault` rejects — models a
    // worker that failed to load / threw uncaught (e.g. offline cold start).
    const fault = Promise.reject(
      new Error("Chronicle worker failed: could not load"),
    );
    fault.catch(() => {}); // pre-handle so it isn't an unhandled rejection before it's raced
    const spawn: WorkerSpawn = () => ({
      api: {} as Comlink.Remote<ChronicleWorkerApi>,
      worker: { terminate: vi.fn() },
      fault,
    });
    const pool = new WorkerPool(1, spawn);
    await expect(
      pool.submit(() => new Promise<string>(() => {})),
    ).rejects.toThrow(/worker failed/i);
    pool.terminate();
  });

  it("does not fault when the spawn provides no fault signal", async () => {
    const { spawn } = makeSpawn();
    const pool = new WorkerPool(1, spawn);
    await expect(pool.submit(() => Promise.resolve("ok"))).resolves.toBe("ok");
    pool.terminate();
  });

  it("does not dispatch work before the shared WASM module initializes", async () => {
    const ready = deferred<void>();
    let dispatched = false;
    const pool = new WorkerPool(1, () => ({
      api: {} as RemoteApi,
      worker: { terminate: vi.fn() },
      ready: ready.promise,
    }));
    const result = pool.submit(() => {
      dispatched = true;
      return Promise.resolve("ok");
    });
    await Promise.resolve();
    expect(dispatched).toBe(false);
    ready.resolve();
    await expect(result).resolves.toBe("ok");
    expect(dispatched).toBe(true);
    pool.terminate();
  });

  it("marks a faulted slot dead, keeps serving from live slots, and fails only when all are dead", async () => {
    const { spawn, faults } = stubSpawn();
    const pool = new WorkerPool(2, spawn);
    faults[0].reject(new Error("slot 0 died"));
    await Promise.resolve();
    await expect(
      pool.submit(async (api) => api.runtimeVersion()),
    ).resolves.toBe("stub");
    faults[1].reject(new Error("slot 1 died"));
    await Promise.resolve();
    await expect(
      pool.submit(async (api) => api.runtimeVersion()),
    ).rejects.toThrow("All Chronicle workers have failed.");
    pool.terminate();
  });

  it("rejects queued waiters when the last live slot dies mid-wait", async () => {
    const gate = deferred<ProcessedFileResult>();
    const { spawn, faults } = stubSpawn({
      processRawCsvBytes: () => gate.promise,
    });
    const pool = new WorkerPool(1, spawn);
    const running = pool.submit((api) =>
      api.processRawCsvBytes("a.csv", new ArrayBuffer(0)),
    );
    const waiting = pool.submit(async (api) => api.runtimeVersion());
    faults[0].reject(new Error("died while busy"));
    await expect(running).rejects.toThrow("died while busy");
    // Release pumps the queue: the only slot is dead, so the waiter fails loudly.
    await expect(waiting).rejects.toThrow("All Chronicle workers have failed.");
    pool.terminate();
    gate.resolve({} as ProcessedFileResult);
  });
});

describe("pool entry points", () => {
  it("processRawCsvBytesViaPool transfers bytes and reuses the inspected digest", async () => {
    const { spawn, calls, result } = stubSpawn();
    const pool = new WorkerPool(1, spawn);
    const bytes = new TextEncoder().encode("study_id\nS").buffer;
    await expect(
      processRawCsvBytesViaPool(
        pool,
        "b.csv",
        bytes,
        undefined,
        undefined,
        undefined,
        undefined,
        "1".repeat(64),
      ),
    ).resolves.toBe(result);
    expect(calls).toEqual([
      `bytes:b.csv:${bytes.byteLength}:${"1".repeat(64)}`,
    ]);
    pool.terminate();
  });

  it("proxies pool progress callbacks when supplied", async () => {
    const { spawn, result } = stubSpawn();
    const pool = new WorkerPool(1, spawn);
    const progress = vi.fn();
    await expect(
      processRawCsvBytesViaPool(
        pool,
        "progress.csv",
        new ArrayBuffer(0),
        undefined,
        undefined,
        undefined,
        progress,
      ),
    ).resolves.toBe(result);
    pool.terminate();
  });

  it("computes only Arm B and reuses the verified digest from Arm A", async () => {
    const { spawn, calls, result } = stubSpawn();
    const pool = new WorkerPool(8, spawn);
    const bytes = new TextEncoder().encode("study_id\nS").buffer;
    await expect(
      processRawCsvChangedReviewBytesViaPool(
        pool,
        "pair.csv",
        bytes,
        {} as BrowserProcessingOptions,
        undefined,
        undefined,
        "1".repeat(64),
      ),
    ).resolves.toBe(result);
    expect(calls).toEqual([
      `changed:pair.csv:${bytes.byteLength}:${"1".repeat(64)}`,
    ]);
    pool.terminate();
  });

  it("probes a persisted Arm-B base without transferring raw bytes", async () => {
    const { spawn, calls, result } = stubSpawn();
    const pool = new WorkerPool(8, spawn);
    await expect(
      processPersistedReviewViaPool(
        pool,
        "pair.csv",
        19_018_650,
        {} as BrowserProcessingOptions,
        undefined,
        undefined,
        "1".repeat(64),
      ),
    ).resolves.toBe(result);
    expect(calls).toEqual([`persisted:pair.csv:19018650:${"1".repeat(64)}`]);
    pool.terminate();
  });

  it("keeps a persisted miss and raw fallback on one pool slot", async () => {
    const harness = stubSpawn({
      processPersistedReview: vi.fn().mockResolvedValue(null),
    });
    const pool = new WorkerPool(1, {
      spawn: harness.spawn,
      maxTasksPerWorker: 1,
    });
    const bytes = new TextEncoder().encode("study_id\nS").buffer;
    const load = vi.fn().mockResolvedValue(bytes);
    await expect(
      processPersistedOrRawChangedReviewViaPool(
        pool,
        "pair.csv",
        bytes.byteLength,
        load,
        {} as BrowserProcessingOptions,
        undefined,
        undefined,
        "1".repeat(64),
      ),
    ).resolves.toBe(harness.result);
    expect(load).toHaveBeenCalledTimes(1);
    expect(harness.calls).toEqual([
      `changed:pair.csv:${bytes.byteLength}:${"1".repeat(64)}`,
    ]);
    expect(harness.terminated).toHaveLength(1);
    pool.terminate();
  });

  it("does not load raw bytes when the same-slot persisted probe hits", async () => {
    const harness = stubSpawn();
    const pool = new WorkerPool(1, harness.spawn);
    const load = vi.fn();
    await expect(
      processPersistedOrRawChangedReviewViaPool(
        pool,
        "pair.csv",
        19_018_650,
        load,
        {} as BrowserProcessingOptions,
        undefined,
        undefined,
        "1".repeat(64),
      ),
    ).resolves.toBe(harness.result);
    expect(load).not.toHaveBeenCalled();
    expect(harness.calls).toEqual([
      `persisted:pair.csv:19018650:${"1".repeat(64)}`,
    ]);
    pool.terminate();
  });

  it("copies an exact support bundle only once per worker", async () => {
    const harness = stubSpawn();
    const pool = new WorkerPool(1, harness.spawn);
    const supportFiles = {
      appCodebookFile: {
        name: "codebook.csv",
        bytes: new TextEncoder().encode("package,label\na,A").buffer,
      },
    };
    const key = await comparisonSupportCacheKey(supportFiles);
    for (const fileName of ["a.csv", "b.csv"]) {
      await processPersistedOrRawChangedReviewViaPool(
        pool,
        fileName,
        100,
        vi.fn(),
        {} as BrowserProcessingOptions,
        supportFiles,
        undefined,
        "1".repeat(64),
        key,
      );
    }
    expect(harness.calls.filter((call) => call.startsWith("support:"))).toEqual([
      `support:${key}`,
    ]);
    expect(harness.calls.filter((call) => call.startsWith("persisted:"))).toHaveLength(2);
    pool.terminate();
  });

  it("changes the support transport key for names or bytes", async () => {
    const one = await comparisonSupportCacheKey({
      filterFile: { name: "filter.csv", bytes: new Uint8Array([1]).buffer },
    });
    const renamed = await comparisonSupportCacheKey({
      filterFile: { name: "other.csv", bytes: new Uint8Array([1]).buffer },
    });
    const changed = await comparisonSupportCacheKey({
      filterFile: { name: "filter.csv", bytes: new Uint8Array([2]).buffer },
    });
    expect(new Set([one, renamed, changed]).size).toBe(3);
  });

  it("resends a support bundle after the worker evicts it", async () => {
    const harness = stubSpawn();
    const pool = new WorkerPool(1, harness.spawn);
    const bundles = await Promise.all(
      [1, 2, 3].map(async (value) => {
        const support = {
          filterFile: {
            name: `filter-${value}.csv`,
            bytes: new Uint8Array([value]).buffer,
          },
        };
        return { support, key: await comparisonSupportCacheKey(support) };
      }),
    );
    for (const bundle of [...bundles, bundles[0]]) {
      await processPersistedOrRawChangedReviewViaPool(
        pool,
        "pair.csv",
        100,
        vi.fn(),
        {} as BrowserProcessingOptions,
        bundle.support,
        undefined,
        "1".repeat(64),
        bundle.key,
      );
    }
    expect(harness.calls.filter((call) => call === `support:${bundles[0].key}`)).toHaveLength(2);
    pool.terminate();
  });
});

/**
 * Minimal fake Worker global: enough surface for Comlink.wrap (postMessage +
 * addEventListener) and for the module's fault wiring (error/messageerror
 * events fired on demand). Comlink calls never settle against it — every test
 * resolves through the fault race, which is exactly the hang-becomes-loud-error
 * behavior the shared-worker path exists to provide.
 */
class FakeWorker {
  static instances: FakeWorker[] = [];
  listeners = new Map<string, Array<(event: unknown) => void>>();
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(handler);
    this.listeners.set(type, bucket);
  }

  removeEventListener(): void {}

  postMessage(): void {}

  terminate(): void {
    this.terminated = true;
  }

  fire(type: string, event: unknown): void {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }
}

vi.stubGlobal("Worker", FakeWorker);
afterAll(() => vi.unstubAllGlobals());

function lastWorker(): FakeWorker {
  return FakeWorker.instances.at(-1)!;
}

describe("shared worker fault handling (fake Worker global)", () => {
  it("rejects loudly on a worker error event, evicts the singleton, and re-spawns on retry", async () => {
    const before = FakeWorker.instances.length;
    const pending = getRuntimeVersion();
    expect(FakeWorker.instances.length).toBe(before + 1);
    const first = lastWorker();
    first.fire("error", { message: "boom" });
    await expect(pending).rejects.toThrow("Chronicle worker failed: boom");
    // Eviction terminates the dead worker so the next call spawns a fresh one.
    expect(first.terminated).toBe(true);

    const retry = discoverTimezonesBytes(new ArrayBuffer(0));
    expect(FakeWorker.instances.length).toBe(before + 2);
    expect(lastWorker()).not.toBe(first);
    lastWorker().fire("messageerror", {});
    await expect(retry).rejects.toThrow(
      "Chronicle worker sent an unreadable message.",
    );
  });

  it("uses the fallback message when the error event carries none", async () => {
    const pending = getRuntimeVersion();
    lastWorker().fire("error", {});
    await expect(pending).rejects.toThrow("could not load the matcher worker");
  });

  it("warmRuntime swallows the failure (best-effort warmup)", async () => {
    const pending = warmRuntime();
    lastWorker().fire("error", { message: "offline" });
    await expect(pending).resolves.toBeUndefined();
  });

  it("byte processing rejects via the fault race, with and without a progress proxy", async () => {
    const noProgress = processRawCsvBytes("a.csv", new ArrayBuffer(0));
    lastWorker().fire("error", { message: "dead" });
    await expect(noProgress).rejects.toThrow("Chronicle worker failed: dead");

    const withProgress = processRawCsvBytes(
      "a.csv",
      new ArrayBuffer(0),
      undefined,
      undefined,
      undefined,
      () => {},
    );
    lastWorker().fire("error", { message: "dead again" });
    await expect(withProgress).rejects.toThrow(
      "Chronicle worker failed: dead again",
    );
  });

  it("routes workspace closure and pre-run view requests through the shared worker", async () => {
    const exported = exportVerifiedWorkspaceClosure(`sha256:${"1".repeat(64)}`);
    lastWorker().fire("error", { message: "export failed" });
    await expect(exported).rejects.toThrow("export failed");

    const imported = importVerifiedWorkspaceClosure(new Uint8Array([1, 2, 3]));
    lastWorker().fire("error", { message: "import failed" });
    await expect(imported).rejects.toThrow("import failed");

    const view = getPlanStageView({} as Parameters<typeof getPlanStageView>[0]);
    lastWorker().fire("error", { message: "view failed" });
    await expect(view).rejects.toThrow("view failed");
  });

  it("routes byte-native discovery, inspection, and processing through the shared worker", async () => {
    const discovery = discoverTimezonesBytes(new Uint8Array([1]).buffer);
    lastWorker().fire("error", { message: "byte discovery failed" });
    await expect(discovery).rejects.toThrow("byte discovery failed");

    const inspection = inspectRawCsvBytes(
      "raw.csv",
      2,
      new Uint8Array([1, 2]).buffer,
    );
    lastWorker().fire("error", { message: "byte inspection failed" });
    await expect(inspection).rejects.toThrow("byte inspection failed");

    const processing = processRawCsvBytes(
      "raw.csv",
      new Uint8Array([1, 2, 3]).buffer,
    );
    lastWorker().fire("error", { message: "byte processing failed" });
    await expect(processing).rejects.toThrow("byte processing failed");

    const persisted = processPersistedReview(
      "raw.csv",
      3,
      {} as BrowserProcessingOptions,
      undefined,
      undefined,
      "1".repeat(64),
    );
    lastWorker().fire("error", { message: "persisted review failed" });
    await expect(persisted).rejects.toThrow("persisted review failed");

    const review = processRawCsvReviewBytes(
      "raw.csv",
      new Uint8Array([1, 2, 3]).buffer,
    );
    lastWorker().fire("error", { message: "review failed" });
    await expect(review).rejects.toThrow("review failed");
  });
});

async function loadFreshWorkerClient(
  api: RemoteApi,
  response: Response,
): Promise<typeof import("@/lib/rustWorkerClient")> {
  vi.resetModules();
  vi.doMock("comlink", () => ({
    wrap: vi.fn(() => api),
    transfer: vi.fn((value: unknown) => value),
    proxy: vi.fn((value: unknown) => value),
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response)),
  );
  return import("@/lib/rustWorkerClient");
}

describe("shared worker successful routing and WASM compilation", () => {
  it("reports an HTTP failure before initializing the worker runtime", async () => {
    const api = {
      initializeRuntime: vi.fn(() => Promise.resolve()),
    } as unknown as RemoteApi;
    const client = await loadFreshWorkerClient(
      api,
      new Response("unavailable", { status: 503 }),
    );

    await expect(client.getRuntimeVersion()).rejects.toThrow(
      "Could not load the Rust runtime (503)",
    );
    expect(api.initializeRuntime).not.toHaveBeenCalled();
  });

  it("compiles once on the main thread and routes every shared-worker operation", async () => {
    const module = {} as WebAssembly.Module;
    const compileStreaming = vi
      .spyOn(WebAssembly, "compileStreaming")
      .mockResolvedValue(module);
    const compile = vi.spyOn(WebAssembly, "compile");
    const result = { inputFileName: "raw.csv" } as ProcessedFileResult;
    const inspection = { rowCount: 2 } as unknown as Awaited<
      ReturnType<typeof inspectRawCsvBytes>
    >;
    const imported = {
      workspaceId: `sha256:${"1".repeat(64)}`,
      slot: {
        generation: 1,
        workspaceRootDigest: `sha256:${"2".repeat(64)}`,
      },
    };
    const api = {
      initializeRuntime: vi.fn(() => Promise.resolve()),
      runtimeVersion: vi.fn(() => Promise.resolve("runtime-v1")),
      exportWorkspaceClosure: vi.fn(() =>
        Promise.resolve(new Uint8Array([1, 2, 3])),
      ),
      importWorkspaceClosureArchive: vi.fn(() => Promise.resolve(imported)),
      planStageView: vi.fn(() => Promise.resolve({ payload: {} })),
      discoverTimezonesBytes: vi.fn(() => Promise.resolve(["UTC"])),
      inspectRawCsvBytes: vi.fn(() => Promise.resolve(inspection)),
      processRawCsvBytes: vi.fn(() => Promise.resolve(result)),
      processReviewCsvBytes: vi.fn(() => Promise.resolve(result)),
      processPersistedReview: vi.fn(() => Promise.resolve(result)),
    } as unknown as RemoteApi;
    const client = await loadFreshWorkerClient(
      api,
      new Response(new Uint8Array([0, 97, 115, 109]), {
        headers: { "content-type": "application/wasm" },
      }),
    );

    await expect(client.getRuntimeVersion()).resolves.toBe("runtime-v1");
    expect(api.initializeRuntime).toHaveBeenCalledTimes(1);
    expect(api.initializeRuntime).toHaveBeenCalledWith(module);
    expect(compileStreaming).toHaveBeenCalledTimes(1);
    expect(compile).not.toHaveBeenCalled();

    await expect(
      client.exportVerifiedWorkspaceClosure(`sha256:${"1".repeat(64)}`),
    ).resolves.toEqual(new Uint8Array([1, 2, 3]));
    const archiveBacking = new Uint8Array([9, 1, 2, 8]);
    await expect(
      client.importVerifiedWorkspaceClosure(archiveBacking.subarray(1, 3)),
    ).resolves.toEqual(imported);
    await expect(
      client.getPlanStageView({} as BrowserProcessingOptions),
    ).resolves.toEqual({ payload: {} });
    await expect(
      client.discoverTimezonesBytes(new ArrayBuffer(2)),
    ).resolves.toEqual(["UTC"]);
    await expect(
      client.inspectRawCsvBytes("raw.csv", 2, new ArrayBuffer(2), "digest"),
    ).resolves.toBe(inspection);
    const progress = vi.fn();
    await expect(
      client.processRawCsvBytes(
        "raw.csv",
        new ArrayBuffer(2),
        {},
        undefined,
        undefined,
        progress,
        "digest",
      ),
    ).resolves.toBe(result);
    await expect(
      client.processRawCsvBytes("raw.csv", new ArrayBuffer(0)),
    ).resolves.toBe(result);
    await expect(
      client.processRawCsvReviewBytes("raw.csv", new ArrayBuffer(2)),
    ).resolves.toBe(result);
    await expect(
      client.processPersistedReview(
        "raw.csv",
        2,
        {} as BrowserProcessingOptions,
        undefined,
        undefined,
        "digest",
      ),
    ).resolves.toBe(result);
    expect(api.importWorkspaceClosureArchive).toHaveBeenCalledWith(
      expect.objectContaining({ byteLength: 2 }),
    );
    expect(api.processRawCsvBytes).toHaveBeenCalledWith(
      "raw.csv",
      expect.any(ArrayBuffer),
      {},
      undefined,
      undefined,
      progress,
      "digest",
    );
    const pool = new client.WorkerPool(1, { maxTasksPerWorker: 2 });
    await expect(
      pool.submit((workerApi) => workerApi.runtimeVersion()),
    ).resolves.toBe("runtime-v1");
    pool.terminate();

    compileStreaming.mockRestore();
    compile.mockRestore();
  });

  it("falls back to ArrayBuffer compilation when streaming compilation fails", async () => {
    const module = {} as WebAssembly.Module;
    const compileStreaming = vi
      .spyOn(WebAssembly, "compileStreaming")
      .mockRejectedValue(new TypeError("wrong MIME type"));
    const compile = vi.spyOn(WebAssembly, "compile").mockResolvedValue(module);
    const api = {
      initializeRuntime: vi.fn(() => Promise.resolve()),
      runtimeVersion: vi.fn(() => Promise.resolve("fallback")),
    } as unknown as RemoteApi;
    vi.stubGlobal("location", { href: "https://example.test/app/" });
    const client = await loadFreshWorkerClient(
      api,
      new Response(new Uint8Array([0, 97, 115, 109])),
    );

    await expect(client.getRuntimeVersion()).resolves.toBe("fallback");
    expect(compileStreaming).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledTimes(1);
    expect(api.initializeRuntime).toHaveBeenCalledWith(module);

    compileStreaming.mockRestore();
    compile.mockRestore();
  });

  it("uses ArrayBuffer compilation when compileStreaming is unavailable", async () => {
    const module = {} as WebAssembly.Module;
    const original = Object.getOwnPropertyDescriptor(
      WebAssembly,
      "compileStreaming",
    );
    Object.defineProperty(WebAssembly, "compileStreaming", {
      configurable: true,
      value: undefined,
    });
    const compile = vi.spyOn(WebAssembly, "compile").mockResolvedValue(module);
    const api = {
      initializeRuntime: vi.fn(() => Promise.resolve()),
      runtimeVersion: vi.fn(() => Promise.resolve("no-streaming")),
    } as unknown as RemoteApi;
    try {
      const client = await loadFreshWorkerClient(
        api,
        new Response(new Uint8Array([0, 97, 115, 109])),
      );
      await expect(client.getRuntimeVersion()).resolves.toBe("no-streaming");
      expect(compile).toHaveBeenCalledTimes(1);
      expect(api.initializeRuntime).toHaveBeenCalledWith(module);
    } finally {
      compile.mockRestore();
      if (original) {
        Object.defineProperty(WebAssembly, "compileStreaming", original);
      }
    }
  });
});
