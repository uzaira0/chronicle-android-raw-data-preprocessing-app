import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import filterCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?raw";
import forcingCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?raw";
import backgroundCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?raw";
import codebookCsv from "@/assets/defaults/unified_app_codebook.csv?raw";
import { COMPUTATIONAL_BROWSER_OPTION_KEYS } from "@/lib/generatedContract";
import { ALL_ON, GOLDEN_RUNTIME, order } from "@/testSupport/rustCampaignGraph";
import { buildRustV2Options } from "@/lib/rustPipelineRuntime";
import type { BrowserProcessingOptions } from "@/lib/types";
import {
  buildArtifactFixtureState,
  SUPPORT_ROLE_IDS,
} from "@/testSupport/artifactInterventions";
import { configurationEquivalenceClasses } from "@/testSupport/configurationEquivalenceClasses";
import { dependencyCampaignRuntimeBytes } from "@/testSupport/dependencyCampaignRuntime";
import {
  buildSyntheticCatalog,
  generateSyntheticChronicleCorpus,
  SYNTHETIC_CORPUS_PROFILES,
} from "@/testSupport/syntheticChronicleCorpus";
import * as runtime from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

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

type TypedCheckpoint = {
  protocolVersion: "chronicle-logical-stage-checkpoint/v7";
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
  openObligations: unknown[];
  processingSummary: {
    logicalStageDigests: Record<string, string>;
    logicalStageCheckpoints: Record<string, TypedCheckpoint>;
    pipelineStepDigests: Record<string, string>;
    pipelineStepCheckpoints: Record<string, TypedCheckpoint>;
    publishedOutputsDigest: string;
    provenanceDigest: string;
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

type RustStepContract = {
  protocolVersion: "chronicle-preprocessing-step-contract/v3";
  steps: Array<{
    id: string;
    group: string;
    inputs: string[];
    requestFields: string[];
    sourceRoles: string[];
  }>;
};

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
});

async function sha256Uri(value: Uint8Array | string): Promise<string> {
  const bytes =
    typeof value === "string" ? encoder.encode(value) : Uint8Array.from(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
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

type AxisValue = { label: string; value: unknown };

function alternatesFor(key: string): AxisValue[] {
  const current = (ALL_ON as unknown as Record<string, unknown>)[key];
  return configurationEquivalenceClasses(key).filter(
    ({ value }) => JSON.stringify(value) !== JSON.stringify(current),
  );
}

function validConfiguration(options: BrowserProcessingOptions): boolean {
  return !(
    options.timezoneHandling.startsWith("selected-") &&
    !options.selectedTimezone?.trim()
  );
}

function valueId(key: string, value: AxisValue): string {
  return `${key}=${value.label}`;
}

async function execute(
  options: BrowserProcessingOptions,
  workspaceIdLabel: string,
  requestLabel: string,
  previousRoot: string | null,
): Promise<RuntimeManifest> {
  const rawBytes = encoder.encode(fixture.rawCsv);
  const supports = new runtime.RuntimeSupportFiles();
  let handle: ReturnType<typeof runtime.execute_workspace> | undefined;
  try {
    for (const roleId of SUPPORT_ROLE_IDS) {
      const support = fixture.supports[roleId];
      supports.put_with_name(roleId, support.name, encoder.encode(support.csv));
    }
    handle = runtime.execute_workspace(
      JSON.stringify({
        protocolVersion: "chronicle-preprocessing-runtime/v1",
        requestId: requestLabel,
        command: "ExecuteWorkspace",
        workspaceRootDigest: previousRoot,
        workspaceId: await sha256Uri(`interaction:${workspaceIdLabel}`),
        inputFileName: `${corpus.id}.csv`,
        inputSha256: await sha256Uri(rawBytes),
        options: buildRustV2Options(options, GOLDEN_RUNTIME),
      }),
      rawBytes,
      supports,
    );
    return JSON.parse(handle.manifest_json()) as RuntimeManifest;
  } finally {
    handle?.free();
    supports.free();
  }
}

function checkpointComponentSet(
  source: RuntimeManifest,
  target: RuntimeManifest,
): string[] {
  return Object.keys(source.processingSummary.logicalStageCheckpoints)
    .sort()
    .flatMap((nodeId) =>
      changedFields(
        source.processingSummary.logicalStageCheckpoints[
          nodeId
        ] as unknown as Record<string, unknown>,
        target.processingSummary.logicalStageCheckpoints[
          nodeId
        ] as unknown as Record<string, unknown>,
      )
        .filter((component) => component !== "terminalDigest")
        .map((component) => `${nodeId}.${component}`),
    );
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

function stepOutputDigests(manifest: RuntimeManifest): Record<string, string> {
  return Object.fromEntries(
    manifest.stepExecutions.map(({ step_id, output_digest }) => [
      step_id,
      output_digest,
    ]),
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
            ).filter((component) => component !== "terminalDigest"),
          ] as const,
      )
      .filter(([, components]) => components.length > 0),
  );
}

