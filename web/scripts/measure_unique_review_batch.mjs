import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

const inputDirectory = path.resolve(
  process.argv[2] ?? "../.tmp-benchmark/unique-100",
);
const workerCount = Number(process.argv[3] ?? "8");
const benchmarkCase =
  process.argv[4] ?? "middle_minimum_usage_duration";
if (!Number.isSafeInteger(workerCount) || workerCount < 1) {
  throw new Error("worker count must be a positive integer");
}
if (
  !new Set(["middle_concurrent_usage", "middle_minimum_usage_duration"]).has(
    benchmarkCase,
  )
) {
  throw new Error("benchmark case must be a supported middle-pipeline change");
}

const rawFiles = (await readdir(inputDirectory))
  .filter((name) => name.endsWith(".csv"))
  .sort()
  .map((name) => path.join(inputDirectory, name));
if (rawFiles.length === 0) {
  throw new Error(`no CSV inputs found in ${inputDirectory}`);
}

const executable = path.resolve("node_modules/.bin/vite-node");
const benchmark = path.resolve("scripts/benchmark_runtime_wasm.mts");

/** @param {string} raw @param {boolean} persisted */
function runOne(raw, persisted) {
  const args = [
    benchmark,
    "--raw",
    raw,
    "--iterations",
    "1",
    "--case",
    benchmarkCase,
    "--materialization",
    "review",
    "--full-options",
    "--changed-only",
    "--compact",
    ...(persisted ? ["--review-base", "--warm-runtime"] : []),
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
            `benchmark helper failed for ${raw}: code=${code} signal=${signal}\n${stderr}`,
          ),
        );
        return;
      }
      const lines = stdout.trim().split("\n");
      try {
        resolve(JSON.parse(lines.at(-1) ?? ""));
      } catch (error) {
        reject(
          new Error(
            `benchmark helper returned invalid JSON for ${raw}: ${error}\n${stdout}\n${stderr}`,
          ),
        );
      }
    });
  });
}

// Mirrors the per-case expectations proven by measure_review_batch.mjs:
// the narrow duration change reuses the reconstruction base and reruns only
// the floor-dependent tail, while the concurrent-usage change invalidates the
// matcher and annotation chains and resumes from the earlier review base.
// The matcher/annotation chain may also report "cached" when the kernel's
// two-slot alternation cache (keyed by content-committing checkpoint digests)
// already holds the state computed by the in-process cold oracle pass; output
// identity is separately proven by the digest/count/identity comparisons.
const expectedRecomputedOrCached = new Set(
  benchmarkCase === "middle_concurrent_usage"
    ? [
        "compute_junk_packages",
        "junk_blind_fold",
        "build_matcher_input",
        "run_matcher",
        "apply_matcher_output",
        "relabel_usage_with_floor",
        "junk_downstream_mark",
        "sort_episodes",
        "codebook_join",
        "derive_broad_category",
        "collapse_genre",
        "engagement_walk",
        "flag_and_retain",
        "blank_junk_timing",
        "drop_selected_types",
      ]
    : [],
);
const expectedRecomputed = new Set([
  ...(benchmarkCase === "middle_concurrent_usage"
    ? []
    : ["relabel_usage_with_floor", "junk_downstream_mark", "sort_episodes"]),
  "resolve_participant_windows",
  "filter_rows_to_window",
  "resolve_sharing_status",
  "build_survey_lookup",
  "attribute_rows",
  "inject_placeholders",
  "assemble_result",
]);
const expectedSelectedBaseKind =
  benchmarkCase === "middle_concurrent_usage"
    ? "review-base"
    : "reconstruction-base";
const expectedCacheSources =
  benchmarkCase === "middle_concurrent_usage"
    ? ["verified-review-base"]
    : ["verified-reconstruction-base"];
const expectedSkipped = new Set([
  "partition_credit_sessions",
  "build_liveness_substrate",
  "report_screen_incapable",
  "count_day_apps",
  "credit_sessions",
  "emit_credited_rows",
  "assemble_credit_result",
  "build_raw_date_index",
]);
const expectedBypassed = new Set([
  "build_coverage_table",
  "accumulate_attribution_minutes",
  "score_days",
]);

/** @param {unknown} value @param {string} label */
function only(value, label) {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error(`${label} must contain exactly one result`);
  }
  return value[0];
}

