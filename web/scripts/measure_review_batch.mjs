import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parse as parseYaml } from "yaml";

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

/** @type {{queries: Array<{id: string, inputs: string[], requestFields: string[]}>}} */
const workflow = parseYaml(
  await readFile(path.resolve("schema/chronicle-workflow.yaml"), "utf8"),
);
const queryIds = workflow.queries.map((query) => query.id);
if (queryIds.length === 0 || new Set(queryIds).size !== queryIds.length) {
  throw new Error("generated workflow query registry must be non-empty and unique");
}
const changedOption =
  benchmarkCase === "middle_concurrent_usage"
    ? "model_concurrent_usage"
    : "minimum_usage_duration";
const affectedQueryIds = new Set(
  workflow.queries
    .filter((query) => query.requestFields.includes(changedOption))
    .map((query) => query.id),
);
let addedAffectedQuery = true;
while (addedAffectedQuery) {
  addedAffectedQuery = false;
  for (const query of workflow.queries) {
    if (
      !affectedQueryIds.has(query.id) &&
      query.inputs.some((input) => affectedQueryIds.has(input))
    ) {
      affectedQueryIds.add(query.id);
      addedAffectedQuery = true;
    }
  }
}
if (affectedQueryIds.size === 0) {
  throw new Error(`${changedOption} has no declared query impact`);
}

const executable = path.resolve("node_modules/.bin/vite-node");
const benchmark = path.resolve("scripts/benchmark_runtime_wasm.mts");
const runtimePackage = process.env.CHRONICLE_BENCHMARK_RUNTIME_DIR
  ? path.resolve(process.env.CHRONICLE_BENCHMARK_RUNTIME_DIR)
  : null;
const runtimeArgs = runtimePackage
  ? [
      "--runtime-js",
      path.join(runtimePackage, "chronicle_preprocessing_runtime_wasm.js"),
      "--wasm",
      path.join(runtimePackage, "chronicle_preprocessing_runtime_wasm_bg.wasm"),
    ]
  : [];
const totalStarted = performance.now();

/**
 * @param {string[]} args
 * @returns {Promise<string>}
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
      resolve(stdout);
    });
  });
}

/** @typedef {{input: {path: string, bytes: number, sha256: string}, wasm: {bytes: number, sha256: string}, environment: {node: string, platform: string, architecture: string, logicalCpus: number, totalMemoryBytes: number, peakProcessMemoryBytes: {rss: number, heapTotal: number, heapUsed: number, external: number, arrayBuffers: number}}, reviewBaseBytes: number, reconstructionBaseBytes: number, measurements: {coldExecuteMs: number[], coldQueryStatuses: Array<Array<[string, string]>>, coldReviewSummaryDigests: Array<string>, coldCacheSources: string[][], coldSelectedBaseKinds: string[], coldWasmBoundaryBytes: number[], coldCounts: Array<{original: number, processed: number, app: number, screen: number}>, coldIdentities: Array<Record<string, string>>}}} ShardResult */
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
      ...runtimeArgs,
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
  path.resolve(".tmp-review-benchmark-"),
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
    coldQueryStatuses: shard.measurements.coldQueryStatuses,
    coldReviewSummaryDigests: shard.measurements.coldReviewSummaryDigests,
    coldCacheSources: shard.measurements.coldCacheSources,
    coldSelectedBaseKinds: shard.measurements.coldSelectedBaseKinds,
    coldWasmBoundaryBytes: shard.measurements.coldWasmBoundaryBytes,
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
    throw new Error(
      `benchmark shard ${index} identity does not match preparation`,
    );
  }
}
const values = shards
  .flatMap((shard) => shard.measurements.coldExecuteMs)
  .sort((left, right) => left - right);
