// Combinatorial-coverage artifacts for the full browser processing contract
// (docs/dag-validate-ontologize-productize-research.md §S3).
//
//   vite-node scripts/generate_combinatorial_model.mts
//     → web/combinatorial/model.pict          Microsoft PICT model (array generation)
//     → web/combinatorial/model.acts.txt      NIST ACTS model (CCM coverage measurement)
//     → web/combinatorial/existing_tests.csv  every EXECUTED test config, projected
//                                             onto the equivalence classes below
//
//   vite-node scripts/generate_combinatorial_model.mts decode <pict-rows.tsv> <out.json>
//     → decodes a PICT output table back into full BrowserProcessingOptions objects
//       (consumed by coveringArrayValidation.test.ts)
//   vite-node scripts/generate_combinatorial_model.mts project <table> <out>
//     → projects an older/full-contract table onto the computational axes
//
//   vite-node scripts/generate_combinatorial_model.mts coverage <t,...> <table...>
//   vite-node scripts/generate_combinatorial_model.mts verify-coverage <t,...> <table...>
//     → measures exact valid t-way tuple coverage from the same equivalence
//       classes and constraints. The verify form requires 100% coverage.
//
// Every contract key gets a declared set of named equivalence classes for drift
// checking (boolean → on/off, enums → each value, numbers → default + boundary,
// arrays → default + empty/alternate). Only the contract-declared computational
// axes enter the covering models. The class LABELS are plain [a-z0-9_] tokens
// so both the PICT and the ACTS/CCM parsers accept them verbatim; this table is
// the single label ↔ value mapping for all artifacts. A key added to the LinkML
// contract without a class entry here fails loudly below.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  BROWSER_PROCESSING_OPTION_KEYS,
  COMPUTATIONAL_BROWSER_OPTION_KEYS,
  BOOLEAN_BROWSER_OPTION_KEYS,
  DEFAULT_BROWSER_OPTIONS,
} from "../src/lib/generatedContract";
import type { BrowserProcessingOptions } from "../src/lib/types";
import { ALL_ON } from "../src/testSupport/rustCampaignGraph";
import { configurationEquivalenceClasses } from "../src/testSupport/configurationEquivalenceClasses";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, "../combinatorial");
const MODEL_OPTION_KEYS = COMPUTATIONAL_BROWSER_OPTION_KEYS;

const BOOLEAN_KEY_SET = new Set<string>(BOOLEAN_BROWSER_OPTION_KEYS);

const classesFor = (key: string) => configurationEquivalenceClasses(key);

// ── Encoding: options object → class labels ─────────────────────────────────

function encodeOptions(options: BrowserProcessingOptions): Record<string, string> {
  const row: Record<string, string> = {};
  for (const key of MODEL_OPTION_KEYS) {
    const value = options[key];
    const match = classesFor(key).find(
      (cls) => JSON.stringify(cls.value ?? null) === JSON.stringify(value ?? null),
    );
    if (!match) {
      throw new Error(
        `No equivalence class for ${key}=${JSON.stringify(value)} — ` +
          `either add a class or fix the projected test config`,
      );
    }
    row[key] = match.label;
  }
  return row;
}

// ── The executed test configurations ─────────────────────────────────────────

/**
 * Browser-side option payloads of the deterministic parity scenarios.
 * Originally sourced from the `_write_browser_spec(options={...})` blocks in
 * scripts/run_deterministic_web_parity.py (removed with the desktop engine;
 * resolves at the last pre-removal ref). These payloads are now frozen here —
 * they only shape the measured before-coverage, not correctness.
 */
