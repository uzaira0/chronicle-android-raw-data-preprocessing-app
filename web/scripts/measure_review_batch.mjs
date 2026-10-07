/**
 * Same-raw-path View-tab comparison batch: DUPLICATE-CONTENT evidence only.
 *
 * `fileCount` workspaces, all carrying the bytes of one raw file under
 * different names, are split across `workerCount` child processes. Each child
 * first does what the app does for every one of its files — a Process run with
 * the A options into a persisted workspace — then waits; all children start
 * the comparison together, and each runs the B-option comparison for its files
 * through the app's persisted-then-raw review path. A separate cold,
 * non-persisted B review is the oracle every comparison must match. Because
 * every file has the same bytes — and the app keys a workspace by content, so
 * every name in one child shares one persisted workspace — this measures
 * concurrent cost, never the cost of distinct inputs;
 * `measure_unique_review_batch.mjs` is the distinct-input harness.
 *
 * Usage: node scripts/measure_review_batch.mjs <raw.csv> [files] [workers] [case]
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import {
  loadRuntimeWorkflowQueries,
  verifyQueryStatuses,
} from "./runtime_workflow_queries.mjs";

const raw = path.resolve(
  process.argv[2] ?? "../.tmp-benchmark/chronicle-synthetic-100000.csv",
);
const fileCount = Number(process.argv[3] ?? "100");
const workerCount = Number(process.argv[4] ?? "8");
const benchmarkCase = process.argv[5] ?? "middle_concurrent_usage";
if (
  !new Set([
    "upstream_timezone_policy",
    "middle_concurrent_usage",
    "middle_minimum_usage_duration",
    "downstream_day_coverage",
    "output_study_name",
  ]).has(benchmarkCase)
) {
  throw new Error(`unsupported benchmark case: ${benchmarkCase}`);
}
if (!Number.isSafeInteger(fileCount) || fileCount < 1) {
  throw new Error("file count must be a positive integer");
}
if (!Number.isSafeInteger(workerCount) || workerCount < 1) {
  throw new Error("worker count must be a positive integer");
}

const runtimePackage = process.env.CHRONICLE_BENCHMARK_RUNTIME_DIR
  ? path.resolve(process.env.CHRONICLE_BENCHMARK_RUNTIME_DIR)
  : null;
// Read the query registry from the same runtime package the helper runs.
const queryIds = (await loadRuntimeWorkflowQueries(runtimePackage ?? undefined))
  .map((query) => query.id);
if (queryIds.length === 0 || new Set(queryIds).size !== queryIds.length) {
  throw new Error("runtime workflow query registry must be non-empty and unique");
}

const executable = path.resolve("node_modules/.bin/vite-node");
const benchmark = path.resolve("scripts/benchmark_runtime_wasm.mts");
const runtimeArgs = runtimePackage
  ? [
      "--runtime-js",
      path.join(runtimePackage, "chronicle_preprocessing_runtime_wasm.js"),
      "--wasm",
      path.join(runtimePackage, "chronicle_preprocessing_runtime_wasm_bg.wasm"),
    ]
  : [];
const totalStarted = performance.now();

/** @param {string} stdout @param {string} label */
function lastJsonLine(stdout, label) {
  const line = stdout
    .trim()
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith("{"));
  if (!line) throw new Error(`${label} emitted no JSON\n${stdout}`);
  return JSON.parse(line);
}

/**
 * @param {string[]} args
 * @returns {Promise<Record<string, any>>}
 */
function captureProcess(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [benchmark, ...runtimeArgs, ...args], {
      env: { ...process.env, FORCE_COLOR: "0" },
    });
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
            `benchmark helper failed: code=${code} signal=${signal}\n${stderr}`,
          ),
        );
        return;
      }
      try {
        resolve(lastJsonLine(stdout, "benchmark helper"));
      } catch (error) {
        reject(error);
      }
    });
  });
}

/** @typedef {{ready: Promise<void>, start: () => void, complete: Promise<void>, result: Promise<Record<string, any>>}} ShardHandle */
/**
 * @param {number} index
 * @param {number} count
 * @param {number} offset
 * @returns {ShardHandle}
 */
