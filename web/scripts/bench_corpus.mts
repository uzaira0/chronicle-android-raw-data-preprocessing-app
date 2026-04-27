// Comprehensive corpus bench:
//   - All 90 .tmp/test-csvs/*.csv fixtures
//   - All 8 ../.tmp_pathological_rich_raw/*.csv pathological fixtures
//   - Sequential: TS path vs Rust process_full_pipeline_e2e
//   - Parallel: same Rust path distributed across N worker_threads
// Reports: per-fixture timing, aggregate, parity verification (SHA-256 match).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { glob } from "node:fs/promises";
import { availableParallelism } from "node:os";
import Papa from "papaparse";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const KERNEL_PKG = path.resolve(SCRIPT_DIR, "../src/wasm/chronicle_chrono_kernel_wasm/pkg");
const MATCHER_PKG = path.resolve(SCRIPT_DIR, "../src/wasm/chronicle_app_usage_wasm/pkg");
const DEFAULTS_DIR = path.resolve(SCRIPT_DIR, "../src/assets/defaults");

const SAME_STOP_TYPES = ["Activity Paused", "Activity Resumed"];
const OTHER_STOP_TYPES = [
  "Activity Resumed",
  "Filtered App Resumed",
  "Filtered App Usage",
  "Device Shutdown",
];
const LONG_DURATION_THRESHOLD_NS = BigInt(12 * 3600 * 1_000_000_000);

const NORMALIZE_INTERACTION_TYPE: Record<string, string> = {
  "Instance of Usage for an App": "App Usage",
  "Screen Usage": "Screen Usage",
  "Activity Resumed for a Filtered App": "Filtered App Resumed",
  "Activity Paused for a Filtered App": "Filtered App Paused",
  "Instance of Usage for a Filtered App": "Filtered App Usage",
  "Missing End of Usage after an App Starts Being Used": "End of Usage Missing",
  "Unknown importance: 1": "Activity Resumed",
  "Move to Foreground": "Activity Resumed",
  "Unknown importance: 2": "Activity Paused",
  "Move to Background": "Activity Paused",
  "Unknown importance: 3": "End of Day",
  "Unknown importance: 4": "Continue Previous Day",
  "Unknown importance: 5": "Configuration Change",
  "Unknown importance: 6": "System Interaction",
  "Unknown importance: 7": "User Interaction",
  "Unknown importance: 8": "Shortcut Invocation",
  "Unknown importance: 9": "Chooser Action",
  "Unknown importance: 10": "Notification Seen",
  "Unknown importance: 11": "Standby Bucket Changed",
  "Unknown importance: 12": "Notification Interruption",
  "Unknown importance: 13": "Slice Pinned Priv",
  "Unknown importance: 14": "Slice Pinned App",
  "Unknown importance: 15": "Screen Interactive",
  "Unknown importance: 16": "Screen Non-Interactive",
  "Unknown importance: 17": "Keyguard Shown",
  "Unknown importance: 18": "Keyguard Hidden",
  "Unknown importance: 19": "Foreground Service Start",
  "Unknown importance: 20": "Foreground Service Stop",
  "Unknown importance: 21": "Continuing Foreground Service",
  "Unknown importance: 22": "Rollover Foreground Service",
  "Unknown importance: 23": "Activity Stopped",
  "Unknown importance: 24": "Activity Destroyed",
  "Unknown importance: 25": "Flush to Disk",
  "Unknown importance: 26": "Device Shutdown",
  "Unknown importance: 27": "Device Startup",
  "Unknown importance: 28": "User Unlocked",
  "Unknown importance: 29": "User Stopped",
  "Unknown importance: 30": "Locus ID Set",
  "Unknown importance: 31": "App Component Used",
};
const normalizeInter = (s: string) => NORMALIZE_INTERACTION_TYPE[s] ?? s;

const ACTIVITY_RESUMED = "Activity Resumed";
const ACTIVITY_PAUSED = "Activity Paused";
const ACTIVITY_STOPPED = "Activity Stopped";
const FILTERED_RESUMED = "Filtered App Resumed";
const FILTERED_PAUSED = "Filtered App Paused";
const APP_USAGE = "App Usage";
const FILTERED_APP_USAGE = "Filtered App Usage";
const END_OF_USAGE_MISSING = "End of Usage Missing";

