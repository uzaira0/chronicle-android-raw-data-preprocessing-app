import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import filterCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?raw";
import forcingCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?raw";
import backgroundCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?raw";
import codebookCsv from "@/testSupport/fixtures/synthetic-catalog-app-codebook.csv?raw";
import { COMPUTATIONAL_BROWSER_OPTION_KEYS } from "@/lib/generatedContract";
import { ALL_ON, GOLDEN_RUNTIME, order, validConfiguration, withValue } from "@/testSupport/rustCampaignGraph";
import {
  buildRustV2Options,
  decodeMaximumDurationPreflightDecision,
  decodeOpenerSetPreflightDecision,
  type MaximumDurationPreflightDecision,
  type OpenerSetPreflightDecision,
} from "@/lib/rustPipelineRuntime";
import type { BrowserProcessingOptions } from "@/lib/types";
import {
  buildArtifactFixtureState,
  prepareArtifactFixtureForScientificExecution,
  SUPPORT_ROLE_IDS,
} from "@/testSupport/artifactInterventions";
import { configurationEquivalenceClasses } from "@/testSupport/configurationEquivalenceClasses";
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
import {
  buildSyntheticCatalog,
  generateSyntheticChronicleCorpus,
  SYNTHETIC_CORPUS_PROFILES,
} from "@/testSupport/syntheticChronicleCorpus";
import * as runtime from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

// Footprint selection: record which production source files this campaign
// actually executed (no-op unless the evidence refresh sets the profraw dir).
afterAll(
  () => captureCampaignFootprint(runtime),
  CAMPAIGN_FOOTPRINT_CAPTURE_TIMEOUT_MS,
);
import {
  unjustifiedExecutions,
  type RustWorkflowContract,
} from "@/testSupport/workflowContract";
import {
  authorityReceipt,
  cachedWithChangedOutput,
  changedFields,
  changedQueryCheckpointComponents,
  checkpointComponentSet,
  executedQueryIds,
  nodeOutputDigests,
  isOutputArtifactKind,
  outputArtifactDigests,
  queryOutputDigests,
  queryStatuses,
  type CampaignRuntimeManifest,
} from "@/testSupport/campaignManifest";
import { CAMPAIGN_TEST_TIMEOUT_MS } from "@/testSupport/campaignTimeout";
import {
  canonicalOutputCells,
  changedCanonicalArtifactBytes,
  changedCellAddresses,
  isCanonicalOutputKind,
  sortCanonicalOutputCells,
} from "@/testSupport/outputCellTomography";

const EXPECTED_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "family-expected",
  "interaction-influence-ledger.json",
);
const PLAN_FILE = fileURLToPath(
  new URL(
    "../../../../../.semantic-federation/semantic/resources/chronicle.plan.json",
    import.meta.url,
  ),
);
const UPDATE = process.env.UPDATE_INTERACTION_INFLUENCE === "1";
const SHARD_COUNT = Number(process.env.INTERACTION_SHARD_COUNT ?? "1");
const SHARD_INDEX = Number(process.env.INTERACTION_SHARD_INDEX ?? "0");
const SHARD_OUTPUT = process.env.INTERACTION_SHARD_OUTPUT;
if (
  !Number.isInteger(SHARD_COUNT) ||
  SHARD_COUNT < 1 ||
  !Number.isInteger(SHARD_INDEX) ||
  SHARD_INDEX < 0 ||
  SHARD_INDEX >= SHARD_COUNT
) {
  throw new Error(
    "INTERACTION_SHARD_COUNT must be positive and INTERACTION_SHARD_INDEX must select one shard",
  );
}
if (SHARD_COUNT > 1 && !SHARD_OUTPUT) {
  throw new Error(
    "INTERACTION_SHARD_OUTPUT is required for a sharded campaign",
  );
}
const encoder = new TextEncoder();

const plan = JSON.parse(readFileSync(PLAN_FILE, "utf8")) as {
  plan_id: string;
  revision: string;
};
const catalog = buildSyntheticCatalog({
  codebookCsv,
  filterCsv,
  backgroundCsv,
  forcingScreenOpenCsv: forcingCsv,
});
const corpus = generateSyntheticChronicleCorpus(
  SYNTHETIC_CORPUS_PROFILES.find(
    ({ id }) => id === "configuration-influence-probes",
  )!,
  catalog,
);
const fixture = buildArtifactFixtureState({
  corpus,
  catalog,
  filterCsv,
  forcingCsv,
  backgroundCsv,
});

