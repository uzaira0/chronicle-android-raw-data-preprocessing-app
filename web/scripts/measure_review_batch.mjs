import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const raw = path.resolve(
  process.argv[2] ?? "../.tmp-benchmark/chronicle-synthetic-100000.csv",
);
const fileCount = Number(process.argv[3] ?? "100");
const workerCount = Number(process.argv[4] ?? "8");
const benchmarkCase = process.argv[5] ?? "middle_concurrent_usage";
if (
  !new Set(["middle_concurrent_usage", "middle_minimum_usage_duration"]).has(
    benchmarkCase,
  )
) {
  throw new Error("benchmark case must be a supported middle-pipeline change");
}
if (!Number.isSafeInteger(fileCount) || fileCount < 1) {
  throw new Error("file count must be a positive integer");
}
if (!Number.isSafeInteger(workerCount) || workerCount < 1) {
  throw new Error("worker count must be a positive integer");
}

const stepIds = [
  "parse_remap_config",
  "csv_parse",
  "drop_empty_timestamp",
  "detect_device_model",
  "resolve_preproc_datetime",
  "build_canonical_rows",
  "stable_sort",
  "collect_timezones",
  "compute_dominant_timezone",
  "select_timezone_strategy",
  "restamp_rows",
  "row_count_report",
  "exact_dedupe",
  "count_dup_groups",
  "nudge_duplicate_timestamps",
  "mark_data_time_gaps",
  "tag_filtered_packages",
  "collect_keyguard_timestamps",
  "walk_screen_state_machine",
  "build_classified_sessions",
  "compute_junk_packages",
  "junk_blind_fold",
  "build_matcher_input",
  "run_matcher",
  "apply_matcher_output",
  "relabel_usage_with_floor",
  "junk_downstream_mark",
  "sort_episodes",
  "split_concurrent",
  "codebook_join",
  "derive_broad_category",
  "collapse_genre",
  "engagement_walk",
  "flag_and_retain",
  "blank_junk_timing",
  "drop_selected_types",
  "drop_zero_duration",
  "partition_credit_sessions",
  "build_liveness_substrate",
  "report_screen_incapable",
  "count_day_apps",
  "credit_sessions",
  "emit_credited_rows",
  "assemble_credit_result",
  "resolve_participant_windows",
  "filter_rows_to_window",
  "resolve_sharing_status",
  "build_survey_lookup",
  "attribute_rows",
  "inject_placeholders",
  "build_raw_date_index",
  "build_coverage_table",
  "accumulate_attribution_minutes",
  "score_days",
  "assemble_result",
];
const skippedSteps = new Set(stepIds.slice(37, 44).concat("build_raw_date_index"));
const bypassedSteps = new Set([
  "build_coverage_table",
  "accumulate_attribution_minutes",
  "score_days",
]);
const recomputedSteps = new Set([
  ...(benchmarkCase === "middle_concurrent_usage"
    ? stepIds.slice(20, 28)
    : stepIds.slice(25, 28)),
  ...stepIds.slice(29, 37),
  ...stepIds.slice(44, 50),
  "assemble_result",
]);
const expectedStatuses = Object.fromEntries(
  stepIds.map((step) => [
    step,
    skippedSteps.has(step)
      ? "skipped"
      : bypassedSteps.has(step)
        ? "bypassed"
        : recomputedSteps.has(step)
          ? "recomputed"
          : "cached",
  ]),
);

const executable = path.resolve("node_modules/.bin/vite-node");
const benchmark = path.resolve("scripts/benchmark_runtime_wasm.mts");
const totalStarted = performance.now();

/**
 * @param {string[]} args
 * @returns {Promise<string>}
 */
function captureProcess(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [benchmark, ...args], {
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
      resolve(stdout);
    });
  });
}

