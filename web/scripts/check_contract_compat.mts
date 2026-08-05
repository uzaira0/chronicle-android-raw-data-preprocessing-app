/**
 * Breaking-change gate over the researcher-facing contract surface.
 *
 * `schema/contract-baseline.json` is a committed snapshot of everything a
 * consumer can depend on: option keys/types/defaults, enum values, pipeline
 * query-group + query ids, output CSV columns (per output), and the raw-input
 * column expectation. This script rebuilds the snapshot from the live
 * artifacts and diffs it against the baseline:
 *
 *   - BREAKING: a removal, rename (removal+addition), option type change,
 *     option default change, enum value removal, query-group/query id removal,
 *     output column removal, raw column removal, or a NEW required raw
 *     column (a stricter ingest expectation).
 *   - COMPATIBLE: pure additions.
 *
 * Modes:
 *   (check, default)     any drift fails with instructions — the baseline
 *                        must always match the shipped surface.
 *   --update             re-snapshots COMPATIBLE drift; refuses breaking.
 *   --update --bump      re-snapshots breaking drift, incrementing
 *                        contractVersion.
 *
 * POLICY: a contractVersion bump is a researcher-visible break. It must
 * ship together with a persisted-settings migration — add/extend the
 * SETTINGS_SCHEMA_VERSION migration in src/lib/settingsPersistence.ts —
 * and a release-notes entry naming what broke.
 */

import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

import {
  AGGREGATE_SHAPE_VALUES,
  BOOLEAN_BROWSER_OPTION_KEYS,
  BROWSER_PROCESSING_OPTION_KEYS,
  DEFAULT_BROWSER_OPTIONS,
  NUMBER_ARRAY_BROWSER_OPTION_KEYS,
  NUMBER_BROWSER_OPTION_KEYS,
  OUTPUT_KIND_VALUES,
  RAW_CHRONICLE_COLUMNS,
  REQUIRED_RAW_COLUMNS,
  STRING_ARRAY_BROWSER_OPTION_KEYS,
  STRING_BROWSER_OPTION_KEYS,
  TIMEZONE_HANDLING_VALUES,
} from "../src/lib/generatedContract";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const baselinePath = path.join(webDir, "schema", "contract-baseline.json");
const outputColumnsPath = path.join(webDir, "schema", "chronicle-output-columns.yaml");
const rustManifestPath = path.resolve(
  webDir,
  "../rust/chronicle_chrono_kernel_wasm/Cargo.toml",
);

type OptionRecord = { type: string; default: unknown };

type Snapshot = {
  contractVersion: number;
  options: Record<string, OptionRecord>;
  enums: Record<string, string[]>;
  queryGroupIds: string[];
  queryIds: string[];
  /** column name -> the outputs it appears in (e.g. ["app","screen"]). */
  outputColumns: Record<string, string[]>;
  rawColumns: { all: string[]; required: string[] };
};

type LegacySnapshot = Snapshot & {
  /** Pre-workflow-contract names accepted only while reading the committed v1 baseline. */
  nodeIds?: string[];
  stepIds?: string[];
};

function normalizeBaseline(value: LegacySnapshot): Snapshot {
  return {
    contractVersion: value.contractVersion,
    options: value.options,
    enums: value.enums,
    queryGroupIds: value.queryGroupIds ?? value.nodeIds ?? [],
    queryIds: value.queryIds ?? value.stepIds ?? [],
    outputColumns: value.outputColumns,
    rawColumns: value.rawColumns,
  };
}

function optionType(key: string): string {
  if ((BOOLEAN_BROWSER_OPTION_KEYS as readonly string[]).includes(key)) return "boolean";
  if ((NUMBER_BROWSER_OPTION_KEYS as readonly string[]).includes(key)) return "number";
  if ((NUMBER_ARRAY_BROWSER_OPTION_KEYS as readonly string[]).includes(key)) return "number[]";
  if ((STRING_ARRAY_BROWSER_OPTION_KEYS as readonly string[]).includes(key)) return "string[]";
  if ((STRING_BROWSER_OPTION_KEYS as readonly string[]).includes(key)) return "string";
  // Optional non-multivalued numbers are uncategorized in the generated
  // key arrays (special-cased by the sanitizer) — pin them explicitly.
  return "number?";
}