beforeAll(() => {
  runtime.initSync({ module: dependencyCampaignRuntimeBytes() });
}, CAMPAIGN_RUNTIME_INIT_TIMEOUT_MS);

async function sha256Uri(value: Uint8Array | string): Promise<string> {
  const bytes =
    typeof value === "string" ? encoder.encode(value) : Uint8Array.from(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

type AxisValue = { label: string; value: unknown };
/// Configuration-only typed refusals come from two axes: the opener set
/// (B02, `eyes_requires_lifecycle_triplets`) and the maximum-duration policy
/// (B06, `chronicle_observed_close_rejection_v1` outside the fused matcher).
type TypedRefusalApplicability =
  | { axis: "opener_set"; applicability: OpenerSetPreflightDecision }
  | {
      axis: "maximum_duration";
      applicability: MaximumDurationPreflightDecision;
    };
type SingleRefusalReceipt = {
  valueId: string;
  browserKeys: [string];
  values: Record<string, AxisValue>;
} & TypedRefusalApplicability;
type PairRefusalReceipt = {
  pairId: string;
  browserKeys: [string, string];
  values: Record<string, AxisValue>;
} & TypedRefusalApplicability;

function alternatesFor(key: string): AxisValue[] {
  const current = (ALL_ON as unknown as Record<string, unknown>)[key];
  return configurationEquivalenceClasses(key).filter(
    ({ value }) => JSON.stringify(value) !== JSON.stringify(current),
  );
}

function valueId(key: string, value: AxisValue): string {
  return `${key}=${value.label}`;
}

async function runtimeRequestJson(
  options: BrowserProcessingOptions,
  workspaceIdLabel: string,
  requestLabel: string,
  previousRoot: string | null,
): Promise<string> {
  const rawBytes = encoder.encode(fixture.rawCsv);
  return JSON.stringify({
    protocolVersion: "chronicle-preprocessing-runtime/v2",
    executionEngine: "incremental",
    provenanceEvidence: true,
    requestId: requestLabel,
    command: "ExecuteWorkspace",
    workspaceRootDigest: previousRoot,
    workspaceId: await sha256Uri(`interaction:${workspaceIdLabel}`),
    inputFileName: `${corpus.id}.csv`,
    inputSha256: await sha256Uri(rawBytes),
    options: buildRustV2Options(options, GOLDEN_RUNTIME),
  });
}

async function openerSetApplicability(
  options: BrowserProcessingOptions,
  workspaceIdLabel: string,
  requestLabel: string,
  previousRoot: string | null,
): Promise<OpenerSetPreflightDecision> {
  const requestJson = await runtimeRequestJson(
    options,
    workspaceIdLabel,
    requestLabel,
    previousRoot,
  );
  return decodeOpenerSetPreflightDecision(
    JSON.parse(runtime.opener_set_applicability_json(requestJson)),
  );
}

/// Configuration-only preflight in product order: opener set first, then the
/// maximum-duration policy. Returns null when both admit the request.
async function typedRefusal(
  options: BrowserProcessingOptions,
  workspaceIdLabel: string,
  requestLabel: string,
  previousRoot: string | null,
): Promise<TypedRefusalApplicability | null> {
  const opener = await openerSetApplicability(
    options,
    workspaceIdLabel,
    requestLabel,
    previousRoot,
  );
  if (opener.status === "refused") {
    return { axis: "opener_set", applicability: opener };
  }
  const requestJson = await runtimeRequestJson(
    options,
    workspaceIdLabel,
    requestLabel,
    previousRoot,
  );
  const maximumDuration = decodeMaximumDurationPreflightDecision(
    JSON.parse(runtime.maximum_duration_applicability_json(requestJson)),
  );
  if (maximumDuration.status === "refused") {
    return { axis: "maximum_duration", applicability: maximumDuration };
  }
  return null;
}

type CapturedRun = {
  manifest: CampaignRuntimeManifest;
  /** Canonical output cells and their raw payloads, present only when asked
   * for. `take_artifact_bytes` empties the slot, so both come off one pass. */
  cells: Record<string, string>;
  bytes: Map<string, Uint8Array>;
};

async function execute(
  options: BrowserProcessingOptions,
  workspaceIdLabel: string,
  requestLabel: string,
  previousRoot: string | null,
): Promise<CampaignRuntimeManifest> {
  try {
    return (
      await executeCapturing(options, workspaceIdLabel, requestLabel, previousRoot)
    ).manifest;
  } catch (cause) {
    throw new Error(`${workspaceIdLabel}/${requestLabel}: execution failed`, {
      cause,
    });
  }
}

async function executeCapturing(
  options: BrowserProcessingOptions,
  workspaceIdLabel: string,
  requestLabel: string,
  previousRoot: string | null,
  captureOutputs = false,
): Promise<CapturedRun> {
  const executionState = prepareArtifactFixtureForScientificExecution(
    fixture,
    options,
  );
  const rawBytes = encoder.encode(executionState.rawCsv);
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
        options,
        supports,
        supportArtifacts,
      });
    }
    const requestJson = await runtimeRequestJson(
      options,
      workspaceIdLabel,
      requestLabel,
      previousRoot,
    );
    handle = requireExecutedScientificCampaign(
      executeScientificCampaignWorkspace({
        runtime,
        options,
        requestJson,
        rawBytes,
        supports,
        supportArtifacts,
      }),
    ).handle;
    const manifest = JSON.parse(
      handle.manifest_json(),
    ) as CampaignRuntimeManifest;
    const cells: Record<string, string> = {};
    const bytes = new Map<string, Uint8Array>();
    if (captureOutputs) {
      for (let index = 0; index < handle.artifact_count; index += 1) {
        const metadata = JSON.parse(handle.artifact_metadata_json(index)) as {
          kind: string;
          mediaType: string;
        };
        // Bytes for EVERY researcher-visible output (binary exports included);
        // cells only for the canonical surfaces the address grammar can name.
        // Both predicates are consulted so a kind added to the canonical set
        // alone is still captured for cells instead of silently skipped.
        if (
          !isOutputArtifactKind(metadata.kind) &&
          !isCanonicalOutputKind(metadata.kind)
        )
          continue;
        const payload = handle.take_artifact_bytes(index);
        bytes.set(metadata.kind, payload);
        Object.assign(
          cells,
          canonicalOutputCells(metadata.kind, metadata.mediaType, payload),
        );
      }
    }
    return { manifest, cells: sortCanonicalOutputCells(cells), bytes };
  } catch (cause) {
    throw new Error(`${workspaceIdLabel}/${requestLabel}: execution failed`, {
      cause,
    });
  } finally {
    handle?.free();
    supports.free();
  }
}

