// Full end-to-end pipeline bench: TS reference (parse + sort + dedup + filter
// + WASM matcher + Intl format + CSV write) vs Rust process_full_pipeline_e2e
// (all of the above in one Rust call, calling the matcher directly without
// crossing back through the WASM↔JS boundary).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import Papa from "papaparse";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const KERNEL_PKG = path.resolve(
  SCRIPT_DIR,
  "../src/wasm/chronicle_chrono_kernel_wasm/pkg",
);
const MATCHER_PKG = path.resolve(
  SCRIPT_DIR,
  "../src/wasm/chronicle_app_usage_wasm/pkg",
);
const DEFAULTS_DIR = path.resolve(SCRIPT_DIR, "../src/assets/defaults");

const ACTIVITY_RESUMED = "Activity Resumed";
const ACTIVITY_PAUSED = "Activity Paused";
const ACTIVITY_STOPPED = "Activity Stopped";
const FILTERED_RESUMED = "Filtered App Resumed";
const FILTERED_PAUSED = "Filtered App Paused";
const APP_USAGE = "App Usage";
const FILTERED_APP_USAGE = "Filtered App Usage";
const END_OF_USAGE_MISSING = "End of Usage Missing";

const SAME_STOP_TYPES = ["Activity Paused", "Activity Resumed"];
const OTHER_STOP_TYPES = [
  "Activity Resumed",
  "Filtered App Resumed",
  "Filtered App Usage",
  "Device Shutdown",
];

const LONG_DURATION_THRESHOLD_NS = BigInt(12 * 3600 * 1_000_000_000);

async function loadKernel() {
  const module = await import(
    path.join(KERNEL_PKG, "chronicle_chrono_kernel_wasm.js")
  );
  const wasmBytes = await readFile(
    path.join(KERNEL_PKG, "chronicle_chrono_kernel_wasm_bg.wasm"),
  );
  await module.default({ module_or_path: wasmBytes });
  return {
    processFullPipeline: (
      bytes: Uint8Array,
      tz: string,
      filteredPackages: string[],
    ) =>
      module.process_full_pipeline_e2e(
        bytes,
        tz,
        filteredPackages,
        SAME_STOP_TYPES,
        OTHER_STOP_TYPES,
        LONG_DURATION_THRESHOLD_NS,
        false,
        true,
        true,
      ) as Uint8Array,
  };
}

async function loadMatcher() {
  const module = await import(
    path.join(MATCHER_PKG, "chronicle_app_usage_wasm.js")
  );
  const wasmBytes = await readFile(
    path.join(MATCHER_PKG, "chronicle_app_usage_wasm_bg.wasm"),
  );
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
      appCodes,
      timestampNs,
      resumed,
      sameStop,
      otherStop,
      stopped,
      false,
      true,
      true,
      LONG_DURATION_THRESHOLD_NS,
    ) as {
      startIndices: number[];
      stopStartIndices: number[];
      stopEventIndices: number[];
      missingIndices: number[];
    };
}

// ---- TS reference path -------------------------------------------------

function parseChronicleTimestampNsTs(value: string): bigint | null {
  if (!value) return null;
  let normalized = value.replace("T", " ");
  if (normalized.endsWith("Z")) normalized = normalized.slice(0, -1) + "+00:00";
  if (!/[+-]\d{2}:?\d{2}$/.test(normalized)) {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(normalized);
    if (!m) return null;
    const [, y, mo, d, h, mi, s, frac] = m;
    const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    if (!Number.isFinite(ms)) return null;
    const fracNs = frac ? BigInt((frac + "000000000").slice(0, 9)) : 0n;
    return BigInt(ms) * 1_000_000n + fracNs;
  }
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) return null;
  const fm = /\.(\d+)([+-]\d{2}:?\d{2})$/.exec(normalized);
  const fracNs = fm ? BigInt((fm[1] + "000000000").slice(0, 9)) % 1_000_000n : 0n;
  return BigInt(ms) * 1_000_000n + fracNs;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