async function buildCurrentSnapshot(contractVersion: number): Promise<Snapshot> {
  const options: Record<string, OptionRecord> = {};
  for (const key of BROWSER_PROCESSING_OPTION_KEYS) {
    options[key] = {
      type: optionType(key),
      default: (DEFAULT_BROWSER_OPTIONS as Record<string, unknown>)[key] ?? null,
    };
  }

  const rustContract = JSON.parse(
    execFileSync(
      "cargo",
      [
        "run",
        "--quiet",
        "--locked",
        "--manifest-path",
        rustManifestPath,
        "--features",
        "incremental-v2",
        "--bin",
        "export_workflow_contract",
      ],
      { encoding: "utf-8" },
    ),
  ) as {
    protocolVersion: string;
    execution: {
      queryGroups: Array<{ id: string }>;
      queries: Array<{ id: string }>;
    };
  };
  if (rustContract.protocolVersion !== "chronicle-workflow-contract/v1") {
    throw new Error(`unsupported Rust workflow contract: ${rustContract.protocolVersion}`);
  }
  const queryGroupIds = rustContract.execution.queryGroups
    .map((group) => group.id)
    .sort((a, b) => a.localeCompare(b));
  const queryIds = rustContract.execution.queries
    .map((query) => query.id)
    .sort((a, b) => a.localeCompare(b));

  const catalog = parseYaml(await readFile(outputColumnsPath, "utf-8")) as {
    output_columns: Array<{ column_name: string; column_outputs: string[] }>;
  };
  const outputColumns: Record<string, string[]> = {};
  for (const column of catalog.output_columns) {
    outputColumns[column.column_name] = [...column.column_outputs].sort((a, b) =>
      a.localeCompare(b),
    );
  }

  return {
    contractVersion,
    options,
    enums: {
      TimezoneHandlingMode: [...TIMEZONE_HANDLING_VALUES],
      OutputKind: [...OUTPUT_KIND_VALUES],
      AggregateShape: [...AGGREGATE_SHAPE_VALUES],
    },
    queryGroupIds,
    queryIds,
    outputColumns,
    rawColumns: { all: [...RAW_CHRONICLE_COLUMNS], required: [...REQUIRED_RAW_COLUMNS] },
  };
}

type Diff = { breaking: string[]; compatible: string[] };

function diffLists(label: string, baseline: string[], current: string[], diff: Diff): void {
  const currentSet = new Set(current);
  const baselineSet = new Set(baseline);
  for (const value of baseline) {
    if (!currentSet.has(value)) diff.breaking.push(`${label}: "${value}" removed`);
  }
  for (const value of current) {
    if (!baselineSet.has(value)) diff.compatible.push(`${label}: "${value}" added`);
  }
}

