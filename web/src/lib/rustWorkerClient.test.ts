import { afterAll, describe, expect, it, vi } from "vitest";
import type * as Comlink from "comlink";
import {
  discoverTimezones,
  discoverTimezonesBytes,
  exportVerifiedWorkspaceClosure,
  getRuntimeVersion,
  getPlanStageView,
  importVerifiedWorkspaceClosure,
  inspectRawCsvBytes,
  processRawCsv,
  processRawCsvBytes,
  processRawCsvReviewBytes,
  processRawCsvBytesViaPool,
  processRawCsvIsolated,
  processRawCsvViaPool,
  warmRuntime,
  WorkerPool,
  type WorkerSpawn,
} from "@/lib/rustWorkerClient";
import type { ChronicleWorkerApi } from "@/workers/chronicle-worker";
import type { ProcessedFileResult } from "@/lib/types";

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
    const fault = deferred<never>();
    faults.push(fault);
    const index = terminated.push(false) - 1;
    const api = {
      runtimeVersion: () => Promise.resolve("stub"),
      processRawCsv: (...args: unknown[]) => {
        calls.push(`plain:${String(args[0])}`);
        return Promise.resolve(result);
      },
      processRawCsvWithProgress: (...args: unknown[]) => {
        calls.push(`progress:${String(args[0])}`);
        return Promise.resolve(result);
      },
      processRawCsvBytes: (...args: unknown[]) => {
        calls.push(
          `bytes:${String(args[0])}:${(args[1] as ArrayBuffer).byteLength}`,
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
    const { spawn, faults } = stubSpawn({ processRawCsv: () => gate.promise });
    const pool = new WorkerPool(1, spawn);
    const running = pool.submit((api) => api.processRawCsv("a.csv", ""));
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
  it("processRawCsvViaPool picks the progress variant only when a callback is given", async () => {
    const { spawn, calls, result } = stubSpawn();
    const pool = new WorkerPool(1, spawn);
    await expect(processRawCsvViaPool(pool, "plain.csv", "")).resolves.toBe(
      result,
    );
    await expect(
      processRawCsvViaPool(
        pool,
        "prog.csv",
        "",
        undefined,
        undefined,
        undefined,
        () => {},
      ),
    ).resolves.toBe(result);
    expect(calls).toEqual(["plain:plain.csv", "progress:prog.csv"]);
    pool.terminate();
  });

  it("processRawCsvBytesViaPool transfers the byte payload", async () => {
    const { spawn, calls, result } = stubSpawn();
    const pool = new WorkerPool(1, spawn);
    const bytes = new TextEncoder().encode("study_id\nS").buffer;
    await expect(processRawCsvBytesViaPool(pool, "b.csv", bytes)).resolves.toBe(
      result,
    );
    expect(calls).toEqual([`bytes:b.csv:${bytes.byteLength}`]);
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

    const retry = discoverTimezones("study_id\nS");
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

  it("processRawCsv rejects via the fault race, with and without a progress proxy", async () => {
    const noProgress = processRawCsv("a.csv", "study_id\nS");
    lastWorker().fire("error", { message: "dead" });
    await expect(noProgress).rejects.toThrow("Chronicle worker failed: dead");

    const withProgress = processRawCsv(
      "a.csv",
      "study_id\nS",
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

    const review = processRawCsvReviewBytes(
      "raw.csv",
      new Uint8Array([1, 2, 3]).buffer,
    );
    lastWorker().fire("error", { message: "review failed" });
    await expect(review).rejects.toThrow("review failed");
  });

  it("processRawCsvIsolated tears its private one-shot pool down on fault", async () => {
    const pending = processRawCsvIsolated("a.csv", "study_id\nS");
    const worker = lastWorker();
    worker.fire("error", { message: "isolated crash" });
    await expect(pending).rejects.toThrow(
      "Chronicle worker failed: isolated crash",
    );
    expect(worker.terminated).toBe(true);
  });
});
