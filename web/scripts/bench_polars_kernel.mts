// Benchmark + parity for the Polars-WASM batched timestamp kernel.
// Compares three paths producing the same five columns
// (event_timestamp_string, date, hour, day, quarter):
//   1. TS-Intl     — current pipeline (Intl.DateTimeFormat per row)
//   2. WASM-lean   — chrono-tz Rust kernel, one boundary call
//   3. WASM-polars — Polars Rust kernel, one boundary call
//
// Same input rows for all three; reports ms + diff count vs TS-Intl.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const KERNEL_PKG = path.resolve(
  SCRIPT_DIR,
  "../src/wasm/chronicle_polars_kernels_wasm/pkg",
);

type FormattedColumns = {
  event_timestamp_strings: string[];
  dates: string[];
  hours: number[];
  days: number[];
  quarters: number[];
};

let kernelInit: Promise<{
  formatLean: (ts: BigInt64Array, tz: string) => FormattedColumns;
  formatPolars: (ts: BigInt64Array, tz: string) => FormattedColumns;
}> | null = null;

async function loadKernel() {
  if (kernelInit) return kernelInit;
  kernelInit = (async () => {
    const module = await import(
      path.join(KERNEL_PKG, "chronicle_polars_kernels_wasm.js")
    );
    const wasmBytes = await readFile(
      path.join(KERNEL_PKG, "chronicle_polars_kernels_wasm_bg.wasm"),
    );
    await module.default({ module_or_path: wasmBytes });
    return {
      formatLean: (ts: BigInt64Array, tz: string) =>
        module.format_timestamps_lean(ts, tz) as FormattedColumns,
      formatPolars: (ts: BigInt64Array, tz: string) =>
        module.format_timestamps_polars(ts, tz) as FormattedColumns,
    };
  })();
  return kernelInit;
}

// --- TS-Intl reference path ---------------------------------------------

const eventOffsetCache = new Map<string, Intl.DateTimeFormat>();
const eventCache = new Map<string, Intl.DateTimeFormat>();
const weekdayCache = new Map<string, Intl.DateTimeFormat>();

function eventOffsetFormatter(tz: string): Intl.DateTimeFormat {
  let f = eventOffsetCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
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
    eventOffsetCache.set(tz, f);
  }
  return f;
}

function eventFormatter(tz: string): Intl.DateTimeFormat {
  let f = eventCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    eventCache.set(tz, f);
  }
  return f;
}

function weekdayFormatter(tz: string): Intl.DateTimeFormat {
  let f = weekdayCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
    weekdayCache.set(tz, f);
  }
  return f;
}

function tsIntlFormat(ts: BigInt64Array, tz: string): FormattedColumns {
  const event_timestamp_strings: string[] = new Array(ts.length);
  const dates: string[] = new Array(ts.length);
  const hours: number[] = new Array(ts.length);
  const days: number[] = new Array(ts.length);
  const quarters: number[] = new Array(ts.length);
  const weekdayMap: Record<string, number> = {
    Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7,
  };
  const eo = eventOffsetFormatter(tz);
  const ev = eventFormatter(tz);
  const wd = weekdayFormatter(tz);

  for (let i = 0; i < ts.length; i += 1) {
    const ms = Number(ts[i]! / 1_000_000n);
    const date = new Date(ms);

    // event_timestamp_string with offset
    const offsetParts = eo.formatToParts(date);
    const ov: Record<string, string> = {};
    for (const p of offsetParts) if (p.type !== "literal") ov[p.type] = p.value;
    let offset = ov.timeZoneName ?? "+00:00";
    offset = offset.replace("GMT", "");
    if (offset === "") offset = "+00:00";
    if (/^[+-]\d{1,2}$/.test(offset)) offset = `${offset.padStart(3, "0")}:00`;
    if (/^[+-]\d{2}\d{2}$/.test(offset))
      offset = `${offset.slice(0, 3)}:${offset.slice(3)}`;
    event_timestamp_strings[i] =
      `${ov.year}-${ov.month}-${ov.day} ${ov.hour}:${ov.minute}:${ov.second}${offset}`;

    // date / hour / quarter from the no-offset formatter
    const parts = ev.formatToParts(date);
    const v: Record<string, string> = {};
    for (const p of parts) if (p.type !== "literal") v[p.type] = p.value;
    dates[i] = `${v.year}-${v.month}-${v.day}`;
    hours[i] = Number(v.hour);
    quarters[i] = Math.floor((Number(v.month) - 1) / 3) + 1;

    // weekday
    days[i] = weekdayMap[wd.format(date)] ?? 1;
  }

  return { event_timestamp_strings, dates, hours, days, quarters };
}

// --- Test driver --------------------------------------------------------

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
    // Handle "...Z" and "+HH:MM" forms
    let normalized = value;
    if (normalized.endsWith("Z")) normalized = normalized.slice(0, -1) + "+00:00";
    if (!/[+-]\d{2}:?\d{2}$/.test(normalized)) normalized = normalized + "+00:00";
    const ms = Date.parse(normalized);
    if (Number.isFinite(ms)) {
      ts[i] = BigInt(ms) * 1_000_000n;
    } else {
      ts[i] = 0n;
    }
  }
  return { ts, tz };
}