async function loadKernel() {
  const module = await import(path.join(KERNEL_PKG, "chronicle_chrono_kernel_wasm.js"));
  const wasmBytes = await readFile(path.join(KERNEL_PKG, "chronicle_chrono_kernel_wasm_bg.wasm"));
  await module.default({ module_or_path: wasmBytes });
  return (bytes: Uint8Array, tz: string, filteredPackages: string[]) =>
    module.process_full_pipeline_e2e(
      bytes, tz, filteredPackages,
      SAME_STOP_TYPES, OTHER_STOP_TYPES,
      LONG_DURATION_THRESHOLD_NS, false, true, true,
    ) as Uint8Array;
}

async function loadMatcher() {
  const module = await import(path.join(MATCHER_PKG, "chronicle_app_usage_wasm.js"));
  const wasmBytes = await readFile(path.join(MATCHER_PKG, "chronicle_app_usage_wasm_bg.wasm"));
  await module.default({ module_or_path: wasmBytes });
  return (
    appCodes: Int32Array,
    timestampNs: BigInt64Array,
    resumed: Uint8Array,
    sameStop: Uint8Array,
    otherStop: Uint8Array,
    stopped: Uint8Array,
  ) =>
    module.matchAppUsageUpdateIndices(
      appCodes, timestampNs, resumed, sameStop, otherStop, stopped,
      false, true, true, LONG_DURATION_THRESHOLD_NS,
    ) as { startIndices: number[]; stopStartIndices: number[]; stopEventIndices: number[]; missingIndices: number[] };
}

function parseTsTimestampNs(value: string): bigint | null {
  if (!value) return null;
  let n = value.replace("T", " ");
  if (n.endsWith("Z")) n = n.slice(0, -1) + "+00:00";
  if (!/[+-]\d{2}:?\d{2}$/.test(n)) {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(n);
    if (!m) return null;
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (!Number.isFinite(ms)) return null;
    const fr = m[7] ? BigInt((m[7] + "000000000").slice(0, 9)) : 0n;
    return BigInt(ms) * 1_000_000n + fr;
  }
  const ms = Date.parse(n);
  if (!Number.isFinite(ms)) return null;
  const fm = /\.(\d+)([+-]\d{2}:?\d{2})$/.exec(n);
  const fr = fm ? BigInt((fm[1] + "000000000").slice(0, 9)) % 1_000_000n : 0n;
  return BigInt(ms) * 1_000_000n + fr;
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replaceAll('"', '""')}"`;
  return v;
}

