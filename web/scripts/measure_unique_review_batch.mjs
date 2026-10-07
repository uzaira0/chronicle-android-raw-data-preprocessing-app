/**
 * Distinct-input View-tab comparison benchmark.
 *
 * For every CSV in the input directory (each a different seeded file from
 * `generate_benchmark_fixture.mts --realistic`), one child process does what
 * the app does for that file — a Process run with the A options into a
 * persisted workspace, then the A/B comparison with the B options through the
 * app's persisted-then-raw review path — and a second, independent child
 * computes the B review cold from the raw bytes with no persisted state. The
 * two review-summary digests, counts and runtime identities must match, every
 * input must have a distinct SHA-256, and every manifest must report the
 * complete query registry. See `benchmark_runtime_wasm.mts` for the exact
 * entry points.
 *
 * Usage: node scripts/measure_unique_review_batch.mjs <dir> [workers] [case]
 */
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import {
  loadRuntimeWorkflowQueries,
  verifyQueryStatuses,
} from "./runtime_workflow_queries.mjs";

const inputDirectory = path.resolve(
  process.argv[2] ?? "../.tmp-benchmark/unique-100",
);
const workerCount = Number(process.argv[3] ?? "8");
const benchmarkCase = process.argv[4] ?? "middle_minimum_usage_duration";
if (!Number.isSafeInteger(workerCount) || workerCount < 1) {
  throw new Error("worker count must be a positive integer");
}
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

const runtimePackage = process.env.CHRONICLE_BENCHMARK_RUNTIME_DIR
  ? path.resolve(process.env.CHRONICLE_BENCHMARK_RUNTIME_DIR)
  : null;
const queryIds = (await loadRuntimeWorkflowQueries(runtimePackage ?? undefined))
  .map((query) => query.id);
if (queryIds.length === 0 || new Set(queryIds).size !== queryIds.length) {
  throw new Error("runtime workflow query registry must be non-empty and unique");
}
const runtimeArgs = runtimePackage
  ? [
      "--runtime-js",
      path.join(runtimePackage, "chronicle_preprocessing_runtime_wasm.js"),
      "--wasm",
      path.join(runtimePackage, "chronicle_preprocessing_runtime_wasm_bg.wasm"),
    ]
  : [];

const rawFiles = (await readdir(inputDirectory))
  .filter((name) => name.endsWith(".csv"))
  .sort()
  .map((name) => path.join(inputDirectory, name));
if (rawFiles.length === 0) {
  throw new Error(`no CSV inputs found in ${inputDirectory}`);
}

const executable = path.resolve("node_modules/.bin/vite-node");
// The app's pool gives each of its N simultaneous workers the N-worker budget.
const simultaneousWorkers = Math.min(workerCount, rawFiles.length);
const benchmark = path.resolve("scripts/benchmark_runtime_wasm.mts");

/**
 * @param {string} raw
 * @param {"app" | "oracle"} arm
 * @returns {Promise<Record<string, any>>}
 */
function runOne(raw, arm) {
  const args = [
    benchmark,
    ...runtimeArgs,
    "--raw",
    raw,
    "--case",
    benchmarkCase,
    "--materialization",
    "review",
    "--full-options",
    "--simultaneous-workers",
    String(simultaneousWorkers),
    ...(arm === "app"
      ? ["--mode", "warm", "--iterations", "2"]
      : ["--mode", "cold", "--iterations", "1", "--changed-only"]),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
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
            `benchmark helper (${arm}) failed for ${raw}: code=${code} signal=${signal}\n${stderr}`,
          ),
        );
        return;
      }
      const jsonLine = stdout
        .trim()
        .split("\n")
        .reverse()
        .find((line) => line.startsWith("{"));
      try {
        resolve(JSON.parse(jsonLine ?? ""));
      } catch (error) {
        reject(
          new Error(
            `benchmark helper (${arm}) returned invalid JSON for ${raw}: ${error}\n${stdout}\n${stderr}`,
          ),
        );
      }
    });
  });
}

/**
 * @param {Record<string, any>} app
 * @param {Record<string, any>} oracle
 */
