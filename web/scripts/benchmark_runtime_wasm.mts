/**
 * Runtime benchmark over the web app's own Rust entry points.
 *
 * This helper does not build runtime requests. It calls the functions the
 * worker calls — `executeRustRuntime` for a Process run, and for a View-tab
 * A/B comparison `queryPersistedRustReview` first and `queryRustReview` with
 * the raw bytes on a miss (`processPersistedOrRawChangedReview` in
 * `rustWorkerClient.ts`) — with the runtime toggles the app sends
 * (`incrementalEngine: false`, so every request uses the sequential engine;
 * `provenanceEvidence: false`, the Performance card default) and the support
 * files the app resolves (`resolveDefaultSupportFiles`). The request shape,
 * persisted-workspace recovery, preflight, base selection, and artifact
 * verification are therefore the app's, not a copy of them.
 *
 * Node has no OPFS and no Web Locks, so the helper installs an in-memory
 * File System Access root (`testSupport/memoryFileSystem`) and a pass-through
 * lock, and the worker's OPFS payload spill is a Map behind the same
 * `installRustPayloadSpill` budget the pool would give the worker
 * (`--simultaneous-workers`). Storage and spill I/O are consequently
 * memory-speed; every other cost is real. Comparisons offer Rust the
 * review-summary digests of earlier comparisons of the same input, as the page
 * does.
 *
 * Modes:
 *   --mode cold  every iteration starts from empty storage. `--materialization
 *                full` is a first Process run of the file; `review` is a
 *                non-persisted raw review, which is the cold oracle.
 *   --mode warm  one persisted workspace per file. Iteration 0 is a Process
 *                run with the A options; iterations 1..N-1 alternate B, A, B…
 *                so every one of them is a real option toggle, either as
 *                Process runs (`full`) or as View-tab comparisons (`review`).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { comparisonSupportCacheKey } from "../src/lib/comparisonSupportKey";
import { DEFAULT_BROWSER_OPTIONS } from "../src/lib/generatedContract";
import { resolveDefaultSupportFiles } from "../src/lib/processingUiContract";
import {
  payloadBudgetBytesForWorkers,
  readDeviceMemory,
} from "../src/lib/concurrency";
import {
  executeRustRuntime,
  initializeRustRuntime,
  installRustPayloadSpill,
  queryPersistedRustReview,
  queryRustReview,
  rustWasmMemoryBytes,
  setRustRuntimeForTesting,
} from "../src/lib/rustPipelineRuntime";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
} from "../src/lib/types";
import {
  MemoryDirectoryHandle,
  memoryDirectoryHandle,
} from "../src/testSupport/memoryFileSystem";

type RuntimeModule = Parameters<typeof setRustRuntimeForTesting>[0] & {
  initSync(options: { module: Uint8Array }): unknown;
};

const BENCHMARK_CASES = new Set([
  "unchanged",
  "upstream_timezone_policy",
  "middle_concurrent_usage",
  "middle_minimum_usage_duration",
  "downstream_day_coverage",
  "output_study_name",
]);

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
  let wasm: string | null = null;
  let iterations = 1;
  let mode: "cold" | "warm" = "cold";
  let fullOptions = false;
  let summary = false;
  let benchmarkCase = "unchanged";
  let materialization: "full" | "review" = "full";
  let changedOnly = false;
  let waitForStart = false;
  let simultaneousWorkers = 1;
  let workspaceCount = 1;
  let workspaceOffset = 0;
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
    } else if (token === "--case" && next && BENCHMARK_CASES.has(next)) {
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
    } else if (token === "--wait-for-start") {
      waitForStart = true;
    } else if (token === "--simultaneous-workers" && next) {
      simultaneousWorkers = positiveInteger(token, next);
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
  if ((runtimeJs === null) !== (wasm === null)) {
    throw new Error("--runtime-js and --wasm must be given together");
  }
  if (changedOnly && mode !== "cold") {
    throw new Error(
      "--changed-only applies to --mode cold; warm mode alternates A and B",
    );
  }
  if (benchmarkCase !== "unchanged" && mode === "cold" && !changedOnly) {
    throw new Error(
      "--case in cold mode requires --changed-only (cold runs one option set)",
    );
  }
  if (mode === "warm" && benchmarkCase === "unchanged") {
    throw new Error("--mode warm requires a --case that changes an option");
  }
  if (mode === "warm" && iterations < 2) {
    throw new Error(
      "--mode warm requires at least 2 iterations: a Process run, then toggles",
    );
  }
  return {
    raw,
    wasm,
    runtimeJs,
    iterations,
    mode,
    fullOptions,
    summary,
    benchmarkCase,
    materialization,
    changedOnly,
    waitForStart,
    simultaneousWorkers,
    workspaceCount,
    workspaceOffset,
  };
}

function distribution(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction: number) =>
    sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
  return {
    count: sorted.length,
    minimumMs: sorted[0] ?? 0,
    medianMs: percentile(0.5),
    p90Ms: percentile(0.9),
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
const webDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// --- Browser environment the worker relies on -------------------------------

// Bundled support assets are imported with `?url`, which resolves to a
// root-relative path under this package. Serve exactly those bytes; anything
// else goes to the real fetch.
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("/")) {
    const file = path.join(webDirectory, url.split("?")[0] ?? url);
    if (file.startsWith(`${webDirectory}${path.sep}`) && existsSync(file)) {
      return new Response(await readFile(file));
    }
  }
  return realFetch(input, init);
};

let storageRoot = new MemoryDirectoryHandle();
const nodeNavigator = globalThis.navigator as Navigator | undefined;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  writable: true,
  value: {
    hardwareConcurrency:
      nodeNavigator?.hardwareConcurrency ?? cpus().length,
    // Chromium reports at most 8; the worker payload budget is sized from it.
    deviceMemory: 8,
    userAgent: nodeNavigator?.userAgent ?? `Node.js/${process.version}`,
    storage: {
      getDirectory: () => Promise.resolve(memoryDirectoryHandle(storageRoot)),
      persisted: () => Promise.resolve(true),
    },
    // Calls are awaited one at a time, so a pass-through lock serializes
    // exactly as the browser's per-workspace lock would.
    locks: {
      request: (
        _name: string,
        optionsOrCallback: unknown,
        callback?: () => unknown,
      ) =>
        Promise.resolve().then(() =>
          (typeof optionsOrCallback === "function"
            ? (optionsOrCallback as () => unknown)
            : callback!)(),
        ),
    },
  },
});

// --- Runtime ----------------------------------------------------------------

const defaultPackage = path.join(
  webDirectory,
  "src/wasm/chronicle_preprocessing_runtime_wasm/pkg",
);
const wasmPath =
  args.wasm ??
  path.join(defaultPackage, "chronicle_preprocessing_runtime_wasm_bg.wasm");
const wasmBytes = new Uint8Array(await readFile(wasmPath));
if (args.runtimeJs) {
  // A non-default package: instantiate its own bindings and inject them.
  const module = (await import(
    pathToFileURL(args.runtimeJs).href
  )) as RuntimeModule;
  module.initSync({ module: wasmBytes });
  setRustRuntimeForTesting(module);
} else {
  // The worker's own initialization: a compiled module handed to the bindings.
  await initializeRustRuntime(await WebAssembly.compile(wasmBytes));
}
// The worker installs an OPFS payload spill with the pool's per-worker budget
// (`workerPayloadBudgetBytes` in App.tsx). Here the spilled bytes live in a
// Map; the runtime's budget accounting and spill decisions are its own.
const payloadBudgetBytes = payloadBudgetBytesForWorkers(
  readDeviceMemory(),
  args.simultaneousWorkers,
);
const spilled = new Map<number, Uint8Array>();
const spillStats = { puts: 0, putBytes: 0, gets: 0, getBytes: 0, peakSpilledBytes: 0 };
let spilledBytes = 0;
await installRustPayloadSpill(
  {
    put(id, bytes) {
      const previous = spilled.get(id);
      if (previous) spilledBytes -= previous.byteLength;
      spilled.set(id, bytes.slice());
      spilledBytes += bytes.byteLength;
      spillStats.puts += 1;
      spillStats.putBytes += bytes.byteLength;
      spillStats.peakSpilledBytes = Math.max(spillStats.peakSpilledBytes, spilledBytes);
    },
    get(id) {
      const bytes = spilled.get(id);
      if (!bytes) throw new Error(`payload spill has no object ${id}`);
      spillStats.gets += 1;
      spillStats.getBytes += bytes.byteLength;
      return bytes.slice();
    },
    remove(id) {
      const bytes = spilled.get(id);
      if (bytes) spilledBytes -= bytes.byteLength;
      spilled.delete(id);
    },
  },
  payloadBudgetBytes,
);

// --- Options ----------------------------------------------------------------

const baseOptions: BrowserProcessingOptions = {
  ...DEFAULT_BROWSER_OPTIONS,
  // The synthetic corpus is recorded in America/Chicago; the app requires a
  // selected timezone before it runs.
  selectedTimezone: "America/Chicago",
  modelConcurrentUsage: args.fullOptions,
  enableScreenGatedCrediting: args.fullOptions,
  enableAggregates: args.fullOptions,
};
function optionsForArm(arm: "A" | "B"): BrowserProcessingOptions {
  if (arm === "A") return baseOptions;
  switch (args.benchmarkCase) {
    case "upstream_timezone_policy":
      return { ...baseOptions, timezoneHandling: "primary-convert" };
    case "middle_concurrent_usage":
      return { ...baseOptions, modelConcurrentUsage: !baseOptions.modelConcurrentUsage };
    case "middle_minimum_usage_duration":
      return { ...baseOptions, minimumUsageDuration: 2 };
    case "downstream_day_coverage":
      return { ...baseOptions, enableDayCoverage: true };
    case "output_study_name":
      return { ...baseOptions, studyName: "Synthetic benchmark B" };
    default:
      return baseOptions;
  }
}
const supportByArm = {
  A: await resolveDefaultSupportFiles(optionsForArm("A")),
  B: await resolveDefaultSupportFiles(optionsForArm("B")),
};
const supportKeyByArm = {
  A: await comparisonSupportCacheKey(supportByArm.A),
  B: await comparisonSupportCacheKey(supportByArm.B),
};

// The worker resolves one session timestamp per file; a fixed one keeps the
// app arm and the cold oracle (a different process) byte-comparable.
const runtime: BrowserProcessingRuntime = {
  executionAuthority: "rust",
  persistRustWorkspace: true,
  incrementalEngine: false,
  provenanceEvidence: false,
  datetimeOfPreprocessing: "2026-07-23 00:00:00 UTC",
  performanceTraceId: `benchmark-${process.pid}`,
};

// The runtime's own phase tracer (`traceRuntimePhase`) reports through
// console.info; collect it instead of printing it.
const TRACE_PREFIX = "CHRONICLE_RUNTIME_PERF ";
let phaseSink: Record<string, number> | null = null;
const realInfo = console.info.bind(console);
console.info = (...values: unknown[]) => {
  const [first] = values;
  if (typeof first === "string" && first.startsWith(TRACE_PREFIX)) {
    const event = JSON.parse(first.slice(TRACE_PREFIX.length)) as {
      phase?: string;
      elapsedMs?: number;
    };
    if (phaseSink && event.phase && typeof event.elapsedMs === "number") {
      phaseSink[event.phase] = (phaseSink[event.phase] ?? 0) + event.elapsedMs;
    }
    return;
  }
  realInfo(...values);
};

// --- Execution --------------------------------------------------------------

const inputBytes = new Uint8Array(await readFile(args.raw));
const inputSha256 = sha256(inputBytes);
const inputSha256Hex = inputSha256.replace(/^sha256:/, "");

type QueryExecution = { query_id: string; status: string };
type ManifestIdentity = {
  implementationDigest: string;
  planDigest: string;
  profileDigest: string;
  profileLockDigest: string;
  productContractDigest: string;
  dependencyCertificateDigest: string;
};
type RunRecord = {
  workspaceIndex: number;
  inputFileName: string;
  iteration: number;
  arm: "A" | "B";
  kind: "process" | "review";
  elapsedMs: number;
  phasesMs: Record<string, number>;
  persistedReviewHit: boolean | null;
  persistedProbeMs: number | null;
  rawReviewMs: number | null;
  workspaceRootDigest: string | null;
  previousWorkspaceRootDigest: string | null;
  reviewSummaryDigest: string | null;
  reviewSummaryReused: boolean | null;
  comparisonDigest: string | null;
  cacheSources: string[];
  resumeBaseArtifacts: string[];
  artifactCount: number | null;
  counts: { original: number; processed: number; app: number; screen: number };
  identity: ManifestIdentity;
  queryStatuses: [string, string][];
};

function identityOf(manifest: ManifestIdentity): ManifestIdentity {
  return {
    implementationDigest: manifest.implementationDigest,
    planDigest: manifest.planDigest,
    profileDigest: manifest.profileDigest,
    profileLockDigest: manifest.profileLockDigest,
    productContractDigest: manifest.productContractDigest,
    dependencyCertificateDigest: manifest.dependencyCertificateDigest,
  };
}

async function runProcess(
  inputFileName: string,
  arm: "A" | "B",
): Promise<Omit<RunRecord, "workspaceIndex" | "inputFileName" | "iteration">> {
  const phasesMs: Record<string, number> = {};
  phaseSink = phasesMs;
  const started = performance.now();
  const execution = await executeRustRuntime(
    inputBytes,
    inputFileName,
    optionsForArm(arm),
    supportByArm[arm],
    runtime,
    inputSha256Hex,
  );
  const elapsedMs = performance.now() - started;
  phaseSink = null;
  const { manifest } = execution;
  return {
    arm,
    kind: "process",
    elapsedMs,
    phasesMs,
    persistedReviewHit: null,
    persistedProbeMs: null,
    rawReviewMs: null,
    workspaceRootDigest: manifest.workspaceRootDigest,
    previousWorkspaceRootDigest: manifest.previousWorkspaceRootDigest,
    reviewSummaryDigest: null,
    reviewSummaryReused: null,
    comparisonDigest: null,
    cacheSources: [],
    resumeBaseArtifacts: manifest.artifacts
      .map(({ kind }) => kind)
      .filter((kind) => kind === "review-base" || kind === "reconstruction-base"),
    artifactCount: manifest.artifacts.length,
    counts: manifest.counts,
    identity: identityOf(manifest),
    queryStatuses: manifest.queryExecutions.map(
      (execution: QueryExecution) => [execution.query_id, execution.status],
    ),
  };
}

// The page offers Rust the review-summary digests it already holds for this
// input (`offerReviewSummaryDigests` in rustWorkerClient.ts: a per-input LRU
// of REVIEW_SUMMARY_REUSE_LRU_CAPACITY = 8, fed by every earlier comparison),
// and Rust then skips re-serializing a summary the page has. One process
// serves one input, so one list mirrors that LRU's digests.
const REVIEW_SUMMARY_OFFER_CAPACITY = 8;
const offeredReviewSummaryDigests: string[] = [];
function admitReviewSummaryDigest(digest: string): void {
  const index = offeredReviewSummaryDigests.indexOf(digest);
  if (index >= 0) offeredReviewSummaryDigests.splice(index, 1);
  offeredReviewSummaryDigests.push(digest);
  if (offeredReviewSummaryDigests.length > REVIEW_SUMMARY_OFFER_CAPACITY) {
    offeredReviewSummaryDigests.shift();
  }
}

/** The View-tab comparison: persisted bases first, raw bytes on a miss. */
async function runReview(
  inputFileName: string,
  arm: "A" | "B",
  reviewRuntime: BrowserProcessingRuntime,
): Promise<Omit<RunRecord, "workspaceIndex" | "inputFileName" | "iteration">> {
  const phasesMs: Record<string, number> = {};
  phaseSink = phasesMs;
  const options = optionsForArm(arm);
  const offer = offeredReviewSummaryDigests.length
    ? [...offeredReviewSummaryDigests]
    : undefined;
  const started = performance.now();
  let persistedProbeMs: number | null = null;
  let rawReviewMs: number | null = null;
  let execution = null;
  if (reviewRuntime.persistRustWorkspace) {
    execution = await queryPersistedRustReview(
      inputBytes.byteLength,
      inputFileName,
      options,
      supportByArm[arm],
      reviewRuntime,
      inputSha256Hex,
      supportKeyByArm[arm],
      offer,
    );
    persistedProbeMs = performance.now() - started;
  }
  const persistedReviewHit = reviewRuntime.persistRustWorkspace
    ? execution !== null
    : null;
  if (!execution) {
    const rawStarted = performance.now();
    execution = await queryRustReview(
      inputBytes,
      inputFileName,
      options,
      supportByArm[arm],
      reviewRuntime,
      inputSha256Hex,
      supportKeyByArm[arm],
      offer,
    );
    rawReviewMs = performance.now() - rawStarted;
  }
  const elapsedMs = performance.now() - started;
  phaseSink = null;
  // Cold mode stands for a page with no earlier comparison: it offers nothing.
  if (args.mode === "warm") {
    admitReviewSummaryDigest(execution.reviewSummaryDigest);
  }
  const manifest = JSON.parse(execution.manifestJson) as {
    queryExecutions: QueryExecution[];
  };
  return {
    arm,
    kind: "review",
    elapsedMs,
    phasesMs,
    persistedReviewHit,
    persistedProbeMs,
    rawReviewMs,
    workspaceRootDigest: null,
    previousWorkspaceRootDigest: execution.previousWorkspaceRootDigest,
    reviewSummaryDigest: execution.reviewSummaryDigest,
    reviewSummaryReused: execution.reviewSummaryReused === true,
    comparisonDigest: execution.comparisonDigest,
    cacheSources: execution.cacheSources,
    resumeBaseArtifacts: [],
    artifactCount: null,
    counts: execution.counts,
    identity: identityOf(execution),
    queryStatuses: manifest.queryExecutions.map((query) => [
      query.query_id,
      query.status,
    ]),
  };
}

