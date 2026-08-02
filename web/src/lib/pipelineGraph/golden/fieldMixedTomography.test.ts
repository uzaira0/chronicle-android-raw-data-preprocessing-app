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
import { ALL_ON, GOLDEN_RUNTIME } from "@/testSupport/rustCampaignGraph";
import { buildRustV2Options } from "@/lib/rustPipelineRuntime";
import type { BrowserProcessingOptions } from "@/lib/types";
import {
  buildArtifactFixtureState,
  buildArtifactInterventions,
  SUPPORT_ROLE_IDS,
  type ArtifactFixtureState,
  type ArtifactIntervention,
} from "@/testSupport/artifactInterventions";
import { configurationEquivalenceClasses } from "@/testSupport/configurationEquivalenceClasses";
import {
  buildSyntheticCatalog,
  generateSyntheticChronicleCorpus,
  SYNTHETIC_CORPUS_PROFILES,
} from "@/testSupport/syntheticChronicleCorpus";
import {
  outputCellDependencies,
  outputColumnMatches,
  type RustStepContract,
} from "@/testSupport/rustStepContract";
import {
  captureCanonicalOutputCells,
  changedCellAddresses,
} from "@/testSupport/outputCellTomography";
import { dependencyCampaignRuntimeBytes } from "@/testSupport/dependencyCampaignRuntime";
import * as runtime from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

const EXPECTED_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "family-expected",
);
const AGGREGATE_FILE = join(
  EXPECTED_DIRECTORY,
  "field-mixed-tomography-ledger.json",
);
const UPDATE = process.env.UPDATE_FIELD_MIXED === "1";
const SHARD_COLUMN = process.env.FIELD_MIXED_COLUMN;
/** Deterministic sample size for the predicted-unaffected control axes. */
const CONTROL_AXES = Number(process.env.FIELD_MIXED_CONTROL_AXES ?? "4");
const encoder = new TextEncoder();

type RuntimeManifest = {
  implementation: string;
  implementationDigest: string;
  planDigest: string;
  profileDigest: string;
  profileLockDigest: string;
  runtimeAuthorityDigest: string;
  productContractDigest: string;
  openObligations: unknown[];
  processingSummary: {
    logicalStageDigests: Record<string, string>;
    pipelineStepDigests: Record<string, string>;
    [key: string]: unknown;
  };
  stepExecutions: Array<{ step_id: string; status: string }>;
};

type AxisValue = { label: string; value: unknown };

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

function sha256Uri(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function changedKeys(
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

type Observation = {
  manifest: RuntimeManifest;
  /** Canonical researcher-visible cell surface, address → value. */
  cells: Record<string, string>;
};

function execute(
  state: ArtifactFixtureState,
  options: BrowserProcessingOptions,
  label: string,
): Observation {
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
        requestId: label,
        command: "ExecuteWorkspace",
        workspaceRootDigest: null,
        workspaceId: sha256Uri(`field-mixed:${label}`),
        inputFileName: "field-mixed-tomography.csv",
        inputSha256: sha256Uri(state.rawCsv),
        options: buildRustV2Options(options, GOLDEN_RUNTIME),
      }),
      rawBytes,
      supports,
    );
    return {
      manifest: JSON.parse(handle.manifest_json()) as RuntimeManifest,
      cells: captureCanonicalOutputCells(handle),
    };
  } finally {
    handle?.free();
    supports.free();
  }
}

/** Forward closure of the declared field edges from one supplied column. */
function reachableFields(seed: string): Set<string> {
  const edges = stepContract.steps.flatMap((step) => step.fieldEdges);
  const reached = new Set([seed]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const edge of edges) {
      if (reached.has(edge.to)) continue;
      if (edge.from.some((field) => reached.has(field))) {
        reached.add(edge.to);
        grew = true;
      }
    }
  }
  return reached;
}

/**
 * The declared step cone of a supplied column: every step that reads or writes
 * a field the column can reach. It selects which configuration axes are
 * predicted to interact with the column; it is not itself asserted against
 * step checkpoint digests, because a step's checkpoint also moves when it
 * merely carries a changed field through its output records without reading it.
 */
function declaredStepCone(sourceField: string): string[] {
  const reached = reachableFields(sourceField);
  return stepContract.steps
    .filter((step) =>
      [...step.fieldReads, ...step.fieldWrites].some((field) =>
        reached.has(field),
      ),
    )
    .map(({ id }) => id)
    .sort();
}

