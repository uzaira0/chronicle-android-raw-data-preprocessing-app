/**
 * Per-STEP pipeline profiler — the ExecutionLedger IS the profiler.
 *
 * Runs each CSV through the real pipeline (real WASM matcher) and aggregates
 * the per-unit/per-step ExecutionLedger records (Phase-1 lineage backbone):
 * wall-clock duration, rows in/out, dropped rows — no second instrumentation
 * system. Supersedes the coarse ProgressStepKind profiler
 * (profile_pipeline_stages.mts, deleted): the ledger's 15-unit/55-step grain
 * strictly refines the old 8 progress buckets.
 *
 * Usage:
 *   bunx vite-node scripts/profile_steps.mts <csv> [csv...]
 *
 * stderr: human-readable tables (per-file summary + aggregate step ranking).
 * stdout: JSON {files, units, steps} for BASELINE.md and diffing.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";

import { processRawCsvContent } from "../src/lib/browserPipeline";
import type { BrowserProcessingOptions, BrowserSupportFiles } from "../src/lib/types";

import { loadDefaultSupport, runMatcher } from "./_matcherHarness.mjs";

type Accumulated = {
  /** "unit" or "unit:step". */
  key: string;
  unit: string;
  stepId: string | null;
  totalMs: number;
  runs: number;
  rowsIn: number;
  rowsOut: number;
  droppedRows: number;
};

function accumulate(map: Map<string, Accumulated>, key: string, unit: string, stepId: string | null, ms: number, rowsIn: number | null, rowsOut: number | null, dropped: number | null): void {
  const entry = map.get(key) ?? {
    key,
    unit,
    stepId,
    totalMs: 0,
    runs: 0,
    rowsIn: 0,
    rowsOut: 0,
    droppedRows: 0,
  };
  entry.totalMs += ms;
  entry.runs += 1;
  entry.rowsIn += rowsIn ?? 0;
  entry.rowsOut += rowsOut ?? 0;
  entry.droppedRows += dropped ?? 0;
  map.set(key, entry);
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`;
}

async function main(): Promise<void> {
  const fixturePaths = process.argv.slice(2);
  if (fixturePaths.length === 0) {
    throw new Error("Usage: vite-node scripts/profile_steps.mts <csv> [csv...]");
  }

  const supportFiles: BrowserSupportFiles = {
    filterFile: await loadDefaultSupport("Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv"),
    appsForcingScreenOpenFile: await loadDefaultSupport(
      "Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv",
    ),
    appCodebookFile: await loadDefaultSupport("unified_app_codebook.csv"),
  };
  const options: Partial<BrowserProcessingOptions> = {
    processAppUsage: true,
    processScreenUsage: true,
    timezoneHandling: "primary-convert",
    useFilterFile: true,
    useAppsForcingScreenOpenFile: true,
    useAppCodebook: true,
    // DOM-dependent outputs are off: this profiler measures the DATA pipeline
    // (the ledger-bearing graph run), and vite-node has no document/canvas.
    enablePlotting: false,
    enableActivityHeatmap: false,
    enableInteractiveTimeline: false,
  };

  const units = new Map<string, Accumulated>();
  const steps = new Map<string, Accumulated>();
  const files: Array<{ file: string; rows: number; totalMs: number }> = [];

  for (const fixturePath of fixturePaths) {
    const csvText = await readFile(fixturePath, "utf-8");
    const totalStart = performance.now();
    const result = await processRawCsvContent(
      path.basename(fixturePath),
      csvText,
      options,
      supportFiles,
      runMatcher,
      { datetimeOfPreprocessing: "2026-04-24 00:32:53" },
      () => {},
    );
    const totalMs = performance.now() - totalStart;
    files.push({ file: path.basename(fixturePath), rows: result.originalRowCount, totalMs });

    const ledger = result.executionLedger ?? [];
    if (ledger.length === 0) {
      throw new Error(`${fixturePath}: pipeline returned no executionLedger — profiling impossible`);
    }
    for (const unit of ledger) {
      accumulate(units, unit.unit, unit.unit, null, unit.timing.durationMs, unit.rowsIn, unit.rowsOut, null);
      for (const step of unit.steps) {
        accumulate(
          steps,
          `${unit.unit}:${step.stepId}`,
          unit.unit,
          step.stepId,
          step.timing.durationMs,
          step.rowsIn,
          step.rowsOut,
          step.droppedRows,
        );
      }
    }
    process.stderr.write(
      `[${path.basename(fixturePath)}] ${result.originalRowCount.toLocaleString()} rows, total ${fmtMs(totalMs)}\n`,
    );
  }

  const grandTotal = files.reduce((sum, file) => sum + file.totalMs, 0);
  const unitRanking = [...units.values()].sort((a, b) => b.totalMs - a.totalMs);
  const stepRanking = [...steps.values()].sort((a, b) => b.totalMs - a.totalMs);

  process.stderr.write(`\n=== UNITS by total ledger time (wall total ${fmtMs(grandTotal)}) ===\n`);
  for (const row of unitRanking) {
    process.stderr.write(
      `  ${row.unit.padEnd(24)} ${fmtMs(row.totalMs).padStart(10)}  ${((row.totalMs / grandTotal) * 100).toFixed(1).padStart(5)}%  rows ${row.rowsIn.toLocaleString()}→${row.rowsOut.toLocaleString()}\n`,
    );
  }
  process.stderr.write("\n=== TOP 20 STEPS by total ledger time ===\n");
  for (const row of stepRanking.slice(0, 20)) {
    process.stderr.write(
      `  ${row.key.padEnd(44)} ${fmtMs(row.totalMs).padStart(10)}  ${((row.totalMs / grandTotal) * 100).toFixed(1).padStart(5)}%  rows ${row.rowsIn.toLocaleString()}→${row.rowsOut.toLocaleString()}${row.droppedRows ? ` (dropped ${row.droppedRows.toLocaleString()})` : ""}\n`,
    );
  }

  process.stdout.write(
    JSON.stringify(
      {
        grandTotalMs: grandTotal,
        files,
        units: unitRanking,
        steps: stepRanking,
      },
      null,
      2,
    ),
  );
}

await main();
