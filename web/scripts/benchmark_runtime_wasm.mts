import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { DEFAULT_BROWSER_OPTIONS } from "../src/lib/generatedContract";
import { buildRustV2Options } from "../src/lib/rustPipelineRuntime";
type RuntimeModule = typeof import("../src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js");

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
    } else {
      throw new Error(`unknown or incomplete argument: ${token ?? ""}`);
    }
  }
  if (!raw) throw new Error("--raw <path> is required");
  return { raw, wasm, runtimeJs, iterations, mode, fullOptions };
}

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const args = parseArgs(process.argv.slice(2));
const runtime = (args.runtimeJs
  ? await import(pathToFileURL(args.runtimeJs).href)
  : await import(
      "../src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js"
    )) as RuntimeModule;
const inputBytes = new Uint8Array(await readFile(args.raw));
const wasmBytes = await readFile(args.wasm);
runtime.initSync({ module: wasmBytes });

const inputSha256 = sha256(inputBytes);
const stableWorkspaceId = sha256(`benchmark-workspace:${inputSha256}`);
const supports = new runtime.RuntimeSupportFiles();
const results: unknown[] = [];
let previousRoot: string | null = null;
try {
  for (let iteration = 0; iteration < args.iterations; iteration += 1) {
    const workspaceId =
      args.mode === "warm" ? stableWorkspaceId : sha256(`${stableWorkspaceId}:${iteration}`);
    let handle: ReturnType<typeof runtime.execute_workspace> | undefined;
    try {
      const totalStarted = performance.now();
      const executeStarted = performance.now();
      handle = runtime.execute_workspace(
        JSON.stringify({
          protocolVersion: "chronicle-preprocessing-runtime/v1",
          requestId: `benchmark-${args.mode}-${iteration}`,
          command: "ExecuteWorkspace",
          workspaceRootDigest: args.mode === "warm" ? previousRoot : null,
          workspaceId,
          inputFileName: path.basename(args.raw),
          inputSha256,
          options: buildRustV2Options(
            {
              ...DEFAULT_BROWSER_OPTIONS,
              selectedTimezone: "America/Chicago",
              timezoneHandling: "selected-filter",
              useFilterFile: false,
              useAppsForcingScreenOpenFile: false,
              useBackgroundAppsFile: false,
              useAppCodebook: false,
              modelConcurrentUsage: args.fullOptions,
              enableScreenGatedCrediting: args.fullOptions,
              enableAggregates: args.fullOptions,
            },
            { datetimeOfPreprocessing: "2026-07-23 00:00:00 UTC" },
          ),
        }),
        inputBytes,
        supports,
      );
      const executeElapsedMs = performance.now() - executeStarted;
      const manifest = JSON.parse(handle.manifest_json());
      previousRoot = manifest.workspaceRootDigest;
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
        digestVerificationElapsedMs += performance.now() - verificationStarted;
        if (computedDigest !== metadata.digest) {
          throw new Error(
            `artifact digest mismatch for ${metadata.kind}: ${computedDigest} != ${metadata.digest}`,
          );
        }
        artifacts.push({ kind: metadata.kind, bytes: bytes.byteLength, digest: metadata.digest });
      }
      artifacts.sort((left, right) => right.bytes - left.bytes || left.kind.localeCompare(right.kind));
      const totalElapsedMs = performance.now() - totalStarted;
      results.push({
        iteration,
        executeElapsedMs,
        artifactExtractionElapsedMs,
        digestVerificationElapsedMs,
        totalElapsedMs,
        workspaceRootDigest: manifest.workspaceRootDigest,
        implementationDigest: manifest.implementationDigest,
        planDigest: manifest.planDigest,
        profileDigest: manifest.profileDigest,
        profileLockDigest: manifest.profileLockDigest,
        runtimeAuthorityDigest: manifest.runtimeAuthorityDigest,
        productContractDigest: manifest.productContractDigest,
        dependencyCertificateDigest: manifest.dependencyCertificateDigest,
        dependencyCacheDecision: manifest.dependencyCacheDecision,
        publishedOutputsDigest: manifest.processingSummary.publishedOutputsDigest,
        counts: manifest.counts,
        nodeStatuses: manifest.nodeExecutions.map(
          (execution: { node_id: string; status: string }) => [execution.node_id, execution.status],
        ),
        stepStatuses: manifest.stepExecutions.map(
          (execution: { step_id: string; status: string }) => [execution.step_id, execution.status],
        ),
        artifactCount: artifacts.length,
        totalArtifactBytes,
        artifacts,
      });
    } finally {
      try {
        handle?.free();
      } catch {}
    }
  }
} finally {
  try {
    supports.free();
  } catch {}
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
    },
    mode: args.mode,
    fullOptions: args.fullOptions,
    iterations: args.iterations,
    results,
  })}\n`,
);
