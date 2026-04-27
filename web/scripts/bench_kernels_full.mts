// Comprehensive kernel benchmark — measures three Rust kernels against
// the equivalent TS pipeline operations on the same 5 fixtures:
//
//   1. parse_raw_csv  vs  PapaParse + JS bigint parse + filter
//   2. format_timestamps  vs  Intl.DateTimeFormat per row (already proven 7x)
//   3. dedupe_event_rows  vs  TS Set on string keys
//
// Reports wall-clock per kernel, parity (column equality vs TS), and
// the WASM-vs-TS speedup ratio.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const KERNEL_PKG = path.resolve(
  SCRIPT_DIR,
  "../src/wasm/chronicle_chrono_kernel_wasm/pkg",
);

type ParsedColumns = {
  event_timestamp_ns: bigint[];
  timezone: string[];
  app_package_name: string[];
  interaction_type: string[];
  application_label: string[];
  study_id: string[];
  participant_id: string[];
  username: string[];
  dropped_empty: number;
  dropped_invalid: number;
};

type DedupeResult = { keep_indices: number[] };

async function loadKernel() {
  const module = await import(
    path.join(KERNEL_PKG, "chronicle_chrono_kernel_wasm.js")
  );
  const wasmBytes = await readFile(
    path.join(KERNEL_PKG, "chronicle_chrono_kernel_wasm_bg.wasm"),
  );
  await module.default({ module_or_path: wasmBytes });
  return {
    formatTimestamps: (ts: BigInt64Array, tz: string) =>
      module.format_timestamps(ts, tz),
    parseRawCsv: (bytes: Uint8Array) => module.parse_raw_csv(bytes) as ParsedColumns,
    dedupeEventRows: (
      ts: BigInt64Array,
      interaction: string[],
      pkg: string[],
    ) => module.dedupe_event_rows(ts, interaction, pkg) as DedupeResult,
  };
}

// --- TS reference paths -------------------------------------------------

function parseChronicleTimestampNsTs(value: string): bigint | null {
  if (!value) return null;
  let normalized = value.replace("T", " ");
  if (normalized.endsWith("Z")) normalized = normalized.slice(0, -1) + "+00:00";
  // No-offset path: treat as UTC
  if (!/[+-]\d{2}:?\d{2}$/.test(normalized)) {
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(
      normalized,
    );
    if (!match) return null;
    const [, y, mo, d, h, mi, s, frac] = match;
    const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    if (!Number.isFinite(ms)) return null;
    const fracNs = frac ? BigInt((frac + "000000000").slice(0, 9)) : 0n;
    return BigInt(ms) * 1_000_000n + fracNs;
  }
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) return null;
  // Date.parse loses sub-millisecond precision; preserve it manually if present
  const fracMatch = /\.(\d+)([+-]\d{2}:?\d{2})$/.exec(normalized);
  const fracNs = fracMatch ? BigInt((fracMatch[1] + "000000000").slice(0, 9)) % 1_000_000n : 0n;
  return BigInt(ms) * 1_000_000n + fracNs;
}

function tsParse(csvText: string): ParsedColumns {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  const cols: ParsedColumns = {
    event_timestamp_ns: [],
    timezone: [],
    app_package_name: [],
    interaction_type: [],
    application_label: [],
    study_id: [],
    participant_id: [],
    username: [],
    dropped_empty: 0,
    dropped_invalid: 0,
  };
  for (const row of parsed.data) {
    const ev = (row.event_timestamp ?? "").trim();
    if (!ev) {
      cols.dropped_empty += 1;
      continue;
    }
    const ns = parseChronicleTimestampNsTs(ev);
    if (ns === null) {
      cols.dropped_invalid += 1;
      continue;
    }
    cols.event_timestamp_ns.push(ns);
    cols.timezone.push(row.timezone ?? "");
    cols.app_package_name.push(row.app_package_name ?? "");
    cols.interaction_type.push(row.interaction_type ?? "");
    cols.application_label.push(row.application_label ?? "");
    cols.study_id.push(row.study_id ?? "");
    cols.participant_id.push(row.participant_id ?? "");
    cols.username.push(row.username ?? "");
  }
  return cols;
}

