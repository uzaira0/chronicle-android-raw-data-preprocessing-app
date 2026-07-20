// Wrap Intl.DateTimeFormat.prototype.format / formatToParts BEFORE
// importing the pipeline, so cached formatter instances still hit the
// patched prototype methods.

import { hrtime } from "node:process";

let intlNs = 0n;
let intlCalls = 0;

function timed<T>(fn: () => T): T {
  const start = hrtime.bigint();
  try {
    return fn();
  } finally {
    intlNs += hrtime.bigint() - start;
    intlCalls += 1;
  }
}

const dtfProto = Intl.DateTimeFormat.prototype;

// .format is a getter that returns a bound function. Replace the getter
// with one that wraps the bound function in a timer.
const formatDesc = Object.getOwnPropertyDescriptor(dtfProto, "format")!;
const originalFormatGetter = formatDesc.get!;
Object.defineProperty(dtfProto, "format", {
  configurable: formatDesc.configurable ?? true,
  enumerable: formatDesc.enumerable ?? false,
  get(this: Intl.DateTimeFormat) {
    const bound = originalFormatGetter.call(this) as (date?: Date | number) => string;
    return function patchedFormat(date?: Date | number): string {
      return timed(() => bound(date));
    };
  },
});

// .formatToParts is a regular method.
const originalFormatToParts = dtfProto.formatToParts;
dtfProto.formatToParts = function patchedFormatToParts(
  this: Intl.DateTimeFormat,
  date?: Date | number,
): Intl.DateTimeFormatPart[] {
  return timed(() => originalFormatToParts.call(this, date));
};

function snapshot(): { ns: bigint; calls: number } {
  return { ns: intlNs, calls: intlCalls };
}

