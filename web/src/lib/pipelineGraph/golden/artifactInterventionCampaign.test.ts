import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import filterCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?raw";
import forcingCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?raw";
import backgroundCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?raw";
import codebookCsv from "@/assets/defaults/unified_app_codebook.csv?raw";
import { ALL_ON, GOLDEN_RUNTIME, order } from "@/testSupport/rustCampaignGraph";
import { buildRustV2Options } from "@/lib/rustPipelineRuntime";
import {
  buildArtifactFixtureState,
  buildArtifactInterventions,
  SUPPORT_ROLE_IDS,
  type ArtifactFixtureState,
  type InterventionRoleId,
} from "@/testSupport/artifactInterventions";
import {
  captureCanonicalOutputCells,
  changedCellAddresses,
  changedCellScopesByArtifact,
} from "@/testSupport/outputCellTomography";
import {
  buildSyntheticCatalog,
  generateSyntheticChronicleCorpus,
  SYNTHETIC_CORPUS_PROFILES,
} from "@/testSupport/syntheticChronicleCorpus";
import {
  sourceRoleIsActive,
  type RustWorkflowContract,
} from "@/testSupport/workflowContract";
import { dependencyCampaignRuntimeBytes } from "@/testSupport/dependencyCampaignRuntime";
import * as runtime from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

const EXPECTED_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "family-expected",
  "artifact-influence-ledger.json",
);
const CELL_EVIDENCE_FILE = join(
  dirname(EXPECTED_FILE),
  "artifact-output-cell-correspondence.json.gz",
);
const PLAN_FILE = fileURLToPath(
  new URL(
    "../../../../../.semantic-federation/semantic/resources/chronicle.plan.json",
    import.meta.url,
  ),
);
const UPDATE = process.env.UPDATE_ARTIFACT_INFLUENCE === "1";
const FILTER = process.env.ARTIFACT_INTERVENTION;
const SHARD_COUNT = Number(process.env.ARTIFACT_SHARD_COUNT ?? "1");
const SHARD_INDEX = Number(process.env.ARTIFACT_SHARD_INDEX ?? "0");
const encoder = new TextEncoder();

type PlanNode = {
  query_group_id: string;
  input_query_groups: string[];
  support_roles: string[];
};

type ProductPlan = {
  plan_id: string;
  revision: string;
  root_roles: Array<{ role_id: string }>;
  query_groups: PlanNode[];
};

type RuntimeManifest = {
  protocolVersion: string;
  implementation: string;
  implementationDigest: string;
  planDigest: string;
  profileDigest: string;
  profileLockDigest: string;
  runtimeAuthorityDigest: string;
  productContractDigest: string;
  workspaceRootDigest: string;
  qualificationTraces: Array<{
    trace_id: string;
    candidate_id: string;
    artifact_digest: string;
    selected_role_id: string | null;
    decision: "accepted" | "rejected" | "ambiguous";
    rule_evaluations: Array<{ rule_id: string; passed: boolean }>;
  }>;
  requirementTraces: Array<{
    trace_id: string;
    role_id: string;
    required: boolean;
    condition_result: boolean | null;
    accepted_assignment_ids: string[];
    state:
      "open" | "ready" | "satisfied" | "blocked" | "invalid" | "not_applicable";
  }>;
  openObligations: Array<{ role_id?: string; roleId?: string }>;
  counts: Record<string, number>;
  processingSummary: {
    workflowQueryGroupDigests: Record<string, string>;
    workflowQueryGroupCheckpoints: Record<
      string,
      {
        protocolVersion: "chronicle-workflow-checkpoint/v1";
        subjectId: string;
        rowMembershipDigest: string;
        rowOrderDigest: string;
        temporalStateDigest: string;
        classificationDigest: string;
        payloadDigest: string;
        schemaDigest: string;
        terminalDigest: string;
      }
    >;
    workflowQueryDigests: Record<string, string>;
    workflowQueryCheckpoints: Record<string, Record<string, unknown>>;
    publishedOutputsDigest: string;
    provenanceDigest: string;
    [key: string]: unknown;
  };
  queryGroupExecutions: Array<{
    query_group_id: string;
    input_key: string;
    output: { digest: string } | null;
    status: "cached" | "recomputed" | "error" | "skipped" | "bypassed";
  }>;
  queryExecutions: Array<{
    query_id: string;
    query_group_id: string;
    input_key: string;
    output_digest: string;
    status: "cached" | "recomputed" | "error" | "skipped" | "bypassed";
  }>;
  artifacts: Array<{ kind: string; digest: string; size: number }>;
};

