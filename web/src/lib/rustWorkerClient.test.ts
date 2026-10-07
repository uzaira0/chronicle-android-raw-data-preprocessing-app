import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as Comlink from "comlink";
import {
  beginRawInspectionBatch,
  comparisonSupportCacheKey,
  discoverTimezonesBytes,
  exportVerifiedWorkspaceClosure,
  getRuntimeVersion,
  getWorkflowExplorerView,
  onWorkerBackgroundFailure,
  importVerifiedWorkspaceClosure,
  inspectRawCsvBytes,
  clearReviewSummaryReuseCache,
  reviewSummaryReuseRetainedBytes,
  setReviewSummaryReuseBudgetBytesForTesting,
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
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  parseWorkerBackgroundFailure,
  WORKER_BACKGROUND_FAILURE_MESSAGE,
} from "@/lib/workerBackgroundFailure";
import { runtimeScientificPreflightFixture } from "@/testSupport/runtimeScientificPreflightFixture";

// Node's built-in fetch (undici) compiles its HTTP parser with
// WebAssembly.compile the first time a Response body is read. A test that
// spies on WebAssembly.compile would count that call as the client's, so the
// count depended on whether an earlier test happened to touch a Response
// first. Warm the parser once, before any spy is installed.
beforeAll(async () => {
  const response = new Response(new Uint8Array([0]));
  await response.clone().arrayBuffer();
  await response.arrayBuffer();
});

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
  it("releases idle warm workers when a later run grows one heap past the shared budget", async () => {
    const gib = 1024 ** 3;
    const terminated = [vi.fn(), vi.fn(), vi.fn()];
    let spawned = 0;
    const pool = new WorkerPool(3, () => ({
      api: {} as RemoteApi,
      worker: { terminate: terminated[spawned++]! },
    }));
    pool.setRetainedMemoryBudget(8);
    await Promise.all(
      ["a", "b", "c"].map((digest) =>
        pool.submit(
          () => Promise.resolve({ workerWasmMemoryBytes: gib }),
          digest,
        ),
      ),
    );
    expect(pool.size).toBe(3);

    await pool.submit(
      () => Promise.resolve({ workerWasmMemoryBytes: 3 * gib }),
      "a",
    );

    expect(pool.size).toBe(1);
    expect(terminated.filter((terminate) => terminate.mock.calls.length)).toHaveLength(2);
    await pool.submit(
      () => Promise.resolve({ workerWasmMemoryBytes: 5 * gib }),
      "a",
    );
    expect(pool.usable).toBe(false);
    expect(terminated.every((terminate) => terminate.mock.calls.length === 1)).toBe(true);
    pool.terminate();
  });

  it("retires a warm worker whose heap may grow before its task rejects", async () => {
    const gib = 1024 ** 3;
    const terminated = [vi.fn(), vi.fn(), vi.fn()];
    let spawned = 0;
    const pool = new WorkerPool(3, () => ({
      api: {} as RemoteApi,
      worker: { terminate: terminated[spawned++]! },
    }));
    pool.setRetainedMemoryBudget(8);
    await Promise.all(["a", "b", "c"].map((digest) =>
      pool.submit(() => Promise.resolve({ workerWasmMemoryBytes: gib }), digest),
    ));

    await expect(pool.submit(
      () => Promise.reject(new Error("comparison rejected after heap growth")),
      "a",
    )).rejects.toThrow("comparison rejected after heap growth");

    expect(terminated[0]).toHaveBeenCalledOnce();
    expect(terminated[1]).not.toHaveBeenCalled();
    expect(terminated[2]).not.toHaveBeenCalled();
    expect(pool.usable).toBe(true);
    pool.terminate();
  });

  it("releases the whole warm pool when any worker faults", async () => {
    const { spawn, faults, terminated } = stubSpawn();
    const onFault = vi.fn(() => pool.terminate());
    const pool = new WorkerPool(2, { spawn, onFault });

    faults[0]!.reject(new Error("worker failed"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onFault).toHaveBeenCalledTimes(1);
    expect(terminated).toEqual([true, true]);
    expect(pool.usable).toBe(false);
  });

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
    const pool = new WorkerPool(1, {
      spawn: throwingSpawn,
      maxTasksPerWorker: 1,
    });
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

  it("reports an all-dead initialization pool as unusable so comparison retry can replace it", async () => {
    const ready = deferred<void>();
    const failed = new WorkerPool(1, () => ({
      api: {} as RemoteApi,
      worker: { terminate: vi.fn() },
      ready: ready.promise,
    }));
    expect(failed.usable).toBe(true);
    ready.reject(new Error("offline during worker initialization"));
    await Promise.resolve();
    await Promise.resolve();
    expect(failed.usable).toBe(false);
    await expect(
      failed.submit(() => Promise.resolve("stale")),
    ).rejects.toThrow("All Chronicle workers have failed");

    const fresh = new WorkerPool(1, makeSpawn().spawn);
    expect(fresh.usable).toBe(true);
    await expect(fresh.submit(() => Promise.resolve("online"))).resolves.toBe(
      "online",
    );
    failed.terminate();
    fresh.terminate();
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
  it("rehydrates an exact typed scientific refusal without an execute fallback", async () => {
    const receipt = runtimeScientificPreflightFixture();
    const harness = stubSpawn({
      processRawCsvBytes: () =>
        // The worker deliberately throws a plain structured-clone carrier;
        // Comlink Error serialization would discard the typed receipt.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        Promise.reject({
          kind: "chronicle-scientific-preflight-refusal/v1",
          message: "typed scientific refusal",
          receipt,
        }),
    });
    const pool = new WorkerPool(1, harness.spawn);
    const failure = await processRawCsvBytesViaPool(
      pool,
      "refused.csv",
      new Uint8Array([1]).buffer,
      { ...DEFAULT_BROWSER_OPTIONS, processScreenUsage: true },
      undefined,
      undefined,
      undefined,
      "1".repeat(64),
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({
      code: "scientific_preflight_refused",
      receipt,
    });
    pool.terminate();
  });

  it("threads active partition metadata through every raw lane and detaches inactive metadata", async () => {
    const fullCalls: unknown[][] = [];
    const reviewCalls: unknown[][] = [];
    const result = { outputFileName: "out.csv" } as unknown as ProcessedFileResult;
    const harness = stubSpawn({
      processRawCsvBytes: (...args: unknown[]) => {
        fullCalls.push(args);
        return Promise.resolve(result);
      },
      processReviewCsvBytes: (...args: unknown[]) => {
        reviewCalls.push(args);
        return Promise.resolve(result);
      },
      processPersistedReview: vi.fn().mockResolvedValue(null),
    });
    const pool = new WorkerPool(1, harness.spawn);
    const batch = {
      participantPartitionBatchId: `sha256:${"a".repeat(64)}`,
      secret: new Uint8Array(32).fill(4),
    };
    const partition = {
      participantPartitionBatchId: batch.participantPartitionBatchId,
      fragmentedParticipantTokens: [`sha256:${"b".repeat(64)}`],
    };
    const active = { ...DEFAULT_BROWSER_OPTIONS, processScreenUsage: true };

    await processRawCsvBytesViaPool(
      pool,
      "full.csv",
      new Uint8Array([1]).buffer,
      active,
      undefined,
      undefined,
      undefined,
      "1".repeat(64),
      partition,
      batch,
    );
    await processRawCsvChangedReviewBytesViaPool(
      pool,
      "review.csv",
      new Uint8Array([2]).buffer,
      active,
      undefined,
      undefined,
      "2".repeat(64),
      partition,
      batch,
    );
    await processPersistedOrRawChangedReviewViaPool(
      pool,
      "fallback.csv",
      1,
      () => Promise.resolve(new Uint8Array([3]).buffer),
      active,
      undefined,
      undefined,
      "3".repeat(64),
      undefined,
      partition,
      batch,
    );
    await processRawCsvBytesViaPool(
      pool,
      "inactive.csv",
      new Uint8Array([4]).buffer,
      { ...DEFAULT_BROWSER_OPTIONS, processScreenUsage: false },
      undefined,
      undefined,
      undefined,
      "4".repeat(64),
      partition,
      batch,
    );

    expect(fullCalls[0]?.[7]).toEqual(partition);
    expect(fullCalls[0]?.[8]).toBeInstanceOf(ArrayBuffer);
    expect(reviewCalls[0]?.[8]).toEqual(partition);
    expect(reviewCalls[0]?.[9]).toBeInstanceOf(ArrayBuffer);
    expect(reviewCalls[1]?.[8]).toEqual(partition);
    expect(reviewCalls[1]?.[9]).toBeInstanceOf(ArrayBuffer);
    expect(fullCalls[1]?.[7]).toBeUndefined();
    expect(fullCalls[1]?.[8]).toBeUndefined();
    expect(batch.secret).toEqual(new Uint8Array(32).fill(4));
    pool.terminate();
  });

  it("wipes a changed-review secret copy when pool acquisition is terminated", async () => {
    const { spawn } = makeSpawn();
    const pool = new WorkerPool(1, spawn);
    const batch = {
      participantPartitionBatchId: `sha256:${"a".repeat(64)}`,
      secret: new Uint8Array(32).fill(0x26),
    };
    const transient = new Uint8Array(32).fill(0x26);
    vi.spyOn(batch.secret, "slice").mockReturnValue(transient);
    const pending = processRawCsvChangedReviewBytesViaPool(
      pool,
      "review.csv",
      new Uint8Array([1]).buffer,
      { ...DEFAULT_BROWSER_OPTIONS, processScreenUsage: true },
      undefined,
      undefined,
      "1".repeat(64),
      {
        participantPartitionBatchId: batch.participantPartitionBatchId,
        fragmentedParticipantTokens: [`sha256:${"b".repeat(64)}`],
      },
      batch,
    );
    pool.terminate();
    await expect(pending).rejects.toThrow("Worker pool has been terminated");
    expect(transient).toEqual(new Uint8Array(32));
    expect(batch.secret).toEqual(new Uint8Array(32).fill(0x26));
  });

  it("wipes a persisted-fallback secret when termination wins during deferred raw loading", async () => {
    const load = deferred<ArrayBuffer>();
    const rpcNeverSettles = new Promise<ProcessedFileResult>(() => {});
    const persistedCalled = deferred<void>();
    const harness = stubSpawn({
      processPersistedReview: vi.fn(() => {
        persistedCalled.resolve();
        return Promise.resolve(null);
      }),
      processReviewCsvBytes: vi.fn(() => rpcNeverSettles),
    });
    const pool = new WorkerPool(1, harness.spawn);
    const batch = {
      participantPartitionBatchId: `sha256:${"a".repeat(64)}`,
      secret: new Uint8Array(32).fill(0x31),
    };
    const transient = new Uint8Array(32).fill(0x31);
    vi.spyOn(batch.secret, "slice").mockReturnValue(transient);
    const pending = processPersistedOrRawChangedReviewViaPool(
      pool,
      "fallback.csv",
      3,
      () => load.promise,
      { ...DEFAULT_BROWSER_OPTIONS, processScreenUsage: true },
      undefined,
      undefined,
      "1".repeat(64),
      undefined,
      {
        participantPartitionBatchId: batch.participantPartitionBatchId,
        fragmentedParticipantTokens: [`sha256:${"b".repeat(64)}`],
      },
      batch,
    );
    await persistedCalled.promise;
    pool.terminate();
    await expect(pending).rejects.toThrow("Worker pool has been terminated");
    expect(transient).toEqual(new Uint8Array(32));
    load.resolve(new Uint8Array([1, 2, 3]).buffer);
    await Promise.resolve();
    expect(transient).toEqual(new Uint8Array(32));
    expect(batch.secret).toEqual(new Uint8Array(32).fill(0x31));
  });

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
    expect(harness.calls.filter((call) => call.startsWith("support:"))).toEqual(
      [`support:${key}`],
    );
    expect(
      harness.calls.filter((call) => call.startsWith("persisted:")),
    ).toHaveLength(2);
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
    if (firstBundle === undefined)
      throw new Error("expected three support bundles");
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
    expect(
      harness.calls.filter((call) => call === `support:${firstBundle.key}`),
    ).toHaveLength(2);
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
  static deferReady = false;
  listeners = new Map<string, Array<(event: unknown) => void>>();
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(handler);
    this.listeners.set(type, bucket);
    if (type === "message" && !FakeWorker.deferReady) {
      queueMicrotask(() => handler({ data: { type: "chronicle-worker-api-ready/v1" } }));
    }
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
// The fault-handling tests below use the module-level client, which fetches the
// runtime WASM before initializing a worker. Unstubbed, that is a real request
// to http://localhost/; where something answers on port 80 the response lands
// during a later test and its WebAssembly.compileStreaming/compile calls are
// counted by that test's spies. These tests settle through the fault race and
// never need the module, so the fetch never settles.
vi.stubGlobal(
  "fetch",
  vi.fn(() => new Promise<Response>(() => {})),
);
afterAll(() => vi.unstubAllGlobals());

function lastWorker(): FakeWorker {
  return FakeWorker.instances.at(-1)!;
}

describe("worker background failures (fake Worker global)", () => {
  it("hands a worker's background failure to every listener until it unsubscribes", () => {
    const heard: unknown[] = [];
    const stop = onWorkerBackgroundFailure((failure) => heard.push(failure));
    void getRuntimeVersion().catch(() => undefined);
    const worker = lastWorker();
    worker.fire("message", { data: { type: WORKER_BACKGROUND_FAILURE_MESSAGE, operation: "spill-sweep", message: "disk" } });
    // Comlink replies and the ready announcement are not background failures.
    worker.fire("message", { data: { type: "chronicle-worker-api-ready/v1" } });
    worker.fire("message", { data: null });
    stop();
    worker.fire("message", { data: { type: WORKER_BACKGROUND_FAILURE_MESSAGE, operation: "spill-sweep", message: "later" } });
    expect(heard).toEqual([{ operation: "spill-sweep", message: "disk" }]);
    worker.fire("error", { message: "end of test" });
  });

  it("parses only well-formed background failure messages", () => {
    expect(parseWorkerBackgroundFailure({ type: WORKER_BACKGROUND_FAILURE_MESSAGE, operation: "other", message: "x" })).toBeNull();
    expect(parseWorkerBackgroundFailure({ type: WORKER_BACKGROUND_FAILURE_MESSAGE, operation: "spill-sweep", message: 1 })).toBeNull();
    expect(parseWorkerBackgroundFailure("text")).toBeNull();
  });
});

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

  it("wipes inspection and active-run secret copies when shared initialization faults", async () => {
    const beginSecret = new Uint8Array(32).fill(0x31);
    const begin = beginRawInspectionBatch(beginSecret.buffer);
    lastWorker().fire("error", { message: "begin init failed" });
    await expect(begin).rejects.toThrow("begin init failed");
    expect(beginSecret).toEqual(new Uint8Array(32));

    const batch = {
      participantPartitionBatchId: `sha256:${"a".repeat(64)}`,
      secret: new Uint8Array(32).fill(0x42),
    };
    const transient = new Uint8Array(32).fill(0x42);
    vi.spyOn(batch.secret, "slice").mockReturnValue(transient);
    const processing = processRawCsvBytes(
      "raw.csv",
      new Uint8Array([1]).buffer,
      { ...DEFAULT_BROWSER_OPTIONS, processScreenUsage: true },
      undefined,
      undefined,
      undefined,
      "1".repeat(64),
      {
        participantPartitionBatchId: batch.participantPartitionBatchId,
        fragmentedParticipantTokens: [`sha256:${"b".repeat(64)}`],
      },
      batch,
    );
    lastWorker().fire("error", { message: "processing init failed" });
    await expect(processing).rejects.toThrow("processing init failed");
    expect(transient).toEqual(new Uint8Array(32));
    expect(batch.secret).toEqual(new Uint8Array(32).fill(0x42));
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

    const view = getWorkflowExplorerView(
      {} as Parameters<typeof getWorkflowExplorerView>[0],
    );
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
  detachTransfers = false,
): Promise<typeof import("@/lib/rustWorkerClient")> {
  vi.resetModules();
  vi.doMock("comlink", () => ({
    wrap: vi.fn(() => api),
    transfer: vi.fn((value: unknown) =>
      detachTransfers && value instanceof ArrayBuffer
        ? structuredClone(value, { transfer: [value] })
        : value,
    ),
    proxy: vi.fn((value: unknown) => value),
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response)),
  );
  return import("@/lib/rustWorkerClient");
}

describe("shared worker successful routing and WASM compilation", () => {
  it("rejects comparison warm-up if the worker fails before exposing its API", async () => {
    FakeWorker.deferReady = true;
    const api = { initializeRuntime: vi.fn(() => Promise.resolve()), setComparisonCacheCapacity: vi.fn() } as unknown as RemoteApi;
    const client = await loadFreshWorkerClient(api, new Response("unused", { status: 503 }));
    const pool = new client.WorkerPool(1);
    try {
      const pending = pool.setComparisonCacheCapacity(2);
      lastWorker().fire("error", { message: "corrupt packed worker contract" });
      await expect(pending).rejects.toThrow("Chronicle worker failed: corrupt packed worker contract");
      expect(api.initializeRuntime).not.toHaveBeenCalled();
      expect(api.setComparisonCacheCapacity).not.toHaveBeenCalled();
    } finally { pool.terminate(); FakeWorker.deferReady = false; }
  });

  it("waits for worker API exposure before sending initialization despite an already compiled module", async () => {
    FakeWorker.deferReady = true;
    const api = {
      initializeRuntime: vi.fn(() => Promise.resolve()),
      runtimeVersion: vi.fn(() => Promise.resolve("ready")),
    } as unknown as RemoteApi;
    const compile = vi.spyOn(WebAssembly, "compileStreaming").mockResolvedValue({});
    try {
      const client = await loadFreshWorkerClient(api, new Response(new Uint8Array([0, 97, 115, 109]), {
        headers: { "content-type": "application/wasm" },
      }));
      const pending = client.getRuntimeVersion();
      await vi.waitFor(() => expect(compile).toHaveBeenCalled());
      lastWorker().fire("message", {});
      lastWorker().fire("message", { data: { type: "foreign-ready" } });
      await Promise.resolve();
      expect(api.initializeRuntime).not.toHaveBeenCalled();
      lastWorker().fire("message", { data: { type: "chronicle-worker-api-ready/v1" } });
      await expect(pending).resolves.toBe("ready");
      expect(api.initializeRuntime).toHaveBeenCalledOnce();
    } finally { FakeWorker.deferReady = false; compile.mockRestore(); }
  });

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

  it("clears a rejected module fetch and creates a fresh shared worker after connectivity recovers", async () => {
    const api = {
      initializeRuntime: vi.fn(() => Promise.resolve()),
      runtimeVersion: vi.fn(() => Promise.resolve("online")),
    } as unknown as RemoteApi;
    const client = await loadFreshWorkerClient(
      api,
      new Response("placeholder", { status: 500 }),
    );
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(new Response("offline", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0, 97, 115, 109]), {
          headers: { "content-type": "application/wasm" },
        }),
      );
    const compileStreaming = vi
      .spyOn(WebAssembly, "compileStreaming")
      .mockResolvedValue({});
    const before = FakeWorker.instances.length;

    await expect(client.getRuntimeVersion()).rejects.toThrow(
      "Could not load the Rust runtime (503)",
    );
    expect(FakeWorker.instances[before]?.terminated).toBe(true);
    await expect(client.getRuntimeVersion()).resolves.toBe("online");
    expect(FakeWorker.instances.length).toBe(before + 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(api.initializeRuntime).toHaveBeenCalledTimes(1);
    compileStreaming.mockRestore();
  });

  it("clears a rejected compilation promise instead of memoizing it", async () => {
    const api = {
      initializeRuntime: vi.fn(() => Promise.resolve()),
      runtimeVersion: vi.fn(() => Promise.resolve("compiled-on-retry")),
    } as unknown as RemoteApi;
    const client = await loadFreshWorkerClient(
      api,
      new Response(new Uint8Array([0, 97, 115, 109])),
    );
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0, 97, 115, 109])),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0, 97, 115, 109])),
      );
    const compileStreaming = vi
      .spyOn(WebAssembly, "compileStreaming")
      .mockRejectedValue(new TypeError("stream unavailable"));
    const compile = vi
      .spyOn(WebAssembly, "compile")
      .mockRejectedValueOnce(new Error("compile failed"))
      .mockResolvedValueOnce({});

    await expect(client.getRuntimeVersion()).rejects.toThrow("compile failed");
    await expect(client.getRuntimeVersion()).resolves.toBe(
      "compiled-on-retry",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(compile).toHaveBeenCalledTimes(2);
    compileStreaming.mockRestore();
    compile.mockRestore();
  });

  it("evicts a shared worker whose initializeRuntime call rejects", async () => {
    const api = {
      initializeRuntime: vi
        .fn()
        .mockRejectedValueOnce(new Error("initialization refused"))
        .mockResolvedValueOnce(undefined),
      runtimeVersion: vi.fn(() => Promise.resolve("fresh-worker")),
    } as unknown as RemoteApi;
    const client = await loadFreshWorkerClient(
      api,
      new Response(new Uint8Array([0, 97, 115, 109]), {
        headers: { "content-type": "application/wasm" },
      }),
    );
    const compileStreaming = vi
      .spyOn(WebAssembly, "compileStreaming")
      .mockResolvedValue({});
    const before = FakeWorker.instances.length;

    await expect(client.getRuntimeVersion()).rejects.toThrow(
      "initialization refused",
    );
    expect(FakeWorker.instances[before]?.terminated).toBe(true);
    await expect(client.getRuntimeVersion()).resolves.toBe("fresh-worker");
    expect(FakeWorker.instances.length).toBe(before + 2);
    expect(api.initializeRuntime).toHaveBeenCalledTimes(2);
    compileStreaming.mockRestore();
  });

  it("detaches a successfully transferred inspection secret", async () => {
    const api = {
      initializeRuntime: vi.fn(() => Promise.resolve()),
      beginRawInspectionBatch: vi.fn(() =>
        Promise.resolve(`sha256:${"a".repeat(64)}`),
      ),
    } as unknown as RemoteApi;
    const client = await loadFreshWorkerClient(
      api,
      new Response(new Uint8Array([0, 97, 115, 109]), {
        headers: { "content-type": "application/wasm" },
      }),
      true,
    );
    const compileStreaming = vi
      .spyOn(WebAssembly, "compileStreaming")
      .mockResolvedValue({});
    const secret = new Uint8Array(32).fill(0x55);
    await expect(client.beginRawInspectionBatch(secret.buffer)).resolves.toBe(
      `sha256:${"a".repeat(64)}`,
    );
    expect(secret.byteLength).toBe(0);
    compileStreaming.mockRestore();
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
      imported.slot.workspaceRootDigest,
    );
    expect(api.exportWorkspaceClosure).toHaveBeenCalledWith(imported.workspaceId, imported.slot.workspaceRootDigest);
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
      client.getWorkflowExplorerView({} as BrowserProcessingOptions, [
        { roleId: "filter_file", present: true },
      ]),
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
    expect(api.workflowExplorerView).toHaveBeenCalledWith({}, [
      { roleId: "filter_file", present: true },
    ]);
    expect(api.processRawCsvBytes).toHaveBeenCalledWith(
      "raw.csv",
      expect.any(ArrayBuffer),
      {},
      undefined,
      undefined,
      progress,
      "digest",
      undefined,
      undefined,
    );
    const pool = new client.WorkerPool(1, { maxTasksPerWorker: 2 });
    await expect(
      pool.submit((workerApi) => workerApi.runtimeVersion()),
    ).resolves.toBe("runtime-v1");
    pool.terminate();

    compileStreaming.mockRestore();
    compile.mockRestore();
  });

  it("transfers a mixed-study upload to the worker splitter and returns its per-study files", async () => {
    const compileStreaming = vi
      .spyOn(WebAssembly, "compileStreaming")
      .mockResolvedValue({});
    const received: number[][] = [];
    const studyA = new Uint8Array([1]).buffer;
    const studyB = new Uint8Array([2, 3]).buffer;
    const api = {
      initializeRuntime: vi.fn(() => Promise.resolve()),
      splitRawCsvByStudy: vi.fn((bytes: ArrayBuffer) => {
        received.push([...new Uint8Array(bytes)]);
        return Promise.resolve([
          { studyId: "study-a", bytes: studyA },
          { studyId: "study-b", bytes: studyB },
        ]);
      }),
      garbageCollectWorkspace: vi.fn(() => Promise.resolve(3)),
    } as unknown as RemoteApi;
    const client = await loadFreshWorkerClient(
      api,
      new Response(new Uint8Array([0, 97, 115, 109]), {
        headers: { "content-type": "application/wasm" },
      }),
      true,
    );
    try {
      const upload = new Uint8Array([7, 8, 9]).buffer;
      await expect(client.splitRawCsvByStudy(upload)).resolves.toEqual([
        { studyId: "study-a", bytes: studyA },
        { studyId: "study-b", bytes: studyB },
      ]);
      // The upload is handed over, not copied: the main thread keeps no
      // second copy of the raw participant file.
      expect(upload.byteLength).toBe(0);
      expect(received).toEqual([[7, 8, 9]]);

      const workspaceId = `sha256:${"1".repeat(64)}`;
      await expect(
        client.garbageCollectWorkspaceAfterResults(workspaceId),
      ).resolves.toBeUndefined();
      expect(api.garbageCollectWorkspace).toHaveBeenCalledTimes(1);
      expect(api.garbageCollectWorkspace).toHaveBeenCalledWith(workspaceId);
    } finally {
      compileStreaming.mockRestore();
    }
  });

  it("deletes each named workspace once in the worker and stops at the first refusal", async () => {
    const compileStreaming = vi
      .spyOn(WebAssembly, "compileStreaming")
      .mockResolvedValue({});
    const first = `sha256:${"1".repeat(64)}`;
    const second = `sha256:${"2".repeat(64)}`;
    const third = `sha256:${"3".repeat(64)}`;
    const deleteWorkspace = vi.fn((workspaceId: string) =>
      workspaceId === second
        ? Promise.reject(new Error("workspace in use"))
        : Promise.resolve(),
    );
    const api = {
      initializeRuntime: vi.fn(() => Promise.resolve()),
      deleteWorkspace,
    } as unknown as RemoteApi;
    const client = await loadFreshWorkerClient(
      api,
      new Response(new Uint8Array([0, 97, 115, 109]), {
        headers: { "content-type": "application/wasm" },
      }),
    );
    try {
      await expect(
        client.deletePersistedWorkspaces([first, first]),
      ).resolves.toBeUndefined();
      expect(deleteWorkspace.mock.calls).toEqual([[first]]);

      deleteWorkspace.mockClear();
      await expect(
        client.deletePersistedWorkspaces([second, third]),
      ).rejects.toThrow("workspace in use");
      // The caller is told the deletion failed; nothing after it was tried.
      expect(deleteWorkspace.mock.calls).toEqual([[second]]);
    } finally {
      compileStreaming.mockRestore();
    }
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

  it("routes a raw-inspection batch disposal to the shared worker and returns its verdict", async () => {
    const disposeRawInspectionBatch = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const api = {
      initializeRuntime: vi.fn(() => Promise.resolve()),
      disposeRawInspectionBatch,
    } as unknown as RemoteApi;
    const client = await loadFreshWorkerClient(
      api,
      new Response(new Uint8Array([0, 97, 115, 109]), {
        headers: { "content-type": "application/wasm" },
      }),
    );
    const compileStreaming = vi
      .spyOn(WebAssembly, "compileStreaming")
      .mockResolvedValue({});
    const batchId = `sha256:${"a".repeat(64)}`;

    await expect(client.disposeRawInspectionBatch(batchId)).resolves.toBe(true);
    await expect(client.disposeRawInspectionBatch(batchId)).resolves.toBe(false);
    expect(disposeRawInspectionBatch).toHaveBeenCalledWith(batchId);
    compileStreaming.mockRestore();
  });

  it("rehydrates a worker-side scientific preflight refusal envelope into a typed error", async () => {
    // The worker throws the structured-cloneable envelope built by
    // serializeScientificPreflightRefusal; the client boundary is where it
    // becomes an Error again, so callers see one refusal shape everywhere.
    // The worker throws a plain structured-cloneable envelope, never an Error;
    // that is the whole point of the transport.
    const envelope = {
      kind: "chronicle-scientific-preflight-refusal/v1",
      message: "Scientific preflight refused (B05).",
      receipt: runtimeScientificPreflightFixture(),
    } as unknown as Error;
    const api = {
      initializeRuntime: vi.fn(() => Promise.resolve()),
      runtimeVersion: vi.fn(() => Promise.reject(envelope)),
    } as unknown as RemoteApi;
    const client = await loadFreshWorkerClient(
      api,
      new Response(new Uint8Array([0, 97, 115, 109]), {
        headers: { "content-type": "application/wasm" },
      }),
    );
    const compileStreaming = vi
      .spyOn(WebAssembly, "compileStreaming")
      .mockResolvedValue({});

    const refusal: unknown = await client
      .getRuntimeVersion()
      .then(() => undefined, (error: unknown) => error);
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).name).toBe("RustScientificPreflightRefusalError");
    expect((refusal as Error).message).toBe(
      "Scientific preflight refused (B05).",
    );
    compileStreaming.mockRestore();
  });

  it("transfers the inspection-batch secret alongside the partition on both live-preflight routes", async () => {
    const result = { inputFileName: "raw.csv" } as ProcessedFileResult;
    // The secret is wiped as soon as the call settles, so the bytes that
    // crossed the boundary have to be read inside the call itself.
    const transferred: Array<{ partition: unknown; secret: Uint8Array }> = [];
    const record = (...args: unknown[]) => {
      transferred.push({
        partition: args[args.length - 2],
        secret: new Uint8Array(args[args.length - 1] as ArrayBuffer).slice(),
      });
      return Promise.resolve(result);
    };
    const api = {
      initializeRuntime: vi.fn(() => Promise.resolve()),
      processRawCsvBytes: vi.fn(record),
      processReviewCsvBytes: vi.fn(record),
    } as unknown as RemoteApi;
    const client = await loadFreshWorkerClient(
      api,
      new Response(new Uint8Array([0, 97, 115, 109]), {
        headers: { "content-type": "application/wasm" },
      }),
    );
    const compileStreaming = vi
      .spyOn(WebAssembly, "compileStreaming")
      .mockResolvedValue({});
    const partition = {
      participantPartitionBatchId: `sha256:${"a".repeat(64)}`,
      fragmentedParticipantTokens: [`sha256:${"b".repeat(64)}`],
    };
    const batch = () => ({
      participantPartitionBatchId: partition.participantPartitionBatchId,
      secret: new Uint8Array(32).fill(0x42),
    });
    const options = { ...DEFAULT_BROWSER_OPTIONS, processScreenUsage: true };

    await expect(
      client.processRawCsvBytes(
        "raw.csv",
        new ArrayBuffer(2),
        options,
        undefined,
        undefined,
        undefined,
        "digest",
        partition,
        batch(),
      ),
    ).resolves.toBe(result);
    await expect(
      client.processRawCsvReviewBytes(
        "raw.csv",
        new ArrayBuffer(2),
        options,
        undefined,
        undefined,
        "digest",
        partition,
        batch(),
      ),
    ).resolves.toBe(result);

    expect(transferred).toHaveLength(2);
    for (const crossing of transferred) {
      expect(crossing.partition).toBe(partition);
      expect(crossing.secret).toEqual(new Uint8Array(32).fill(0x42));
    }
    compileStreaming.mockRestore();
  });
});