const workspaces = Array.from({ length: args.workspaceCount }, (_, index) => {
  const syntheticIndex = args.workspaceOffset + index;
  const extension = path.extname(args.raw);
  // Only `--workspace-count` > 1 renames the file, and every name carries the
  // same bytes: that is duplicate-content amplification, never distinct input.
  // `runtimeWorkspaceId` keys a workspace by content, so in warm mode every
  // name shares one persisted workspace, exactly as duplicated files do in
  // the app.
  const inputFileName =
    args.workspaceCount === 1 && args.workspaceOffset === 0
      ? path.basename(args.raw)
      : `${path.basename(args.raw, extension)}-${String(syntheticIndex + 1).padStart(3, "0")}${extension}`;
  return { syntheticIndex, inputFileName };
});

const results: RunRecord[] = [];
async function runIteration(
  workspace: (typeof workspaces)[number],
  iteration: number,
): Promise<void> {
  let record: Omit<RunRecord, "workspaceIndex" | "inputFileName" | "iteration">;
  if (args.mode === "cold") {
    storageRoot = new MemoryDirectoryHandle();
    const arm = args.changedOnly ? "B" : "A";
    record =
      args.materialization === "full"
        ? await runProcess(workspace.inputFileName, arm)
        : await runReview(workspace.inputFileName, arm, {
            ...runtime,
            persistRustWorkspace: false,
          });
  } else {
    const arm = iteration % 2 === 1 ? "B" : "A";
    record =
      iteration === 0 || args.materialization === "full"
        ? await runProcess(workspace.inputFileName, arm)
        : await runReview(workspace.inputFileName, arm, runtime);
  }
  results.push({
    workspaceIndex: workspace.syntheticIndex,
    inputFileName: workspace.inputFileName,
    iteration,
    ...record,
  });
}