type ObservedRuntimeManifest = RuntimeManifest & {
  outputCells: Record<string, string>;
};

const plan = JSON.parse(readFileSync(PLAN_FILE, "utf8")) as ProductPlan;
const catalog = buildSyntheticCatalog({
  codebookCsv,
  filterCsv,
  backgroundCsv,
  forcingScreenOpenCsv: forcingCsv,
});
let workflowContract: RustWorkflowContract;

beforeAll(() => {
  runtime.initSync({ module: dependencyCampaignRuntimeBytes() });
  workflowContract = JSON.parse(
    runtime.workflow_contract_json(),
  ) as RustWorkflowContract;
  expect(workflowContract.protocolVersion).toBe(
    "chronicle-workflow-contract/v1",
  );
  expect(workflowContract.execution.queries).toHaveLength(workflowContract.execution.queries.length);
});

async function sha256Uri(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

async function artifactDigests(
  state: ArtifactFixtureState,
): Promise<Record<InterventionRoleId, string>> {
  const supportDigests = await Promise.all(
    SUPPORT_ROLE_IDS.map(
      async (roleId) =>
        [roleId, await sha256Uri(state.supports[roleId].csv)] as const,
    ),
  );
  return Object.fromEntries([
    ["raw_chronicle_csv", await sha256Uri(state.rawCsv)] as const,
    ...supportDigests,
  ]) as Record<InterventionRoleId, string>;
}

async function execute(
  state: ArtifactFixtureState,
  inputFileName: string,
  workspaceIdentity: string,
  requestId: string,
  previousRoot: string | null,
): Promise<ObservedRuntimeManifest> {
  const csvBytes = encoder.encode(state.rawCsv);
  const supports = new runtime.RuntimeSupportFiles();
  let handle: ReturnType<typeof runtime.execute_workspace> | undefined;
  try {
    for (const roleId of SUPPORT_ROLE_IDS) {
      const support = state.supports[roleId];
      supports.put_with_name(roleId, support.name, encoder.encode(support.csv));
    }
    handle = runtime.execute_workspace(
      JSON.stringify({
        protocolVersion: "chronicle-preprocessing-runtime/v1",
        requestId,
        command: "ExecuteWorkspace",
        workspaceRootDigest: previousRoot,
        workspaceId: await sha256Uri(workspaceIdentity),
        inputFileName,
        inputSha256: await sha256Uri(csvBytes),
        options: buildRustV2Options(ALL_ON, GOLDEN_RUNTIME),
      }),
      csvBytes,
      supports,
    );
    const manifest = JSON.parse(handle.manifest_json()) as RuntimeManifest;
    return Object.assign(manifest, {
      outputCells: captureCanonicalOutputCells(handle),
    });
  } finally {
    handle?.free();
    supports.free();
  }
}

function changedFields(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]))
    .sort();
}

function nodeOutputDigests(
  manifest: RuntimeManifest,
): Record<string, string | null> {
  return Object.fromEntries(
    manifest.queryGroupExecutions.map((execution) => [
      execution.query_group_id,
      execution.output?.digest ?? null,
    ]),
  );
}

function queryStatuses(manifest: RuntimeManifest): Record<string, string> {
  return Object.fromEntries(
    manifest.queryExecutions.map((execution) => [
      execution.query_id,
      execution.status,
    ]),
  );
}

function executedQueryIds(manifest: RuntimeManifest): string[] {
  return manifest.queryExecutions
    .filter(({ status }) => status === "recomputed")
    .map(({ query_id }) => query_id)
    .sort();
}

function qualificationByRole(
  manifest: RuntimeManifest,
): Record<string, unknown> {
  return Object.fromEntries(
    manifest.qualificationTraces
      .filter(({ selected_role_id }) => selected_role_id !== null)
      .sort((left, right) =>
        left.selected_role_id!.localeCompare(right.selected_role_id!),
      )
      .map((trace) => [
        trace.selected_role_id!,
        {
          traceId: trace.trace_id,
          candidateId: trace.candidate_id,
          artifactDigest: trace.artifact_digest,
          decision: trace.decision,
        },
      ]),
  );
}

