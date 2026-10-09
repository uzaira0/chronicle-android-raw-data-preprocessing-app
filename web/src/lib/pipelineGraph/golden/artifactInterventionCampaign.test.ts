import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import filterCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?raw";
import forcingCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?raw";
import backgroundCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?raw";
import codebookCsv from "@/testSupport/fixtures/synthetic-catalog-app-codebook.csv?raw";
import { ALL_ON, GOLDEN_RUNTIME, order } from "@/testSupport/rustCampaignGraph";
import { buildRustV2Options } from "@/lib/rustPipelineRuntime";
import {
  buildArtifactFixtureState,
  buildArtifactInterventions,
  prepareArtifactFixtureForScientificExecution,
  isCapabilityEvidenceIntervention,
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

const plan = JSON.parse(readFileSync(PLAN_FILE, "utf8")) as ProductPlan;

/// Queries whose published output deliberately contains the raw artifact's byte
/// digest, so a representation-only edit moves them by design.
///
/// `construct_screen_intervals` publishes `applicability.input_digest` (from
/// `B05ApplicabilityInput::raw_input_sha256`), which
/// `validate_screen_construction_output` compares against the current input when
/// resuming a persisted screen construction - a fail-closed tamper check that a
/// saved result is not paired with a different data file.
/// `assemble_result_manifest` binds the raw artifact for the EYES
/// input-partition preflight on the same principle.
///
/// A CRLF rewrite, or an edit to a field the pipeline ignores, produces byte-
/// identical PARSED ROWS but genuinely different BYTES. Treating such an edit as
/// "no change" for a value whose entire purpose is byte identity asserts
/// something that was never true: it would only hold if the tamper check did not
/// exist. So these queries are exempted from the digest-convergence check, and
/// the scientific claim is asserted directly instead - no researcher-visible
/// output cell may move. That is the property the control actually cares about,
/// and it was previously recorded in the ledger but never asserted.
const RAW_BYTE_IDENTITY_PROVENANCE_QUERIES = [
  "construct_screen_intervals",
  "assemble_result_manifest",
];
/// This campaign filters capability-evidence interventions out
/// (`isCapabilityEvidenceIntervention`) and asserts below that the role stays
/// uncovered; the ledger's `separatelyCoveredSourceSensitiveRoles` records that
/// the configuration-space campaign's `sourceSensitiveScientificCells` domain
/// owns it instead. See `CONDITIONALLY_ACTIVE_ROOT_ROLE_IDS` in
/// `campaignManifest.ts` for why the role has no qualification trace here.
const unconditionalRoleIds = unconditionalRootRoleIds(plan.root_roles);
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
  // Count-neutral by design: a literal size here would have to be edited every
  // time a query is registered, and the previous form compared the length to
  // itself, so it could never fail. Assert the properties the campaign relies
  // on instead — a non-empty registry with unique, non-blank query ids.
  const queryIds = workflowContract.execution.queries.map(({ id }) => id);
  expect(queryIds.length, "empty workflow query registry").toBeGreaterThan(0);
  expect(new Set(queryIds).size, "duplicate workflow query ids").toBe(
    queryIds.length,
  );
  expect(
    queryIds.filter((id) => id.trim().length === 0),
    "blank workflow query id",
  ).toEqual([]);
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

function qualificationByRole(
  manifest: CampaignRuntimeManifest,
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

function requirementByRole(manifest: CampaignRuntimeManifest): Record<string, unknown> {
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

function semanticOutcome(manifest: CampaignRuntimeManifest): Record<string, unknown> {
  return {
    counts: manifest.counts,
    processingSummary: manifest.processingSummary,
    outputArtifacts: outputArtifactDigests(manifest),
  };
}

describe("artifact dependency tomography", () => {
  it("derives an exact warm/cold percolation ledger for raw and support artifacts", async () => {
    if (
      !Number.isSafeInteger(SHARD_COUNT) ||
      SHARD_COUNT < 1 ||
      SHARD_COUNT > SYNTHETIC_CORPUS_PROFILES.length ||
      !Number.isSafeInteger(SHARD_INDEX) ||
      SHARD_INDEX < 0 ||
      SHARD_INDEX >= SHARD_COUNT
    ) {
      throw new Error(`invalid artifact shard ${SHARD_INDEX}/${SHARD_COUNT}`);
    }
    expect(
      [...plan.query_groups.map(({ query_group_id }) => query_group_id)].sort(),
    ).toEqual([...order].sort());
    expect(
      SUPPORT_ROLE_IDS.filter(
        (roleId) =>
          !workflowContract.execution.queries.some((query) =>
            query.sourceRoles.includes(roleId),
          ),
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
    const coveredSourceRoles = new Set<InterventionRoleId>();
    const coveredSubstantiveSupportRoles = new Set<InterventionRoleId>();
    const coveredRepresentationRoles = new Set<InterventionRoleId>();
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
      }).filter(
        (intervention) =>
          !isCapabilityEvidenceIntervention(intervention) &&
          (!FILTER || intervention.id === FILTER),
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

        for (const manifest of [
          coldSource,
          coldTarget,
          warmSource,
          warmTarget,
        ]) {
          // Precondition for every execution-status observation below. Under
          // `conservative_full` the runtime replaces `state.incremental_engine`
          // with a fresh `IncrementalPipelineV2Engine` on EVERY request
          // (chronicle_preprocessing_runtime_wasm/src/lib.rs, the resets in
          // `scientific_preflight_native` and `execute_workspace`), so the
          // "warm" run reuses nothing and its status vector is identical to the
          // cold run's regardless of the intervention. Scored in that mode this
          // campaign reports a declared-vs-observed diff that is an artifact of
          // the stale certificate, not of the contract. This is an
          // unconditional expectation on purpose: silently emptying the
          // predicted set instead would leave the axis non-observing with no
          // signal that it had stopped measuring.
          expect(
            manifest.dependencyCacheDecision.mode,
            `${caseId}: warm reuse cannot be scored under ${manifest.dependencyCacheDecision.mode} (${manifest.dependencyCacheDecision.reasons.join(", ")}); run make dependency-evidence`,
          ).toBe("certified_narrow");
          expect(manifest.openObligations, `${caseId}: binding holes`).toEqual(
            [],
          );
          expect(
            manifest.qualificationTraces,
            `${caseId}: one qualification proof per supplied root role`,
          ).toHaveLength(unconditionalRoleIds.length);
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
          ).toEqual([...unconditionalRoleIds].sort());
          expect(
            manifest.requirementTraces,
            `${caseId}: one requirement proof per root role`,
          ).toHaveLength(plan.root_roles.length);
          // Requirement traces cover every plan root role, including the
          // conditionally active one the qualification pass skips. The runtime
          // reports that role `not_applicable` rather than omitting it, so the
          // check is stated per role: the ten unconditional roles must be
          // satisfied by the supplied fixture, and the conditional role must be
          // reported inactive rather than silently satisfied.
          expect(
            Object.fromEntries(
              manifest.requirementTraces.map(({ role_id, state }) => [
                role_id,
                state,
              ]),
            ),
            `${caseId}: supplied fixture left a role unsatisfied`,
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
            `${caseId}: query groups`,
          ).toHaveLength(workflowContract.execution.queryGroups.length);
          expect(
            manifest.queryExecutions,
            `${caseId}: Rust workflow queries`,
          ).toHaveLength(workflowContract.execution.queries.length);
          expect(
            manifest.queryExecutions.map(({ query_id }) => query_id).sort(),
          ).toEqual(
            workflowContract.execution.queries.map(({ id }) => id).sort(),
          );
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
          ).toEqual(
            plan.query_groups
              .map(({ query_group_id }) => query_group_id)
              .sort(),
          );
          for (const [queryGroupId, checkpoint] of Object.entries(
            manifest.processingSummary.workflowQueryGroupCheckpoints,
          )) {
            expect(checkpoint.protocolVersion).toBe(
              "chronicle-workflow-checkpoint/v1",
            );
            expect(checkpoint.subjectId).toBe(queryGroupId);
            expect(checkpoint.terminalDigest).toBe(
              manifest.processingSummary.workflowQueryGroupDigests[
                queryGroupId
              ],
            );
          }
          expect(
            Object.keys(
              manifest.processingSummary.workflowQueryCheckpoints,
            ).sort(),
            `${caseId}: complete query-registry checkpoint coverage`,
          ).toEqual(
            workflowContract.execution.queries.map(({ id }) => id).sort(),
          );
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
        const queryCheckpointComponentChanges =
          changedQueryCheckpointComponents(coldSource, coldTarget);
        expect(
          Object.keys(queryCheckpointComponentChanges).sort(),
          `${caseId}: query components and terminal commitments disagree`,
        ).toEqual(changedQueries);
        const changedOutputCellAddresses = changedCellAddresses(
          coldSource.outputCells,
          coldTarget.outputCells,
        );
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
          // THE SCIENTIFIC CLAIM, asserted directly for the first time: a
          // representation-only or ignored-field edit must not move a single
          // researcher-visible output value.
          expect(
            changedOutputCellAddresses,
            `${caseId}: representation/ignored-field control changed researcher-visible output`,
          ).toEqual([]);
          // Every query must converge EXCEPT those whose published output is
          // the raw byte digest itself - see
          // RAW_BYTE_IDENTITY_PROVENANCE_QUERIES. This stays an exact equality
          // against the remainder, so a new non-converging query still fails.
          expect(
            changedQueries.filter(
              (queryId) =>
                !RAW_BYTE_IDENTITY_PROVENANCE_QUERIES.includes(queryId),
            ),
            `${caseId}: representation/ignored-field control must converge`,
          ).toEqual([]);
          exactEquivalences += 1;
        }

        const actualExecutedQueries = executedQueryIds(warmTarget);
        const exactTargetOptions = buildRustV2Options(ALL_ON, GOLDEN_RUNTIME);
        const supportRepresentationOnly =
          intervention.roleId !== "raw_chronicle_csv" &&
          intervention.expectedSemanticEffect === "equivalent";
        // Salsa owns invalidation, so there is no per-arm prediction of which
        // queries run; `inputs` is a may-read set. What must hold is that
        // nothing ran WITHOUT a reason to — an execution with no changed
        // request field, no changed source role it binds, and no changed
        // upstream output is an undeclared read.
        const unjustifiedExecutedQueries = unjustifiedExecutions({
          contract: workflowContract,
          targetOptions: exactTargetOptions,
          sourceStatuses: queryStatuses(coldSource),
          targetStatuses: queryStatuses(coldTarget),
          changedSourceRoles: new Set([intervention.roleId]),
          changedQueryOutputs: new Set(changedQueries),
          executed: actualExecutedQueries,
        });
        expect(
          unjustifiedExecutedQueries,
          `${caseId}: query executed with no changed request field, source role, or upstream output`,
        ).toEqual([]);
        expect(
          cachedWithChangedOutput(warmSource, warmTarget),
          `${caseId}: query badged cached while publishing a changed output digest`,
        ).toEqual([]);
        if (supportRepresentationOnly) {
          // A DIRECT OBSERVATION, not a prediction. Support memo keys are
          // content-normalized, so a representation-only support edit — a CRLF
          // rewrite of the filter file, say — produces the identical memo key
          // for every query that binds that support. Nothing downstream can
          // therefore observe any change, and the warm target must execute
          // EXACTLY ZERO queries. `unjustifiedExecutions` above cannot see this
          // property, because the case passes the edited role in
          // `changedSourceRoles` unconditionally, which would justify any
          // execution. This assertion is what pins the normalization.
          expect(
            actualExecutedQueries, // === executedQueryIds(warmTarget)
            `${caseId}: representation-only support edit must execute no query`,
          ).toEqual([]);
        }
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
              sourceRoleIsActive(
                query,
                intervention.roleId,
                exactTargetOptions,
              ),
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
          // `unjustifiedExecutedQueries` is asserted empty above, so recording
          // it would write a constant `[]` into every case. The per-case
          // execution evidence is `actualExecutedQueries` — the OBSERVED set.
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
                (query) =>
                  query.group === nodeId && executedQuerySet.has(query.id),
              ),
          )
          .map(({ nodeId }) => nodeId);
        expect(
          recomputedWithoutExecution,
          `${caseId}: stage badged recomputed with no member query in the executed set`,
        ).toEqual([]);
        reports.push(report);
        coveredSourceRoles.add(intervention.roleId);
        if (
          intervention.roleId !== "raw_chronicle_csv" &&
          intervention.expectedSemanticEffect === "required"
        ) {
          coveredSubstantiveSupportRoles.add(intervention.roleId);
        }
        if (intervention.mutationClass === "representation-only") {
          coveredRepresentationRoles.add(intervention.roleId);
        }
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
      expect(
        coveredSourceRoles.has("input_capability_evidence_file"),
        "capability evidence belongs to the separate source-sensitive scientific campaign",
      ).toBe(false);
    }

    const exactCoveredRoles = [...coveredSourceRoles].sort();
    const exactSubstantiveSupportRoles = [
      ...coveredSubstantiveSupportRoles,
    ].sort();
    const exactRepresentationRoles = [...coveredRepresentationRoles].sort();
    for (const roleId of exactCoveredRoles) {
      expect(
        reports.some((report) => report.roleId === roleId),
        `coverage role ${roleId} needs an executed intervention report`,
      ).toBe(true);
    }

    const cellEvidenceSerialized = `${JSON.stringify(
      {
        protocolVersion: "chronicle-output-cell-correspondence/v2",
        implementationReceipt: receipt,
        claimBoundary:
          "Exact changed canonical CSV/JSON output cell addresses for each named raw/support intervention. Each case also names the exact supplied source columns that intervention rewrote (sourceFields), in the Rust workflow contract's field namespace, using source.raw_row_set / source.raw_row_order for structural raw changes and an empty list for representation-only controls. Binary exports and the Arrow lineage sidecar are digest-bound separately and are not interpreted as cells.",
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
        "Exact raw/support artifact percolation for the recorded product plan, implementation, deterministic synthetic corpora, and intervention catalog. Each listed coverage role has an executed report in this ledger. The conditionally active input_capability_evidence_file role is intentionally excluded here and covered by the sourceSensitiveScientificCells domain of the configuration-space campaign. Each intervention changes exactly one source artifact; every warm query and query-group checkpoint plus every researcher-visible output is compared with an independent cold Rust/WASM target. Absence of an effect is not generalized beyond the named mutation and corpus.",
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
        sourceRoles: exactCoveredRoles,
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
        supportSubstantiveMutations: exactSubstantiveSupportRoles,
        representationControls: exactRepresentationRoles,
        separatelyCoveredSourceSensitiveRoles: [
          "input_capability_evidence_file",
        ],
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
        workflowQueryCheckpointComparisons:
          reports.length * workflowContract.execution.queries.length,
        typedCheckpointDecompositionComparisons: reports.length,
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
    // The digest keeps the failure message small: this payload is ~11 MB.
    expect(
      await sha256Uri(
        gunzipSync(readFileSync(CELL_EVIDENCE_FILE)).toString("utf8"),
      ),
      "checked output-cell evidence sidecar differs; re-record with UPDATE_ARTIFACT_INFLUENCE=1",
    ).toEqual(cellEvidenceDigest);
    expect(existsSync(EXPECTED_FILE), "missing artifact-influence ledger").toBe(
      true,
    );
    expect(serialized).toBe(readFileSync(EXPECTED_FILE, "utf8"));
  }, CAMPAIGN_TEST_TIMEOUT_MS);
});
