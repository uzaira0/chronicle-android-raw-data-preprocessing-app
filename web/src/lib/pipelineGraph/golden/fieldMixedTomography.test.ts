import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import filterCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?raw";
import forcingCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?raw";
import backgroundCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?raw";
import codebookCsv from "@/assets/defaults/unified_app_codebook.csv?raw";
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
  type RustWorkflowContract,
} from "@/testSupport/workflowContract";
import {
  changedFields,
  type CampaignRuntimeManifest,
} from "@/testSupport/campaignManifest";
import {
  captureCanonicalOutputCells,
  changedCellAddresses,
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
const CONTROL_AXES = (() => {
  const parsed = Number(process.env.FIELD_MIXED_CONTROL_AXES ?? "4");
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(
      `FIELD_MIXED_CONTROL_AXES must be a non-negative integer, got: ${process.env.FIELD_MIXED_CONTROL_AXES}`,
    );
  }
  return parsed;
})();
const encoder = new TextEncoder();

type AxisValue = { label: string; value: unknown };

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
  const queryIds = workflowContract.execution.queries.map(({ id }) => id);
  expect(queryIds.length).toBeGreaterThan(0);
  expect(new Set(queryIds).size).toBe(queryIds.length);
}, CAMPAIGN_RUNTIME_INIT_TIMEOUT_MS);

function sha256Uri(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

type Observation = {
  manifest: CampaignRuntimeManifest;
  /** Canonical researcher-visible cell surface, address → value. */
  cells: Record<string, string>;
};

function execute(
  state: ArtifactFixtureState,
  options: BrowserProcessingOptions,
  label: string,
): Observation {
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
      requestId: label,
      command: "ExecuteWorkspace",
      workspaceRootDigest: null,
      workspaceId: sha256Uri(`field-mixed:${label}`),
      inputFileName: "field-mixed-tomography.csv",
      inputSha256: sha256Uri(executionState.rawCsv),
      options: buildRustV2Options(options, GOLDEN_RUNTIME),
    });
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
    return {
      manifest: JSON.parse(handle.manifest_json()) as CampaignRuntimeManifest,
      cells: captureCanonicalOutputCells(handle),
    };
  } finally {
    handle?.free();
    supports.free();
  }
}

