import { describe, expect, it, vi } from "vitest";
import type * as Comlink from "comlink";
import { WorkerPool, type WorkerSpawn } from "@/lib/chronicleMatcher";
import type { ChronicleWorkerApi } from "@/workers/chronicle-worker";

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

describe("WorkerPool", () => {
  it("creates exactly `size` workers regardless of submitted task count", async () => {
    const { spawn, workers } = makeSpawn();
    const pool = new WorkerPool(3, spawn);
    expect(workers).toHaveLength(3);

    const tasks = Array.from({ length: 50 }, (_, index) => index);
    await Promise.all(tasks.map((value) => pool.submit(async () => value)));

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
    const queued = pool.submit(async () => "queued");

    pool.terminate();
    releaseBlocker();
    await blocker;
    await expect(queued).rejects.toThrow(/terminated/);
  });

  it("rounds non-integer or sub-1 sizes up to a single worker", () => {
    const { spawn, workers } = makeSpawn();
    const pool = new WorkerPool(0.4, spawn);
    expect(workers).toHaveLength(1);
    pool.terminate();
  });

  it("rejects new work after termination", async () => {
    const { spawn } = makeSpawn();
    const pool = new WorkerPool(1, spawn);

    expect(pool.size).toBe(1);
    pool.terminate();

    await expect(pool.submit(async () => "late")).rejects.toThrow(/terminated/);
  });
});
