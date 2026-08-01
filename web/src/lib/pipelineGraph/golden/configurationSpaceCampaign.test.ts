import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import filterCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?raw";
import forcingCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?raw";
import backgroundCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?raw";
import codebookCsv from "@/assets/defaults/unified_app_codebook.csv?raw";
import {
  ANNOTATION_BROWSER_OPTION_KEYS,
  BROWSER_PROCESSING_OPTION_KEYS,
  COMPUTATIONAL_BROWSER_OPTION_KEYS,
  EXECUTION_BROWSER_OPTION_KEYS,
  VIEW_BROWSER_OPTION_KEYS,
} from "@/lib/generatedContract";

const RUNTIME_ARTIFACT_REQUEST_FIELDS = new Set([
  "enable_parquet_export",
  "enable_spss_export",
  "enable_plotting",
  "enable_activity_heatmap",
  "export_plots_as_svg",
  "enable_interactive_timeline",
  "include_filtered_app_usage_in_plots",
]);
import {
  ALL_ON,
  GOLDEN_RUNTIME,
  descendantsOf,
  order,
} from "@/testSupport/rustCampaignGraph";
import { buildRustV2Options } from "@/lib/rustPipelineRuntime";
import type { BrowserProcessingOptions } from "@/lib/types";
import {
  buildCodebookSlice,
  buildSyntheticCatalog,
  generateSyntheticChronicleCorpus,
  QUALIFICATION_CORPUS_PROFILE,
  SYNTHETIC_CORPUS_PROFILES,
  type SyntheticChronicleCorpus,
} from "@/testSupport/syntheticChronicleCorpus";
import { dependencyCampaignRuntimeBytes } from "@/testSupport/dependencyCampaignRuntime";
import * as runtime from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";
import { configurationEquivalenceClasses } from "@/testSupport/configurationEquivalenceClasses";

import coveringT3 from "../../../../combinatorial/covering_array_t3.json";
import seededHighOrder from "../../../../combinatorial/seeded_high_order_00c0ffee.json";

const EXPECTED_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "family-expected",
  "configuration-space-campaign.json",
);
const INFLUENCE_EXPECTED_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "family-expected",
  "configuration-influence-ledger.json",
);
const UPDATE = process.env.UPDATE_CONFIGURATION_SPACE === "1";
const encoder = new TextEncoder();

type Configuration = {
  id: string;
  options: BrowserProcessingOptions;
};

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
  protocolVersion: string;
  implementation: string;
  implementationDigest: string;
  planDigest: string;
  profileDigest: string;
  profileLockDigest: string;
  runtimeAuthorityDigest: string;
  productContractDigest: string;
  workspaceId: string;
  workspaceRootDigest: string;
  openObligations: Array<{ role_id?: string; roleId?: string }>;
  counts: { original: number; processed: number; app: number; screen: number };
  processingSummary: {
    availableTimezones: string[];
    timezone: string;
    timezoneAction: string;
    rowsBeforeTimezoneHandling: number;
    rowsAfterTimezoneHandling: number;
    rowsRemovedByTimezone: number;
    timezoneRetainedSourceRowsDigest: string;
    timezoneStageDigest: string;
    logicalStageDigests: Record<string, string>;
    logicalStageCheckpoints: Record<string, TypedCheckpoint>;
    pipelineStepDigests: Record<string, string>;
    pipelineStepCheckpoints: Record<string, TypedCheckpoint>;
    publishedOutputsDigest: string;
    provenanceDigest: string;
    duplicateTimestampsCorrected: number;
    exactDuplicateRowsRemoved: number;
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

type RunResult = {
  manifest: RuntimeManifest;
  boundRoles: string[];
  capturedArtifacts: Map<string, Uint8Array>;
};

const catalog = buildSyntheticCatalog({
  codebookCsv,
  filterCsv,
  backgroundCsv,
  forcingScreenOpenCsv: forcingCsv,
});
const corpora = SYNTHETIC_CORPUS_PROFILES.map((profile) =>
  generateSyntheticChronicleCorpus(profile, catalog),
);
const qualificationCorpus = generateSyntheticChronicleCorpus(
  QUALIFICATION_CORPUS_PROFILE,
  catalog,
);
const t3Configs = coveringT3.configs as Configuration[];
const seededConfigs = seededHighOrder.configs as Configuration[];

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

function supportCsv(
  corpus: SyntheticChronicleCorpus,
  options: BrowserProcessingOptions,
  omittedRole?: string,
  bindAllSupport = false,
) {
  const firstTimestamp =
    corpus.csv.split("\n")[1]?.split(",")[7] ?? "2026-01-01 00:00:00";
  return new Map<string, { name: string; csv: string }>(
    [
      ...(bindAllSupport || options.useFilterFile
        ? [
            [
              "filter_file",
              { name: "apps-to-filter.csv", csv: filterCsv },
            ] as const,
          ]
        : []),
      ...(bindAllSupport || options.useAppsForcingScreenOpenFile
        ? [
            [
              "apps_forcing_screen_open_file",
              { name: "forcing-screen-open.csv", csv: forcingCsv },
            ] as const,
          ]
        : []),
      ...(bindAllSupport || options.useBackgroundAppsFile
        ? [
            [
              "background_apps_file",
              { name: "background-apps.csv", csv: backgroundCsv },
            ] as const,
          ]
        : []),
      ...(bindAllSupport || options.useAppCodebook
        ? [
            [
              "app_codebook_file",
              {
                name: "catalog-derived-codebook.csv",
                csv: buildCodebookSlice(catalog, corpus.usedPackages),
              },
            ] as const,
          ]
        : []),
      ...(bindAllSupport ||
      options.enableStudyWindowFilter ||
      options.addNoActivityPlaceholderDays ||
      options.enableDayCoverage
        ? [
            [
              "study_dates_file",
              {
                name: "study-dates.csv",
                csv: `participant_id,start_date,end_date\n${corpus.participantId},2026-01-01,2026-12-31\n`,
              },
            ] as const,
          ]
        : []),
      ...(bindAllSupport ||
      options.enablePersonAttribution ||
      options.enableComplianceScoring
        ? [
            [
              "device_sharing_file",
              {
                name: "device-sharing.csv",
                csv: `participant_id,sharing_status\n${corpus.participantId},Shared\n`,
              },
            ] as const,
          ]
        : []),
      ...(bindAllSupport || options.enablePersonAttribution
        ? [
            [
              "survey_attribution_file",
              {
                name: "survey-attribution.csv",
                csv: `participant_id,event_timestamp,users\n${corpus.participantId},${firstTimestamp},Target Child\n`,
              },
            ] as const,
          ]
        : []),
      ...(bindAllSupport || options.enableComplianceScoring
        ? [
            [
              "enrolled_devices_file",
              {
                name: "enrolled-devices.csv",
                csv: `participant_id,device_count\n${corpus.participantId},1\n`,
              },
            ] as const,
          ]
        : []),
    ].filter(([role]) => role !== omittedRole),
  );
}

async function execute(
  corpus: SyntheticChronicleCorpus,
  config: Configuration,
  identity: string,
  previousRoot: string | null = null,
  omittedRole?: string,
  captureKinds: ReadonlySet<string> = new Set(),
  bindAllSupport = false,
): Promise<RunResult> {
  const csvBytes = encoder.encode(corpus.csv);
  const inputDigest = await sha256Uri(csvBytes);
  const workspaceId = await sha256Uri(identity);
  const supports = new runtime.RuntimeSupportFiles();
  let handle: ReturnType<typeof runtime.execute_workspace> | undefined;
  const boundRoles: string[] = [];
  try {
    for (const [role, file] of supportCsv(
      corpus,
      config.options,
      omittedRole,
      bindAllSupport,
    )) {
      supports.put_with_name(role, file.name, encoder.encode(file.csv));
      boundRoles.push(role);
    }
    try {
      handle = runtime.execute_workspace(
        JSON.stringify({
          protocolVersion: "chronicle-preprocessing-runtime/v1",
          requestId: identity,
          command: "ExecuteWorkspace",
          workspaceRootDigest: previousRoot,
          workspaceId,
          inputFileName: `${corpus.id}.csv`,
          inputSha256: inputDigest,
          options: buildRustV2Options(config.options, GOLDEN_RUNTIME),
        }),
        csvBytes,
        supports,
      );
    } catch (error) {
      throw new Error(`${identity}: ${String(error)}`, { cause: error });
    }
    const manifest = JSON.parse(handle.manifest_json()) as RuntimeManifest;
    const capturedArtifacts = new Map<string, Uint8Array>();
    for (let index = 0; index < handle.artifact_count; index += 1) {
      const metadata = JSON.parse(handle.artifact_metadata_json(index)) as {
        kind: string;
      };
      if (captureKinds.has(metadata.kind)) {
        capturedArtifacts.set(metadata.kind, handle.take_artifact_bytes(index));
      }
    }
    return { manifest, boundRoles, capturedArtifacts };
  } finally {
    handle?.free();
    supports.free();
  }
}

async function evaluateRequirements(
  corpus: SyntheticChronicleCorpus,
  config: Configuration,
  identity: string,
  omittedRole?: string,
  bindAllSupport = false,
): Promise<{
  ready: boolean;
  openObligations: Array<{ role_id: string; node_id: string | null }>;
  roleStates: Record<string, string>;
  nodeStates: Record<string, string>;
}> {
  const csvBytes = encoder.encode(corpus.csv);
  const inputDigest = await sha256Uri(csvBytes);
  const workspaceId = await sha256Uri(identity);
  const supports = new runtime.RuntimeSupportFiles();
  try {
    for (const [role, file] of supportCsv(
      corpus,
      config.options,
      omittedRole,
      bindAllSupport,
    )) {
      supports.put_with_name(role, file.name, encoder.encode(file.csv));
    }
    return JSON.parse(
      runtime.evaluate_workspace_requirements(
        JSON.stringify({
          protocolVersion: "chronicle-preprocessing-runtime/v1",
          requestId: identity,
          command: "ExecuteWorkspace",
          workspaceRootDigest: null,
          workspaceId,
          inputFileName: `${corpus.id}.csv`,
          inputSha256: inputDigest,
          options: buildRustV2Options(config.options, GOLDEN_RUNTIME),
        }),
        csvBytes,
        supports,
      ),
    ) as {
      ready: boolean;
      openObligations: Array<{ role_id: string; node_id: string | null }>;
      roleStates: Record<string, string>;
      nodeStates: Record<string, string>;
    };
  } finally {
    supports.free();
  }
}

function semanticOutcome(manifest: RuntimeManifest) {
  return {
    counts: manifest.counts,
    processingSummary: manifest.processingSummary,
  };
}

function computationalOutcome(manifest: RuntimeManifest) {
  const processingSummary = Object.fromEntries(
    Object.entries(manifest.processingSummary)
      .filter(
        ([key]) =>
          key !== "publishedOutputsDigest" && key !== "provenanceDigest",
      )
      .map(([key, value]) => [
        key,
        key === "logicalStageDigests" || key === "logicalStageCheckpoints"
          ? Object.fromEntries(
              Object.entries(value as Record<string, unknown>).filter(
                ([nodeId]) => nodeId !== "outputs",
              ),
            )
          : key === "pipelineStepDigests" || key === "pipelineStepCheckpoints"
            ? Object.fromEntries(
                Object.entries(value as Record<string, unknown>).filter(
                  ([stepId]) => stepId !== "assemble_result",
                ),
              )
            : value,
      ]),
  );
  return { counts: manifest.counts, processingSummary };
}

function changedCheckpointComponents(
  source: RuntimeManifest,
  target: RuntimeManifest,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.keys(source.processingSummary.logicalStageCheckpoints)
      .sort()
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
      .filter(([, components]) => components.length > 0),
  );
}

