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
import { ALL_ON, byId, order } from "@/lib/pipelineGraph/validationHarness";
import { buildRustV2Options } from "@/lib/rustPipelineRuntime";
import type { BrowserProcessingOptions } from "@/lib/types";
import {
  buildArtifactFixtureState,
  SUPPORT_ROLE_IDS,
} from "@/testSupport/artifactInterventions";
import { configurationEquivalenceClasses } from "@/testSupport/configurationEquivalenceClasses";
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
const encoder = new TextEncoder();

type TypedCheckpoint = {
  protocolVersion: "chronicle-logical-stage-checkpoint/v2";
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
    publishedOutputsDigest: string;
    provenanceDigest: string;
  };
  nodeExecutions: Array<{
    node_id: string;
    input_key: string;
    output: { digest: string } | null;
    status: "cached" | "recomputed" | "error" | "skipped" | "bypassed";
  }>;
  artifacts: Array<{ kind: string; digest: string; size: number }>;
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
  SYNTHETIC_CORPUS_PROFILES.find(({ id }) => id === "configuration-influence-probes")!,
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
  const wasmBytes = readFileSync(
    new URL(
      "../../../wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm",
      import.meta.url,
    ),
  );
  runtime.initSync({ module: wasmBytes });
});

async function sha256Uri(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : Uint8Array.from(value);
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
        source.processingSummary.logicalStageCheckpoints[nodeId] as unknown as Record<
          string,
          unknown
        >,
        target.processingSummary.logicalStageCheckpoints[nodeId] as unknown as Record<
          string,
          unknown
        >,
      )
        .filter((component) => component !== "terminalDigest")
        .map((component) => `${nodeId}.${component}`),
    );
}

function nodeInputKeys(manifest: RuntimeManifest): Record<string, string> {
  return Object.fromEntries(
    manifest.nodeExecutions.map(({ node_id, input_key }) => [node_id, input_key]),
  );
}

function nodeOutputDigests(manifest: RuntimeManifest): Record<string, string | null> {
  return Object.fromEntries(
    manifest.nodeExecutions.map(({ node_id, output }) => [node_id, output?.digest ?? null]),
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
      .filter(({ kind }) => OUTPUT_KINDS.has(kind) || kind.startsWith("aggregate-"))
      .sort((left, right) => left.kind.localeCompare(right.kind))
      .map(({ kind, digest }) => [kind, digest]),
  );
}

