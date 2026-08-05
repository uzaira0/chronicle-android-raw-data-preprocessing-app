// Generates the count-neutral, read-only web projection of the Rust-owned
// workflow contract. Rust owns all instance labels, descriptions, topology,
// applicability, and digest identities; this generator never reads generated
// output back as an authoring source.

import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(HERE, "../schema/chronicle-local-contract.linkml.yaml");
const OUTPUT_PATH = path.resolve(HERE, "../schema/chronicle-workflow.yaml");
const INTERACTION_TYPES_OUTPUT_PATH = path.resolve(HERE, "../src/lib/generatedInteractionTypes.ts");
const RUST_MANIFEST_PATH = path.resolve(HERE, "../../rust/chronicle_chrono_kernel_wasm/Cargo.toml");

type WorkflowContract = {
  protocolVersion: "chronicle-workflow-contract/v1";
  workflowModelVersion: string;
  preprocessorVersion: string;
  canonicalInteractionTypes: string[];
  unboundOptionKeys: string[];
  semantic: {
    rootRoles: Array<{ roleId: string }>;
    operations: Array<Record<string, unknown> & {
      id: string;
      label: string;
      description: string;
      phaseId: string;
      queryIds: string[];
      configDependencies: Array<{ field: string }>;
    }>;
    artifacts: Array<Record<string, unknown> & {
      id: string;
      label: string;
      producerOperationId: string | null;
      consumerOperationIds: string[];
    }>;
  };
  presentation: {
    phases: Array<Record<string, unknown> & {
      id: string;
      label: string;
      description: string;
    }>;
  };
  execution: {
    queryGroups: Array<Record<string, unknown> & { id: string }>;
    queries: Array<Record<string, unknown> & {
      id: string;
      group: string;
      inputs: string[];
      operationIds: string[];
      outputPorts: string[];
      requestFields: string[];
      sourceRoles: string[];
    }>;
  };
  checkpointPolicy: Record<string, unknown>;
  evidence: Record<string, unknown>;
  digests: Record<string, string>;
};

function loadContract(): WorkflowContract {
  const output = execFileSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--locked",
      "--manifest-path",
      RUST_MANIFEST_PATH,
      "--features",
      "incremental-v2",
      "--bin",
      "export_workflow_contract",
    ],
    { encoding: "utf-8" },
  );
  const contract = JSON.parse(output) as WorkflowContract;
  if (contract.protocolVersion !== "chronicle-workflow-contract/v1") {
    throw new Error(`Unsupported workflow contract: ${contract.protocolVersion}`);
  }
  return contract;
}

type SchemaDoc = { classes: Record<string, { slots?: string[] }> };

function requireUnique(label: string, ids: string[]): Set<string> {
  const unique = new Set(ids);
  if (unique.size !== ids.length) throw new Error(`Duplicate ${label} id`);
  return unique;
}

function assertContract(contract: WorkflowContract, schema: SchemaDoc): void {
  for (const className of [
    "WorkflowPhase",
    "WorkflowOperation",
    "WorkflowArtifact",
    "WorkflowQuery",
    "WorkflowContractProjection",
  ]) {
    if (!schema.classes[className]?.slots) throw new Error(`Schema class ${className} is missing`);
  }
  const phases = requireUnique("phase", contract.presentation.phases.map(({ id }) => id));
  const operations = requireUnique("operation", contract.semantic.operations.map(({ id }) => id));
  const artifacts = requireUnique("artifact", contract.semantic.artifacts.map(({ id }) => id));
  const groups = requireUnique("query group", contract.execution.queryGroups.map(({ id }) => id));
  const queries = requireUnique("query", contract.execution.queries.map(({ id }) => id));
  if ([phases, operations, artifacts, groups, queries].some((ids) => ids.size === 0)) {
    throw new Error("Workflow registries must be non-empty");
  }
  for (const operation of contract.semantic.operations) {
    if (!phases.has(operation.phaseId)) throw new Error(`${operation.id}: unknown phase ${operation.phaseId}`);
  }
  for (const artifact of contract.semantic.artifacts) {
    if (artifact.producerOperationId && !operations.has(artifact.producerOperationId)) {
      throw new Error(`${artifact.id}: unknown producer ${artifact.producerOperationId}`);
    }
    for (const consumer of artifact.consumerOperationIds) {
      if (!operations.has(consumer)) throw new Error(`${artifact.id}: unknown consumer ${consumer}`);
    }
  }
  for (const query of contract.execution.queries) {
    if (!groups.has(query.group)) throw new Error(`${query.id}: unknown query group ${query.group}`);
    for (const input of query.inputs) if (!queries.has(input)) throw new Error(`${query.id}: unknown input ${input}`);
    for (const operation of query.operationIds) {
      if (!operations.has(operation)) throw new Error(`${query.id}: unknown operation ${operation}`);
    }
  }
}

