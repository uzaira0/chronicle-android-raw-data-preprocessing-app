import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { DEFAULT_BROWSER_OPTIONS } from "../src/lib/generatedContract";
import { buildRustV2Options } from "../src/lib/rustPipelineRuntime";
type RuntimeModule =
  typeof import("../src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js");

function positiveInteger(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]) {
  let raw: string | null = null;
  let runtimeJs: string | null = null;
  let wasm = path.resolve(
    "src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm",
  );
  let iterations = 1;
  let mode: "cold" | "warm" = "cold";
  let fullOptions = false;
  let summary = false;
  let compact = false;
  let benchmarkCase = "unchanged";
  let materialization: "full" | "review" = "full";
  let changedOnly = false;
  let reviewBase = false;
  let reviewBasesDir: string | null = null;
  let exportReviewBasesDir: string | null = null;
  let waitForStart = false;
  let warmRuntime = false;
  let workspaceCount = 1;
  let workspaceOffset = 0;
  const benchmarkCases = new Set([
    "unchanged",
    "upstream_timezone_policy",
    "middle_concurrent_usage",
    "middle_minimum_usage_duration",
    "downstream_day_coverage",
    "output_study_name",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--raw" && next) {
      raw = path.resolve(next);
      index += 1;
    } else if (token === "--wasm" && next) {
      wasm = path.resolve(next);
      index += 1;
    } else if (token === "--runtime-js" && next) {
      runtimeJs = path.resolve(next);
      index += 1;
    } else if (token === "--iterations" && next) {
      iterations = positiveInteger(token, next);
      index += 1;
    } else if (token === "--mode" && (next === "cold" || next === "warm")) {
      mode = next;
      index += 1;
    } else if (token === "--full-options") {
      fullOptions = true;
    } else if (token === "--summary") {
      summary = true;
    } else if (token === "--compact") {
      compact = true;
    } else if (token === "--case" && next && benchmarkCases.has(next)) {
      benchmarkCase = next;
      index += 1;
    } else if (
      token === "--materialization" &&
      (next === "full" || next === "review")
    ) {
      materialization = next;
      index += 1;
    } else if (token === "--changed-only") {
      changedOnly = true;
    } else if (token === "--review-base") {
      reviewBase = true;
    } else if (token === "--review-bases-dir" && next) {
      reviewBasesDir = path.resolve(next);
      reviewBase = true;
      index += 1;
    } else if (token === "--export-review-bases-dir" && next) {
      exportReviewBasesDir = path.resolve(next);
      reviewBase = true;
      index += 1;
    } else if (token === "--wait-for-start") {
      waitForStart = true;
    } else if (token === "--warm-runtime") {
      warmRuntime = true;
    } else if (token === "--workspace-count" && next) {
      workspaceCount = positiveInteger(token, next);
      index += 1;
    } else if (token === "--workspace-offset" && next) {
      workspaceOffset = Number(next);
      if (!Number.isSafeInteger(workspaceOffset) || workspaceOffset < 0) {
        throw new Error(`${token} requires a non-negative integer`);
      }
      index += 1;
    } else {
      throw new Error(`unknown or incomplete argument: ${token ?? ""}`);
    }
  }
  if (!raw) throw new Error("--raw <path> is required");
  if (reviewBase && materialization !== "review") {
    throw new Error("--review-base requires --materialization review");
  }
  if (reviewBasesDir && exportReviewBasesDir) {
    throw new Error(
      "--review-bases-dir and --export-review-bases-dir are mutually exclusive",
    );
  }
  if (benchmarkCase !== "unchanged" && mode !== "warm" && !changedOnly) {
    throw new Error(
      "--case requires --mode warm so iteration 0 can seed the workspace",
    );
  }
  if (benchmarkCase !== "unchanged" && iterations < 2 && !changedOnly) {
    throw new Error("--case requires at least 2 iterations");
  }
  return {
    raw,
    wasm,
    runtimeJs,
    iterations,
    mode,
    fullOptions,
    summary,
    compact,
    benchmarkCase,
    materialization,
    changedOnly,
    reviewBase,
    reviewBasesDir,
    exportReviewBasesDir,
    waitForStart,
    warmRuntime,
    workspaceCount,
    workspaceOffset,
  };
}

