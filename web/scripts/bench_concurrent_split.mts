// End-to-end baseline for the concurrent-usage / background path on large files.
// Drives the production `processRawCsvContent` in vite-node (real WASM matcher +
// splitter, all downstream JS) with model_concurrent_usage + aggregates ON, at a
// range of session counts, and reports total wall time plus an isolated
// splitter-only timing so we can see how much of the total the splitter owns.
//
// Usage:
//   PATH="$HOME/.cargo/bin:$PATH" npx vite-node web/scripts/bench_concurrent_split.mts
//   (optional) sizes:  ... bench_concurrent_split.mts 5000 10000 20000 40000

import path from "node:path";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { processRawCsvContent } from "../src/lib/browserPipeline";
import type { MatcherInput, MatcherOutput, SplitterInput, SplitterOutput } from "../src/lib/types";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MATCHER_PKG = path.resolve(SCRIPT_DIR, "../src/wasm/chronicle_app_usage_wasm/pkg");

async function loadMatcherModule() {
  const module = await import(path.join(MATCHER_PKG, "chronicle_app_usage_wasm.js"));
  const wasmBytes = await readFile(path.join(MATCHER_PKG, "chronicle_app_usage_wasm_bg.wasm"));
  await module.default({ module_or_path: wasmBytes });
  return module as unknown as {
    matchAppUsageUpdateIndices: (...args: unknown[]) => MatcherOutput;
    splitOverlappingSessions: (s: BigInt64Array, e: BigInt64Array) => SplitterOutput;
  };
}

const HEADER =
  "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone";

const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);
const pad = (x: number) => String(x).padStart(2, "0");
const fmt = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const ev = (kind: string, app: string, ms: number) =>
  `S,P01,Child,${app},${kind},${app},${fmt(ms)},UTC`;

/** A single participant with `n` clean, sequential Resumed/Stopped app sessions. */
function makeCsv(n: number): string {
  const lines = [HEADER];
  for (let i = 0; i < n; i += 1) {
    const app = `com.app${i % 20}`;
    const resume = BASE + i * 120_000; // sessions every 2 min
    const stop = resume + 60_000; // 1-min sessions (non-overlapping)
    lines.push(ev("Activity Resumed", app, resume));
    lines.push(ev("Activity Stopped", app, stop));
  }
  return lines.join("\n");
}

/**
 * The background-apps shape: `numBg` long-running background apps that span the
 * whole timeline, overlapping `n` foreground churn sessions. With the apps
 * declared background the matcher keeps them open across foreground switches, so
 * each background session overlaps every foreground one — stressing the splitter's
 * open set (depth ~numBg+1) and computeCoUsage. Returns the raw CSV plus the
 * background-apps support CSV.
 */
function makeBgCsv(n: number, numBg: number): { csv: string; bgCsv: string } {
  const lines = [HEADER];
  const bgPackages = Array.from({ length: numBg }, (_, j) => `com.bg${j}`);
  // Background apps resumed at the very start (staggered to avoid dup timestamps).
  for (let j = 0; j < numBg; j += 1) lines.push(ev("Activity Resumed", bgPackages[j]!, BASE + j * 1000));
  // Foreground churn.
  for (let i = 0; i < n; i += 1) {
    const app = `com.fg${i % 20}`;
    const start = BASE + 60_000 + i * 120_000;
    lines.push(ev("Activity Resumed", app, start));
    lines.push(ev("Activity Stopped", app, start + 60_000));
  }
  // Background apps stopped at the very end (their own Activity Stopped).
  const end = BASE + 60_000 + n * 120_000 + 120_000;
  for (let j = 0; j < numBg; j += 1) lines.push(ev("Activity Stopped", bgPackages[j]!, end + j * 1000));
  const bgCsv = ["package_name,label_or_note", ...bgPackages.map((p) => `${p},bg`)].join("\n");
  return { csv: lines.join("\n"), bgCsv };
}

