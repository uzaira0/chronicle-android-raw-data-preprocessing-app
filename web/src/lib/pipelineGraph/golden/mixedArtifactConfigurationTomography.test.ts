import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import filterCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?raw";
import forcingCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?raw";
import backgroundCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?raw";
import codebookCsv from "@/assets/defaults/unified_app_codebook.csv?raw";
import { COMPUTATIONAL_BROWSER_OPTION_KEYS } from "@/lib/generatedContract";
import { GOLDEN_RUNTIME } from "@/lib/pipelineGraph/golden/goldenScenario";
import { ALL_ON } from "@/lib/pipelineGraph/validationHarness";
import { buildRustV2Options } from "@/lib/rustPipelineRuntime";
import type { BrowserProcessingOptions } from "@/lib/types";
import {
  buildArtifactFixtureState,
  buildArtifactInterventions,
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
  sourceRoleIsActive,
  type RustStepContract,
} from "@/testSupport/rustStepContract";
import { dependencyCampaignRuntimeBytes } from "@/testSupport/dependencyCampaignRuntime";
import * as runtime from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

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

type RuntimeManifest = {
  implementation: string;
  implementationDigest: string;
  planDigest: string;
  profileDigest: string;
  profileLockDigest: string;
  runtimeAuthorityDigest: string;
  productContractDigest: string;
  workspaceRootDigest: string;
  openObligations: unknown[];
  processingSummary: {
    logicalStageDigests: Record<string, string>;
    logicalStageCheckpoints: Record<string, Record<string, unknown>>;
    pipelineStepDigests: Record<string, string>;
    [key: string]: unknown;
  };
  nodeExecutions: Array<{
    node_id: string;
    input_key: string;
    output: { digest: string } | null;
    status: "cached" | "recomputed" | "error" | "skipped" | "bypassed";
  }>;
  stepExecutions: Array<{
    step_id: string;
    unit_id: string;
    input_key: string;
    output_digest: string;
    status: "cached" | "recomputed" | "error" | "skipped" | "bypassed";
  }>;
  artifacts: Array<{ kind: string; digest: string; size: number }>;
};

type Observation = RuntimeManifest & { outputCells: Record<string, string> };
type AxisValue = { label: string; value: unknown };

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
let stepContract: RustStepContract;

beforeAll(() => {
  runtime.initSync({ module: dependencyCampaignRuntimeBytes() });
  stepContract = JSON.parse(
    runtime.pipeline_step_contract_json(),
  ) as RustStepContract;
  expect(stepContract.protocolVersion).toBe(
    "chronicle-preprocessing-step-contract/v3",
  );
  expect(stepContract.steps).toHaveLength(55);
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

function changedFields(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]))
    .sort();
}

function withValue(
  source: BrowserProcessingOptions,
  key: string,
  value: unknown,
): BrowserProcessingOptions {
  const target = { ...source } as unknown as Record<string, unknown>;
  if (value === undefined) delete target[key];
  else target[key] = value;
  return target as unknown as BrowserProcessingOptions;
}

function validConfiguration(options: BrowserProcessingOptions): boolean {
  return !(
    options.timezoneHandling.startsWith("selected-") &&
    !options.selectedTimezone?.trim()
  );
}

function axisId(key: string, alternate: AxisValue): string {
  return `${key}=${alternate.label}`;
}

async function execute(
  state: ArtifactFixtureState,
  options: BrowserProcessingOptions,
  workspaceLabel: string,
  requestId: string,
  previousRoot: string | null,
): Promise<Observation> {
  const rawBytes = encoder.encode(state.rawCsv);
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
        workspaceId: await sha256Uri(`mixed:${workspaceLabel}`),
        inputFileName: "mixed-artifact-configuration.csv",
        inputSha256: await sha256Uri(rawBytes),
        options: buildRustV2Options(options, GOLDEN_RUNTIME),
      }),
      rawBytes,
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

function receipt(manifest: RuntimeManifest): Record<string, string> {
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

const OUTPUT_KINDS = new Set([
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

function outputArtifacts(manifest: RuntimeManifest): Record<string, string> {
  return Object.fromEntries(
    manifest.artifacts
      .filter(
        ({ kind }) => OUTPUT_KINDS.has(kind) || kind.startsWith("aggregate-"),
      )
      .sort((left, right) => left.kind.localeCompare(right.kind))
      .map(({ kind, digest }) => [kind, digest]),
  );
}

function semanticOutcome(manifest: RuntimeManifest): Record<string, unknown> {
  return {
    processingSummary: manifest.processingSummary,
    nodeOutputs: nodeOutputDigests(manifest),
    outputArtifacts: outputArtifacts(manifest),
  };
}

function checkpointComponentSet(
  source: RuntimeManifest,
  target: RuntimeManifest,
): string[] {
  return Object.keys(source.processingSummary.logicalStageCheckpoints)
    .sort()
    .flatMap((nodeId) =>
      changedFields(
        source.processingSummary.logicalStageCheckpoints[nodeId],
        target.processingSummary.logicalStageCheckpoints[nodeId],
      )
        .filter((component) => component !== "terminalDigest")
        .map((component) => `${nodeId}.${component}`),
    );
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

function predictedExecutedSteps(
  changedRequestFields: ReadonlySet<string>,
  changedSourceRoles: ReadonlySet<string>,
  changedStepOutputs: ReadonlySet<string>,
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
          step.requestFields.some((field) => changedRequestFields.has(field)) ||
          step.sourceRoles.some(
            (role) =>
              changedSourceRoles.has(role) && sourceRoleIsActive(step, role, targetOptions),
          ) ||
          step.inputs.some((input) => changedStepOutputs.has(input)))
      );
    })
    .map(({ id }) => id)
    .sort();
}