async function tsFullPipeline(
  bytes: Uint8Array,
  tz: string,
  filteredPackages: Set<string>,
  runMatcher: Awaited<ReturnType<typeof loadMatcher>>,
): Promise<Uint8Array> {
  const csvText = Buffer.from(bytes).toString("utf8");
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true });
  const ts: bigint[] = [];
  const pkg: string[] = [];
  const inter: string[] = [];
  for (const row of parsed.data) {
    const ev = (row.event_timestamp ?? "").trim();
    if (!ev) continue;
    const ns = parseTsTimestampNs(ev);
    if (ns === null) continue;
    ts.push(ns); pkg.push(row.app_package_name ?? ""); inter.push(normalizeInter(row.interaction_type ?? ""));
  }
  const idx: number[] = ts.map((_, i) => i);
  idx.sort((a, b) => (ts[a]! < ts[b]! ? -1 : ts[a]! > ts[b]! ? 1 : a - b));
  const sortedTs = idx.map((i) => ts[i]!);
  const sortedPkg = idx.map((i) => pkg[i]!);
  const sortedInter = idx.map((i) => inter[i]!);

  const seen = new Set<string>();
  const keptTs: bigint[] = [], keptPkg: string[] = [], keptInter: string[] = [];
  for (let i = 0; i < sortedTs.length; i += 1) {
    const k = `${sortedTs[i]}|${sortedInter[i]}|${sortedPkg[i]}`;
    if (!seen.has(k)) {
      seen.add(k);
      keptTs.push(sortedTs[i]!); keptPkg.push(sortedPkg[i]!); keptInter.push(sortedInter[i]!);
    }
  }
  for (let i = 0; i < keptInter.length; i += 1) {
    if (filteredPackages.has(keptPkg[i]!)) {
      if (keptInter[i] === ACTIVITY_RESUMED) keptInter[i] = FILTERED_RESUMED;
      else if (keptInter[i] === ACTIVITY_PAUSED) keptInter[i] = FILTERED_PAUSED;
    }
  }
  const n = keptTs.length;
  const appLookup = new Map<string, number>();
  const appCodes = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    let c = appLookup.get(keptPkg[i]!);
    if (c === undefined) { c = appLookup.size; appLookup.set(keptPkg[i]!, c); }
    appCodes[i] = c;
  }
  const timestampNs = BigInt64Array.from(keptTs);
  const sameStopSet = new Set(SAME_STOP_TYPES);
  const otherStopSet = new Set(OTHER_STOP_TYPES);
  const resumedArr = new Uint8Array(n);
  const sameStopArr = new Uint8Array(n);
  const otherStopArr = new Uint8Array(n);
  const stoppedArr = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const it = keptInter[i]!;
    if (it === ACTIVITY_RESUMED) resumedArr[i] = 1;
    if (sameStopSet.has(it)) sameStopArr[i] = 1;
    if (otherStopSet.has(it)) otherStopArr[i] = 1;
    if (it === ACTIVITY_STOPPED) stoppedArr[i] = 1;
  }
  const matchOut = runMatcher(appCodes, timestampNs, resumedArr, sameStopArr, otherStopArr, stoppedArr);
  const startNs = new BigInt64Array(n).fill(-1n);
  const stopNs = new BigInt64Array(n).fill(-1n);
  const missing = new Uint8Array(n);
  for (const si of matchOut.startIndices) startNs[si] = timestampNs[si]!;
  for (let k = 0; k < matchOut.stopStartIndices.length; k += 1) {
    stopNs[matchOut.stopStartIndices[k]!] = timestampNs[matchOut.stopEventIndices[k]!]!;
  }
  for (const mi of matchOut.missingIndices) missing[mi] = 1;

  const eo = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZoneName: "longOffset",
  });
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
  const wdMap: Record<string, number> = { Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7 };
  const out: string[] = ["event_timestamp,app_package_name,interaction_type,duration_seconds,date,hour,day\n"];

  for (let i = 0; i < n; i += 1) {
    const interaction = keptInter[i]!;
    if (interaction === ACTIVITY_PAUSED || interaction === FILTERED_PAUSED) continue;
    let effective = interaction;
    let dur: number | null = null;
    const isFiltered = filteredPackages.has(keptPkg[i]!);
    if (interaction === ACTIVITY_RESUMED || interaction === FILTERED_RESUMED) {
      if (missing[i]) effective = END_OF_USAGE_MISSING;
      else if (startNs[i]! >= 0n && stopNs[i]! >= 0n) {
        if (isFiltered) effective = FILTERED_APP_USAGE;
        else { effective = APP_USAGE; dur = Number(stopNs[i]! - startNs[i]!) / 1_000_000_000; }
      } else continue;
    }
    const date = new Date(Number(timestampNs[i]! / 1_000_000n));
    const fp = eo.formatToParts(date);
    const v: Record<string, string> = {};
    for (const p of fp) if (p.type !== "literal") v[p.type] = p.value;
    let off = (v.timeZoneName ?? "+00:00").replace("GMT", "");
    if (off === "") off = "+00:00";
    if (/^[+-]\d{1,2}$/.test(off)) off = `${off.padStart(3, "0")}:00`;
    if (/^[+-]\d{2}\d{2}$/.test(off)) off = `${off.slice(0, 3)}:${off.slice(3)}`;
    const event = `${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}${off}`;
    const dateStr = `${v.year}-${v.month}-${v.day}`;
    const hour = +v.hour;
    const day = wdMap[wd.format(date)] ?? 1;
    const durStr = dur == null ? "" : String(dur);
    out.push(`${csvEscape(event)},${csvEscape(keptPkg[i]!)},${csvEscape(effective)},${durStr},${dateStr},${hour},${day}\n`);
  }
  return Buffer.from(out.join(""), "utf-8");
}

async function loadFilterPackages(): Promise<Set<string>> {
  const text = await readFile(
    path.join(DEFAULTS_DIR, "Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv"),
    "utf-8",
  );
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const set = new Set<string>();
  for (const row of parsed.data) {
    const v = row.app_package_name?.trim();
    if (v) set.add(v);
  }
  return set;
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 12);