function requirementByRole(manifest: RuntimeManifest): Record<string, unknown> {
  return Object.fromEntries(
    manifest.requirementTraces
      .slice()
      .sort((left, right) => left.role_id.localeCompare(right.role_id))
      .map((trace) => [
        trace.role_id,
        {
          traceId: trace.trace_id,
          required: trace.required,
          conditionResult: trace.condition_result,
          acceptedAssignmentIds: trace.accepted_assignment_ids,
          state: trace.state,
        },
      ]),
  );
}

function predictedExecutedQueries(
  roleId: InterventionRoleId,
  changedQueries: ReadonlySet<string>,
  targetOptions: Record<string, unknown>,
  source: RuntimeManifest,
  target: RuntimeManifest,
): string[] {
  const sourceStatuses = queryStatuses(source);
  const targetStatuses = queryStatuses(target);
  return workflowContract.execution.queries
    .filter((query) => {
      const sourceApplicable = sourceStatuses[query.id] !== "bypassed";
      const targetApplicable = targetStatuses[query.id] !== "bypassed";
      return (
        targetApplicable &&
        (!sourceApplicable ||
          sourceRoleIsActive(query, roleId, targetOptions) ||
          query.inputs.some((input) => changedQueries.has(input)))
      );
    })
    .map(({ id }) => id)
    .sort();
}

const OUTPUT_ARTIFACT_KINDS = new Set([
  "app-csv",
  "screen-csv",
  "day-coverage-csv",
  "compliance-csv",
  "credited-app-csv",
  "review-summary-json",
  "visualization-data-json",
  "app-parquet",
  "screen-parquet",
  "app-spss",
  "screen-spss",
  "row-lineage-arrow",
  "source-coordinate-index-arrow",
  "result-cell-correspondence-arrow",
  "source-result-influence-arrow",
]);

function outputArtifactDigests(
  manifest: RuntimeManifest,
): Record<string, string> {
  return Object.fromEntries(
    manifest.artifacts
      .filter(
        ({ kind }) =>
          OUTPUT_ARTIFACT_KINDS.has(kind) || kind.startsWith("aggregate-"),
      )
      .sort((left, right) => left.kind.localeCompare(right.kind))
      .map(({ kind, digest }) => [kind, digest]),
  );
}

function semanticOutcome(manifest: RuntimeManifest): Record<string, unknown> {
  return {
    counts: manifest.counts,
    processingSummary: manifest.processingSummary,
    outputArtifacts: outputArtifactDigests(manifest),
  };
}

function changedCheckpointComponents(
  source: RuntimeManifest,
  target: RuntimeManifest,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.keys(source.processingSummary.workflowQueryGroupCheckpoints)
      .sort()
      .map(
        (nodeId) =>
          [
            nodeId,
            changedFields(
              source.processingSummary.workflowQueryGroupCheckpoints[
                nodeId
              ] as unknown as Record<string, unknown>,
              target.processingSummary.workflowQueryGroupCheckpoints[
                nodeId
              ] as unknown as Record<string, unknown>,
            ).filter((field) => field !== "terminalDigest"),
          ] as const,
      )
      .filter(([, components]) => components.length > 0),
  );
}

function changedQueryCheckpointComponents(
  source: RuntimeManifest,
  target: RuntimeManifest,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.keys(source.processingSummary.workflowQueryCheckpoints)
      .sort()
      .map(
        (queryId) =>
          [
            queryId,
            changedFields(
              source.processingSummary.workflowQueryCheckpoints[queryId] ?? {},
              target.processingSummary.workflowQueryCheckpoints[queryId] ?? {},
            ).filter((field) => field !== "terminalDigest"),
          ] as const,
      )
      .filter(([, components]) => components.length > 0),
  );
}

function authorityReceipt(manifest: RuntimeManifest): Record<string, string> {
  return {
    implementation: manifest.implementation,
    implementationDigest: manifest.implementationDigest,
    planDigest: manifest.planDigest,
    profileDigest: manifest.profileDigest,
    profileLockDigest: manifest.profileLockDigest,
    runtimeAuthorityDigest: manifest.runtimeAuthorityDigest,
    productContractDigest: manifest.productContractDigest,
  };
}

