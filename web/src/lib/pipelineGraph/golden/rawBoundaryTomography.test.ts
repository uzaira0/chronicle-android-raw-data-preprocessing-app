import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import backgroundCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?raw";
import filterCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?raw";
import forcingCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?raw";
import codebookCsv from "@/assets/defaults/unified_app_codebook.csv?raw";
import { ALL_ON, GOLDEN_RUNTIME, order } from "@/testSupport/rustCampaignGraph";
import { buildRustV2Options } from "@/lib/rustPipelineRuntime";
import {
  buildArtifactFixtureState,
  buildRawBoundaryInterventions,
  SUPPORT_ROLE_IDS,
  type ArtifactFixtureState,
  type InterventionRoleId,
} from "@/testSupport/artifactInterventions";
import {
  buildSyntheticCatalog,
  generateSyntheticChronicleCorpus,
  SYNTHETIC_CORPUS_PROFILES,
} from "@/testSupport/syntheticChronicleCorpus";
import {
  sourceRoleIsActive,
  type RustStepContract,
} from "@/testSupport/rustStepContract";
import {
  captureCanonicalOutputCells,
  changedCellAddresses,
  changedCellScopesByArtifact,
} from "@/testSupport/outputCellTomography";
import { dependencyCampaignRuntimeBytes } from "@/testSupport/dependencyCampaignRuntime";
import * as runtime from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

const EXPECTED_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "family-expected",
  "raw-boundary-influence-ledger.json",
);
const CELL_EVIDENCE_FILE = join(
  dirname(EXPECTED_FILE),
  "raw-boundary-output-cell-correspondence.json.gz",
);
const PLAN_FILE = fileURLToPath(
  new URL(
    "../../../../../.semantic-federation/semantic/resources/chronicle.plan.json",
    import.meta.url,
  ),
);
const UPDATE = process.env.UPDATE_RAW_BOUNDARY_INFLUENCE === "1";
const FILTER = process.env.RAW_BOUNDARY_INTERVENTION;
const SHARD_COUNT = Number(process.env.RAW_BOUNDARY_SHARD_COUNT ?? "1");
const SHARD_INDEX = Number(process.env.RAW_BOUNDARY_SHARD_INDEX ?? "0");
const encoder = new TextEncoder();

type TypedCheckpoint = {
  protocolVersion: "chronicle-logical-stage-checkpoint/v3";
  nodeId: string;
  rowMembershipDigest: string;
  rowOrderDigest: string;
  temporalStateDigest: string;
  classificationDigest: string;
  payloadDigest: string;
  schemaDigest: string;
  terminalDigest: string;
};

type RuntimeManifest = {
  implementation: string;
  implementationDigest: string;
  planDigest: string;
  profileDigest: string;
  profileLockDigest: string;
  runtimeAuthorityDigest: string;
  productContractDigest: string;
  workspaceRootDigest: string;
  counts: Record<string, number>;
  openObligations: unknown[];
  qualificationTraces: Array<{
    selected_role_id: string | null;
    decision: "accepted" | "rejected" | "ambiguous";
    artifact_digest: string;
    rule_evaluations: Array<{ passed: boolean }>;
  }>;
  requirementTraces: Array<{
    role_id: string;
    state: string;
  }>;
  processingSummary: {
    logicalStageDigests: Record<string, string>;
    logicalStageCheckpoints: Record<string, TypedCheckpoint>;
    pipelineStepDigests: Record<string, string>;
    pipelineStepCheckpoints: Record<string, TypedCheckpoint>;
    [key: string]: unknown;
  };
  nodeExecutions: Array<{
    node_id: string;
    input_key: string;
    status: "cached" | "recomputed" | "error" | "skipped" | "bypassed";
    output: { digest: string } | null;
  }>;
  stepExecutions: Array<{
    step_id: string;
    unit_id: string;
    input_key: string;
    output_digest: string;
    status: "cached" | "recomputed" | "error" | "skipped" | "bypassed";
  }>;
  artifacts: Array<{ kind: string; digest: string }>;
};

