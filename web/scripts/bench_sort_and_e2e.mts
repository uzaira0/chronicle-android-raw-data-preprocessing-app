// Bench BigInt sort + end-to-end Rust pipeline against TS equivalents.

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

async function loadKernel() {
  const module = await import(
    path.join(KERNEL_PKG, "chronicle_chrono_kernel_wasm.js")
  );
  const wasmBytes = await readFile(
    path.join(KERNEL_PKG, "chronicle_chrono_kernel_wasm_bg.wasm"),
  );
  await module.default({ module_or_path: wasmBytes });
  return {
    sortByTimestampStable: (ts: BigInt64Array) =>
      module.sort_by_timestamp_stable(ts) as Uint32Array,
    processPipelineE2e: (bytes: Uint8Array, tz: string) =>
      module.process_pipeline_e2e(bytes, tz) as Uint8Array,
    parseRawCsv: (bytes: Uint8Array) => module.parse_raw_csv(bytes),
  };
}

// --- helpers shared with prior bench harnesses --------------------------

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

type ParsedCols = {
  event_timestamp_ns: bigint[];
  timezone: string[];
  app_package_name: string[];
  interaction_type: string[];
};

function tsParse(csvText: string): ParsedCols {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  const cols: ParsedCols = {
    event_timestamp_ns: [],
    timezone: [],
    app_package_name: [],
    interaction_type: [],
  };
  for (const row of parsed.data) {
    const ev = (row.event_timestamp ?? "").trim();
    if (!ev) continue;
    const ns = parseChronicleTimestampNsTs(ev);
    if (ns === null) continue;
    cols.event_timestamp_ns.push(ns);
    cols.timezone.push(row.timezone ?? "");
    cols.app_package_name.push(row.app_package_name ?? "");
    cols.interaction_type.push(row.interaction_type ?? "");
  }
  return cols;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

// Match the TS pipeline's actual sort: object array sort with bigint comparator.
function tsSort(ts: bigint[]): number[] {
  const arr: { ts: bigint; i: number }[] = ts.map((t, i) => ({ ts: t, i }));
  arr.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.i - b.i));
  return arr.map((x) => x.i);
}

// --- end-to-end TS pipeline (parse + sort + dedup + format + write) ----

function tsEndToEnd(csvText: string, tz: string): Uint8Array {
  const cols = tsParse(csvText);
  const sortIdx = tsSort(cols.event_timestamp_ns);

  const seen = new Set<string>();
  const kept: number[] = [];
  for (const idx of sortIdx) {
    const key = `${cols.event_timestamp_ns[idx]}|${cols.interaction_type[idx]}|${cols.app_package_name[idx]}`;
    if (!seen.has(key)) {
      seen.add(key);
      kept.push(idx);
    }
  }

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

  const parts: string[] = ["event_timestamp,app_package_name,interaction_type,date,hour,day\n"];
  for (const idx of kept) {
    const ns = cols.event_timestamp_ns[idx]!;
    const date = new Date(Number(ns / 1_000_000n));
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
    parts.push(
      `${csvEscape(event)},${csvEscape(cols.app_package_name[idx]!)},${csvEscape(cols.interaction_type[idx]!)},${dateStr},${hour},${day}\n`,
    );
  }
  return Buffer.from(parts.join(""), "utf-8");
}

// --- driver -------------------------------------------------------------

const fmtMs = (ms: number) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`;

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 12);

async function main() {
  const fixtures = process.argv.slice(2);
  const k = await loadKernel();

  let sumSortTs = 0;
  let sumSortRust = 0;
  let sumE2eTs = 0;
  let sumE2eRust = 0;
  let totalRows = 0;
  let totalSortDiff = 0;
  let totalE2eByteDiff = 0;

  for (const f of fixtures) {
    const bytes = await readFile(f);
    const csvText = bytes.toString("utf8");

    // Parse once for sort comparison.
    const cols = tsParse(csvText);
    const tsBigArr = BigInt64Array.from(cols.event_timestamp_ns);
    const tz = cols.timezone[0] ?? "UTC";

    // warm
    k.sortByTimestampStable(tsBigArr.slice(0, 16));
    k.processPipelineE2e(bytes.slice(0, Math.min(bytes.length, 8192)), tz);

    // --- sort ---
    const t1a = performance.now();
    const tsSortIdx = tsSort(cols.event_timestamp_ns);
    const tsSortMs = performance.now() - t1a;

    const t1b = performance.now();
    const rustSortIdx = k.sortByTimestampStable(tsBigArr);
    const rustSortMs = performance.now() - t1b;

    let sortDiff = 0;
    if (tsSortIdx.length !== rustSortIdx.length)
      sortDiff = Math.abs(tsSortIdx.length - rustSortIdx.length);
    else {
      // Stable sort parity: applying both permutations to the ts column
      // must yield the same sorted sequence (indices may differ for equal
      // timestamps if stability tiebreakers diverge — but we keep the same
      // tiebreaker on both sides).
      for (let i = 0; i < tsSortIdx.length; i += 1) {
        if (cols.event_timestamp_ns[tsSortIdx[i]!] !== cols.event_timestamp_ns[rustSortIdx[i]!]) {
          sortDiff += 1;
        }
      }
    }

    // --- end-to-end ---
    const t2a = performance.now();
    const tsBytes = tsEndToEnd(csvText, tz);
    const tsE2eMs = performance.now() - t2a;

    const t2b = performance.now();
    const rustBytes = k.processPipelineE2e(bytes, tz);
    const rustE2eMs = performance.now() - t2b;

    let byteDiff = 0;
    if (tsBytes.length !== rustBytes.length)
      byteDiff = Math.abs(tsBytes.length - rustBytes.length);
    else {
      for (let i = 0; i < tsBytes.length; i += 1) if (tsBytes[i] !== rustBytes[i]) byteDiff += 1;
    }

    sumSortTs += tsSortMs;
    sumSortRust += rustSortMs;
    sumE2eTs += tsE2eMs;
    sumE2eRust += rustE2eMs;
    totalRows += cols.event_timestamp_ns.length;
    totalSortDiff += sortDiff;
    totalE2eByteDiff += byteDiff;

    process.stderr.write(
      `[${path.basename(f)}] tz=${tz} rows=${cols.event_timestamp_ns.length}\n` +
      `  sort   ts=${fmtMs(tsSortMs).padStart(8)}  rust=${fmtMs(rustSortMs).padStart(8)}  x${(tsSortMs / rustSortMs).toFixed(2)}  diff=${sortDiff}\n` +
      `  e2e    ts=${fmtMs(tsE2eMs).padStart(8)}  rust=${fmtMs(rustE2eMs).padStart(8)}  x${(tsE2eMs / rustE2eMs).toFixed(2)}  byteDiff=${byteDiff}  ts_sha=${sha(tsBytes)} rust_sha=${sha(rustBytes)} bytes=${(tsBytes.length / 1024 / 1024).toFixed(2)}MB\n`,
    );
  }

  process.stderr.write("\n=== AGGREGATE ===\n");
  process.stderr.write(
    `sort   ts=${fmtMs(sumSortTs)}  rust=${fmtMs(sumSortRust)}  x${(sumSortTs / sumSortRust).toFixed(2)}  diff=${totalSortDiff}\n`,
  );
  process.stderr.write(
    `e2e    ts=${fmtMs(sumE2eTs)}  rust=${fmtMs(sumE2eRust)}  x${(sumE2eTs / sumE2eRust).toFixed(2)}  byteDiff=${totalE2eByteDiff}\n`,
  );
  process.stderr.write(`(rows total: ${totalRows})\n`);
}

await main();