const PARITY_SPEC_OPTIONS: Array<Partial<BrowserProcessingOptions>> = [
  // full: codebook + filter + forcing, app + screen
  {
    studyName: "Deterministic Parity",
    minimumUsageDuration: 0,
    proximityIntervalSeconds: 0,
    processAppUsage: true,
    processScreenUsage: true,
    enablePlotting: false,
    parallelProcessing: false,
    selectedTimezone: "America/Chicago",
    timezoneHandling: "selected-filter",
    useFilterFile: true,
    useAppsForcingScreenOpenFile: true,
    useAppCodebook: true,
  },
  // core: no support files, app only
  {
    studyName: "Deterministic Parity",
    minimumUsageDuration: 0,
    proximityIntervalSeconds: 0,
    processAppUsage: true,
    processScreenUsage: false,
    enablePlotting: false,
    parallelProcessing: false,
    selectedTimezone: "America/Chicago",
    timezoneHandling: "selected-filter",
    useFilterFile: false,
    useAppsForcingScreenOpenFile: false,
    useAppCodebook: false,
  },
  // category: codebook + category column
  {
    studyName: "Deterministic Parity",
    minimumUsageDuration: 0,
    proximityIntervalSeconds: 0,
    processAppUsage: true,
    processScreenUsage: false,
    enablePlotting: false,
    parallelProcessing: false,
    selectedTimezone: "America/Chicago",
    timezoneHandling: "selected-filter",
    useFilterFile: false,
    useAppsForcingScreenOpenFile: false,
    useAppCodebook: true,
    includeCategoryColumn: true,
  },
  // pip: model concurrent usage
  {
    studyName: "Deterministic Parity",
    minimumUsageDuration: 0,
    proximityIntervalSeconds: 0,
    processAppUsage: true,
    processScreenUsage: false,
    enablePlotting: false,
    selectedTimezone: "America/Chicago",
    timezoneHandling: "selected-filter",
    useFilterFile: false,
    useAppsForcingScreenOpenFile: false,
    useAppCodebook: false,
    modelConcurrentUsage: true,
  },
  // bg: background-apps file
  {
    studyName: "Deterministic Parity",
    minimumUsageDuration: 0,
    proximityIntervalSeconds: 0,
    processAppUsage: true,
    processScreenUsage: false,
    enablePlotting: false,
    parallelProcessing: false,
    selectedTimezone: "America/Chicago",
    timezoneHandling: "selected-filter",
    useFilterFile: false,
    useAppsForcingScreenOpenFile: false,
    useAppCodebook: false,
    useBackgroundAppsFile: true,
  },
  // fbg: filter + background-apps
  {
    studyName: "Deterministic Parity",
    minimumUsageDuration: 0,
    proximityIntervalSeconds: 0,
    processAppUsage: true,
    processScreenUsage: false,
    enablePlotting: false,
    parallelProcessing: false,
    selectedTimezone: "America/Chicago",
    timezoneHandling: "selected-filter",
    useFilterFile: true,
    useAppsForcingScreenOpenFile: false,
    useAppCodebook: false,
    useBackgroundAppsFile: true,
  },
];

// Keep in sync with graphValidation.test.ts describe 4 ("Execution state machine").
const EXEC_GATES = [
  "processAppUsage",
  "processScreenUsage",
  "useFilterFile",
  "useBackgroundAppsFile",
  "modelConcurrentUsage",
  "enableScreenGatedCrediting",
  "enableDayCoverage",
] as const;

const ANALYZE_GATES = [
  "enableStudyWindowFilter",
  "enablePersonAttribution",
  "enableComplianceScoring",
  "addNoActivityPlaceholderDays",
] as const;

