import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import backgroundCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?raw";
import filterCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?raw";
import forcingCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?raw";
import codebookCsv from "@/testSupport/fixtures/synthetic-catalog-app-codebook.csv?raw";
import { ALL_ON, GOLDEN_RUNTIME, order } from "@/testSupport/rustCampaignGraph";
import { buildRustV2Options } from "@/lib/rustPipelineRuntime";
import {
  buildArtifactFixtureState,
  buildRawBoundaryInterventions,
  prepareArtifactFixtureForScientificExecution,
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
  unjustifiedExecutions,
  type RustWorkflowContract,
} from "@/testSupport/workflowContract";
import {
  authorityReceipt,
  cachedWithChangedOutput,
  changedCheckpointComponents,
  changedFields,
  changedQueryCheckpointComponents,
  CONDITIONALLY_ACTIVE_ROOT_ROLE_IDS,
  executedQueryIds,
  nodeOutputDigests,
  outputArtifactDigests,
  queryStatuses,
  unconditionalRootRoleIds,
  type CampaignRuntimeManifest,
  type ObservedRuntimeManifest,
} from "@/testSupport/campaignManifest";
import {
  captureCanonicalOutputCells,
  changedCellAddresses,
  changedCellScopesByArtifact,
} from "@/testSupport/outputCellTomography";
import {
  CAMPAIGN_RUNTIME_INIT_TIMEOUT_MS,
  dependencyCampaignRuntimeBytes,
  captureCampaignFootprint,
  CAMPAIGN_FOOTPRINT_CAPTURE_TIMEOUT_MS,
} from "@/testSupport/dependencyCampaignRuntime";
import {
  executeScientificCampaignWorkspace,
  putScientificCampaignSupportArtifact,
  requireExecutedScientificCampaign,
} from "@/testSupport/scientificCampaignExecution";
import * as runtime from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

// Footprint selection: record which production source files this campaign
// actually executed (no-op unless the evidence refresh sets the profraw dir).
afterAll(
  () => captureCampaignFootprint(runtime),
  CAMPAIGN_FOOTPRINT_CAPTURE_TIMEOUT_MS,
);
import { CAMPAIGN_TEST_TIMEOUT_MS } from "@/testSupport/campaignTimeout";

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

type PlanNode = {
  query_group_id: string;
  input_query_groups: string[];
};

type ProductPlan = {
  plan_id: string;
  revision: string;
  root_roles: Array<{ role_id: string }>;
  query_groups: PlanNode[];
};

const plan = JSON.parse(readFileSync(PLAN_FILE, "utf8")) as ProductPlan;
/// This campaign executes exclusively under `ALL_ON`, which keeps the default
/// non-source-sensitive strategies, so `input_capability_evidence_file` is
/// never a candidate here. See `CONDITIONALLY_ACTIVE_ROOT_ROLE_IDS` in
/// `campaignManifest.ts` for why the runtime still reports it — by
/// construction, as a `NotApplicable` requirement trace, not by omission.
const unconditionalRoleIds = unconditionalRootRoleIds(plan.root_roles);
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
}, CAMPAIGN_RUNTIME_INIT_TIMEOUT_MS);

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
  const executionState = prepareArtifactFixtureForScientificExecution(
    state,
    ALL_ON,
  );
  const csvBytes = encoder.encode(executionState.rawCsv);
  const supports = new runtime.RuntimeSupportFiles();
  const supportArtifacts = new Map<string, Uint8Array>();
  let handle: ReturnType<typeof runtime.execute_workspace> | undefined;
  try {
    for (const roleId of SUPPORT_ROLE_IDS) {
      const support = executionState.supports[roleId];
      const bytes = encoder.encode(support.csv);
      putScientificCampaignSupportArtifact({
        roleId,
        fileName: support.name,
        bytes,
        options: ALL_ON,
        supports,
        supportArtifacts,
      });
    }
    const requestJson = JSON.stringify({
      protocolVersion: "chronicle-preprocessing-runtime/v2",
      executionEngine: "incremental",
      provenanceEvidence: true,
      requestId,
      command: "ExecuteWorkspace",
      workspaceRootDigest: previousRoot,
      workspaceId: await sha256Uri(workspaceIdentity),
      inputFileName,
      inputSha256: await sha256Uri(csvBytes),
      options: buildRustV2Options(ALL_ON, GOLDEN_RUNTIME),
    });
    handle = requireExecutedScientificCampaign(
      executeScientificCampaignWorkspace({
        runtime,
        options: ALL_ON,
        requestJson,
        rawBytes: csvBytes,
        supports,
        supportArtifacts,
      }),
    ).handle;
    const manifest = JSON.parse(handle.manifest_json()) as CampaignRuntimeManifest;
    return Object.assign(manifest, {
      outputCells: captureCanonicalOutputCells(handle),
    });
  } finally {
    handle?.free();
    supports.free();
  }
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