function deltaMs(prev: { ns: bigint; calls: number }): {
  ms: number;
  calls: number;
} {
  return {
    ms: Number(intlNs - prev.ns) / 1_000_000,
    calls: intlCalls - prev.calls,
  };
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";

import { processRawCsvContent } from "../src/lib/browserPipeline";
import type {
  BrowserProcessingOptions,
  BrowserSupportFiles,
  ProgressEvent,
  ProgressStepKind,
} from "../src/lib/types";

import { loadDefaultSupport, runMatcher } from "./_matcherHarness.mjs";

type StageRow = {
  stage: ProgressStepKind;
  totalMs: number;
  intlMs: number;
  intlCalls: number;
  otherMs: number;
};

type FileBreakdown = {
  file: string;
  rowCount: number;
  totalMs: number;
  totalIntlMs: number;
  totalIntlCalls: number;
  stages: StageRow[];
};

async function profileFile(
  filePath: string,
  supportFiles: BrowserSupportFiles,
): Promise<FileBreakdown> {
  const csvText = await readFile(filePath, "utf-8");
  const options: Partial<BrowserProcessingOptions> = {
    processAppUsage: true,
    processScreenUsage: true,
    timezoneHandling: "primary-convert",
    useFilterFile: true,
    useAppsForcingScreenOpenFile: true,
    useAppCodebook: true,
    // vite-node has no DOM — this profiler measures the DATA pipeline.
    enablePlotting: false,
    enableActivityHeatmap: false,
    enableInteractiveTimeline: false,
  };

  const stageStart = new Map<
    ProgressStepKind,
    { wall: number; intl: { ns: bigint; calls: number } }
  >();
  const stages: StageRow[] = [];

  const onProgress = (event: ProgressEvent) => {
    if (event.type !== "step") return;
    const wall = performance.now();
    if (event.percent === 0) {
      stageStart.set(event.stepKind, { wall, intl: snapshot() });
    } else {
      const start = stageStart.get(event.stepKind);
      if (start) {
        const wallDelta = wall - start.wall;
        const intlDelta = deltaMs(start.intl);
        stages.push({
          stage: event.stepKind,
          totalMs: wallDelta,
          intlMs: intlDelta.ms,
          intlCalls: intlDelta.calls,
          otherMs: wallDelta - intlDelta.ms,
        });
        stageStart.delete(event.stepKind);
      }
    }
  };

  const intlBefore = snapshot();
  const totalStart = performance.now();
  const result = await processRawCsvContent(
    path.basename(filePath),
    csvText,
    options,
    supportFiles,
    runMatcher,
    { datetimeOfPreprocessing: "2026-04-24 00:32:53" },
    onProgress,
  );
  const totalMs = performance.now() - totalStart;
  const intlTotalDelta = deltaMs(intlBefore);

  return {
    file: path.basename(filePath),
    rowCount: result.originalRowCount,
    totalMs,
    totalIntlMs: intlTotalDelta.ms,
    totalIntlCalls: intlTotalDelta.calls,
    stages,
  };
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`;
}

async function main(): Promise<void> {
  const fixturePaths = process.argv.slice(2);
  if (fixturePaths.length === 0) {
    throw new Error("Usage: vite-node ... <csv> [csv...]");
  }

  const supportFiles: BrowserSupportFiles = {
    filterFile: await loadDefaultSupport(
      "Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv",
    ),
    appsForcingScreenOpenFile: await loadDefaultSupport(
      "Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv",
    ),
    appCodebookFile: await loadDefaultSupport("unified_app_codebook.csv"),
  };

  const breakdowns: FileBreakdown[] = [];
  for (const fixturePath of fixturePaths) {
    const breakdown = await profileFile(fixturePath, supportFiles);
    breakdowns.push(breakdown);
    process.stderr.write(
      `[${breakdown.file}] ${breakdown.rowCount} rows, total ${fmtMs(breakdown.totalMs)}, intl ${fmtMs(breakdown.totalIntlMs)} (${breakdown.totalIntlCalls} calls, ${((breakdown.totalIntlMs / breakdown.totalMs) * 100).toFixed(1)}% of total)\n`,
    );
    for (const s of breakdown.stages) {
      process.stderr.write(
        `    ${s.stage.padEnd(10)} total=${fmtMs(s.totalMs).padStart(8)} intl=${fmtMs(s.intlMs).padStart(8)} (${s.intlCalls} calls) other=${fmtMs(s.otherMs).padStart(8)}\n`,
      );
    }
  }

  // Aggregate
  const agg = new Map<ProgressStepKind, { totalMs: number; intlMs: number; intlCalls: number; otherMs: number }>();
  let total = 0;
  let totalIntl = 0;
  let totalIntlCalls = 0;
  for (const b of breakdowns) {
    total += b.totalMs;
    totalIntl += b.totalIntlMs;
    totalIntlCalls += b.totalIntlCalls;
    for (const s of b.stages) {
      const cur = agg.get(s.stage) ?? { totalMs: 0, intlMs: 0, intlCalls: 0, otherMs: 0 };
      cur.totalMs += s.totalMs;
      cur.intlMs += s.intlMs;
      cur.intlCalls += s.intlCalls;
      cur.otherMs += s.otherMs;
      agg.set(s.stage, cur);
    }
  }

  process.stderr.write("\n=== AGGREGATE ===\n");
  process.stderr.write(`total wall: ${fmtMs(total)}\n`);
  process.stderr.write(`total Intl: ${fmtMs(totalIntl)} (${totalIntlCalls} calls, ${((totalIntl / total) * 100).toFixed(1)}% of total)\n\n`);
  const rows = [...agg.entries()].sort(([, a], [, b]) => b.totalMs - a.totalMs);
  process.stderr.write(`  ${"stage".padEnd(10)} ${"total".padStart(10)} ${"intl".padStart(10)} ${"other".padStart(10)}  intl%\n`);
  for (const [stage, v] of rows) {
    const intlPct = v.totalMs > 0 ? (v.intlMs / v.totalMs) * 100 : 0;
    process.stderr.write(
      `  ${stage.padEnd(10)} ${fmtMs(v.totalMs).padStart(10)} ${fmtMs(v.intlMs).padStart(10)} ${fmtMs(v.otherMs).padStart(10)}  ${intlPct.toFixed(1)}%\n`,
    );
  }

  process.stdout.write(JSON.stringify({ total, totalIntl, totalIntlCalls, breakdowns }, null, 2));
}

await main();
