// Generates (or drift-checks, with --check) the declarative projection of the
// pipeline graph: web/schema/chronicle-pipeline-graph.yaml, instance data for
// the PipelineGraph / PipelineNode / PipelineKnobBinding classes declared in
// web/schema/chronicle-local-contract.linkml.yaml.
//
// graphDef.ts remains the authoring surface (node bodies are TypeScript); this
// projection makes everything STRUCTURAL — ids, sections, feeds edges, knob
// bindings, support-file reads, bypass/output-hash declarations — a
// schema-governed artifact that CI diffs. Validation here is the bijection
// gate (docs/dag-validate-ontologize-productize-research.md O1 + V7):
//   * every knob option_key is a BrowserProcessingOptions slot;
//   * every support file is a BrowserSupportFiles slot;
//   * inputs reference declared nodes and the graph topo-sorts (DAG);
//   * --check fails on ANY drift between graphDef.ts and the YAML.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { buildChronicleGraph, UNBOUND_OPTION_KEYS } from "../src/lib/pipelineGraph/graphDef";
import { topoSort } from "../src/lib/pipelineGraph/engine";
import type { GraphDef } from "../src/lib/pipelineGraph/graphTypes";
import { BROWSER_PROCESSING_OPTION_KEYS } from "../src/lib/generatedContract";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(HERE, "../schema/chronicle-local-contract.linkml.yaml");
const OUTPUT_PATH = path.resolve(HERE, "../schema/chronicle-pipeline-graph.yaml");

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
  // DAG + reference validation (throws on cycles / unknown inputs).
  topoSort(def as GraphDef<unknown>);
  const ids = new Set(def.nodes.map((node) => node.id));
  if (ids.size !== def.nodes.length) throw new Error("Duplicate node ids in graphDef");

  const boundOptionKeys = new Set<string>();
  const nodes = def.nodes.map((node) => {
    for (const input of node.inputs) {
      if (!ids.has(input)) throw new Error(`${node.id}: unknown input "${input}"`);
    }
    if (!sections.has(node.section)) throw new Error(`${node.id}: unknown section "${node.section}"`);
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
      node_id: node.id,
      node_label: node.label,
      section: node.section,
      node_inputs: node.inputs,
      node_knobs: knobs,
      ...(supportFiles.length > 0 ? { node_support_files: supportFiles } : {}),
      has_bypass: node.bypassedWhen !== undefined,
      has_output_hash: node.outputHash !== undefined,
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

  const header = [
    "# GENERATED by web/scripts/generate_pipeline_graph_artifacts.mts — do not edit by hand.",
    "# Declarative projection of web/src/lib/pipelineGraph/graphDef.ts, conforming to the",
    "# PipelineGraph class in chronicle-local-contract.linkml.yaml. Node bodies stay in",
    "# TypeScript; regenerate after any structural graph change (npm run check:contract",
    "# fails on drift).",
    "#",
    "# Contract options NOT bound to any graph node (output/runtime-tier knobs consumed",
    "# outside the DAG):",
    ...unbound.map((slot) => `#   - ${slot}`),
  ].join("\n");

  return `${header}\n${stringifyYaml({ graph_nodes: nodes })}`;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const projection = await buildProjection();
  if (check) {
    const existing = await readFile(OUTPUT_PATH, "utf-8").catch(() => null);
    if (existing !== projection) {
      console.error(
        `DRIFT: ${path.relative(process.cwd(), OUTPUT_PATH)} does not match graphDef.ts — ` +
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
