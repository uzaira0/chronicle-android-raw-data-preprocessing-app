import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChronicleWorkerApi } from "@/workers/chronicle-worker";
import type { ProcessedFileResult } from "@/lib/types";

type MockWorker = { terminate: ReturnType<typeof vi.fn> };

let api: Partial<ChronicleWorkerApi>;
const workers: MockWorker[] = [];

function processedResult(inputFileName = "Raw P01.csv"): ProcessedFileResult {
  return {
    inputFileName,
    outputs: [],
    originalRowCount: 0,
    processedRowCount: 0,
    availableTimezones: [],
    timezone: "UTC",
    appRowCount: 0,
    screenRowCount: 0,
    timezoneAction: "none",
    rowsBeforeTimezoneHandling: 0,
    rowsAfterTimezoneHandling: 0,
    rowsRemovedByTimezone: 0,
    duplicateTimestampsCorrected: 0,
    exactDuplicateRowsRemoved: 0,
  };
}

vi.mock("comlink", () => ({
  wrap: vi.fn(() => api),
  proxy: vi.fn((callback) => callback),
  transfer: vi.fn((value) => value),
}));

beforeEach(() => {
  vi.resetModules();
  workers.length = 0;
  api = {
    matcherVersion: vi.fn(async () => "matcher-test"),
    discoverTimezones: vi.fn(async () => ["America/Chicago"]),
    processRawCsv: vi.fn(async (inputFileName) => processedResult(inputFileName)),
    processRawCsvWithProgress: vi.fn(async (_name, _csv, _options, _support, _runtime, progress) => {
      progress({ type: "file-start", fileName: _name });
      return processedResult(_name);
    }),
    processRawCsvBytes: vi.fn(async (inputFileName) => processedResult(inputFileName)),
  };
  class TestWorker {
    terminate = vi.fn();
    addEventListener = vi.fn();

    constructor() {
      workers.push(this);
    }
  }
  vi.stubGlobal(
    "Worker",
    TestWorker,
  );
});

describe("shared Chronicle worker wrappers", () => {
  it("reuses the shared worker for version, timezone, and raw CSV calls", async () => {
    const matcher = await import("@/lib/chronicleMatcher");

    await expect(matcher.getMatcherVersion()).resolves.toBe("matcher-test");
    await expect(matcher.discoverTimezones("csv", { datetimeOfPreprocessing: "now" })).resolves.toEqual([
      "America/Chicago",
    ]);
    await matcher.processRawCsv("Raw P01.csv", "csv");

    expect(workers).toHaveLength(1);
    expect(api.matcherVersion).toHaveBeenCalledTimes(1);
    expect(api.discoverTimezones).toHaveBeenCalledWith("csv", { datetimeOfPreprocessing: "now" });
    expect(api.processRawCsv).toHaveBeenCalledWith("Raw P01.csv", "csv", undefined, undefined, undefined);
  });

  it("warmUpWorker forces WASM initialisation through matcherVersion", async () => {
    const matcher = await import("@/lib/chronicleMatcher");

    await matcher.warmUpWorker();

    expect(workers).toHaveLength(1);
    expect(api.matcherVersion).toHaveBeenCalledTimes(1);
  });

  it("proxies progress callbacks for shared and pooled processing", async () => {
    const matcher = await import("@/lib/chronicleMatcher");
    const onProgress = vi.fn();

    await matcher.processRawCsv("Raw P01.csv", "csv", {}, {}, {}, onProgress);
    const pool = new matcher.WorkerPool(1);
    await matcher.processRawCsvViaPool(pool, "Raw P02.csv", "csv", {}, {}, {}, onProgress);

    expect(onProgress).toHaveBeenCalledWith({ type: "file-start", fileName: "Raw P01.csv" });
    expect(onProgress).toHaveBeenCalledWith({ type: "file-start", fileName: "Raw P02.csv" });
    expect(api.processRawCsvWithProgress).toHaveBeenCalledTimes(2);
    pool.terminate();
  });

  it("transfers byte buffers through pooled and isolated worker helpers", async () => {
    const matcher = await import("@/lib/chronicleMatcher");
    const pool = new matcher.WorkerPool(1);
    const bytes = new Uint8Array([1, 2, 3]).buffer;

    await matcher.processRawCsvBytesViaPool(pool, "Raw P01.csv", bytes, {}, {}, {}, vi.fn());
    await matcher.processRawCsvBytesViaPool(pool, "Raw P01-no-progress.csv", new Uint8Array([4]).buffer);
    await matcher.processRawCsvIsolated("Raw P02.csv", "csv");

    expect(api.processRawCsvBytes).toHaveBeenCalledWith(
      "Raw P01.csv",
      bytes,
      {},
      {},
      {},
      expect.any(Function),
    );
    expect(api.processRawCsvBytes).toHaveBeenCalledWith(
      "Raw P01-no-progress.csv",
      expect.any(ArrayBuffer),
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(api.processRawCsv).toHaveBeenCalledWith("Raw P02.csv", "csv", undefined, undefined, undefined);
    pool.terminate();
    expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  });
});