/** Forward closure of the declared field edges from one supplied column. */
function reachableFields(seed: string): Set<string> {
  const edges = workflowContract.execution.queries.flatMap(
    (query) => query.fieldEdges,
  );
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
 * The declared query cone of a supplied column: every query that reads or writes
 * a field the column can reach. It selects which configuration axes are
 * predicted to interact with the column; it is not itself asserted against
 * query checkpoint digests, because a query's checkpoint also moves when it
 * merely carries a changed field through its output records without reading it.
 */
function declaredQueryCone(sourceField: string): string[] {
  const reached = reachableFields(sourceField);
  return workflowContract.execution.queries
    .filter((query) =>
      [...query.fieldReads, ...query.fieldWrites].some((field) =>
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
    workflowContract.semantic.outputCellBindings
      .filter((binding) =>
        outputCellDependencies(workflowContract, binding).some((field) =>
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

function changedQueries(source: Observation, target: Observation): string[] {
  return changedFields(
    source.manifest.processingSummary.workflowQueryDigests,
    target.manifest.processingSummary.workflowQueryDigests,
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
    else
      undeclared.add(
        `${cellFamilyOf(address).kind}#${cellFamilyOf(address).column}`,
      );
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
    const baseValue = (base as unknown as Record<string, unknown>)[key];
    const alternate = configurationEquivalenceClasses(key).find(({ value }) => {
      const differsFromBase =
        JSON.stringify(value) !== JSON.stringify(baseValue);
      return differsFromBase && validConfiguration(withValue(base, key, value));
    });
    if (!alternate) return [];
    return [{ key, alternate }];
  });
}

/** Which exact request fields a browser axis actually moves. */
function exactFieldsMovedBy(
  base: BrowserProcessingOptions,
  key: string,
  alternate: AxisValue,
): string[] {
  return changedFields(
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
        .filter(
          ({ expectedSemanticEffect }) => expectedSemanticEffect === "required",
        )
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
        const interventions = buildArtifactInterventions({ corpus, catalog });
        const rewritten = interventionColumns(
          interventions.filter(
            (intervention) => !isCapabilityEvidenceIntervention(intervention),
          ),
        );
        const sourceSensitiveCapabilityColumns = interventionColumns(
          interventions.filter(isCapabilityEvidenceIntervention),
        );
        // A supplied column no query declares as read has no reach to cross with
        // configuration. `raw_chronicle_csv.possible_device_model` is the
        // checked example: it is carried to the output but never computed on.
        // (`filter_file.app_filter_category` was this example until the B10
        // package-exclusion axis made it a read column.) Such columns are
        // reported so the aggregate names them instead of silently dropping
        // them.
        const columns = rewritten.filter(
          (column) => declaredCellReach(column).size > 0,
        );
        for (const column of columns) {
          expect(
            interventions.some(
              (intervention) =>
                !isCapabilityEvidenceIntervention(intervention) &&
                intervention.expectedSemanticEffect === "required" &&
                intervention.sourceFields.includes(column),
            ),
            `${column}: listed generic field shard has no executable candidate`,
          ).toBe(true);
        }
        writeFileSync(
          listOutput,
          `${JSON.stringify(
            {
              columns,
              sourceSensitiveCapabilityColumns,
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
        sourceSensitiveCapabilityColumns: string[];
        columnShards: Array<{
          sourceField: string;
          path: string;
          contentDigest: string;
        }>;
      };
      expect(aggregate.protocolVersion).toBe(
        "chronicle-field-mixed-tomography-aggregate/v2",
      );
      expect(aggregate.sourceSensitiveCapabilityColumns).toEqual(
        buildArtifactInterventions({
          corpus: generateSyntheticChronicleCorpus(
            SYNTHETIC_CORPUS_PROFILES[0]!,
            catalog,
          ),
          catalog,
        })
          .filter(isCapabilityEvidenceIntervention)
          .flatMap(({ sourceFields }) => sourceFields)
          .filter((field, index, fields) => fields.indexOf(field) === index)
          .sort(),
      );
      for (const column of aggregate.columnsWithoutDeclaredReach) {
        expect(
          declaredCellReach(column).size,
          `${column}: recorded as unreachable but the contract now declares a reach`,
        ).toBe(0);
      }
      // Completeness: the aggregate must carry one shard for EVERY enumerated
      // generic column -- a FIELD_MIXED_ONLY-truncated recording otherwise
      // verifies green (mirrors the sibling campaign's roleShards check).
      {
        const enumeratedCorpus = generateSyntheticChronicleCorpus(
          SYNTHETIC_CORPUS_PROFILES[0]!,
          catalog,
        );
        const enumeratedColumns = interventionColumns(
          buildArtifactInterventions({
            corpus: enumeratedCorpus,
            catalog,
          }).filter(
            (intervention) => !isCapabilityEvidenceIntervention(intervention),
          ),
        ).filter((column) => declaredCellReach(column).size > 0);
        expect(
          aggregate.columnShards.map(({ sourceField }) => sourceField).sort(),
          "aggregate column shards do not cover every enumerated generic column",
        ).toEqual([...enumeratedColumns].sort());
      }
      for (const shard of aggregate.columnShards) {
        const bytes = readFileSync(
          join(EXPECTED_DIRECTORY, shard.path),
          "utf8",
        );
        expect(sha256Uri(bytes)).toBe(shard.contentDigest);
      }
    });
    return;
  }

  it("proves the declared reach of one source column across the configuration axes", () => {
    const baseOptions = ALL_ON;
    const cone = declaredQueryCone(SHARD_COLUMN);
    expect(
      cone.length,
      `${SHARD_COLUMN}: a column with no declared query cone cannot be campaigned`,
    ).toBeGreaterThan(0);

    // Find a corpus whose intervention on exactly this column is not inert.
    // A candidate that already moves canonical cells at the base configuration
    // is preferred; one that only moves a workflow query-group checkpoint is accepted,
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
          !isCapabilityEvidenceIntervention(candidate) &&
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
          changedFields(
            baseline.manifest.processingSummary.workflowQueryGroupDigests,
            observed.manifest.processingSummary.workflowQueryGroupDigests,
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
    const allAxes = axisAlternates(baseOptions);
    expect(allAxes).toHaveLength(COMPUTATIONAL_BROWSER_OPTION_KEYS.length);
    const sourceSensitiveCompoundAxes =
      chosen.intervention.roleId === "raw_chronicle_csv"
        ? allAxes.filter(({ key, alternate }) =>
            usesInputCapabilityEvidence(
              withValue(baseOptions, key, alternate.value),
            ),
          )
        : [];
    const axes = allAxes.filter(
      (axis) => !sourceSensitiveCompoundAxes.includes(axis),
    );
    const predicted: Array<{ key: string; alternate: AxisValue }> = [];
    const unpredicted: Array<{ key: string; alternate: AxisValue }> = [];
    const coneRequestFields = new Set(
      workflowContract.execution.queries
        .filter((query) => coneSet.has(query.id))
        .flatMap((query) => query.requestFields),
    );
    for (const axis of axes) {
      const moved = exactFieldsMovedBy(baseOptions, axis.key, axis.alternate);
      if (moved.some((field) => coneRequestFields.has(field)))
        predicted.push(axis);
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
    // Query checkpoints are recorded as context only. A query's checkpoint also
    // moves when it merely carries a changed field through its records, so it
    // is a coarser signal than the cell-level claim being gated here.
    const observedQueries = new Set(changedQueries(baseSource, baseTarget));

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
      for (const query of changedQueries(axisSource, axisTarget)) {
        observedQueries.add(query);
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
    // A control axis is one no query in the declared cone reads. It may still
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
      protocolVersion: "chronicle-field-mixed-tomography/v2",
      sourceField: SHARD_COLUMN,
      claimBoundary:
        "One supplied source column, one empirically branch-activating intervention on it, crossed with every non-compound computational configuration axis the field-level workflow contract predicts can interact with that column, plus a deterministic control sample of axes it predicts cannot. For raw-column shards, Parry/Zhu/Schoedel alternates that would necessarily rebind the digest-bound capability sidecar are explicitly excluded and remain unestimated as compound raw+capability interactions; the configuration-space sourceSensitiveScientificCells domain separately proves the generic LF-sidecar to CRLF-raw Parry rebind mechanism, not every excluded pair. Under every configuration executed, every canonical output cell the intervention changes belongs to a declared output-cell family of that column, and no control axis introduces a family the base configuration did not move. Declared families no configuration moved are listed, not asserted: a declared edge no run exercised is not evidence the edge is unreal. Changed query checkpoints are recorded as context only, because a query checkpoint also moves when the query merely carries a changed field through its records.",
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
      declaredQueryCone: cone,
      declaredCellFamilies: declaredFamilies,
      coverage: {
        computationalAxes: allAxes.length,
        directlyCrossedAxes: axes.length,
        sourceSensitiveCompoundAxes: sourceSensitiveCompoundAxes.map(
          ({ key, alternate }) => `${key}=${alternate.label}`,
        ),
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
      observedQueriesAcrossAllConfigurations: [...observedQueries].sort(),
      queriesOutsideDeclaredConeCarryingChangedFields: [...observedQueries]
        .filter((query) => !coneSet.has(query))
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
    expect(
      existsSync(path),
      `missing field-mixed ledger for ${SHARD_COLUMN}`,
    ).toBe(true);
    expect(serialized).toBe(readFileSync(path, "utf8"));
  }, CAMPAIGN_TEST_TIMEOUT_MS);
});
