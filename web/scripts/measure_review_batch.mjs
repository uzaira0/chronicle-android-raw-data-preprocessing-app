import { spawn } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";

const raw = path.resolve(
  process.argv[2] ?? "../.tmp-benchmark/chronicle-synthetic-100000.csv",
);
const fileCount = Number(process.argv[3] ?? "100");
const workerCount = Number(process.argv[4] ?? "8");
if (!Number.isSafeInteger(fileCount) || fileCount < 1) {
  throw new Error("file count must be a positive integer");
}
if (!Number.isSafeInteger(workerCount) || workerCount < 1) {
  throw new Error("worker count must be a positive integer");
}

const executable = path.resolve("node_modules/.bin/vite-node");
const benchmark = path.resolve("scripts/benchmark_runtime_wasm.mts");
const started = performance.now();

/** @typedef {{measurements: {coldExecuteMs: number[]}}} ShardResult */
/**
 * @param {number} index
 * @param {number} count
 * @param {number} offset
 * @returns {Promise<ShardResult>}
 */
function runShard(index, count, offset) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        benchmark,
        "--raw",
        raw,
        "--mode",
        "cold",
        "--iterations",
        "1",
        "--case",
        "middle_concurrent_usage",
        "--materialization",
        "review",
        "--workspace-count",
        String(count),
        "--workspace-offset",
        String(offset),
        "--full-options",
        "--summary",
        "--compact",
        "--changed-only",
        "--review-base",
      ],
      { env: { ...process.env, FORCE_COLOR: "0" } },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0 || signal) {
        reject(
          new Error(
            `benchmark shard ${index} failed: code=${code} signal=${signal}\n${stderr}`,
          ),
        );
        return;
      }
      const jsonLine = stdout
        .trim()
        .split("\n")
        .reverse()
        .find((line) => line.startsWith("{"));
      if (!jsonLine) {
        reject(
          new Error(`benchmark shard ${index} emitted no JSON\n${stdout}`),
        );
        return;
      }
      resolve(JSON.parse(jsonLine));
    });
  });
}

const counts = Array.from(
  { length: Math.min(workerCount, fileCount) },
  (_, index) =>
    Math.floor(fileCount / workerCount) +
    (index < fileCount % workerCount ? 1 : 0),
);
let offset = 0;
const shards = await Promise.all(
  counts.map((count, index) => {
    const shardOffset = offset;
    offset += count;
    return runShard(index, count, shardOffset);
  }),
);
const values = shards
  .flatMap((shard) => shard.measurements.coldExecuteMs)
  .sort((left, right) => left - right);
/** @param {number} fraction */
const percentile = (fraction) =>
  values[Math.min(values.length - 1, Math.floor(values.length * fraction))] ??
  0;
process.stdout.write(
  `${JSON.stringify({
    fileCount,
    workerCount: counts.length,
    wallElapsedMs: performance.now() - started,
    execute: {
      count: values.length,
      minimumMs: values[0] ?? 0,
      medianMs: percentile(0.5),
      p90Ms: percentile(0.9),
      p95Ms: percentile(0.95),
      maximumMs: values.at(-1) ?? 0,
      meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    },
  })}\n`,
);
