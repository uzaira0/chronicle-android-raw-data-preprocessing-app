// Generates (or drift-checks, with --check) the declarative projection of the
// pipeline graph: web/schema/chronicle-pipeline-graph.yaml, instance data for
// the PipelineGraph / PipelineNode / PipelineKnobBinding classes declared in
// web/schema/chronicle-local-contract.linkml.yaml.
//
// Rust owns the 55-step graph structure. The retired TypeScript step wiring is
// loaded only as a migration oracle: labels, descriptions and every edge must
// still agree while the remaining per-step metadata moves to Rust. Validation
// here is the bijection gate (docs/dag-validate-ontologize-productize-research.md
// O1 + V7):
//   * every knob option_key is a BrowserProcessingOptions slot;
//   * every support file is a BrowserSupportFiles slot;
//   * inputs reference declared nodes and the graph topo-sorts (DAG);
//   * --check fails on ANY drift between graphDef.ts and the YAML.

import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { buildChronicleGraph, UNBOUND_OPTION_KEYS } from "../src/lib/pipelineGraph/graphDef";
import { topoSort } from "../src/lib/pipelineGraph/engine";
import type { GraphDef } from "../src/lib/pipelineGraph/graphTypes";
import { buildStepGraph, stepInputIds } from "../src/lib/pipelineGraph/stepGraph";
import { ALL_UNIT_WIRINGS } from "../src/lib/pipelineGraph/steps";
import { BROWSER_PROCESSING_OPTION_KEYS } from "../src/lib/generatedContract";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(HERE, "../schema/chronicle-local-contract.linkml.yaml");
const OUTPUT_PATH = path.resolve(HERE, "../schema/chronicle-pipeline-graph.yaml");
const RUST_MANIFEST_PATH = path.resolve(
  HERE,
  "../../rust/chronicle_chrono_kernel_wasm/Cargo.toml",
);

type RustPipelineGroup = {
  id: string;
  label: string;
  section: string;
};

type RustPipelineStep = {
  id: string;
  group: string;
  inputs: string[];
};

type RustPipelineContract = {
  protocolVersion: "chronicle-preprocessing-step-contract/v1";
  groups: RustPipelineGroup[];
  steps: RustPipelineStep[];
};

function loadRustPipelineContract(): RustPipelineContract {
  const output = execFileSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--manifest-path",
      RUST_MANIFEST_PATH,
      "--bin",
      "export_pipeline_step_contract",
    ],
    { encoding: "utf-8" },
  );
  const contract = JSON.parse(output) as RustPipelineContract;
  if (contract.protocolVersion !== "chronicle-preprocessing-step-contract/v1") {
    throw new Error(`Unsupported Rust step contract: ${contract.protocolVersion}`);
  }
  if (contract.groups.length !== 15 || contract.steps.length !== 55) {
    throw new Error(
      `Rust step contract must contain 15 display groups and 55 steps; found ` +
        `${contract.groups.length}/${contract.steps.length}`,
    );
  }
  return contract;
}

function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

type SchemaDoc = {
  classes: Record<string, { slots?: string[] }>;
  enums: Record<string, { permissible_values?: Record<string, unknown> }>;
};

async function loadSchema(): Promise<SchemaDoc> {
  return parseYaml(await readFile(SCHEMA_PATH, "utf-8")) as SchemaDoc;
}

function classSlots(schema: SchemaDoc, className: string): Set<string> {
  const slots = schema.classes[className]?.slots;
  if (!slots) throw new Error(`Schema class ${className} missing or has no slots`);
  return new Set(slots);
}

function enumValues(schema: SchemaDoc, enumName: string): Set<string> {
  const values = schema.enums[enumName]?.permissible_values;
  if (!values) throw new Error(`Schema enum ${enumName} missing`);
  return new Set(Object.keys(values));
}

