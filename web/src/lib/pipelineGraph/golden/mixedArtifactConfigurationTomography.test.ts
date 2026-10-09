import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import filterCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?raw";
import forcingCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?raw";
import backgroundCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?raw";
import codebookCsv from "@/testSupport/fixtures/synthetic-catalog-app-codebook.csv?raw";
import { COMPUTATIONAL_BROWSER_OPTION_KEYS } from "@/lib/generatedContract";
import { usesInputCapabilityEvidence } from "@/lib/inputCapabilityEvidence";
import { ALL_ON, GOLDEN_RUNTIME, validConfiguration, withValue } from "@/testSupport/rustCampaignGraph";
import { buildRustV2Options } from "@/lib/rustPipelineRuntime";
import type { BrowserProcessingOptions } from "@/lib/types";
import {
  buildArtifactFixtureState,
  buildArtifactInterventions,
  prepareArtifactFixtureForScientificExecution,
  isCapabilityEvidenceIntervention,
  SUPPORT_ROLE_IDS,
  type ArtifactFixtureState,
  type ArtifactIntervention,
  type InterventionRoleId,
} from "@/testSupport/artifactInterventions";
import { configurationEquivalenceClasses } from "@/testSupport/configurationEquivalenceClasses";
import {
  captureCanonicalOutputCells,
  changedCellAddresses,
} from "@/testSupport/outputCellTomography";
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
  changedFields,
  checkpointComponentSet,
  executedQueryIds,
  nodeOutputDigests,
  outputArtifactDigests,
  queryStatuses,
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
  ScientificCampaignRefusalError,
} from "@/testSupport/scientificCampaignExecution";
import * as runtime from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

// Footprint selection: record which production source files this campaign
// actually executed (no-op unless the evidence refresh sets the profraw dir).
afterAll(
  () => captureCampaignFootprint(runtime),
  CAMPAIGN_FOOTPRINT_CAPTURE_TIMEOUT_MS,
);
import { CAMPAIGN_TEST_TIMEOUT_MS } from "@/testSupport/campaignTimeout";

const EXPECTED_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "family-expected",
);
const AGGREGATE_FILE = join(
  EXPECTED_DIRECTORY,
  "mixed-artifact-configuration-ledger.json",
);
const PLAN_FILE = fileURLToPath(
  new URL(
    "../../../../../.semantic-federation/semantic/resources/chronicle.plan.json",
    import.meta.url,
  ),
);
const UPDATE = process.env.UPDATE_MIXED_INFLUENCE === "1";
const encoder = new TextEncoder();
const ROLE_IDS = ["raw_chronicle_csv", ...SUPPORT_ROLE_IDS] as const;
const MIXED_ROLE = process.env.MIXED_ROLE as InterventionRoleId | undefined;
if (MIXED_ROLE && !ROLE_IDS.includes(MIXED_ROLE)) {
  throw new Error(`unknown MIXED_ROLE: ${MIXED_ROLE}`);
}

type ObservationOutcome =
  | {
      status: "executed";
      observation: ObservedRuntimeManifest;
      executeCalls: 1;
    }
  | {
      status: "refused";
      receipt: import("@/lib/generatedRuntimeBoundary").RuntimeScientificPreflightReceipt;
      executeCalls: 0;
    };
type AxisValue = { label: string; value: unknown };
const NO_VALID_APP_USAGE = "No valid app usage data during the study period";

function isNoValidAppUsage(cause: unknown): boolean {
  if (cause === NO_VALID_APP_USAGE) return true;
  if (typeof cause !== "object" || cause === null) return false;
  const error = cause as { message?: unknown; cause?: unknown };
  return (
    error.message === NO_VALID_APP_USAGE || isNoValidAppUsage(error.cause)
  );
}

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
let workflowContract: RustWorkflowContract;