function verifyPair(app, oracle) {
  const label = path.basename(app.input.path);
  if (app.input.sha256 !== oracle.input.sha256) {
    throw new Error(`${label}: app and oracle runs used different inputs`);
  }
  if (JSON.stringify(app.wasm) !== JSON.stringify(oracle.wasm)) {
    throw new Error(`${label}: app and oracle runs used different WASM builds`);
  }
  const [processRun, review, ...extra] = app.results;
  const [cold, ...extraCold] = oracle.results;
  if (
    extra.length ||
    extraCold.length ||
    processRun?.kind !== "process" ||
    processRun.arm !== "A" ||
    review?.kind !== "review" ||
    review.arm !== "B" ||
    cold?.kind !== "review" ||
    cold.arm !== "B" ||
    cold.persistedReviewHit !== null
  ) {
    throw new Error(`${label}: helper did not run Process A, review B, oracle B`);
  }
  // The comparison must have consulted the workspace the Process run wrote.
  if (review.previousWorkspaceRootDigest !== processRun.workspaceRootDigest) {
    throw new Error(`${label}: review did not run against the persisted workspace`);
  }
  if (!review.reviewSummaryDigest || review.reviewSummaryDigest !== cold.reviewSummaryDigest) {
    throw new Error(
      `${label}: app review differs from cold oracle: ${review.reviewSummaryDigest} != ${cold.reviewSummaryDigest}`,
    );
  }
  // The comparison digest commits to the options digest and the active support
  // inputs as well as the summary, so it binds which B options both arms ran.
  if (!review.comparisonDigest || review.comparisonDigest !== cold.comparisonDigest) {
    throw new Error(`${label}: app and oracle comparison digests differ`);
  }
  if (JSON.stringify(review.counts) !== JSON.stringify(cold.counts)) {
    throw new Error(`${label}: app review counts differ from the cold oracle`);
  }
  if (
    JSON.stringify(review.identity) !== JSON.stringify(cold.identity) ||
    JSON.stringify(processRun.identity) !== JSON.stringify(cold.identity)
  ) {
    throw new Error(`${label}: app and oracle runtime identities differ`);
  }
  verifyQueryStatuses(processRun.queryStatuses, queryIds, processRun.cacheSources, `${label} process`);
  verifyQueryStatuses(cold.queryStatuses, queryIds, cold.cacheSources, `${label} oracle`);
  const reviewStatusCounts = verifyQueryStatuses(
    review.queryStatuses,
    queryIds,
    review.cacheSources,
    `${label} review`,
  );
  return {
    inputSha256: app.input.sha256,
    inputBytes: app.input.bytes,
    inputRows: review.counts.original,
    processMs: processRun.elapsedMs,
    processKernelMs: processRun.phasesMs.kernel ?? 0,
    reviewMs: review.elapsedMs,
    persistedProbeMs: review.persistedProbeMs,
    rawReviewMs: review.rawReviewMs ?? 0,
    reviewKernelMs: review.phasesMs.kernel ?? 0,
    reviewPreflightMs: review.phasesMs["scientific-preflight"] ?? 0,
    oracleMs: cold.elapsedMs,
    persistedReviewHit: review.persistedReviewHit,
    reviewSummaryReused: review.reviewSummaryReused,
    persistedResumeBases: processRun.resumeBaseArtifacts.length,
    cacheSources: review.cacheSources,
    reviewStatusCounts,
    reviewSummaryDigest: review.reviewSummaryDigest,
    peakRssBytes: Math.max(app.environment.peakRssBytes, oracle.environment.peakRssBytes),
    wasmLinearMemoryBytes: Math.max(
      app.environment.wasmLinearMemoryBytes ?? 0,
      oracle.environment.wasmLinearMemoryBytes ?? 0,
    ),
    wasm: app.wasm,
    environment: app.environment,
    runtime: app.runtime,
    runtimeIdentity: review.identity,
  };
}