function assertCompleteQueryManifest(
  manifest: CampaignRuntimeManifest,
  queryIds: string[],
  caseId: string,
): void {
  expect(
    manifest.queryExecutions,
    `${caseId}: Rust query execution coverage`,
  ).toHaveLength(queryIds.length);
  expect(
    manifest.queryExecutions.map(({ query_id }) => query_id).sort(),
  ).toEqual(queryIds);
  expect(
    Object.keys(manifest.processingSummary.workflowQueryDigests).sort(),
  ).toEqual(queryIds);
  expect(
    Object.keys(manifest.processingSummary.workflowQueryCheckpoints).sort(),
  ).toEqual(queryIds);
  expect(
    manifest.queryExecutions.every(
      ({ query_id, output_digest, status }) =>
        status !== "error" &&
        status !== "skipped" &&
        output_digest ===
          manifest.processingSummary.workflowQueryDigests[query_id],
    ),
    `${caseId}: failed or inconsistent Rust query execution`,
  ).toBe(true);
  expect(
    Object.entries(manifest.processingSummary.workflowQueryCheckpoints).every(
      ([queryId, checkpoint]) =>
        checkpoint.protocolVersion === "chronicle-workflow-checkpoint/v1" &&
        checkpoint.subjectId === queryId &&
        checkpoint.terminalDigest ===
          manifest.processingSummary.workflowQueryDigests[queryId],
    ),
    `${caseId}: invalid Rust query checkpoint`,
  ).toBe(true);
}

