import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import filterCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?raw";
import forcingCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?raw";
import backgroundCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?raw";
import codebookCsv from "@/assets/defaults/unified_app_codebook.csv?raw";
import { GOLDEN_RUNTIME } from "@/lib/pipelineGraph/golden/goldenScenario";
import { ALL_ON, order } from "@/lib/pipelineGraph/validationHarness";
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
const encoder = new TextEncoder();

type PlanNode = {
  node_id: string;
  input_nodes: string[];
  support_roles: string[];
};

type ProductPlan = {
  plan_id: string;
  revision: string;
  root_roles: Array<{ role_id: string }>;
  nodes: PlanNode[];
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
    state: "open" | "ready" | "satisfied" | "blocked" | "invalid" | "not_applicable";
  }>;
  openObligations: Array<{ role_id?: string; roleId?: string }>;
  counts: Record<string, number>;
  processingSummary: {
    logicalStageDigests: Record<string, string>;
    logicalStageCheckpoints: Record<
      string,
      {
        protocolVersion: "chronicle-logical-stage-checkpoint/v2";
        nodeId: string;
        rowMembershipDigest: string;
        rowOrderDigest: string;
        temporalStateDigest: string;
        classificationDigest: string;
        payloadDigest: string;
        schemaDigest: string;
        terminalDigest: string;
      }
    >;
    publishedOutputsDigest: string;
    provenanceDigest: string;
    [key: string]: unknown;
  };
  nodeExecutions: Array<{
    node_id: string;
    input_key: string;
    output: { digest: string } | null;
    status: "cached" | "recomputed" | "error" | "skipped" | "bypassed";
  }>;
  artifacts: Array<{ kind: string; digest: string; size: number }>;
};

type ObservedRuntimeManifest = RuntimeManifest & {
  outputCells: Record<string, string>;
};

const plan = JSON.parse(readFileSync(PLAN_FILE, "utf8")) as ProductPlan;
const planByNode = new Map(plan.nodes.map((node) => [node.node_id, node]));
const catalog = buildSyntheticCatalog({
  codebookCsv,
  filterCsv,
  backgroundCsv,
  forcingScreenOpenCsv: forcingCsv,
});

beforeAll(() => {
  const wasmBytes = readFileSync(
    new URL(
      "../../../wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm",
      import.meta.url,
    ),
  );
  runtime.initSync({ module: wasmBytes });
});