async function tsFullPipeline(
  bytes: Uint8Array,
  tz: string,
  filteredPackages: Set<string>,
  runMatcher: ReturnType<Awaited<ReturnType<typeof loadMatcher>>> extends infer X
    ? Awaited<ReturnType<typeof loadMatcher>>
    : never,
): Promise<Uint8Array> {
  const csvText = Buffer.from(bytes).toString("utf8");

  // 1. parse
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  const ts: bigint[] = [];
  const pkg: string[] = [];
  const inter: string[] = [];
  for (const row of parsed.data) {
    const ev = (row.event_timestamp ?? "").trim();
    if (!ev) continue;
    const ns = parseChronicleTimestampNsTs(ev);
    if (ns === null) continue;
    ts.push(ns);
    pkg.push(row.app_package_name ?? "");
    inter.push(row.interaction_type ?? "");
  }

  // 2. stable sort by ts (object-array sort matching the TS pipeline)
  const idx: number[] = ts.map((_, i) => i);
  idx.sort((a, b) => (ts[a]! < ts[b]! ? -1 : ts[a]! > ts[b]! ? 1 : a - b));
  const sortedTs = idx.map((i) => ts[i]!);
  const sortedPkg = idx.map((i) => pkg[i]!);
  const sortedInter = idx.map((i) => inter[i]!);

  // 3. dedup on (ts, interaction, package)
  const seen = new Set<string>();
  const keptTs: bigint[] = [];
  const keptPkg: string[] = [];
  const keptInter: string[] = [];
  for (let i = 0; i < sortedTs.length; i += 1) {
    const key = `${sortedTs[i]}|${sortedInter[i]}|${sortedPkg[i]}`;
    if (!seen.has(key)) {
      seen.add(key);
      keptTs.push(sortedTs[i]!);
      keptPkg.push(sortedPkg[i]!);
      keptInter.push(sortedInter[i]!);
    }
  }

  // 4. filter labeling
  for (let i = 0; i < keptInter.length; i += 1) {
    if (filteredPackages.has(keptPkg[i]!)) {
      if (keptInter[i] === ACTIVITY_RESUMED) keptInter[i] = FILTERED_RESUMED;
      else if (keptInter[i] === ACTIVITY_PAUSED) keptInter[i] = FILTERED_PAUSED;
    }
  }

  // 5. matcher inputs
  const n = keptTs.length;
  const appLookup = new Map<string, number>();
  const appCodes = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    let code = appLookup.get(keptPkg[i]!);
    if (code === undefined) {
      code = appLookup.size;
      appLookup.set(keptPkg[i]!, code);
    }
    appCodes[i] = code;
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
  const matchOut = runMatcher(
    appCodes,
    timestampNs,
    resumedArr,
    sameStopArr,
    otherStopArr,
    stoppedArr,
  );

  // 6. enrich + 7. format + 8. write
  const startNs = new BigInt64Array(n).fill(-1n);
  const stopNs = new BigInt64Array(n).fill(-1n);
  const isMissing = new Uint8Array(n);
  for (const si of matchOut.startIndices) startNs[si] = timestampNs[si]!;
  for (let k = 0; k < matchOut.stopStartIndices.length; k += 1) {
    const si = matchOut.stopStartIndices[k]!;
    const ev = matchOut.stopEventIndices[k]!;
    stopNs[si] = timestampNs[ev]!;
  }
  for (const mi of matchOut.missingIndices) isMissing[mi] = 1;

  const eo = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  });
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
  const weekdayMap: Record<string, number> = {
    Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7,
  };

  const out: string[] = [
    "event_timestamp,app_package_name,interaction_type,duration_seconds,date,hour,day\n",
  ];

  for (let i = 0; i < n; i += 1) {
    const interaction = keptInter[i]!;
    if (interaction === ACTIVITY_PAUSED || interaction === FILTERED_PAUSED) continue;

    let effective = interaction;
    let durationSeconds: number | null = null;
    const isFiltered = filteredPackages.has(keptPkg[i]!);

    if (interaction === ACTIVITY_RESUMED || interaction === FILTERED_RESUMED) {
      if (isMissing[i]) {
        effective = END_OF_USAGE_MISSING;
      } else if (startNs[i]! >= 0n && stopNs[i]! >= 0n) {
        if (isFiltered) {
          effective = FILTERED_APP_USAGE;
        } else {
          effective = APP_USAGE;
          durationSeconds = Number(stopNs[i]! - startNs[i]!) / 1_000_000_000;
        }
      } else {
        continue;
      }
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
    const hour = Number(v.hour);
    const day = weekdayMap[wd.format(date)] ?? 1;
    const dur = durationSeconds == null ? "" : String(durationSeconds);
    out.push(
      `${csvEscape(event)},${csvEscape(keptPkg[i]!)},${csvEscape(effective)},${dur},${dateStr},${hour},${day}\n`,
    );
  }

  return Buffer.from(out.join(""), "utf-8");
}