type FixtureResult = {
  file: string;
  bytes: number;
  outBytes: number;
  tsMs: number;
  rustMs: number;
  byteDiff: number;
  speedup: number;
  shaTs: string;
  shaRust: string;
};

async function gatherFixtures(): Promise<string[]> {
  const all: string[] = [];
  for await (const f of glob(path.join(SCRIPT_DIR, "../.tmp/test-csvs/*.csv"))) all.push(f);
  for await (const f of glob(path.join(REPO_ROOT, ".tmp_pathological_rich_raw/*.csv"))) all.push(f);
  return all.sort();
}

async function runSequential(
  fixtures: string[],
  filterArr: string[],
  filterSet: Set<string>,
): Promise<FixtureResult[]> {
  const k = await loadKernel();
  const matcher = await loadMatcher();
  const results: FixtureResult[] = [];
  let processedBytes = 0;
  const totalBytes = (
    await Promise.all(fixtures.map((f) => readFile(f).then((b) => b.length)))
  ).reduce((a, b) => a + b, 0);

  for (const f of fixtures) {
    const bytes = await readFile(f);
    const parsed = Papa.parse<Record<string, string>>(
      Buffer.from(bytes).toString("utf8"),
      { header: true, skipEmptyLines: true, preview: 1 },
    );
    const tz = parsed.data[0]?.timezone ?? "UTC";
    // warm not needed per-fixture once kernel is loaded

    const t1 = performance.now();
    const tsBytes = await tsFullPipeline(bytes, tz, filterSet, matcher);
    const tsMs = performance.now() - t1;

    const t2 = performance.now();
    const rustBytes = k(bytes, tz, filterArr);
    const rustMs = performance.now() - t2;

    let byteDiff = 0;
    if (tsBytes.length !== rustBytes.length) byteDiff = Math.abs(tsBytes.length - rustBytes.length);
    else {
      for (let i = 0; i < tsBytes.length; i += 1) if (tsBytes[i] !== rustBytes[i]) { byteDiff += 1; break; }
    }

    results.push({
      file: path.basename(f),
      bytes: bytes.length,
      outBytes: rustBytes.length,
      tsMs, rustMs, byteDiff,
      speedup: tsMs / rustMs,
      shaTs: sha(tsBytes),
      shaRust: sha(rustBytes),
    });
    processedBytes += bytes.length;
    process.stderr.write(
      `  [${(processedBytes / totalBytes * 100).toFixed(0)}%] ${path.basename(f).padEnd(48)} ${(bytes.length / 1024 / 1024).toFixed(1).padStart(5)}MB  ts=${fmtMs(tsMs).padStart(7)}  rust=${fmtMs(rustMs).padStart(7)}  x${(tsMs / rustMs).toFixed(2).padStart(5)}  diff=${byteDiff}\n`,
    );
  }

  return results;
}

async function runParallelRust(
  fixtures: string[],
  filterArr: string[],
  workerCount: number,
): Promise<{ results: FixtureResult[]; wallMs: number }> {
  const queue = [...fixtures];
  const results: FixtureResult[] = [];
  const workerScript = path.join(SCRIPT_DIR, "bench_corpus_worker.mjs");

  const t0 = performance.now();
  await new Promise<void>((resolve, reject) => {
    let active = 0;
    let done = 0;
    const total = fixtures.length;
    const workers: Worker[] = [];
    let aborted = false;

    const dispatch = (worker: Worker) => {
      if (queue.length === 0) {
        if (active === 0) {
          for (const w of workers) w.postMessage({ type: "shutdown" });
          resolve();
        }
        return;
      }
      const f = queue.shift()!;
      active += 1;
      worker.postMessage({ type: "process", file: f, filterArr });
    };

    for (let i = 0; i < workerCount; i += 1) {
      const w = new Worker(workerScript, {
        workerData: {
          kernelPkg: KERNEL_PKG,
        },
      });
      workers.push(w);
      w.on("message", (msg: any) => {
        if (aborted) return;
        if (msg.type === "ready") {
          dispatch(w);
        } else if (msg.type === "result") {
          results.push(msg.result);
          active -= 1;
          done += 1;
          process.stderr.write(
            `  [${((done / total) * 100).toFixed(0).padStart(3)}%] worker=${i} ${msg.result.file.padEnd(40)} rust=${fmtMs(msg.result.rustMs).padStart(7)}\n`,
          );
          dispatch(w);
        } else if (msg.type === "error") {
          aborted = true;
          for (const w of workers) w.terminate();
          reject(new Error(`worker ${i}: ${msg.error}`));
        }
      });
      w.on("error", reject);
    }
  });
  const wallMs = performance.now() - t0;
  return { results, wallMs };
}