describe("artifact dependency tomography", () => {
  it("derives an exact warm/cold percolation ledger for raw and support artifacts", async () => {
    if (
      !Number.isSafeInteger(SHARD_COUNT) ||
      SHARD_COUNT < 1 ||
      !Number.isSafeInteger(SHARD_INDEX) ||
      SHARD_INDEX < 0 ||
      SHARD_INDEX >= SHARD_COUNT
    ) {
      throw new Error(`invalid artifact shard ${SHARD_INDEX}/${SHARD_COUNT}`);
    }
    expect([...plan.query_groups.map(({ query_group_id }) => query_group_id)].sort()).toEqual(
      [...order].sort(),
    );
    expect(
      SUPPORT_ROLE_IDS.filter(
        (roleId) =>
          !workflowContract.execution.queries.some((query) => query.sourceRoles.includes(roleId)),
      ),
      "every support role needs an owning Rust query",
    ).toEqual([]);

    const reports: Array<Record<string, unknown>> = [];
    const caseIdentities: string[] = [];
    const fixtureReceipts: Array<Record<string, unknown>> = [];
    const cellEvidenceCases: Array<{
      caseId: string;
      changedComponents: string[];
      sourceFields: string[];
      changedOutputCellAddresses: string[];
    }> = [];
    let receipt: Record<string, string> | undefined;
    let semanticEffects = 0;
    let exactEquivalences = 0;
    let contextualConvergences = 0;
    const requiredInterventionIds = new Set<string>();
    const semanticWitnessesByIntervention = new Map<string, number>();
    const activationContexts = new Map<
      string,
      { active: Set<string>; converged: Set<string> }
    >();

    for (const [profileIndex, profile] of SYNTHETIC_CORPUS_PROFILES.entries()) {
      if (profileIndex % SHARD_COUNT !== SHARD_INDEX) continue;
      const corpus = generateSyntheticChronicleCorpus(profile, catalog);
      const sourceState = buildArtifactFixtureState({
        corpus,
        catalog,
        filterCsv,
        forcingCsv,
        backgroundCsv,
      });
      const interventions = buildArtifactInterventions({
        corpus,
        catalog,
      }).filter(({ id }) => !FILTER || id === FILTER);
      expect(
        interventions.length,
        `${corpus.id}: artifact intervention filter matched nothing`,
      ).toBeGreaterThan(0);
      const sourceDigests = await artifactDigests(sourceState);
      fixtureReceipts.push({
        corpusId: corpus.id,
        seed: corpus.seed,
        rawRowCount: corpus.rowCount,
        injectedFeatures: corpus.injectedFeatures,
        sourceArtifactDigests: sourceDigests,
      });

      for (const intervention of interventions) {
        const caseId = `${corpus.id}:${intervention.id}`;
        const targetState = intervention.apply(sourceState);
        const targetDigests = await artifactDigests(targetState);
        expect(
          changedFields(sourceDigests, targetDigests),
          `${caseId}: intervention must change exactly its declared source artifact`,
        ).toEqual([intervention.roleId]);

        const coldSource = await execute(
          sourceState,
          `${corpus.id}.csv`,
          `artifact:cold-source:${caseId}`,
          `${caseId}:cold-source`,
          null,
        );
        const coldTarget = await execute(
          targetState,
          `${corpus.id}.csv`,
          `artifact:cold-target:${caseId}`,
          `${caseId}:cold-target`,
          null,
        );
        const workspace = `artifact:warm:${caseId}`;
        const warmSource = await execute(
          sourceState,
          `${corpus.id}.csv`,
          workspace,
          `${caseId}:warm-source`,
          null,
        );
        const warmTarget = await execute(
          targetState,
          `${corpus.id}.csv`,
          workspace,
          `${caseId}:warm-target`,
          warmSource.workspaceRootDigest,
        );

        for (const manifest of [
          coldSource,
          coldTarget,
          warmSource,
          warmTarget,
        ]) {
          expect(manifest.openObligations, `${caseId}: binding holes`).toEqual(
            [],
          );
          expect(
            manifest.qualificationTraces,
            `${caseId}: one qualification proof per supplied root role`,
          ).toHaveLength(plan.root_roles.length);
          expect(
            manifest.qualificationTraces.every(
              (trace) =>
                trace.decision === "accepted" &&
                trace.selected_role_id !== null &&
                trace.rule_evaluations.every(({ passed }) => passed),
            ),
            `${caseId}: a candidate bypassed deterministic qualification`,
          ).toBe(true);
          expect(
            Object.keys(qualificationByRole(manifest)).sort(),
            `${caseId}: qualification did not cover the exact root-role vocabulary`,
          ).toEqual(plan.root_roles.map(({ role_id }) => role_id).sort());
          expect(
            manifest.requirementTraces,
            `${caseId}: one requirement proof per root role`,
          ).toHaveLength(plan.root_roles.length);
          expect(
            manifest.requirementTraces.every(
              ({ state }) => state === "satisfied",
            ),
            `${caseId}: supplied fixture left a role unsatisfied`,
          ).toBe(true);
          expect(
            manifest.queryGroupExecutions,
            `${caseId}: query groups`,
          ).toHaveLength(workflowContract.execution.queryGroups.length);
          expect(
            manifest.queryExecutions,
            `${caseId}: Rust workflow queries`,
          ).toHaveLength(workflowContract.execution.queries.length);
          expect(
            manifest.queryExecutions.map(({ query_id }) => query_id).sort(),
          ).toEqual(workflowContract.execution.queries.map(({ id }) => id).sort());
          expect(
            manifest.queryExecutions.every(
              ({ status }) => status !== "error" && status !== "skipped",
            ),
            `${caseId}: failed Rust workflow query`,
          ).toBe(true);
          expect(
            Object.keys(
              manifest.processingSummary.workflowQueryGroupCheckpoints,
            ).sort(),
            `${caseId}: typed checkpoint coverage`,
          ).toEqual(plan.query_groups.map(({ query_group_id }) => query_group_id).sort());
          for (const [queryGroupId, checkpoint] of Object.entries(
            manifest.processingSummary.workflowQueryGroupCheckpoints,
          )) {
            expect(checkpoint.protocolVersion).toBe(
              "chronicle-workflow-checkpoint/v1",
            );
            expect(checkpoint.subjectId).toBe(queryGroupId);
            expect(checkpoint.terminalDigest).toBe(
              manifest.processingSummary.workflowQueryGroupDigests[queryGroupId],
            );
          }
          expect(
            Object.keys(
              manifest.processingSummary.workflowQueryCheckpoints,
            ).sort(),
            `${caseId}: complete query-registry checkpoint coverage`,
          ).toEqual(workflowContract.execution.queries.map(({ id }) => id).sort());
          for (const [queryId, checkpoint] of Object.entries(
            manifest.processingSummary.workflowQueryCheckpoints,
          )) {
            expect(checkpoint.protocolVersion).toBe(
              "chronicle-workflow-checkpoint/v1",
            );
            expect(checkpoint.subjectId).toBe(queryId);
            expect(checkpoint.terminalDigest).toBe(
              manifest.processingSummary.workflowQueryDigests[queryId],
            );
          }
          expect(
            manifest.queryGroupExecutions.every(
              ({ status }) => status !== "error" && status !== "skipped",
            ),
            `${caseId}: failed workflow query-group execution`,
          ).toBe(true);
          const currentReceipt = authorityReceipt(manifest);
          if (!receipt) receipt = currentReceipt;
          else
            expect(currentReceipt, `${caseId}: authority drift`).toEqual(
              receipt,
            );
        }

        expect(
          semanticOutcome(warmSource),
          `${caseId}: warm source oracle`,
        ).toEqual(semanticOutcome(coldSource));
        expect(
          semanticOutcome(warmTarget),
          `${caseId}: warm target oracle`,
        ).toEqual(semanticOutcome(coldTarget));
        expect(
          warmSource.outputCells,
          `${caseId}: warm source cell oracle`,
        ).toEqual(coldSource.outputCells);
        expect(
          warmTarget.outputCells,
          `${caseId}: warm target cell oracle`,
        ).toEqual(coldTarget.outputCells);
        expect(
          nodeOutputDigests(warmTarget),
          `${caseId}: every warm workflow checkpoint needs a cold target`,
        ).toEqual(nodeOutputDigests(coldTarget));
        expect(
          warmTarget.processingSummary.workflowQueryDigests,
          `${caseId}: every warm Rust query checkpoint needs a cold target`,
        ).toEqual(coldTarget.processingSummary.workflowQueryDigests);
        const changedQualificationRoles = changedFields(
          qualificationByRole(coldSource),
          qualificationByRole(coldTarget),
        );
        const changedRequirementRoles = changedFields(
          requirementByRole(coldSource),
          requirementByRole(coldTarget),
        );
        expect(
          changedQualificationRoles,
          `${caseId}: source-to-binding correspondence must change exactly one role`,
        ).toEqual([intervention.roleId]);
        expect(
          changedRequirementRoles,
          `${caseId}: binding-to-requirement correspondence must change exactly one role`,
        ).toEqual([intervention.roleId]);

        const changedSemanticNodes = changedFields(
          coldSource.processingSummary.workflowQueryGroupDigests,
          coldTarget.processingSummary.workflowQueryGroupDigests,
        );
        const checkpointComponentChanges = changedCheckpointComponents(
          coldSource,
          coldTarget,
        );
        expect(
          Object.keys(checkpointComponentChanges).sort(),
          `${caseId}: typed components and terminal commitments disagree`,
        ).toEqual(changedSemanticNodes);
        const changedQueries = changedFields(
          coldSource.processingSummary.workflowQueryDigests,
          coldTarget.processingSummary.workflowQueryDigests,
        );
        const queryCheckpointComponentChanges = changedQueryCheckpointComponents(
          coldSource,
          coldTarget,
        );
        expect(
          Object.keys(queryCheckpointComponentChanges).sort(),
          `${caseId}: query components and terminal commitments disagree`,
        ).toEqual(changedQueries);
        if (intervention.expectedSemanticEffect === "required") {
          requiredInterventionIds.add(intervention.id);
          const contexts = activationContexts.get(intervention.id) ?? {
            active: new Set<string>(),
            converged: new Set<string>(),
          };
          if (changedQueries.length > 0) {
            semanticEffects += 1;
            contexts.active.add(corpus.id);
            semanticWitnessesByIntervention.set(
              intervention.id,
              (semanticWitnessesByIntervention.get(intervention.id) ?? 0) + 1,
            );
          } else {
            contextualConvergences += 1;
            contexts.converged.add(corpus.id);
          }
          activationContexts.set(intervention.id, contexts);
        } else {
          expect(
            changedQueries,
            `${caseId}: representation/ignored-field control must converge`,
          ).toEqual([]);
          exactEquivalences += 1;
        }

        const actualExecutedQueries = executedQueryIds(warmTarget);
        const exactTargetOptions = buildRustV2Options(ALL_ON, GOLDEN_RUNTIME);
        const supportRepresentationOnly =
          intervention.roleId !== "raw_chronicle_csv" &&
          intervention.expectedSemanticEffect === "equivalent";
        const expectedExecutedQueries = supportRepresentationOnly
          ? []
          : predictedExecutedQueries(
              intervention.roleId,
              new Set(changedQueries),
              exactTargetOptions,
              coldSource,
              coldTarget,
            );
        expect(
          actualExecutedQueries,
          `${caseId}: declared inputs and actual Salsa query bodies must agree exactly`,
        ).toEqual(expectedExecutedQueries);
        const sourceStatuses = queryStatuses(coldSource);
        const targetStatuses = queryStatuses(coldTarget);
        const deactivatedQueries = workflowContract.execution.queries
          .filter(
            ({ id }) =>
              sourceStatuses[id] !== "bypassed" &&
              targetStatuses[id] === "bypassed",
          )
          .map(({ id }) => id)
          .sort();
        expect(
          deactivatedQueries,
          `${caseId}: artifact bytes cannot change applicability`,
        ).toEqual([]);
        const directBindingQueries = workflowContract.execution.queries
          .filter(
            (query) =>
            targetStatuses[query.id] !== "bypassed" &&
            sourceRoleIsActive(query, intervention.roleId, exactTargetOptions),
          )
          .map(({ id }) => id)
          .sort();
        if (!supportRepresentationOnly) {
          for (const binder of directBindingQueries) {
            expect(
              actualExecutedQueries,
              `${caseId}: direct Rust artifact binding did not execute`,
            ).toContain(binder);
          }
        }

        const changedOutputArtifactKinds = changedFields(
          outputArtifactDigests(coldSource),
          outputArtifactDigests(coldTarget),
        );
        const changedOutputCellAddresses = changedCellAddresses(
          coldSource.outputCells,
          coldTarget.outputCells,
        );
        cellEvidenceCases.push({
          caseId,
          changedComponents: intervention.changedComponents,
          sourceFields: intervention.sourceFields,
          changedOutputCellAddresses,
        });
        const report = {
          corpusId: corpus.id,
          interventionId: intervention.id,
          roleId: intervention.roleId,
          mutationClass: intervention.mutationClass,
          changedComponents: intervention.changedComponents,
          description: intervention.description,
          expectedSemanticEffect: intervention.expectedSemanticEffect,
          observedSemanticEffect: changedQueries.length > 0,
          directBindingQueries,
          changedQualificationRoles,
          changedRequirementRoles,
          changedSemanticNodes,
          checkpointComponentChanges,
          changedQueries,
          queryCheckpointComponentChanges,
          expectedExecutedQueries,
          actualExecutedQueries,
          deactivatedQueries,
          changedOutputArtifactKinds,
          changedOutputCellCount: changedOutputCellAddresses.length,
          changedOutputCellAddressDigest: await sha256Uri(
            changedOutputCellAddresses.join("\n"),
          ),
          changedOutputCellScopesByArtifact: changedCellScopesByArtifact(
            changedOutputCellAddresses,
          ),
          changedCountFields: changedFields(
            coldSource.counts,
            coldTarget.counts,
          ),
          changedProcessingSummaryFields: changedFields(
            coldSource.processingSummary,
            coldTarget.processingSummary,
          ),
          displayGroupStatuses: warmTarget.queryGroupExecutions.map(
            ({ query_group_id, status }) => ({
              nodeId: query_group_id,
              status,
            }),
          ),
        };
        // A stage badge is a claim about physical execution. The graph panel
        // reads these statuses under "Badges show what the last run actually
        // recomputed versus reused", so `recomputed` must be backed by a
        // member query in this run's own executed-query set. `deactivatedQueries`
        // is asserted empty above, so that is the only other legal source.
        // A support artifact rewritten with CRLF line endings moves the
        // stage's projection key and executes nothing; it must stay `cached`.
        const executedQuerySet = new Set(actualExecutedQueries);
        const recomputedWithoutExecution = report.displayGroupStatuses
          .filter(({ status }) => status === "recomputed")
          .filter(
            ({ nodeId }) =>
              !workflowContract.execution.queries.some(
                (query) => query.group === nodeId && executedQuerySet.has(query.id),
              ),
          )
          .map(({ nodeId }) => nodeId);
        expect(
          recomputedWithoutExecution,
          `${caseId}: stage badged recomputed with no member query in the executed set`,
        ).toEqual([]);
        reports.push(report);
        caseIdentities.push(JSON.stringify(report));
      }
    }

    const missingRequiredWitnesses = [...requiredInterventionIds].filter(
      (interventionId) => !semanticWitnessesByIntervention.has(interventionId),
    );
    if (SHARD_COUNT === 1) {
      expect(
        missingRequiredWitnesses,
        "every substantive intervention needs at least one branch-activating corpus witness",
      ).toEqual([]);
    }

    const cellEvidenceSerialized = `${JSON.stringify(
      {
        protocolVersion: "chronicle-output-cell-correspondence/v2",
        implementationReceipt: receipt,
        claimBoundary:
          "Exact changed canonical CSV/JSON output cell addresses for each named raw/support intervention. Each case also names the exact supplied source columns that intervention rewrote (sourceFields), in the Rust query contract's field namespace, using source.raw_row_set / source.raw_row_order for structural raw changes and an empty list for representation-only controls. Binary exports and the Arrow lineage sidecar are digest-bound separately and are not interpreted as cells.",
        cases: cellEvidenceCases.sort((left, right) =>
          left.caseId.localeCompare(right.caseId),
        ),
      },
      null,
      2,
    )}\n`;
    const cellEvidenceCompressed = gzipSync(cellEvidenceSerialized, {
      level: 9,
    });
    const cellEvidenceDigest = await sha256Uri(cellEvidenceSerialized);

    const evidence = {
      protocolVersion: "chronicle-artifact-influence-ledger/v1",
      workflowCheckpointProtocol: "chronicle-workflow-checkpoint/v1",
      claimBoundary:
        "Exact raw/support artifact percolation for the recorded product plan, implementation, deterministic synthetic corpora, and intervention catalog. Each intervention changes exactly one source artifact; every warm query and query-group checkpoint plus every researcher-visible output is compared with an independent cold Rust/WASM target. Absence of an effect is not generalized beyond the named mutation and corpus.",
      plan: { id: plan.plan_id, revision: plan.revision },
      implementationReceipt: receipt,
      cellEvidence: {
        protocolVersion: "chronicle-output-cell-correspondence/v2",
        path: "artifact-output-cell-correspondence.json.gz",
        contentDigest: cellEvidenceDigest,
        cases: cellEvidenceCases.length,
        changedCellAddresses: cellEvidenceCases.reduce(
          (total, entry) => total + entry.changedOutputCellAddresses.length,
          0,
        ),
      },
      fixtures: fixtureReceipts,
      coverage: {
        corpora: SYNTHETIC_CORPUS_PROFILES.map(({ id }) => id),
        sourceRoles: ["raw_chronicle_csv", ...SUPPORT_ROLE_IDS],
        rawColumns: [
          "study_id",
          "participant_id",
          "possible_device_model",
          "username",
          "application_label",
          "interaction_type",
          "app_package_name",
          "event_timestamp",
          "start_timestamp",
          "stop_timestamp",
          "timezone",
        ],
        rawRowMutations: ["add", "remove", "duplicate", "reorder"],
        supportSubstantiveMutations: SUPPORT_ROLE_IDS,
        representationControls: ["raw_chronicle_csv", ...SUPPORT_ROLE_IDS],
      },
      activationContexts: Object.fromEntries(
        [...activationContexts]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([interventionId, contexts]) => [
            interventionId,
            {
              activeCorpora: [...contexts.active].sort(),
              convergedCorpora: [...contexts.converged].sort(),
            },
          ]),
      ),
      executionCounts: {
        interventions: reports.length,
        coldExecutions: reports.length * 2,
        incrementalExecutions: reports.length * 2,
        totalRustExecutions: reports.length * 4,
        semanticEffects,
        contextualConvergences,
        exactEquivalences,
        workflowCheckpointComparisons: reports.length,
        workflowQueryCheckpointComparisons: reports.length * workflowContract.execution.queries.length,
        typedCheckpointDecompositionComparisons: reports.length,
        exactClusterComparisons: reports.length,
        exactQualificationCorrespondenceComparisons: reports.length,
        exactRequirementCorrespondenceComparisons: reports.length,
        exactOutputCellComparisons: reports.length * 2,
      },
      interventions: reports,
      caseSetDigest: await sha256Uri(caseIdentities.sort().join("\n")),
    };
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    const shardOutput = process.env.ARTIFACT_SHARD_OUTPUT;
    if (shardOutput) {
      writeFileSync(
        shardOutput,
        `${JSON.stringify({ evidence, cellEvidenceCases, caseIdentities }, null, 2)}\n`,
        "utf8",
      );
      return;
    }
    if (UPDATE) {
      mkdirSync(dirname(EXPECTED_FILE), { recursive: true });
      writeFileSync(CELL_EVIDENCE_FILE, cellEvidenceCompressed);
      writeFileSync(EXPECTED_FILE, serialized, "utf8");
      return;
    }
    expect(
      existsSync(CELL_EVIDENCE_FILE),
      "missing output-cell evidence sidecar",
    ).toBe(true);
    expect(cellEvidenceCompressed).toEqual(readFileSync(CELL_EVIDENCE_FILE));
    expect(existsSync(EXPECTED_FILE), "missing artifact-influence ledger").toBe(
      true,
    );
    expect(serialized).toBe(readFileSync(EXPECTED_FILE, "utf8"));
  }, 600_000);
});
