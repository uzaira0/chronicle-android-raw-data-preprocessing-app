// Full-output corpus bench v2:
//   - All .tmp/test-csvs/*.csv fixtures + .tmp_pathological_rich_raw/*.csv
//   - TS reference: processRawCsvContent (production path, ~30-col CSV out)
//   - Rust:        process_full_pipeline_v2 (single WASM call)
//   - Compares byte-for-byte (SHA-256) and reports parity.
//
// Usage:
//   PATH="$HOME/.cargo/bin:$PATH" npx vite-node web/scripts/bench_corpus_v2.mts
// Output: web/.tmp/profile/corpus_full_v2.{log,json}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { glob } from "node:fs/promises";
import Papa from "papaparse";

import { processRawCsvContent, DEFAULT_BROWSER_OPTIONS } from "../src/lib/browserPipeline";
import type {
  BrowserProcessingOptions,
  BrowserSupportFiles,
  MatcherInput,
  MatcherOutput,
} from "../src/lib/types";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const KERNEL_PKG = path.resolve(SCRIPT_DIR, "../src/wasm/chronicle_chrono_kernel_wasm/pkg");
const MATCHER_PKG = path.resolve(SCRIPT_DIR, "../src/wasm/chronicle_app_usage_wasm/pkg");
const DEFAULTS_DIR = path.resolve(SCRIPT_DIR, "../src/assets/defaults");
const PROFILE_DIR = path.resolve(SCRIPT_DIR, "../.tmp/profile");

const FIXED_DOP = "2026-04-27 12:00:00 UTC";
const FIXED_STUDY_NAME = "bench-study";

async function loadKernel() {
  const module = await import(path.join(KERNEL_PKG, "chronicle_chrono_kernel_wasm.js"));
  const wasmBytes = await readFile(path.join(KERNEL_PKG, "chronicle_chrono_kernel_wasm_bg.wasm"));
  await module.default({ module_or_path: wasmBytes });
  return module;
}

async function loadMatcher() {
  const module = await import(path.join(MATCHER_PKG, "chronicle_app_usage_wasm.js"));
  const wasmBytes = await readFile(path.join(MATCHER_PKG, "chronicle_app_usage_wasm_bg.wasm"));
  await module.default({ module_or_path: wasmBytes });
  return async (input: MatcherInput): Promise<MatcherOutput> =>
    module.matchAppUsageUpdateIndices(
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
}

function findPrimaryTimezone(csvText: string): string {
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true });
  const counts = new Map<string, number>();
  for (const row of parsed.data) {
    const tz = (row.timezone ?? "").trim();
    if (!tz) continue;
    counts.set(tz, (counts.get(tz) ?? 0) + 1);
  }
  let best = "UTC";
  let bestN = -1;
  for (const [tz, n] of counts.entries()) {
    if (n > bestN) {
      best = tz;
      bestN = n;
    }
  }
  return best;
}