async function sha256Uri(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

async function artifactDigests(
  state: ArtifactFixtureState,
): Promise<Record<InterventionRoleId, string>> {
  const supportDigests = await Promise.all(
    SUPPORT_ROLE_IDS.map(
      async (roleId) => [roleId, await sha256Uri(state.supports[roleId].csv)] as const,
    ),
  );
  return Object.fromEntries(
    [
      ["raw_chronicle_csv", await sha256Uri(state.rawCsv)] as const,
      ...supportDigests,
    ],
  ) as Record<InterventionRoleId, string>;
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

function nodeInputKeys(manifest: RuntimeManifest): Record<string, string> {
  return Object.fromEntries(
    manifest.nodeExecutions.map((execution) => [execution.node_id, execution.input_key]),
  );
}

function nodeOutputDigests(manifest: RuntimeManifest): Record<string, string | null> {
  return Object.fromEntries(
    manifest.nodeExecutions.map((execution) => [
      execution.node_id,
      execution.output?.digest ?? null,
    ]),
  );
}

function nodeStatuses(manifest: RuntimeManifest): Record<string, string> {
  return Object.fromEntries(
    manifest.nodeExecutions.map((execution) => [execution.node_id, execution.status]),
  );
}

function qualificationByRole(manifest: RuntimeManifest): Record<string, unknown> {
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

function predictedPercolationCluster(
  roleId: InterventionRoleId,
  changedSemanticNodes: ReadonlySet<string>,
): string[] {
  const result = new Set<string>();
  for (const nodeId of order) {
    const node = planByNode.get(nodeId)!;
    const directlyPerturbed =
      (roleId === "raw_chronicle_csv" && nodeId === "parse_events") ||
      node.support_roles.includes(roleId);
    const reachedThroughChangedState = node.input_nodes.some((input) =>
      changedSemanticNodes.has(input),
    );
    if (directlyPerturbed || reachedThroughChangedState) result.add(nodeId);
  }
  return [...result].sort();
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
]);

function outputArtifactDigests(manifest: RuntimeManifest): Record<string, string> {
  return Object.fromEntries(
    manifest.artifacts
      .filter(
        ({ kind }) => OUTPUT_ARTIFACT_KINDS.has(kind) || kind.startsWith("aggregate-"),
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
    Object.keys(source.processingSummary.logicalStageCheckpoints)
      .sort()
      .map((nodeId) => [
        nodeId,
        changedFields(
          source.processingSummary.logicalStageCheckpoints[nodeId] as unknown as Record<
            string,
            unknown
          >,
          target.processingSummary.logicalStageCheckpoints[nodeId] as unknown as Record<
            string,
            unknown
          >,
        ).filter((field) => field !== "terminalDigest"),
      ] as const)
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
    expect([...plan.nodes.map(({ node_id }) => node_id)].sort()).toEqual([...order].sort());
    expect(
      SUPPORT_ROLE_IDS.filter(
        (roleId) => !plan.nodes.some((node) => node.support_roles.includes(roleId)),
      ),
      "every support role needs an owning logical node",
    ).toEqual([]);

    const reports: Array<Record<string, unknown>> = [];
    const caseIdentities: string[] = [];
    const fixtureReceipts: Array<Record<string, unknown>> = [];
    const cellEvidenceCases: Array<{
      caseId: string;
      changedComponents: string[];
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

    for (const profile of SYNTHETIC_CORPUS_PROFILES) {
      const corpus = generateSyntheticChronicleCorpus(profile, catalog);
      const sourceState = buildArtifactFixtureState({
        corpus,
        catalog,
        filterCsv,
        forcingCsv,
        backgroundCsv,
      });
      const interventions = buildArtifactInterventions({ corpus, catalog }).filter(
        ({ id }) => !FILTER || id === FILTER,
      );
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

      for (const manifest of [coldSource, coldTarget, warmSource, warmTarget]) {
        expect(manifest.openObligations, `${caseId}: binding holes`).toEqual([]);
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
          manifest.requirementTraces.every(({ state }) => state === "satisfied"),
          `${caseId}: supplied fixture left a role unsatisfied`,
        ).toBe(true);
        expect(manifest.nodeExecutions, `${caseId}: logical stages`).toHaveLength(15);
        expect(
          Object.keys(manifest.processingSummary.logicalStageCheckpoints).sort(),
          `${caseId}: typed checkpoint coverage`,
        ).toEqual(plan.nodes.map(({ node_id }) => node_id).sort());
        for (const [nodeId, checkpoint] of Object.entries(
          manifest.processingSummary.logicalStageCheckpoints,
        )) {
          expect(checkpoint.protocolVersion).toBe(
            "chronicle-logical-stage-checkpoint/v2",
          );
          expect(checkpoint.nodeId).toBe(nodeId);
          expect(checkpoint.terminalDigest).toBe(
            manifest.processingSummary.logicalStageDigests[nodeId],
          );
        }
        expect(
          manifest.nodeExecutions.every(
            ({ status }) => status !== "error" && status !== "skipped",
          ),
          `${caseId}: failed logical execution`,
        ).toBe(true);
        const currentReceipt = authorityReceipt(manifest);
        if (!receipt) receipt = currentReceipt;
        else expect(currentReceipt, `${caseId}: authority drift`).toEqual(receipt);
      }

      expect(semanticOutcome(warmSource), `${caseId}: warm source oracle`).toEqual(
        semanticOutcome(coldSource),
      );
      expect(semanticOutcome(warmTarget), `${caseId}: warm target oracle`).toEqual(
        semanticOutcome(coldTarget),
      );
      expect(warmSource.outputCells, `${caseId}: warm source cell oracle`).toEqual(
        coldSource.outputCells,
      );
      expect(warmTarget.outputCells, `${caseId}: warm target cell oracle`).toEqual(
        coldTarget.outputCells,
      );
      expect(
        nodeOutputDigests(warmTarget),
        `${caseId}: every warm logical checkpoint needs a cold target`,
      ).toEqual(nodeOutputDigests(coldTarget));
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
        coldSource.processingSummary.logicalStageDigests,
        coldTarget.processingSummary.logicalStageDigests,
      );
      const checkpointComponentChanges = changedCheckpointComponents(
        coldSource,
        coldTarget,
      );
      expect(
        Object.keys(checkpointComponentChanges).sort(),
        `${caseId}: typed components and terminal commitments disagree`,
      ).toEqual(changedSemanticNodes);
      if (intervention.expectedSemanticEffect === "required") {
        requiredInterventionIds.add(intervention.id);
        const contexts = activationContexts.get(intervention.id) ?? {
          active: new Set<string>(),
          converged: new Set<string>(),
        };
        if (changedSemanticNodes.length > 0) {
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
          changedSemanticNodes,
          `${caseId}: representation/ignored-field control must converge`,
        ).toEqual([]);
        exactEquivalences += 1;
      }

      const observedInputKeyNodes = changedFields(
        nodeInputKeys(warmSource),
        nodeInputKeys(warmTarget),
      );
      const predictedInputKeyNodes = predictedPercolationCluster(
        intervention.roleId,
        new Set(changedSemanticNodes),
      );
      expect(
        observedInputKeyNodes,
        `${caseId}: declared and empirical percolation must agree exactly`,
      ).toEqual(predictedInputKeyNodes);

      const directBinders = plan.nodes
        .filter(
          (node) =>
            (intervention.roleId === "raw_chronicle_csv" &&
              node.node_id === "parse_events") ||
            node.support_roles.includes(intervention.roleId),
        )
        .map(({ node_id }) => node_id)
        .sort();
      for (const binder of directBinders) {
        expect(observedInputKeyNodes, `${caseId}: missing direct binder`).toContain(
          binder,
        );
        expect(
          nodeStatuses(warmTarget)[binder],
          `${caseId}: direct binder was falsely cached`,
        ).not.toBe("cached");
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
        observedSemanticEffect: changedSemanticNodes.length > 0,
        directBinders,
        changedQualificationRoles,
        changedRequirementRoles,
        changedSemanticNodes,
        checkpointComponentChanges,
        predictedInputKeyNodes,
        observedInputKeyNodes,
        changedOutputArtifactKinds,
        changedOutputCellCount: changedOutputCellAddresses.length,
        changedOutputCellAddressDigest: await sha256Uri(
          changedOutputCellAddresses.join("\n"),
        ),
        changedOutputCellScopesByArtifact: changedCellScopesByArtifact(
          changedOutputCellAddresses,
        ),
        changedCountFields: changedFields(coldSource.counts, coldTarget.counts),
        changedProcessingSummaryFields: changedFields(
          coldSource.processingSummary,
          coldTarget.processingSummary,
        ),
        warmExecution: warmTarget.nodeExecutions
          .filter(({ status }) => status !== "cached")
          .map(({ node_id, status }) => ({ nodeId: node_id, status })),
      };
      reports.push(report);
      caseIdentities.push(JSON.stringify(report));
      }
    }

    const missingRequiredWitnesses = [...requiredInterventionIds].filter(
      (interventionId) => !semanticWitnessesByIntervention.has(interventionId),
    );
    expect(
      missingRequiredWitnesses,
      "every substantive intervention needs at least one branch-activating corpus witness",
    ).toEqual([]);

    const cellEvidenceSerialized = `${JSON.stringify(
      {
        protocolVersion: "chronicle-output-cell-correspondence/v1",
        implementationReceipt: receipt,
        claimBoundary:
          "Exact changed canonical CSV/JSON output cell addresses for each named raw/support intervention. Binary exports and the Arrow lineage sidecar are digest-bound separately and are not interpreted as cells.",
        cases: cellEvidenceCases.sort((left, right) =>
          left.caseId.localeCompare(right.caseId),
        ),
      },
      null,
      2,
    )}\n`;
    const cellEvidenceCompressed = gzipSync(cellEvidenceSerialized, { level: 9 });
    const cellEvidenceDigest = await sha256Uri(cellEvidenceSerialized);

    const evidence = {
      protocolVersion: "chronicle-artifact-influence-ledger/v1",
      logicalCheckpointProtocol: "chronicle-logical-stage-checkpoint/v2",
      claimBoundary:
        "Exact raw/support artifact percolation for the recorded product plan, implementation, six deterministic synthetic corpora, and intervention catalog. Each intervention changes exactly one source artifact; every warm logical checkpoint and researcher-visible output is compared with an independent cold target. Absence of an effect is not generalized beyond the named mutation and corpus.",
      plan: { id: plan.plan_id, revision: plan.revision },
      implementationReceipt: receipt,
      cellEvidence: {
        protocolVersion: "chronicle-output-cell-correspondence/v1",
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
        logicalCheckpointComparisons: reports.length,
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
    if (UPDATE) {
      mkdirSync(dirname(EXPECTED_FILE), { recursive: true });
      writeFileSync(CELL_EVIDENCE_FILE, cellEvidenceCompressed);
      writeFileSync(EXPECTED_FILE, serialized, "utf8");
      return;
    }
    expect(existsSync(CELL_EVIDENCE_FILE), "missing output-cell evidence sidecar").toBe(
      true,
    );
    expect(cellEvidenceCompressed).toEqual(readFileSync(CELL_EVIDENCE_FILE));
    expect(existsSync(EXPECTED_FILE), "missing artifact-influence ledger").toBe(true);
    expect(serialized).toBe(readFileSync(EXPECTED_FILE, "utf8"));
  }, 600_000);
});
