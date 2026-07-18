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
//
// Every contract key gets a small set of named equivalence classes (boolean →
// on/off, enums → each value, numbers → default + boundary, arrays → default +
// empty/alternate). The class LABELS are plain [a-z0-9_] tokens so both the
// PICT and the ACTS/CCM parsers accept them verbatim; this table is the single
// label ↔ value mapping for all three artifacts. A key added to the LinkML
// contract without a class entry here fails loudly below.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  BROWSER_PROCESSING_OPTION_KEYS,
  BOOLEAN_BROWSER_OPTION_KEYS,
  DEFAULT_BROWSER_OPTIONS,
  TIMEZONE_HANDLING_VALUES,
  AGGREGATE_SHAPE_VALUES,
} from "../src/lib/generatedContract";
import type { BrowserProcessingOptions } from "../src/lib/types";
import { ALL_ON } from "../src/lib/pipelineGraph/validationHarness";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, "../combinatorial");

// ── Equivalence classes ──────────────────────────────────────────────────────

type EquivalenceClass = { label: string; value: unknown };

function sanitizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

const BOOL_CLASSES: EquivalenceClass[] = [
  { label: "true", value: true },
  { label: "false", value: false },
];

const NON_BOOLEAN_CLASSES: Partial<Record<keyof BrowserProcessingOptions, EquivalenceClass[]>> = {
  studyName: [
    { label: "empty", value: "" },
    { label: "named", value: "Deterministic Parity" },
  ],
  selectedTimezone: [
    { label: "none", value: "" },
    { label: "america_chicago", value: "America/Chicago" },
    { label: "america_new_york", value: "America/New_York" },
  ],
  timezoneHandling: TIMEZONE_HANDLING_VALUES.map((value) => ({
    label: sanitizeLabel(value),
    value,
  })),
  aggregateShape: AGGREGATE_SHAPE_VALUES.map((value) => ({
    label: sanitizeLabel(value),
    value,
  })),
  longDurationThresholdHours: [
    { label: "h12", value: 12 },
    { label: "h1", value: 1 },
  ],
  minimumUsageDuration: [
    { label: "s0", value: 0 },
    { label: "s60", value: 60 },
  ],
  customAppEngagementDuration: [
    { label: "s300", value: 300 },
    { label: "s0", value: 0 },
  ],
  longUsageDurationThresholds: [
    { label: "default", value: DEFAULT_BROWSER_OPTIONS.longUsageDurationThresholds },
    { label: "empty", value: [] },
  ],
  longDataTimeGapThresholds: [
    { label: "default", value: DEFAULT_BROWSER_OPTIONS.longDataTimeGapThresholds },
    { label: "empty", value: [] },
  ],
  screenUsageAutoLockTimeoutSeconds: [
    { label: "s120", value: 120 },
    { label: "s0", value: 0 },
  ],
  screenUsageAutoLockToleranceSeconds: [
    { label: "s30", value: 30 },
    { label: "s0", value: 0 },
  ],
  screenUsageManualLockMaxTailGapSeconds: [
    { label: "s30", value: 30 },
    { label: "s0", value: 0 },
  ],
  screenUsageKeyguardNearStopSeconds: [
    { label: "s2", value: 2 },
    { label: "s0", value: 0 },
  ],
  parallelMaxWorkers: [
    { label: "unset", value: undefined },
    { label: "w2", value: 2 },
  ],
  sameAppInteractionTypesToStopUsageAt: [
    { label: "default", value: DEFAULT_BROWSER_OPTIONS.sameAppInteractionTypesToStopUsageAt },
    { label: "empty", value: [] },
  ],
  otherInteractionTypesToStopUsageAt: [
    { label: "default", value: DEFAULT_BROWSER_OPTIONS.otherInteractionTypesToStopUsageAt },
    { label: "empty", value: [] },
  ],
  interactionTypesToRemove: [
    { label: "none", value: [] },
    { label: "usage_stat", value: ["Usage Stat"] },
  ],
  interactionTypeRemap: [
    { label: "none", value: [] },
    // Remaps a type absent from the fixtures: exercises the remap code path
    // without changing fixture semantics.
    { label: "custom", value: ["Custom Foreground => Activity Resumed"] },
  ],
  proximityIntervalSeconds: [
    { label: "s2", value: 2 },
    { label: "s0", value: 0 },
    { label: "s60", value: 60 },
  ],
  creditedSessionCapMinutes: [
    { label: "m360", value: 360 },
    { label: "m0", value: 0 },
  ],
  deviceLivenessGapToleranceMinutes: [
    { label: "m120", value: 120 },
    { label: "m0", value: 0 },
  ],
  autoLockBridgeSeconds: [
    { label: "s120", value: 120 },
    { label: "s0", value: 0 },
  ],
  noWitnessMinDayApps: [
    { label: "n2", value: 2 },
    { label: "n0", value: 0 },
  ],
  complianceThresholdPercent: [
    { label: "p70", value: 70 },
    { label: "p0", value: 0 },
    { label: "p100", value: 100 },
  ],
};

const BOOLEAN_KEY_SET = new Set<string>(BOOLEAN_BROWSER_OPTION_KEYS);

function classesFor(key: string): EquivalenceClass[] {
  if (BOOLEAN_KEY_SET.has(key)) return BOOL_CLASSES;
  const classes = NON_BOOLEAN_CLASSES[key as keyof BrowserProcessingOptions];
  if (!classes) {
    throw new Error(
      `Contract key "${key}" has no equivalence classes — the LinkML contract grew; ` +
        `add a class entry in generate_combinatorial_model.mts`,
    );
  }
  return classes;
}

// Fail loudly on contract drift in either direction.
for (const key of BROWSER_PROCESSING_OPTION_KEYS) classesFor(key);
for (const key of Object.keys(NON_BOOLEAN_CLASSES)) {
  if (!(BROWSER_PROCESSING_OPTION_KEYS as readonly string[]).includes(key)) {
    throw new Error(`Class table entry "${key}" is not a contract key`);
  }
}

// ── Encoding: options object → class labels ─────────────────────────────────

function encodeOptions(options: BrowserProcessingOptions): Record<string, string> {
  const row: Record<string, string> = {};
  for (const key of BROWSER_PROCESSING_OPTION_KEYS) {
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
 * Source of truth: the `_write_browser_spec(options={...})` blocks in
 * scripts/run_deterministic_web_parity.py — keep in sync (drift shifts the
 * measured before-coverage, it does not affect correctness).
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
  for (const key of BROWSER_PROCESSING_OPTION_KEYS) {
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
  for (const key of BROWSER_PROCESSING_OPTION_KEYS) {
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
  const header = BROWSER_PROCESSING_OPTION_KEYS.join(",");
  const rows = existingTestConfigs().map(({ options }) => {
    const encoded = encodeOptions(options);
    return BROWSER_PROCESSING_OPTION_KEYS.map((key) => encoded[key]).join(",");
  });
  return `${[header, ...rows].join("\n")}\n`;
}

// ── PICT output decoding ─────────────────────────────────────────────────────

async function decodePictOutput(tsvPath: string, outPath: string): Promise<void> {
  const text = await readFile(tsvPath, "utf-8");
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split("\t");
  for (const key of header) {
    if (!(BROWSER_PROCESSING_OPTION_KEYS as readonly string[]).includes(key)) {
      throw new Error(`PICT output column "${key}" is not a contract key`);
    }
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
  console.log(`projected ${testCount} executed test configs over ${BROWSER_PROCESSING_OPTION_KEYS.length} contract keys`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
