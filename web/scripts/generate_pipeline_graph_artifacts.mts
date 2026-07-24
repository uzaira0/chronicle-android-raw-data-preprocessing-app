// Generates (or drift-checks, with --check) the declarative projection of the
// pipeline graph: web/schema/chronicle-pipeline-graph.yaml, instance data for
// the PipelineGraph / PipelineNode / PipelineKnobBinding classes declared in
// web/schema/chronicle-local-contract.linkml.yaml.
//
// Rust owns the 55-step graph structure, applicability, option bindings,
// support roles, bypasses, and early-cutoff declarations. The checked-in YAML
// carries step display labels/descriptions only; they cannot affect execution.
// Validation here checks:
//   * every knob option_key is a BrowserProcessingOptions slot;
//   * every support file is a BrowserSupportFiles slot;
//   * inputs reference declared nodes and the graph topo-sorts (DAG);
//   * --check fails on structural drift between the Rust contract and the YAML.

import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";


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
  knobs: Array<{ optionKey: string; edge: string }>;
  supportRoles: string[];
  applicability: unknown;
  canBypass: boolean;
  earlyCutoff: boolean;
};

type RustPipelineStep = {
  id: string;
  group: string;
  inputs: string[];
  canBypass: boolean;
};

type RustPipelineContract = {
  protocolVersion: "chronicle-preprocessing-step-contract/v3";
  unboundOptionKeys: string[];
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
      "--features",
      "incremental-v2",
      "--bin",
      "export_pipeline_step_contract",
    ],
    { encoding: "utf-8" },
  );
  const contract = JSON.parse(output) as RustPipelineContract;
  if (contract.protocolVersion !== "chronicle-preprocessing-step-contract/v3") {
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
  const optionSlots = new Set([
    ...classSlots(schema, "BrowserProcessingOptions"),
    ...classSlots(schema, "BrowserProcessingRuntime"),
  ]);
  const supportSlots = classSlots(schema, "BrowserSupportFiles");
  const sections = enumValues(schema, "PipelineSection");
  const knobEdges = enumValues(schema, "PipelineKnobEdge");

  const rustContract = loadRustPipelineContract();
  const existingDisplay = parseYaml(
    await readFile(OUTPUT_PATH, "utf-8"),
  ) as {
    graph_steps?: Array<{
      step_id: string;
      step_label: string;
      step_description: string;
    }>;
  };
  const displayStepsById = new Map(
    (existingDisplay.graph_steps ?? []).map((step) => [step.step_id, step]),
  );
  const ids = new Set(rustContract.groups.map((group) => group.id));
  if (ids.size !== rustContract.groups.length) throw new Error("Duplicate Rust group ids");

  const rustStepsById = new Map(rustContract.steps.map((step) => [step.id, step]));
  for (const step of rustContract.steps) {
    if (!displayStepsById.has(step.id)) {
      throw new Error(`Missing checked-in display text for Rust step ${step.id}`);
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
    const inputs = groupInputs.get(group.id)!;
    if (!sections.has(group.section)) {
      throw new Error(`${group.id}: unknown section "${group.section}"`);
    }
    const knobs = group.knobs.map((knob) => {
      const slot = knob.optionKey;
      if (!optionSlots.has(slot)) {
        throw new Error(`${group.id}: knob "${slot}" is not a BrowserProcessingOptions slot`);
      }
      if (!knobEdges.has(knob.edge)) throw new Error(`${group.id}: unknown knob edge "${knob.edge}"`);
      boundOptionKeys.add(slot);
      return { option_key: slot, edge: knob.edge };
    });
    const supportFiles = group.supportRoles.map((slot) => {
      if (!supportSlots.has(slot)) {
        throw new Error(`${group.id}: support role "${slot}" is not a BrowserSupportFiles slot`);
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
      has_bypass: group.canBypass,
      has_early_cutoff: group.earlyCutoff,
    };
  });

  // Complement bijection: the contract keys with no node binding must be
  // exactly the ones the Rust contract declares as intentionally unbound.
  const unbound = [...optionSlots].filter((key) => !boundOptionKeys.has(key)).sort();
  const declaredUnbound = [...rustContract.unboundOptionKeys].sort();
  if (
    unbound.length !== declaredUnbound.length ||
    unbound.some((key, index) => key !== declaredUnbound[index])
  ) {
    throw new Error(
      `Rust option binding complement mismatch: actual=[${unbound.join(",")}] ` +
        `declared=[${declaredUnbound.join(",")}].`,
    );
  }

  // Flat step DAG is derived only from the Rust contract. Existing generated
  // rows retain their UI-only labels and descriptions.
  const graphSteps = rustContract.steps.map((step) => {
    const display = displayStepsById.get(step.id)!;
    return {
      step_id: step.id,
      step_label: display.step_label,
      step_description: display.step_description,
      unit_id: step.group,
      ...(step.inputs.length > 0 ? { step_inputs: step.inputs } : {}),
      has_bypass: step.canBypass,
    };
  });
  const header = [
    "# GENERATED by web/scripts/generate_pipeline_graph_artifacts.mts — do not edit by hand.",
    "# Declarative projection of the Rust-owned 55-step contract in",
    "# rust/chronicle_chrono_kernel_wasm/src/step_contract.rs, conforming to the",
    "# PipelineGraph class in chronicle-local-contract.linkml.yaml. The retired",
    "# Step labels/descriptions are display-only text retained in this file.",
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