/** @typedef {{input: {path: string, bytes: number, sha256: string}, wasm: {bytes: number, sha256: string}, environment: {node: string, platform: string, architecture: string, logicalCpus: number, totalMemoryBytes: number, peakProcessMemoryBytes: {rss: number, heapTotal: number, heapUsed: number, external: number, arrayBuffers: number}}, reviewBaseBytes: number, reconstructionBaseBytes: number, measurements: {coldExecuteMs: number[], coldStepStatuses: Array<Array<[string, string]>>, coldReviewSummaryDigests: Array<string>, coldCacheSources: string[][], coldCounts: Array<{original: number, processed: number, app: number, screen: number}>, coldIdentities: Array<Record<string, string>>}}} ShardResult */
/** @typedef {{ready: Promise<void>, start: () => void, complete: Promise<void>, result: Promise<ShardResult>}} ShardHandle */
/**
 * @param {number} index
 * @param {number} count
 * @param {number} offset
 * @param {string} reviewBasesDir
 * @returns {ShardHandle}
 */
function createShard(index, count, offset, reviewBasesDir) {
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
      benchmarkCase,
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
      "--review-bases-dir",
      reviewBasesDir,
      "--warm-runtime",
      "--wait-for-start",
    ],
    {
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
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
      const readyMessage = /** @type {{type?: string}} */ (message);
      if (readyMessage?.type === "ready") {
        resolve(undefined);
      } else if (readyMessage?.type === "work-complete") {
        markComplete(undefined);
      }
    });
  });
  const result = new Promise((resolve, reject) => {
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
  return {
    ready,
    complete,
    start: () => {
      child.send({ type: "start" });
    },
    result,
  };
}

const activeWorkerCount = Math.min(workerCount, fileCount);
const counts = Array.from(
  { length: activeWorkerCount },
  (_, index) =>
    Math.floor(fileCount / activeWorkerCount) +
    (index < fileCount % activeWorkerCount ? 1 : 0),
);
const reviewBasesDir = await mkdtemp(
  path.join(tmpdir(), "chronicle-review-benchmark-"),
);
/** @type {ShardResult[]} */
let shards = [];
let basePreparationElapsedMs;
let coldOraclePreparationElapsedMs;
let coldOracleReviewSummaryDigest;
let workerPreparationElapsedMs;
let changedWallElapsedMs;
let baseMetadata;
let oracle;
try {
  const baseStarted = performance.now();
  await captureProcess([
    "--raw",
    raw,
    "--mode",
    "cold",
    "--iterations",
    "1",
    "--materialization",
    "review",
    "--full-options",
    "--review-base",
    "--export-review-bases-dir",
    reviewBasesDir,
  ]);
  basePreparationElapsedMs = performance.now() - baseStarted;
  baseMetadata = JSON.parse(
    await readFile(path.join(reviewBasesDir, "metadata.json"), "utf8"),
  );

  const oracleStarted = performance.now();
  const oracleStdout = await captureProcess([
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
    "--summary",
    "--compact",
  ]);
  const oracleLine = oracleStdout
    .trim()
    .split("\n")
    .reverse()
    .find((line) => line.startsWith("{"));
  if (!oracleLine) throw new Error("cold oracle emitted no JSON");
  oracle = JSON.parse(oracleLine);
  coldOracleReviewSummaryDigest =
    oracle.measurements.coldReviewSummaryDigests[0];
  if (!coldOracleReviewSummaryDigest) {
    throw new Error("cold oracle omitted its review-summary digest");
  }
  coldOraclePreparationElapsedMs = performance.now() - oracleStarted;

  const workerStarted = performance.now();
  let offset = 0;
  const workers = counts.map((count, index) => {
    const shardOffset = offset;
    offset += count;
    return createShard(index, count, shardOffset, reviewBasesDir);
  });
  await Promise.all(workers.map((worker) => worker.ready));
  workerPreparationElapsedMs = performance.now() - workerStarted;

  const changedStarted = performance.now();
  workers.forEach((worker) => worker.start());
  await Promise.all(workers.map((worker) => worker.complete));
  changedWallElapsedMs = performance.now() - changedStarted;
  shards = await Promise.all(workers.map((worker) => worker.result));
} finally {
  await rm(reviewBasesDir, { recursive: true, force: true });
}
if (!baseMetadata || !oracle) {
  throw new Error("benchmark preparation did not produce complete metadata");
}
for (const [index, shard] of shards.entries()) {
  const expectedCount = counts[index];
  for (const [name, values] of Object.entries({
    coldExecuteMs: shard.measurements.coldExecuteMs,
    coldStepStatuses: shard.measurements.coldStepStatuses,
    coldReviewSummaryDigests:
      shard.measurements.coldReviewSummaryDigests,
    coldCacheSources: shard.measurements.coldCacheSources,
    coldCounts: shard.measurements.coldCounts,
    coldIdentities: shard.measurements.coldIdentities,
  })) {
    if (!Array.isArray(values) || values.length !== expectedCount) {
      throw new Error(
        `benchmark shard ${index} ${name} count was ${Array.isArray(values) ? values.length : "invalid"}, expected ${expectedCount}`,
      );
    }
  }
  if (
    shard.input.sha256 !== oracle.input.sha256 ||
    shard.input.bytes !== oracle.input.bytes ||
    shard.wasm.sha256 !== oracle.wasm.sha256 ||
    shard.wasm.bytes !== oracle.wasm.bytes ||
    shard.reviewBaseBytes !== baseMetadata.reviewBaseBytes ||
    shard.reconstructionBaseBytes !== baseMetadata.reconstructionBaseBytes
  ) {
    throw new Error(`benchmark shard ${index} identity does not match preparation`);
  }
}
const values = shards
  .flatMap((shard) => shard.measurements.coldExecuteMs)
  .sort((left, right) => left - right);
const stepStatuses = shards.flatMap(
  (shard) => shard.measurements.coldStepStatuses,
);
const reviewSummaryDigests = new Set(
  shards.flatMap((shard) => shard.measurements.coldReviewSummaryDigests),
);
const cacheSources = shards.flatMap(
  (shard) => shard.measurements.coldCacheSources,
);
const resultCounts = shards.flatMap(
  (shard) => shard.measurements.coldCounts,
);
const resultIdentities = shards.flatMap(
  (shard) => shard.measurements.coldIdentities,
);
for (const [name, entries] of Object.entries({
  values,
  stepStatuses,
  cacheSources,
  resultCounts,
  resultIdentities,
})) {
  if (entries.length !== fileCount) {
    throw new Error(
      `benchmark ${name} count was ${entries.length}, expected ${fileCount}`,
    );
  }
}
const workerMemory = {
  rss: Math.max(
    ...shards.map((shard) => shard.environment.peakProcessMemoryBytes.rss),
  ),
  heapTotal: Math.max(
    ...shards.map((shard) => shard.environment.peakProcessMemoryBytes.heapTotal),
  ),
  heapUsed: Math.max(
    ...shards.map((shard) => shard.environment.peakProcessMemoryBytes.heapUsed),
  ),
  external: Math.max(
    ...shards.map((shard) => shard.environment.peakProcessMemoryBytes.external),
  ),
  arrayBuffers: Math.max(
    ...shards.map((shard) => shard.environment.peakProcessMemoryBytes.arrayBuffers),
  ),
};
const expectedCacheSources =
  benchmarkCase === "middle_minimum_usage_duration"
    ? ["verified-reconstruction-base"]
    : ["verified-review-base"];
for (const [resultIndex, entries] of stepStatuses.entries()) {
  const statuses = new Map(entries);
  if (statuses.size !== 55) {
    throw new Error(
      `benchmark result ${resultIndex} reported ${statuses.size} step statuses instead of 55`,
    );
  }
  if (entries.map(([step]) => step).join("\n") !== stepIds.join("\n")) {
    throw new Error(`${benchmarkCase} result ${resultIndex} step order drifted`);
  }
  for (const [step, expected] of Object.entries(expectedStatuses)) {
    if (statuses.get(step) !== expected) {
      throw new Error(
        `${benchmarkCase} result ${resultIndex}: ${step} was ${statuses.get(step)}, expected ${expected}`,
      );
    }
  }
}
const oracleCounts = oracle.measurements.coldCounts?.[0];
const oracleIdentity = oracle.measurements.coldIdentities?.[0];
if (!oracleCounts || !oracleIdentity) {
  throw new Error("cold oracle omitted counts or runtime identities");
}
for (const [resultIndex, countsValue] of resultCounts.entries()) {
  if (JSON.stringify(countsValue) !== JSON.stringify(oracleCounts)) {
    throw new Error(
      `benchmark result ${resultIndex} counts do not match the cold oracle`,
    );
  }
}
for (const [resultIndex, identity] of resultIdentities.entries()) {
  if (JSON.stringify(identity) !== JSON.stringify(oracleIdentity)) {
    throw new Error(
      `benchmark result ${resultIndex} runtime identity does not match the cold oracle`,
    );
  }
}
for (const [resultIndex, sources] of cacheSources.entries()) {
  if (JSON.stringify(sources) !== JSON.stringify(expectedCacheSources)) {
    throw new Error(
      `${benchmarkCase} result ${resultIndex}: cache sources ${JSON.stringify(sources)}, expected ${JSON.stringify(expectedCacheSources)}`,
    );
  }
}
if (reviewSummaryDigests.size !== 1) {
  throw new Error(
    `duplicated inputs produced ${reviewSummaryDigests.size} review-summary digests`,
  );
}
if (![...reviewSummaryDigests].every((digest) => digest === coldOracleReviewSummaryDigest)) {
  throw new Error(
    `persisted-cache result does not match cold oracle ${coldOracleReviewSummaryDigest}`,
  );
}
/** @param {number} fraction */
const percentile = (fraction) =>
  values[Math.min(values.length - 1, Math.floor(values.length * fraction))] ??
  0;
const repositoryRoot = path.resolve("..");
/** @param {...string} args */
const git = (...args) =>
  execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
/** @param {string} file */
const hashFile = async (file) =>
  `sha256:${createHash("sha256").update(await readFile(file)).digest("hex")}`;
const source = {
  gitCommit: git("rev-parse", "HEAD"),
  gitTree: git("rev-parse", "HEAD^{tree}"),
  dirty: git("status", "--porcelain", "--untracked-files=no").length > 0,
  measureScriptDigest: await hashFile(
    path.resolve("scripts/measure_review_batch.mjs"),
  ),
  workerScriptDigest: await hashFile(
    path.resolve("scripts/benchmark_runtime_wasm.mts"),
  ),
};
process.stdout.write(
  `${JSON.stringify({
    receiptVersion: "chronicle-preloaded-review-batch/v1",
    workload:
      "A is already persisted and each worker has executed one untimed warmup; measured time is the B comparison computation only",
    source,
    input: {
      path: path.relative(repositoryRoot, raw),
      bytes: oracle.input.bytes,
      sha256: oracle.input.sha256,
      counts: oracleCounts,
    },
    wasm: oracle.wasm,
    runtimeIdentity: oracleIdentity,
    environment: {
      node: oracle.environment.node,
      platform: oracle.environment.platform,
      architecture: oracle.environment.architecture,
      logicalCpus: oracle.environment.logicalCpus,
      totalMemoryBytes: oracle.environment.totalMemoryBytes,
    },
    persistedBases: {
      review: {
        bytes: baseMetadata.reviewBaseBytes,
        sha256: baseMetadata.reviewBaseSha256,
      },
      reconstruction: {
        bytes: baseMetadata.reconstructionBaseBytes,
        sha256: baseMetadata.reconstructionBaseSha256,
      },
    },
    fileCount,
    workerCount: counts.length,
    benchmarkCase,
    basePreparationElapsedMs,
    coldOraclePreparationElapsedMs,
    workerPreparationElapsedMs,
    changedWallElapsedMs,
    totalElapsedMs: performance.now() - totalStarted,
    cacheProof: {
      exactStepStatusResults: stepStatuses.length,
      expectedStatuses,
      expectedCacheSources,
      reviewSummaryDigest: [...reviewSummaryDigests][0],
      coldOracleReviewSummaryDigest,
    },
    peakPerWorkerProcessMemoryBytes: workerMemory,
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