function diffSnapshots(baseline: Snapshot, current: Snapshot): Diff {
  const diff: Diff = { breaking: [], compatible: [] };

  for (const [key, record] of Object.entries(baseline.options)) {
    const now = current.options[key];
    if (!now) {
      diff.breaking.push(`option "${key}" removed`);
      continue;
    }
    if (now.type !== record.type) {
      diff.breaking.push(`option "${key}" type changed: ${record.type} -> ${now.type}`);
    }
    if (JSON.stringify(now.default) !== JSON.stringify(record.default)) {
      diff.breaking.push(
        `option "${key}" default changed: ${JSON.stringify(record.default)} -> ${JSON.stringify(now.default)}`,
      );
    }
  }
  for (const key of Object.keys(current.options)) {
    if (!baseline.options[key]) diff.compatible.push(`option "${key}" added`);
  }

  for (const [enumName, values] of Object.entries(baseline.enums)) {
    diffLists(`enum ${enumName}`, values, current.enums[enumName] ?? [], diff);
  }
  for (const enumName of Object.keys(current.enums)) {
    if (!baseline.enums[enumName]) diff.compatible.push(`enum ${enumName} added`);
  }

  diffLists("query group id", baseline.queryGroupIds, current.queryGroupIds, diff);
  diffLists("query id", baseline.queryIds, current.queryIds, diff);

  for (const [column, outputs] of Object.entries(baseline.outputColumns)) {
    const now = current.outputColumns[column];
    if (!now) {
      diff.breaking.push(`output column "${column}" removed`);
      continue;
    }
    for (const output of outputs) {
      if (!now.includes(output)) {
        diff.breaking.push(`output column "${column}" removed from "${output}" output`);
      }
    }
    for (const output of now) {
      if (!outputs.includes(output)) {
        diff.compatible.push(`output column "${column}" added to "${output}" output`);
      }
    }
  }
  for (const column of Object.keys(current.outputColumns)) {
    if (!baseline.outputColumns[column]) diff.compatible.push(`output column "${column}" added`);
  }

  diffLists("raw column", baseline.rawColumns.all, current.rawColumns.all, diff);
  // A NEW required raw column tightens the ingest expectation — breaking.
  const baselineRequired = new Set(baseline.rawColumns.required);
  for (const column of current.rawColumns.required) {
    if (!baselineRequired.has(column)) {
      diff.breaking.push(`raw column "${column}" became required (stricter ingest expectation)`);
    }
  }
  const currentRequired = new Set(current.rawColumns.required);
  for (const column of baseline.rawColumns.required) {
    if (!currentRequired.has(column)) {
      diff.compatible.push(`raw column "${column}" no longer required`);
    }
  }

  return diff;
}

async function main(): Promise<void> {
  const update = process.argv.includes("--update");
  const bump = process.argv.includes("--bump");

  const baselineText = await readFile(baselinePath, "utf-8").catch(() => null);
  if (baselineText === null) {
    if (!update) {
      throw new Error(
        `contract baseline missing at ${path.relative(webDir, baselinePath)} — run with --update to record it`,
      );
    }
    const initial = await buildCurrentSnapshot(1);
    await writeFile(baselinePath, `${JSON.stringify(initial, null, 2)}\n`, "utf-8");
    console.log(JSON.stringify({ status: "ok", mode: "init", contractVersion: 1 }, null, 2));
    return;
  }

  const baseline = normalizeBaseline(JSON.parse(baselineText) as LegacySnapshot);
  const current = await buildCurrentSnapshot(baseline.contractVersion);
  const diff = diffSnapshots(baseline, current);

  if (diff.breaking.length === 0 && diff.compatible.length === 0) {
    console.log(
      JSON.stringify(
        { status: "ok", mode: update ? "update-noop" : "check", contractVersion: baseline.contractVersion },
        null,
        2,
      ),
    );
    return;
  }

  const report = [
    ...diff.breaking.map((entry) => `  BREAKING   ${entry}`),
    ...diff.compatible.map((entry) => `  compatible ${entry}`),
  ].join("\n");

  if (!update) {
    throw new Error(
      `contract surface drifted from schema/contract-baseline.json:\n${report}\n` +
        (diff.breaking.length > 0
          ? "Breaking drift: re-record with `--update --bump` (bumps contractVersion; REQUIRES a " +
            "SETTINGS_SCHEMA_VERSION migration in settingsPersistence.ts + release note)."
          : "Compatible drift: re-record with `--update`."),
    );
  }
  if (diff.breaking.length > 0 && !bump) {
    throw new Error(
      `refusing --update: breaking contract drift needs an explicit --bump:\n${report}`,
    );
  }

  const nextVersion = diff.breaking.length > 0 ? baseline.contractVersion + 1 : baseline.contractVersion;
  const next = await buildCurrentSnapshot(nextVersion);
  await writeFile(baselinePath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
  console.log(report);
  console.log(
    JSON.stringify(
      {
        status: "ok",
        mode: diff.breaking.length > 0 ? "update-bump" : "update",
        contractVersion: nextVersion,
        breaking: diff.breaking.length,
        compatible: diff.compatible.length,
      },
      null,
      2,
    ),
  );
  if (diff.breaking.length > 0) {
    console.log(
      "REMINDER: ship a SETTINGS_SCHEMA_VERSION migration (src/lib/settingsPersistence.ts) and a release note with this bump.",
    );
  }
}

await main();