function diff(a: FormattedColumns, b: FormattedColumns): {
  event: number;
  date: number;
  hour: number;
  day: number;
  quarter: number;
  firstSample: { idx: number; aValue: string; bValue: string; field: string } | null;
} {
  let event = 0, date = 0, hour = 0, day = 0, quarter = 0;
  let firstSample: { idx: number; aValue: string; bValue: string; field: string } | null = null;
  for (let i = 0; i < a.event_timestamp_strings.length; i += 1) {
    if (a.event_timestamp_strings[i] !== b.event_timestamp_strings[i]) {
      event += 1;
      if (!firstSample) firstSample = {
        idx: i,
        aValue: String(a.event_timestamp_strings[i]),
        bValue: String(b.event_timestamp_strings[i]),
        field: "event",
      };
    }
    if (a.dates[i] !== b.dates[i]) {
      date += 1;
      if (!firstSample) firstSample = {
        idx: i, aValue: String(a.dates[i]), bValue: String(b.dates[i]), field: "date",
      };
    }
    if (a.hours[i] !== b.hours[i]) {
      hour += 1;
      if (!firstSample) firstSample = {
        idx: i, aValue: String(a.hours[i]), bValue: String(b.hours[i]), field: "hour",
      };
    }
    if (a.days[i] !== b.days[i]) {
      day += 1;
      if (!firstSample) firstSample = {
        idx: i, aValue: String(a.days[i]), bValue: String(b.days[i]), field: "day",
      };
    }
    if (a.quarters[i] !== b.quarters[i]) {
      quarter += 1;
      if (!firstSample) firstSample = {
        idx: i, aValue: String(a.quarters[i]), bValue: String(b.quarters[i]), field: "quarter",
      };
    }
  }
  return { event, date, hour, day, quarter, firstSample };
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`;
}

async function main(): Promise<void> {
  const fixtures = process.argv.slice(2);
  if (fixtures.length === 0) {
    throw new Error("Usage: vite-node ... <csv> [csv...]");
  }
  const { formatLean, formatPolars } = await loadKernel();

  type Row = {
    file: string;
    rows: number;
    intlMs: number;
    leanMs: number;
    polarsMs: number;
    diffLean: ReturnType<typeof diff>;
    diffPolars: ReturnType<typeof diff>;
  };
  const results: Row[] = [];

  for (const f of fixtures) {
    const csv = await readFile(f, "utf-8");
    const { ts, tz } = loadTimestamps(csv);

    // Warm caches with one short call so first-call overhead doesn't dominate
    // the smaller fixtures.
    if (ts.length > 0) {
      const tiny = ts.slice(0, Math.min(10, ts.length));
      formatLean(tiny, tz);
      formatPolars(tiny, tz);
      tsIntlFormat(tiny, tz);
    }

    const t1 = performance.now();
    const intl = tsIntlFormat(ts, tz);
    const intlMs = performance.now() - t1;

    const t2 = performance.now();
    const lean = formatLean(ts, tz);
    const leanMs = performance.now() - t2;

    const t3 = performance.now();
    const polars = formatPolars(ts, tz);
    const polarsMs = performance.now() - t3;

    const diffLean = diff(intl, lean);
    const diffPolars = diff(intl, polars);

    results.push({
      file: path.basename(f),
      rows: ts.length,
      intlMs,
      leanMs,
      polarsMs,
      diffLean,
      diffPolars,
    });

    process.stderr.write(
      `[${path.basename(f)}] tz=${tz} rows=${ts.length}\n` +
      `  intl   ${fmtMs(intlMs).padStart(8)}\n` +
      `  lean   ${fmtMs(leanMs).padStart(8)}  vs intl x${(intlMs / leanMs).toFixed(2)}  diff=${diffLean.event + diffLean.date + diffLean.hour + diffLean.day + diffLean.quarter}\n` +
      `  polars ${fmtMs(polarsMs).padStart(8)}  vs intl x${(intlMs / polarsMs).toFixed(2)}  diff=${diffPolars.event + diffPolars.date + diffPolars.hour + diffPolars.day + diffPolars.quarter}\n`,
    );
    if (diffLean.firstSample) {
      process.stderr.write(
        `    lean first divergence: idx=${diffLean.firstSample.idx} field=${diffLean.firstSample.field} intl=${JSON.stringify(diffLean.firstSample.aValue)} lean=${JSON.stringify(diffLean.firstSample.bValue)}\n`,
      );
    }
    if (diffPolars.firstSample) {
      process.stderr.write(
        `    polars first divergence: idx=${diffPolars.firstSample.idx} field=${diffPolars.firstSample.field} intl=${JSON.stringify(diffPolars.firstSample.aValue)} polars=${JSON.stringify(diffPolars.firstSample.bValue)}\n`,
      );
    }
  }

  const total = (k: keyof Pick<Row, "intlMs" | "leanMs" | "polarsMs">) =>
    results.reduce((acc, r) => acc + r[k], 0);
  process.stderr.write("\n=== AGGREGATE ===\n");
  process.stderr.write(`intl   total ${fmtMs(total("intlMs"))}\n`);
  process.stderr.write(`lean   total ${fmtMs(total("leanMs"))} (x${(total("intlMs") / total("leanMs")).toFixed(2)})\n`);
  process.stderr.write(`polars total ${fmtMs(total("polarsMs"))} (x${(total("intlMs") / total("polarsMs")).toFixed(2)})\n`);

  process.stdout.write(JSON.stringify(results, null, 2));
}

await main();
