/**
 * Measured-performance harness for the two recorded measure-first debt items in
 * `docs/semantic-federation/final-review-matrix.md`:
 *
 *   5. "The semantic index is reconstructed for each query; a root-digest keyed
 *      cache should be added if repeated interactive queries become material."
 *   6. "Parquet and SPSS export paths independently parse CSV output, and
 *      visualization payloads are eagerly materialized."
 *
 * Both are measured against the SAME compiled WASM the product ships
 * (`src/wasm/*​/pkg`), driven from Node, so the numbers are product costs and
 * not native-only proxies. Nothing here is a gate; it prints JSON.
 *
 * Usage (from `web/`):
 *   npm run measure:perf-debt -- --raw <input.csv> --label <name> \
 *     [--execute-iterations N] [--query-iterations N] [--rebuild-iterations N]
 *
 * With no `--raw`, the reproducible 600-data-row contract fixture used by the
 * runtime crate's `representative_600_event_csv` is generated in-process.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";

import { DEFAULT_BROWSER_OPTIONS } from "../src/lib/generatedContract";
import type { BrowserProcessingOptions } from "../src/lib/generatedContract";
import { buildRustV2Options } from "../src/lib/rustPipelineRuntime";

type RuntimeModule =
  typeof import("../src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js");
type SemanticIndexModule =
  typeof import("../src/wasm/chronicle_semantic_index_wasm/pkg/chronicle_semantic_index_wasm.js");

/** Registered production queries; the semantic index rejects anything else. */
const REGISTERED_QUERY_IDS = [
  "open-obligations",
  "actual-executions",
  "role-assignments",
  "qualification-traces",
  "requirement-traces",
  "reason-trace",
  "has-open-obligations",
] as const;

function positiveInteger(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]) {
  let raw: string | null = null;
  let label = "contract-600";
  let executeIterations = 9;
  let queryIterations = 40;
  let rebuildIterations = 15;
  let dumpSemanticSource: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--raw" && next) {
      raw = path.resolve(next);
      index += 1;
    } else if (token === "--label" && next) {
      label = next;
      index += 1;
    } else if (token === "--execute-iterations" && next) {
      executeIterations = positiveInteger(token, next);
      index += 1;
    } else if (token === "--query-iterations" && next) {
      queryIterations = positiveInteger(token, next);
      index += 1;
    } else if (token === "--rebuild-iterations" && next) {
      rebuildIterations = positiveInteger(token, next);
      index += 1;
    } else if (token === "--dump-semantic-source" && next) {
      dumpSemanticSource = path.resolve(next);
      index += 1;
    } else {
      throw new Error(`unknown or incomplete argument: ${token ?? ""}`);
    }
  }
  return {
    raw,
    label,
    executeIterations,
    queryIterations,
    rebuildIterations,
    dumpSemanticSource,
  };
}

/**
 * Byte-for-byte the runtime crate's `representative_600_event_csv()` fixture so
 * the browser measurement and the Rust measurement describe the same input.
 */
function representative600EventCsv(): Uint8Array {
  let csv =
    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone\n";
  for (let index = 0; index < 600; index += 1) {
    const hour = String(Math.floor(index / 60)).padStart(2, "0");
    const minute = String(index % 60).padStart(2, "0");
    const interaction = index % 2 === 0 ? "Activity Resumed" : "Activity Paused";
    csv += `Study,P01,Target Child,Chat,${interaction},com.example.chat,2026-03-07 ${hour}:${minute}:00,America/Chicago\n`;
  }
  return new TextEncoder().encode(csv);
}

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function distribution(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ??
    0;
  const mean =
    sorted.length === 0
      ? 0
      : sorted.reduce((total, value) => total + value, 0) / sorted.length;
  return {
    count: sorted.length,
    minimumMs: sorted[0] ?? 0,
    p25Ms: percentile(0.25),
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    maximumMs: sorted.at(-1) ?? 0,
    meanMs: mean,
  };
}

const args = parseArgs(process.argv.slice(2));
const inputBytes = args.raw
  ? new Uint8Array(await readFile(args.raw))
  : representative600EventCsv();
const inputFileName = args.raw ? path.basename(args.raw) : "contract-600.csv";
const inputSha256 = sha256(inputBytes);

const runtime = (await import(
  "../src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js"
)) as RuntimeModule;
runtime.initSync({
  module: await readFile(
    path.resolve(
      "src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm",
    ),
  ),
});
const semantic = (await import(
  "../src/wasm/chronicle_semantic_index_wasm/pkg/chronicle_semantic_index_wasm.js"
)) as SemanticIndexModule;
semantic.initSync({
  module: await readFile(
    path.resolve(
      "src/wasm/chronicle_semantic_index_wasm/pkg/chronicle_semantic_index_wasm_bg.wasm",
    ),
  ),
});

const supports = new runtime.RuntimeSupportFiles();

