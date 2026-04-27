import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";

import { processRawCsvContent } from "../src/lib/browserPipeline";
import type {
  BrowserProcessingOptions,
  BrowserSupportFiles,
  MatcherInput,
  MatcherOutput,
  ProgressEvent,
  ProgressStepKind,
} from "../src/lib/types";

const DEFAULTS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../src/assets/defaults",
);

async function loadDefaultSupport(name: string): Promise<{
  name: string;
  bytes: ArrayBuffer;
}> {
  const bytes = await readFile(path.join(DEFAULTS_DIR, name));
  return {
    name,
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

type StageRow = {
  stage: ProgressStepKind;
  ms: number;
};

type FileBreakdown = {
  file: string;
  rowCount: number;
  totalMs: number;
  stages: StageRow[];
};

let initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const module = await import(
      "../src/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js"
    );
    const wasmPath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "../src/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm_bg.wasm",
    );
    await module.default({ module_or_path: await readFile(wasmPath) });
  })();
  return initPromise;
}

async function runMatcher(input: MatcherInput): Promise<MatcherOutput> {
  await ensureInit();
  const module = await import(
    "../src/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js"
  );
  return module.matchAppUsageUpdateIndices(
    input.appCodes,
    input.timestampNs,
    input.resumed,
    input.sameStop,
    input.otherStop,
    input.stopped,
    input.options.allowStopEventReuse,
    input.options.useActivityStoppedAsFallback,
    input.options.applyThresholdToFallback,
    input.options.longDurationThresholdNs,
  ) as MatcherOutput;
}

async function profileFile(
  filePath: string,
  supportFiles: BrowserSupportFiles,
): Promise<FileBreakdown> {
  const csvText = await readFile(filePath, "utf-8");
  const options: Partial<BrowserProcessingOptions> = {
    usageSessionMode: "app_and_screen_usage",
    timezoneHandling: "primary-convert",
    useFilterFile: true,
    useAppsForcingScreenOpenFile: true,
    useAppCodebook: true,
  };

  const stageStart = new Map<ProgressStepKind, number>();
  const stages: StageRow[] = [];

  const onProgress = (event: ProgressEvent) => {
    if (event.type !== "step") return;
    const now = performance.now();
    if (event.percent === 0) {
      stageStart.set(event.stepKind, now);
    } else {
      const start = stageStart.get(event.stepKind);
      if (start !== undefined) {
        stages.push({ stage: event.stepKind, ms: now - start });
        stageStart.delete(event.stepKind);
      }
    }
  };

  const totalStart = performance.now();
  const result = await processRawCsvContent(
    path.basename(filePath),
    csvText,
    options,
    supportFiles,
    runMatcher,
    { datetimeOfPreprocessing: "2026-04-24 00:32:53" },
    onProgress,
  );
  const totalMs = performance.now() - totalStart;

  return {
    file: path.basename(filePath),
    rowCount: result.originalRowCount,
    totalMs,
    stages,
  };
}

function aggregate(breakdowns: FileBreakdown[]): {
  perStage: Record<ProgressStepKind, number>;
  totalMs: number;
} {
  const perStage: Record<string, number> = {};
  let totalMs = 0;
  for (const b of breakdowns) {
    totalMs += b.totalMs;
    for (const s of b.stages) {
      perStage[s.stage] = (perStage[s.stage] ?? 0) + s.ms;
    }
  }
  return { perStage: perStage as Record<ProgressStepKind, number>, totalMs };
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`;
}

async function main(): Promise<void> {
  const fixturePaths = process.argv.slice(2);
  if (fixturePaths.length === 0) {
    throw new Error(
      "Usage: vite-node web/scripts/profile_pipeline_stages.mts <csv> [csv...]",
    );
  }

  const supportFiles: BrowserSupportFiles = {
    filterFile: await loadDefaultSupport(
      "Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv",
    ),
    appsForcingScreenOpenFile: await loadDefaultSupport(
      "Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv",
    ),
    appCodebookFile: await loadDefaultSupport("unified_app_codebook.csv"),
  };

  const breakdowns: FileBreakdown[] = [];
  for (const fixturePath of fixturePaths) {
    const breakdown = await profileFile(fixturePath, supportFiles);
    breakdowns.push(breakdown);
    process.stderr.write(
      `[${breakdown.file}] ${breakdown.rowCount} rows, total ${fmtMs(breakdown.totalMs)}\n`,
    );
    for (const s of breakdown.stages) {
      process.stderr.write(`    ${s.stage.padEnd(10)} ${fmtMs(s.ms)}\n`);
    }
  }

  const { perStage, totalMs } = aggregate(breakdowns);
  const stageBreakdown = Object.entries(perStage)
    .sort(([, a], [, b]) => b - a)
    .map(([stage, ms]) => ({
      stage,
      ms,
      pct: (ms / totalMs) * 100,
    }));

  process.stderr.write("\n=== AGGREGATE ACROSS ALL FIXTURES ===\n");
  process.stderr.write(`total wall: ${fmtMs(totalMs)}\n`);
  for (const row of stageBreakdown) {
    process.stderr.write(
      `  ${row.stage.padEnd(10)} ${fmtMs(row.ms).padStart(10)}  ${row.pct.toFixed(1)}%\n`,
    );
  }

  process.stdout.write(
    JSON.stringify(
      {
        totalMs,
        perStage,
        breakdowns,
      },
      null,
      2,
    ),
  );
}

await main();