function distribution(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ??
    0;
  return {
    count: sorted.length,
    minimumMs: sorted[0] ?? 0,
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    maximumMs: sorted.at(-1) ?? 0,
    meanMs:
      sorted.length === 0
        ? 0
        : sorted.reduce((total, value) => total + value, 0) / sorted.length,
  };
}

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const args = parseArgs(process.argv.slice(2));
const runtime = (
  args.runtimeJs
    ? await import(pathToFileURL(args.runtimeJs).href)
    : await import("../src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js")
) as RuntimeModule;
const inputBytes = new Uint8Array(await readFile(args.raw));
const wasmBytes = await readFile(args.wasm);
runtime.initSync({ module: wasmBytes });

const inputSha256 = sha256(inputBytes);
const supports = new runtime.RuntimeSupportFiles();
const buildBrowserOptions = (changed: boolean) => ({
  ...DEFAULT_BROWSER_OPTIONS,
  selectedTimezone: "America/Chicago",
  timezoneHandling: "selected-filter" as const,
  useFilterFile: false,
  useAppsForcingScreenOpenFile: false,
  useBackgroundAppsFile: false,
  useAppCodebook: false,
  modelConcurrentUsage: args.fullOptions,
  enableScreenGatedCrediting: args.fullOptions,
  enableAggregates: args.fullOptions,
  enableDayCoverage: false,
  ...(changed && args.benchmarkCase === "upstream_timezone_policy"
    ? { timezoneHandling: "primary-convert" as const }
    : {}),
  ...(changed && args.benchmarkCase === "middle_concurrent_usage"
    ? { modelConcurrentUsage: false }
    : {}),
  ...(changed && args.benchmarkCase === "middle_minimum_usage_duration"
    ? { minimumUsageDuration: 2 }
    : {}),
  ...(changed && args.benchmarkCase === "downstream_day_coverage"
    ? { enableDayCoverage: true }
    : {}),
  ...(changed && args.benchmarkCase === "output_study_name"
    ? { studyName: "Synthetic benchmark B" }
    : {}),
});
let reviewBaseBytes: Uint8Array | undefined;
let reconstructionBaseBytes: Uint8Array | undefined;
let reviewBaseRoot: string | null = null;
let reviewBasePreparationElapsedMs = 0;
if (args.reviewBasesDir) {
  const loadStarted = performance.now();
  const metadata = JSON.parse(
    await readFile(path.join(args.reviewBasesDir, "metadata.json"), "utf8"),
  );
  if (metadata.inputSha256 !== inputSha256) {
    throw new Error(
      `persisted benchmark base input mismatch: ${metadata.inputSha256} != ${inputSha256}`,
    );
  }
  reviewBaseBytes = new Uint8Array(
    await readFile(path.join(args.reviewBasesDir, "review-base.bin")),
  );
  reconstructionBaseBytes = new Uint8Array(
    await readFile(path.join(args.reviewBasesDir, "reconstruction-base.bin")),
  );
  if (
    metadata.reviewBaseSha256 !== sha256(reviewBaseBytes) ||
    metadata.reconstructionBaseSha256 !== sha256(reconstructionBaseBytes)
  ) {
    throw new Error("persisted benchmark base digest mismatch");
  }
  reviewBaseRoot = metadata.workspaceRootDigest;
  reviewBasePreparationElapsedMs = performance.now() - loadStarted;
} else if (args.reviewBase) {
  const seedStarted = performance.now();
  const seedOptions = buildBrowserOptions(false);
  const seedWorkspaceId = sha256(`chronicle-review-base-seed:${inputSha256}`);
  const seedRequest = JSON.stringify({
    protocolVersion: "chronicle-preprocessing-runtime/v1",
    requestId: "benchmark-review-base-seed",
    command: "ExecuteWorkspace",
    workspaceRootDigest: null,
    workspaceId: seedWorkspaceId,
    inputFileName: path.basename(args.raw),
    inputSha256,
    options: buildRustV2Options(seedOptions, {
      datetimeOfPreprocessing: "2026-07-23 00:00:00 UTC",
    }),
  });
  const seed = runtime.execute_workspace(seedRequest, inputBytes, supports);
  try {
    const manifest = JSON.parse(seed.manifest_json());
    reviewBaseRoot = manifest.workspaceRootDigest;
    for (let index = 0; index < seed.artifact_count; index += 1) {
      const metadata = JSON.parse(seed.artifact_metadata_json(index));
      if (metadata.kind === "review-base") {
        reviewBaseBytes = seed.take_artifact_bytes(index);
      } else if (metadata.kind === "reconstruction-base") {
        reconstructionBaseBytes = seed.take_artifact_bytes(index);
      }
    }
    if (!reviewBaseBytes || !reconstructionBaseBytes) {
      throw new Error("seed execution omitted a persisted review checkpoint");
    }
  } finally {
    seed.free();
  }
  reviewBasePreparationElapsedMs = performance.now() - seedStarted;
}
if (args.exportReviewBasesDir) {
  await mkdir(args.exportReviewBasesDir, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(args.exportReviewBasesDir, "review-base.bin"),
      reviewBaseBytes!,
    ),
    writeFile(
      path.join(args.exportReviewBasesDir, "reconstruction-base.bin"),
      reconstructionBaseBytes!,
    ),
    writeFile(
      path.join(args.exportReviewBasesDir, "metadata.json"),
      `${JSON.stringify(
        {
          inputSha256,
          workspaceRootDigest: reviewBaseRoot,
          reviewBaseBytes: reviewBaseBytes!.byteLength,
          reviewBaseSha256: sha256(reviewBaseBytes!),
          reconstructionBaseBytes: reconstructionBaseBytes!.byteLength,
          reconstructionBaseSha256: sha256(reconstructionBaseBytes!),
          preparationElapsedMs: reviewBasePreparationElapsedMs,
        },
        null,
        2,
      )}\n`,
    ),
  ]);
  process.stdout.write(
    `${JSON.stringify({
      exportedReviewBasesDir: args.exportReviewBasesDir,
      reviewBasePreparationElapsedMs,
    })}\n`,
  );
  supports.free();
  process.exit(0);
}
const reviewProbeSpec = JSON.parse(runtime.review_base_probe_spec_json()) as {
  reviewBaseBytes: number;
  reconstructionBaseBytes: number;
};
const executePreparedReview = (requestJson: string) => {
  if (!reviewBaseBytes || !reconstructionBaseBytes) {
    throw new Error("prepared review requires persisted review bases");
  }
  const reviewProbe = reviewBaseBytes.subarray(
    0,
    reviewProbeSpec.reviewBaseBytes,
  );
  const reconstructionProbe = reconstructionBaseBytes.subarray(
    0,
    reviewProbeSpec.reconstructionBaseBytes,
  );
  const prepared = runtime.prepare_persisted_workspace_review(
    requestJson,
    inputBytes.byteLength,
    reviewProbe,
    reconstructionProbe,
    supports,
  );
  try {
    const selectedBaseKind = prepared.required_base_kind();
    if (
      selectedBaseKind !== "none" &&
      selectedBaseKind !== "review-base" &&
      selectedBaseKind !== "reconstruction-base"
    ) {
      throw new Error(`Rust selected an unknown review base: ${selectedBaseKind}`);
    }
    if (selectedBaseKind === "none") {
      return {
        handle: runtime.execute_workspace(requestJson, inputBytes, supports),
        selectedBaseKind,
        wasmBoundaryBytes:
          inputBytes.byteLength +
          reviewProbe.byteLength +
          reconstructionProbe.byteLength,
      };
    }
    const selectedBase =
      selectedBaseKind === "review-base"
        ? reviewBaseBytes
        : selectedBaseKind === "reconstruction-base"
          ? reconstructionBaseBytes
        : reconstructionBaseBytes;
    return {
      handle: prepared.execute_selected_base(selectedBase),
      selectedBaseKind,
      wasmBoundaryBytes:
        reviewProbe.byteLength +
        reconstructionProbe.byteLength +
        selectedBase.byteLength,
    };
  } finally {
    prepared.free();
  }
};
if (args.warmRuntime) {
  if (!reviewBaseBytes || !reconstructionBaseBytes) {
    throw new Error("--warm-runtime requires persisted review bases");
  }
  const warmOptions = buildBrowserOptions(true);
  const warmRequest = JSON.stringify({
    protocolVersion: "chronicle-preprocessing-runtime/v1",
    requestId: "benchmark-worker-warmup",
    command: "QueryReview",
    workspaceRootDigest: null,
    workspaceId: sha256(`benchmark-worker-warmup:${process.pid}`),
    inputFileName: path.basename(args.raw),
    inputSha256,
    options: buildRustV2Options(warmOptions, {
      datetimeOfPreprocessing: "2026-07-23 00:00:00 UTC",
    }),
  });
  const { handle: warmHandle, selectedBaseKind: warmSelectedBaseKind } =
    executePreparedReview(warmRequest);
  try {
    const manifest = JSON.parse(warmHandle.manifest_json());
    if (!Array.isArray(manifest.cacheSources) || manifest.cacheSources.length === 0) {
      throw new Error(
        `worker warmup did not restore a verified cache (selected ${warmSelectedBaseKind})`,
      );
    }
  } finally {
    warmHandle.free();
  }
}
if (args.waitForStart) {
  if (typeof process.send !== "function") {
    throw new Error("--wait-for-start requires a Node IPC parent");
  }
  process.send({ type: "ready", reviewBasePreparationElapsedMs });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("timed out waiting for benchmark start")),
      120_000,
    );
    process.once("message", (message) => {
      clearTimeout(timeout);
      if (
        typeof message !== "object" ||
        message === null ||
        (message as { type?: unknown }).type !== "start"
      ) {
        reject(new Error("invalid benchmark start message"));
        return;
      }
      resolve();
    });
  });
}
let peakMemory = process.memoryUsage();
function sampleMemory(): void {
  const current = process.memoryUsage();
  peakMemory = {
    rss: Math.max(peakMemory.rss, current.rss),
    heapTotal: Math.max(peakMemory.heapTotal, current.heapTotal),
    heapUsed: Math.max(peakMemory.heapUsed, current.heapUsed),
    external: Math.max(peakMemory.external, current.external),
    arrayBuffers: Math.max(peakMemory.arrayBuffers, current.arrayBuffers),
  };
}
const results: unknown[] = [];
try {
  for (
    let workspaceIndex = 0;
    workspaceIndex < args.workspaceCount;
    workspaceIndex += 1
  ) {
    const syntheticIndex = args.workspaceOffset + workspaceIndex;
    const extension = path.extname(args.raw);
    const inputFileName = `${path.basename(args.raw, extension)}-${String(syntheticIndex + 1).padStart(3, "0")}${extension}`;
    const stableWorkspaceId = sha256(
      `chronicle-preprocessing-workspace:${inputFileName}\n${inputSha256.replace(/^sha256:/, "")}`,
    );
    let previousRoot: string | null = null;
    for (let iteration = 0; iteration < args.iterations; iteration += 1) {
      const workspaceId =
        args.reviewBase
          ? sha256(`${stableWorkspaceId}:review-base:${iteration}`)
          : args.mode === "warm"
          ? stableWorkspaceId
          : sha256(`${stableWorkspaceId}:${iteration}`);
      let handle: ReturnType<typeof runtime.execute_workspace> | undefined;
      let selectedBaseKind = "none";
      let wasmBoundaryBytes = inputBytes.byteLength;
      try {
        const browserOptions = buildBrowserOptions(
          args.changedOnly || iteration > 0,
        );
        const totalStarted = performance.now();
        const executeStarted = performance.now();
        const requestJson = (
          arm: string,
          requestOptions: typeof browserOptions,
        ) =>
          JSON.stringify({
            protocolVersion: "chronicle-preprocessing-runtime/v1",
            requestId: `benchmark-${args.mode}-${args.benchmarkCase}-${syntheticIndex}-${iteration}-${arm}`,
            command:
              args.materialization === "review"
                ? "QueryReview"
                : "ExecuteWorkspace",
            // The persisted bases are content-addressed inputs, not ancestry.
            // Synthetic workspaces must never claim the seed workspace root.
            workspaceRootDigest: args.reviewBase
              ? null
              : args.mode === "warm"
                ? previousRoot
                : null,
            workspaceId,
            inputFileName,
            inputSha256,
            options: buildRustV2Options(requestOptions, {
              datetimeOfPreprocessing: "2026-07-23 00:00:00 UTC",
            }),
          });
        if (args.reviewBase) {
          const prepared = executePreparedReview(
            requestJson("single", browserOptions),
          );
          handle = prepared.handle;
          selectedBaseKind = prepared.selectedBaseKind;
          wasmBoundaryBytes = prepared.wasmBoundaryBytes;
        } else {
          handle = runtime.execute_workspace(
            requestJson("single", browserOptions),
            inputBytes,
            supports,
          );
        }
        const executeElapsedMs = performance.now() - executeStarted;
        sampleMemory();
        const manifest = JSON.parse(handle.manifest_json());
        previousRoot = manifest.workspaceRootDigest ?? previousRoot;
        const artifacts = [];
        let totalArtifactBytes = 0;
        let artifactExtractionElapsedMs = 0;
        let digestVerificationElapsedMs = 0;
        for (let index = 0; index < handle.artifact_count; index += 1) {
          const metadata = JSON.parse(handle.artifact_metadata_json(index));
          const extractionStarted = performance.now();
          const bytes = handle.take_artifact_bytes(index);
          artifactExtractionElapsedMs += performance.now() - extractionStarted;
          totalArtifactBytes += bytes.byteLength;
          const verificationStarted = performance.now();
          const computedDigest = sha256(bytes);
          digestVerificationElapsedMs +=
            performance.now() - verificationStarted;
          if (computedDigest !== metadata.digest) {
            throw new Error(
              `artifact digest mismatch for ${metadata.kind}: ${computedDigest} != ${metadata.digest}`,
            );
          }
          artifacts.push({
            kind: metadata.kind,
            bytes: bytes.byteLength,
            digest: metadata.digest,
          });
        }
        artifacts.sort(
          (left, right) =>
            right.bytes - left.bytes || left.kind.localeCompare(right.kind),
        );
        const totalElapsedMs = performance.now() - totalStarted;
        results.push({
          workspaceIndex: syntheticIndex,
          inputFileName,
          iteration,
          executeElapsedMs,
          artifactExtractionElapsedMs,
          digestVerificationElapsedMs,
          totalElapsedMs,
          workspaceRootDigest: manifest.workspaceRootDigest ?? null,
          comparisonDigest: manifest.comparisonDigest ?? null,
          reviewSummaryDigest: manifest.reviewSummaryDigest ?? null,
          cacheSources: manifest.cacheSources ?? [],
          selectedBaseKind,
          wasmBoundaryBytes,
          implementationDigest: manifest.implementationDigest,
          planDigest: manifest.planDigest,
          profileDigest: manifest.profileDigest,
          profileLockDigest: manifest.profileLockDigest,
          runtimeAuthorityDigest: manifest.runtimeAuthorityDigest,
          productContractDigest: manifest.productContractDigest,
          dependencyCertificateDigest: manifest.dependencyCertificateDigest,
          dependencyCacheDecision: manifest.dependencyCacheDecision,
          publishedOutputsDigest:
            manifest.processingSummary?.publishedOutputsDigest ?? null,
          counts: manifest.counts,
          nodeStatuses: manifest.nodeExecutions.map(
            (execution: { node_id: string; status: string }) => [
              execution.node_id,
              execution.status,
            ],
          ),
          queryStatuses: manifest.queryExecutions.map(
            (execution: { query_id: string; status: string }) => [
              execution.query_id,
              execution.status,
            ],
          ),
          artifactCount: artifacts.length,
          totalArtifactBytes,
          artifacts: args.summary ? undefined : artifacts,
        });
      } finally {
        try {
          handle?.free();
        } catch {}
        sampleMemory();
      }
    }
  }
} finally {
  try {
    supports.free();
  } catch {}
}

