import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { order } from "@/lib/pipelineGraph/validationHarness";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIGURATION_LEDGER = join(HERE, "family-expected", "configuration-influence-ledger.json");
const ARTIFACT_LEDGER = join(HERE, "family-expected", "artifact-influence-ledger.json");
const RAW_BOUNDARY_LEDGER = join(
  HERE,
  "family-expected",
  "raw-boundary-influence-ledger.json",
);
const EXPECTED_FILE = join(HERE, "family-expected", "semantic-model-mutation-ledger.json");
const PLAN_FILE = fileURLToPath(
  new URL(
    "../../../../../.semantic-federation/semantic/resources/chronicle.plan.json",
    import.meta.url,
  ),
);
const UPDATE = process.env.UPDATE_SEMANTIC_MUTATIONS === "1";

type PlanNode = {
  node_id: string;
  input_nodes: string[];
  support_roles: string[];
  applicability: unknown;
};

type EmpiricalObservation = {
  observationId: string;
  sourceKind: "configuration" | "artifact" | "raw-boundary";
  sourceId: string;
  directBinders: string[];
  changedSemanticNodes: string[];
  observedInputNodes: string[];
};

type MutantResult = {
  mutantId: string;
  mutantClass: "remove-edge" | "reverse-edge" | "remove-option-binding" | "remove-role-binding";
  sourceId: string;
  targetId: string;
  killed: boolean;
  killKind:
    | "empirical-cluster-mismatch"
    | "structural-cycle"
    | "structural-condition-binding"
    | "structural-step-binding"
    | "survived";
  witnessId: string | null;
};

type ImplementationReceipt = {
  implementation: string;
  implementationDigest: string;
  planDigest: string;
  profileDigest: string;
  profileLockDigest: string;
  runtimeAuthorityDigest: string;
  productContractDigest: string;
};

const plan = JSON.parse(readFileSync(PLAN_FILE, "utf8")) as {
  plan_id: string;
  revision: string;
  nodes: PlanNode[];
  steps: Array<{ step_id: string; unit_id: string; input_steps: string[] }>;
};
const configurationLedger = JSON.parse(readFileSync(CONFIGURATION_LEDGER, "utf8")) as {
  implementationReceipt: ImplementationReceipt;
  caseSetDigest: string;
  optionInfluence: Array<{
    optionKey: string;
    declaredBinders: string[];
    contexts: Array<{
      contextId: string;
      transitions: Array<{
        from: string;
        to: string;
        corpusObservations: Array<{
          corpusId: string;
          changedInputKeyNodes: string[];
          changedSemanticOutputNodes: string[];
        }>;
      }>;
    }>;
  }>;
};
const artifactLedger = JSON.parse(readFileSync(ARTIFACT_LEDGER, "utf8")) as {
  implementationReceipt: ImplementationReceipt;
  caseSetDigest: string;
  interventions: Array<{
    interventionId: string;
    roleId: string;
    directBinders: string[];
    changedSemanticNodes: string[];
    observedInputKeyNodes: string[];
  }>;
};
const rawBoundaryLedger = JSON.parse(readFileSync(RAW_BOUNDARY_LEDGER, "utf8")) as {
  implementationReceipt: ImplementationReceipt;
  caseSetDigest: string;
  interventions: Array<{
    corpusId: string;
    interventionId: string;
    changedSemanticNodes: string[];
    observedInputKeyNodes: string[];
  }>;
};

function observations(): EmpiricalObservation[] {
  const configuration = configurationLedger.optionInfluence.flatMap((option) =>
    option.contexts.flatMap((context) =>
      context.transitions.flatMap((transition) =>
        transition.corpusObservations.map((observation) => ({
          observationId: [
            "configuration",
            option.optionKey,
            context.contextId,
            transition.from,
            transition.to,
            observation.corpusId,
          ].join(":"),
          sourceKind: "configuration" as const,
          sourceId: option.optionKey,
          directBinders: option.declaredBinders,
          changedSemanticNodes: observation.changedSemanticOutputNodes,
          observedInputNodes: observation.changedInputKeyNodes,
        })),
      ),
    ),
  );
  const artifacts = artifactLedger.interventions.map((intervention) => ({
    observationId: `artifact:${intervention.interventionId}`,
    sourceKind: "artifact" as const,
    sourceId: intervention.roleId,
    directBinders: intervention.directBinders,
    changedSemanticNodes: intervention.changedSemanticNodes,
    observedInputNodes: intervention.observedInputKeyNodes,
  }));
  const rawBoundaries = rawBoundaryLedger.interventions.map((intervention) => ({
    observationId: `raw-boundary:${intervention.corpusId}:${intervention.interventionId}`,
    sourceKind: "raw-boundary" as const,
    sourceId: "raw_chronicle_csv",
    directBinders: ["parse_events"],
    changedSemanticNodes: intervention.changedSemanticNodes,
    observedInputNodes: intervention.observedInputKeyNodes,
  }));
  return [...configuration, ...artifacts, ...rawBoundaries];
}