// Warm mode sets every workspace up (its Process run) before any timed
// toggle, so a synchronized batch start measures toggles only.
const firstTimedIteration = args.mode === "warm" ? 1 : 0;
if (args.mode === "warm") {
  for (const workspace of workspaces) await runIteration(workspace, 0);
}
if (args.waitForStart) {
  if (typeof process.send !== "function") {
    throw new Error("--wait-for-start requires a Node IPC parent");
  }
  process.send({ type: "ready" });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("timed out waiting for benchmark start")),
      600_000,
    );
    process.once("message", (message) => {
      clearTimeout(timeout);
      if ((message as { type?: unknown } | null)?.type !== "start") {
        reject(new Error("invalid benchmark start message"));
        return;
      }
      resolve();
    });
  });
}
for (const workspace of workspaces) {
  for (
    let iteration = firstTimedIteration;
    iteration < args.iterations;
    iteration += 1
  ) {
    await runIteration(workspace, iteration);
  }
}
if (typeof process.send === "function") {
  process.send({ type: "work-complete" });
}

const elapsed = (selected: RunRecord[]) =>
  distribution(selected.map((result) => result.elapsedMs));
// Cold iterations are independent repeats of one option set; only warm
// iterations after the Process run are A/B toggles.
const distributions =
  args.mode === "cold"
    ? { cold: elapsed(results) }
    : {
        firstRun: elapsed(results.filter((result) => result.iteration === 0)),
        toggleToB: elapsed(
          results.filter((result) => result.iteration > 0 && result.arm === "B"),
        ),
        toggleToA: elapsed(
          results.filter((result) => result.iteration > 0 && result.arm === "A"),
        ),
      };