const coldResults = results.filter((result: any) => result.iteration === 0);
const changedResults = results.filter((result: any) => result.iteration > 0);
if (typeof process.send === "function") {
  process.send({ type: "work-complete" });
}
process.stdout.write(
  `${JSON.stringify({
    input: {
      path: args.raw,
      bytes: inputBytes.byteLength,
      sha256: inputSha256,
    },
    wasm: { bytes: wasmBytes.byteLength, sha256: sha256(wasmBytes) },
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
      peakProcessMemoryBytes: peakMemory,
    },
    mode: args.mode,
    benchmarkCase: args.benchmarkCase,
    materialization: args.materialization,
    changedOnly: args.changedOnly,
    reviewBase: args.reviewBase,
    reviewBasePreparationElapsedMs,
    reviewBaseBytes: reviewBaseBytes?.byteLength ?? 0,
    reconstructionBaseBytes: reconstructionBaseBytes?.byteLength ?? 0,
    fullOptions: args.fullOptions,
    iterations: args.iterations,
    workspaceCount: args.workspaceCount,
    workspaceOffset: args.workspaceOffset,
    distributions: {
      coldExecute: distribution(
        coldResults.map((result: any) => result.executeElapsedMs),
      ),
      changedExecute: distribution(
        changedResults.map((result: any) => result.executeElapsedMs),
      ),
      changedTotal: distribution(
        changedResults.map((result: any) => result.totalElapsedMs),
      ),
    },
    measurements: args.compact
      ? {
          coldExecuteMs: coldResults.map(
            (result: any) => result.executeElapsedMs,
          ),
          changedExecuteMs: changedResults.map(
            (result: any) => result.executeElapsedMs,
          ),
          changedTotalMs: changedResults.map(
            (result: any) => result.totalElapsedMs,
          ),
          coldQueryStatuses: coldResults.map(
            (result: any) => result.queryStatuses,
          ),
          coldReviewSummaryDigests: coldResults.map(
            (result: any) => result.reviewSummaryDigest,
          ),
          coldCacheSources: coldResults.map(
            (result: any) => result.cacheSources,
          ),
          coldSelectedBaseKinds: coldResults.map(
            (result: any) => result.selectedBaseKind,
          ),
          coldWasmBoundaryBytes: coldResults.map(
            (result: any) => result.wasmBoundaryBytes,
          ),
          coldCounts: coldResults.map((result: any) => result.counts),
          coldIdentities: coldResults.map((result: any) => ({
            implementationDigest: result.implementationDigest,
            planDigest: result.planDigest,
            profileDigest: result.profileDigest,
            profileLockDigest: result.profileLockDigest,
            runtimeAuthorityDigest: result.runtimeAuthorityDigest,
            productContractDigest: result.productContractDigest,
            dependencyCertificateDigest: result.dependencyCertificateDigest,
          })),
        }
      : undefined,
    results: args.compact ? undefined : results,
  })}\n`,
);