function tsDedupe(
  ts: bigint[],
  interaction: string[],
  pkg: string[],
): { keep_indices: number[] } {
  const seen = new Set<string>();
  const keep: number[] = [];
  for (let i = 0; i < ts.length; i += 1) {
    const key = `${ts[i]}|${interaction[i]}|${pkg[i]}`;
    if (!seen.has(key)) {
      seen.add(key);
      keep.push(i);
    }
  }
  return { keep_indices: keep };
}

// --- driver -------------------------------------------------------------

const fmtMs = (ms: number) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`;

function diffCounts(
  a: ParsedColumns,
  b: ParsedColumns,
): { rowsTs: number; rowsRust: number; tsCol: number; offsets: { col: string; idx: number; ts: string; rust: string }[] } {
  const rowsTs = a.event_timestamp_ns.length;
  const rowsRust = b.event_timestamp_ns.length;
  const stringCols: (keyof ParsedColumns)[] = [
    "timezone",
    "app_package_name",
    "interaction_type",
    "application_label",
    "study_id",
    "participant_id",
    "username",
  ];
  let tsCol = 0;
  const offsets: { col: string; idx: number; ts: string; rust: string }[] = [];
  const limit = Math.min(rowsTs, rowsRust);
  for (let i = 0; i < limit; i += 1) {
    if (a.event_timestamp_ns[i] !== b.event_timestamp_ns[i]) {
      tsCol += 1;
      if (offsets.length < 3)
        offsets.push({
          col: "event_timestamp_ns",
          idx: i,
          ts: String(a.event_timestamp_ns[i]),
          rust: String(b.event_timestamp_ns[i]),
        });
    }
    for (const col of stringCols) {
      const av = (a[col] as string[])[i];
      const bv = (b[col] as string[])[i];
      if (av !== bv) {
        if (offsets.length < 3)
          offsets.push({ col: col as string, idx: i, ts: av ?? "", rust: bv ?? "" });
      }
    }
  }
  return { rowsTs, rowsRust, tsCol, offsets };
}

async function main() {
  const fixtures = process.argv.slice(2);
  if (fixtures.length === 0) throw new Error("Usage: vite-node ... <csv> [csv...]");
  const k = await loadKernel();

  type FileResult = {
    file: string;
    rowsKeptTs: number;
    rowsKeptRust: number;
    parseTsMs: number;
    parseRustMs: number;
    parseDiffOffsets: { col: string; idx: number; ts: string; rust: string }[];
    dedupTsMs: number;
    dedupRustMs: number;
    dedupTsKept: number;
    dedupRustKept: number;
    dedupDiff: number;
    fmtTsMs: number;
    fmtRustMs: number;
  };
  const out: FileResult[] = [];

  for (const f of fixtures) {
    const bytes = await readFile(f);
    const csvText = bytes.toString("utf8");

    // Warm.
    k.parseRawCsv(bytes.slice(0, Math.min(bytes.length, 8192)));

    // --- parse ---
    const t1a = performance.now();
    const tsCols = tsParse(csvText);
    const tsParseMs = performance.now() - t1a;

    const t1b = performance.now();
    const rustCols = k.parseRawCsv(bytes);
    const rustParseMs = performance.now() - t1b;

    const parseDiff = diffCounts(tsCols, rustCols);

    // --- format (re-confirm 7× on the same ts column we just parsed) ---
    const tz = (tsCols.timezone[0] ?? "UTC") || "UTC";
    const tsBigArr = BigInt64Array.from(tsCols.event_timestamp_ns);
    const t2a = performance.now();
    // Quick TS Intl reference (just the event_timestamp string, since we
    // already proved 7× upthread)
    const ev = new Intl.DateTimeFormat("en-US", {
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
    const _fmt = new Array<string>(tsBigArr.length);
    for (let i = 0; i < tsBigArr.length; i += 1) {
      const date = new Date(Number(tsBigArr[i]! / 1_000_000n));
      const parts = ev.formatToParts(date);
      const v: Record<string, string> = {};
      for (const p of parts) if (p.type !== "literal") v[p.type] = p.value;
      let off = (v.timeZoneName ?? "+00:00").replace("GMT", "");
      if (off === "") off = "+00:00";
      if (/^[+-]\d{1,2}$/.test(off)) off = `${off.padStart(3, "0")}:00`;
      if (/^[+-]\d{2}\d{2}$/.test(off)) off = `${off.slice(0, 3)}:${off.slice(3)}`;
      _fmt[i] = `${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}${off}`;
    }
    const fmtTsMs = performance.now() - t2a;

    const t2b = performance.now();
    k.formatTimestamps(tsBigArr, tz);
    const fmtRustMs = performance.now() - t2b;

    // --- dedupe ---
    const t3a = performance.now();
    const dedTs = tsDedupe(
      tsCols.event_timestamp_ns,
      tsCols.interaction_type,
      tsCols.app_package_name,
    );
    const dedupTsMs = performance.now() - t3a;

    const t3b = performance.now();
    const dedRust = k.dedupeEventRows(
      tsBigArr,
      tsCols.interaction_type,
      tsCols.app_package_name,
    );
    const dedupRustMs = performance.now() - t3b;

    let dedupDiff = 0;
    if (dedTs.keep_indices.length !== dedRust.keep_indices.length) {
      dedupDiff = Math.abs(dedTs.keep_indices.length - dedRust.keep_indices.length);
    } else {
      for (let i = 0; i < dedTs.keep_indices.length; i += 1) {
        if (dedTs.keep_indices[i] !== dedRust.keep_indices[i]) dedupDiff += 1;
      }
    }

    out.push({
      file: path.basename(f),
      rowsKeptTs: parseDiff.rowsTs,
      rowsKeptRust: parseDiff.rowsRust,
      parseTsMs: tsParseMs,
      parseRustMs: rustParseMs,
      parseDiffOffsets: parseDiff.offsets,
      dedupTsMs,
      dedupRustMs,
      dedupTsKept: dedTs.keep_indices.length,
      dedupRustKept: dedRust.keep_indices.length,
      dedupDiff,
      fmtTsMs,
      fmtRustMs,
    });

    process.stderr.write(
      `[${path.basename(f)}] tz=${tz} csv=${(bytes.length / (1024 * 1024)).toFixed(1)}MB\n` +
      `  parse  ts=${fmtMs(tsParseMs).padStart(8)}  rust=${fmtMs(rustParseMs).padStart(8)}  x${(tsParseMs / rustParseMs).toFixed(2)}  rows ts=${parseDiff.rowsTs} rust=${parseDiff.rowsRust} (diff ts_ns=${parseDiff.tsCol})\n` +
      `  fmt    ts=${fmtMs(fmtTsMs).padStart(8)}  rust=${fmtMs(fmtRustMs).padStart(8)}  x${(fmtTsMs / fmtRustMs).toFixed(2)}\n` +
      `  dedup  ts=${fmtMs(dedupTsMs).padStart(8)}  rust=${fmtMs(dedupRustMs).padStart(8)}  x${(dedupTsMs / dedupRustMs).toFixed(2)}  kept ts=${dedTs.keep_indices.length} rust=${dedRust.keep_indices.length} diff=${dedupDiff}\n`,
    );
    if (parseDiff.offsets.length > 0) {
      for (const o of parseDiff.offsets) {
        process.stderr.write(
          `    parse divergence: idx=${o.idx} col=${o.col} ts=${JSON.stringify(o.ts)} rust=${JSON.stringify(o.rust)}\n`,
        );
      }
    }
  }

  const sum = (k: keyof FileResult) =>
    out.reduce((acc, r) => acc + (typeof r[k] === "number" ? (r[k] as number) : 0), 0);
  process.stderr.write("\n=== AGGREGATE ===\n");
  process.stderr.write(`parse  ts=${fmtMs(sum("parseTsMs"))}  rust=${fmtMs(sum("parseRustMs"))}  x${(sum("parseTsMs") / sum("parseRustMs")).toFixed(2)}\n`);
  process.stderr.write(`fmt    ts=${fmtMs(sum("fmtTsMs"))}  rust=${fmtMs(sum("fmtRustMs"))}  x${(sum("fmtTsMs") / sum("fmtRustMs")).toFixed(2)}\n`);
  process.stderr.write(`dedup  ts=${fmtMs(sum("dedupTsMs"))}  rust=${fmtMs(sum("dedupRustMs"))}  x${(sum("dedupTsMs") / sum("dedupRustMs")).toFixed(2)}\n`);

  process.stdout.write(JSON.stringify(out, null, 2));
}

await main();