/** @param {Record<string, any>} cached @param {Record<string, any>} cold */
function verifyPair(cached, cold) {
  if (cached.input.sha256 !== cold.input.sha256) {
    throw new Error("cached and cold runs used different inputs");
  }
  if (
    cached.wasm.sha256 !== cold.wasm.sha256 ||
    cached.wasm.bytes !== cold.wasm.bytes
  ) {
    throw new Error("cached and cold runs used different WASM builds");
  }
  const cachedMeasurements = cached.measurements;
  const coldMeasurements = cold.measurements;
  const cachedDigest = only(
    cachedMeasurements.coldReviewSummaryDigests,
    "cached review digest",
  );
  const coldDigest = only(
    coldMeasurements.coldReviewSummaryDigests,
    "cold review digest",
  );
  if (!cachedDigest || cachedDigest !== coldDigest) {
    throw new Error(
      `persisted result differs from cold oracle: ${cachedDigest} != ${coldDigest}`,
    );
  }
  const cachedCounts = only(cachedMeasurements.coldCounts, "cached counts");
  const coldCounts = only(coldMeasurements.coldCounts, "cold counts");
  if (JSON.stringify(cachedCounts) !== JSON.stringify(coldCounts)) {
    throw new Error("persisted counts differ from the cold oracle");
  }
  const cachedIdentity = only(
    cachedMeasurements.coldIdentities,
    "cached runtime identity",
  );
  const coldIdentity = only(
    coldMeasurements.coldIdentities,
    "cold runtime identity",
  );
  if (JSON.stringify(cachedIdentity) !== JSON.stringify(coldIdentity)) {
    throw new Error("persisted and cold runtime identities differ");
  }
  if (
    only(cachedMeasurements.coldSelectedBaseKinds, "selected base") !==
    expectedSelectedBaseKind
  ) {
    throw new Error(
      `middle change did not select the ${expectedSelectedBaseKind}`,
    );
  }
  if (
    JSON.stringify(
      only(cachedMeasurements.coldCacheSources, "cached sources"),
    ) !== JSON.stringify(expectedCacheSources)
  ) {
    throw new Error("middle change did not report its verified cache source");
  }
  const statuses = only(
    cachedMeasurements.coldStepStatuses,
    "cached step statuses",
  );
  if (
    !Array.isArray(statuses) ||
    statuses.length !== 55 ||
    new Set(statuses.map(([step]) => step)).size !== 55
  ) {
    throw new Error("cached result does not contain exactly 55 unique steps");
  }
  for (const [step, status] of statuses) {
    if (expectedRecomputedOrCached.has(step)) {
      if (status !== "recomputed" && status !== "cached") {
        throw new Error(
          `${step}: expected recomputed or cached, received ${status}`,
        );
      }
      continue;
    }
    const expected = expectedRecomputed.has(step)
      ? "recomputed"
      : expectedSkipped.has(step)
        ? "skipped"
        : expectedBypassed.has(step)
          ? "bypassed"
          : "cached";
    if (status !== expected) {
      throw new Error(`${step}: expected ${expected}, received ${status}`);
    }
  }
  return {
    inputSha256: cached.input.sha256,
    inputBytes: cached.input.bytes,
    cachedExecuteMs: only(
      cachedMeasurements.coldExecuteMs,
      "cached execution time",
    ),
    coldOracleExecuteMs: only(
      coldMeasurements.coldExecuteMs,
      "cold execution time",
    ),
    basePreparationMs: cached.reviewBasePreparationElapsedMs,
    wasmBoundaryBytes: only(
      cachedMeasurements.coldWasmBoundaryBytes,
      "WASM boundary bytes",
    ),
    reviewSummaryDigest: cachedDigest,
    peakRssBytes: Math.max(
      cached.environment.peakProcessMemoryBytes.rss,
      cold.environment.peakProcessMemoryBytes.rss,
    ),
    wasm: cached.wasm,
    runtimeIdentity: cachedIdentity,
  };
}

const started = performance.now();
const results = new Array(rawFiles.length);
let nextIndex = 0;
async function runWorker() {
  for (;;) {
    const index = nextIndex;
    nextIndex += 1;
    const raw = rawFiles[index];
    if (!raw) return;
    const cached = await runOne(raw, true);
    const cold = await runOne(raw, false);
    results[index] = verifyPair(cached, cold);
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
if (
  results.some(
    (result) =>
      JSON.stringify(result.wasm) !== JSON.stringify(results[0].wasm) ||
      JSON.stringify(result.runtimeIdentity) !==
        JSON.stringify(results[0].runtimeIdentity),
  )
) {
  throw new Error("unique-file workers did not use one exact runtime build");
}
/** @param {number[]} values */
function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (/** @type {number} */ fraction) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
    0;
  return {
    count: sorted.length,
    minimum: sorted[0] ?? 0,
    median: percentile(0.5),
    p90: percentile(0.9),
    p95: percentile(0.95),
    maximum: sorted.at(-1) ?? 0,
    mean:
      sorted.reduce((total, value) => total + value, 0) / sorted.length,
  };
}

process.stdout.write(
  `${JSON.stringify({
    receiptVersion: "chronicle-unique-review-batch/v1",
    inputDirectory,
    inputCount: rawFiles.length,
    uniqueInputDigests: uniqueInputs.size,
    workerCount: Math.min(workerCount, rawFiles.length),
    benchmarkCase,
    wasm: results[0].wasm,
    runtimeIdentity: results[0].runtimeIdentity,
    exactStepStatusResults: results.length,
    exactColdOracleMatches: results.length,
    wallElapsedMs: performance.now() - started,
    inputBytes: distribution(results.map((result) => result.inputBytes)),
    basePreparationMs: distribution(
      results.map((result) => result.basePreparationMs),
    ),
    cachedExecuteMs: distribution(
      results.map((result) => result.cachedExecuteMs),
    ),
    coldOracleExecuteMs: distribution(
      results.map((result) => result.coldOracleExecuteMs),
    ),
    wasmBoundaryBytes: distribution(
      results.map((result) => result.wasmBoundaryBytes),
    ),
    maximumChildRssBytes: Math.max(
      ...results.map((result) => result.peakRssBytes),
    ),
  })}\n`,
);