function createShard(index, count, offset) {
  const child = spawn(
    executable,
    [
      benchmark,
      ...runtimeArgs,
      "--raw",
      raw,
      "--mode",
      "warm",
      "--iterations",
      "2",
      "--case",
      benchmarkCase,
      "--materialization",
      "review",
      "--workspace-count",
      String(count),
      "--workspace-offset",
      String(offset),
      "--full-options",
      "--simultaneous-workers",
      String(activeWorkerCount),
      "--wait-for-start",
    ],
    {
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  children.push(child);
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  /** @type {(value?: void) => void} */
  let markComplete = () => {};
  const complete = new Promise((resolve) => {
    markComplete = resolve;
  });
  const ready = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("message", (message) => {
      const type = /** @type {{type?: string}} */ (message)?.type;
      if (type === "ready") resolve(undefined);
      else if (type === "work-complete") markComplete(undefined);
    });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`benchmark shard ${index} exited before ready\n${stderr}`));
    });
  });
  const result = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      // A child that dies mid-batch never sends work-complete; release the
      // wall-clock wait so its failure surfaces through this promise.
      markComplete(undefined);
      if (code !== 0 || signal) {
        reject(
          new Error(
            `benchmark shard ${index} failed: code=${code} signal=${signal}\n${stderr}`,
          ),
        );
        return;
      }
      try {
        resolve(lastJsonLine(stdout, `benchmark shard ${index}`));
      } catch (error) {
        reject(error);
      }
    });
  });
  return {
    ready,
    complete,
    start: () => {
      child.send({ type: "start" });
    },
    result,
  };
}

/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
// One failed shard must not leave the others waiting for a start signal.
process.on("exit", () => {
  for (const child of children) if (child.exitCode === null) child.kill();
});
const activeWorkerCount = Math.min(workerCount, fileCount);
const counts = Array.from(
  { length: activeWorkerCount },
  (_, index) =>
    Math.floor(fileCount / activeWorkerCount) +
    (index < fileCount % activeWorkerCount ? 1 : 0),
);

const oracleStarted = performance.now();
const oracle = await captureProcess([
  "--raw",
  raw,
  "--mode",
  "cold",
  "--iterations",
  "1",
  "--case",
  benchmarkCase,
  "--materialization",
  "review",
  "--full-options",
  "--changed-only",
]);
const coldOracleElapsedMs = performance.now() - oracleStarted;
const [oracleReview] = oracle.results;
if (!oracleReview?.reviewSummaryDigest) {
  throw new Error("cold oracle omitted its review-summary digest");
}
verifyQueryStatuses(oracleReview.queryStatuses, queryIds, oracleReview.cacheSources, "oracle");

const workerStarted = performance.now();
let offset = 0;
const workers = counts.map((count, index) => {
  const shardOffset = offset;
  offset += count;
  return createShard(index, count, shardOffset);
});
await Promise.all(workers.map((worker) => worker.ready));
const processPhaseElapsedMs = performance.now() - workerStarted;

const changedStarted = performance.now();
workers.forEach((worker) => worker.start());
await Promise.all(workers.map((worker) => worker.complete));
const changedWallElapsedMs = performance.now() - changedStarted;
const shards = await Promise.all(workers.map((worker) => worker.result));

/** @type {Array<Record<string, any>>} */
const processRuns = [];
/** @type {Array<Record<string, any>>} */
const reviews = [];
for (const [index, shard] of shards.entries()) {
  if (
    shard.input.sha256 !== oracle.input.sha256 ||
    JSON.stringify(shard.wasm) !== JSON.stringify(oracle.wasm)
  ) {
    throw new Error(`benchmark shard ${index} identity does not match the oracle`);
  }
  const shardProcess = shard.results.filter((/** @type {any} */ result) => result.kind === "process");
  const shardReviews = shard.results.filter((/** @type {any} */ result) => result.kind === "review");
  if (shardProcess.length !== counts[index] || shardReviews.length !== counts[index]) {
    throw new Error(
      `benchmark shard ${index} ran ${shardProcess.length} Process runs and ${shardReviews.length} comparisons, expected ${counts[index]} of each`,
    );
  }
  // `runtimeWorkspaceId` keys a workspace by content, so every name in this
  // shard is one workspace whose head is the shard's last Process run; each
  // comparison must have recovered exactly that head.
  const head = shardProcess.at(-1)?.workspaceRootDigest;
  for (const review of shardReviews) {
    if (!head || review.previousWorkspaceRootDigest !== head) {
      throw new Error(
        `review ${review.inputFileName} did not run against the persisted workspace head`,
      );
    }
  }
  processRuns.push(...shardProcess);
  reviews.push(...shardReviews);
}
/** @type {Record<string, number>} */
const reviewStatusTotals = {};
for (const review of reviews) {
  const label = `review ${review.inputFileName}`;
  if (review.arm !== "B") throw new Error(`${label} did not run the B options`);
  if (review.comparisonDigest !== oracleReview.comparisonDigest) {
    throw new Error(`${label} comparison digest differs from the cold oracle`);
  }
  if (review.reviewSummaryDigest !== oracleReview.reviewSummaryDigest) {
    throw new Error(
      `${label} differs from the cold oracle: ${review.reviewSummaryDigest} != ${oracleReview.reviewSummaryDigest}`,
    );
  }
  if (
    JSON.stringify(review.counts) !== JSON.stringify(oracleReview.counts) ||
    JSON.stringify(review.identity) !== JSON.stringify(oracleReview.identity)
  ) {
    throw new Error(`${label} counts or runtime identity differ from the cold oracle`);
  }
  for (const [status, count] of Object.entries(
    verifyQueryStatuses(review.queryStatuses, queryIds, review.cacheSources, label),
  )) {
    reviewStatusTotals[status] = (reviewStatusTotals[status] ?? 0) + count;
  }
}