function existingTestConfigs(): Array<{ id: string; options: BrowserProcessingOptions }> {
  const configs: Array<{ id: string; options: BrowserProcessingOptions }> = [];
  PARITY_SPEC_OPTIONS.forEach((partial, index) => {
    configs.push({
      id: `parity_${index}`,
      options: { ...DEFAULT_BROWSER_OPTIONS, ...partial },
    });
  });
  for (let mask = 0; mask < 1 << EXEC_GATES.length; mask += 1) {
    const options = { ...ALL_ON };
    EXEC_GATES.forEach((key, bit) => {
      (options as unknown as Record<string, boolean>)[key] = Boolean(mask & (1 << bit));
    });
    configs.push({ id: `exec_sweep_${mask}`, options });
  }
  for (let mask = 0; mask < 1 << ANALYZE_GATES.length; mask += 1) {
    const options = { ...ALL_ON };
    ANALYZE_GATES.forEach((key, bit) => {
      (options as unknown as Record<string, boolean>)[key] = Boolean(mask & (1 << bit));
    });
    configs.push({ id: `analyze_sweep_${mask}`, options });
  }
  return configs;
}

// ── Model emitters ───────────────────────────────────────────────────────────

// Illegal combination: the selected-* timezone modes read selectedTimezone; an
// empty selection is rejected by the app before processing. The primary-*
// modes ignore selectedTimezone entirely, so it is pinned to "none" there to
// keep inert value variation out of the coverage denominator.
function pictModel(): string {
  const lines: string[] = [
    "# GENERATED by web/scripts/generate_combinatorial_model.mts — do not edit.",
    "# Microsoft PICT model of the browser processing-option contract.",
  ];
  for (const key of MODEL_OPTION_KEYS) {
    lines.push(`${key}: ${classesFor(key).map((cls) => cls.label).join(", ")}`);
  }
  lines.push("");
  lines.push(
    'IF [timezoneHandling] IN {"selected_filter", "selected_convert"} THEN [selectedTimezone] <> "none";',
  );
  lines.push(
    'IF [timezoneHandling] IN {"primary_filter", "primary_convert"} THEN [selectedTimezone] = "none";',
  );
  return `${lines.join("\n")}\n`;
}

function actsModel(): string {
  const lines: string[] = [
    "-- GENERATED by web/scripts/generate_combinatorial_model.mts -- do not edit.",
    "-- NIST ACTS model of the browser processing-option contract (for CCM).",
    "[Parameter]",
  ];
  for (const key of MODEL_OPTION_KEYS) {
    const classes = classesFor(key);
    const isBoolean = BOOLEAN_KEY_SET.has(key);
    const type = isBoolean ? "boolean" : "enum";
    lines.push(`${key} (${type}): ${classes.map((cls) => cls.label).join(",")}`);
  }
  lines.push("");
  lines.push("[Constraint]");
  lines.push(
    '(timezoneHandling = "selected_filter" || timezoneHandling = "selected_convert") => selectedTimezone != "none"',
  );
  lines.push(
    '(timezoneHandling = "primary_filter" || timezoneHandling = "primary_convert") => selectedTimezone = "none"',
  );
  return `${lines.join("\n")}\n`;
}

function existingTestsCsv(): string {
  const header = MODEL_OPTION_KEYS.join(",");
  const rows = existingTestConfigs().map(({ options }) => {
    const encoded = encodeOptions(options);
    return MODEL_OPTION_KEYS.map((key) => encoded[key]).join(",");
  });
  return `${[header, ...rows].join("\n")}\n`;
}

// ── PICT output decoding ─────────────────────────────────────────────────────

