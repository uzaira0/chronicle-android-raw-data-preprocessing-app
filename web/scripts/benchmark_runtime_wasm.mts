import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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
  let workspaceCount = 1;
  let workspaceOffset = 0;
  const benchmarkCases = new Set([
    "unchanged",
    "upstream_timezone_policy",
    "middle_concurrent_usage",
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
  if (benchmarkCase !== "unchanged" && mode !== "warm") {
    throw new Error(
      "--case requires --mode warm so iteration 0 can seed the workspace",
    );
  }
  if (benchmarkCase !== "unchanged" && iterations < 2) {
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
        args.mode === "warm"
          ? stableWorkspaceId
          : sha256(`${stableWorkspaceId}:${iteration}`);
      let handle: ReturnType<typeof runtime.execute_workspace> | undefined;
      try {
        const changed = iteration > 0;
        const browserOptions = {
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
          ...(changed && args.benchmarkCase === "downstream_day_coverage"
            ? { enableDayCoverage: true }
            : {}),
          ...(changed && args.benchmarkCase === "output_study_name"
            ? { studyName: "Synthetic benchmark B" }
            : {}),
        };
        const totalStarted = performance.now();
        const executeStarted = performance.now();
        handle = runtime.execute_workspace(
          JSON.stringify({
            protocolVersion: "chronicle-preprocessing-runtime/v1",
            requestId: `benchmark-${args.mode}-${args.benchmarkCase}-${syntheticIndex}-${iteration}`,
            command:
              args.materialization === "review"
                ? "QueryReview"
                : "ExecuteWorkspace",
            workspaceRootDigest: args.mode === "warm" ? previousRoot : null,
            workspaceId,
            inputFileName,
            inputSha256,
            options: buildRustV2Options(browserOptions, {
              datetimeOfPreprocessing: "2026-07-23 00:00:00 UTC",
            }),
          }),
          inputBytes,
          supports,
        );
        const executeElapsedMs = performance.now() - executeStarted;
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
          stepStatuses: manifest.stepExecutions.map(
            (execution: { step_id: string; status: string }) => [
              execution.step_id,
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
      }
    }
  }
} finally {
  try {
    supports.free();
  } catch {}
}

const coldResults = results.filter(
  (result: any) => result.iteration === 0,
);
const changedResults = results.filter(
  (result: any) => result.iteration > 0,
);
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
    },
    mode: args.mode,
    benchmarkCase: args.benchmarkCase,
    materialization: args.materialization,
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
        }
      : undefined,
    results: args.compact ? undefined : results,
  })}\n`,
);