/**
 * The declared output-cell reach of a supplied column: every `<kind>#<column>`
 * family whose declared dependencies include a field the column can reach.
 * This is the prediction the campaign falsifies — every canonical cell that
 * actually changes must belong to one of these families.
 */
function declaredCellReach(sourceField: string): Set<string> {
  const reached = reachableFields(sourceField);
  return new Set(
    stepContract.outputCellBindings
      .filter((binding) =>
        outputCellDependencies(stepContract, binding).some((field) =>
          reached.has(field),
        ),
      )
      .map((binding) => `${binding.outputKind}#${binding.column}`),
  );
}

/** `(kind, column)` of one observed canonical output cell address. */
function cellFamilyOf(address: string): { kind: string; column: string } {
  const separator = address.indexOf("#");
  if (separator < 0) throw new Error(`malformed cell address ${address}`);
  const kind = address.slice(0, separator);
  const path = address.slice(separator + 1);
  if (!kind.endsWith("-csv")) return { kind, column: path };
  const segments = path.split("/");
  if (segments.length >= 4 && segments[1] === "rows") {
    return { kind, column: segments[segments.length - 1] ?? "" };
  }
  return { kind, column: segments.slice(1).join("/") };
}

/** Declared families, as observed-family strings, that cover an address. */
function coveringFamily(
  declared: ReadonlySet<string>,
  address: string,
): string | undefined {
  const observed = cellFamilyOf(address);
  for (const family of declared) {
    const separator = family.indexOf("#");
    if (family.slice(0, separator) !== observed.kind) continue;
    if (outputColumnMatches(family.slice(separator + 1), observed.column)) {
      return family;
    }
  }
  return undefined;
}

function changedSteps(source: Observation, target: Observation): string[] {
  return changedKeys(
    source.manifest.processingSummary.pipelineStepDigests,
    target.manifest.processingSummary.pipelineStepDigests,
  );
}

/** The declared families an intervention actually moved under one configuration. */
function movedFamilies(
  declared: ReadonlySet<string>,
  source: Observation,
  target: Observation,
): { families: string[]; addresses: number; undeclared: string[] } {
  const addresses = changedCellAddresses(source.cells, target.cells);
  const families = new Set<string>();
  const undeclared = new Set<string>();
  for (const address of addresses) {
    const family = coveringFamily(declared, address);
    if (family) families.add(family);
    else undeclared.add(`${cellFamilyOf(address).kind}#${cellFamilyOf(address).column}`);
  }
  return {
    families: [...families].sort(),
    addresses: addresses.length,
    undeclared: [...undeclared].sort(),
  };
}

/** Every alternate value of every computational axis, one per axis. */
function axisAlternates(
  base: BrowserProcessingOptions,
): Array<{ key: string; alternate: AxisValue }> {
  return COMPUTATIONAL_BROWSER_OPTION_KEYS.flatMap((key) => {
    const alternate = configurationEquivalenceClasses(key).find(
      ({ value }) =>
        JSON.stringify(value) !==
        JSON.stringify((base as unknown as Record<string, unknown>)[key]),
    );
    if (!alternate) return [];
    if (!validConfiguration(withValue(base, key, alternate.value))) return [];
    return [{ key, alternate }];
  });
}

/** Which exact request fields a browser axis actually moves. */
function exactFieldsMovedBy(
  base: BrowserProcessingOptions,
  key: string,
  alternate: AxisValue,
): string[] {
  return changedKeys(
    buildRustV2Options(base, GOLDEN_RUNTIME),
    buildRustV2Options(withValue(base, key, alternate.value), GOLDEN_RUNTIME),
  );
}

/** Every supplied source column an intervention in the catalog rewrites. */
function interventionColumns(
  interventions: readonly ArtifactIntervention[],
): string[] {
  return [
    ...new Set(
      interventions
        .filter(({ expectedSemanticEffect }) => expectedSemanticEffect === "required")
        .flatMap(({ sourceFields }) => sourceFields)
        .filter((field) => field.includes(".") && !field.startsWith("source.")),
    ),
  ].sort();
}