async function decodePictOutput(tsvPath: string, outPath: string): Promise<void> {
  const text = await readFile(tsvPath, "utf-8");
  const lines = text.trim().split(/\r?\n/);
  const headerLine = lines[0];
  if (headerLine === undefined) throw new Error("PICT output is empty");
  const header = headerLine.split("\t");
  const expected = new Set<string>(MODEL_OPTION_KEYS);
  if (header.length !== expected.size || header.some((key) => !expected.has(key))) {
    throw new Error("PICT output columns do not exactly match the computational option model");
  }
  const configs = lines.slice(1).map((line, index) => {
    const cells = line.split("\t");
    if (cells.length !== header.length) {
      throw new Error(`PICT output row ${index + 1} has ${cells.length} cells, want ${header.length}`);
    }
    const options: Record<string, unknown> = { ...DEFAULT_BROWSER_OPTIONS };
    header.forEach((key, column) => {
      const label = cells[column];
      const match = classesFor(key).find((cls) => cls.label === label);
      if (!match) throw new Error(`Row ${index + 1}: no class labeled "${label}" for ${key}`);
      if (match.value === undefined) {
        delete options[key];
      } else {
        options[key] = match.value;
      }
    });
    return { id: `pict_${index}`, options };
  });
  await writeFile(
    outPath,
    `${JSON.stringify({ generatedBy: "generate_combinatorial_model.mts decode", source: path.basename(tsvPath), configs }, null, 2)}\n`,
    "utf-8",
  );
  console.log(`decoded ${configs.length} configs → ${outPath}`);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 16), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state = (state ^ (state >>> 16)) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * Produce replayable full-contract configurations beyond the fixed t=3
 * covering array. Values still come exclusively from the contract's declared
 * equivalence classes; the sample adds deterministic high-order interactions,
 * not a second hand-maintained option model.
 */