function predict(
  inputs: ReadonlyMap<string, readonly string[]>,
  directBinders: readonly string[],
  changedSemanticNodes: readonly string[],
): string[] {
  const direct = new Set(directBinders);
  const changed = new Set(changedSemanticNodes);
  return order
    .filter(
      (nodeId) =>
        direct.has(nodeId) ||
        (inputs.get(nodeId) ?? []).some((input) => changed.has(input)),
    )
    .sort();
}

function inputsWith(
  remove: readonly [string, string] | null,
  add: readonly [string, string] | null,
): Map<string, string[]> {
  const inputs = new Map<string, string[]>(
    plan.nodes.map((node) => [node.node_id, [...node.input_nodes]] as const),
  );
  if (remove) {
    const [source, target] = remove;
    inputs.set(
      target,
      (inputs.get(target) ?? []).filter((input) => input !== source),
    );
  }
  if (add) {
    const [source, target] = add;
    inputs.set(target, [...new Set([...(inputs.get(target) ?? []), source])].sort());
  }
  return inputs;
}

function hasCycle(inputs: ReadonlyMap<string, readonly string[]>): boolean {
  const successors = new Map<string, string[]>();
  for (const [target, sources] of inputs) {
    for (const source of sources) {
      successors.set(source, [...(successors.get(source) ?? []), target]);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    if ((successors.get(node) ?? []).some(visit)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return plan.nodes.some(({ node_id }) => visit(node_id));
}

const unitByStep = new Map(plan.steps.map((step) => [step.step_id, step.unit_id]));
const structuralStepEdges = new Set(
  plan.steps.flatMap((step) =>
    step.input_steps.flatMap((inputStep) => {
      const sourceUnit = unitByStep.get(inputStep);
      return sourceUnit && sourceUnit !== step.unit_id
        ? [`${sourceUnit}->${step.unit_id}`]
        : [];
    }),
  ),
);

function killByStepBinding(result: MutantResult): MutantResult {
  if (
    result.killed ||
    !structuralStepEdges.has(`${result.sourceId}->${result.targetId}`)
  ) {
    return result;
  }
  return {
    ...result,
    killed: true,
    killKind: "structural-step-binding",
    witnessId: `${result.targetId}:cross-unit-step-port:${result.sourceId}`,
  };
}

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
}

function conditionOptionKeys(value: unknown): Set<string> {
  if (Array.isArray(value)) {
    const keys = new Set<string>();
    for (const term of value as unknown[]) {
      conditionOptionKeys(term).forEach((key) => keys.add(key));
    }
    return keys;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = new Set<string>();
    if (typeof record.option_key === "string") keys.add(record.option_key);
    for (const nested of Object.values(record)) {
      conditionOptionKeys(nested).forEach((key) => keys.add(key));
    }
    return keys;
  }
  return new Set();
}

function empiricalKill(
  mutantId: string,
  mutantClass: MutantResult["mutantClass"],
  sourceId: string,
  targetId: string,
  inputs: ReadonlyMap<string, readonly string[]>,
  candidates: readonly EmpiricalObservation[],
  directBinderMutation?: (observation: EmpiricalObservation) => string[],
): MutantResult {
  const witness = candidates.find((observation) => {
    const directBinders = directBinderMutation
      ? directBinderMutation(observation)
      : observation.directBinders;
    return (
      JSON.stringify(predict(inputs, directBinders, observation.changedSemanticNodes)) !==
      JSON.stringify(observation.observedInputNodes)
    );
  });
  return {
    mutantId,
    mutantClass,
    sourceId,
    targetId,
    killed: witness !== undefined,
    killKind: witness ? "empirical-cluster-mismatch" : "survived",
    witnessId: witness?.observationId ?? null,
  };
}

describe("semantic model mutation gate", () => {
  it("kills every viable plan edge and binding deletion with empirical tomography", () => {
    expect(artifactLedger.implementationReceipt).toEqual(
      configurationLedger.implementationReceipt,
    );
    expect(rawBoundaryLedger.implementationReceipt).toEqual(
      configurationLedger.implementationReceipt,
    );
    const empirical = observations();
    const baseInputs = inputsWith(null, null);
    for (const observation of empirical) {
      expect(
        predict(baseInputs, observation.directBinders, observation.changedSemanticNodes),
        `${observation.observationId}: checked ledger no longer matches the product plan`,
      ).toEqual(observation.observedInputNodes);
    }

    const mutants: MutantResult[] = [];
    for (const target of plan.nodes) {
      for (const source of target.input_nodes) {
        const removed = inputsWith([source, target.node_id], null);
        mutants.push(
          killByStepBinding(empiricalKill(
            `remove-edge:${source}->${target.node_id}`,
            "remove-edge",
            source,
            target.node_id,
            removed,
            empirical,
          )),
        );

        const reversed = inputsWith(
          [source, target.node_id],
          [target.node_id, source],
        );
        if (hasCycle(reversed)) {
          mutants.push({
            mutantId: `reverse-edge:${source}->${target.node_id}`,
            mutantClass: "reverse-edge",
            sourceId: source,
            targetId: target.node_id,
            killed: true,
            killKind: "structural-cycle",
            witnessId: "plan-toposort",
          });
        } else {
          mutants.push(
            killByStepBinding(empiricalKill(
              `reverse-edge:${source}->${target.node_id}`,
              "reverse-edge",
              source,
              target.node_id,
              reversed,
              empirical,
            )),
          );
        }
      }
    }

    for (const option of configurationLedger.optionInfluence) {
      const candidates = empirical.filter(
        (observation) =>
          observation.sourceKind === "configuration" &&
          observation.sourceId === option.optionKey,
      );
      for (const binder of option.declaredBinders) {
        const node = plan.nodes.find(({ node_id }) => node_id === binder)!;
        if (conditionOptionKeys(node.applicability).has(snakeCase(option.optionKey))) {
          mutants.push({
            mutantId: `remove-option-binding:${option.optionKey}->${binder}`,
            mutantClass: "remove-option-binding",
            sourceId: option.optionKey,
            targetId: binder,
            killed: true,
            killKind: "structural-condition-binding",
            witnessId: `${binder}:applicability`,
          });
          continue;
        }
        mutants.push(
          empiricalKill(
            `remove-option-binding:${option.optionKey}->${binder}`,
            "remove-option-binding",
            option.optionKey,
            binder,
            baseInputs,
            candidates,
            (observation) =>
              observation.directBinders.filter((nodeId) => nodeId !== binder),
          ),
        );
      }
    }

    const roleBinders = new Map<string, Set<string>>();
    for (const intervention of artifactLedger.interventions) {
      const binders = roleBinders.get(intervention.roleId) ?? new Set<string>();
      intervention.directBinders.forEach((binder) => binders.add(binder));
      roleBinders.set(intervention.roleId, binders);
    }
    for (const [roleId, binders] of roleBinders) {
      const candidates = empirical.filter(
        (observation) =>
          observation.sourceKind === "artifact" && observation.sourceId === roleId,
      );
      for (const binder of binders) {
        mutants.push(
          empiricalKill(
            `remove-role-binding:${roleId}->${binder}`,
            "remove-role-binding",
            roleId,
            binder,
            baseInputs,
            candidates,
            (observation) =>
              observation.directBinders.filter((nodeId) => nodeId !== binder),
          ),
        );
      }
    }

    const survivors = mutants.filter(({ killed }) => !killed);
    expect(
      survivors,
      `semantic mutants survived: ${survivors.map(({ mutantId }) => mutantId).join(", ")}`,
    ).toEqual([]);

    const evidence = {
      protocolVersion: "chronicle-semantic-model-mutation-ledger/v1",
      claimBoundary:
        "In-memory mutation of every declared DAG edge (removal and reversal), every recorded computational option binding, and every raw/support role binding. A mutant is killed by a structural cycle, a required cross-unit typed step port, or disagreement with a checked one-factor empirical percolation observation. Rust checkpoint-component and qualification-rule mutation witnesses are enforced separately by their unit tests.",
      plan: { id: plan.plan_id, revision: plan.revision },
      implementationReceipt: configurationLedger.implementationReceipt,
      sourceLedgers: {
        configurationCaseSetDigest: configurationLedger.caseSetDigest,
        artifactCaseSetDigest: artifactLedger.caseSetDigest,
        rawBoundaryCaseSetDigest: rawBoundaryLedger.caseSetDigest,
      },
      observationCount: empirical.length,
      counts: {
        total: mutants.length,
        killed: mutants.length - survivors.length,
        survived: survivors.length,
        byClass: Object.fromEntries(
          [
            "remove-edge",
            "reverse-edge",
            "remove-option-binding",
            "remove-role-binding",
          ].map((mutantClass) => [
            mutantClass,
            mutants.filter((mutant) => mutant.mutantClass === mutantClass).length,
          ]),
        ),
        structuralCycles: mutants.filter(
          ({ killKind }) => killKind === "structural-cycle",
        ).length,
        structuralConditionBindings: mutants.filter(
          ({ killKind }) => killKind === "structural-condition-binding",
        ).length,
        structuralStepBindings: mutants.filter(
          ({ killKind }) => killKind === "structural-step-binding",
        ).length,
      },
      mutants,
    };
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    if (UPDATE) {
      mkdirSync(dirname(EXPECTED_FILE), { recursive: true });
      writeFileSync(EXPECTED_FILE, serialized, "utf8");
      return;
    }
    expect(existsSync(EXPECTED_FILE), "missing semantic-model mutation ledger").toBe(true);
    expect(serialized).toBe(readFileSync(EXPECTED_FILE, "utf8"));
  });
});