describe("two-factor interaction tomography", () => {
  it("exhausts all computational-axis pairs and proves every warm two-factor cone", async () => {
    const keys = [...COMPUTATIONAL_BROWSER_OPTION_KEYS];
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
    const queryIds = workflowContract.execution.queries
      .map(({ id }) => id)
      .sort();
    const base = ALL_ON;
    const alternates = new Map(keys.map((key) => [key, alternatesFor(key)]));
    expect(keys.indexOf("openerSet")).toBeLessThan(
      keys.indexOf("episodeReconstructionStrategy"),
    );
    expect(alternates.get("openerSet")).toEqual([
      { label: "resumedonly", value: "activity_resumed_only" },
      { label: "gesisappstarts", value: "gesis_app_scoped_starts" },
    ]);
    expect(alternates.get("episodeReconstructionStrategy")).toEqual([
      { label: "forward", value: "parry_toth_forward_pairing" },
      { label: "eyes", value: "eyes_complement" },
      { label: "gesis", value: "gesis_start_stop_repair" },
      {
        label: "schoedelprose",
        value: "schoedel_2026_app_within_screen_prose_v1",
      },
    ]);
    const coldBase = await execute(base, "cold-base", "cold-base", null);
    assertCompleteQueryManifest(coldBase, queryIds, "cold-base");
    const coldSingles = new Map<string, CampaignRuntimeManifest>();
    const invalidSingles: Array<Record<string, unknown>> = [];
    const singleRefusalReceipts: SingleRefusalReceipt[] = [];
    for (const key of keys) {
      for (const alternate of alternates.get(key)!) {
        const id = valueId(key, alternate);
        const options = withValue(base, key, alternate.value);
        if (!validConfiguration(options)) {
          invalidSingles.push({
            valueId: id,
            reason:
              "selected timezone is required by a selected-* timezone policy",
          });
          continue;
        }
        const refusal = await typedRefusal(
          options,
          `cold-single-${id}`,
          "run",
          null,
        );
        if (refusal !== null) {
          singleRefusalReceipts.push({
            valueId: id,
            browserKeys: [key],
            values: { [key]: alternate },
            ...refusal,
          });
          continue;
        }
        coldSingles.set(
          id,
          await execute(options, `cold-single-${id}`, "run", null),
        );
        assertCompleteQueryManifest(coldSingles.get(id)!, queryIds, id);
      }
    }

    const nonAdditivePairs: Array<Record<string, unknown>> = [];
    const qualificationEnabledPairs: Array<Record<string, unknown>> = [];
    const invalidPairs: Array<Record<string, unknown>> = [];
    const pairRefusalReceipts: PairRefusalReceipt[] = [];
    const pairCases: string[] = [];
    const pairOrder: Array<{ ordinal: number; pairId: string }> = [];
    // Every configuration-only typed refusal the pair census must reach: the
    // one EYES/GESIS opener crossing, and the B06 chronicle-rejection policy
    // (selected directly or through its legacy-config threshold source) under
    // each non-fused reconstruction strategy.
    const EXPECTED_TYPED_REFUSAL_PAIRS: Record<
      string,
      { axis: "opener_set" | "maximum_duration"; reasonCode: string }
    > = {
      "openerSet=gesisappstarts+episodeReconstructionStrategy=eyes": {
        axis: "opener_set",
        reasonCode: "eyes_requires_lifecycle_triplets",
      },
      ...Object.fromEntries(
        ["forward", "eyes", "gesis", "schoedelprose"].flatMap((strategy) => [
          [
            `episodeReconstructionStrategy=${strategy}+maximumDurationPolicy=chroniclerejection`,
            {
              axis: "maximum_duration",
              reasonCode:
                "maximum_duration_policy_incompatible_with_reconstruction_strategy",
            },
          ],
          [
            `episodeReconstructionStrategy=${strategy}+maximumDurationThresholdSource=legacyconfig`,
            {
              axis: "maximum_duration",
              reasonCode:
                "maximum_duration_policy_incompatible_with_reconstruction_strategy",
            },
          ],
        ]),
      ),
    };
    const expectedTypedRefusalOrdinals = new Map<string, number>();
    let pairCount = 0;
    let pairContrastOrdinal = 0;
    let warmColdComparisons = 0;
    /// Executed cell/byte warm-vs-cold comparisons. Asserted non-zero after the
    /// loop so the oracle can never be silently skipped by a shard that refused
    /// every pair it was given.
    let valueOracleCases = 0;
    const implementationReceipt = authorityReceipt(coldBase);

    for (let leftIndex = 0; leftIndex < keys.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < keys.length;
        rightIndex += 1
      ) {
        const leftKey = keys[leftIndex];
        const rightKey = keys[rightIndex];
        if (leftKey === undefined || rightKey === undefined) continue;
        for (const leftValue of alternates.get(leftKey)!) {
          for (const rightValue of alternates.get(rightKey)!) {
            const leftId = valueId(leftKey, leftValue);
            const rightId = valueId(rightKey, rightValue);
            const pairId = `${leftId}+${rightId}`;
            const ordinal = pairContrastOrdinal;
            pairContrastOrdinal += 1;
            if (pairId in EXPECTED_TYPED_REFUSAL_PAIRS) {
              expect(expectedTypedRefusalOrdinals.has(pairId)).toBe(false);
              expectedTypedRefusalOrdinals.set(pairId, ordinal);
            }
            if (ordinal % SHARD_COUNT !== SHARD_INDEX) continue;
            pairOrder.push({ ordinal, pairId });
            let pairOptions = withValue(base, leftKey, leftValue.value);
            pairOptions = withValue(pairOptions, rightKey, rightValue.value);
            if (!validConfiguration(pairOptions)) {
              invalidPairs.push({
                pairId,
                reason:
                  "selected timezone is required by a selected-* timezone policy",
              });
              continue;
            }
            const refusal = await typedRefusal(
              pairOptions,
              `cold-pair-${pairId}`,
              "run",
              null,
            );
            if (refusal !== null) {
              pairRefusalReceipts.push({
                pairId,
                browserKeys: [leftKey, rightKey],
                values: {
                  [leftKey]: leftValue,
                  [rightKey]: rightValue,
                },
                ...refusal,
              });
              continue;
            }
            // Empirical stale-result oracle, once per shard. Digest equality
            // below compares two claims a run makes about its own bytes; on the
            // first executed pair the warm payloads are additionally compared
            // cell-by-cell and byte-for-byte against the cold ones, so a query
            // that failed to re-run although a bound input moved is caught by
            // the value it produced rather than by a model of the graph. Bound
            // to one pair because the capture cost is per execution and the
            // single-factor oracle in configurationSpaceCampaign already runs
            // it for every computational key.
            const captureOutputs = valueOracleCases === 0;
            const coldPairRun = await executeCapturing(
              pairOptions,
              `cold-pair-${pairId}`,
              "run",
              null,
              captureOutputs,
            );
            const coldPair = coldPairRun.manifest;
            const warmBase = await execute(
              base,
              `warm-${pairId}`,
              "base",
              null,
            );
            const warmPairRun = await executeCapturing(
              pairOptions,
              `warm-${pairId}`,
              "target",
              warmBase.workspaceRootDigest,
              captureOutputs,
            );
            const warmPair = warmPairRun.manifest;
            pairCount += 1;

            for (const manifest of [coldPair, warmBase, warmPair]) {
              expect(
                manifest.openObligations,
                `${pairId}: binding holes`,
              ).toEqual([]);
              expect(authorityReceipt(manifest), `${pairId}: authority drift`).toEqual(
                implementationReceipt,
              );
              assertCompleteQueryManifest(manifest, queryIds, pairId);
            }
            expect(
              warmPair.processingSummary,
              `${pairId}: warm/cold semantic mismatch`,
            ).toEqual(coldPair.processingSummary);
            expect(
              nodeOutputDigests(warmPair),
              `${pairId}: stale logical output`,
            ).toEqual(nodeOutputDigests(coldPair));
            expect(
              warmPair.processingSummary.workflowQueryDigests,
              `${pairId}: stale Rust query checkpoint`,
            ).toEqual(coldPair.processingSummary.workflowQueryDigests);
            expect(
              queryOutputDigests(warmPair),
              `${pairId}: stale Rust query output`,
            ).toEqual(queryOutputDigests(coldPair));
            expect(
              outputArtifactDigests(warmPair),
              `${pairId}: warm/cold artifact mismatch`,
            ).toEqual(outputArtifactDigests(coldPair));
            if (captureOutputs) {
              // Two empty maps compare equal, so the extraction must be shown
              // to have produced something before the equality means anything.
              // Shape cells are emitted even for a header-only CSV, so count
              // only non-shape (content) cells; the unconditionally published
              // JSON artifacts guarantee at least one exists.
              expect(
                Object.keys(warmPairRun.cells).filter(
                  (address) =>
                    !address.endsWith("#/shape/rows") &&
                    !address.endsWith("#/shape/columns"),
                ).length,
                `${pairId}: warm output content cells extracted`,
              ).toBeGreaterThan(0);
              expect(
                changedCellAddresses(warmPairRun.cells, coldPairRun.cells),
                `${pairId}: warm/cold output cells`,
              ).toEqual([]);
              expect(
                changedCanonicalArtifactBytes(
                  warmPairRun.bytes,
                  coldPairRun.bytes,
                ),
                `${pairId}: warm/cold raw artifact bytes`,
              ).toEqual([]);
              valueOracleCases += 1;
            }
            warmColdComparisons += 1;

            const changedRustKeys = changedFields(
              buildRustV2Options(base, GOLDEN_RUNTIME),
              buildRustV2Options(pairOptions, GOLDEN_RUNTIME),
            );
            const changedSemanticNodes = changedFields(
              coldBase.processingSummary.workflowQueryGroupDigests,
              coldPair.processingSummary.workflowQueryGroupDigests,
            );
            const changedQueries = changedFields(
              coldBase.processingSummary.workflowQueryDigests,
              coldPair.processingSummary.workflowQueryDigests,
            );
            const sourceQueryStatuses = queryStatuses(coldBase);
            const targetQueryStatuses = queryStatuses(coldPair);
            const actualExecutedQueries = executedQueryIds(warmPair);
            // Salsa owns invalidation; `inputs` is a may-read set, so no
            // per-arm execution set is predicted. The dangerous direction is a
            // query that ran with nothing upstream of it having changed.
            const unjustifiedExecutedQueries = unjustifiedExecutions({
              contract: workflowContract,
              targetOptions: buildRustV2Options(pairOptions, GOLDEN_RUNTIME),
              sourceStatuses: sourceQueryStatuses,
              targetStatuses: targetQueryStatuses,
              changedRequestFields: new Set(changedRustKeys),
              changedQueryOutputs: new Set(changedQueries),
              executed: actualExecutedQueries,
            });
            expect(
              unjustifiedExecutedQueries,
              `${pairId}: query executed with no changed request field, source role, or upstream output`,
            ).toEqual([]);
            // A Salsa body produces a new value only by running, so `cached`
            // while the published output digest moved from the warm source is a
            // self-contradicting badge. Reads only observed digests/statuses.
            expect(
              cachedWithChangedOutput(warmBase, warmPair),
              `${pairId}: query badged cached while publishing a changed output digest`,
            ).toEqual([]);
            const deactivatedQueries = workflowContract.execution.queries
              .filter(
                ({ id }) =>
                  sourceQueryStatuses[id] !== "bypassed" &&
                  targetQueryStatuses[id] === "bypassed",
              )
              .map(({ id }) => id)
              .sort();
            const warmStatuses = queryStatuses(warmPair);
            for (const queryId of deactivatedQueries) {
              expect(
                warmStatuses[queryId],
                `${pairId}: deactivated query must not execute`,
              ).toBe("bypassed");
            }

            const observedComponents = checkpointComponentSet(
              coldBase,
              coldPair,
            );
            const observedQueryComponents = changedQueryCheckpointComponents(
              coldBase,
              coldPair,
            );
            expect(
              Object.keys(observedQueryComponents).sort(),
              `${pairId}: Rust query component/terminal drift`,
            ).toEqual(changedQueries);
            const leftSingle = coldSingles.get(leftId);
            const rightSingle = coldSingles.get(rightId);
            const isolatedEffectsAvailable =
              leftSingle !== undefined && rightSingle !== undefined;
            const leftComponents = leftSingle
              ? checkpointComponentSet(coldBase, leftSingle)
              : [];
            const rightComponents = rightSingle
              ? checkpointComponentSet(coldBase, rightSingle)
              : [];
            const additiveComponents = isolatedEffectsAvailable
              ? [...new Set([...leftComponents, ...rightComponents])].sort()
              : [];
            const introducedComponents = isolatedEffectsAvailable
              ? observedComponents.filter(
                  (component) => !additiveComponents.includes(component),
                )
              : [];
            const maskedComponents = isolatedEffectsAvailable
              ? additiveComponents.filter(
                  (component) => !observedComponents.includes(component),
                )
              : [];
            const pairObservation = {
              pairId,
              browserKeys: [leftKey, rightKey],
              values: {
                [leftKey]: leftValue,
                [rightKey]: rightValue,
              },
              interactionClass: isolatedEffectsAvailable
                ? "comparable-isolated-effects"
                : "qualification-enabled",
              changedRustKeys,
              changedSemanticNodes,
              changedQueries,
              // `unjustifiedExecutedQueries` is asserted empty above, so
              // recording it would write a constant `[]` into every case. The
              // per-case execution evidence is `actualExecutedQueries` — the
              // OBSERVED set.
              actualExecutedQueries,
              deactivatedQueries,
              observedComponents,
              observedQueryComponents,
              introducedComponents,
              maskedComponents,
              changedOutputArtifactKinds: changedFields(
                outputArtifactDigests(coldBase),
                outputArtifactDigests(coldPair),
              ),
            };
            if (!isolatedEffectsAvailable) {
              qualificationEnabledPairs.push(pairObservation);
            } else if (
              introducedComponents.length > 0 ||
              maskedComponents.length > 0
            ) {
              nonAdditivePairs.push(pairObservation);
            }
            pairCases.push(JSON.stringify(pairObservation));
          }
        }
      }
    }

    expect(singleRefusalReceipts).toEqual([]);
    const enumeratedSingleContrasts =
      coldSingles.size + invalidSingles.length + singleRefusalReceipts.length;
    expect(enumeratedSingleContrasts).toBe(
      [...alternates.values()].reduce(
        (total, values) => total + values.length,
        0,
      ),
    );
    expect([...expectedTypedRefusalOrdinals.keys()].sort()).toEqual(
      Object.keys(EXPECTED_TYPED_REFUSAL_PAIRS).sort(),
    );
    const shardTypedRefusalPairIds = [...expectedTypedRefusalOrdinals.entries()]
      .filter(([, ordinal]) => ordinal % SHARD_COUNT === SHARD_INDEX)
      .sort(([, left], [, right]) => left - right)
      .map(([pairId]) => pairId);
    expect(pairRefusalReceipts.map(({ pairId }) => pairId)).toEqual(
      shardTypedRefusalPairIds,
    );
    for (const receipt of pairRefusalReceipts) {
      const expected = EXPECTED_TYPED_REFUSAL_PAIRS[receipt.pairId]!;
      expect(receipt.axis, receipt.pairId).toBe(expected.axis);
      if (receipt.axis === "opener_set") {
        expect(receipt.applicability).toMatchObject({
          status: "refused",
          requestedOpenerSetId: "gesis_app_scoped_starts",
          resolvedOpenerSetId: "gesis_app_scoped_starts",
          effectiveOpenerSetId: null,
          relation: "refused",
          reasonCode: expected.reasonCode,
        });
      } else {
        expect(receipt.applicability).toMatchObject({
          status: "refused",
          reasonCode: expected.reasonCode,
        });
        expect(receipt.applicability.applicability).toMatchObject({
          requestedPolicy: "chronicle_observed_close_rejection_v1",
          effectivePolicy: null,
          relation: "refused",
          refusalReason: "policy_incompatible_with_reconstruction_strategy",
        });
      }
      expect(receipt.applicability.optionsDigest).toMatch(
        /^sha256:[0-9a-f]{64}$/,
      );
    }

    const enumeratedPairContrasts =
      pairCount + invalidPairs.length + pairRefusalReceipts.length;
    const expectedPairContrasts = keys.reduce(
      (total, leftKey, leftIndex) =>
        total +
        keys
          .slice(leftIndex + 1)
          .reduce(
            (rightTotal, rightKey) =>
              rightTotal +
              alternates.get(leftKey)!.length *
                alternates.get(rightKey)!.length,
            0,
          ),
      0,
    );
    expect(expectedPairContrasts).toBe(7_684);
    expect(pairContrastOrdinal).toBe(expectedPairContrasts);
    const expectedShardPairContrasts = Math.max(
      0,
      Math.ceil((expectedPairContrasts - SHARD_INDEX) / SHARD_COUNT),
    );
    expect(enumeratedPairContrasts).toBe(expectedShardPairContrasts);
    const axisPairs = (keys.length * (keys.length - 1)) / 2;
    expect(axisPairs).toBe(3_486);
    // The value oracle runs on the first executed pair of the shard. A shard
    // that executed a pair and still recorded no comparison means the capture
    // was skipped, which would make the assertions above vacuous rather than
    // absent. Deliberately not part of `evidence` -- adding a field there would
    // move the recorded ledger and force a dependency-evidence re-record.
    // 130 of the 7,684 pair contrasts are invalid or typed-refused
    // census-wide and the parallel runner caps shards at 12 (>= 640 contrasts
    // each), so every supported shard executes pairs and `0 === 0` for an
    // empty shard is not evidence. The unconditional form is proven safe for
    // SHARD_COUNT <= 49 (min shard >= 156 contrasts > 130 non-executable);
    // finer dev slicing can legitimately produce an empty shard, so only
    // there does the guard fall back to the degenerate-tolerant form.
    if (SHARD_COUNT <= 49) {
      expect(pairCount, "shard executed no pair contrast").toBeGreaterThan(0);
      expect(valueOracleCases, "warm/cold value oracle executions").toBe(1);
    } else {
      expect(valueOracleCases, "warm/cold value oracle executions").toBe(
        pairCount > 0 ? 1 : 0,
      );
    }
    const evidence = {
      protocolVersion: "chronicle-interaction-influence-ledger/v2",
      claimBoundary:
        `Exhaustive two-factor structural interaction census across every pair of non-baseline declared equivalence-class values for all ${keys.length} computational browser axes, on the deterministic configuration-influence-probes corpus. Every executable cell receives exact complete query-registry plus complete query-group warm/cold execution proof. Invalid selected-timezone combinations and authoritative typed opener-set and maximum-duration refusals are explicitly enumerated with their qualification or applicability receipt and are not executed or included in warm/cold comparisons. This does not claim numeric statistical additivity or exhaust interactions of arity three and above. Query recomputation is taken from actual Salsa query bodies plus explicitly instrumented product-query evaluations inside review-only fused queries. The separate sequential Rust path remains the independent cold oracle.`,
      plan: { id: plan.plan_id, revision: plan.revision },
      implementationReceipt,
      fixture: {
        corpusId: corpus.id,
        seed: corpus.seed,
        rowCount: corpus.rowCount,
        injectedFeatures: corpus.injectedFeatures,
      },
      coverage: {
        axes: keys.length,
        axisPairs,
        declaredAlternates: [...alternates.values()].reduce(
          (total, values) => total + values.length,
          0,
        ),
        enumeratedSingleContrasts,
        validSingleContrasts: coldSingles.size,
        invalidSingleContrasts: invalidSingles.length,
        refusedSingleContrasts: singleRefusalReceipts.length,
        enumeratedPairContrasts,
        validPairContrasts: pairCount,
        invalidPairContrasts: invalidPairs.length,
        refusedPairContrasts: pairRefusalReceipts.length,
        coldExecutions: 1 + coldSingles.size + pairCount,
        incrementalExecutions: pairCount * 2,
        totalRustExecutions: 1 + coldSingles.size + pairCount * 3,
        warmColdComparisons,
        warmColdQueryCheckpointComparisons:
          warmColdComparisons * workflowContract.execution.queries.length,
        workflowQueryGroupCount: order.length,
        workflowQueryCount: workflowContract.execution.queries.length,
        nonAdditivePairs: nonAdditivePairs.length,
        qualificationEnabledPairs: qualificationEnabledPairs.length,
      },
      invalidSingles,
      invalidPairs,
      singleRefusalReceipts,
      pairRefusalReceipts,
      qualificationEnabledPairs,
      nonAdditivePairs,
      pairCaseDigest: await sha256Uri(pairCases.sort().join("\n")),
    };
    if (SHARD_OUTPUT) {
      mkdirSync(dirname(SHARD_OUTPUT), { recursive: true });
      writeFileSync(
        SHARD_OUTPUT,
        `${JSON.stringify({ evidence, pairCases, pairOrder }, null, 2)}\n`,
        "utf8",
      );
      return;
    }
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    if (UPDATE) {
      mkdirSync(dirname(EXPECTED_FILE), { recursive: true });
      writeFileSync(EXPECTED_FILE, serialized, "utf8");
      return;
    }
    expect(
      existsSync(EXPECTED_FILE),
      "missing interaction influence ledger",
    ).toBe(true);
    expect(serialized).toBe(readFileSync(EXPECTED_FILE, "utf8"));
  }, CAMPAIGN_TEST_TIMEOUT_MS);
});