function buildProjection(contract: WorkflowContract): string {
  const projection = {
    workflow_model_version: contract.workflowModelVersion,
    workflow_phases: contract.presentation.phases.map((phase) => ({
      workflow_id: phase.id,
      workflow_label: phase.label,
      workflow_description: phase.description,
    })),
    workflow_operations: contract.semantic.operations.map((operation) => ({
      workflow_id: operation.id,
      workflow_label: operation.label,
      workflow_description: operation.description,
      workflow_phase_id: operation.phaseId,
      workflow_query_ids: operation.queryIds,
      workflow_config_dependency_ids: operation.configDependencies.map(
        (dependency) => dependency.field,
      ),
    })),
    workflow_artifacts: contract.semantic.artifacts.map((artifact) => ({
      workflow_id: artifact.id,
      workflow_label: artifact.label,
      workflow_producer_id: artifact.producerOperationId,
      workflow_consumer_ids: artifact.consumerOperationIds,
    })),
    workflow_queries: contract.execution.queries.map((query) => ({
      workflow_id: query.id,
      workflow_input_ids: query.inputs,
      workflow_operation_ids: query.operationIds,
      workflow_output_ids: query.outputPorts,
    })),
  };
  const header = [
    "# GENERATED by web/scripts/generate_workflow_artifacts.mts — do not edit.",
    "# Count-neutral projection of rust/chronicle_chrono_kernel_wasm/src/workflow_contract.rs.",
    "# This file is a WorkflowContractProjection instance of chronicle-local-contract.linkml.yaml.",
    "# Labels, descriptions, topology, and direct configuration reads all originate in Rust.",
  ].join("\n");
  return `${header}\n${stringifyYaml(projection)}`;
}

function buildInteractionTypes(contract: WorkflowContract): string {
  const names = contract.canonicalInteractionTypes;
  const queryGroupIds = contract.execution.queryGroups.map(({ id }) => id);
  const queryIds = contract.execution.queries.map(({ id }) => id);
  if (names.length === 0 || new Set(names).size !== names.length) {
    throw new Error("Canonical interaction types must be non-empty and unique");
  }
  const sorted = [...names].sort((left, right) => left.localeCompare(right));
  if (sorted.some((name, index) => name !== names[index])) {
    throw new Error("Canonical interaction types must be sorted");
  }
  return [
    "// GENERATED by scripts/generate_workflow_artifacts.mts — do not edit.",
    "// Rust owns these values; TypeScript uses them only for display and controls.",
    `export const PREPROCESSOR_VERSION = ${JSON.stringify(contract.preprocessorVersion)};`,
    `export const WORKFLOW_MODEL_VERSION = ${JSON.stringify(contract.workflowModelVersion)};`,
    `export const WORKFLOW_QUERY_GROUP_IDS = ${JSON.stringify(queryGroupIds, null, 2)} as const;`,
    `export const WORKFLOW_QUERY_IDS = ${JSON.stringify(queryIds, null, 2)} as const;`,
    `export const CANONICAL_INTERACTION_TYPES = ${JSON.stringify(names, null, 2)} as const;`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const contract = loadContract();
  const schema = parseYaml(await readFile(SCHEMA_PATH, "utf-8")) as SchemaDoc;
  assertContract(contract, schema);
  const projection = buildProjection(contract);
  const interactionTypes = buildInteractionTypes(contract);
  if (check) {
    const currentProjection = await readFile(OUTPUT_PATH, "utf-8").catch(() => null);
    const currentTypes = await readFile(INTERACTION_TYPES_OUTPUT_PATH, "utf-8").catch(() => null);
    if (currentProjection !== projection || currentTypes !== interactionTypes) {
      throw new Error("Generated workflow artifacts drifted; run npm run generate:workflow");
    }
    console.log(JSON.stringify({ status: "ok", mode: "check", artifacts: [
      "schema/chronicle-workflow.yaml",
      "src/lib/generatedInteractionTypes.ts",
    ] }));
    return;
  }
  await writeFile(OUTPUT_PATH, projection, "utf-8");
  await writeFile(INTERACTION_TYPES_OUTPUT_PATH, interactionTypes, "utf-8");
  console.log(`wrote ${OUTPUT_PATH} and ${INTERACTION_TYPES_OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