const resourceUsage = process.resourceUsage();
process.stdout.write(
  `${JSON.stringify({
    receiptVersion: "chronicle-runtime-benchmark/v2",
    path: "app runtime entry points (rustPipelineRuntime.ts), sequential engine",
    input: {
      path: args.raw,
      bytes: inputBytes.byteLength,
      sha256: inputSha256,
    },
    wasm: { bytes: wasmBytes.byteLength, sha256: sha256(wasmBytes) },
    runtime: {
      incrementalEngine: runtime.incrementalEngine,
      provenanceEvidence: runtime.provenanceEvidence,
      persistRustWorkspace: runtime.persistRustWorkspace,
      storage: "in-memory File System Access root",
    },
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
      // macOS and Linux both report maxRSS in kibibytes.
      peakRssBytes: resourceUsage.maxRSS * 1024,
      wasmLinearMemoryBytes: rustWasmMemoryBytes(),
    },
    payloadSpill: {
      simultaneousWorkers: args.simultaneousWorkers,
      budgetBytes: payloadBudgetBytes,
      ...spillStats,
    },
    mode: args.mode,
    benchmarkCase: args.benchmarkCase,
    materialization: args.materialization,
    changedOnly: args.changedOnly,
    fullOptions: args.fullOptions,
    iterations: args.iterations,
    workspaceCount: args.workspaceCount,
    workspaceOffset: args.workspaceOffset,
    distributions,
    results: args.summary
      ? results.map(({ queryStatuses, phasesMs, ...rest }) => ({
          ...rest,
          phasesMs,
          queryStatusCount: queryStatuses.length,
        }))
      : results,
  })}\n`,
);