/** Baseline options: no support files, so the harness needs no fixtures. */
function browserOptions(
  overrides: Partial<BrowserProcessingOptions>,
): BrowserProcessingOptions {
  return {
    ...DEFAULT_BROWSER_OPTIONS,
    selectedTimezone: "America/Chicago",
    timezoneHandling: "selected-filter" as const,
    useFilterFile: false,
    useAppsForcingScreenOpenFile: false,
    useBackgroundAppsFile: false,
    useAppCodebook: false,
    ...overrides,
  };
}

let coldWorkspaceCounter = 0;
function coldWorkspaceId(tag: string): string {
  coldWorkspaceCounter += 1;
  return sha256(
    `chronicle-perf-debt:${tag}:${inputSha256}:${coldWorkspaceCounter}`,
  );
}

type ExecuteOutcome = {
  elapsedMs: number;
  artifacts: Map<string, { size: number; bytes?: Uint8Array }>;
  manifest: {
    counts: { original: number; app: number; screen: number };
    workspaceRootDigest: string;
  };
};

function executeCold(
  tag: string,
  overrides: Partial<BrowserProcessingOptions>,
  captureKinds: ReadonlySet<string> = new Set(),
): ExecuteOutcome {
  const requestJson = JSON.stringify({
    protocolVersion: "chronicle-preprocessing-runtime/v1",
    requestId: `measure-perf-debt-${tag}-${coldWorkspaceCounter}`,
    command: "ExecuteWorkspace",
    workspaceRootDigest: null,
    workspaceId: coldWorkspaceId(tag),
    inputFileName,
    inputSha256,
    options: buildRustV2Options(browserOptions(overrides), {
      datetimeOfPreprocessing: "2026-07-27 00:00:00 UTC",
    }),
  });
  const started = performance.now();
  const handle = runtime.execute_workspace(requestJson, inputBytes, supports);
  const elapsedMs = performance.now() - started;
  try {
    const manifest = JSON.parse(handle.manifest_json());
    const artifacts = new Map<string, { size: number; bytes?: Uint8Array }>();
    for (let index = 0; index < handle.artifact_count; index += 1) {
      const metadata = JSON.parse(handle.artifact_metadata_json(index));
      artifacts.set(metadata.kind, {
        size: metadata.size,
        bytes: captureKinds.has(metadata.kind)
          ? handle.take_artifact_bytes(index)
          : undefined,
      });
    }
    return { elapsedMs, artifacts, manifest };
  } finally {
    handle.free();
  }
}

type ExecuteConfiguration = {
  name: string;
  overrides: Partial<BrowserProcessingOptions>;
};

/**
 * Cold `execute_workspace` timings in this process are dominated by V8 GC
 * pauses that land wherever they land (observed 24 ms runs next to 240 ms runs
 * for the same configuration). Sampling one configuration to exhaustion before
 * the next therefore charges whole GC cycles to whichever configuration was
 * unlucky. Round-robin interleaving spreads those pauses across every
 * configuration equally, and the reported minimum/p25 are the GC-free cost.
 */
function interleavedExecute(
  configurations: readonly ExecuteConfiguration[],
  iterations: number,
): Map<string, number[]> {
  const samples = new Map<string, number[]>(
    configurations.map((configuration) => [configuration.name, []]),
  );
  for (const configuration of configurations) {
    // Discarded warm-up so JIT/allocator state is not charged to sample 0.
    executeCold(`${configuration.name}-warmup`, configuration.overrides);
  }
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const configuration of configurations) {
      samples
        .get(configuration.name)!
        .push(executeCold(configuration.name, configuration.overrides).elapsedMs);
    }
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Shape of the run: one reference execution captures the semantic index source
// and the artifact inventory both debt items are measured against.
// ---------------------------------------------------------------------------
const reference = executeCold(
  "reference",
  {},
  new Set(["semantic-index-source-json"]),
);
const semanticSource = reference.artifacts.get(
  "semantic-index-source-json",
)?.bytes;
if (!semanticSource) {
  throw new Error("reference execution produced no semantic index source");
}
if (args.dumpSemanticSource) {
  // The native split harness in `chronicle_semantic_index_wasm` reads this
  // exact artifact so both harnesses describe the same index.
  await mkdir(path.dirname(args.dumpSemanticSource), { recursive: true });
  await writeFile(args.dumpSemanticSource, semanticSource);
}

// ---------------------------------------------------------------------------
// Debt item 5 — semantic index reconstruction vs registered query execution.
// ---------------------------------------------------------------------------
const rebuildSamples: number[] = [];
let semanticIndexBytes = semantic.rebuild_semantic_index(semanticSource);
for (let iteration = 0; iteration < args.rebuildIterations; iteration += 1) {
  const started = performance.now();
  semanticIndexBytes = semantic.rebuild_semantic_index(semanticSource);
  rebuildSamples.push(performance.now() - started);
}

const querySamples: Record<string, number[]> = {};
for (const queryId of REGISTERED_QUERY_IDS) {
  // Warm-up outside the sample window.
  semantic.query_registered(semanticIndexBytes, queryId);
  const samples: number[] = [];
  for (let iteration = 0; iteration < args.queryIterations; iteration += 1) {
    const started = performance.now();
    semantic.query_registered(semanticIndexBytes, queryId);
    samples.push(performance.now() - started);
  }
  querySamples[queryId] = samples;
}