beforeAll(() => {
  runtime.initSync({ module: dependencyCampaignRuntimeBytes() });
  workflowContract = JSON.parse(
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

function axisId(key: string, alternate: AxisValue): string {
  return `${key}=${alternate.label}`;
}

async function executeOutcome(
  state: ArtifactFixtureState,
  options: BrowserProcessingOptions,
  workspaceLabel: string,
  requestId: string,
  previousRoot: string | null,
): Promise<ObservationOutcome> {
  const executionState = prepareArtifactFixtureForScientificExecution(
    state,
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
    const requestJson = JSON.stringify({
      protocolVersion: "chronicle-preprocessing-runtime/v2",
      executionEngine: "incremental",
      provenanceEvidence: true,
      requestId,
      command: "ExecuteWorkspace",
      workspaceRootDigest: previousRoot,
      workspaceId: await sha256Uri(`mixed:${workspaceLabel}`),
      inputFileName: "mixed-artifact-configuration.csv",
      inputSha256: await sha256Uri(rawBytes),
      options: buildRustV2Options(options, GOLDEN_RUNTIME),
    });
    const result = executeScientificCampaignWorkspace({
      runtime,
      options,
      requestJson,
      rawBytes,
      supports,
      supportArtifacts,
    });
    if (result.status === "refused") return result;
    handle = result.handle;
    const manifest = JSON.parse(handle.manifest_json()) as CampaignRuntimeManifest;
    return {
      status: "executed",
      observation: Object.assign(manifest, {
        outputCells: captureCanonicalOutputCells(handle),
      }),
      executeCalls: 1,
    };
  } finally {
    handle?.free();
    supports.free();
  }
}

async function execute(
  state: ArtifactFixtureState,
  options: BrowserProcessingOptions,
  workspaceLabel: string,
  requestId: string,
  previousRoot: string | null,
): Promise<ObservedRuntimeManifest> {
  let result: ObservationOutcome;
  try {
    result = await executeOutcome(
      state,
      options,
      workspaceLabel,
      requestId,
      previousRoot,
    );
  } catch (cause) {
    throw new Error(`${workspaceLabel}: execution failed`, { cause });
  }
  if (result.status === "refused") {
    throw new ScientificCampaignRefusalError(result.receipt);
  }
  return result.observation;
}

function semanticOutcome(manifest: CampaignRuntimeManifest): Record<string, unknown> {
  return {
    processingSummary: manifest.processingSummary,
    nodeOutputs: nodeOutputDigests(manifest),
    outputArtifacts: outputArtifactDigests(manifest),
  };
}


function delta(
  left: string[],
  right: string[],
): { introduced: string[]; masked: string[] } {
  return {
    introduced: right.filter((value) => !left.includes(value)),
    masked: left.filter((value) => !right.includes(value)),
  };
}

describe("mixed artifact × configuration tomography", () => {
  if (!MIXED_ROLE) {
    it("binds the nine generic role shards into one aggregate receipt", () => {
      expect(existsSync(AGGREGATE_FILE), "missing mixed aggregate ledger").toBe(
        true,
      );
      const aggregate = JSON.parse(readFileSync(AGGREGATE_FILE, "utf8")) as {
        protocolVersion: string;
        roleShards: Array<{
          roleId: string;
          path: string;
          contentDigest: string;
        }>;
      };
      expect(aggregate.protocolVersion).toBe(
        "chronicle-mixed-artifact-configuration-aggregate/v1",
      );
      expect(aggregate.roleShards.map(({ roleId }) => roleId).sort()).toEqual(
        ROLE_IDS.filter(
          (roleId) => roleId !== "input_capability_evidence_file",
        ).sort(),
      );
      for (const shard of aggregate.roleShards) {
        const bytes = readFileSync(join(EXPECTED_DIRECTORY, shard.path));
        expect(
          `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        ).toBe(shard.contentDigest);
      }
    });
    return;
  }

  it("proves every source-role/configuration interaction in both transition orders", async () => {
    const baseOptions: BrowserProcessingOptions =
      MIXED_ROLE === "input_capability_evidence_file"
        ? {
            ...ALL_ON,
            screenSessionConstructionStrategy:
              "parry_toth_2025_session_glance_v1",
          }
        : ALL_ON;
    const representatives = new Map<
      InterventionRoleId,
      {
        corpusId: string;
        seed: number;
        rowCount: number;
        injectedFeatures: string[];
        intervention: ArtifactIntervention;
        source: ArtifactFixtureState;
        state: ArtifactFixtureState;
        coldBase: ObservedRuntimeManifest;
        cold: ObservedRuntimeManifest;
      }
    >();
    const fixtureBases = new Map<
      string,
      { source: ArtifactFixtureState; coldBase: ObservedRuntimeManifest }
    >();
    let activationBaseExecutions = 0;
    let activationProbeExecutions = 0;
    const capabilityRefusalWitnesses: Array<{
      corpusId: string;
      interventionId: string;
      executeCalls: 0;
      receipt: import("@/lib/generatedRuntimeBoundary").RuntimeScientificPreflightReceipt;
    }> = [];
    for (const roleId of [MIXED_ROLE]) {
      for (const profile of SYNTHETIC_CORPUS_PROFILES) {
        const candidateCorpus = generateSyntheticChronicleCorpus(
          profile,
          catalog,
        );
        let fixture = fixtureBases.get(candidateCorpus.id);
        if (!fixture) {
          const source = buildArtifactFixtureState({
            corpus: candidateCorpus,
            catalog,
            filterCsv,
            forcingCsv,
            backgroundCsv,
          });
          fixture = {
            source,
            coldBase: await execute(
              source,
              baseOptions,
              `activate-base-${candidateCorpus.id}`,
              "activate-base",
              null,
            ),
          };
          fixtureBases.set(candidateCorpus.id, fixture);
          activationBaseExecutions += 1;
        }
        const candidates = buildArtifactInterventions({
          corpus: candidateCorpus,
          catalog,
        }).filter(
          (candidate) =>
            candidate.roleId === roleId &&
            (!isCapabilityEvidenceIntervention(candidate) ||
              candidate.id !== "support:capability-schema-version-invalid") &&
            candidate.expectedSemanticEffect === "required",
        );
        for (const candidate of candidates) {
          const state = candidate.apply(fixture.source);
          const outcome = await executeOutcome(
            state,
            baseOptions,
            `activate-${candidateCorpus.id}-${candidate.id}`,
            "activate",
            null,
          );
          activationProbeExecutions += outcome.executeCalls;
          if (outcome.status === "refused") {
            capabilityRefusalWitnesses.push({
              corpusId: candidateCorpus.id,
              interventionId: candidate.id,
              executeCalls: 0,
              receipt: outcome.receipt,
            });
            continue;
          }
          const cold = outcome.observation;
          if (
            changedFields(
              fixture.coldBase.processingSummary.workflowQueryGroupDigests,
              cold.processingSummary.workflowQueryGroupDigests,
            ).length > 0
          ) {
            representatives.set(roleId, {
              corpusId: candidateCorpus.id,
              seed: candidateCorpus.seed,
              rowCount: candidateCorpus.rowCount,
              injectedFeatures: candidateCorpus.injectedFeatures,
              intervention: candidate,
              source: fixture.source,
              state,
              coldBase: fixture.coldBase,
              cold,
            });
          }
        }
        if (
          representatives.has(roleId) &&
          (roleId !== "input_capability_evidence_file" ||
            capabilityRefusalWitnesses.some(
              ({ corpusId }) => corpusId === candidateCorpus.id,
            ))
        ) {
          break;
        }
      }
    }
    expect(
      [...representatives.keys()].sort(),
      "each source role needs an empirically branch-activating representative",
    ).toEqual([MIXED_ROLE]);
    const implementationReceipt = authorityReceipt(
      representatives.values().next().value!.coldBase,
    );

    const allVariants = COMPUTATIONAL_BROWSER_OPTION_KEYS.flatMap((key) =>
      configurationEquivalenceClasses(key)
        .filter(
          ({ value }) =>
            JSON.stringify(value) !==
            JSON.stringify(
              (baseOptions as unknown as Record<string, unknown>)[key],
            ),
        )
        .map((alternate) => ({ key, alternate })),
    );
    const sourceSensitiveCompoundVariants =
      MIXED_ROLE === "raw_chronicle_csv"
        ? allVariants.filter(({ key, alternate }) =>
            usesInputCapabilityEvidence(
              withValue(baseOptions, key, alternate.value),
            ),
          )
        : [];
    const variants = allVariants.filter(
      (variant) => !sourceSensitiveCompoundVariants.includes(variant),
    );
    const coldConfigurations = new Map<string, ObservedRuntimeManifest>();
    const invalidVariants: Array<{ variantId: string; reason: string }> = [];
    const inputDependentStructuralOutcomes: Array<{
      roleId: InterventionRoleId;
      variantId: string;
      phase: "cold_configuration" | "cold_pair";
      reason: typeof NO_VALID_APP_USAGE;
    }> = [];
    for (const { key, alternate } of variants) {
      const variantId = axisId(key, alternate);
      const options = withValue(baseOptions, key, alternate.value);
      if (!validConfiguration(options)) {
        invalidVariants.push({
          variantId,
          reason:
            "selected timezone is required by a selected-* timezone policy",
        });
        continue;
      }
      for (const [roleId, representative] of representatives) {
        try {
          coldConfigurations.set(
            `${roleId}:${variantId}`,
            await execute(
              representative.source,
              options,
              `cold-config-${roleId}-${variantId}`,
              "cold-config",
              null,
            ),
          );
        } catch (cause) {
          if (isNoValidAppUsage(cause)) {
            inputDependentStructuralOutcomes.push({
              roleId,
              variantId,
              phase: "cold_configuration",
              reason: NO_VALID_APP_USAGE,
            });
            continue;
          }
          throw new Error(`${roleId}:${variantId}: cold configuration failed`, {
            cause,
          });
        }
      }
    }

    const interactionCases: Array<Record<string, unknown>> = [];
    const caseIdentities: string[] = [];
    let pairCount = 0;
    let warmColdComparisons = 0;
    for (const [roleId, representative] of representatives) {
      for (const { key, alternate } of variants) {
        const variantId = axisId(key, alternate);
        const coldConfiguration = coldConfigurations.get(
          `${roleId}:${variantId}`,
        );
        if (!coldConfiguration) continue;
        const options = withValue(baseOptions, key, alternate.value);
        const changedRustKeys = new Set(
          changedFields(
            buildRustV2Options(baseOptions, GOLDEN_RUNTIME),
            buildRustV2Options(options, GOLDEN_RUNTIME),
          ),
        );
        const exactTargetOptions = buildRustV2Options(options, GOLDEN_RUNTIME);
        const caseId = `${roleId}:${representative.intervention.id}×${variantId}`;
        let coldPair: ObservedRuntimeManifest;
        try {
          coldPair = await execute(
            representative.state,
            options,
            `cold-pair-${caseId}`,
            "cold-pair",
            null,
          );
        } catch (cause) {
          if (isNoValidAppUsage(cause)) {
            inputDependentStructuralOutcomes.push({
              roleId,
              variantId,
              phase: "cold_pair",
              reason: NO_VALID_APP_USAGE,
            });
            continue;
          }
          throw cause;
        }

        const dataFirstWorkspace = `data-first-${caseId}`;
        const dataFirstBase = await execute(
          representative.source,
          baseOptions,
          dataFirstWorkspace,
          "base",
          null,
        );
        const dataFirstSingle = await execute(
          representative.state,
          baseOptions,
          dataFirstWorkspace,
          "data",
          dataFirstBase.workspaceRootDigest,
        );
        const dataFirstPair = await execute(
          representative.state,
          options,
          dataFirstWorkspace,
          "pair",
          dataFirstSingle.workspaceRootDigest,
        );

        const configFirstWorkspace = `config-first-${caseId}`;
        const configFirstBase = await execute(
          representative.source,
          baseOptions,
          configFirstWorkspace,
          "base",
          null,
        );
        const configFirstSingle = await execute(
          representative.source,
          options,
          configFirstWorkspace,
          "config",
          configFirstBase.workspaceRootDigest,
        );
        const configFirstPair = await execute(
          representative.state,
          options,
          configFirstWorkspace,
          "pair",
          configFirstSingle.workspaceRootDigest,
        );

        for (const manifest of [
          coldPair,
          dataFirstBase,
          dataFirstSingle,
          dataFirstPair,
          configFirstBase,
          configFirstSingle,
          configFirstPair,
        ]) {
          expect(manifest.openObligations, `${caseId}: binding holes`).toEqual(
            [],
          );
          expect(authorityReceipt(manifest), `${caseId}: authority drift`).toEqual(
            implementationReceipt,
          );
        }
        expect(
          semanticOutcome(dataFirstBase),
          `${caseId}: data-first base`,
        ).toEqual(semanticOutcome(representative.coldBase));
        expect(
          semanticOutcome(configFirstBase),
          `${caseId}: config-first base`,
        ).toEqual(semanticOutcome(representative.coldBase));
        expect(
          semanticOutcome(dataFirstSingle),
          `${caseId}: data-first intermediate`,
        ).toEqual(semanticOutcome(representative.cold));
        expect(
          semanticOutcome(configFirstSingle),
          `${caseId}: config-first intermediate`,
        ).toEqual(semanticOutcome(coldConfiguration));
        expect(
          semanticOutcome(dataFirstPair),
          `${caseId}: data-first final`,
        ).toEqual(semanticOutcome(coldPair));
        expect(
          semanticOutcome(configFirstPair),
          `${caseId}: config-first final`,
        ).toEqual(semanticOutcome(coldPair));
        expect(
          dataFirstPair.outputCells,
          `${caseId}: data-first cells`,
        ).toEqual(coldPair.outputCells);
        expect(
          configFirstPair.outputCells,
          `${caseId}: config-first cells`,
        ).toEqual(coldPair.outputCells);
        warmColdComparisons += 6;

        const changedStepsAfterData = changedFields(
          representative.cold.processingSummary.workflowQueryDigests,
          coldPair.processingSummary.workflowQueryDigests,
        );
        const actualAfterData = executedQueryIds(dataFirstPair);
        // Salsa owns invalidation; `inputs` is a may-read set, so neither
        // transition order predicts an execution set. What must hold on both is
        // that nothing ran without a reason to.
        const unjustifiedAfterData = unjustifiedExecutions({
          contract: workflowContract,
          targetOptions: exactTargetOptions,
          sourceStatuses: queryStatuses(representative.cold),
          targetStatuses: queryStatuses(coldPair),
          changedRequestFields: changedRustKeys,
          changedQueryOutputs: new Set(changedStepsAfterData),
          executed: actualAfterData,
        });
        expect(
          unjustifiedAfterData,
          `${caseId}: config-after-data query executed with no changed request field, source role, or upstream output`,
        ).toEqual([]);
        expect(
          cachedWithChangedOutput(dataFirstSingle, dataFirstPair),
          `${caseId}: config-after-data query badged cached while publishing a changed output digest`,
        ).toEqual([]);
        const changedStepsAfterConfig = changedFields(
          coldConfiguration.processingSummary.workflowQueryDigests,
          coldPair.processingSummary.workflowQueryDigests,
        );
        const actualAfterConfig = executedQueryIds(configFirstPair);
        const unjustifiedAfterConfig = unjustifiedExecutions({
          contract: workflowContract,
          targetOptions: exactTargetOptions,
          sourceStatuses: queryStatuses(coldConfiguration),
          targetStatuses: queryStatuses(coldPair),
          changedSourceRoles: new Set([roleId]),
          changedQueryOutputs: new Set(changedStepsAfterConfig),
          executed: actualAfterConfig,
        });
        expect(
          unjustifiedAfterConfig,
          `${caseId}: data-after-config query executed with no changed request field, source role, or upstream output`,
        ).toEqual([]);
        expect(
          cachedWithChangedOutput(configFirstSingle, configFirstPair),
          `${caseId}: data-after-config query badged cached while publishing a changed output digest`,
        ).toEqual([]);
        const dataFirstSourceStatuses = queryStatuses(representative.cold);
        const pairStatuses = queryStatuses(coldPair);
        const deactivatedAfterData = workflowContract.execution.queries
          .filter(
            ({ id }) =>
              dataFirstSourceStatuses[id] !== "bypassed" &&
              pairStatuses[id] === "bypassed",
          )
          .map(({ id }) => id)
          .sort();
        for (const stepId of deactivatedAfterData) {
          expect(
            queryStatuses(dataFirstPair)[stepId],
            `${caseId}: deactivated config query must not execute`,
          ).toBe("bypassed");
        }
        const configFirstSourceStatuses = queryStatuses(coldConfiguration);
        const deactivatedAfterConfig = workflowContract.execution.queries
          .filter(
            ({ id }) =>
              configFirstSourceStatuses[id] !== "bypassed" &&
              pairStatuses[id] === "bypassed",
          )
          .map(({ id }) => id)
          .sort();
        expect(
          deactivatedAfterConfig,
          `${caseId}: artifact bytes cannot change applicability`,
        ).toEqual([]);

        const baseConfigComponents = checkpointComponentSet(
          representative.coldBase,
          coldConfiguration,
        );
        const dataConfigComponents = checkpointComponentSet(
          representative.cold,
          coldPair,
        );
        const baseDataComponents = checkpointComponentSet(
          representative.coldBase,
          representative.cold,
        );
        const configDataComponents = checkpointComponentSet(
          coldConfiguration,
          coldPair,
        );
        const configConditioning = delta(
          baseConfigComponents,
          dataConfigComponents,
        );
        const dataConditioning = delta(
          baseDataComponents,
          configDataComponents,
        );
        const baseConfigCells = changedCellAddresses(
          representative.coldBase.outputCells,
          coldConfiguration.outputCells,
        );
        const dataConfigCells = changedCellAddresses(
          representative.cold.outputCells,
          coldPair.outputCells,
        );
        const baseDataCells = changedCellAddresses(
          representative.coldBase.outputCells,
          representative.cold.outputCells,
        );
        const configDataCells = changedCellAddresses(
          coldConfiguration.outputCells,
          coldPair.outputCells,
        );
        const configCellConditioning = delta(baseConfigCells, dataConfigCells);
        const dataCellConditioning = delta(baseDataCells, configDataCells);
        const observation = {
          caseId,
          roleId,
          interventionId: representative.intervention.id,
          optionKey: key,
          alternate,
          // `unjustifiedAfterData` / `unjustifiedAfterConfig` are asserted empty
          // above, so recording them would write a constant `[]` into every
          // case. The per-case execution evidence is the `*ActualSteps` pair —
          // the OBSERVED executed-query set for each transition order.
          configAfterDataActualSteps: actualAfterData,
          configAfterDataDeactivatedSteps: deactivatedAfterData,
          dataAfterConfigActualSteps: actualAfterConfig,
          dataAfterConfigDeactivatedSteps: deactivatedAfterConfig,
          configConditioning,
          dataConditioning,
          configCellConditioning: {
            introducedCount: configCellConditioning.introduced.length,
            maskedCount: configCellConditioning.masked.length,
            introducedDigest: await sha256Uri(
              configCellConditioning.introduced.join("\n"),
            ),
            maskedDigest: await sha256Uri(
              configCellConditioning.masked.join("\n"),
            ),
          },
          dataCellConditioning: {
            introducedCount: dataCellConditioning.introduced.length,
            maskedCount: dataCellConditioning.masked.length,
            introducedDigest: await sha256Uri(
              dataCellConditioning.introduced.join("\n"),
            ),
            maskedDigest: await sha256Uri(
              dataCellConditioning.masked.join("\n"),
            ),
          },
        };
        if (
          configConditioning.introduced.length > 0 ||
          configConditioning.masked.length > 0 ||
          dataConditioning.introduced.length > 0 ||
          dataConditioning.masked.length > 0 ||
          configCellConditioning.introduced.length > 0 ||
          configCellConditioning.masked.length > 0 ||
          dataCellConditioning.introduced.length > 0 ||
          dataCellConditioning.masked.length > 0
        ) {
          interactionCases.push(observation);
        }
        caseIdentities.push(JSON.stringify(observation));
        pairCount += 1;
      }
    }

    if (process.env.CHRONICLE_PRINT_PINS === "1") {
      // nosemgrep: semgrep.chronicle-ts-console-log -- CHRONICLE_PRINT_PINS=1 re-pin dump, silent in normal runs
      console.log(
        "CHRONICLE_PINS_MIXED_STRUCTURAL " +
          JSON.stringify(inputDependentStructuralOutcomes),
      );
    }
    if (MIXED_ROLE === "raw_chronicle_csv") {
      expect(inputDependentStructuralOutcomes).toEqual([
        {
          roleId: "raw_chronicle_csv",
          variantId: "dropOutOfSourceOrderEvents=true",
          phase: "cold_pair",
          reason: NO_VALID_APP_USAGE,
        },
      ]);
    } else {
      expect(inputDependentStructuralOutcomes).toEqual([]);
    }
    for (const outcome of inputDependentStructuralOutcomes) {
      expect(outcome.roleId).toBe("raw_chronicle_csv");
      expect(outcome.reason).toBe(NO_VALID_APP_USAGE);
    }

    const evidence = {
      protocolVersion: "chronicle-mixed-artifact-configuration-ledger/v1",
      claimBoundary:
        "Exhaustive value-level pair coverage between every non-compound computational configuration alternate and one empirically branch-activating intervention for the selected raw/support source role. Its activation context is selected deterministically from the six existing synthetic corpora. Raw-role alternates that activate Parry/Zhu/Schoedel and therefore rebind the capability sidecar are explicitly excluded and unestimated as compound raw+capability mutations; the configuration-space sourceSensitiveScientificCells domain proves only the generic LF-sidecar to CRLF-raw Parry rebind mechanism. Capability representative discovery preserves exact typed refusal receipts with executeCalls=0 while selecting an executable intervention. Input-dependent structural outcomes are recorded with their exact phase and error but cannot enter manifest-to-manifest transition equality because they produce no workspace manifest. Every remaining pair's two transition orders must equal an independent cold Rust/WASM target at every workflow checkpoint, output artifact, and canonical output cell. The nine independently recycled generic role shards form the aggregate role/value proof; one representative mutation does not exhaust every record- or field-level interaction.",
      plan: { id: plan.plan_id, revision: plan.revision },
      implementationReceipt,
      roleRepresentatives: Object.fromEntries(
        [...representatives]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([roleId, representative]) => [
            roleId,
            {
              corpusId: representative.corpusId,
              seed: representative.seed,
              rowCount: representative.rowCount,
              injectedFeatures: representative.injectedFeatures,
              interventionId: representative.intervention.id,
              mutationClass: representative.intervention.mutationClass,
              changedComponents: representative.intervention.changedComponents,
            },
          ]),
      ),
      invalidVariants,
      inputDependentStructuralOutcomes,
      capabilityRefusalWitnesses,
      coverage: {
        sourceRoles: representatives.size,
        computationalAxes: COMPUTATIONAL_BROWSER_OPTION_KEYS.length,
        declaredAlternateValues: allVariants.length,
        directlyCrossedAlternateValues: variants.length,
        sourceSensitiveCompoundVariants: sourceSensitiveCompoundVariants.map(
          ({ key, alternate }) => axisId(key, alternate),
        ),
        validConfigurationVariants: variants.length - invalidVariants.length,
        invalidConfigurationVariants: invalidVariants.length,
        inputDependentStructuralOutcomes:
          inputDependentStructuralOutcomes.length,
        scientificRefusalExecutionsAvoided: capabilityRefusalWitnesses.length,
        validRoleValuePairs: pairCount,
        coldExecutions:
          activationBaseExecutions +
          activationProbeExecutions +
          coldConfigurations.size +
          pairCount +
          inputDependentStructuralOutcomes.length,
        incrementalExecutions: pairCount * 6,
        totalRustExecutions:
          activationBaseExecutions +
          activationProbeExecutions +
          coldConfigurations.size +
          pairCount * 7 +
          inputDependentStructuralOutcomes.length,
        warmColdComparisons,
        nonAdditiveOrMaskedPairs: interactionCases.length,
      },
      interactions: interactionCases,
      caseSetDigest: await sha256Uri(caseIdentities.sort().join("\n")),
    };
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    const expectedFile = join(
      EXPECTED_DIRECTORY,
      `mixed-artifact-configuration-${MIXED_ROLE}.json`,
    );
    if (UPDATE) {
      mkdirSync(dirname(expectedFile), { recursive: true });
      writeFileSync(expectedFile, serialized, "utf8");
      return;
    }
    expect(
      existsSync(expectedFile),
      "missing mixed artifact/configuration ledger",
    ).toBe(true);
    expect(serialized).toBe(readFileSync(expectedFile, "utf8"));
  }, CAMPAIGN_TEST_TIMEOUT_MS);
});