function assertCompleteStepManifest(
  manifest: RuntimeManifest,
  stepIds: string[],
  caseId: string,
): void {
  expect(
    manifest.stepExecutions,
    `${caseId}: Rust step execution coverage`,
  ).toHaveLength(55);
  expect(manifest.stepExecutions.map(({ step_id }) => step_id).sort()).toEqual(
    stepIds,
  );
  expect(
    Object.keys(manifest.processingSummary.pipelineStepDigests).sort(),
  ).toEqual(stepIds);
  expect(
    Object.keys(manifest.processingSummary.pipelineStepCheckpoints).sort(),
  ).toEqual(stepIds);
  expect(
    manifest.stepExecutions.every(
      ({ step_id, output_digest, status }) =>
        status !== "error" &&
        status !== "skipped" &&
        output_digest ===
          manifest.processingSummary.pipelineStepDigests[step_id],
    ),
    `${caseId}: failed or inconsistent Rust step execution`,
  ).toBe(true);
  expect(
    Object.entries(manifest.processingSummary.pipelineStepCheckpoints).every(
      ([stepId, checkpoint]) =>
        checkpoint.protocolVersion ===
          "chronicle-logical-stage-checkpoint/v7" &&
        checkpoint.nodeId === stepId &&
        checkpoint.terminalDigest ===
          manifest.processingSummary.pipelineStepDigests[stepId],
    ),
    `${caseId}: invalid Rust step checkpoint`,
  ).toBe(true);
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

describe("two-factor interaction tomography", () => {
  it("exhausts all computational-axis pairs and proves every warm two-factor cone", async () => {
    const keys = [...COMPUTATIONAL_BROWSER_OPTION_KEYS];
    expect(keys).toHaveLength(46);
    const stepContract = JSON.parse(
      runtime.pipeline_step_contract_json(),
    ) as RustStepContract;
    expect(stepContract.protocolVersion).toBe(
      "chronicle-preprocessing-step-contract/v3",
    );
    expect(stepContract.steps).toHaveLength(55);
    const stepIds = stepContract.steps.map(({ id }) => id).sort();
    const base = ALL_ON;
    const alternates = new Map(keys.map((key) => [key, alternatesFor(key)]));
    const coldBase = await execute(base, "cold-base", "cold-base", null);
    assertCompleteStepManifest(coldBase, stepIds, "cold-base");
    const coldSingles = new Map<string, RuntimeManifest>();
    const invalidSingles: Array<Record<string, unknown>> = [];
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
        coldSingles.set(
          id,
          await execute(options, `cold-single-${id}`, "run", null),
        );
        assertCompleteStepManifest(coldSingles.get(id)!, stepIds, id);
      }
    }

    const nonAdditivePairs: Array<Record<string, unknown>> = [];
    const qualificationEnabledPairs: Array<Record<string, unknown>> = [];
    const invalidPairs: Array<Record<string, unknown>> = [];
    const pairCases: string[] = [];
    const pairOrder: Array<{ ordinal: number; pairId: string }> = [];
    let pairCount = 0;
    let pairContrastOrdinal = 0;
    let exactClusterComparisons = 0;
    let warmColdComparisons = 0;
    const implementationReceipt = receipt(coldBase);

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
            const coldPair = await execute(
              pairOptions,
              `cold-pair-${pairId}`,
              "run",
              null,
            );
            const warmBase = await execute(
              base,
              `warm-${pairId}`,
              "base",
              null,
            );
            const warmPair = await execute(
              pairOptions,
              `warm-${pairId}`,
              "target",
              warmBase.workspaceRootDigest,
            );
            pairCount += 1;

            for (const manifest of [coldPair, warmBase, warmPair]) {
              expect(
                manifest.openObligations,
                `${pairId}: binding holes`,
              ).toEqual([]);
              expect(receipt(manifest), `${pairId}: authority drift`).toEqual(
                implementationReceipt,
              );
              assertCompleteStepManifest(manifest, stepIds, pairId);
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
              warmPair.processingSummary.pipelineStepDigests,
              `${pairId}: stale Rust step checkpoint`,
            ).toEqual(coldPair.processingSummary.pipelineStepDigests);
            expect(
              stepOutputDigests(warmPair),
              `${pairId}: stale Rust step output`,
            ).toEqual(stepOutputDigests(coldPair));
            expect(
              outputArtifacts(warmPair),
              `${pairId}: warm/cold artifact mismatch`,
            ).toEqual(outputArtifacts(coldPair));
            warmColdComparisons += 1;

            const changedRustKeys = changedFields(
              buildRustV2Options(base, GOLDEN_RUNTIME),
              buildRustV2Options(pairOptions, GOLDEN_RUNTIME),
            );
            const changedSemanticNodes = changedFields(
              coldBase.processingSummary.logicalStageDigests,
              coldPair.processingSummary.logicalStageDigests,
            );
            const changedPipelineSteps = changedFields(
              coldBase.processingSummary.pipelineStepDigests,
              coldPair.processingSummary.pipelineStepDigests,
            );
            const sourceStepStatuses = stepStatuses(coldBase);
            const targetStepStatuses = stepStatuses(coldPair);
            const predictedExecutedSteps = stepContract.steps
              .filter((step) => {
                const sourceApplicable =
                  sourceStepStatuses[step.id] !== "bypassed";
                const targetApplicable =
                  targetStepStatuses[step.id] !== "bypassed";
                return (
                  targetApplicable &&
                  (!sourceApplicable ||
                    step.requestFields.some((field) =>
                      changedRustKeys.includes(field),
                    ) ||
                    step.inputs.some((input) =>
                      changedPipelineSteps.includes(input),
                    ))
                );
              })
              .map(({ id }) => id)
              .sort();
            const actualExecutedSteps = executedStepIds(warmPair);
            expect(
              actualExecutedSteps,
              `${pairId}: predicted inputs and actual Salsa query bodies disagree`,
            ).toEqual(predictedExecutedSteps);
            const deactivatedSteps = stepContract.steps
              .filter(
                ({ id }) =>
                  sourceStepStatuses[id] !== "bypassed" &&
                  targetStepStatuses[id] === "bypassed",
              )
              .map(({ id }) => id)
              .sort();
            const warmStatuses = stepStatuses(warmPair);
            for (const stepId of deactivatedSteps) {
              expect(
                warmStatuses[stepId],
                `${pairId}: deactivated query must not execute`,
              ).toBe("bypassed");
            }
            exactClusterComparisons += 1;

            const observedComponents = checkpointComponentSet(
              coldBase,
              coldPair,
            );
            const observedStepComponents = stepCheckpointComponentChanges(
              coldBase,
              coldPair,
            );
            expect(
              Object.keys(observedStepComponents).sort(),
              `${pairId}: Rust step component/terminal drift`,
            ).toEqual(changedPipelineSteps);
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
              changedPipelineSteps,
              predictedExecutedSteps,
              actualExecutedSteps,
              deactivatedSteps,
              observedComponents,
              observedStepComponents,
              introducedComponents,
              maskedComponents,
              changedOutputArtifactKinds: changedFields(
                outputArtifacts(coldBase),
                outputArtifacts(coldPair),
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

    const enumeratedPairContrasts = pairCount + invalidPairs.length;
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
    expect(pairContrastOrdinal).toBe(expectedPairContrasts);
    const expectedShardPairContrasts = Math.max(
      0,
      Math.ceil((expectedPairContrasts - SHARD_INDEX) / SHARD_COUNT),
    );
    expect(enumeratedPairContrasts).toBe(expectedShardPairContrasts);
    const evidence = {
      protocolVersion: "chronicle-interaction-influence-ledger/v1",
      claimBoundary:
        "Exhaustive two-factor structural interaction and exact 55-step plus 15-display-group warm/cold execution proof across every valid pair of non-baseline declared equivalence-class values for all 46 computational browser axes, on the deterministic configuration-influence-probes corpus. Invalid selected-timezone combinations are enumerated with their qualification reason. This does not claim numeric statistical additivity or exhaust interactions of arity three and above. Step recomputation is taken from actual Salsa query bodies plus explicitly instrumented product-step evaluations inside review-only fused queries. The separate sequential Rust path remains the independent cold oracle.",
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
        declaredAlternates: [...alternates.values()].reduce(
          (total, values) => total + values.length,
          0,
        ),
        validSingleContrasts: coldSingles.size,
        invalidSingleContrasts: invalidSingles.length,
        enumeratedPairContrasts,
        validPairContrasts: pairCount,
        invalidPairContrasts: invalidPairs.length,
        coldExecutions: 1 + coldSingles.size + pairCount,
        incrementalExecutions: pairCount * 2,
        totalRustExecutions: 1 + coldSingles.size + pairCount * 3,
        warmColdComparisons,
        warmColdStepCheckpointComparisons: warmColdComparisons * 55,
        exactClusterComparisons,
        exactStepClusterComparisons: exactClusterComparisons,
        logicalStageCount: order.length,
        pipelineStepCount: stepContract.steps.length,
        nonAdditivePairs: nonAdditivePairs.length,
        qualificationEnabledPairs: qualificationEnabledPairs.length,
      },
      invalidSingles,
      invalidPairs,
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
  }, 600_000);
});