/**
 * A realistic interactive panel refresh: every registered query answered once
 * against the same unchanged workspace root. This is exactly the workload a
 * root-digest keyed store cache would amortize.
 */
const panelSamples: number[] = [];
for (let iteration = 0; iteration < args.queryIterations; iteration += 1) {
  const started = performance.now();
  for (const queryId of REGISTERED_QUERY_IDS) {
    semantic.query_registered(semanticIndexBytes, queryId);
  }
  panelSamples.push(performance.now() - started);
}

// ---------------------------------------------------------------------------
// Debt item 6 — binary export reparse cost and visualization materialization.
// ---------------------------------------------------------------------------
const MEASURED_ARTIFACT_KINDS = [
  "app-csv",
  "screen-csv",
  "app-parquet",
  "screen-parquet",
  "app-spss",
  "screen-spss",
  "visualization-data-json",
];

/**
 * `enablePlotting` defaults to true, so the export configurations are measured
 * against that same default and the visualization configurations vary only the
 * two view flags. Both families are interleaved together in one round-robin so
 * they share the same GC timeline.
 */
const measuredConfigurations: readonly ExecuteConfiguration[] = [
  { name: "exports-off", overrides: {} },
  { name: "parquet-on", overrides: { enableParquetExport: true } },
  { name: "spss-on", overrides: { enableSpssExport: true } },
  {
    name: "parquet-and-spss-on",
    overrides: { enableParquetExport: true, enableSpssExport: true },
  },
  {
    name: "visualization-off",
    overrides: { enablePlotting: false, enableInteractiveTimeline: false },
  },
  {
    name: "visualization-on-interactive-timeline",
    overrides: { enablePlotting: false, enableInteractiveTimeline: true },
  },
];
const executeSamples = interleavedExecute(
  measuredConfigurations,
  args.executeIterations,
);
const executeResults = measuredConfigurations.map((configuration) => {
  const probe = executeCold(configuration.name, configuration.overrides);
  return {
    name: configuration.name,
    distribution: distribution(executeSamples.get(configuration.name)!),
    artifacts: Object.fromEntries(
      [...probe.artifacts]
        .filter(([kind]) => MEASURED_ARTIFACT_KINDS.includes(kind))
        .map(([kind, value]) => [kind, value.size]),
    ),
  };
});

supports.free();

const byName = (name: string) =>
  executeResults.find((entry) => entry.name === name)!;
// `enablePlotting` defaults to true, so "exports-off" is also the
// visualization-materialized baseline; it appears in both families.
const exportsOff = byName("exports-off");
const visualizationOff = byName("visualization-off");
const exportResults = [
  "exports-off",
  "parquet-on",
  "spss-on",
  "parquet-and-spss-on",
].map(byName);
const visualizationResults = [
  "visualization-off",
  "visualization-on-interactive-timeline",
  "exports-off",
].map(byName);

process.stdout.write(
  `${JSON.stringify(
    {
      label: args.label,
      input: {
        fileName: inputFileName,
        bytes: inputBytes.byteLength,
        sha256: inputSha256,
        rawRows: reference.manifest.counts.original,
        appRows: reference.manifest.counts.app,
        screenRows: reference.manifest.counts.screen,
      },
      runtimeVersion: runtime.runtime_version(),
      semanticIndex: {
        sourceBytes: semanticSource.byteLength,
        indexBytes: semanticIndexBytes.byteLength,
        rebuild: distribution(rebuildSamples),
        perQuery: Object.fromEntries(
          Object.entries(querySamples).map(([queryId, samples]) => [
            queryId,
            distribution(samples),
          ]),
        ),
        allRegisteredQueriesOnce: distribution(panelSamples),
      },
      binaryExports: {
        baseline: "exports-off",
        baselineMinimumMs: exportsOff.distribution.minimumMs,
        configurations: exportResults.map((entry) => ({
          ...entry,
          deltaVsBaselineMinimumMs:
            entry.distribution.minimumMs - exportsOff.distribution.minimumMs,
          deltaVsBaselineMinimumPercent:
            ((entry.distribution.minimumMs -
              exportsOff.distribution.minimumMs) /
              exportsOff.distribution.minimumMs) *
            100,
          deltaVsBaselineP25Ms:
            entry.distribution.p25Ms - exportsOff.distribution.p25Ms,
        })),
      },
      visualization: {
        baseline: "visualization-off",
        baselineMinimumMs: visualizationOff.distribution.minimumMs,
        configurations: visualizationResults.map((entry) => ({
          ...entry,
          deltaVsBaselineMinimumMs:
            entry.distribution.minimumMs -
            visualizationOff.distribution.minimumMs,
          deltaVsBaselineMinimumPercent:
            ((entry.distribution.minimumMs -
              visualizationOff.distribution.minimumMs) /
              visualizationOff.distribution.minimumMs) *
            100,
          deltaVsBaselineP25Ms:
            entry.distribution.p25Ms - visualizationOff.distribution.p25Ms,
        })),
      },
    },
    null,
    2,
  )}\n`,
);