function assertSameSemanticOutcome(
  actual: CampaignRuntimeManifest,
  expected: CampaignRuntimeManifest,
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

function assertCompleteSuccessfulManifest(
  manifest: CampaignRuntimeManifest,
  caseId: string,
): void {
  expect(manifest.openObligations, `${caseId}: binding holes`).toEqual([]);
  expect(
    manifest.qualificationTraces,
    `${caseId}: qualification coverage`,
  ).toHaveLength(unconditionalRoleIds.length);
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
    manifest.qualificationTraces
      .map(({ selected_role_id }) => selected_role_id)
      .sort(),
    `${caseId}: qualification did not cover the exact offered root-role vocabulary`,
  ).toEqual([...unconditionalRoleIds].sort());
  // Stated per role rather than as a blanket `every(satisfied)`: the ten
  // offered roles must be satisfied by the fixture, and the conditionally
  // active role must be reported inactive rather than silently satisfied or
  // silently dropped.
  expect(
    Object.fromEntries(
      manifest.requirementTraces.map(({ role_id, state }) => [role_id, state]),
    ),
    `${caseId}: unsatisfied role requirement`,
  ).toEqual({
    ...Object.fromEntries(
      unconditionalRoleIds.map((roleId) => [roleId, "satisfied"]),
    ),
    ...Object.fromEntries(
      CONDITIONALLY_ACTIVE_ROOT_ROLE_IDS.map((roleId) => [
        roleId,
        "not_applicable",
      ]),
    ),
  });
  expect(
    manifest.queryGroupExecutions,
    `${caseId}: logical execution coverage`,
  ).toHaveLength(order.length);
  expect(
    manifest.queryExecutions,
    `${caseId}: Rust query execution coverage`,
  ).toHaveLength(
    Object.keys(manifest.processingSummary.workflowQueryCheckpoints).length,
  );
  expect(
    manifest.queryGroupExecutions.every(
      ({ status }) => status !== "error" && status !== "skipped",
    ),
    `${caseId}: failed logical execution`,
  ).toBe(true);
  expect(
    manifest.queryExecutions.every(
      ({ status }) => status !== "error" && status !== "skipped",
    ),
    `${caseId}: failed Rust query execution`,
  ).toBe(true);
  expect(
    Object.keys(
      manifest.processingSummary.workflowQueryGroupCheckpoints,
    ).sort(),
  ).toEqual([...order].sort());
  expect(
    Object.keys(manifest.processingSummary.workflowQueryCheckpoints),
  ).toHaveLength(manifest.queryExecutions.length);
  expect(
    Object.keys(manifest.processingSummary.workflowQueryDigests).sort(),
  ).toEqual(
    Object.keys(manifest.processingSummary.workflowQueryCheckpoints).sort(),
  );
  expect(
    manifest.queryExecutions.map(({ query_id }) => query_id).sort(),
  ).toEqual(
    Object.keys(manifest.processingSummary.workflowQueryCheckpoints).sort(),
  );
  for (const [queryGroupId, checkpoint] of Object.entries(
    manifest.processingSummary.workflowQueryGroupCheckpoints,
  )) {
    expect(checkpoint.protocolVersion).toBe("chronicle-workflow-checkpoint/v1");
    expect(checkpoint.subjectId).toBe(queryGroupId);
    expect(checkpoint.terminalDigest).toBe(
      manifest.processingSummary.workflowQueryGroupDigests[queryGroupId],
    );
  }
  for (const [queryId, checkpoint] of Object.entries(
    manifest.processingSummary.workflowQueryCheckpoints,
  )) {
    expect(checkpoint.protocolVersion).toBe("chronicle-workflow-checkpoint/v1");
    expect(checkpoint.subjectId).toBe(queryId);
    expect(checkpoint.terminalDigest).toBe(
      manifest.processingSummary.workflowQueryDigests[queryId],
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
    expect(
      plan.query_groups.map(({ query_group_id }) => query_group_id).sort(),
    ).toEqual([...order].sort());
    const workflowContract = JSON.parse(
      runtime.workflow_contract_json(),
    ) as RustWorkflowContract;
    expect(workflowContract.protocolVersion).toBe(
      "chronicle-workflow-contract/v1",
    );
    // The previous form compared the registry length to itself and could
    // never fail. Assert the properties the campaign relies on instead --
    // a non-empty registry with unique, non-blank query ids.
    {
      const contractQueryIds = workflowContract.execution.queries.map(
        ({ id }) => id,
      );
      expect(contractQueryIds.length, "empty workflow query registry").toBeGreaterThan(0);
      expect(new Set(contractQueryIds).size, "duplicate workflow query ids").toBe(
        contractQueryIds.length,
      );
      expect(
        contractQueryIds.filter((id) => id.trim().length === 0),
        "blank workflow query id",
      ).toEqual([]);
    }

    const reports: Array<Record<string, unknown>> = [];
    const caseIdentities: string[] = [];
    const fixtureReceipts: Array<Record<string, unknown>> = [];
    const cellEvidenceCases: Array<{
      caseId: string;
      changedComponents: string[];
      sourceFields: string[];
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
          warmTarget.processingSummary.workflowQueryDigests,
          `${caseId}: every warm Rust query checkpoint needs a cold target`,
        ).toEqual(coldTarget.processingSummary.workflowQueryDigests);
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
          coldSource.processingSummary.workflowQueryGroupDigests,
          coldTarget.processingSummary.workflowQueryGroupDigests,
        );
        expect(
          changedSemanticNodes.length,
          `${caseId}: missing semantic witness; ${firstLineDifference(
            sourceState.rawCsv,
            targetState.rawCsv,
          )}`,
        ).toBeGreaterThan(0);
        const componentChanges = changedCheckpointComponents(
          coldSource,
          coldTarget,
        );
        expect(
          Object.keys(componentChanges).sort(),
          `${caseId}: component/terminal drift`,
        ).toEqual(changedSemanticNodes);
        const changedQueries = changedFields(
          coldSource.processingSummary.workflowQueryDigests,
          coldTarget.processingSummary.workflowQueryDigests,
        );
        const queryComponentChanges = changedQueryCheckpointComponents(
          coldSource,
          coldTarget,
        );
        expect(
          Object.keys(queryComponentChanges).sort(),
          `${caseId}: query component/terminal drift`,
        ).toEqual(changedQueries);

        const sourceParse =
          coldSource.processingSummary.workflowQueryGroupCheckpoints
            .parse_events;
        const targetParse =
          coldTarget.processingSummary.workflowQueryGroupCheckpoints
            .parse_events;
        if (sourceParse === undefined || targetParse === undefined) {
          throw new Error(`${caseId}: missing parse_events checkpoint`);
        }
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

        const actualExecutedQueries = executedQueryIds(warmTarget);
        const exactTargetOptions = buildRustV2Options(ALL_ON, GOLDEN_RUNTIME);
        const sourceStatuses = queryStatuses(coldSource);
        const targetStatuses = queryStatuses(coldTarget);
        // Salsa owns invalidation; `inputs` is a may-read set, so no per-arm
        // execution set is predicted. The dangerous direction is a query that
        // ran with nothing upstream of it having changed.
        const unjustifiedExecutedQueries = unjustifiedExecutions({
          contract: workflowContract,
          targetOptions: exactTargetOptions,
          sourceStatuses,
          targetStatuses,
          changedSourceRoles: new Set(["raw_chronicle_csv"]),
          changedQueryOutputs: new Set(changedQueries),
          executed: actualExecutedQueries,
        });
        expect(
          unjustifiedExecutedQueries,
          `${caseId}: query executed with no changed request field, source role, or upstream output`,
        ).toEqual([]);
        // A Salsa body produces a new value only by running, so `cached` while
        // the published output digest moved from the warm source is a
        // self-contradicting badge. Reads only observed digests and statuses.
        expect(
          cachedWithChangedOutput(warmSource, warmTarget),
          `${caseId}: query badged cached while publishing a changed output digest`,
        ).toEqual([]);
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
          `${caseId}: raw bytes cannot change applicability`,
        ).toEqual([]);
        expect(
          actualExecutedQueries,
          `${caseId}: raw CSV binder did not execute`,
        ).toContain("decode_source_records");

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
          changedComponents: intervention.changedComponents,
          changedSemanticNodes,
          checkpointComponentChanges: componentChanges,
          changedQueries: changedQueries,
          queryCheckpointComponentChanges: queryComponentChanges,
          // `unjustifiedExecutedQueries` is asserted empty above, so recording
          // it would write a constant `[]` into every case. The per-case
          // execution evidence is `actualExecutedQueries` — the OBSERVED set.
          actualExecutedQueries,
          deactivatedQueries,
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
          warmExecution: warmTarget.queryGroupExecutions
            .filter(({ status }) => status !== "cached")
            .map(({ query_group_id, status }) => ({
              nodeId: query_group_id,
              status,
            })),
        };
        reports.push(report);
        caseIdentities.push(JSON.stringify(report));
      }
    }

    const cellEvidenceSerialized = `${JSON.stringify(
      {
        protocolVersion: "chronicle-output-cell-correspondence/v2",
        implementationReceipt: authority,
        claimBoundary:
          "Exact changed canonical CSV/JSON output cell addresses for each named raw timestamp boundary intervention. Each case also names the exact supplied source columns that intervention rewrote (sourceFields), in the Rust workflow contract's field namespace, using source.raw_row_set / source.raw_row_order for structural raw changes and an empty list for representation-only controls. Binary exports and the Arrow lineage sidecar are digest-bound separately and are not interpreted as cells.",
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
      workflowCheckpointProtocol: "chronicle-workflow-checkpoint/v1",
      claimBoundary:
        "Exact raw timestamp percolation for every named boundary intervention across all checked synthetic corpus profiles. Each mutation changes one raw event timestamp; warm execution is checked against an independent cold oracle. The evidence does not generalize beyond the listed boundary catalog, corpora, plan, and implementation receipt.",
      plan: { id: plan.plan_id, revision: plan.revision },
      implementationReceipt: authority,
      cellEvidence: {
        protocolVersion: "chronicle-output-cell-correspondence/v2",
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
        typedComponentComparisons: reports.length,
        workflowQueryCheckpointComparisons:
          reports.length * workflowContract.execution.queries.length,
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
      // Only rewrite the sidecar when its CONTENT changed. `gzipSync` output
      // varies with the linked zlib version, so an unconditional write dirties
      // the checked bytes on a Node upgrade even when nothing was recomputed.
      const previousCellEvidence = existsSync(CELL_EVIDENCE_FILE)
        ? gunzipSync(readFileSync(CELL_EVIDENCE_FILE)).toString("utf8")
        : null;
      if (previousCellEvidence !== cellEvidenceSerialized) {
        writeFileSync(CELL_EVIDENCE_FILE, cellEvidenceCompressed);
      }
      writeFileSync(EXPECTED_FILE, serialized, "utf8");
      return;
    }
    expect(
      existsSync(CELL_EVIDENCE_FILE),
      "missing output-cell evidence sidecar",
    ).toBe(true);
    // Compare the sidecar's CONTENT, not its gzip bytes. `gzipSync` output
    // depends on the linked zlib version, so a Node upgrade alone rewrote the
    // compressed stream while the decompressed evidence stayed byte-identical.
    // The digest keeps the failure message small: this payload is ~35 MB.
    expect(
      await sha256Uri(
        gunzipSync(readFileSync(CELL_EVIDENCE_FILE)).toString("utf8"),
      ),
      "checked output-cell evidence sidecar differs; re-record with UPDATE_RAW_BOUNDARY_INFLUENCE=1",
    ).toEqual(cellEvidenceDigest);
    expect(
      existsSync(EXPECTED_FILE),
      "missing raw-boundary influence ledger",
    ).toBe(true);
    expect(serialized).toBe(readFileSync(EXPECTED_FILE, "utf8"));
  }, CAMPAIGN_TEST_TIMEOUT_MS);
});