function sha(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex").slice(0, 12);
}
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`);

async function readSupportFiles(): Promise<BrowserSupportFiles> {
  const filterBytes = await readFile(
    path.join(DEFAULTS_DIR, "Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv"),
  );
  const codebookBytes = await readFile(path.join(DEFAULTS_DIR, "unified_app_codebook.csv"));
  const appsForcingBytes = await readFile(
    path.join(DEFAULTS_DIR, "Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv"),
  );
  return {
    filterFile: { name: "filter.csv", bytes: bufToAB(filterBytes) },
    appCodebookFile: { name: "codebook.csv", bytes: bufToAB(codebookBytes) },
    appsForcingScreenOpenFile: { name: "apps_forcing.csv", bytes: bufToAB(appsForcingBytes) },
  };
}

function bufToAB(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function gatherFixtures(): Promise<string[]> {
  const all: string[] = [];
  for await (const f of glob(path.join(SCRIPT_DIR, "../.tmp/test-csvs/*.csv"))) all.push(f);
  for await (const f of glob(path.join(REPO_ROOT, ".tmp_pathological_rich_raw/*.csv"))) all.push(f);
  return all.sort();
}

type FixtureResult = {
  file: string;
  bytes: number;
  outBytesTs: number;
  outBytesRust: number;
  tsMs: number;
  rustMs: number;
  byteDiff: number;
  firstDiff: number | null;
  shaTs: string;
  shaRust: string;
  parity: boolean;
};

async function runOne(
  file: string,
  kernel: any,
  runMatcher: (i: MatcherInput) => Promise<MatcherOutput>,
  supportFiles: BrowserSupportFiles,
  filterCsv: Uint8Array,
  appsForcingCsv: Uint8Array,
  codebookCsv: Uint8Array,
): Promise<FixtureResult> {
  const buf = await readFile(file);
  const csvText = buf.toString("utf8");
  const tz = findPrimaryTimezone(csvText);

  const opts: Partial<BrowserProcessingOptions> = {
    ...DEFAULT_BROWSER_OPTIONS,
    studyName: FIXED_STUDY_NAME,
    selectedTimezone: tz,
    timezoneHandling: "selected-convert",
    usageSessionMode: "app_usage",
    useFilterFile: true,
    useAppCodebook: true,
    useAppsForcingScreenOpenFile: false,
    correctDuplicateEventTimestamps: true,
  };

  // TS run.
  const t1 = performance.now();
  const tsResult = await processRawCsvContent(
    path.basename(file),
    csvText,
    opts,
    supportFiles,
    runMatcher,
    { datetimeOfPreprocessing: FIXED_DOP },
  );
  const tsAppOutput = tsResult.outputs.find((o) => o.kind === "app");
  const tsBytes = tsAppOutput
    ? new Uint8Array(await tsAppOutput.blob.arrayBuffer())
    : new Uint8Array();
  const tsMs = performance.now() - t1;

  // Rust run.
  const optionsJson = {
    study_name: FIXED_STUDY_NAME,
    timezone: tz,
    usage_session_mode: "app_usage",
    include_app_output: true,
    include_screen_output: false,
    use_filter_file: opts.useFilterFile ?? true,
    use_apps_forcing_screen_open: opts.useAppsForcingScreenOpenFile ?? false,
    use_app_codebook: opts.useAppCodebook ?? true,
    correct_duplicate_event_timestamps: opts.correctDuplicateEventTimestamps ?? true,
    allow_stop_event_reuse: DEFAULT_BROWSER_OPTIONS.allowStopEventReuse,
    use_activity_stopped_as_fallback: DEFAULT_BROWSER_OPTIONS.useActivityStoppedAsFallback,
    apply_threshold_to_fallback: DEFAULT_BROWSER_OPTIONS.applyThresholdToFallback,
    long_duration_threshold_ns: BigInt(
      Math.round(DEFAULT_BROWSER_OPTIONS.longDurationThresholdHours * 3_600_000_000_000),
    ),
    custom_app_engagement_duration: DEFAULT_BROWSER_OPTIONS.customAppEngagementDuration,
    long_data_time_gap_thresholds: DEFAULT_BROWSER_OPTIONS.longDataTimeGapThresholds,
    long_usage_duration_thresholds: DEFAULT_BROWSER_OPTIONS.longUsageDurationThresholds,
    same_app_stop_types: DEFAULT_BROWSER_OPTIONS.sameAppInteractionTypesToStopUsageAt,
    other_stop_types: DEFAULT_BROWSER_OPTIONS.otherInteractionTypesToStopUsageAt,
    interaction_types_to_remove: DEFAULT_BROWSER_OPTIONS.interactionTypesToRemove,
    screen_auto_lock_timeout_seconds: DEFAULT_BROWSER_OPTIONS.screenUsageAutoLockTimeoutSeconds,
    screen_auto_lock_tolerance_seconds: DEFAULT_BROWSER_OPTIONS.screenUsageAutoLockToleranceSeconds,
    screen_manual_lock_max_tail_seconds: DEFAULT_BROWSER_OPTIONS.screenUsageManualLockMaxTailGapSeconds,
    screen_keyguard_near_stop_seconds: DEFAULT_BROWSER_OPTIONS.screenUsageKeyguardNearStopSeconds,
    datetime_of_preprocessing: FIXED_DOP,
  };
  const optionsJsonStr = JSON.stringify(optionsJson, (_, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  // Re-stringify with bigint replaced as a number string. The Rust side needs numeric.
  const finalOptions = JSON.parse(optionsJsonStr);
  // Rust wants long_duration_threshold_ns as i64 number, not string.
  finalOptions.long_duration_threshold_ns = Number(finalOptions.long_duration_threshold_ns);

  const t2 = performance.now();
  const handle = kernel.process_full_pipeline_v2(
    new Uint8Array(buf),
    JSON.stringify(finalOptions),
    new Uint8Array(filterCsv),
    new Uint8Array(appsForcingCsv),
    new Uint8Array(codebookCsv),
  );
  const rustBytes = handle.take_app_bytes();
  handle.free();
  const rustMs = performance.now() - t2;

  let byteDiff = 0;
  let firstDiff: number | null = null;
  const minLen = Math.min(tsBytes.length, rustBytes.length);
  for (let i = 0; i < minLen; i += 1) {
    if (tsBytes[i] !== rustBytes[i]) {
      byteDiff += 1;
      if (firstDiff === null) firstDiff = i;
    }
  }
  if (tsBytes.length !== rustBytes.length) {
    byteDiff += Math.abs(tsBytes.length - rustBytes.length);
    if (firstDiff === null) firstDiff = minLen;
  }
  return {
    file: path.basename(file),
    bytes: buf.length,
    outBytesTs: tsBytes.length,
    outBytesRust: rustBytes.length,
    tsMs,
    rustMs,
    byteDiff,
    firstDiff,
    shaTs: sha(tsBytes),
    shaRust: sha(rustBytes),
    parity: byteDiff === 0,
  };
}

async function dumpDiff(
  file: string,
  kernel: any,
  runMatcher: (i: MatcherInput) => Promise<MatcherOutput>,
  supportFiles: BrowserSupportFiles,
  filterCsv: Uint8Array,
  appsForcingCsv: Uint8Array,
  codebookCsv: Uint8Array,
  out: string,
): Promise<void> {
  const buf = await readFile(file);
  const csvText = buf.toString("utf8");
  const tz = findPrimaryTimezone(csvText);
  const opts: Partial<BrowserProcessingOptions> = {
    ...DEFAULT_BROWSER_OPTIONS,
    studyName: FIXED_STUDY_NAME,
    selectedTimezone: tz,
    timezoneHandling: "selected-convert",
    usageSessionMode: "app_usage",
    useFilterFile: true,
    useAppCodebook: true,
    useAppsForcingScreenOpenFile: false,
    correctDuplicateEventTimestamps: true,
  };
  const tsResult = await processRawCsvContent(
    path.basename(file),
    csvText,
    opts,
    supportFiles,
    runMatcher,
    { datetimeOfPreprocessing: FIXED_DOP },
  );
  const tsAppOutput = tsResult.outputs.find((o) => o.kind === "app");
  const tsBytes = tsAppOutput ? new Uint8Array(await tsAppOutput.blob.arrayBuffer()) : new Uint8Array();
  const finalOptions = {
    study_name: FIXED_STUDY_NAME,
    timezone: tz,
    usage_session_mode: "app_usage",
    include_app_output: true,
    include_screen_output: false,
    use_filter_file: true,
    use_apps_forcing_screen_open: false,
    use_app_codebook: true,
    correct_duplicate_event_timestamps: true,
    allow_stop_event_reuse: DEFAULT_BROWSER_OPTIONS.allowStopEventReuse,
    use_activity_stopped_as_fallback: DEFAULT_BROWSER_OPTIONS.useActivityStoppedAsFallback,
    apply_threshold_to_fallback: DEFAULT_BROWSER_OPTIONS.applyThresholdToFallback,
    long_duration_threshold_ns:
      DEFAULT_BROWSER_OPTIONS.longDurationThresholdHours * 3_600_000_000_000,
    custom_app_engagement_duration: DEFAULT_BROWSER_OPTIONS.customAppEngagementDuration,
    long_data_time_gap_thresholds: DEFAULT_BROWSER_OPTIONS.longDataTimeGapThresholds,
    long_usage_duration_thresholds: DEFAULT_BROWSER_OPTIONS.longUsageDurationThresholds,
    same_app_stop_types: DEFAULT_BROWSER_OPTIONS.sameAppInteractionTypesToStopUsageAt,
    other_stop_types: DEFAULT_BROWSER_OPTIONS.otherInteractionTypesToStopUsageAt,
    interaction_types_to_remove: DEFAULT_BROWSER_OPTIONS.interactionTypesToRemove,
    screen_auto_lock_timeout_seconds: DEFAULT_BROWSER_OPTIONS.screenUsageAutoLockTimeoutSeconds,
    screen_auto_lock_tolerance_seconds: DEFAULT_BROWSER_OPTIONS.screenUsageAutoLockToleranceSeconds,
    screen_manual_lock_max_tail_seconds: DEFAULT_BROWSER_OPTIONS.screenUsageManualLockMaxTailGapSeconds,
    screen_keyguard_near_stop_seconds: DEFAULT_BROWSER_OPTIONS.screenUsageKeyguardNearStopSeconds,
    datetime_of_preprocessing: FIXED_DOP,
  };
  const handle = kernel.process_full_pipeline_v2(
    new Uint8Array(buf),
    JSON.stringify(finalOptions),
    new Uint8Array(filterCsv),
    new Uint8Array(appsForcingCsv),
    new Uint8Array(codebookCsv),
  );
  const rustBytes = handle.take_app_bytes();
  handle.free();
  await writeFile(`${out}.ts.csv`, tsBytes);
  await writeFile(`${out}.rust.csv`, rustBytes);
}

async function main() {
  await mkdir(PROFILE_DIR, { recursive: true });
  const fixtures = await gatherFixtures();
  const sizes = await Promise.all(fixtures.map((f) => readFile(f).then((b) => b.length)));
  const totalMb = sizes.reduce((a, b) => a + b, 0) / 1024 / 1024;
  process.stderr.write(`\n${fixtures.length} fixtures, ${totalMb.toFixed(0)}MB total\n\n`);

  const kernel = await loadKernel();
  const matcher = await loadMatcher();
  const supportFiles = await readSupportFiles();
  const filterCsv = await readFile(
    path.join(DEFAULTS_DIR, "Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv"),
  );
  const appsForcingCsv = await readFile(
    path.join(DEFAULTS_DIR, "Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv"),
  );
  const codebookCsv = await readFile(path.join(DEFAULTS_DIR, "unified_app_codebook.csv"));

  const dumpFirstDivergence = process.env.DUMP_DIVERGENCE === "1";
  const onlyFile = process.env.ONLY_FILE;
  const subset = onlyFile ? fixtures.filter((f) => path.basename(f).includes(onlyFile)) : fixtures;

  const results: FixtureResult[] = [];
  let processedBytes = 0;
  const totalBytes = sizes.reduce((a, b) => a + b, 0);

  for (const f of subset) {
    let r: FixtureResult;
    try {
      r = await runOne(
        f,
        kernel,
        matcher,
        supportFiles,
        filterCsv,
        appsForcingCsv,
        codebookCsv,
      );
    } catch (e) {
      process.stderr.write(`  [SKIP] ${path.basename(f)} -> ${(e as Error).message}\n`);
      continue;
    }
    results.push(r);
    processedBytes += r.bytes;
    process.stderr.write(
      `  [${((processedBytes / totalBytes) * 100).toFixed(0).padStart(3)}%] ${r.file.padEnd(48)} ${(r.bytes / 1024 / 1024).toFixed(1).padStart(5)}MB  ts=${fmtMs(r.tsMs).padStart(7)} rust=${fmtMs(r.rustMs).padStart(7)}  x${(r.tsMs / r.rustMs).toFixed(2).padStart(5)}  diff=${r.byteDiff}  ${r.parity ? "OK" : `(@${r.firstDiff})`}\n`,
    );
    if (dumpFirstDivergence && !r.parity) {
      const out = path.join(PROFILE_DIR, `divergence_${r.file}`);
      await dumpDiff(f, kernel, matcher, supportFiles, filterCsv, appsForcingCsv, codebookCsv, out);
      process.stderr.write(`  -> dumped TS+Rust outputs to ${out}.{ts,rust}.csv\n`);
    }
  }

  const sumTs = results.reduce((a, r) => a + r.tsMs, 0);
  const sumRust = results.reduce((a, r) => a + r.rustMs, 0);
  const totalDiff = results.reduce((a, r) => a + r.byteDiff, 0);
  const parityCount = results.filter((r) => r.parity).length;
  const totalTsBytes = results.reduce((a, r) => a + r.outBytesTs, 0);
  const totalRustBytes = results.reduce((a, r) => a + r.outBytesRust, 0);

  // Per-file matching bytes (approximate from minLen - byteDiff already counts both equal-len and length-diff)
  const matchingBytes = results.reduce((a, r) => {
    const minLen = Math.min(r.outBytesTs, r.outBytesRust);
    return a + (minLen - Math.min(minLen, r.byteDiff));
  }, 0);
  const pctMatching = totalTsBytes === 0 ? 100 : (matchingBytes / totalTsBytes) * 100;

  const sortedBySpeed = [...results].sort((a, b) => b.tsMs / b.rustMs - a.tsMs / a.rustMs);
  const top10Fast = sortedBySpeed.slice(0, 10);
  const top10Slow = sortedBySpeed.slice(-10).reverse();

  const summary = [
    `\n=== SUMMARY (${results.length} fixtures) ===`,
    `Input CSV total:        ${(totalBytes / 1024 / 1024).toFixed(1)} MB`,
    `Output CSV (TS):        ${(totalTsBytes / 1024 / 1024).toFixed(1)} MB`,
    `Output CSV (Rust):      ${(totalRustBytes / 1024 / 1024).toFixed(1)} MB`,
    `TS  total:              ${fmtMs(sumTs)}`,
    `Rust total:             ${fmtMs(sumRust)}   x${(sumTs / sumRust).toFixed(2)}`,
    `Throughput TS:          ${(totalBytes / 1024 / 1024 / (sumTs / 1000)).toFixed(1)} MB/s`,
    `Throughput Rust:        ${(totalBytes / 1024 / 1024 / (sumRust / 1000)).toFixed(1)} MB/s`,
    `Parity fixtures:        ${parityCount}/${results.length}  ` +
      (parityCount === results.length ? "(all byte-identical)" : `(${results.length - parityCount} divergent)`),
    `Total byte-diff:        ${totalDiff}`,
    `% bytes matching:       ${pctMatching.toFixed(3)}%`,
    "",
    "Top 10 fastest:",
    ...top10Fast.map((r) => `  ${r.file.padEnd(48)} x${(r.tsMs / r.rustMs).toFixed(2)}`),
    "",
    "Top 10 slowest:",
    ...top10Slow.map((r) => `  ${r.file.padEnd(48)} x${(r.tsMs / r.rustMs).toFixed(2)}`),
  ].join("\n");
  process.stderr.write(summary + "\n");

  await writeFile(path.join(PROFILE_DIR, "corpus_full_v2.log"), summary);
  await writeFile(
    path.join(PROFILE_DIR, "corpus_full_v2.json"),
    JSON.stringify({ results, sumTs, sumRust, totalDiff, parityCount, pctMatching }, null, 2),
  );
  process.stderr.write(`\nWrote corpus_full_v2.{log,json} to ${PROFILE_DIR}\n`);
}

await main();
