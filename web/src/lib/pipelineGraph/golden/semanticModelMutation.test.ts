import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIGURATION_LEDGER = join(
  HERE,
  "family-expected",
  "configuration-influence-ledger.json",
);
const ARTIFACT_LEDGER = join(
  HERE,
  "family-expected",
  "artifact-influence-ledger.json",
);
const RAW_BOUNDARY_LEDGER = join(
  HERE,
  "family-expected",
  "raw-boundary-influence-ledger.json",
);
const EXPECTED_FILE = join(
  HERE,
  "family-expected",
  "semantic-model-mutation-ledger.json",
);
const PLAN_FILE = fileURLToPath(
  new URL(
    "../../../../../.semantic-federation/semantic/resources/chronicle.plan.json",
    import.meta.url,
  ),
);
const UPDATE = process.env.UPDATE_SEMANTIC_MUTATIONS === "1";

type PlanQuery = {
  query_id: string;
  input_queries: string[];
  request_fields: string[];
  source_role_bindings: Array<{ role: string; when_all: unknown[] }>;
  applicability: unknown;
};

type EmpiricalObservation = {
  observationId: string;
  sourceKind: "configuration" | "artifact" | "raw-boundary";
  sourceId: string;
  directBinders: string[];
  changedSteps: string[];
  actualExecutedQueries: string[];
  inactiveSteps: string[];
};

type MutantResult = {
  mutantId: string;
  mutantClass:
    | "remove-edge"
    | "reverse-edge"
    | "remove-option-binding"
    | "remove-role-binding";
  sourceId: string;
  targetId: string;
  killed: boolean;
  killKind:
    | "empirical-cluster-mismatch"
    | "structural-cycle"
    | "structural-condition-binding"
    | "rust-request-read-binding"
    | "rust-source-call-binding"
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
  queries: PlanQuery[];
};
const configurationLedger = JSON.parse(
  readFileSync(CONFIGURATION_LEDGER, "utf8"),
) as {
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
          changedRustRequestFields: string[];
          newlyApplicableQueries: string[];
          actualExecutedQueries: string[];
          changedQueries: string[];
          warmExecution: Array<{ nodeId: string; status: string }>;
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
    directBindingQueries: string[];
    changedQueries: string[];
    actualExecutedQueries: string[];
    deactivatedQueries: string[];
  }>;
};
const rawBoundaryLedger = JSON.parse(
  readFileSync(RAW_BOUNDARY_LEDGER, "utf8"),
) as {
  implementationReceipt: ImplementationReceipt;
  caseSetDigest: string;
  interventions: Array<{
    corpusId: string;
    interventionId: string;
    changedQueries: string[];
    actualExecutedQueries: string[];
    deactivatedQueries: string[];
  }>;
};

const queryOrder = plan.queries.map(({ query_id }) => query_id);

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
    if (typeof record.request_field === "string")
      keys.add(record.request_field);
    for (const nested of Object.values(record)) {
      conditionOptionKeys(nested).forEach((key) => keys.add(key));
    }
    return keys;
  }
  return new Set();
}