async function main() {
  const filterSet = await loadFilterPackages();
  const filterArr = [...filterSet];
  const fixtures = await gatherFixtures();

  const sizes = await Promise.all(fixtures.map((f) => readFile(f).then((b) => b.length)));
  const totalMb = sizes.reduce((a, b) => a + b, 0) / 1024 / 1024;
  process.stderr.write(`\n${fixtures.length} fixtures, ${totalMb.toFixed(0)}MB total CSV input\n\n`);

  process.stderr.write("=== SEQUENTIAL ===\n");
  const seq = await runSequential(fixtures, filterArr, filterSet);
  const sumTsSeq = seq.reduce((a, r) => a + r.tsMs, 0);
  const sumRustSeq = seq.reduce((a, r) => a + r.rustMs, 0);
  const totalDiff = seq.reduce((a, r) => a + r.byteDiff, 0);
  const allParity = seq.every((r) => r.byteDiff === 0);
  process.stderr.write(
    `\n  TS  total: ${fmtMs(sumTsSeq).padStart(8)}\n` +
    `  Rust total: ${fmtMs(sumRustSeq).padStart(8)}  x${(sumTsSeq / sumRustSeq).toFixed(2)} avg per-fixture: ${fmtMs(sumRustSeq / seq.length)}\n` +
    `  Parity: ${allParity ? "all byte-identical" : `FAILED (${totalDiff} diffs across ${seq.filter((r) => r.byteDiff > 0).length} fixtures)`}\n\n`,
  );

  process.stderr.write("=== PARALLEL (Rust only, multi-worker) ===\n");
  const cpus = availableParallelism();
  const workerCounts = [2, 4, Math.min(8, cpus), Math.min(cpus, 16)];
  const uniqueCounts = [...new Set(workerCounts)].sort((a, b) => a - b);
  const parallelResults: { workers: number; wallMs: number; rustSumMs: number }[] = [];
  for (const wc of uniqueCounts) {
    const { results: pr, wallMs } = await runParallelRust(fixtures, filterArr, wc);
    const rustSumMs = pr.reduce((a, r) => a + r.rustMs, 0);
    parallelResults.push({ workers: wc, wallMs, rustSumMs });
    process.stderr.write(
      `  workers=${wc.toString().padStart(2)} wall=${fmtMs(wallMs).padStart(8)} sum-cpu=${fmtMs(rustSumMs).padStart(8)} speedup-vs-seq=${(sumRustSeq / wallMs).toFixed(2)}x  efficiency=${((sumRustSeq / wallMs / wc) * 100).toFixed(0)}%\n`,
    );
  }

  process.stderr.write("\n=== SUMMARY ===\n");
  process.stderr.write(`Fixtures:           ${fixtures.length}\n`);
  process.stderr.write(`Total input CSV:    ${totalMb.toFixed(0)}MB\n`);
  process.stderr.write(`Output CSV (Rust):  ${(seq.reduce((a, r) => a + r.outBytes, 0) / 1024 / 1024).toFixed(0)}MB\n`);
  process.stderr.write(`Throughput (seq Rust): ${(totalMb / (sumRustSeq / 1000)).toFixed(1)} MB/s input\n`);
  if (parallelResults.length > 0) {
    const best = parallelResults.reduce((a, b) => (a.wallMs < b.wallMs ? a : b));
    process.stderr.write(`Throughput (best parallel ${best.workers}w): ${(totalMb / (best.wallMs / 1000)).toFixed(1)} MB/s input\n`);
  }
  process.stderr.write(`TS vs Rust speedup (seq): ${(sumTsSeq / sumRustSeq).toFixed(2)}x\n`);
  process.stderr.write(`Parity: ${allParity ? "ALL byte-identical across " + fixtures.length + " fixtures" : "FAILED"}\n`);

  process.stdout.write(JSON.stringify({ seq, parallel: parallelResults }, null, 2));
}

await main();