const started = performance.now();
/** @type {Array<ReturnType<typeof verifyPair>>} */
const results = new Array(rawFiles.length);
let nextIndex = 0;
async function runWorker() {
  for (;;) {
    const index = nextIndex;
    nextIndex += 1;
    const raw = rawFiles[index];
    if (!raw) return;
    const app = await runOne(raw, "app");
    const oracle = await runOne(raw, "oracle");
    results[index] = verifyPair(app, oracle);
  }
}
await Promise.all(
  Array.from({ length: Math.min(workerCount, rawFiles.length) }, runWorker),
);

const uniqueInputs = new Set(results.map((result) => result.inputSha256));
if (uniqueInputs.size !== rawFiles.length) {
  throw new Error(
    `expected ${rawFiles.length} distinct inputs, received ${uniqueInputs.size}`,
  );
}
const uniqueResults = new Set(results.map((result) => result.reviewSummaryDigest));
const first = results[0];
if (!first) throw new Error("no file produced a result");
if (
  results.some(
    (result) =>
      JSON.stringify(result.wasm) !== JSON.stringify(first.wasm) ||
      JSON.stringify(result.runtimeIdentity) !==
        JSON.stringify(first.runtimeIdentity),
  )
) {
  throw new Error("unique-file workers did not use one exact runtime build");
}
/** @param {number[]} values */
function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (/** @type {number} */ fraction) =>
    sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
  return {
    count: sorted.length,
    minimum: sorted[0] ?? 0,
    median: percentile(0.5),
    p90: percentile(0.9),
    p95: percentile(0.95),
    maximum: sorted.at(-1) ?? 0,
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
  };
}
/** @type {Record<string, number>} */
const reviewStatusTotals = {};
for (const result of results) {
  for (const [status, count] of Object.entries(result.reviewStatusCounts)) {
    reviewStatusTotals[status] = (reviewStatusTotals[status] ?? 0) + count;
  }
}
/** @param {(result: (typeof results)[number]) => number} pick */
const over = (pick) => distribution(results.map(pick));

process.stdout.write(
  `${JSON.stringify({
    receiptVersion: "chronicle-unique-review-batch/v2",
    workload:
      "per distinct file: Process run (A options, persisted workspace), then the View-tab comparison (B options) through queryPersistedRustReview -> queryRustReview, checked against a cold non-persisted B review in a separate process",
    inputDirectory,
    inputCount: rawFiles.length,
    uniqueInputDigests: uniqueInputs.size,
    uniqueReviewSummaryDigests: uniqueResults.size,
    workerCount: Math.min(workerCount, rawFiles.length),
    benchmarkCase,
    runtime: first.runtime,
    wasm: first.wasm,
    runtimeIdentity: first.runtimeIdentity,
    environment: {
      node: first.environment.node,
      platform: first.environment.platform,
      architecture: first.environment.architecture,
      logicalCpus: first.environment.logicalCpus,
      totalMemoryBytes: first.environment.totalMemoryBytes,
    },
    exactQueryRegistryResults: results.length * 3,
    exactColdOracleMatches: results.length,
    persistedReviewHits: results.filter((result) => result.persistedReviewHit).length,
    reviewSummaryReuses: results.filter((result) => result.reviewSummaryReused).length,
    persistedResumeBasesWritten: results.reduce(
      (total, result) => total + result.persistedResumeBases,
      0,
    ),
    reviewCacheSources: [...new Set(results.flatMap((result) => result.cacheSources))],
    reviewQueryStatusTotals: reviewStatusTotals,
    wallElapsedMs: performance.now() - started,
    inputBytes: over((result) => result.inputBytes),
    inputRows: over((result) => result.inputRows),
    processMs: over((result) => result.processMs),
    processKernelMs: over((result) => result.processKernelMs),
    reviewMs: over((result) => result.reviewMs),
    persistedProbeMs: over((result) => result.persistedProbeMs),
    rawReviewMs: over((result) => result.rawReviewMs),
    reviewKernelMs: over((result) => result.reviewKernelMs),
    reviewPreflightMs: over((result) => result.reviewPreflightMs),
    coldOracleReviewMs: over((result) => result.oracleMs),
    maximumChildPeakRssBytes: Math.max(...results.map((result) => result.peakRssBytes)),
    maximumWasmLinearMemoryBytes: Math.max(
      ...results.map((result) => result.wasmLinearMemoryBytes),
    ),
  })}\n`,
);
