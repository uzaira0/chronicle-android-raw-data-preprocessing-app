import { afterAll, describe, expect, it, vi } from "vitest";
import type * as Comlink from "comlink";
import {
  comparisonSupportCacheKey,
  discoverTimezonesBytes,
  exportVerifiedWorkspaceClosure,
  getRuntimeVersion,
  getWorkflowExplorerView,
  importVerifiedWorkspaceClosure,
  inspectRawCsvBytes,
  clearReviewSummaryReuseCache,
  probeWorkerWorkspaceCapability,
  processPersistedReview,
  processPersistedOrRawChangedReviewViaPool,
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
      setComparisonCacheCapacity: () => Promise.resolve(),
      getComparisonCacheRetained: () => Promise.resolve(0),
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

  it("rejects an in-flight submission when the pool is terminated", async () => {
    // `worker.terminate()` fires no error event and never delivers the pending
    // Comlink reply, so a submission that is already running has no natural way
    // to settle. Without an explicit abort it hangs forever, and the batch
    // cancel in App.tsx waits on it — leaving the UI stuck on "Processing…".
    const { spawn, workers } = makeSpawn();
    const pool = new WorkerPool(2, spawn);
    const neverSettles = new Promise<string>(() => {});
    const inFlight = pool.submit(() => neverSettles);
    const queued = pool.submit(() => neverSettles);
    const alsoQueued = pool.submit(() => neverSettles);
    await Promise.resolve();

    pool.terminate();

    await expect(inFlight).rejects.toThrow(/Worker pool has been terminated/);
    await expect(queued).rejects.toThrow(/Worker pool has been terminated/);
    await expect(alsoQueued).rejects.toThrow(/Worker pool has been terminated/);
    workers.forEach((worker) => {
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    });
  });

  it("rejects a submission terminated in the same synchronous turn it was made", async () => {
    // The test above interposes `await Promise.resolve()`, which lets every
    // submission reach `runOnSlot` before `terminate()` runs. Nothing forces a
    // caller to do that: `submit()` suspends on `await this.acquire()` even when
    // a slot is idle (an already-resolved promise still costs one microtask), so
    // a `terminate()` in the SAME turn lands while the submission is between
    // acquire and runOnSlot. A per-slot abort hook installed by `runOnSlot` does
    // not exist yet at that moment and `this.slots` is emptied before the
    // continuation resumes, so the resumed submission would go on to race
    // `body()` (an RPC to a worker that has already stopped) against a fault
    // that never fires and an abort nobody can reach — a promise that never
    // settles. Only a pool-scoped abort covers this window.
    const { spawn, workers } = makeSpawn();
    const pool = new WorkerPool(2, spawn);
    const neverSettles = new Promise<string>(() => {});

    const inFlight = pool.submit(() => neverSettles);
    const withSetup = pool.submitWithSupportCache(
      "test-key",
      () => neverSettles,
      () => neverSettles,
    );
    const queued = pool.submit(() => neverSettles);
    // No `await` between the submissions and the cancel — this is the shape a
    // synchronous cancel path (a click handler that submits then bails) takes.
    pool.terminate();

    await expect(inFlight).rejects.toThrow(/Worker pool has been terminated/);
    await expect(withSetup).rejects.toThrow(/Worker pool has been terminated/);
    await expect(queued).rejects.toThrow(/Worker pool has been terminated/);
    workers.forEach((worker) => {
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    });
  });

  it("does not reject a submission that completes before termination", async () => {
    const { spawn } = makeSpawn();
    const pool = new WorkerPool(1, spawn);
    const gate = deferred<string>();
    const running = pool.submit(() => gate.promise);
    gate.resolve("done");
    await expect(running).resolves.toBe("done");
    pool.terminate();
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

  it("fails the pool when a retired worker refuses to terminate", async () => {
    const { spawn, apis, workers } = makeSpawn();
    const throwingSpawn: typeof spawn = () => {
      const slot = spawn();
      if (workers.length === 1) {
        workers[0]?.terminate.mockImplementation(() => {
          throw new Error("terminate refused");
        });
      }
      return slot;
    };
    const pool = new WorkerPool(1, { spawn: throwingSpawn, maxTasksPerWorker: 1 });
    await expect(pool.submit((api) => Promise.resolve(api))).resolves.toBe(
      apis[0],
    );
    await expect(pool.submit((api) => Promise.resolve(api))).rejects.toThrow(
      /All Chronicle workers have failed/,
    );
    expect(workers).toHaveLength(1);
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
    // The in-flight submission is rejected by termination, not left to settle:
    // a real terminated worker never sends its reply, so waiting for the body
    // is waiting forever. A late resolve must not resurrect the pool either.
    await expect(running).rejects.toThrow(/Worker pool has been terminated/);
    gate.resolve();
    await Promise.resolve();
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
    // Both the in-flight blocker and the queued waiter are settled by
    // termination; the blocker's own late resolve is irrelevant by then.
    await expect(blocker).rejects.toThrow(/terminated/);
    // Resolving the action AFTER terminate() must not resurrect the task: its
    // worker is already gone, so the pool's abort has settled it as rejected.
    releaseBlocker();
    await expect(blocker).rejects.toThrow(/terminated/);
    await expect(queued).rejects.toThrow(/terminated/);
    // A terminated pool refuses new work outright.
    await expect(pool.submit(() => Promise.resolve("late"))).rejects.toThrow(
      /terminated/,
    );
  });

  it("rejects the in-flight task on terminate even though its worker never answers", async () => {
    // The real failure this pins: `Worker.terminate()` stops the worker without
    // settling the Comlink RPC promises already awaiting a reply, and it does
    // not fire onerror/onmessageerror either, so `slot.fault` stays pending
    // too. Before the pool raced its own abort signal, cancelling a batch left
    // this promise pending forever and the run's `Promise.all` never resolved —
    // the UI sat on "Processing…" with the Cancel already clicked. Note there is
    // deliberately no `resolve` here: an action that never settles is exactly
    // what a terminated worker leaves behind.
    const { spawn } = makeSpawn();
    const pool = new WorkerPool(1, spawn);

    const inFlight = pool.submit(() => new Promise<string>(() => {}));
    await new Promise((resolve) => setTimeout(resolve, 0));

    pool.terminate();

    await expect(inFlight).rejects.toThrow(/terminated/);
  });

  it("rejects a task still waiting on worker readiness when the pool is terminated", async () => {
    // Same hazard one step earlier: terminate() during `initializeRuntime`
    // leaves `slot.ready` pending against a worker that is gone.
    const worker = { terminate: vi.fn() };
    const pool = new WorkerPool(1, () => ({
      api: {} as RemoteApi,
      worker,
      ready: new Promise<void>(() => {}),
    }));

    const inFlight = pool.submit(() => Promise.resolve("never reached"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    pool.terminate();

    await expect(inFlight).rejects.toThrow(/terminated/);
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
    faults[0]?.reject(new Error("slot 0 died"));
    await Promise.resolve();
    await expect(
      pool.submit(async (api) => api.runtimeVersion()),
    ).resolves.toBe("stub");
    faults[1]?.reject(new Error("slot 1 died"));
    await Promise.resolve();
    await expect(
      pool.submit(async (api) => api.runtimeVersion()),
    ).rejects.toThrow("All Chronicle workers have failed.");
    pool.terminate();
  });

  it("does not recycle a faulted (not retired) slot while work is queued", async () => {
    // `replaceSlot` recycles only a slot that reached its TASK LIMIT. A slot
    // killed by a worker fault is dead but not retired, and must never be
    // silently respawned behind the caller's back — the surviving lane drains
    // the queue instead.
    const { spawn, apis, workers } = makeSpawn();
    const faults = [deferred<never>(), deferred<never>()];
    let index = 0;
    const faultingSpawn: WorkerSpawn = () => {
      const slot = spawn();
      const fault = faults[index];
      index += 1;
      return fault ? { ...slot, fault: fault.promise } : slot;
    };
    const pool = new WorkerPool(2, { spawn: faultingSpawn });
    const firstGate = deferred<void>();
    const secondGate = deferred<void>();
    const first = pool.submit(() => firstGate.promise);
    const second = pool.submit(() => secondGate.promise);
    await Promise.resolve();
    // A third submission has no idle lane and queues as a waiter.
    let thirdApi: RemoteApi | undefined;
    const third = pool.submit((api) => {
      thirdApi = api;
      return Promise.resolve(api);
    });
    await Promise.resolve();
    expect(thirdApi).toBeUndefined();

    // Lane 0 faults with a waiter queued: release() reaches replaceSlot, which
    // refuses because the slot is dead-by-fault rather than retired.
    faults[0]!.reject(new Error("worker exploded"));
    await expect(first).rejects.toThrow("worker exploded");
    expect(workers).toHaveLength(2);

    // The queued task still runs — on the surviving lane, not a replacement.
    secondGate.resolve();
    await second;
    await expect(third).resolves.toBe(apis[1]);
    expect(workers).toHaveLength(2);
    firstGate.resolve();
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
    faults[0]?.reject(new Error("died while busy"));
    await expect(running).rejects.toThrow("died while busy");
    // Release pumps the queue: the only slot is dead, so the waiter fails loudly.
    await expect(waiting).rejects.toThrow("All Chronicle workers have failed.");
    pool.terminate();
    gate.resolve({} as ProcessedFileResult);
  });

  it("setComparisonCacheCapacity fans out to every live worker", async () => {
    const capacities: number[] = [];
    const { spawn } = stubSpawn({
      setComparisonCacheCapacity: (cap: number) => {
        capacities.push(cap);
        return Promise.resolve();
      },
    });
    const pool = new WorkerPool(3, spawn);
    await pool.setComparisonCacheCapacity(5);
    expect(capacities).toEqual([5, 5, 5]);
    pool.terminate();
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
    const firstBundle = bundles[0];
    if (firstBundle === undefined) throw new Error("expected three support bundles");
    for (const bundle of [...bundles, firstBundle]) {
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
    expect(harness.calls.filter((call) => call === `support:${firstBundle.key}`)).toHaveLength(2);
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

    const imported = importVerifiedWorkspaceClosure(
      new Blob([new Uint8Array([1, 2, 3])]),
    );
    lastWorker().fire("error", { message: "import failed" });
    await expect(imported).rejects.toThrow("import failed");

    const view = getWorkflowExplorerView({} as Parameters<typeof getWorkflowExplorerView>[0]);
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

  it("reports an unreachable worker as an unavailable durable-storage capability", async () => {
    // The durable-storage gate must never throw into its caller: a worker that
    // cannot be reached is itself the answer, because no other path can persist
    // a verified workspace.
    const pending = probeWorkerWorkspaceCapability();
    lastWorker().fire("error", { message: "worker died during boot" });
    await expect(pending).resolves.toEqual({
      status: "unavailable",
      reason:
        "The processing worker that owns durable storage could not be reached: Chronicle worker failed: worker died during boot",
    });

    // A non-Error rejection still has to render a usable reason.
    const unreadable = probeWorkerWorkspaceCapability();
    lastWorker().fire("messageerror", {});
    await expect(unreadable).resolves.toEqual({
      status: "unavailable",
      reason:
        "The processing worker that owns durable storage could not be reached: Chronicle worker sent an unreadable message.",
    });
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
        Promise.resolve(new Blob([new Uint8Array([1, 2, 3])])),
      ),
      importWorkspaceClosureArchive: vi.fn(() => Promise.resolve(imported)),
      workflowExplorerView: vi.fn(() => Promise.resolve({ payload: {} })),
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

const exportedArchive = await client.exportVerifiedWorkspaceClosure(
      `sha256:${"1".repeat(64)}`,
    );
    expect(new Uint8Array(await exportedArchive.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    // The archive crosses the boundary as a Blob handle: no copy, no transfer
    // list, and the picked File itself is what gets forwarded.
    const archiveBlob = new Blob([new Uint8Array([9, 1, 2, 8])]);
    await expect(
      client.importVerifiedWorkspaceClosure(archiveBlob),
    ).resolves.toEqual(imported);
    await expect(
      client.getWorkflowExplorerView(
        {} as BrowserProcessingOptions,
        [{ roleId: "filter_file", present: true }],
      ),
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
    expect(api.importWorkspaceClosureArchive).toHaveBeenCalledWith(archiveBlob);
    expect(api.workflowExplorerView).toHaveBeenCalledWith(
      {},
      [{ roleId: "filter_file", present: true }],
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

  it("returns the worker's own durable-storage verdict when the worker answers", async () => {
    // The gate is evaluated inside the worker that owns every production OPFS
    // write, so the reply must be forwarded verbatim — both the ready arm and a
    // worker-side refusal, which share one union the client must not collapse.
    const module = {} as WebAssembly.Module;
    const compileStreaming = vi
      .spyOn(WebAssembly, "compileStreaming")
      .mockResolvedValue(module);
    const probeWorkspaceCapability = vi
      .fn()
      .mockResolvedValueOnce({ status: "ready", evictionProtected: true })
      .mockResolvedValueOnce({
        status: "unavailable",
        reason: "Origin-private file storage is open but not writable: quota",
      });
    const api = {
      initializeRuntime: vi.fn(() => Promise.resolve()),
      probeWorkspaceCapability,
    } as unknown as RemoteApi;
    const client = await loadFreshWorkerClient(
      api,
      new Response(new Uint8Array([0, 97, 115, 109]), {
        headers: { "content-type": "application/wasm" },
      }),
    );

    await expect(client.probeWorkerWorkspaceCapability()).resolves.toEqual({
      status: "ready",
      evictionProtected: true,
    });
    await expect(client.probeWorkerWorkspaceCapability()).resolves.toEqual({
      status: "unavailable",
      reason: "Origin-private file storage is open but not writable: quota",
    });
    expect(probeWorkspaceCapability).toHaveBeenCalledTimes(2);

    compileStreaming.mockRestore();
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

describe("review summary reuse cache (ETag semantics for the 2+ MB summary)", () => {
  function summaryResult(
    digest: string,
    bytes: Uint8Array,
  ): ProcessedFileResult {
    return {
      outputFileName: "out.csv",
      reviewSummaryJsonBytes: bytes,
      rustReviewReceipt: { reviewSummaryDigest: digest },
    } as unknown as ProcessedFileResult;
  }

  function reusedResult(digest?: string): ProcessedFileResult {
    return {
      outputFileName: "out.csv",
      reviewSummaryReused: true,
      rustReviewReceipt: digest ? { reviewSummaryDigest: digest } : undefined,
    } as unknown as ProcessedFileResult;
  }

  function reviewPool(results: Array<ProcessedFileResult | Error>) {
    const seenDigests: Array<string[] | undefined> = [];
    const harness = stubSpawn({
      processPersistedReview: vi.fn((...args: unknown[]) => {
        seenDigests.push(args[7] as string[] | undefined);
        const next = results.shift();
        if (!next) throw new Error("test queue exhausted");
        if (next instanceof Error) return Promise.reject(next);
        return Promise.resolve(next);
      }),
    });
    return { pool: new WorkerPool(1, harness.spawn), seenDigests };
  }

  function dispatch(pool: WorkerPool, inputSha: string) {
    return processPersistedOrRawChangedReviewViaPool(
      pool,
      "pair.csv",
      3,
      vi.fn(),
      {} as BrowserProcessingOptions,
      undefined,
      undefined,
      inputSha,
    );
  }

  it("stores a fresh summary, offers its digest, and reattaches bytes on reuse", async () => {
    const inputSha = "a".repeat(64);
    const bytes = new Uint8Array([10, 20, 30]);
    const { pool, seenDigests } = reviewPool([
      summaryResult("digest-1", bytes),
      reusedResult("digest-1"),
    ]);
    const first = await dispatch(pool, inputSha);
    expect(seenDigests[0]).toBeUndefined();
    expect(first.reviewSummaryJsonBytes).toBe(bytes);

    const second = await dispatch(pool, inputSha);
    expect(seenDigests[1]).toEqual(["digest-1"]);
    expect(second.reviewSummaryReused).toBe(true);
    expect(second.reviewSummaryJsonBytes).toBe(bytes);
    pool.terminate();
    clearReviewSummaryReuseCache();
  });

  it("throws when the runtime reuses a digest the client never stored", async () => {
    const { pool } = reviewPool([
      reusedResult("digest-unknown"),
      reusedResult(undefined),
    ]);
    await expect(dispatch(pool, "b".repeat(64))).rejects.toThrow(
      "runtime reused a review summary the client no longer holds",
    );
    await expect(dispatch(pool, "b".repeat(64))).rejects.toThrow(
      "runtime reused a review summary the client no longer holds",
    );
    pool.terminate();
    clearReviewSummaryReuseCache();
  });

  it("evicts the oldest digest beyond capacity and refreshes recency on reuse", async () => {
    const inputSha = "c".repeat(64);
    const digests = Array.from({ length: 9 }, (_, i) => `digest-${i + 1}`);
    const { pool, seenDigests } = reviewPool([
      ...digests
        .slice(0, 8)
        .map((d, i) => summaryResult(d, new Uint8Array([i]))),
      reusedResult("digest-1"),
      summaryResult("digest-9", new Uint8Array([9])),
      reusedResult("digest-2"),
    ]);
    for (let i = 0; i < 8; i += 1) await dispatch(pool, inputSha);
    // Reuse digest-1: moves it to newest, so the next store evicts digest-2.
    await dispatch(pool, inputSha);
    await dispatch(pool, inputSha);
    // digest-2 was evicted, so a runtime claiming to reuse it is a contract
    // violation.
    await expect(dispatch(pool, inputSha)).rejects.toThrow(
      "runtime reused a review summary the client no longer holds",
    );
    // The offer that final dispatch carried shows the post-eviction LRU order.
    expect(seenDigests.at(-1)).toEqual([
      "digest-3",
      "digest-4",
      "digest-5",
      "digest-6",
      "digest-7",
      "digest-8",
      "digest-1",
      "digest-9",
    ]);
    pool.terminate();
    clearReviewSummaryReuseCache();
  });

  it("clearReviewSummaryReuseCache forgets every stored summary", async () => {
    const inputSha = "d".repeat(64);
    const { pool, seenDigests } = reviewPool([
      summaryResult("digest-1", new Uint8Array([1])),
      summaryResult("digest-2", new Uint8Array([2])),
    ]);
    await dispatch(pool, inputSha);
    clearReviewSummaryReuseCache();
    await dispatch(pool, inputSha);
    expect(seenDigests[1]).toBeUndefined();
    pool.terminate();
    clearReviewSummaryReuseCache();
  });

  it("applies reuse across the shared-worker persisted/raw review path", async () => {
    const inputSha = "e".repeat(64);
    const bytes = new Uint8Array([7, 8]);
    const persistedCalls: Array<string[] | undefined> = [];
    const api = {
      initializeRuntime: vi.fn(() => Promise.resolve()),
      hasComparisonSupportFiles: vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true),
      cacheComparisonSupportFiles: vi.fn(() => Promise.resolve()),
      processPersistedReview: vi.fn((...args: unknown[]) => {
        persistedCalls.push(args[7] as string[] | undefined);
        return Promise.resolve(
          persistedCalls.length === 1 ? null : reusedResult("digest-shared"),
        );
      }),
      processReviewCsvBytes: vi.fn(() =>
        Promise.resolve(summaryResult("digest-shared", bytes)),
      ),
    } as unknown as RemoteApi;
    const module = {} as WebAssembly.Module;
    const compileStreaming = vi
      .spyOn(WebAssembly, "compileStreaming")
      .mockResolvedValue(module);
    try {
      const client = await loadFreshWorkerClient(
        api,
        new Response(new Uint8Array([0, 97, 115, 109]), {
          headers: { "content-type": "application/wasm" },
        }),
      );
      const load = vi
        .fn()
        .mockResolvedValue(new Uint8Array([1]).buffer);
      const run = () =>
        client.processPersistedOrRawChangedReview(
          "pair.csv",
          3,
          load,
          {} as BrowserProcessingOptions,
          undefined,
          undefined,
          inputSha,
          "support-key",
        );

      const first = await run();
      expect(load).toHaveBeenCalledTimes(1);
      expect(api.cacheComparisonSupportFiles).toHaveBeenCalledTimes(1);
      expect(first.reviewSummaryJsonBytes).toBe(bytes);
      expect(persistedCalls[0]).toBeUndefined();

      const second = await run();
      expect(load).toHaveBeenCalledTimes(1);
      expect(api.cacheComparisonSupportFiles).toHaveBeenCalledTimes(1);
      expect(api.hasComparisonSupportFiles).not.toHaveBeenCalled();
      expect(persistedCalls[1]).toEqual(["digest-shared"]);
      expect(second.reviewSummaryReused).toBe(true);
      expect(second.reviewSummaryJsonBytes).toBe(bytes);
    } finally {
      compileStreaming.mockRestore();
    }
  });
});