function changedStepCheckpointComponents(
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
      .filter(([, components]) => components.length > 0),
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
  "source-result-influence-arrow",
]);

function outputArtifacts(manifest: RuntimeManifest): Array<{
  kind: string;
  digest: string;
  size: number;
}> {
  return manifest.artifacts
    .filter(
      (artifact) =>
        OUTPUT_ARTIFACT_KINDS.has(artifact.kind) ||
        artifact.kind.startsWith("aggregate-"),
    )
    .map(({ kind, digest, size }) => ({ kind, digest, size }))
    .sort((left, right) => left.kind.localeCompare(right.kind));
}

function alternateConfiguration(key: string): Configuration {
  const baseline = ALL_ON;
  const options: BrowserProcessingOptions = { ...baseline };
  if (key === "timezoneHandling") {
    options.timezoneHandling = "selected-filter";
    return { id: `single-${key}`, options };
  }
  if (key === "selectedTimezone") {
    options.selectedTimezone = "America/New_York";
    return { id: `single-${key}`, options };
  }
  const candidate = [...t3Configs, ...seededConfigs].find(
    (config) =>
      JSON.stringify(
        config.options[key as keyof BrowserProcessingOptions] ?? null,
      ) !==
      JSON.stringify(baseline[key as keyof BrowserProcessingOptions] ?? null),
  );
  if (!candidate) throw new Error(`no alternate equivalence class for ${key}`);
  const value = candidate.options[key as keyof BrowserProcessingOptions];
  if (value === undefined)
    delete (options as unknown as Record<string, unknown>)[key];
  else (options as unknown as Record<string, unknown>)[key] = value;
  return { id: `single-${key}`, options };
}

function alternateOrthogonalConfiguration(key: string): Configuration {
  const options: BrowserProcessingOptions = { ...ALL_ON };
  const current = options[key as keyof BrowserProcessingOptions];
  if (typeof current === "boolean") {
    (options as unknown as Record<string, unknown>)[key] = !current;
  } else if (key === "parallelMaxWorkers") {
    options.parallelMaxWorkers = current === undefined ? 2 : undefined;
  } else {
    throw new Error(`no orthogonal alternate for ${key}`);
  }
  return { id: `orthogonal-${key}`, options };
}

const ACTIVE_PERTURBATION_OPTIONS: BrowserProcessingOptions = {
  ...ALL_ON,
  studyName: "Empirical Influence Study",
  selectedTimezone: "America/Chicago",
  timezoneHandling: "selected-convert",
  processAppUsage: true,
  processScreenUsage: true,
  useFilterFile: true,
  useAppsForcingScreenOpenFile: true,
  useBackgroundAppsFile: true,
  useAppCodebook: true,
  includeCategoryColumn: true,
  enableAggregates: true,
  enableParquetExport: true,
  enableSpssExport: true,
  modelConcurrentUsage: true,
  applyMinimumUsageDurationToConcurrentSubintervals: true,
  filterZeroDurationSessions: true,
  enableScreenGatedCrediting: true,
  enableStudyWindowFilter: true,
  enablePersonAttribution: true,
  enableComplianceScoring: true,
  addNoActivityPlaceholderDays: true,
  enableDayCoverage: true,
};

