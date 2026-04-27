// CSV-write kernel benchmark.
// TS reference: hand-rolled escape + concat (mirrors buildAppCsvText shape).
// Rust:         write_simple_csv → Uint8Array (single ArrayBuffer transfer).

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

async function loadKernel() {
  const module = await import(
    path.join(KERNEL_PKG, "chronicle_chrono_kernel_wasm.js")
  );
  const wasmBytes = await readFile(
    path.join(KERNEL_PKG, "chronicle_chrono_kernel_wasm_bg.wasm"),
  );
  await module.default({ module_or_path: wasmBytes });
  return {
    writeSimpleCsv: (
      events: string[],
      pkgs: string[],
      types: string[],
      hours: Uint8Array,
      days: Uint8Array,
    ) => module.write_simple_csv(events, pkgs, types, hours, days) as Uint8Array,
  };
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function writeCsvTs(
  events: string[],
  pkgs: string[],
  types: string[],
  hours: Uint8Array,
  days: Uint8Array,
): Uint8Array {
  const parts: string[] = [
    "event_timestamp,app_package_name,interaction_type,hour,day\n",
  ];
  for (let i = 0; i < events.length; i += 1) {
    parts.push(
      `${csvEscape(events[i]!)},${csvEscape(pkgs[i]!)},${csvEscape(types[i]!)},${hours[i]},${days[i]}\n`,
    );
  }
  return Buffer.from(parts.join(""), "utf-8");
}

function buildSampleColumns(csvText: string): {
  events: string[];
  pkgs: string[];
  types: string[];
  hours: Uint8Array;
  days: Uint8Array;
} {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  const rows = parsed.data.filter((r) => (r.event_timestamp ?? "").length > 0);
  const events = new Array<string>(rows.length);
  const pkgs = new Array<string>(rows.length);
  const types = new Array<string>(rows.length);
  const hours = new Uint8Array(rows.length);
  const days = new Uint8Array(rows.length);
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    events[i] = (r.event_timestamp ?? "").replace("T", " ");
    pkgs[i] = r.app_package_name ?? "";
    types[i] = r.interaction_type ?? "";
    // Pretend formatted hour/day; values irrelevant for write benchmark
    hours[i] = i % 24;
    days[i] = (i % 7) + 1;
  }
  return { events, pkgs, types, hours, days };
}

const fmtMs = (ms: number) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`;

async function main() {
  const fixtures = process.argv.slice(2);
  const k = await loadKernel();

  let totalRows = 0;
  let totalTsMs = 0;
  let totalRustMs = 0;
  let totalDiffBytes = 0;

  for (const f of fixtures) {
    const csvText = await readFile(f, "utf-8");
    const cols = buildSampleColumns(csvText);
    // warm
    k.writeSimpleCsv(cols.events.slice(0, 8), cols.pkgs.slice(0, 8), cols.types.slice(0, 8), cols.hours.slice(0, 8), cols.days.slice(0, 8));
    writeCsvTs(cols.events.slice(0, 8), cols.pkgs.slice(0, 8), cols.types.slice(0, 8), cols.hours.slice(0, 8), cols.days.slice(0, 8));

    const t1 = performance.now();
    const ts = writeCsvTs(cols.events, cols.pkgs, cols.types, cols.hours, cols.days);
    const tsMs = performance.now() - t1;

    const t2 = performance.now();
    const rust = k.writeSimpleCsv(cols.events, cols.pkgs, cols.types, cols.hours, cols.days);
    const rustMs = performance.now() - t2;

    let diff = 0;
    if (ts.length !== rust.length) diff = Math.abs(ts.length - rust.length);
    else {
      for (let i = 0; i < ts.length; i += 1) if (ts[i] !== rust[i]) {
        diff += 1;
        if (diff <= 3)
          process.stderr.write(`    byte diff at ${i}: ts=${ts[i]} rust=${rust[i]}\n`);
      }
    }
    totalRows += cols.events.length;
    totalTsMs += tsMs;
    totalRustMs += rustMs;
    totalDiffBytes += diff;

    process.stderr.write(
      `[${path.basename(f)}] rows=${cols.events.length} bytes=${(ts.length / (1024 * 1024)).toFixed(2)}MB\n` +
      `  ts   ${fmtMs(tsMs).padStart(8)}\n` +
      `  rust ${fmtMs(rustMs).padStart(8)}  x${(tsMs / rustMs).toFixed(2)}  byte diff=${diff}\n`,
    );
  }

  process.stderr.write("\n=== AGGREGATE ===\n");
  process.stderr.write(
    `rows=${totalRows}\n  ts   ${fmtMs(totalTsMs)}\n  rust ${fmtMs(totalRustMs)}  x${(totalTsMs / totalRustMs).toFixed(2)}  total byte diff=${totalDiffBytes}\n`,
  );
}

await main();