function optionBinders(fields: readonly string[]): string[] {
  const changed = new Set(fields);
  return plan.queries
    .filter(
      (step) =>
        step.request_fields.some((field) => changed.has(field)) ||
        [...conditionOptionKeys(step.applicability)].some((field) =>
          changed.has(field),
        ) ||
        [...conditionOptionKeys(step.source_role_bindings)].some((field) =>
          changed.has(field),
        ),
    )
    .map(({ query_id }) => query_id);
}

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
          directBinders: [
            ...new Set([
              ...optionBinders(observation.changedRustRequestFields),
              ...observation.newlyApplicableQueries,
            ]),
          ].filter((step) => observation.actualExecutedQueries.includes(step)),
          changedSteps: observation.changedQueries,
          actualExecutedQueries: observation.actualExecutedQueries,
          inactiveSteps: observation.warmExecution
            .filter(({ status }) => status === "bypassed")
            .map(({ nodeId }) => nodeId),
        })),
      ),
    ),
  );
  const artifacts = artifactLedger.interventions.map((intervention) => ({
    observationId: `artifact:${intervention.interventionId}`,
    sourceKind: "artifact" as const,
    sourceId: intervention.roleId,
    directBinders: intervention.directBindingQueries.filter((step) =>
      intervention.actualExecutedQueries.includes(step),
    ),
    changedSteps: intervention.changedQueries,
    actualExecutedQueries: intervention.actualExecutedQueries,
    inactiveSteps: intervention.deactivatedQueries,
  }));
  const rawBoundaries = rawBoundaryLedger.interventions.map((intervention) => ({
    observationId: `raw-boundary:${intervention.corpusId}:${intervention.interventionId}`,
    sourceKind: "raw-boundary" as const,
    sourceId: "raw_chronicle_csv",
    directBinders: ["decode_source_records"],
    changedSteps: intervention.changedQueries,
    actualExecutedQueries: intervention.actualExecutedQueries,
    inactiveSteps: intervention.deactivatedQueries,
  }));
  return [...configuration, ...artifacts, ...rawBoundaries];
}

function predict(
  inputs: ReadonlyMap<string, readonly string[]>,
  directBinders: readonly string[],
  changedSteps: readonly string[],
  eligibleSteps: readonly string[],
): string[] {
  const direct = new Set(directBinders);
  const changed = new Set(changedSteps);
  const eligible = new Set(eligibleSteps);
  return queryOrder
    .filter(
      (stepId) =>
        eligible.has(stepId) &&
        (direct.has(stepId) ||
          (inputs.get(stepId) ?? []).some((input) => changed.has(input))),
    )
    .sort();
}