function predictedInputNodes(
  changedBrowserKeys: ReadonlySet<string>,
  changedSemanticNodes: ReadonlySet<string>,
): string[] {
  const touched = new Set<string>();
  for (const nodeId of order) {
    const node = byId.get(nodeId)!;
    const directlyBound = node.knobs.some(({ optionKey }) =>
      changedBrowserKeys.has(optionKey),
    );
    const reachedByChangedState = node.inputs.some((input) =>
      changedSemanticNodes.has(input),
    );
    if (directlyBound || reachedByChangedState) touched.add(nodeId);
  }
  return [...touched].sort();
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
    const base = ALL_ON;
    const alternates = new Map(keys.map((key) => [key, alternatesFor(key)]));
    const coldBase = await execute(base, "cold-base", "cold-base", null);
    const coldSingles = new Map<string, RuntimeManifest>();
    const invalidSingles: Array<Record<string, unknown>> = [];
    for (const key of keys) {
      for (const alternate of alternates.get(key)!) {
        const id = valueId(key, alternate);
        const options = withValue(base, key, alternate.value);
        if (!validConfiguration(options)) {
          invalidSingles.push({
            valueId: id,
            reason: "selected timezone is required by a selected-* timezone policy",
          });
          continue;
        }
        coldSingles.set(
          id,
          await execute(options, `cold-single-${id}`, "run", null),
        );
      }
    }

    const nonAdditivePairs: Array<Record<string, unknown>> = [];
    const qualificationEnabledPairs: Array<Record<string, unknown>> = [];
    const invalidPairs: Array<Record<string, unknown>> = [];
    const pairCases: string[] = [];
    let pairCount = 0;
    let exactClusterComparisons = 0;
    let warmColdComparisons = 0;
    const implementationReceipt = receipt(coldBase);

    for (let leftIndex = 0; leftIndex < keys.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < keys.length; rightIndex += 1) {
        const leftKey = keys[leftIndex];
        const rightKey = keys[rightIndex];
        for (const leftValue of alternates.get(leftKey)!) {
          for (const rightValue of alternates.get(rightKey)!) {
        const leftId = valueId(leftKey, leftValue);
        const rightId = valueId(rightKey, rightValue);
        const pairId = `${leftId}+${rightId}`;
        let pairOptions = withValue(base, leftKey, leftValue.value);
        pairOptions = withValue(pairOptions, rightKey, rightValue.value);
        if (!validConfiguration(pairOptions)) {
          invalidPairs.push({
            pairId,
            reason: "selected timezone is required by a selected-* timezone policy",
          });
          continue;
        }
        const coldPair = await execute(pairOptions, `cold-pair-${pairId}`, "run", null);
        const warmBase = await execute(base, `warm-${pairId}`, "base", null);
        const warmPair = await execute(
          pairOptions,
          `warm-${pairId}`,
          "target",
          warmBase.workspaceRootDigest,
        );
        pairCount += 1;

        for (const manifest of [coldPair, warmBase, warmPair]) {
          expect(manifest.openObligations, `${pairId}: binding holes`).toEqual([]);
          expect(receipt(manifest), `${pairId}: authority drift`).toEqual(
            implementationReceipt,
          );
        }
        expect(
          warmPair.processingSummary,
          `${pairId}: warm/cold semantic mismatch`,
        ).toEqual(coldPair.processingSummary);
        expect(nodeOutputDigests(warmPair), `${pairId}: stale logical output`).toEqual(
          nodeOutputDigests(coldPair),
        );
        expect(outputArtifacts(warmPair), `${pairId}: warm/cold artifact mismatch`).toEqual(
          outputArtifacts(coldPair),
        );
        warmColdComparisons += 1;

        const changedRustKeys = changedFields(
          buildRustV2Options(base, GOLDEN_RUNTIME),
          buildRustV2Options(pairOptions, GOLDEN_RUNTIME),
        );
        const changedSemanticNodes = changedFields(
          coldBase.processingSummary.logicalStageDigests,
          coldPair.processingSummary.logicalStageDigests,
        );
        const observedInputNodes = changedFields(
          nodeInputKeys(warmBase),
          nodeInputKeys(warmPair),
        );
        const predicted = predictedInputNodes(
          new Set([leftKey, rightKey]),
          new Set(changedSemanticNodes),
        );
        expect(observedInputNodes, `${pairId}: two-factor percolation mismatch`).toEqual(
          predicted,
        );
        exactClusterComparisons += 1;

        const observedComponents = checkpointComponentSet(coldBase, coldPair);
        const leftSingle = coldSingles.get(leftId);
        const rightSingle = coldSingles.get(rightId);
        const isolatedEffectsAvailable = leftSingle !== undefined && rightSingle !== undefined;
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
          observedInputNodes,
          observedComponents,
          introducedComponents,
          maskedComponents,
          changedOutputArtifactKinds: changedFields(
            outputArtifacts(coldBase),
            outputArtifacts(coldPair),
          ),
        };
        if (!isolatedEffectsAvailable) {
          qualificationEnabledPairs.push(pairObservation);
        } else if (introducedComponents.length > 0 || maskedComponents.length > 0) {
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
              alternates.get(leftKey)!.length * alternates.get(rightKey)!.length,
            0,
          ),
      0,
    );
    expect(enumeratedPairContrasts).toBe(expectedPairContrasts);
    const evidence = {
      protocolVersion: "chronicle-interaction-influence-ledger/v1",
      claimBoundary:
        "Exhaustive two-factor structural interaction and exact warm/cold percolation proof across every valid pair of non-baseline declared equivalence-class values for all 46 computational browser axes, on the deterministic configuration-influence-probes corpus. Invalid selected-timezone combinations are enumerated with their qualification reason. This does not claim numeric statistical additivity or exhaust interactions of arity three and above.",
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
        exactClusterComparisons,
        nonAdditivePairs: nonAdditivePairs.length,
        qualificationEnabledPairs: qualificationEnabledPairs.length,
      },
      invalidSingles,
      invalidPairs,
      qualificationEnabledPairs,
      nonAdditivePairs,
      pairCaseDigest: await sha256Uri(pairCases.sort().join("\n")),
    };
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    if (UPDATE) {
      mkdirSync(dirname(EXPECTED_FILE), { recursive: true });
      writeFileSync(EXPECTED_FILE, serialized, "utf8");
      return;
    }
    expect(existsSync(EXPECTED_FILE), "missing interaction influence ledger").toBe(true);
    expect(serialized).toBe(readFileSync(EXPECTED_FILE, "utf8"));
  }, 600_000);
});