const INACTIVE_PERTURBATION_OPTIONS: BrowserProcessingOptions = {
  ...ACTIVE_PERTURBATION_OPTIONS,
  processAppUsage: false,
  processScreenUsage: false,
  useFilterFile: false,
  useAppsForcingScreenOpenFile: false,
  useBackgroundAppsFile: false,
  useAppCodebook: false,
  includeCategoryColumn: false,
  enableAggregates: false,
  enableParquetExport: false,
  enableSpssExport: false,
  modelConcurrentUsage: false,
  applyMinimumUsageDurationToConcurrentSubintervals: false,
  filterZeroDurationSessions: false,
  interactionTypesToRemove: [],
  enableScreenGatedCrediting: false,
  enableStudyWindowFilter: false,
  enablePersonAttribution: false,
  enableComplianceScoring: false,
  addNoActivityPlaceholderDays: false,
  enableDayCoverage: false,
};

type PerturbationContext = {
  id: string;
  options: BrowserProcessingOptions;
  eligibleLabels?: ReadonlySet<string>;
};

function perturbationContexts(key: string): PerturbationContext[] {
  const common = [
    { id: "active", options: ACTIVE_PERTURBATION_OPTIONS },
    { id: "inactive", options: INACTIVE_PERTURBATION_OPTIONS },
  ];
  if (key === "filterZeroDurationSessions") {
    return [
      ...common,
      {
        id: "literal-zero-duration",
        options: {
          ...ACTIVE_PERTURBATION_OPTIONS,
          correctDuplicateEventTimestamps: false,
          minimumUsageDuration: 0,
        },
      },
    ];
  }
  if (key === "otherInteractionTypesToStopUsageAt") {
    return [
      ...common,
      {
        id: "nonconcurrent-other-stop",
        options: {
          ...ACTIVE_PERTURBATION_OPTIONS,
          modelConcurrentUsage: false,
        },
      },
    ];
  }
  if (key !== "selectedTimezone") return common;
  return [
    ...common.map((context) => ({
      ...context,
      eligibleLabels: new Set(["america_chicago", "america_new_york"]),
    })),
    {
      id: "primary-timezone",
      options: {
        ...ACTIVE_PERTURBATION_OPTIONS,
        selectedTimezone: "",
        timezoneHandling: "primary-filter",
      },
    },
  ];
}

function configurationWithValue(
  context: PerturbationContext,
  key: string,
  label: string,
  value: unknown,
): Configuration {
  const options = { ...context.options };
  if (value === undefined) {
    delete (options as unknown as Record<string, unknown>)[key];
  } else {
    (options as unknown as Record<string, unknown>)[key] = value;
  }
  return { id: `${context.id}:${key}:${label}`, options };
}

function changedFields(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]))
    .sort();
}

function nodeInputKeys(manifest: RuntimeManifest): Record<string, string> {
  return Object.fromEntries(
    manifest.nodeExecutions.map((node) => [node.node_id, node.input_key]),
  );
}

function nodeStatuses(manifest: RuntimeManifest): Record<string, string> {
  return Object.fromEntries(
    manifest.nodeExecutions.map((node) => [node.node_id, node.status]),
  );
}

function executedStepIds(manifest: RuntimeManifest): string[] {
  return manifest.stepExecutions
    .filter((step) => step.status === "recomputed")
    .map((step) => step.step_id)
    .sort();
}

function stepStatuses(manifest: RuntimeManifest): Record<string, string> {
  return Object.fromEntries(
    manifest.stepExecutions.map((step) => [step.step_id, step.status]),
  );
}

function executedGroupIds(manifest: RuntimeManifest): string[] {
  return [
    ...new Set(
      manifest.stepExecutions
        .filter((step) => step.status === "recomputed")
        .map((step) => step.unit_id),
    ),
  ].sort();
}

function nodeOutputDigests(
  manifest: RuntimeManifest,
): Record<string, string | null> {
  return Object.fromEntries(
    manifest.nodeExecutions.map((node) => [
      node.node_id,
      node.output?.digest ?? null,
    ]),
  );
}

function outputArtifactDigests(
  manifest: RuntimeManifest,
): Record<string, string> {
  return Object.fromEntries(
    outputArtifacts(manifest).map((artifact) => [
      artifact.kind,
      artifact.digest,
    ]),
  );
}

function obligationRoles(report: {
  openObligations: Array<{ role_id: string }>;
}): string[] {
  return report.openObligations.map((obligation) => obligation.role_id).sort();
}