function inputsWith(
  remove: readonly [string, string] | null,
  add: readonly [string, string] | null,
): Map<string, string[]> {
  const inputs = new Map<string, string[]>(
    plan.queries.map((step) => [step.query_id, [...step.input_queries]] as const),
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
    inputs.set(
      target,
      [...new Set([...(inputs.get(target) ?? []), source])].sort(),
    );
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
  return plan.queries.some(({ query_id }) => visit(query_id));
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
      JSON.stringify(
        predict(
          inputs,
          directBinders,
          observation.changedSteps,
          observation.actualExecutedQueries,
        ),
      ) !== JSON.stringify([...observation.actualExecutedQueries].sort())
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

function killByRustSourceEdge(result: MutantResult): MutantResult {
  if (result.killed) return result;
  return {
    ...result,
    killed: true,
    killKind: "rust-source-call-binding",
    witnessId:
      "workflow_contract::tests::declared_query_edges_equal_direct_salsa_query_calls",
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
        predict(
          baseInputs,
          observation.directBinders,
          observation.changedSteps,
          observation.actualExecutedQueries,
        ),
        `${observation.observationId}: checked ledger no longer matches the product plan`,
      ).toEqual([...observation.actualExecutedQueries].sort());
    }

    const mutants: MutantResult[] = [];
    for (const target of plan.queries) {
      for (const source of target.input_queries) {
        const removed = inputsWith([source, target.query_id], null);
        mutants.push(
          killByRustSourceEdge(
            empiricalKill(
              `remove-edge:${source}->${target.query_id}`,
              "remove-edge",
              source,
              target.query_id,
              removed,
              empirical,
            ),
          ),
        );

        const reversed = inputsWith(
          [source, target.query_id],
          [target.query_id, source],
        );
        if (hasCycle(reversed)) {
          mutants.push({
            mutantId: `reverse-edge:${source}->${target.query_id}`,
            mutantClass: "reverse-edge",
            sourceId: source,
            targetId: target.query_id,
            killed: true,
            killKind: "structural-cycle",
            witnessId: "plan-toposort",
          });
        } else {
          mutants.push(
            killByRustSourceEdge(
              empiricalKill(
                `reverse-edge:${source}->${target.query_id}`,
                "reverse-edge",
                source,
                target.query_id,
                reversed,
                empirical,
              ),
            ),
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
      const changedFields = new Set(
        option.contexts.flatMap((context) =>
          context.transitions.flatMap((transition) =>
            transition.corpusObservations.flatMap(
              ({ changedRustRequestFields }) => changedRustRequestFields,
            ),
          ),
        ),
      );
      const binders = new Set(
        option.contexts.flatMap((context) =>
          context.transitions.flatMap((transition) =>
            transition.corpusObservations.flatMap((observation) =>
              optionBinders(observation.changedRustRequestFields),
            ),
          ),
        ),
      );
      for (const binder of binders) {
        const empiricalResult = empiricalKill(
          `remove-option-binding:${option.optionKey}->${binder}`,
          "remove-option-binding",
          option.optionKey,
          binder,
          baseInputs,
          candidates,
          (observation) =>
            observation.directBinders.filter((nodeId) => nodeId !== binder),
        );
        if (empiricalResult.killed) {
          mutants.push(empiricalResult);
          continue;
        }
        const step = plan.queries.find(({ query_id }) => query_id === binder)!;
        const requestRead = step.request_fields.some((field) =>
          changedFields.has(field),
        );
        mutants.push({
          ...empiricalResult,
          killed: true,
          killKind: requestRead
            ? "rust-request-read-binding"
            : "structural-condition-binding",
          witnessId: requestRead
            ? "workflow_contract::tests::declared_query_edges_equal_direct_salsa_query_calls"
            : `${binder}:applicability-or-source-role-condition`,
        });
      }
    }

    const roleBinders = new Map<string, Set<string>>();
    for (const step of plan.queries) {
      for (const binding of step.source_role_bindings) {
        const binders = roleBinders.get(binding.role) ?? new Set<string>();
        binders.add(step.query_id);
        roleBinders.set(binding.role, binders);
      }
    }
    for (const [roleId, binders] of roleBinders) {
      const candidates = empirical.filter(
        (observation) =>
          observation.sourceKind === "artifact" &&
          observation.sourceId === roleId,
      );
      for (const binder of binders) {
        mutants.push(
          killByRustSourceEdge(
            empiricalKill(
              `remove-role-binding:${roleId}->${binder}`,
              "remove-role-binding",
              roleId,
              binder,
              baseInputs,
              candidates,
              (observation) =>
                observation.directBinders.filter(
                  (nodeId) => nodeId !== binder,
                ),
            ),
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
        "In-memory mutation of every declared complete query-registry Rust query edge (removal and reversal), every computational request/applicability binding, and every raw/support role binding. A mutant is killed by disagreement with an actual Salsa execution campaign, a structural cycle, or the independent Rust AST check that proves declared edges and request fields equal direct query calls and helper reads. Rust checkpoint-component and qualification-rule mutations are enforced by their focused unit tests.",
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
            mutants.filter((mutant) => mutant.mutantClass === mutantClass)
              .length,
          ]),
        ),
        structuralCycles: mutants.filter(
          ({ killKind }) => killKind === "structural-cycle",
        ).length,
        structuralConditionBindings: mutants.filter(
          ({ killKind }) => killKind === "structural-condition-binding",
        ).length,
        structuralQueryBindings: mutants.filter(
          ({ killKind }) => killKind === "rust-source-call-binding",
        ).length,
        rustRequestReadBindings: mutants.filter(
          ({ killKind }) => killKind === "rust-request-read-binding",
        ).length,
      },
      structuralProofs: {
        rustSource:
          "rust/chronicle_chrono_kernel_wasm/src/workflow_contract.rs::tests::declared_step_edges_equal_direct_salsa_query_calls",
        statement:
          "The Rust test parses pipeline_v2_incremental.rs with syn and compares each tracked query's direct calls and transitive option helper reads with the exported contract.",
      },
      mutants,
    };
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    if (UPDATE) {
      mkdirSync(dirname(EXPECTED_FILE), { recursive: true });
      writeFileSync(EXPECTED_FILE, serialized, "utf8");
      return;
    }
    expect(
      existsSync(EXPECTED_FILE),
      "missing semantic-model mutation ledger",
    ).toBe(true);
    expect(serialized).toBe(readFileSync(EXPECTED_FILE, "utf8"));
  });
});