const queryStatuses = shards.flatMap(
  (shard) => shard.measurements.coldQueryStatuses,
);
const reviewSummaryDigests = new Set(
  shards.flatMap((shard) => shard.measurements.coldReviewSummaryDigests),
);
const cacheSources = shards.flatMap(
  (shard) => shard.measurements.coldCacheSources,
);
const selectedBaseKinds = shards.flatMap(
  (shard) => shard.measurements.coldSelectedBaseKinds,
);
const wasmBoundaryBytes = shards.flatMap(
  (shard) => shard.measurements.coldWasmBoundaryBytes,
);
const resultCounts = shards.flatMap((shard) => shard.measurements.coldCounts);
const resultIdentities = shards.flatMap(
  (shard) => shard.measurements.coldIdentities,
);
for (const [name, entries] of Object.entries({
  values,
  queryStatuses,
  cacheSources,
  selectedBaseKinds,
  wasmBoundaryBytes,
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
    ...shards.map(
      (shard) => shard.environment.peakProcessMemoryBytes.heapTotal,
    ),
  ),
  heapUsed: Math.max(
    ...shards.map((shard) => shard.environment.peakProcessMemoryBytes.heapUsed),
  ),
  external: Math.max(
    ...shards.map((shard) => shard.environment.peakProcessMemoryBytes.external),
  ),
  arrayBuffers: Math.max(
    ...shards.map(
      (shard) => shard.environment.peakProcessMemoryBytes.arrayBuffers,
    ),
  ),
};
const expectedCacheSources =
  benchmarkCase === "middle_minimum_usage_duration"
    ? ["verified-reconstruction-base"]
    : ["verified-review-base"];
const expectedSelectedBaseKind =
  benchmarkCase === "middle_minimum_usage_duration"
    ? "reconstruction-base"
    : "review-base";
const expectedWasmBoundaryBytes =
  148 +
  116 +
  (expectedSelectedBaseKind === "reconstruction-base"
    ? baseMetadata.reconstructionBaseBytes
    : baseMetadata.reviewBaseBytes);
const validStatuses = new Set(["cached", "recomputed", "bypassed", "skipped"]);
for (const [resultIndex, entries] of queryStatuses.entries()) {
  const statuses = new Map(entries);
  if (statuses.size !== queryIds.length) {
    throw new Error(
      `benchmark result ${resultIndex} reported an incomplete query status registry`,
    );
  }
  if (entries.map(([query]) => query).join("\n") !== queryIds.join("\n")) {
    throw new Error(
      `${benchmarkCase} result ${resultIndex} query order drifted`,
    );
  }
  for (const [query, status] of entries) {
    if (!validStatuses.has(status)) {
      throw new Error(
        `${benchmarkCase} result ${resultIndex}: ${query} reported invalid status ${status}`,
      );
    }
    if (status === "recomputed" && !affectedQueryIds.has(query)) {
      throw new Error(
        `${benchmarkCase} result ${resultIndex}: unrelated query ${query} recomputed`,
      );
    }
  }
  if (
    !entries.some(
      ([query, status]) =>
        status === "recomputed" && affectedQueryIds.has(query),
    )
  ) {
    throw new Error(
      `${benchmarkCase} result ${resultIndex} did not recompute an affected query`,
    );
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
for (const [resultIndex, kind] of selectedBaseKinds.entries()) {
  if (kind !== expectedSelectedBaseKind) {
    throw new Error(
      `${benchmarkCase} result ${resultIndex}: selected ${kind}, expected ${expectedSelectedBaseKind}`,
    );
  }
}
for (const [resultIndex, bytes] of wasmBoundaryBytes.entries()) {
  if (bytes !== expectedWasmBoundaryBytes) {
    throw new Error(
      `${benchmarkCase} result ${resultIndex}: transferred ${bytes} bytes, expected ${expectedWasmBoundaryBytes}`,
    );
  }
}
if (reviewSummaryDigests.size !== 1) {
  throw new Error(
    `duplicated inputs produced ${reviewSummaryDigests.size} review-summary digests`,
  );
}
if (
  ![...reviewSummaryDigests].every(
    (digest) => digest === coldOracleReviewSummaryDigest,
  )
) {
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
  `sha256:${createHash("sha256")
    .update(await readFile(file))
    .digest("hex")}`;
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
      exactQueryStatusResults: queryStatuses.length,
      changedOption,
      declaredAffectedQueryIds: [...affectedQueryIds],
      expectedCacheSources,
      expectedSelectedBaseKind,
      wasmBoundaryBytesPerFile: expectedWasmBoundaryBytes,
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