describe("exact partition secret", () => {
  const partition = {
    participantPartitionBatchId: `sha256:${"a".repeat(64)}`,
    fragmentedParticipantTokens: [`sha256:${"b".repeat(64)}`],
  };
  const liveOptions = { ...DEFAULT_BROWSER_OPTIONS, processScreenUsage: true };

  it.each([
    ["no inspection batch survives the reselection", undefined],
    [
      "the batch belongs to a different partition",
      {
        participantPartitionBatchId: `sha256:${"c".repeat(64)}`,
        secret: new Uint8Array(32),
      },
    ],
    [
      "the batch secret is not the 32-byte worker secret",
      {
        participantPartitionBatchId: `sha256:${"a".repeat(64)}`,
        secret: new Uint8Array(16),
      },
    ],
  ])("refuses a live-preflight run when %s", async (_label, batch) => {
    await expect(
      processRawCsvBytes(
        "raw.csv",
        new ArrayBuffer(2),
        liveOptions,
        undefined,
        undefined,
        undefined,
        "digest",
        partition,
        batch,
      ),
    ).rejects.toThrow(
      "Participant partition metadata expired; re-select and re-inspect the raw files.",
    );
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
      const load = vi.fn().mockResolvedValue(new Uint8Array([1]).buffer);
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

  it("bounds the outer per-input map by retained bytes, keeping recent inputs reusable", async () => {
    // The post-run pre-warm in App.tsx submits EVERY unique input digest of a
    // batch, so without an outer bound a 124-file study retains 124 x 8
    // multi-MB summaries on the main thread for the life of the tab. Shrink the
    // ceiling instead of allocating a quarter of a gigabyte here.
    setReviewSummaryReuseBudgetBytesForTesting(300);
    const shas = ["a", "b", "c", "d"].map((letter) => letter.repeat(64));
    const { pool, seenDigests } = reviewPool([
      summaryResult("digest-a", new Uint8Array(100)),
      summaryResult("digest-b", new Uint8Array(100)),
      summaryResult("digest-c", new Uint8Array(100)),
      summaryResult("digest-d", new Uint8Array(100)),
      reusedResult("digest-d"),
      summaryResult("digest-a2", new Uint8Array(100)),
    ]);
    try {
      for (const sha of shas) await dispatch(pool, sha);
      // Four 100-byte summaries against a 300-byte ceiling: the
      // least-recently-touched input is dropped whole, not merely counted.
      expect(reviewSummaryReuseRetainedBytes()).toBe(300);

      // Within the bound, reuse still hits: the newest input keeps offering
      // its digest and gets its exact bytes reattached.
      const reused = await dispatch(pool, shas[3]!);
      expect(seenDigests[4]).toEqual(["digest-d"]);
      expect(reused.reviewSummaryReused).toBe(true);
      expect(reviewSummaryReuseRetainedBytes()).toBe(300);

      // The evicted input offers nothing and simply recomputes — the
      // pre-cache behaviour, never an error.
      await dispatch(pool, shas[0]!);
      expect(seenDigests[5]).toBeUndefined();
      expect(reviewSummaryReuseRetainedBytes()).toBe(300);
    } finally {
      pool.terminate();
      clearReviewSummaryReuseCache();
      setReviewSummaryReuseBudgetBytesForTesting(0);
    }
  });

  it("honours a digest a concurrent request evicted after it was offered", async () => {
    // Two reviews of the same verified input can be in flight together (the
    // post-run pre-warm walks every digest through the comparison pool while
    // the drawer warm-up reviews the selected file on the shared worker). The
    // digests are snapshotted before the request; if the other request stores a
    // ninth summary meanwhile, the promised digest leaves the LRU and a
    // perfectly valid review used to fail hard with "client no longer holds".
    const inputSha = "f".repeat(64);
    const firstBytes = new Uint8Array([1, 1, 1]);
    const seenDigests: Array<string[] | undefined> = [];
    const gate = deferred<ProcessedFileResult>();
    const ninthIssued = deferred<void>();
    let calls = 0;
    const harness = stubSpawn({
      processPersistedReview: vi.fn((...args: unknown[]) => {
        seenDigests.push(args[7] as string[] | undefined);
        calls += 1;
        if (calls <= 8) {
          return Promise.resolve(
            summaryResult(
              `digest-${calls}`,
              calls === 1 ? firstBytes : new Uint8Array([calls]),
            ),
          );
        }
        if (calls === 9) {
          ninthIssued.resolve();
          return gate.promise;
        }
        return Promise.resolve(
          summaryResult("digest-9", new Uint8Array([9, 9])),
        );
      }),
    });
    const pool = new WorkerPool(2, harness.spawn);
    try {
      for (let index = 0; index < 8; index += 1) await dispatch(pool, inputSha);

      // Request A offers digest-1..digest-8 and is held mid-flight.
      const pending = dispatch(pool, inputSha);
      await ninthIssued.promise;
      expect(seenDigests[8]).toContain("digest-1");

      // Request B lands a ninth summary, evicting digest-1 from the LRU that
      // request A already promised it from.
      await dispatch(pool, inputSha);
      // Observe the LIVE LRU through a fresh request's offer: this fails
      // loudly if digest-1 was NOT evicted (e.g. a raised capacity constant),
      // instead of leaving the pinned path silently unexercised. Asserting
      // the snapshot the tenth request carried could never fail -- digest-9
      // does not exist until that request resolves.
      const { pool: evictionProbe, seenDigests: evictionOffer } = reviewPool([
        reusedResult("digest-2"),
      ]);
      await dispatch(evictionProbe, inputSha);
      evictionProbe.terminate();
      expect(evictionOffer[0]).not.toContain("digest-1");
      expect(evictionOffer[0]).toContain("digest-9");

      // A now legitimately reuses digest-1. The pinned offer keeps the exact
      // buffer alive, so the review succeeds and re-admits the digest.
      gate.resolve(reusedResult("digest-1"));
      const reused = await pending;
      expect(reused.reviewSummaryReused).toBe(true);
      expect(reused.reviewSummaryJsonBytes).toBe(firstBytes);

      // Re-admitted as newest, so the next request offers it again.
      const { pool: probePool, seenDigests: probeDigests } = reviewPool([
        reusedResult("digest-1"),
      ]);
      const again = await dispatch(probePool, inputSha);
      expect(probeDigests[0]).toContain("digest-1");
      expect(again.reviewSummaryJsonBytes).toBe(firstBytes);
      probePool.terminate();
    } finally {
      pool.terminate();
      clearReviewSummaryReuseCache();
    }
  });

  it("purges a detached summary at offer time instead of advertising it", async () => {
    // Presence is not possession: a transferred Uint8Array is still truthy but
    // carries no bytes. A digest whose buffer was detached is dropped from the
    // cache at the next offer -- with its ADMITTED size subtracted, so the
    // byte accounting cannot drift -- and is never advertised, so the runtime
    // recomputes instead of promising bytes the client cannot hand over. A
    // runtime that claims reuse of the never-offered digest anyway hits the
    // protocol-violation refusal.
    const inputSha = "g".repeat(64);
    const transferable = new Uint8Array(new ArrayBuffer(8));
    const { pool, seenDigests } = reviewPool([
      summaryResult("digest-detached", transferable),
      reusedResult("digest-detached"),
    ]);
    try {
      await dispatch(pool, inputSha);
      expect(reviewSummaryReuseRetainedBytes()).toBe(8);
      structuredClone(transferable.buffer, {
        transfer: [transferable.buffer],
      });
      expect(transferable.byteLength).toBe(0);
      await expect(dispatch(pool, inputSha)).rejects.toThrow(
        "runtime reused a review summary the client no longer holds",
      );
      expect(seenDigests[1]).toBeUndefined();
      expect(reviewSummaryReuseRetainedBytes()).toBe(0);
    } finally {
      pool.terminate();
      clearReviewSummaryReuseCache();
    }
  });

  it("refuses to reattach a summary detached after it was offered", async () => {
    // The narrow interleaving the offer-time purge cannot cover: the buffer
    // detaches between the offer snapshot and the runtime's "reused" answer,
    // so even the pinned copy is empty. Reattaching it would publish an empty
    // summary; the refusal names the release, and the purge stops the next
    // offer from advertising the dead digest again.
    const inputSha = "h".repeat(64);
    const transferable = new Uint8Array(new ArrayBuffer(8));
    const gate = deferred<ProcessedFileResult>();
    const offered = deferred<void>();
    let calls = 0;
    const harness = stubSpawn({
      processPersistedReview: vi.fn(() => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(
            summaryResult("digest-late-detach", transferable),
          );
        }
        offered.resolve();
        return gate.promise;
      }),
    });
    const pool = new WorkerPool(1, harness.spawn);
    try {
      await dispatch(pool, inputSha);
      const pending = dispatch(pool, inputSha);
      await offered.promise;
      // The offer snapshot exists; now the cached buffer detaches under it.
      structuredClone(transferable.buffer, {
        transfer: [transferable.buffer],
      });
      gate.resolve(reusedResult("digest-late-detach"));
      await expect(pending).rejects.toThrow(
        "runtime reused a review summary whose cached bytes were released",
      );
      // Purged: the next request offers nothing for this input.
      const { pool: probePool, seenDigests: probeDigests } = reviewPool([
        summaryResult("digest-fresh", new Uint8Array([5])),
      ]);
      await dispatch(probePool, inputSha);
      probePool.terminate();
      expect(probeDigests[0]).toBeUndefined();
    } finally {
      pool.terminate();
      clearReviewSummaryReuseCache();
    }
  });
});