function authorityReceipt(manifest: RuntimeManifest) {
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe("deterministic catalog-derived synthetic corpus", () => {
  it("replays exactly and represents every support-driven application class", () => {
    for (const profile of [
      ...SYNTHETIC_CORPUS_PROFILES,
      QUALIFICATION_CORPUS_PROFILE,
    ]) {
      const first = generateSyntheticChronicleCorpus(profile, catalog);
      const second = generateSyntheticChronicleCorpus(profile, catalog);
      expect(second).toEqual(first);
      expect(first.rowCount).toBeGreaterThan(profile.sessionCount);
      expect(first.representedAppClasses).toEqual([
        "background",
        "catalog",
        "filtered",
        "forcing-screen-open",
        "unknown",
      ]);
      expect(first.usedPackages.length).toBeGreaterThanOrEqual(5);
    }
    const [profileA, profileB] = SYNTHETIC_CORPUS_PROFILES;
    if (profileA === undefined || profileB === undefined) {
      throw new Error("expected at least two synthetic corpus profiles");
    }
    expect(
      generateSyntheticChronicleCorpus(profileA, catalog).csv,
    ).not.toBe(
      generateSyntheticChronicleCorpus(profileB, catalog).csv,
    );
  });
});

describe("Rust/WASM configuration-space campaign", () => {
  it("makes every conditional support binding hole explicit and blocks execution", async () => {
    const corpus = corpora.find(
      (candidate) => candidate.id === "support-intersections",
    )!;
    const options: BrowserProcessingOptions = {
      ...ALL_ON,
      useFilterFile: true,
      useAppsForcingScreenOpenFile: true,
      useBackgroundAppsFile: true,
      useAppCodebook: true,
      enableStudyWindowFilter: true,
      addNoActivityPlaceholderDays: true,
      enableDayCoverage: true,
      enablePersonAttribution: true,
      enableComplianceScoring: true,
    };
    const config = { id: "all-required-bindings", options };
    const requiredRoles = [
      "filter_file",
      "apps_forcing_screen_open_file",
      "background_apps_file",
      "app_codebook_file",
      "study_dates_file",
      "device_sharing_file",
    ];
    const complete = await evaluateRequirements(
      corpus,
      config,
      "bindings:complete",
    );
    expect(complete.ready).toBe(true);
    expect(complete.openObligations).toEqual([]);

    for (const role of requiredRoles) {
      const report = await evaluateRequirements(
        corpus,
        config,
        `bindings:missing:${role}`,
        role,
      );
      expect(report.ready, role).toBe(false);
      expect(
        report.openObligations.some(
          (obligation) => obligation.role_id === role,
        ),
        role,
      ).toBe(true);
      await expect(
        execute(corpus, config, `bindings:execute-missing:${role}`, null, role),
      ).rejects.toThrow(new RegExp(`unresolved binding holes.*${role}`));
    }
  });

  it("executes complete t=3 coverage across every valid synthetic profile plus a high-order sample", async () => {
    const corpusReports: Array<Record<string, unknown>> = [];
    const coldDense = new Map<string, RuntimeManifest>();
    const caseIdentities: string[] = [];
    let coldExecutions = 0;

    for (const corpus of corpora) {
      const published = new Set<string>();
      const provenance = new Set<string>();
      const roots = new Set<string>();
      let minimumProcessed = Number.POSITIVE_INFINITY;
      let maximumProcessed = 0;
      for (const config of t3Configs) {
        const identity = `cold:t3:${corpus.id}:${config.id}`;
        const { manifest } = await execute(corpus, config, identity);
        coldExecutions += 1;
        expect(manifest.protocolVersion, identity).toBe(
          "chronicle-preprocessing-runtime/v1",
        );
        expect(manifest.openObligations, identity).toEqual([]);
        expect(manifest.nodeExecutions, identity).toHaveLength(15);
        expect(
          manifest.nodeExecutions.every(
            (node) => node.status !== "error" && node.status !== "skipped",
          ),
          identity,
        ).toBe(true);
        published.add(manifest.processingSummary.publishedOutputsDigest);
        provenance.add(manifest.processingSummary.provenanceDigest);
        roots.add(manifest.workspaceRootDigest);
        minimumProcessed = Math.min(
          minimumProcessed,
          manifest.counts.processed,
        );
        maximumProcessed = Math.max(
          maximumProcessed,
          manifest.counts.processed,
        );
        caseIdentities.push(
          `${identity}:${manifest.workspaceRootDigest}:${manifest.processingSummary.publishedOutputsDigest}`,
        );
        if (corpus.id === "support-intersections")
          coldDense.set(config.id, manifest);
      }
      corpusReports.push({
        corpusId: corpus.id,
        seed: corpus.seed,
        rowCount: corpus.rowCount,
        timezones: corpus.timezones,
        injectedFeatures: corpus.injectedFeatures,
        t3Executions: t3Configs.length,
        uniquePublishedOutputs: published.size,
        uniquePipelineProvenance: provenance.size,
        uniqueWorkspaceRoots: roots.size,
        processedRows: { minimum: minimumProcessed, maximum: maximumProcessed },
      });
    }

    const highOrderCorpus = corpora.find(
      (corpus) => corpus.id === "interaction-pathologies",
    )!;
    const highOrderPublished = new Set<string>();
    for (const config of seededConfigs) {
      const identity = `cold:seeded:${highOrderCorpus.id}:${config.id}`;
      const { manifest } = await execute(highOrderCorpus, config, identity);
      coldExecutions += 1;
      expect(manifest.openObligations, identity).toEqual([]);
      expect(
        manifest.nodeExecutions.every(
          (node) => node.status !== "error" && node.status !== "skipped",
        ),
        identity,
      ).toBe(true);
      highOrderPublished.add(manifest.processingSummary.publishedOutputsDigest);
      caseIdentities.push(
        `${identity}:${manifest.workspaceRootDigest}:${manifest.processingSummary.publishedOutputsDigest}`,
      );
    }

    const denseCorpus = corpora.find(
      (corpus) => corpus.id === "support-intersections",
    )!;
    const warmWorkspace = "warm:t3:support-intersections";
    let previousRoot: string | null = null;
    for (const config of t3Configs) {
      const warm = await execute(
        denseCorpus,
        config,
        warmWorkspace,
        previousRoot,
      );
      const cold = coldDense.get(config.id)!;
      expect(
        semanticOutcome(warm.manifest),
        `incremental ${config.id}`,
      ).toEqual(semanticOutcome(cold));
      previousRoot = warm.manifest.workspaceRootDigest;
    }

    // Change each computational option independently. The changed run reuses the
    // baseline workspace and must match a separate cold Rust execution. This
    // is the stale-result oracle: a missing plan binding can no longer hide
    // behind a transition that also changed some correctly-bound option.
    for (const key of COMPUTATIONAL_BROWSER_OPTION_KEYS) {
      const baseline: Configuration = {
        id: `baseline-${key}`,
        options: { ...ALL_ON },
      };
      const changed = alternateConfiguration(key);
      const baselineProjection = buildRustV2Options(
        baseline.options,
        GOLDEN_RUNTIME,
      );
      const changedProjection = buildRustV2Options(
        changed.options,
        GOLDEN_RUNTIME,
      );
      expect(
        changedProjection,
        `${key}: Rust projection must change`,
      ).not.toEqual(baselineProjection);

      const workspaceIdentity = `single-option-transition:${key}`;
      const initial = await execute(denseCorpus, baseline, workspaceIdentity);
      const warm = await execute(
        denseCorpus,
        changed,
        workspaceIdentity,
        initial.manifest.workspaceRootDigest,
      );
      const cold = await execute(
        denseCorpus,
        changed,
        `single-option-cold:${key}`,
      );
      expect(
        semanticOutcome(warm.manifest),
        `${key}: warm/cold semantic outcome`,
      ).toEqual(semanticOutcome(cold.manifest));
      expect(
        outputArtifacts(warm.manifest),
        `${key}: warm/cold output artifacts`,
      ).toEqual(outputArtifacts(cold.manifest));
    }

    // View settings are recorded in the exact Rust request/receipt but remain
    // absent from its preprocessing-semantic projection. Execution-strategy
    // settings never enter Rust. Prove both boundaries and the executable result:
    // each isolated change must produce no computational invalidation and the
    // same Rust semantic outputs/artifacts. View files and scheduling behavior
    // remain separately observable outside this preprocessing boundary.
    const orthogonalKeys = [
      ...VIEW_BROWSER_OPTION_KEYS,
      ...EXECUTION_BROWSER_OPTION_KEYS,
    ];
    const orthogonalBaseline: Configuration = {
      id: "orthogonal-baseline",
      options: { ...ALL_ON },
    };
    const preprocessingProjection = (options: BrowserProcessingOptions) => {
      const projection = {
        ...buildRustV2Options(options, GOLDEN_RUNTIME),
      };
      for (const field of [
        "enable_plotting",
        "enable_activity_heatmap",
        "export_plots_as_svg",
        "enable_interactive_timeline",
        "include_filtered_app_usage_in_plots",
        "materialize_visualization_data",
      ]) {
        delete projection[field];
      }
      return projection;
    };
    const orthogonalProjection = preprocessingProjection(
      orthogonalBaseline.options,
    );
    for (const key of orthogonalKeys) {
      const changed = alternateOrthogonalConfiguration(key);
      const workspace = `orthogonal-workspace:${key}`;
      const orthogonalBaselineRun = await execute(
        denseCorpus,
        orthogonalBaseline,
        workspace,
      );
      expect(
        preprocessingProjection(changed.options),
        `${key}: must not enter the Rust semantic projection`,
      ).toEqual(orthogonalProjection);
      const changedRun = await execute(
        denseCorpus,
        changed,
        workspace,
        orthogonalBaselineRun.manifest.workspaceRootDigest,
      );
      expect(
        computationalOutcome(changedRun.manifest),
        `${key}: upstream semantic invariance`,
      ).toEqual(computationalOutcome(orthogonalBaselineRun.manifest));
      const changedNodes = changedRun.manifest.nodeExecutions
        .filter(
          (node) => node.status === "recomputed" || node.status === "error",
        )
        .map((node) => node.node_id);
      if ((VIEW_BROWSER_OPTION_KEYS as readonly string[]).includes(key)) {
        const viewDependentKinds = new Set([
          "source-coordinate-index-arrow",
          ...(key === "enablePlotting"
            ? [
                "result-cell-correspondence-arrow",
                "source-result-influence-arrow",
                "visualization-data-json",
              ]
            : []),
        ]);
        const withoutViewDependentArtifacts = (manifest: RuntimeManifest) =>
          outputArtifacts(manifest).filter(
            (artifact) => !viewDependentKinds.has(artifact.kind),
          );
        expect(
          withoutViewDependentArtifacts(changedRun.manifest),
          `${key}: non-view artifact invariance`,
        ).toEqual(
          withoutViewDependentArtifacts(orthogonalBaselineRun.manifest),
        );
        expect(changedNodes, `${key}: exact output invalidation`).toEqual(
          key === "enablePlotting" ? ["outputs"] : [],
        );
      } else {
        expect(
          outputArtifacts(changedRun.manifest),
          `${key}: artifact invariance`,
        ).toEqual(outputArtifacts(orthogonalBaselineRun.manifest));
        expect(changedNodes, `${key}: no computational invalidation`).toEqual(
          [],
        );
      }
    }

    // studyName is not computationally inert: it is an output annotation.
    // Its exact dependency is the output node. Prove that changing it neither
    // changes upstream computation nor broadens the invalidation cone, while
    // the changed output still agrees with a separate cold execution.
    const annotationBaseline: Configuration = {
      id: "annotation-baseline",
      options: { ...ALL_ON, studyName: "Semantic Study Alpha" },
    };
    const annotationChanged: Configuration = {
      id: "annotation-changed",
      options: { ...ALL_ON, studyName: "Semantic Study Bravo" },
    };
    const captureAppCsv = new Set(["app-csv"]);
    const annotationWorkspace = "annotation-study-name";
    const annotationInitial = await execute(
      denseCorpus,
      annotationBaseline,
      annotationWorkspace,
      null,
      undefined,
      captureAppCsv,
    );
    const annotationWarm = await execute(
      denseCorpus,
      annotationChanged,
      annotationWorkspace,
      annotationInitial.manifest.workspaceRootDigest,
      undefined,
      captureAppCsv,
    );
    const annotationCold = await execute(
      denseCorpus,
      annotationChanged,
      "annotation-study-name-cold",
      null,
      undefined,
      captureAppCsv,
    );
    expect(
      semanticOutcome(annotationWarm.manifest),
      "studyName: warm/cold outcome",
    ).toEqual(semanticOutcome(annotationCold.manifest));
    expect(
      outputArtifacts(annotationWarm.manifest),
      "studyName: warm/cold artifacts",
    ).toEqual(outputArtifacts(annotationCold.manifest));
    expect(
      annotationWarm.manifest.nodeExecutions
        .filter((node) => node.status === "recomputed")
        .map((node) => node.node_id),
      "studyName: exact invalidation cone",
    ).toEqual(["outputs"]);
    expect(
      computationalOutcome(annotationWarm.manifest),
      "studyName: upstream invariance",
    ).toEqual(computationalOutcome(annotationInitial.manifest));
    expect(
      annotationWarm.manifest.processingSummary.publishedOutputsDigest,
    ).not.toBe(
      annotationInitial.manifest.processingSummary.publishedOutputsDigest,
    );
    const baselineAppCsv = new TextDecoder().decode(
      annotationInitial.capturedArtifacts.get("app-csv"),
    );
    const changedAppCsv = new TextDecoder().decode(
      annotationWarm.capturedArtifacts.get("app-csv"),
    );
    expect(baselineAppCsv).toContain("Semantic Study Alpha");
    expect(changedAppCsv).toBe(
      baselineAppCsv.replaceAll("Semantic Study Alpha", "Semantic Study Bravo"),
    );

    const expectedQualificationFailures: string[] = [];
    const qualificationSuccesses: string[] = [];
    for (const config of t3Configs) {
      const identity = `qualification:${config.id}`;
      const shouldFail =
        config.options.timezoneHandling === "selected-filter" &&
        config.options.selectedTimezone === "America/New_York";
      try {
        const { manifest } = await execute(
          qualificationCorpus,
          config,
          identity,
        );
        expect(shouldFail, `${identity} unexpectedly succeeded`).toBe(false);
        expect(manifest.openObligations, identity).toEqual([]);
        qualificationSuccesses.push(config.id);
      } catch (error) {
        expect(shouldFail, `${identity}: ${errorText(error)}`).toBe(true);
        expect(errorText(error)).toMatch(/timezone|row|data/i);
        expectedQualificationFailures.push(config.id);
      }
    }
    expect(expectedQualificationFailures.length).toBeGreaterThan(0);

    const evidence = {
      protocolVersion: "chronicle-configuration-space-campaign/v1",
      contractAuthority: "web/schema/chronicle-local-contract.linkml.yaml",
      contractOptionKeyCount: BROWSER_PROCESSING_OPTION_KEYS.length,
      computationalOptionKeyCount: COMPUTATIONAL_BROWSER_OPTION_KEYS.length,
      factoredAxes: {
        annotation: ANNOTATION_BROWSER_OPTION_KEYS,
        view: VIEW_BROWSER_OPTION_KEYS,
        execution: EXECUTION_BROWSER_OPTION_KEYS,
      },
      equivalenceClassAuthority: "web/scripts/generate_combinatorial_model.mts",
      coveringArray: {
        strength: 3,
        configurations: t3Configs.length,
        exactValidTupleCoverage: "100%",
      },
      highOrderSample: {
        seed: seededHighOrder.seed,
        configurations: seededConfigs.length,
        uniquePublishedOutputs: highOrderPublished.size,
      },
      supportCatalogs: {
        authority: [
          "web/src/assets/defaults/unified_app_codebook.csv",
          "web/src/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv",
          "web/src/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv",
          "web/src/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv",
        ],
        sourceCounts: catalog.sourceCounts,
      },
      campaign: {
        validCorpora: corpora.length,
        coldFullRustExecutions: coldExecutions,
        incrementalColdOracleComparisons: t3Configs.length,
        singleComputationalOptionColdOracleComparisons:
          COMPUTATIONAL_BROWSER_OPTION_KEYS.length,
        noncomputationalInvarianceComparisons: orthogonalKeys.length,
        annotationDependencyComparisons: ANNOTATION_BROWSER_OPTION_KEYS.length,
        computationalOptionKeys: COMPUTATIONAL_BROWSER_OPTION_KEYS,
        qualificationExecutions: t3Configs.length,
        qualificationSuccesses: qualificationSuccesses.length,
        expectedQualificationFailures,
      },
      corpusReports,
      caseSetDigest: await sha256Uri(caseIdentities.sort().join("\n")),
    };
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    if (UPDATE) {
      mkdirSync(dirname(EXPECTED_FILE), { recursive: true });
      writeFileSync(EXPECTED_FILE, serialized, "utf8");
      return;
    }
    expect(
      existsSync(EXPECTED_FILE),
      "missing configuration-space evidence snapshot",
    ).toBe(true);
    expect(serialized).toBe(readFileSync(EXPECTED_FILE, "utf8"));
  }, 600_000);

  it("derives a digest-bound empirical influence map for every computational value transition", async () => {
    const influenceKeyFilter = process.env.INFLUENCE_KEY;
    const influenceContextFilter = process.env.INFLUENCE_CONTEXT;
    const influenceCorpusFilter = process.env.INFLUENCE_CORPUS;
    const shardCount = Number(process.env.INFLUENCE_SHARD_COUNT ?? "1");
    const shardIndex = Number(process.env.INFLUENCE_SHARD_INDEX ?? "0");
    if (
      !Number.isSafeInteger(shardCount) ||
      shardCount < 1 ||
      !Number.isSafeInteger(shardIndex) ||
      shardIndex < 0 ||
      shardIndex >= shardCount
    ) {
      throw new Error(`invalid influence shard ${shardIndex}/${shardCount}`);
    }
    const perturbationKeys = COMPUTATIONAL_BROWSER_OPTION_KEYS.filter(
      (key, index) =>
        (!influenceKeyFilter || key === influenceKeyFilter) &&
        index % shardCount === shardIndex,
    );
    const stepContract = JSON.parse(
      runtime.pipeline_step_contract_json(),
    ) as RustStepContract;
    expect(stepContract.protocolVersion).toBe(
      "chronicle-preprocessing-step-contract/v3",
    );
    expect(stepContract.steps).toHaveLength(55);
    const domainDescriptor = COMPUTATIONAL_BROWSER_OPTION_KEYS.map((key) => ({
      key,
      classes: configurationEquivalenceClasses(key).map(({ label, value }) => ({
        label,
        value,
      })),
    }));
    const reports: Array<Record<string, unknown>> = [];
    const caseIdentities: string[] = [];
    const axesWithSubstantiveObservedEffects = new Set<string>();
    const staleLogicalCheckpointCases: Array<Record<string, unknown>> = [];
    const percolationClusterMismatchCases: Array<Record<string, unknown>> = [];
    const stepPercolationClusterMismatchCases: Array<Record<string, unknown>> =
      [];
    let receipt: ReturnType<typeof authorityReceipt> | undefined;
    let coldExecutions = 0;
    let orderedTransitions = 0;
    let incrementalExecutions = 0;
    let requirementEvaluations = 0;

    for (const key of perturbationKeys) {
      const classes = configurationEquivalenceClasses(key);
      const declaredStepBinders = new Set<string>();
      const declaredGroupBinders = new Set<string>();
      const declaredRuntimeArtifactBindings = new Set<string>();
      const observedCompatibilityInputKeyNodes = new Set<string>();
      const observedExecutedGroups = new Set<string>();
      const observedSemanticOutputNodes = new Set<string>();
      const observedChangedPipelineSteps = new Set<string>();
      const observedArtifactKinds = new Set<string>();
      const observedRoleStateKeys = new Set<string>();
      const observedNodeStateKeys = new Set<string>();
      const contextReports: Array<Record<string, unknown>> = [];

      for (const context of perturbationContexts(key).filter(
        ({ id }) => !influenceContextFilter || id === influenceContextFilter,
      )) {
        const eligibleClasses = classes.filter(
          ({ label }) =>
            !context.eligibleLabels || context.eligibleLabels.has(label),
        );
        expect(
          eligibleClasses.length,
          `${key}/${context.id}: need at least two values`,
        ).toBeGreaterThan(1);
        const transitionReports = new Map<
          string,
          {
            from: string;
            to: string;
            corpusObservations: Array<Record<string, unknown>>;
          }
        >();
        for (const from of eligibleClasses) {
          for (const to of eligibleClasses) {
            if (from.label === to.label) continue;
            transitionReports.set(`${from.label}->${to.label}`, {
              from: from.label,
              to: to.label,
              corpusObservations: [],
            });
          }
        }

        for (const corpus of corpora.filter(
          ({ id }) => !influenceCorpusFilter || id === influenceCorpusFilter,
        )) {
          const coldByLabel = new Map<
            string,
            {
              config: Configuration;
              run: RunResult;
              requirements: Awaited<ReturnType<typeof evaluateRequirements>>;
            }
          >();
          for (const equivalenceClass of eligibleClasses) {
            const config = configurationWithValue(
              context,
              key,
              equivalenceClass.label,
              equivalenceClass.value,
            );
            const identity = `influence:cold:${key}:${context.id}:${corpus.id}:${equivalenceClass.label}`;
            const requirements = await evaluateRequirements(
              corpus,
              config,
              `${identity}:requirements`,
              undefined,
              true,
            );
            requirementEvaluations += 1;
            expect(requirements.ready, identity).toBe(true);
            expect(requirements.openObligations, identity).toEqual([]);
            const run = await execute(
              corpus,
              config,
              identity,
              null,
              undefined,
              undefined,
              true,
            );
            coldExecutions += 1;
            const currentReceipt = authorityReceipt(run.manifest);
            if (!receipt) receipt = currentReceipt;
            else
              expect(
                currentReceipt,
                `${identity}: implementation drift`,
              ).toEqual(receipt);
            coldByLabel.set(equivalenceClass.label, {
              config,
              run,
              requirements,
            });
          }

          for (const from of eligibleClasses) {
            for (const to of eligibleClasses) {
              if (from.label === to.label) continue;
              orderedTransitions += 1;
              const source = coldByLabel.get(from.label)!;
              const target = coldByLabel.get(to.label)!;
              const workspace = `influence:warm:${key}:${context.id}:${corpus.id}:${from.label}:${to.label}`;
              expect(
                changedFields(
                  source.config.options as unknown as Record<string, unknown>,
                  target.config.options as unknown as Record<string, unknown>,
                ),
                `${workspace}: intervention must change exactly one configuration field`,
              ).toEqual([key]);
              expect(
                target.run.boundRoles,
                `${workspace}: source and target must bind the identical support-role set`,
              ).toEqual(source.run.boundRoles);
              const initial = await execute(
                corpus,
                source.config,
                workspace,
                null,
                undefined,
                undefined,
                true,
              );
              const warm = await execute(
                corpus,
                target.config,
                workspace,
                initial.manifest.workspaceRootDigest,
                undefined,
                undefined,
                true,
              );
              incrementalExecutions += 2;

              expect(
                semanticOutcome(initial.manifest),
                `${workspace}: cold source`,
              ).toEqual(semanticOutcome(source.run.manifest));
              expect(
                outputArtifacts(initial.manifest),
                `${workspace}: source artifacts`,
              ).toEqual(outputArtifacts(source.run.manifest));
              expect(
                semanticOutcome(warm.manifest),
                `${workspace}: warm/cold target`,
              ).toEqual(semanticOutcome(target.run.manifest));
              expect(
                outputArtifacts(warm.manifest),
                `${workspace}: warm/cold artifacts`,
              ).toEqual(outputArtifacts(target.run.manifest));
              const warmNodeOutputDigests = nodeOutputDigests(warm.manifest);
              const coldTargetNodeOutputDigests = nodeOutputDigests(
                target.run.manifest,
              );
              if (
                JSON.stringify(warmNodeOutputDigests) !==
                JSON.stringify(coldTargetNodeOutputDigests)
              ) {
                staleLogicalCheckpointCases.push({
                  workspace,
                  optionKey: key,
                  contextId: context.id,
                  corpusId: corpus.id,
                  staleNodes: changedFields(
                    warmNodeOutputDigests,
                    coldTargetNodeOutputDigests,
                  ),
                  coldSemanticChanges: changedFields(
                    source.run.manifest.processingSummary.logicalStageDigests,
                    target.run.manifest.processingSummary.logicalStageDigests,
                  ),
                });
              }
              expect(
                warm.manifest.openObligations,
                `${workspace}: warm obligations`,
              ).toEqual(target.run.manifest.openObligations);

              const changedCompatibilityInputKeyNodes = changedFields(
                nodeInputKeys(initial.manifest),
                nodeInputKeys(warm.manifest),
              );
              const changedArtifactKinds = changedFields(
                outputArtifactDigests(initial.manifest),
                outputArtifactDigests(target.run.manifest),
              );
              const changedSemanticOutputNodes = changedFields(
                source.run.manifest.processingSummary.logicalStageDigests,
                target.run.manifest.processingSummary.logicalStageDigests,
              );
              const changedPipelineSteps = changedFields(
                source.run.manifest.processingSummary.pipelineStepDigests,
                target.run.manifest.processingSummary.pipelineStepDigests,
              );
              const checkpointComponentChanges = changedCheckpointComponents(
                source.run.manifest,
                target.run.manifest,
              );
              expect(
                Object.keys(checkpointComponentChanges).sort(),
                `${workspace}: typed checkpoint components do not commit to the terminal graph`,
              ).toEqual(changedSemanticOutputNodes);
              const stepCheckpointComponentChanges =
                changedStepCheckpointComponents(
                  source.run.manifest,
                  target.run.manifest,
                );
              expect(
                Object.keys(stepCheckpointComponentChanges).sort(),
                `${workspace}: typed step checkpoint components do not commit to the 55-step graph`,
              ).toEqual(changedPipelineSteps);
              const changedCountFields = changedFields(
                initial.manifest.counts,
                target.run.manifest.counts,
              );
              const changedProcessingSummaryFields = changedFields(
                initial.manifest.processingSummary,
                target.run.manifest.processingSummary,
              );
              const changedRoleStates = changedFields(
                source.requirements.roleStates,
                target.requirements.roleStates,
              );
              const changedNodeStates = changedFields(
                source.requirements.nodeStates,
                target.requirements.nodeStates,
              );
              const sourceObligations = obligationRoles(source.requirements);
              const targetObligations = obligationRoles(target.requirements);

              const actualExecutedGroups = executedGroupIds(warm.manifest);
              const changedRustRequestFields = changedFields(
                buildRustV2Options(source.config.options, GOLDEN_RUNTIME),
                buildRustV2Options(target.config.options, GOLDEN_RUNTIME),
              );
              const actualExecutedSteps = executedStepIds(warm.manifest);
              const changedStepOutputs = new Set(changedPipelineSteps);
              const sourceStepStatuses = stepStatuses(source.run.manifest);
              const targetStepStatuses = stepStatuses(target.run.manifest);
              const newlyApplicableSteps = stepContract.steps
                .filter(
                  (step) =>
                    sourceStepStatuses[step.id] === "bypassed" &&
                    targetStepStatuses[step.id] !== "bypassed",
                )
                .map(({ id }) => id)
                .sort();
              const directStepBinders = stepContract.steps
                .filter(
                  (step) =>
                    newlyApplicableSteps.includes(step.id) ||
                    step.requestFields.some((field) =>
                      changedRustRequestFields.includes(field),
                    ),
                )
                .map(({ id }) => id);
              for (const stepId of directStepBinders) {
                declaredStepBinders.add(stepId);
                declaredGroupBinders.add(
                  stepContract.steps.find(({ id }) => id === stepId)!.group,
                );
              }
              for (const field of changedRustRequestFields) {
                if (RUNTIME_ARTIFACT_REQUEST_FIELDS.has(field)) {
                  declaredRuntimeArtifactBindings.add(field);
                  declaredGroupBinders.add("outputs");
                }
              }
              const predictedExecutedSteps = stepContract.steps
                .filter((step) => {
                  const targetApplicable =
                    targetStepStatuses[step.id] !== "bypassed";
                  const newlyApplicable =
                    sourceStepStatuses[step.id] === "bypassed" &&
                    targetApplicable;
                  return (
                    targetApplicable &&
                    (newlyApplicable ||
                      step.requestFields.some((field) =>
                        changedRustRequestFields.includes(field),
                      ) ||
                      step.inputs.some((input) =>
                        changedStepOutputs.has(input),
                      ))
                  );
                })
                .map((step) => step.id)
                .sort();
              const predictedExecutedGroups = [
                ...new Set(
                  stepContract.steps
                    .filter((step) => predictedExecutedSteps.includes(step.id))
                    .map((step) => step.group),
                ),
              ].sort();
              if (
                JSON.stringify(actualExecutedGroups) !==
                JSON.stringify(predictedExecutedGroups)
              ) {
                percolationClusterMismatchCases.push({
                  workspace,
                  optionKey: key,
                  contextId: context.id,
                  corpusId: corpus.id,
                  observed: actualExecutedGroups,
                  predicted: predictedExecutedGroups,
                  changedSemanticOutputNodes,
                });
              }
              if (
                JSON.stringify(actualExecutedSteps) !==
                JSON.stringify(predictedExecutedSteps)
              ) {
                stepPercolationClusterMismatchCases.push({
                  workspace,
                  optionKey: key,
                  contextId: context.id,
                  corpusId: corpus.id,
                  changedRustRequestFields,
                  observed: actualExecutedSteps,
                  predicted: predictedExecutedSteps,
                  changedStepOutputs: changedPipelineSteps,
                });
              }

              changedCompatibilityInputKeyNodes.forEach((node) =>
                observedCompatibilityInputKeyNodes.add(node),
              );
              actualExecutedGroups.forEach((node) =>
                observedExecutedGroups.add(node),
              );
              changedSemanticOutputNodes.forEach((node) =>
                observedSemanticOutputNodes.add(node),
              );
              changedPipelineSteps.forEach((step) =>
                observedChangedPipelineSteps.add(step),
              );
              changedArtifactKinds.forEach((kind) =>
                observedArtifactKinds.add(kind),
              );
              changedRoleStates.forEach((role) =>
                observedRoleStateKeys.add(role),
              );
              changedNodeStates.forEach((node) =>
                observedNodeStateKeys.add(node),
              );
              const nonProvenanceSummaryChanges =
                changedProcessingSummaryFields.filter(
                  (field) =>
                    field !== "provenanceDigest" &&
                    field !== "publishedOutputsDigest",
                );
              if (
                changedArtifactKinds.length > 0 ||
                changedCountFields.length > 0 ||
                nonProvenanceSummaryChanges.length > 0 ||
                changedRoleStates.length > 0 ||
                changedNodeStates.length > 0 ||
                JSON.stringify(sourceObligations) !==
                  JSON.stringify(targetObligations)
              ) {
                axesWithSubstantiveObservedEffects.add(key);
              }

              const observation = {
                corpusId: corpus.id,
                changedRustRequestFields,
                newlyApplicableSteps,
                changedCompatibilityInputKeyNodes,
                actualExecutedGroups,
                actualExecutedSteps,
                changedSemanticOutputNodes,
                changedPipelineSteps,
                checkpointComponentChanges,
                stepCheckpointComponentChanges,
                changedArtifactKinds,
                changedCountFields,
                changedProcessingSummaryFields,
                changedRoleStates,
                changedNodeStates,
                openObligations: {
                  source: sourceObligations,
                  target: targetObligations,
                },
                warmExecution: Object.entries(nodeStatuses(warm.manifest))
                  .filter(([, status]) => status !== "cached")
                  .map(([nodeId, status]) => ({ nodeId, status })),
              };
              transitionReports
                .get(`${from.label}->${to.label}`)!
                .corpusObservations.push(observation);
              caseIdentities.push(
                JSON.stringify([
                  key,
                  context.id,
                  from.label,
                  to.label,
                  observation,
                ]),
              );
            }
          }
        }

        contextReports.push({
          contextId: context.id,
          contextProjectionDigest: await sha256Uri(
            JSON.stringify(buildRustV2Options(context.options, GOLDEN_RUNTIME)),
          ),
          eligibleClasses: eligibleClasses.map(({ label }) => label),
          transitions: [...transitionReports.values()],
        });
      }

      expect(
        [...declaredStepBinders, ...declaredRuntimeArtifactBindings],
        `${key}: no Rust query or runtime-artifact binding was exercised`,
      ).not.toEqual([]);
      const binders = [...declaredGroupBinders].sort();
      const declaredCone = [...descendantsOf(new Set(binders))].sort();
      reports.push({
        optionKey: key,
        classes: classes.map(({ label, value }) => ({ label, value })),
        declaredBinders: binders,
        declaredStepBinders: [...declaredStepBinders].sort(),
        declaredRuntimeArtifactBindings: [
          ...declaredRuntimeArtifactBindings,
        ].sort(),
        declaredCone,
        observedCompatibilityInputKeyNodes: [
          ...observedCompatibilityInputKeyNodes,
        ].sort(),
        observedExecutedGroups: [...observedExecutedGroups].sort(),
        observedSemanticOutputNodes: [...observedSemanticOutputNodes].sort(),
        observedChangedPipelineSteps: [...observedChangedPipelineSteps].sort(),
        observedArtifactKinds: [...observedArtifactKinds].sort(),
        observedRoleStateKeys: [...observedRoleStateKeys].sort(),
        observedNodeStateKeys: [...observedNodeStateKeys].sort(),
        contexts: contextReports,
      });
    }

    const axesWithoutSubstantiveObservedEffects =
      COMPUTATIONAL_BROWSER_OPTION_KEYS.filter(
        (key) => !axesWithSubstantiveObservedEffects.has(key),
      );
    expect(
      staleLogicalCheckpointCases,
      "every warm logical-stage checkpoint must equal an independent cold target",
    ).toEqual([]);
    expect(
      percolationClusterMismatchCases,
      "observed recomputation must equal the deterministic semantic percolation cluster",
    ).toEqual([]);
    expect(
      stepPercolationClusterMismatchCases,
      "all 55 Rust step input keys must change exactly when a direct request field or changed upstream checkpoint requires it",
    ).toEqual([]);
    if (
      !influenceKeyFilter &&
      !influenceContextFilter &&
      !influenceCorpusFilter &&
      shardCount === 1
    ) {
      expect(
        axesWithoutSubstantiveObservedEffects,
        "every computational axis needs at least one branch-activating empirical witness",
      ).toEqual([]);
    }
    const evidence = {
      protocolVersion: "chronicle-configuration-influence-ledger/v1",
      logicalCheckpointProtocol: "chronicle-logical-stage-checkpoint/v7",
      claimBoundary:
        "Exact 55-step and 15-display-group execution plus warm/cold equality for the recorded Rust/WASM implementation, equivalence classes, contexts, support bindings, and synthetic corpora. Absence of an observed effect remains bounded to this declared test scope. Step recomputation is taken from actual Salsa query bodies plus explicitly instrumented product-step evaluations inside review-only fused queries. The separate sequential Rust path remains the independent cold oracle.",
      contractAuthority: "web/schema/chronicle-local-contract.linkml.yaml",
      planAuthority:
        ".semantic-federation/semantic/resources/chronicle.plan.json",
      equivalenceClassAuthority: "web/scripts/generate_combinatorial_model.mts",
      implementationReceipt: receipt,
      computationalDomainDigest: await sha256Uri(
        JSON.stringify(domainDescriptor),
      ),
      computationalOptionCount: COMPUTATIONAL_BROWSER_OPTION_KEYS.length,
      equivalenceClassValueCount: domainDescriptor.reduce(
        (total, domain) => total + domain.classes.length,
        0,
      ),
      syntheticCorpora: corpora.map(
        ({ id, seed, rowCount, injectedFeatures }) => ({
          id,
          seed,
          rowCount,
          injectedFeatures,
        }),
      ),
      executionCounts: {
        requirementEvaluations,
        coldExecutions,
        orderedTransitions,
        incrementalExecutions,
        totalRustExecutions: coldExecutions + incrementalExecutions,
      },
      exactPercolationProof: {
        logicalStageCount: order.length,
        pipelineStepCount: 55,
        warmColdCheckpointComparisons: orderedTransitions,
        warmColdStepCheckpointComparisons: orderedTransitions * 55,
        exactClusterComparisons: orderedTransitions,
        staleCheckpointCases: staleLogicalCheckpointCases.length,
        clusterMismatchCases: percolationClusterMismatchCases.length,
        stepClusterMismatchCases: stepPercolationClusterMismatchCases.length,
      },
      physicalExecutionBoundary:
        "The production runtime executes and reuses 55 Rust product steps through Salsa-tracked queries. The recorded recomputed-step set comes from actual query bodies plus explicitly instrumented product-step evaluations inside review-only fused queries; a restored row transform is not recorded as physically rerun. The 15 display groups are derived from those step IDs. The separate sequential Rust path is used only as an independent cold oracle.",
      axesWithSubstantiveObservedEffects: [
        ...axesWithSubstantiveObservedEffects,
      ].sort(),
      axesWithoutSubstantiveObservedEffects,
      computationalOptionOrder: COMPUTATIONAL_BROWSER_OPTION_KEYS,
      optionInfluence: reports,
      caseSetDigest: await sha256Uri(caseIdentities.sort().join("\n")),
    };
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    const shardOutput = process.env.INFLUENCE_SHARD_OUTPUT;
    if (shardOutput) {
      writeFileSync(
        shardOutput,
        `${JSON.stringify({ evidence, caseIdentities }, null, 2)}\n`,
        "utf8",
      );
      return;
    }
    if (UPDATE) {
      mkdirSync(dirname(INFLUENCE_EXPECTED_FILE), { recursive: true });
      writeFileSync(INFLUENCE_EXPECTED_FILE, serialized, "utf8");
      return;
    }
    expect(
      existsSync(INFLUENCE_EXPECTED_FILE),
      "missing configuration-influence evidence snapshot",
    ).toBe(true);
    expect(serialized).toBe(readFileSync(INFLUENCE_EXPECTED_FILE, "utf8"));
  }, 600_000);
});