/** @param {number[]} values */
function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  /** @param {number} fraction */
  const percentile = (fraction) =>
    sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
  return {
    count: sorted.length,
    minimumMs: sorted[0] ?? 0,
    medianMs: percentile(0.5),
    p90Ms: percentile(0.9),
    p95Ms: percentile(0.95),
    maximumMs: sorted.at(-1) ?? 0,
    meanMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}
const repositoryRoot = path.resolve("..");
/** @param {...string} args */
const git = (...args) =>
  execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
/** @param {string} file */
const hashFile = async (file) =>
  `sha256:${createHash("sha256")
    .update(await readFile(file))
    .digest("hex")}`;
process.stdout.write(
  `${JSON.stringify({
    receiptVersion: "chronicle-same-raw-review-batch/v2",
    workload:
      "DUPLICATE CONTENT: one raw file under fileCount names; each worker Process-runs its files (A options, persisted), then all workers start together and run the View-tab comparison (B options) through queryPersistedRustReview -> queryRustReview; measured time is the comparison only",
    source: {
      gitCommit: git("rev-parse", "HEAD"),
      gitTree: git("rev-parse", "HEAD^{tree}"),
      dirty: git("status", "--porcelain", "--untracked-files=no").length > 0,
      measureScriptDigest: await hashFile(path.resolve("scripts/measure_review_batch.mjs")),
      workerScriptDigest: await hashFile(benchmark),
    },
    input: {
      path: path.relative(repositoryRoot, raw),
      bytes: oracle.input.bytes,
      sha256: oracle.input.sha256,
      counts: oracleReview.counts,
    },
    runtime: oracle.runtime,
    wasm: oracle.wasm,
    runtimeIdentity: oracleReview.identity,
    environment: {
      node: oracle.environment.node,
      platform: oracle.environment.platform,
      architecture: oracle.environment.architecture,
      logicalCpus: oracle.environment.logicalCpus,
      totalMemoryBytes: oracle.environment.totalMemoryBytes,
    },
    fileCount,
    workerCount: counts.length,
    benchmarkCase,
    coldOracleElapsedMs,
    processPhaseElapsedMs,
    changedWallElapsedMs,
    totalElapsedMs: performance.now() - totalStarted,
    proof: {
      exactColdOracleMatches: reviews.length,
      coldOracleReviewSummaryDigest: oracleReview.reviewSummaryDigest,
      persistedReviewHits: reviews.filter((review) => review.persistedReviewHit).length,
      // Within one child, every comparison after the first is offered the
      // digest of the identical earlier one, as the page would offer it.
      reviewSummaryReuses: reviews.filter((review) => review.reviewSummaryReused).length,
      reviewCacheSources: [...new Set(reviews.flatMap((review) => review.cacheSources))],
      reviewQueryStatusTotals: reviewStatusTotals,
    },
    peakPerWorkerRssBytes: Math.max(
      ...shards.map((shard) => shard.environment.peakRssBytes),
    ),
    processRun: distribution(processRuns.map((result) => result.elapsedMs)),
    comparison: distribution(reviews.map((review) => review.elapsedMs)),
    comparisonRawReview: distribution(reviews.map((review) => review.rawReviewMs ?? 0)),
  })}\n`,
);
