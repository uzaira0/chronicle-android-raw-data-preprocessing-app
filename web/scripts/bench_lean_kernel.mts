// Sanity-check the standalone lean-only crate matches the lean function
// from the polars-bundled crate on perf and parity.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LEAN_PKG = path.resolve(
  SCRIPT_DIR,
  "../src/wasm/chronicle_chrono_kernel_wasm/pkg",
);

async function loadLean() {
  const module = await import(
    path.join(LEAN_PKG, "chronicle_chrono_kernel_wasm.js")
  );
  const wasmBytes = await readFile(
    path.join(LEAN_PKG, "chronicle_chrono_kernel_wasm_bg.wasm"),
  );
  await module.default({ module_or_path: wasmBytes });
  return (ts: BigInt64Array, tz: string) =>
    module.format_timestamps(ts, tz) as {
      event_timestamp_strings: string[];
      dates: string[];
      hours: number[];
      days: number[];
      quarters: number[];
    };
}

function loadTimestamps(csvText: string): { ts: BigInt64Array; tz: string } {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  const rows = parsed.data.filter((r) => (r.event_timestamp ?? "").length > 0);
  const tz = rows[0]?.timezone ?? "UTC";
  const ts = new BigInt64Array(rows.length);
  for (let i = 0; i < rows.length; i += 1) {
    const value = rows[i]!.event_timestamp!;
    let n = value;
    if (n.endsWith("Z")) n = n.slice(0, -1) + "+00:00";
    if (!/[+-]\d{2}:?\d{2}$/.test(n)) n = n + "+00:00";
    const ms = Date.parse(n);
    ts[i] = Number.isFinite(ms) ? BigInt(ms) * 1_000_000n : 0n;
  }
  return { ts, tz };
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`);

async function main(): Promise<void> {
  const fixtures = process.argv.slice(2);
  const lean = await loadLean();
  let totalRows = 0;
  let totalMs = 0;
  for (const f of fixtures) {
    const csv = await readFile(f, "utf-8");
    const { ts, tz } = loadTimestamps(csv);
    if (ts.length > 0) lean(ts.slice(0, 10), tz); // warm
    const t1 = performance.now();
    const out = lean(ts, tz);
    const dt = performance.now() - t1;
    totalRows += ts.length;
    totalMs += dt;
    process.stderr.write(
      `[${path.basename(f)}] tz=${tz} rows=${ts.length} lean ${fmtMs(dt)}\n  sample[0]: ${out.event_timestamp_strings[0]}\n`,
    );
  }
  process.stderr.write(
    `\nTOTAL: ${totalRows} rows in ${fmtMs(totalMs)} (${(totalRows / (totalMs / 1000)).toFixed(0)} rows/sec)\n`,
  );
}

await main();