describe("per-field mixed source × configuration tomography", () => {
  if (!SHARD_COLUMN) {
    it("binds every per-field shard into one aggregate receipt", () => {
      // The shard runner asks this suite for the campaign's column list rather
      // than restating it, so the two cannot disagree.
      const listOutput = process.env.FIELD_MIXED_LIST_OUTPUT;
      if (listOutput) {
        const firstProfile = SYNTHETIC_CORPUS_PROFILES[0];
        if (!firstProfile) throw new Error("no synthetic corpus profiles");
        const corpus = generateSyntheticChronicleCorpus(firstProfile, catalog);
        const rewritten = interventionColumns(
          buildArtifactInterventions({ corpus, catalog }),
        );
        // A supplied column no step declares as read has no reach to cross with
        // configuration. `filter_file.app_filter_category` is the checked
        // example: only the review UI renders it. Such columns are reported so
        // the aggregate names them instead of silently dropping them.
        const columns = rewritten.filter(
          (column) => declaredCellReach(column).size > 0,
        );
        writeFileSync(
          listOutput,
          `${JSON.stringify(
            {
              columns,
              withoutDeclaredReach: rewritten.filter(
                (column) => !columns.includes(column),
              ),
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
        return;
      }
      expect(existsSync(AGGREGATE_FILE), "missing field-mixed ledger").toBe(
        true,
      );
      const aggregate = JSON.parse(readFileSync(AGGREGATE_FILE, "utf8")) as {
        protocolVersion: string;
        columnsWithoutDeclaredReach: string[];
        columnShards: Array<{
          sourceField: string;
          path: string;
          contentDigest: string;
        }>;
      };
      expect(aggregate.protocolVersion).toBe(
        "chronicle-field-mixed-tomography-aggregate/v1",
      );
      for (const column of aggregate.columnsWithoutDeclaredReach) {
        expect(
          declaredCellReach(column).size,
          `${column}: recorded as unreachable but the contract now declares a reach`,
        ).toBe(0);
      }
      for (const shard of aggregate.columnShards) {
        const bytes = readFileSync(join(EXPECTED_DIRECTORY, shard.path), "utf8");
        expect(sha256Uri(bytes)).toBe(shard.contentDigest);
      }
    });
    return;
  }

  it("proves the declared reach of one source column across the configuration axes", () => {
    const baseOptions = ALL_ON;
    const cone = declaredStepCone(SHARD_COLUMN);
    expect(
      cone.length,
      `${SHARD_COLUMN}: a column with no declared step cone cannot be campaigned`,
    ).toBeGreaterThan(0);

    // Find a corpus whose intervention on exactly this column is not inert.
    // A candidate that already moves canonical cells at the base configuration
    // is preferred; one that only moves a logical stage checkpoint is accepted,
    // because a column can be silent at the base configuration and visible
    // under another value of an axis the cross is about to execute.
    type Selection = {
      corpusId: string;
      seed: number;
      intervention: ArtifactIntervention;
      source: ArtifactFixtureState;
      target: ArtifactFixtureState;
      movedCellsAtBase: boolean;
    };
    let selected: Selection | undefined;
    let activationExecutions = 0;
    for (const profile of SYNTHETIC_CORPUS_PROFILES) {
      if (selected?.movedCellsAtBase) break;
      const corpus = generateSyntheticChronicleCorpus(profile, catalog);
      const source = buildArtifactFixtureState({
        corpus,
        catalog,
        filterCsv,
        forcingCsv,
        backgroundCsv,
      });
      const candidates = buildArtifactInterventions({ corpus, catalog }).filter(
        (candidate) =>
          candidate.expectedSemanticEffect === "required" &&
          candidate.sourceFields.includes(SHARD_COLUMN),
      );
      if (candidates.length === 0) continue;
      const baseline = execute(
        source,
        baseOptions,
        `activate-base-${corpus.id}`,
      );
      activationExecutions += 1;
      for (const candidate of candidates) {
        const target = candidate.apply(source);
        const observed = execute(
          target,
          baseOptions,
          `activate-${corpus.id}-${candidate.id}`,
        );
        activationExecutions += 1;
        const movedStages =
          changedKeys(
            baseline.manifest.processingSummary.logicalStageDigests,
            observed.manifest.processingSummary.logicalStageDigests,
          ).length > 0;
        if (!movedStages) continue;
        const movedCellsAtBase =
          changedCellAddresses(baseline.cells, observed.cells).length > 0;
        if (!selected || movedCellsAtBase) {
          selected = {
            corpusId: corpus.id,
            seed: corpus.seed,
            intervention: candidate,
            source,
            target,
            movedCellsAtBase,
          };
        }
        if (movedCellsAtBase) break;
      }
    }
    expect(
      selected,
      `${SHARD_COLUMN}: no corpus and intervention activates this column`,
    ).toBeDefined();
    const chosen = selected!;

    const coneSet = new Set(cone);
    const axes = axisAlternates(baseOptions);
    const predicted: Array<{ key: string; alternate: AxisValue }> = [];
    const unpredicted: Array<{ key: string; alternate: AxisValue }> = [];
    const coneRequestFields = new Set(
      stepContract.steps
        .filter((step) => coneSet.has(step.id))
        .flatMap((step) => step.requestFields),
    );
    for (const axis of axes) {
      const moved = exactFieldsMovedBy(baseOptions, axis.key, axis.alternate);
      if (moved.some((field) => coneRequestFields.has(field))) predicted.push(axis);
      else unpredicted.push(axis);
    }
    // Deterministic control sample: the first N predicted-unaffected axes in
    // contract order. Running every one of them proves nothing extra and the
    // sample is what the ledger records.
    const controls = unpredicted.slice(0, Math.max(0, CONTROL_AXES));

    const declaredReach = declaredCellReach(SHARD_COLUMN);
    expect(
      declaredReach.size,
      `${SHARD_COLUMN}: a column with no declared output-cell reach cannot be campaigned`,
    ).toBeGreaterThan(0);

    const baseSource = execute(chosen.source, baseOptions, "base-source");
    const baseTarget = execute(chosen.target, baseOptions, "base-target");
    const baseMoved = movedFamilies(declaredReach, baseSource, baseTarget);

    /** Observed families with no declared binding, keyed by configuration. */
    const undeclaredFamilies = new Map<string, string[]>();
    const recordUndeclared = (family: string, axisId: string) => {
      const seen = undeclaredFamilies.get(family);
      if (seen) seen.push(axisId);
      else undeclaredFamilies.set(family, [axisId]);
    };
    for (const family of baseMoved.undeclared) recordUndeclared(family, "base");

    const observations: Array<Record<string, unknown>> = [];
    const witnessedFamilies = new Set(baseMoved.families);
    // Step checkpoints are recorded as context only. A step's checkpoint also
    // moves when it merely carries a changed field through its records, so it
    // is a coarser signal than the cell-level claim being gated here.
    const observedSteps = new Set(changedSteps(baseSource, baseTarget));

    let executions = 2;
    const runAxis = (
      axis: { key: string; alternate: AxisValue },
      predictedAffected: boolean,
    ) => {
      const options = withValue(baseOptions, axis.key, axis.alternate.value);
      const axisId = `${axis.key}=${axis.alternate.label}`;
      const axisSource = execute(chosen.source, options, `src-${axisId}`);
      const axisTarget = execute(chosen.target, options, `tgt-${axisId}`);
      executions += 2;
      for (const step of changedSteps(axisSource, axisTarget)) {
        observedSteps.add(step);
      }
      const moved = movedFamilies(declaredReach, axisSource, axisTarget);
      for (const family of moved.families) witnessedFamilies.add(family);
      for (const family of moved.undeclared) recordUndeclared(family, axisId);
      const introduced = moved.families.filter(
        (family) => !baseMoved.families.includes(family),
      );
      const masked = baseMoved.families.filter(
        (family) => !moved.families.includes(family),
      );
      observations.push({
        axisId,
        predictedAffected,
        changedCellAddresses: moved.addresses,
        changedCellFamilies: moved.families.length,
        sameFamiliesAsBaseConfiguration:
          introduced.length === 0 && masked.length === 0,
        introducedFamilies: introduced,
        maskedFamilies: masked,
      });
      return { introduced, masked };
    };

    for (const axis of predicted) {
      runAxis(axis, true);
    }
    // A control axis is one no step in the declared cone reads. It may still
    // change how many rows exist, so a family it stops moving is recorded;
    // a family it *introduces* would mean the column reaches further under
    // that configuration than the declaration allows, and is a violation.
    const controlViolations: string[] = [];
    for (const axis of controls) {
      const { introduced } = runAxis(axis, false);
      if (introduced.length > 0) {
        controlViolations.push(
          `${axis.key}=${axis.alternate.label}: ${introduced.join(", ")}`,
        );
      }
    }

    // The hard gate. Under every executed configuration, every canonical cell
    // the intervened column moves belongs to a declared output-cell family of
    // that column, and no axis outside the column's declared cone widens that
    // set.
    expect(
      [...undeclaredFamilies.keys()].sort(),
      `${SHARD_COLUMN}: a canonical cell outside the declared output-cell reach changed`,
    ).toEqual([]);
    expect(
      controlViolations,
      `${SHARD_COLUMN}: an axis the declaration predicts cannot interact widened the observed reach`,
    ).toEqual([]);
    // Containment over an empty observation is vacuous. At least one executed
    // configuration must actually carry this column into a canonical cell.
    expect(
      witnessedFamilies.size,
      `${SHARD_COLUMN}: no executed configuration moved a canonical output cell`,
    ).toBeGreaterThan(0);

    const declaredFamilies = [...declaredReach].sort();
    const ledger = {
      protocolVersion: "chronicle-field-mixed-tomography/v1",
      sourceField: SHARD_COLUMN,
      claimBoundary:
        "One supplied source column, one empirically branch-activating intervention on it, crossed with every computational configuration axis the field-level step contract predicts can interact with that column, plus a deterministic control sample of axes it predicts cannot. Under every configuration executed, every canonical output cell the intervention changes belongs to a declared output-cell family of that column, and no control axis introduces a family the base configuration did not move. Declared families no configuration moved are listed, not asserted: a declared edge no run exercised is not evidence the edge is unreal. Changed step checkpoints are recorded as context only, because a step checkpoint also moves when the step merely carries a changed field through its records.",
      implementationReceipt: {
        implementation: baseSource.manifest.implementation,
        implementationDigest: baseSource.manifest.implementationDigest,
        planDigest: baseSource.manifest.planDigest,
        profileDigest: baseSource.manifest.profileDigest,
        profileLockDigest: baseSource.manifest.profileLockDigest,
        runtimeAuthorityDigest: baseSource.manifest.runtimeAuthorityDigest,
        productContractDigest: baseSource.manifest.productContractDigest,
      },
      fixture: {
        corpusId: chosen.corpusId,
        seed: chosen.seed,
        interventionId: chosen.intervention.id,
        roleId: chosen.intervention.roleId,
        sourceFields: chosen.intervention.sourceFields,
        movedCanonicalCellsAtBaseConfiguration: chosen.movedCellsAtBase,
      },
      declaredStepCone: cone,
      declaredCellFamilies: declaredFamilies,
      coverage: {
        computationalAxes: axes.length,
        predictedAffectedAxes: predicted.length,
        predictedUnaffectedAxes: unpredicted.length,
        controlAxesExecuted: controls.length,
        activationExecutions,
        crossExecutions: executions,
        totalRustExecutions: activationExecutions + executions,
      },
      baseConfigurationChangedFamilies: baseMoved.families,
      baseConfigurationChangedCellAddresses: baseMoved.addresses,
      witnessedCellFamiliesAcrossAllConfigurations: [
        ...witnessedFamilies,
      ].sort(),
      structurallyDeclaredButUnwitnessedFamilies: declaredFamilies.filter(
        (family) => !witnessedFamilies.has(family),
      ),
      observedStepsAcrossAllConfigurations: [...observedSteps].sort(),
      stepsOutsideDeclaredConeCarryingChangedFields: [...observedSteps]
        .filter((step) => !coneSet.has(step))
        .sort(),
      axisObservations: observations,
    };
    const path = join(
      EXPECTED_DIRECTORY,
      `field-mixed-tomography-${SHARD_COLUMN.replace(/[^A-Za-z0-9_]/g, "-")}.json`,
    );
    const serialized = `${JSON.stringify(ledger, null, 2)}\n`;
    if (UPDATE) {
      mkdirSync(EXPECTED_DIRECTORY, { recursive: true });
      writeFileSync(path, serialized, "utf8");
      return;
    }
    expect(existsSync(path), `missing field-mixed ledger for ${SHARD_COLUMN}`).toBe(
      true,
    );
    expect(serialized).toBe(readFileSync(path, "utf8"));
  }, 1_800_000);
});