async function sampleConfigurations(
  seedText: string,
  countText: string,
  outPath: string,
): Promise<void> {
  const seed = Number(seedText);
  const count = Number(countText);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new Error(`sample seed must be a uint32, got ${JSON.stringify(seedText)}`);
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > 10_000) {
    throw new Error(`sample count must be between 1 and 10000, got ${JSON.stringify(countText)}`);
  }
  const random = seededRandom(seed);
  const seen = new Set<string>();
  const configs: Array<{ id: string; options: Record<string, unknown> }> = [];
  let attempts = 0;
  while (configs.length < count) {
    attempts += 1;
    if (attempts > count * 100) {
      throw new Error(`could not generate ${count} distinct legal configurations`);
    }
    const encoded: EncodedRow = {};
    for (const key of MODEL_OPTION_KEYS) {
      const classes = classesFor(key);
      const chosen = classes[Math.floor(random() * classes.length)];
      if (chosen === undefined) throw new Error(`no value classes for ${key}`);
      encoded[key] = chosen.label;
    }
    const handling = encoded.timezoneHandling;
    if (handling === "primary_filter" || handling === "primary_convert") {
      encoded.selectedTimezone = "none";
    } else if (encoded.selectedTimezone === "none") {
      const selected = classesFor("selectedTimezone").filter((entry) => entry.label !== "none");
      const chosen = selected[Math.floor(random() * selected.length)];
      if (chosen === undefined) throw new Error("no selectable timezone classes");
      encoded.selectedTimezone = chosen.label;
    }
    if (!isLegalPartial(encoded)) throw new Error("internal generator emitted an illegal row");
    const identity = MODEL_OPTION_KEYS.map((key) => encoded[key]).join("\u001f");
    if (seen.has(identity)) continue;
    seen.add(identity);
    const options: Record<string, unknown> = { ...DEFAULT_BROWSER_OPTIONS };
    for (const key of MODEL_OPTION_KEYS) {
      const match = classesFor(key).find((entry) => entry.label === encoded[key]);
      if (!match) throw new Error(`missing decoded class for ${key}=${encoded[key]}`);
      if (match.value === undefined) delete options[key];
      else options[key] = match.value;
    }
    configs.push({ id: `seeded_${seed.toString(16).padStart(8, "0")}_${configs.length}`, options });
  }
  await writeFile(
    outPath,
    `${JSON.stringify(
      {
        generatedBy: "generate_combinatorial_model.mts sample",
        seed,
        equivalenceClassAuthority: "web/scripts/generate_combinatorial_model.mts",
        configs,
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  console.log(`sampled ${configs.length} deterministic configs → ${outPath}`);
}

type EncodedRow = Record<string, string>;

async function readEncodedTable(tablePath: string): Promise<EncodedRow[]> {
  const text = await readFile(tablePath, "utf-8");
  const lines = text.trim().split(/\r?\n/);
  const headerLine = lines[0];
  if (lines.length < 2 || headerLine === undefined) {
    throw new Error(`${tablePath}: expected a header and at least one row`);
  }
  const delimiter = headerLine.includes("\t") ? "\t" : ",";
  const header = headerLine.split(delimiter);
  const expected = new Set<string>(MODEL_OPTION_KEYS);
  if (header.length !== expected.size || header.some((key) => !expected.has(key))) {
    throw new Error(`${tablePath}: columns do not exactly match the processing-option contract`);
  }
  return lines.slice(1).map((line, rowIndex) => {
    const cells = line.split(delimiter);
    if (cells.length !== header.length) {
      throw new Error(`${tablePath}:${rowIndex + 2}: ${cells.length} cells, want ${header.length}`);
    }
    return Object.fromEntries(
      header.map((key, column) => {
        const value = cells[column];
        if (value === undefined || !classesFor(key).some((candidate) => candidate.label === value)) {
          throw new Error(`${tablePath}:${rowIndex + 2}: invalid ${key} class ${JSON.stringify(value)}`);
        }
        return [key, value] as const;
      }),
    );
  });
}

async function projectEncodedTable(tablePath: string, outPath: string): Promise<void> {
  const text = await readFile(tablePath, "utf-8");
  const lines = text.trim().split(/\r?\n/);
  const headerLine = lines[0];
  if (lines.length < 2 || headerLine === undefined) {
    throw new Error(`${tablePath}: expected a header and at least one row`);
  }
  const delimiter = headerLine.includes("\t") ? "\t" : ",";
  const sourceHeader = headerLine.split(delimiter);
  const indices = MODEL_OPTION_KEYS.map((key) => {
    const index = sourceHeader.indexOf(key);
    if (index < 0) throw new Error(`${tablePath}: missing computational column ${key}`);
    return index;
  });
  const rows = new Set<string>();
  for (const [rowIndex, line] of lines.slice(1).entries()) {
    const cells = line.split(delimiter);
    if (cells.length !== sourceHeader.length) {
      throw new Error(`${tablePath}:${rowIndex + 2}: ${cells.length} cells, want ${sourceHeader.length}`);
    }
    rows.add(indices.map((index) => cells[index]).join(delimiter));
  }
  await writeFile(
    outPath,
    `${MODEL_OPTION_KEYS.join(delimiter)}\n${Array.from(rows).join("\n")}\n`,
    "utf-8",
  );
  console.log(
    `projected ${lines.length - 1} rows to ${rows.size} unique computational rows → ${outPath}`,
  );
}

/** Keep this predicate synchronized with pictModel()/actsModel(). */
function isLegalPartial(assignment: EncodedRow): boolean {
  const handling = assignment.timezoneHandling;
  const selected = assignment.selectedTimezone;
  if (handling === undefined || selected === undefined) return true;
  if (handling === "selected_filter" || handling === "selected_convert") {
    return selected !== "none";
  }
  if (handling === "primary_filter" || handling === "primary_convert") {
    return selected === "none";
  }
  throw new Error(`Unknown timezoneHandling class ${JSON.stringify(handling)}`);
}

function indexCombinations(size: number, strength: number): number[][] {
  const result: number[][] = [];
  const visit = (start: number, selected: number[]) => {
    if (selected.length === strength) {
      result.push([...selected]);
      return;
    }
    for (let index = start; index <= size - (strength - selected.length); index += 1) {
      selected.push(index);
      visit(index + 1, selected);
      selected.pop();
    }
  };
  visit(0, []);
  return result;
}

function tupleKey(keys: string[], assignment: EncodedRow): string {
  return keys.map((key) => `${key}=${assignment[key]}`).join("\u001f");
}

function exactCoverage(rows: EncodedRow[], strength: number): { covered: number; total: number } {
  const contractKeys = [...MODEL_OPTION_KEYS];
  if (!Number.isInteger(strength) || strength < 1 || strength > contractKeys.length) {
    throw new Error(`Invalid coverage strength ${strength}`);
  }
  let covered = 0;
  let total = 0;
  for (const indices of indexCombinations(contractKeys.length, strength)) {
    const keys = indices.map((index) => {
      const key = contractKeys[index];
      if (key === undefined) throw new Error(`combination index ${index} out of range`);
      return key;
    });
    const observed = new Set(rows.map((row) => tupleKey(keys, row)));
    const assignment: EncodedRow = {};
    const visitValues = (depth: number) => {
      if (depth === keys.length) {
        if (isLegalPartial(assignment)) {
          total += 1;
          if (observed.has(tupleKey(keys, assignment))) covered += 1;
        }
        return;
      }
      const key = keys[depth];
      if (key === undefined) return;
      for (const candidate of classesFor(key)) {
        assignment[key] = candidate.label;
        visitValues(depth + 1);
      }
      delete assignment[key];
    };
    visitValues(0);
  }
  return { covered, total };
}

async function reportCoverage(
  strengthsText: string,
  tablePaths: string[],
  requireComplete: boolean,
): Promise<void> {
  if (tablePaths.length === 0) throw new Error("coverage requires at least one input table");
  const strengths = strengthsText.split(",").map((value) => Number(value));
  const rows = (await Promise.all(tablePaths.map(readEncodedTable))).flat();
  let incomplete = false;
  for (const strength of strengths) {
    const { covered, total } = exactCoverage(rows, strength);
    const percent = (100 * covered) / total;
    console.log(
      `t=${strength} exact valid-tuple coverage: ${percent.toFixed(1)}% (${covered}/${total}) across ${rows.length} rows`,
    );
    incomplete ||= covered !== total;
  }
  if (requireComplete && incomplete) {
    throw new Error("checked-in covering arrays do not provide complete requested coverage");
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "decode") {
    const [tsvPath, outPath] = rest;
    if (!tsvPath || !outPath) {
      throw new Error("usage: generate_combinatorial_model.mts decode <pict-rows.tsv> <out.json>");
    }
    await decodePictOutput(tsvPath, outPath);
    return;
  }
  if (command === "project") {
    const [tablePath, outPath] = rest;
    if (!tablePath || !outPath) {
      throw new Error("usage: generate_combinatorial_model.mts project <table> <out>");
    }
    await projectEncodedTable(tablePath, outPath);
    return;
  }
  if (command === "coverage" || command === "verify-coverage") {
    const [strengths, ...tablePaths] = rest;
    if (!strengths) {
      throw new Error(`usage: generate_combinatorial_model.mts ${command} <t,...> <table...>`);
    }
    await reportCoverage(strengths, tablePaths, command === "verify-coverage");
    return;
  }
  if (command === "sample") {
    const [seed, count, outPath] = rest;
    if (!seed || !count || !outPath) {
      throw new Error(
        "usage: generate_combinatorial_model.mts sample <uint32-seed> <count> <out.json>",
      );
    }
    await sampleConfigurations(seed, count, outPath);
    return;
  }
  if (command) throw new Error(`unknown command "${command}"`);

  await mkdir(OUT_DIR, { recursive: true });
  const artifacts: Array<[string, string]> = [
    ["model.pict", pictModel()],
    ["model.acts.txt", actsModel()],
    ["existing_tests.csv", existingTestsCsv()],
  ];
  for (const [name, content] of artifacts) {
    const target = path.join(OUT_DIR, name);
    await writeFile(target, content, "utf-8");
    console.log(`wrote ${target}`);
  }
  const testCount = existingTestConfigs().length;
  console.log(
    `projected ${testCount} executed test configs over ${MODEL_OPTION_KEYS.length} computational keys ` +
      `(${BROWSER_PROCESSING_OPTION_KEYS.length - MODEL_OPTION_KEYS.length} orthogonal keys factored out)`,
  );
}

if (!process.env.VITEST) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