async function buildProjection(): Promise<string> {
  const schema = await loadSchema();
  const optionSlots = classSlots(schema, "BrowserProcessingOptions");
  const supportSlots = classSlots(schema, "BrowserSupportFiles");
  const sections = enumValues(schema, "PipelineSection");
  const knobEdges = enumValues(schema, "PipelineKnobEdge");

  const def = buildChronicleGraph();
  const rustContract = loadRustPipelineContract();
  // DAG + reference validation (throws on cycles / unknown inputs).
  topoSort(def as GraphDef<unknown>);
  const ids = new Set(rustContract.groups.map((group) => group.id));
  const legacyIds = new Set(def.nodes.map((node) => node.id));
  if (ids.size !== def.nodes.length) throw new Error("Duplicate node ids in graphDef");
  if (
    ids.size !== legacyIds.size ||
    [...ids].some((id) => !legacyIds.has(id))
  ) {
    throw new Error("Rust group ids disagree with the retired TypeScript graph");
  }

  const rustStepsById = new Map(rustContract.steps.map((step) => [step.id, step]));
  const legacySteps = ALL_UNIT_WIRINGS.flatMap((wiring) => wiring.steps);
  const legacyStepsById = new Map(legacySteps.map((step) => [step.id, step]));
  if (
    rustStepsById.size !== legacyStepsById.size ||
    [...rustStepsById].some(([id]) => !legacyStepsById.has(id))
  ) {
    throw new Error("Rust step ids disagree with the retired TypeScript step wiring");
  }

  for (const step of rustContract.steps) {
    const legacy = legacyStepsById.get(step.id);
    if (!legacy) throw new Error(`Missing retired TypeScript step ${step.id}`);
    // Multiple named ports can come from the same producing step. The Rust
    // graph records the dependency once because execution and invalidation do
    // not gain a second edge from a second field projection.
    const legacyInputs = [...new Set(stepInputIds(legacy))];
    if (
      step.group !== legacy.unit ||
      step.inputs.length !== legacyInputs.length ||
      step.inputs.some((input, index) => input !== legacyInputs[index])
    ) {
      throw new Error(
        `Rust step ${step.id} disagrees with the retired TypeScript wiring: ` +
          `${step.group}[${step.inputs.join(",")}] != ` +
          `${legacy.unit}[${legacyInputs.join(",")}]`,
      );
    }
  }

  const groupInputs = new Map<string, string[]>();
  for (const group of rustContract.groups) groupInputs.set(group.id, []);
  for (const step of rustContract.steps) {
    const inputs = groupInputs.get(step.group)!;
    for (const inputId of step.inputs) {
      const input = rustStepsById.get(inputId);
      if (!input) throw new Error(`${step.id}: unknown Rust input ${inputId}`);
      if (input.group !== step.group && !inputs.includes(input.group)) {
        inputs.push(input.group);
      }
    }
  }
  for (const inputs of groupInputs.values()) inputs.sort();

  const boundOptionKeys = new Set<string>();
  const nodes = rustContract.groups.map((group) => {
    const node = def.nodes.find((candidate) => candidate.id === group.id);
    if (!node) throw new Error(`Missing retired TypeScript group ${group.id}`);
    const inputs = groupInputs.get(group.id)!;
    for (const input of node.inputs) {
      if (!ids.has(input)) throw new Error(`${node.id}: unknown input "${input}"`);
    }
    const legacyInputs = [...node.inputs].sort();
    if (
      inputs.length !== legacyInputs.length ||
      inputs.some((input, index) => input !== legacyInputs[index])
    ) {
      throw new Error(
        `Rust-derived group inputs disagree for ${group.id}: ` +
          `[${inputs.join(",")}] != [${legacyInputs.join(",")}]`,
      );
    }
    if (!sections.has(group.section)) {
      throw new Error(`${group.id}: unknown section "${group.section}"`);
    }
    if (group.label !== node.label || group.section !== node.section) {
      throw new Error(`Rust display group metadata disagrees for ${group.id}`);
    }
    const knobs = node.knobs.map((knob) => {
      const slot = camelToSnake(knob.optionKey);
      if (!optionSlots.has(slot)) {
        throw new Error(`${node.id}: knob "${knob.optionKey}" is not a BrowserProcessingOptions slot`);
      }
      if (!knobEdges.has(knob.edge)) throw new Error(`${node.id}: unknown knob edge "${knob.edge}"`);
      boundOptionKeys.add(knob.optionKey);
      return { option_key: slot, edge: knob.edge };
    });
    const supportFiles = (node.supportFiles ?? []).map((key) => {
      const slot = camelToSnake(key);
      if (!supportSlots.has(slot)) {
        throw new Error(`${node.id}: support file "${key}" is not a BrowserSupportFiles slot`);
      }
      return slot;
    });
    return {
      node_id: group.id,
      node_label: group.label,
      section: group.section,
      node_inputs: inputs,
      node_knobs: knobs,
      ...(supportFiles.length > 0 ? { node_support_files: supportFiles } : {}),
      has_bypass: node.bypassedWhen !== undefined,
      has_early_cutoff: node.earlyCutoff === true,
    };
  });

  // Complement bijection: the contract keys with no node binding must be
  // exactly the ones graphDef declares as intentionally unbound.
  const unboundKeys = BROWSER_PROCESSING_OPTION_KEYS.filter((key) => !boundOptionKeys.has(key));
  for (const key of unboundKeys) {
    if (!UNBOUND_OPTION_KEYS.has(key)) {
      throw new Error(
        `Contract option "${key}" is bound to no node and missing from UNBOUND_OPTION_KEYS — ` +
          "bind it or declare it intentionally unbound in graphDef.ts",
      );
    }
  }
  for (const key of UNBOUND_OPTION_KEYS) {
    if (boundOptionKeys.has(key)) {
      throw new Error(`"${key}" is in UNBOUND_OPTION_KEYS but IS bound to a node`);
    }
  }
  const unbound = unboundKeys.map(camelToSnake);

  // Flat step DAG, derived from the SAME wiring objects the step runner
  // executes (buildStepGraph re-validates unit↔wiring bijection, port
  // discipline, unit-edge witnessing and acyclicity — throws on violation).
  const stepGraph = buildStepGraph(def as GraphDef<unknown>, ALL_UNIT_WIRINGS);
  const graphSteps = rustContract.steps.map((step) => {
    const legacy = legacyStepsById.get(step.id)!;
    return {
      step_id: step.id,
      step_label: legacy.label,
      step_description: legacy.description,
      unit_id: step.group,
      ...(step.inputs.length > 0 ? { step_inputs: step.inputs } : {}),
      has_bypass:
        legacy.bypassedWhen !== undefined ||
        def.nodes.find((node) => node.id === step.group)?.bypassedWhen !== undefined,
    };
  });
  if (graphSteps.length !== stepGraph.def.nodes.length) {
    throw new Error("step projection count mismatch with derived step graph");
  }

  const header = [
    "# GENERATED by web/scripts/generate_pipeline_graph_artifacts.mts — do not edit by hand.",
    "# Declarative projection of the Rust-owned 55-step contract in",
    "# rust/chronicle_chrono_kernel_wasm/src/step_contract.rs, conforming to the",
    "# PipelineGraph class in chronicle-local-contract.linkml.yaml. The retired",
    "# TypeScript graph is checked only as a migration oracle.",
    "#",
    "# Contract options NOT bound to any graph node (output/runtime-tier knobs consumed",
    "# outside the DAG):",
    ...unbound.map((slot) => `#   - ${slot}`),
  ].join("\n");

  return `${header}\n${stringifyYaml({ graph_nodes: nodes, graph_steps: graphSteps })}`;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const projection = await buildProjection();
  if (check) {
    const existing = await readFile(OUTPUT_PATH, "utf-8").catch(() => null);
    if (existing !== projection) {
      console.error(
        `DRIFT: ${path.relative(process.cwd(), OUTPUT_PATH)} does not match the Rust step contract — ` +
          "regenerate with: vite-node scripts/generate_pipeline_graph_artifacts.mts",
      );
      process.exit(1);
    }
    console.log(JSON.stringify({ status: "ok", mode: "check", artifact: "schema/chronicle-pipeline-graph.yaml" }));
    return;
  }
  await writeFile(OUTPUT_PATH, projection, "utf-8");
  console.log(`wrote ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