async function loadFilterPackages(): Promise<Set<string>> {
  const text = await readFile(
    path.join(DEFAULTS_DIR, "Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv"),
    "utf-8",
  );
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  const set = new Set<string>();
  for (const row of parsed.data) {
    const v = row.app_package_name?.trim();
    if (v) set.add(v);
  }
  return set;
}

const fmtMs = (ms: number) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`;
const sha = (b: Uint8Array) =>
  createHash("sha256").update(b).digest("hex").slice(0, 12);

async function main() {
  const fixtures = process.argv.slice(2);
  const k = await loadKernel();
  const matcher = await loadMatcher();
  const filterSet = await loadFilterPackages();
  const filterArr = [...filterSet];

  let sumTs = 0;
  let sumRust = 0;
  let totalRows = 0;
  let totalByteDiff = 0;

  for (const f of fixtures) {
    const bytes = await readFile(f);
    const csvHead = bytes.slice(0, Math.min(bytes.length, 4096));
    const tzMatch = /,([A-Za-z_]+\/[A-Za-z_]+)\s*\n/.exec(
      Buffer.from(csvHead).toString("utf8"),
    );
    let tz = tzMatch?.[1] ?? "UTC";
    // Pull tz from first data row reliably:
    const parsed = Papa.parse<Record<string, string>>(
      Buffer.from(bytes).toString("utf8"),
      { header: true, skipEmptyLines: true, preview: 1 },
    );
    if (parsed.data[0]?.timezone) tz = parsed.data[0].timezone;

    // Warm
    k.processFullPipeline(bytes.slice(0, 8192), tz, filterArr);
    await tsFullPipeline(bytes.slice(0, 8192), tz, filterSet, matcher);

    const t1 = performance.now();
    const tsBytes = await tsFullPipeline(bytes, tz, filterSet, matcher);
    const tsMs = performance.now() - t1;

    const t2 = performance.now();
    const rustBytes = k.processFullPipeline(bytes, tz, filterArr);
    const rustMs = performance.now() - t2;

    let byteDiff = 0;
    if (tsBytes.length !== rustBytes.length)
      byteDiff = Math.abs(tsBytes.length - rustBytes.length);
    else {
      for (let i = 0; i < tsBytes.length; i += 1) if (tsBytes[i] !== rustBytes[i]) byteDiff += 1;
    }

    sumTs += tsMs;
    sumRust += rustMs;
    totalRows += parsed.meta.cursor; // approximate
    totalByteDiff += byteDiff;

    process.stderr.write(
      `[${path.basename(f)}] tz=${tz} csv=${(bytes.length / 1024 / 1024).toFixed(1)}MB out=${(tsBytes.length / 1024 / 1024).toFixed(2)}MB\n` +
      `  ts   ${fmtMs(tsMs).padStart(8)}\n` +
      `  rust ${fmtMs(rustMs).padStart(8)}  x${(tsMs / rustMs).toFixed(2)}  byte diff=${byteDiff}\n` +
      `  sha  ts=${sha(tsBytes)} rust=${sha(rustBytes)}\n`,
    );
  }

  process.stderr.write("\n=== AGGREGATE ===\n");
  process.stderr.write(
    `ts   ${fmtMs(sumTs)}\nrust ${fmtMs(sumRust)}  x${(sumTs / sumRust).toFixed(2)}  total byte diff=${totalByteDiff}\n`,
  );
}

await main();