async function main() {
  const matcherModule = await loadMatcherModule();
  const runMatcher = async (input: MatcherInput): Promise<MatcherOutput> =>
    matcherModule.matchAppUsageUpdateIndices(
      input.appCodes,
      input.timestampNs,
      input.resumed,
      input.sameStop,
      input.otherStop,
      input.stopped,
      input.background,
      input.options.allowStopEventReuse,
      input.options.useActivityStoppedAsFallback,
      input.options.applyThresholdToFallback,
      input.options.longDurationThresholdNs,
    ) as MatcherOutput;
  const runSplitter = async (input: SplitterInput): Promise<SplitterOutput> =>
    matcherModule.splitOverlappingSessions(input.starts, input.stops);

  const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`);
  const argv = process.argv.slice(2);
  const mode = argv[0] === "seq" || argv[0] === "bg" ? argv.shift()! : "seq";
  const sizes = argv.map(Number).filter((x) => x > 0);
  const ns = sizes.length ? sizes : [5000, 10000, 20000, 40000];
  const toBuf = (s: string): ArrayBuffer => {
    const u8 = new TextEncoder().encode(s);
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
  };

  if (mode === "bg") {
    // Background-apps overlap path (the user's actual feature): a few long-running
    // background apps overlapping foreground churn, exercising the splitter's open
    // set and computeCoUsage. Report aggregates ON vs OFF — the delta is the
    // aggregation + co-usage cost — so a hidden O(N^2) in co-usage would show as a
    // super-linear ON column.
    const NUM_BG = 3;
    console.log(`bg overlap (${NUM_BG} background apps + N foreground)`);
    console.log(`${"sessions".padStart(9)} ${"aggOFF".padStart(10)} ${"aggON".padStart(10)} ${"aggDelta".padStart(10)}`);
    for (const n of ns) {
      const { csv, bgCsv } = makeBgCsv(n, NUM_BG);
      const support = { backgroundAppsFile: { name: "bg.csv", bytes: toBuf(bgCsv) } };
      const base = {
        useBackgroundAppsFile: true,
        modelConcurrentUsage: false,
        enablePlotting: false,
        processScreenUsage: false,
        useFilterFile: false,
        useAppCodebook: false,
      };
      const runOnce = async (enableAggregates: boolean): Promise<number> => {
        const t = performance.now();
        await processRawCsvContent(`Raw ${n}.csv`, csv, { ...base, enableAggregates }, support, runMatcher, undefined, undefined, runSplitter);
        return performance.now() - t;
      };
      const off = await runOnce(false);
      const on = await runOnce(true);
      console.log(`${String(n).padStart(9)} ${fmtMs(off).padStart(10)} ${fmtMs(on).padStart(10)} ${fmtMs(on - off).padStart(10)}`);
    }
    return;
  }

  console.log(`${"sessions".padStart(9)} ${"total".padStart(10)} ${"splitOnly".padStart(10)} ${"split%".padStart(7)}`);
  for (const n of ns) {
    const csv = makeCsv(n);

    // Isolated splitter timing on the same session count (sequential intervals).
    const starts = BigInt64Array.from({ length: n }, (_, i) => BigInt((i * 120_000) * 1_000_000));
    const stops = BigInt64Array.from({ length: n }, (_, i) => BigInt((i * 120_000 + 60_000) * 1_000_000));
    const sp0 = performance.now();
    matcherModule.splitOverlappingSessions(starts, stops);
    const splitMs = performance.now() - sp0;

    const t0 = performance.now();
    await processRawCsvContent(
      `Raw ${n}.csv`,
      csv,
      {
        modelConcurrentUsage: true,
        enableAggregates: true,
        enablePlotting: false,
        processScreenUsage: false,
        useFilterFile: false,
        useAppCodebook: false,
      },
      {},
      runMatcher,
      undefined,
      undefined,
      runSplitter,
    );
    const totalMs = performance.now() - t0;
    const pct = ((splitMs / totalMs) * 100).toFixed(0);
    console.log(`${String(n).padStart(9)} ${fmtMs(totalMs).padStart(10)} ${fmtMs(splitMs).padStart(10)} ${`${pct}%`.padStart(7)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