type ObservedRuntimeManifest = RuntimeManifest & {
  outputCells: Record<string, string>;
};

type PlanNode = {
  node_id: string;
  input_nodes: string[];
};

type ProductPlan = {
  plan_id: string;
  revision: string;
  root_roles: Array<{ role_id: string }>;
  nodes: PlanNode[];
};

const plan = JSON.parse(readFileSync(PLAN_FILE, "utf8")) as ProductPlan;
const catalog = buildSyntheticCatalog({
  codebookCsv,
  filterCsv,
  backgroundCsv,
  forcingScreenOpenCsv: forcingCsv,
});
const interventions = buildRawBoundaryInterventions().filter(
  ({ id }) => !FILTER || id === FILTER,
);

beforeAll(() => {
  runtime.initSync({ module: dependencyCampaignRuntimeBytes() });
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
  const supports = await Promise.all(
    SUPPORT_ROLE_IDS.map(
      async (roleId) =>
        [roleId, await sha256Uri(state.supports[roleId].csv)] as const,
    ),
  );
  return Object.fromEntries([
    ["raw_chronicle_csv", await sha256Uri(state.rawCsv)],
    ...supports,
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

function firstLineDifference(left: string, right: string): string {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const index = leftLines.findIndex(
    (line, lineIndex) => line !== rightLines[lineIndex],
  );
  return index < 0
    ? "no line difference"
    : `line ${index + 1}: ${JSON.stringify(leftLines[index])} -> ${JSON.stringify(rightLines[index])}`;
}

function checkpointComponentChanges(
  source: RuntimeManifest,
  target: RuntimeManifest,
): Record<string, string[]> {
  return Object.fromEntries(
    order
      .map(
        (nodeId) =>
          [
            nodeId,
            changedFields(
              source.processingSummary.logicalStageCheckpoints[
                nodeId
              ] as unknown as Record<string, unknown>,
              target.processingSummary.logicalStageCheckpoints[
                nodeId
              ] as unknown as Record<string, unknown>,
            ).filter((field) => field !== "terminalDigest"),
          ] as const,
      )
      .filter(([, fields]) => fields.length > 0),
  );
}

function stepCheckpointComponentChanges(
  source: RuntimeManifest,
  target: RuntimeManifest,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.keys(source.processingSummary.pipelineStepCheckpoints)
      .sort()
      .map(
        (stepId) =>
          [
            stepId,
            changedFields(
              source.processingSummary.pipelineStepCheckpoints[
                stepId
              ] as unknown as Record<string, unknown>,
              target.processingSummary.pipelineStepCheckpoints[
                stepId
              ] as unknown as Record<string, unknown>,
            ).filter((field) => field !== "terminalDigest"),
          ] as const,
      )
      .filter(([, fields]) => fields.length > 0),
  );
}

function stepStatuses(manifest: RuntimeManifest): Record<string, string> {
  return Object.fromEntries(
    manifest.stepExecutions.map(({ step_id, status }) => [step_id, status]),
  );
}

function executedStepIds(manifest: RuntimeManifest): string[] {
  return manifest.stepExecutions
    .filter(({ status }) => status === "recomputed")
    .map(({ step_id }) => step_id)
    .sort();
}

function nodeOutputDigests(
  manifest: RuntimeManifest,
): Record<string, string | null> {
  return Object.fromEntries(
    manifest.nodeExecutions.map(({ node_id, output }) => [
      node_id,
      output?.digest ?? null,
    ]),
  );
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

function assertSameSemanticOutcome(
  actual: RuntimeManifest,
  expected: RuntimeManifest,
  caseId: string,
): void {
  expect(
    changedFields(actual.counts, expected.counts),
    `${caseId}: counts`,
  ).toEqual([]);
  expect(
    changedFields(actual.processingSummary, expected.processingSummary),
    `${caseId}: processing summary fields`,
  ).toEqual([]);
  expect(
    changedFields(
      outputArtifactDigests(actual),
      outputArtifactDigests(expected),
    ),
    `${caseId}: output artifacts`,
  ).toEqual([]);
}

function predictedRawExecutedSteps(
  stepContract: RustStepContract,
  changedSemanticSteps: ReadonlySet<string>,
  targetOptions: Record<string, unknown>,
  source: RuntimeManifest,
  target: RuntimeManifest,
): string[] {
  const sourceStatuses = stepStatuses(source);
  const targetStatuses = stepStatuses(target);
  return stepContract.steps
    .filter((step) => {
      const sourceApplicable = sourceStatuses[step.id] !== "bypassed";
      const targetApplicable = targetStatuses[step.id] !== "bypassed";
      return (
        targetApplicable &&
        (!sourceApplicable ||
          sourceRoleIsActive(step, "raw_chronicle_csv", targetOptions) ||
          step.inputs.some((input) => changedSemanticSteps.has(input)))
      );
    })
    .map(({ id }) => id)
    .sort();
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

function assertCompleteSuccessfulManifest(
  manifest: RuntimeManifest,
  caseId: string,
): void {
  expect(manifest.openObligations, `${caseId}: binding holes`).toEqual([]);
  expect(
    manifest.qualificationTraces,
    `${caseId}: qualification coverage`,
  ).toHaveLength(plan.root_roles.length);
  expect(
    manifest.qualificationTraces.every(
      (trace) =>
        trace.decision === "accepted" &&
        trace.selected_role_id !== null &&
        trace.rule_evaluations.every(({ passed }) => passed),
    ),
    `${caseId}: qualification did not fail closed`,
  ).toBe(true);
  expect(
    manifest.requirementTraces.every(({ state }) => state === "satisfied"),
    `${caseId}: unsatisfied role requirement`,
  ).toBe(true);
  expect(
    manifest.nodeExecutions,
    `${caseId}: logical execution coverage`,
  ).toHaveLength(15);
  expect(
    manifest.stepExecutions,
    `${caseId}: Rust step execution coverage`,
  ).toHaveLength(55);
  expect(
    manifest.nodeExecutions.every(
      ({ status }) => status !== "error" && status !== "skipped",
    ),
    `${caseId}: failed logical execution`,
  ).toBe(true);
  expect(
    manifest.stepExecutions.every(
      ({ status }) => status !== "error" && status !== "skipped",
    ),
    `${caseId}: failed Rust step execution`,
  ).toBe(true);
  expect(
    Object.keys(manifest.processingSummary.logicalStageCheckpoints).sort(),
  ).toEqual([...order].sort());
  expect(
    Object.keys(manifest.processingSummary.pipelineStepCheckpoints),
  ).toHaveLength(55);
  expect(
    Object.keys(manifest.processingSummary.pipelineStepDigests).sort(),
  ).toEqual(
    Object.keys(manifest.processingSummary.pipelineStepCheckpoints).sort(),
  );
  expect(manifest.stepExecutions.map(({ step_id }) => step_id).sort()).toEqual(
    Object.keys(manifest.processingSummary.pipelineStepCheckpoints).sort(),
  );
  for (const [nodeId, checkpoint] of Object.entries(
    manifest.processingSummary.logicalStageCheckpoints,
  )) {
    expect(checkpoint.protocolVersion).toBe(
      "chronicle-logical-stage-checkpoint/v3",
    );
    expect(checkpoint.nodeId).toBe(nodeId);
    expect(checkpoint.terminalDigest).toBe(
      manifest.processingSummary.logicalStageDigests[nodeId],
    );
  }
  for (const [stepId, checkpoint] of Object.entries(
    manifest.processingSummary.pipelineStepCheckpoints,
  )) {
    expect(checkpoint.protocolVersion).toBe(
      "chronicle-logical-stage-checkpoint/v3",
    );
    expect(checkpoint.nodeId).toBe(stepId);
    expect(checkpoint.terminalDigest).toBe(
      manifest.processingSummary.pipelineStepDigests[stepId],
    );
  }
}

describe("raw timestamp boundary tomography", () => {
  it("proves exact warm/cold percolation at threshold, calendar, and DST joints", async () => {
    if (
      !Number.isSafeInteger(SHARD_COUNT) ||
      SHARD_COUNT < 1 ||
      SHARD_COUNT > SYNTHETIC_CORPUS_PROFILES.length ||
      !Number.isSafeInteger(SHARD_INDEX) ||
      SHARD_INDEX < 0 ||
      SHARD_INDEX >= SHARD_COUNT
    ) {
      throw new Error(
        `invalid raw-boundary shard ${SHARD_INDEX}/${SHARD_COUNT}`,
      );
    }
    expect(
      interventions.length,
      "raw boundary filter matched nothing",
    ).toBeGreaterThan(0);
    expect(plan.nodes.map(({ node_id }) => node_id).sort()).toEqual(
      [...order].sort(),
    );
    const stepContract = JSON.parse(
      runtime.pipeline_step_contract_json(),
    ) as RustStepContract;
    expect(stepContract.protocolVersion).toBe(
      "chronicle-preprocessing-step-contract/v3",
    );
    expect(stepContract.steps).toHaveLength(55);

    const reports: Array<Record<string, unknown>> = [];
    const caseIdentities: string[] = [];
    const fixtureReceipts: Array<Record<string, unknown>> = [];
    const cellEvidenceCases: Array<{
      caseId: string;
      changedComponents: string[];
      changedOutputCellAddresses: string[];
    }> = [];
    let authority: Record<string, string> | undefined;

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
      const sourceDigests = await artifactDigests(sourceState);
      fixtureReceipts.push({
        corpusId: corpus.id,
        seed: corpus.seed,
        rowCount: corpus.rowCount,
        timezones: corpus.timezones,
        injectedFeatures: corpus.injectedFeatures,
        sourceArtifactDigests: sourceDigests,
      });

      for (const intervention of interventions) {
        const caseId = `${corpus.id}:${intervention.id}`;
        const targetState = intervention.apply(sourceState);
        const targetDigests = await artifactDigests(targetState);
        expect(changedFields(sourceDigests, targetDigests), caseId).toEqual([
          "raw_chronicle_csv",
        ]);

        const coldSource = await execute(
          sourceState,
          `${corpus.id}.csv`,
          `boundary:cold-source:${caseId}`,
          `${caseId}:cold-source`,
          null,
        );
        const coldTarget = await execute(
          targetState,
          `${corpus.id}.csv`,
          `boundary:cold-target:${caseId}`,
          `${caseId}:cold-target`,
          null,
        );
        const warmWorkspace = `boundary:warm:${caseId}`;
        const warmSource = await execute(
          sourceState,
          `${corpus.id}.csv`,
          warmWorkspace,
          `${caseId}:warm-source`,
          null,
        );
        const warmTarget = await execute(
          targetState,
          `${corpus.id}.csv`,
          warmWorkspace,
          `${caseId}:warm-target`,
          warmSource.workspaceRootDigest,
        );

        for (const manifest of [
          coldSource,
          coldTarget,
          warmSource,
          warmTarget,
        ]) {
          assertCompleteSuccessfulManifest(manifest, caseId);
          const receipt = authorityReceipt(manifest);
          if (!authority) authority = receipt;
          else expect(receipt, `${caseId}: authority drift`).toEqual(authority);
        }

        assertSameSemanticOutcome(
          warmSource,
          coldSource,
          `${caseId}: warm source oracle`,
        );
        expect(
          warmTarget.processingSummary.pipelineStepDigests,
          `${caseId}: every warm Rust step checkpoint needs a cold target`,
        ).toEqual(coldTarget.processingSummary.pipelineStepDigests);
        assertSameSemanticOutcome(
          warmTarget,
          coldTarget,
          `${caseId}: warm target oracle`,
        );
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
          `${caseId}: checkpoint cold oracle`,
        ).toEqual(nodeOutputDigests(coldTarget));
        const sourceQualification: Record<string, string> = Object.fromEntries(
          coldSource.qualificationTraces
            .filter(
              (trace): trace is typeof trace & { selected_role_id: string } =>
                trace.selected_role_id !== null,
            )
            .map(
              (trace) =>
                [trace.selected_role_id, trace.artifact_digest] as const,
            ),
        );
        const targetQualification: Record<string, string> = Object.fromEntries(
          coldTarget.qualificationTraces
            .filter(
              (trace): trace is typeof trace & { selected_role_id: string } =>
                trace.selected_role_id !== null,
            )
            .map(
              (trace) =>
                [trace.selected_role_id, trace.artifact_digest] as const,
            ),
        );
        expect(
          changedFields(sourceQualification, targetQualification),
          `${caseId}: exact artifact-to-role correspondence`,
        ).toEqual(["raw_chronicle_csv"]);

        const changedSemanticNodes = changedFields(
          coldSource.processingSummary.logicalStageDigests,
          coldTarget.processingSummary.logicalStageDigests,
        );
        expect(
          changedSemanticNodes.length,
          `${caseId}: missing semantic witness; ${firstLineDifference(
            sourceState.rawCsv,
            targetState.rawCsv,
          )}`,
        ).toBeGreaterThan(0);
        const componentChanges = checkpointComponentChanges(
          coldSource,
          coldTarget,
        );
        expect(
          Object.keys(componentChanges).sort(),
          `${caseId}: component/terminal drift`,
        ).toEqual(changedSemanticNodes);
        const changedSemanticSteps = changedFields(
          coldSource.processingSummary.pipelineStepDigests,
          coldTarget.processingSummary.pipelineStepDigests,
        );
        const stepComponentChanges = stepCheckpointComponentChanges(
          coldSource,
          coldTarget,
        );
        expect(
          Object.keys(stepComponentChanges).sort(),
          `${caseId}: step component/terminal drift`,
        ).toEqual(changedSemanticSteps);

        const sourceParse =
          coldSource.processingSummary.logicalStageCheckpoints.parse_events;
        const targetParse =
          coldTarget.processingSummary.logicalStageCheckpoints.parse_events;
        expect(
          targetParse.temporalStateDigest,
          `${caseId}: timestamp edit lacks temporal witness`,
        ).not.toBe(sourceParse.temporalStateDigest);
        expect(
          targetParse.rowMembershipDigest,
          `${caseId}: false membership effect`,
        ).toBe(sourceParse.rowMembershipDigest);
        expect(
          targetParse.classificationDigest,
          `${caseId}: false classification effect`,
        ).toBe(sourceParse.classificationDigest);
        expect(
          targetParse.payloadDigest,
          `${caseId}: false payload effect`,
        ).toBe(sourceParse.payloadDigest);
        expect(targetParse.schemaDigest, `${caseId}: false schema effect`).toBe(
          sourceParse.schemaDigest,
        );

        const actualExecutedSteps = executedStepIds(warmTarget);
        const exactTargetOptions = buildRustV2Options(ALL_ON, GOLDEN_RUNTIME);
        const predictedExecutedSteps = predictedRawExecutedSteps(
          stepContract,
          new Set(changedSemanticSteps),
          exactTargetOptions,
          coldSource,
          coldTarget,
        );
        expect(
          actualExecutedSteps,
          `${caseId}: raw dependency prediction and actual Salsa query bodies disagree`,
        ).toEqual(predictedExecutedSteps);
        const sourceStatuses = stepStatuses(coldSource);
        const targetStatuses = stepStatuses(coldTarget);
        const deactivatedSteps = stepContract.steps
          .filter(
            ({ id }) =>
              sourceStatuses[id] !== "bypassed" &&
              targetStatuses[id] === "bypassed",
          )
          .map(({ id }) => id)
          .sort();
        expect(
          deactivatedSteps,
          `${caseId}: raw bytes cannot change applicability`,
        ).toEqual([]);
        expect(
          actualExecutedSteps,
          `${caseId}: raw CSV binder did not execute`,
        ).toContain("csv_parse");

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
          changedComponents: intervention.changedComponents,
          changedSemanticNodes,
          checkpointComponentChanges: componentChanges,
          changedPipelineSteps: changedSemanticSteps,
          stepCheckpointComponentChanges: stepComponentChanges,
          predictedExecutedSteps,
          actualExecutedSteps,
          deactivatedSteps,
          changedOutputArtifactKinds: changedFields(
            outputArtifactDigests(coldSource),
            outputArtifactDigests(coldTarget),
          ),
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
          warmExecution: warmTarget.nodeExecutions
            .filter(({ status }) => status !== "cached")
            .map(({ node_id, status }) => ({ nodeId: node_id, status })),
        };
        reports.push(report);
        caseIdentities.push(JSON.stringify(report));
      }
    }

    const cellEvidenceSerialized = `${JSON.stringify(
      {
        protocolVersion: "chronicle-output-cell-correspondence/v1",
        implementationReceipt: authority,
        claimBoundary:
          "Exact changed canonical CSV/JSON output cell addresses for each named raw timestamp boundary intervention. Binary exports and the Arrow lineage sidecar are digest-bound separately and are not interpreted as cells.",
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
      protocolVersion: "chronicle-raw-boundary-influence-ledger/v1",
      logicalCheckpointProtocol: "chronicle-logical-stage-checkpoint/v3",
      claimBoundary:
        "Exact raw timestamp percolation for every named boundary intervention across all checked synthetic corpus profiles. Each mutation changes one raw event timestamp; warm execution is checked against an independent cold oracle. The evidence does not generalize beyond the listed boundary catalog, corpora, plan, and implementation receipt.",
      plan: { id: plan.plan_id, revision: plan.revision },
      implementationReceipt: authority,
      cellEvidence: {
        protocolVersion: "chronicle-output-cell-correspondence/v1",
        path: "raw-boundary-output-cell-correspondence.json.gz",
        contentDigest: cellEvidenceDigest,
        cases: cellEvidenceCases.length,
        changedCellAddresses: cellEvidenceCases.reduce(
          (total, entry) => total + entry.changedOutputCellAddresses.length,
          0,
        ),
      },
      coverage: {
        corpora: SYNTHETIC_CORPUS_PROFILES.map(({ id }) => id),
        adjacentGapSeconds: interventions
          .filter(({ id }) => id.startsWith("raw-boundary:adjacent-gap:"))
          .map(({ id }) => Number(id.match(/:(\d+)s$/)?.[1])),
        calendarJoints: interventions
          .filter(({ id }) => id.startsWith("raw-boundary:calendar:"))
          .map(({ id }) => id.replace("raw-boundary:calendar:", "")),
      },
      fixtureReceipts,
      executionCounts: {
        interventions: reports.length,
        coldExecutions: reports.length * 2,
        incrementalExecutions: reports.length * 2,
        totalRustExecutions: reports.length * 4,
        exactWarmColdComparisons: reports.length,
        exactClusterComparisons: reports.length,
        typedComponentComparisons: reports.length,
        pipelineStepCheckpointComparisons: reports.length * 55,
        exactStepClusterComparisons: reports.length,
        exactQualificationCorrespondenceComparisons: reports.length,
        exactOutputCellComparisons: reports.length * 2,
      },
      interventions: reports,
      caseSetDigest: await sha256Uri(caseIdentities.sort().join("\n")),
    };
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    const shardOutput = process.env.RAW_BOUNDARY_SHARD_OUTPUT;
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
    expect(
      existsSync(EXPECTED_FILE),
      "missing raw-boundary influence ledger",
    ).toBe(true);
    expect(serialized).toBe(readFileSync(EXPECTED_FILE, "utf8"));
  }, 600_000);
});