describe("mixed artifact × configuration tomography", () => {
  if (!MIXED_ROLE) {
    it("binds the nine independently recycled role shards into one aggregate receipt", () => {
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
        [...ROLE_IDS].sort(),
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
    const baseOptions = ALL_ON;
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
        coldBase: Observation;
        cold: Observation;
      }
    >();
    const fixtureBases = new Map<
      string,
      { source: ArtifactFixtureState; coldBase: Observation }
    >();
    let activationBaseExecutions = 0;
    let activationProbeExecutions = 0;
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
            candidate.expectedSemanticEffect === "required",
        );
        for (const candidate of candidates) {
          const state = candidate.apply(fixture.source);
          const cold = await execute(
            state,
            baseOptions,
            `activate-${candidateCorpus.id}-${candidate.id}`,
            "activate",
            null,
          );
          activationProbeExecutions += 1;
          if (
            changedFields(
              fixture.coldBase.processingSummary.logicalStageDigests,
              cold.processingSummary.logicalStageDigests,
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
            break;
          }
        }
        if (representatives.has(roleId)) {
          break;
        }
      }
    }
    expect(
      [...representatives.keys()].sort(),
      "each source role needs an empirically branch-activating representative",
    ).toEqual([MIXED_ROLE]);
    const implementationReceipt = receipt(
      representatives.values().next().value!.coldBase,
    );

    const variants = COMPUTATIONAL_BROWSER_OPTION_KEYS.flatMap((key) =>
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
    const coldConfigurations = new Map<string, Observation>();
    const invalidVariants: Array<{ variantId: string; reason: string }> = [];
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
      }
    }

    const interactionCases: Array<Record<string, unknown>> = [];
    const caseIdentities: string[] = [];
    let pairCount = 0;
    let warmColdComparisons = 0;
    let exactClusterComparisons = 0;
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
        const coldPair = await execute(
          representative.state,
          options,
          `cold-pair-${caseId}`,
          "cold-pair",
          null,
        );

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
          expect(receipt(manifest), `${caseId}: authority drift`).toEqual(
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
          representative.cold.processingSummary.pipelineStepDigests,
          coldPair.processingSummary.pipelineStepDigests,
        );
        const predictedAfterData = predictedExecutedSteps(
          changedRustKeys,
          new Set(),
          new Set(changedStepsAfterData),
          exactTargetOptions,
          representative.cold,
          coldPair,
        );
        const actualAfterData = executedStepIds(dataFirstPair);
        expect(
          actualAfterData,
          `${caseId}: config-after-data Salsa execution`,
        ).toEqual(predictedAfterData);
        const changedStepsAfterConfig = changedFields(
          coldConfiguration.processingSummary.pipelineStepDigests,
          coldPair.processingSummary.pipelineStepDigests,
        );
        const predictedAfterConfig = predictedExecutedSteps(
          new Set(),
          new Set([roleId]),
          new Set(changedStepsAfterConfig),
          exactTargetOptions,
          coldConfiguration,
          coldPair,
        );
        const actualAfterConfig = executedStepIds(configFirstPair);
        expect(
          actualAfterConfig,
          `${caseId}: data-after-config Salsa execution`,
        ).toEqual(predictedAfterConfig);
        const dataFirstSourceStatuses = stepStatuses(representative.cold);
        const pairStatuses = stepStatuses(coldPair);
        const deactivatedAfterData = stepContract.steps
          .filter(
            ({ id }) =>
              dataFirstSourceStatuses[id] !== "bypassed" &&
              pairStatuses[id] === "bypassed",
          )
          .map(({ id }) => id)
          .sort();
        for (const stepId of deactivatedAfterData) {
          expect(
            stepStatuses(dataFirstPair)[stepId],
            `${caseId}: deactivated config query must not execute`,
          ).toBe("bypassed");
        }
        const configFirstSourceStatuses = stepStatuses(coldConfiguration);
        const deactivatedAfterConfig = stepContract.steps
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
        exactClusterComparisons += 2;

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
          configAfterDataPredictedSteps: predictedAfterData,
          configAfterDataActualSteps: actualAfterData,
          configAfterDataDeactivatedSteps: deactivatedAfterData,
          dataAfterConfigPredictedSteps: predictedAfterConfig,
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

    const evidence = {
      protocolVersion: "chronicle-mixed-artifact-configuration-ledger/v1",
      claimBoundary:
        "Exhaustive value-level pair coverage between every declared computational configuration alternate and one empirically branch-activating intervention for the selected raw/support source role. Its activation context is selected deterministically from the six existing synthetic corpora. Both transition orders must equal an independent cold Rust/WASM target at every logical checkpoint, output artifact, and canonical output cell. The nine independently recycled role shards form the aggregate role/value proof; one representative mutation does not exhaust every record- or field-level interaction.",
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
      coverage: {
        sourceRoles: representatives.size,
        computationalAxes: COMPUTATIONAL_BROWSER_OPTION_KEYS.length,
        declaredAlternateValues: variants.length,
        validConfigurationVariants: variants.length - invalidVariants.length,
        invalidConfigurationVariants: invalidVariants.length,
        validRoleValuePairs: pairCount,
        coldExecutions:
          activationBaseExecutions +
          activationProbeExecutions +
          coldConfigurations.size +
          pairCount,
        incrementalExecutions: pairCount * 6,
        totalRustExecutions:
          activationBaseExecutions +
          activationProbeExecutions +
          coldConfigurations.size +
          pairCount * 7,
        warmColdComparisons,
        exactClusterComparisons,
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
  }, 240_000);
});
