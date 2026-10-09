import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import filterCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?raw";
import forcingCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?raw";
import backgroundCsv from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?raw";
import codebookCsv from "@/testSupport/fixtures/synthetic-catalog-app-codebook.csv?raw";
import {
  ANNOTATION_BROWSER_OPTION_KEYS,
  BROWSER_PROCESSING_OPTION_KEYS,
  COMPUTATIONAL_BROWSER_OPTION_KEYS,
  EXECUTION_BROWSER_OPTION_KEYS,
  VIEW_BROWSER_OPTION_KEYS,
} from "@/lib/generatedContract";
import type { RuntimeScientificPreflightReceipt } from "@/lib/generatedRuntimeBoundary";

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
  withValue,
  interventionFields,
  validConfiguration,
} from "@/testSupport/rustCampaignGraph";
import {
  buildRustV2Options,
  decodeOpenerSetPreflightDecision,
  type OpenerSetPreflightDecision,
} from "@/lib/rustPipelineRuntime";
import type { BrowserProcessingOptions } from "@/lib/types";
import {
  hasSourceSensitiveScreenStrategy,
  requiresLiveScientificPreflight,
  usesInputCapabilityEvidence,
} from "@/lib/inputCapabilityEvidence";
import {
  buildArtifactFixtureState,
  buildArtifactInterventions,
  buildInputCapabilityEvidenceCsv,
  isCapabilityEvidenceIntervention,
  prepareArtifactFixtureForScientificExecution,
} from "@/testSupport/artifactInterventions";
import {
  buildCodebookSlice,
  buildSyntheticCatalog,
  generateSyntheticChronicleCorpus,
  QUALIFICATION_CORPUS_PROFILE,
  SYNTHETIC_CORPUS_PROFILES,
  type SyntheticChronicleCorpus,
} from "@/testSupport/syntheticChronicleCorpus";
import {
  CAMPAIGN_RUNTIME_INIT_TIMEOUT_MS,
  dependencyCampaignRuntimeBytes,
  captureCampaignFootprint,
  CAMPAIGN_FOOTPRINT_CAPTURE_TIMEOUT_MS,
} from "@/testSupport/dependencyCampaignRuntime";
import {
  completeLegacyScientificCampaignOptions,
  executeScientificCampaignWorkspace,
  putScientificCampaignSupportArtifact,
  requireExecutedScientificCampaign,
  ScientificCampaignRefusalError,
} from "@/testSupport/scientificCampaignExecution";
import * as runtime from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

// Footprint selection: record which production source files this campaign
// actually executed (no-op unless the evidence refresh sets the profraw dir).
afterAll(
  () => captureCampaignFootprint(runtime),
  CAMPAIGN_FOOTPRINT_CAPTURE_TIMEOUT_MS,
);
import { configurationEquivalenceClasses } from "@/testSupport/configurationEquivalenceClasses";
import {
  unjustifiedExecutions,
  type RustWorkflowContract,
} from "@/testSupport/workflowContract";
import {
  canonicalOutputCells,
  changedCanonicalArtifactBytes,
  changedCellAddresses,
  isCanonicalOutputKind,
  sortCanonicalOutputCells,
} from "@/testSupport/outputCellTomography";
import {
  authorityReceipt,
  cachedWithChangedOutput,
  changedCheckpointComponents,
  changedFields,
  changedQueryCheckpointComponents,
  executedQueryIds,
  isOutputArtifactKind,
  nodeOutputDigests,
  outputArtifactDigests,
  queryStatuses,
  type CampaignRuntimeManifest,
} from "@/testSupport/campaignManifest";

import coveringT3 from "../../../../combinatorial/covering_array_t3.json" with { type: "json" };
import seededHighOrder from "../../../../combinatorial/seeded_high_order_00c0ffee.json" with { type: "json" };
import { CAMPAIGN_TEST_TIMEOUT_MS } from "@/testSupport/campaignTimeout";

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
const NO_VALID_APP_USAGE_STRUCTURAL_ERROR =
  "No valid app usage data during the study period";
const SELECTED_TIMEZONE_STRUCTURAL_ERROR =
  "selected timezone America/New_York is not present in the input; filtering would remove all rows";
/// Pinned input-dependent scientific refusal counts per corpus (see the
/// assertions after the qualification loop). Re-pin deliberately when a corpus
/// or a source-sensitive strategy changes.
const INPUT_DEPENDENT_REFUSALS_EXPECTED = {
  // Four of the six campaign corpora and the qualification corpus carry
  // participant timestamps that decrease in physical source order, so the
  // Parry/Zhu screen-construction rows whose screen stage is active there
  // (screen usage on, or the Schoedel app-within-screen strategy) refuse
  // before execution; catalog-random and configuration-influence-probes
  // produce none. The counts are the receipt-bound outcome of the one-shot
  // Rust preflight on each corpus.
  coveringArrayT3: {
    "interaction-pathologies": 204,
    "support-intersections": 204,
    "temporal-pathologies": 204,
    "threshold-boundaries": 204,
  } as Record<string, number>,
  seededHighOrder: {
    "interaction-pathologies": 81,
  } as Record<string, number>,
  qualification: {
    "qualification-chicago-only": 204,
  } as Record<string, number>,
};
const QUALIFICATION_STRUCTURAL_IDS = [
  "pict_15",
  "pict_46",
  "pict_126",
  "pict_176",
  "pict_177",
  "pict_197",
  "pict_216",
  "pict_230",
  "pict_268",
  "pict_270",
  "pict_321",
] as const;
const QUALIFICATION_PREFLIGHT_STRUCTURAL_IDS = [
  "pict_15",
  "pict_126",
  "pict_176",
  "pict_177",
  "pict_197",
  "pict_216",
  "pict_230",
  "pict_268",
] as const;
const encoder = new TextEncoder();

type Configuration = {
  id: string;
  options: BrowserProcessingOptions;
};

type ConfigurationRefusalReceipt = {
  configurationId: string;
  openerSet: string;
  episodeReconstructionStrategy: string;
  applicability: OpenerSetPreflightDecision;
};

type RunResult = {
  manifest: CampaignRuntimeManifest;
  boundRoles: string[];
  capturedArtifacts: Map<string, Uint8Array>;
  /** Every canonical output cell, present only when the caller asked for them.
   * `take_artifact_bytes` empties the slot, so cells and raw bytes are read in
   * ONE pass over the handle -- a second pass would see zero-length payloads. */
  capturedCells: Record<string, string> | undefined;
};

type SourceSensitiveScientificCell = {
  id: string;
  status: "executed" | "refused" | "validation_error";
  executeCalls: 0 | 1;
  inputDigest: string;
  capabilityEvidenceDigest: string | null;
  receipt: RuntimeScientificPreflightReceipt | null;
  workspaceRootDigest: string | null;
  refusal: {
    component: "screen" | "schoedel";
    reason: string;
    detail: string;
  } | null;
  validationError: string | null;
  rawRebind: {
    previousInputDigest: string;
    reboundInputDigest: string;
    previousCapabilityEvidenceDigest: string;
    reboundCapabilityEvidenceDigest: string;
  } | null;
  capabilityRepresentation: {
    previousArtifactDigest: string;
    changedArtifactDigest: string;
    previousAssignmentId: string;
    changedAssignmentId: string;
  } | null;
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
const completeLegacyConfigurations = (
  configurations: readonly {
    id: string;
    options: unknown;
  }[],
): Configuration[] =>
  configurations.map(({ id, options }) => ({
    id,
    options: completeLegacyScientificCampaignOptions(options),
  }));
const t3Configs = completeLegacyConfigurations(coveringT3.configs);
const seededConfigs = completeLegacyConfigurations(seededHighOrder.configs);

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

async function runtimeRequestJson(
  corpus: SyntheticChronicleCorpus,
  config: Configuration,
  identity: string,
  previousRoot: string | null,
  csvBytes: Uint8Array,
): Promise<string> {
  return JSON.stringify({
    protocolVersion: "chronicle-preprocessing-runtime/v2",
    requestId: identity,
    command: "ExecuteWorkspace",
    executionEngine: "incremental",
    provenanceEvidence: true,
    workspaceRootDigest: previousRoot,
    workspaceId: await sha256Uri(identity),
    inputFileName: `${corpus.id}.csv`,
    inputSha256: await sha256Uri(csvBytes),
    options: buildRustV2Options(config.options, GOLDEN_RUNTIME),
  });
}

async function openerSetApplicability(
  corpus: SyntheticChronicleCorpus,
  config: Configuration,
  identity: string,
): Promise<OpenerSetPreflightDecision> {
  const csvBytes = encoder.encode(corpus.csv);
  const requestJson = await runtimeRequestJson(
    corpus,
    config,
    identity,
    null,
    csvBytes,
  );
  return decodeOpenerSetPreflightDecision(
    JSON.parse(runtime.opener_set_applicability_json(requestJson)),
  );
}

function scientificRefusalReceipt(
  config: Configuration,
  applicability: OpenerSetPreflightDecision,
): ConfigurationRefusalReceipt {
  const isExpected =
    config.options.openerSet === "gesis_app_scoped_starts" &&
    config.options.episodeReconstructionStrategy === "eyes_complement" &&
    applicability.status === "refused" &&
    applicability.requestedOpenerSetId === "gesis_app_scoped_starts" &&
    applicability.resolvedOpenerSetId === "gesis_app_scoped_starts" &&
    applicability.effectiveOpenerSetId === null &&
    applicability.relation === "refused" &&
    applicability.reasonCode === "eyes_requires_lifecycle_triplets" &&
    /^sha256:[0-9a-f]{64}$/.test(applicability.optionsDigest);
  if (!isExpected) {
    throw new Error(
      `${config.id}: unexpected opener-set refusal ${JSON.stringify(applicability)}`,
    );
  }
  return {
    configurationId: config.id,
    openerSet: config.options.openerSet,
    episodeReconstructionStrategy: config.options.episodeReconstructionStrategy,
    applicability,
  };
}

async function classifyConfigurations(
  corpus: SyntheticChronicleCorpus,
  configurations: readonly Configuration[],
  family: string,
): Promise<{
  executable: Configuration[];
  refusalReceipts: ConfigurationRefusalReceipt[];
}> {
  const executable: Configuration[] = [];
  const refusalReceipts: ConfigurationRefusalReceipt[] = [];
  for (const config of configurations) {
    const applicability = await openerSetApplicability(
      corpus,
      config,
      `preflight:${family}:${config.id}`,
    );
    if (applicability.status === "refused") {
      refusalReceipts.push(scientificRefusalReceipt(config, applicability));
    } else {
      executable.push(config);
    }
  }
  return { executable, refusalReceipts };
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
      ...(usesInputCapabilityEvidence(options)
        ? [
            [
              "input_capability_evidence_file",
              {
                name: "input-capability-evidence.csv",
                csv: buildInputCapabilityEvidenceCsv(corpus.csv),
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
  captureCells = false,
): Promise<RunResult> {
  const csvBytes = encoder.encode(corpus.csv);
  const requestJson = await runtimeRequestJson(
    corpus,
    config,
    identity,
    previousRoot,
    csvBytes,
  );
  const applicability = decodeOpenerSetPreflightDecision(
    JSON.parse(runtime.opener_set_applicability_json(requestJson)),
  );
  if (applicability.status === "refused") {
    const receipt = scientificRefusalReceipt(config, applicability);
    throw new Error(
      `${identity}: scientifically refused configuration reached execution: ${receipt.configurationId}`,
    );
  }
  const supports = new runtime.RuntimeSupportFiles();
  const supportArtifacts = new Map<string, Uint8Array>();
  let handle: ReturnType<typeof runtime.execute_workspace> | undefined;
  const boundRoles: string[] = [];
  try {
    for (const [role, file] of supportCsv(
      corpus,
      config.options,
      omittedRole,
      bindAllSupport,
    )) {
      const bytes = encoder.encode(file.csv);
      if (
        putScientificCampaignSupportArtifact({
          roleId: role,
          fileName: file.name,
          bytes,
          options: config.options,
          supports,
          supportArtifacts,
        })
      ) {
        boundRoles.push(role);
      }
    }
    try {
      handle = requireExecutedScientificCampaign(
        executeScientificCampaignWorkspace({
          runtime,
          options: config.options,
          requestJson,
          rawBytes: csvBytes,
          supports,
          supportArtifacts,
        }),
      ).handle;
    } catch (error) {
      throw new Error(`${identity}: ${String(error)}`, { cause: error });
    }
    const manifest = JSON.parse(handle.manifest_json()) as CampaignRuntimeManifest;
    const capturedArtifacts = new Map<string, Uint8Array>();
    const cells: Record<string, string> = {};
    for (let index = 0; index < handle.artifact_count; index += 1) {
      const metadata = JSON.parse(handle.artifact_metadata_json(index)) as {
        kind: string;
        mediaType: string;
      };
      // Bytes are captured for EVERY researcher-visible output (the binary
      // parquet/SPSS/Arrow exports included); cells only for the canonical
      // text/JSON surfaces the address grammar can name.
      const wantBytes = captureCells && isOutputArtifactKind(metadata.kind);
      const wantCells = captureCells && isCanonicalOutputKind(metadata.kind);
      if (!captureKinds.has(metadata.kind) && !wantBytes && !wantCells)
        continue;
      // One take per artifact: the second take on the same index returns an
      // empty buffer, so bytes and cells must come off the same read.
      const bytes = handle.take_artifact_bytes(index);
      if (captureKinds.has(metadata.kind) || wantBytes) {
        capturedArtifacts.set(metadata.kind, bytes);
      }
      if (wantCells) {
        Object.assign(
          cells,
          canonicalOutputCells(metadata.kind, metadata.mediaType, bytes),
        );
      }
    }
    return {
      manifest,
      boundRoles,
      capturedArtifacts,
      capturedCells: captureCells ? sortCanonicalOutputCells(cells) : undefined,
    };
  } finally {
    handle?.free();
    supports.free();
  }
}

/// A configuration that passed the configuration-only opener preflight can
/// still refuse at the input-dependent scientific preflight on a particular
/// corpus (a source-sensitive screen strategy refusing non-monotonic source
/// timestamps). That refusal is a committed outcome with `executeCalls = 0`,
/// not a harness failure; every other error propagates unchanged.
type InputDependentRefusal = {
  family: string;
  corpusId: string;
  configurationId: string;
  screenSessionConstructionStrategy: string;
  component: "screen" | "schoedel";
  reason: string;
  detail: string;
  commitDigest: string;
};

type InputDependentStructuralError = {
  family: string;
  corpusId: string;
  configurationId: string;
  reason:
    | typeof NO_VALID_APP_USAGE_STRUCTURAL_ERROR
    | typeof SELECTED_TIMEZONE_STRUCTURAL_ERROR;
};

type CampaignStructuralError = Omit<InputDependentStructuralError, "family">;

async function attemptCampaignExecution(
  corpus: SyntheticChronicleCorpus,
  config: Configuration,
  identity: string,
  previousRoot: string | null = null,
): Promise<
  | { run: RunResult; refusal?: undefined; structuralError?: undefined }
  | {
      run?: undefined;
      refusal: RuntimeScientificPreflightReceipt;
      structuralError?: undefined;
    }
  | { run?: undefined; refusal?: undefined; structuralError: CampaignStructuralError }
> {
  try {
    return { run: await execute(corpus, config, identity, previousRoot) };
  } catch (error) {
    const cause = (error as Error).cause;
    if (
      cause instanceof ScientificCampaignRefusalError &&
      cause.receipt !== undefined
    ) {
      return { refusal: cause.receipt };
    }
    const reason =
      cause instanceof Error
        ? cause.message
        : typeof cause === "string"
          ? cause
          : null;
    if (
      reason === NO_VALID_APP_USAGE_STRUCTURAL_ERROR ||
      reason === SELECTED_TIMEZONE_STRUCTURAL_ERROR
    ) {
      return {
        structuralError: {
          corpusId: corpus.id,
          configurationId: config.id,
          reason,
        },
      };
    }
    throw error;
  }
}

function inputDependentStructuralError(
  family: string,
  error: CampaignStructuralError,
): InputDependentStructuralError {
  return { family, ...error };
}

function inputDependentRefusal(
  family: string,
  corpus: SyntheticChronicleCorpus,
  config: Configuration,
  receipt: RuntimeScientificPreflightReceipt,
): InputDependentRefusal {
  const screen = receipt.b05Schoedel.screenApplicability;
  const schoedel = receipt.b05Schoedel.schoedelApplicability;
  const projection =
    screen && !screen.executable
      ? { component: "screen" as const, applicability: screen }
      : schoedel && !schoedel.executable
        ? { component: "schoedel" as const, applicability: schoedel }
        : null;
  if (projection === null) {
    throw new Error(
      `${family}:${corpus.id}:${config.id}: refused receipt carries no refusing component`,
    );
  }
  return {
    family,
    corpusId: corpus.id,
    configurationId: config.id,
    screenSessionConstructionStrategy:
      config.options.screenSessionConstructionStrategy,
    component: projection.component,
    reason: projection.applicability.refusalReason ?? "unspecified",
    detail: projection.applicability.refusalDetail ?? "unspecified",
    commitDigest: receipt.commitDigest,
  };
}

async function runSourceSensitiveScientificCells(): Promise<
  SourceSensitiveScientificCell[]
> {
  const corpus = corpora.find(
    ({ id }) => id === "configuration-influence-probes",
  );
  if (!corpus) throw new Error("source-sensitive campaign corpus is absent");
  const parryOptions: BrowserProcessingOptions = {
    ...ALL_ON,
    screenSessionConstructionStrategy: "parry_toth_2025_session_glance_v1",
  };
  const zhuOptions: BrowserProcessingOptions = {
    ...ALL_ON,
    screenSessionConstructionStrategy: "zhu_2018_unlock_lock_v1",
  };
  const schoedelOptions: BrowserProcessingOptions = {
    ...ALL_ON,
    processScreenUsage: false,
    episodeReconstructionStrategy: "schoedel_2026_app_within_screen_prose_v1",
    screenSessionConstructionStrategy: "chronicle_screen_interactive_v1",
  };
  const artifactFixture = buildArtifactFixtureState({
    corpus,
    catalog,
    filterCsv,
    forcingCsv,
    backgroundCsv,
  });
  const capabilityInterventions = new Map(
    buildArtifactInterventions({ corpus, catalog })
      .filter(isCapabilityEvidenceIntervention)
      .map((intervention) => [intervention.id, intervention]),
  );
  const fieldCases = [
    ["support:capability-schema-version-invalid", "validation_error"],
    ["support:capability-stale-raw-binding", "executed"],
    ["support:capability-wildcard-to-participant", "executed"],
    ["support:capability-id-swap", "executed"],
    ["support:capability-capable-to-absent", "refused"],
    ["support:capability-evidence-basis", "executed"],
    ["support:capability-evidence-reference", "executed"],
    ["support:capability-evidence-digest", "executed"],
  ] as const;
  const cases: Array<{
    id: string;
    options: BrowserProcessingOptions;
    capabilityMode: "exact" | "missing" | "stale";
    interventionId?: string;
    rebindCrlfRaw?: boolean;
    expectedStatus: "executed" | "refused" | "validation_error";
    expectedRefusal?: {
      component: "screen" | "schoedel";
      reason: string;
      detail: string;
    };
  }> = [
    {
      id: "parry-exact-bound",
      options: parryOptions,
      capabilityMode: "exact",
      expectedStatus: "executed",
    },
    {
      id: "zhu-exact-bound",
      options: zhuOptions,
      capabilityMode: "exact",
      expectedStatus: "executed",
    },
    {
      id: "schoedel-chronicle-exact-bound",
      options: schoedelOptions,
      capabilityMode: "exact",
      expectedStatus: "executed",
    },
    {
      id: "parry-missing-capability",
      options: parryOptions,
      capabilityMode: "missing",
      expectedStatus: "refused",
      expectedRefusal: {
        component: "screen",
        reason: "input_capability_evidence_absent",
        detail: "capability_evidence_absent",
      },
    },
    {
      id: "zhu-stale-capability-binding",
      options: zhuOptions,
      capabilityMode: "stale",
      expectedStatus: "refused",
      expectedRefusal: {
        component: "screen",
        reason: "capability_evidence_not_bound_to_input",
        detail: "capability_evidence_not_bound_to_input",
      },
    },
    {
      id: "schoedel-stale-capability-binding",
      options: schoedelOptions,
      capabilityMode: "stale",
      expectedStatus: "refused",
      expectedRefusal: {
        component: "schoedel",
        reason: "capability_evidence_not_bound_to_input",
        detail: "capability_evidence_not_bound_to_input",
      },
    },
    {
      id: "parry-crlf-raw-rebound",
      options: parryOptions,
      capabilityMode: "exact",
      rebindCrlfRaw: true,
      expectedStatus: "executed",
    },
    {
      id: "parry-capability-sidecar-crlf",
      options: parryOptions,
      capabilityMode: "exact",
      interventionId:
        "support-representation:input_capability_evidence_file:crlf",
      expectedStatus: "executed",
    },
    ...fieldCases.map(([interventionId, expectedStatus]) => ({
      id: `parry-field:${interventionId}`,
      options: parryOptions,
      capabilityMode: "exact" as const,
      interventionId,
      expectedStatus,
      ...(interventionId === "support:capability-capable-to-absent"
        ? {
            expectedRefusal: {
              component: "screen" as const,
              reason: "unsupported_input_chunk",
              detail: "participant_stream_fragmented",
            },
          }
        : {}),
    })),
  ];
  const reports: SourceSensitiveScientificCell[] = [];
  for (const scientificCase of cases) {
    let preparedFixture = artifactFixture;
    if (scientificCase.interventionId) {
      const intervention = capabilityInterventions.get(
        scientificCase.interventionId,
      );
      if (!intervention) {
        throw new Error(
          `${scientificCase.id}: capability intervention is absent`,
        );
      }
      preparedFixture = intervention.apply(artifactFixture);
    }
    let rawRebind: SourceSensitiveScientificCell["rawRebind"] = null;
    let capabilityRepresentation: SourceSensitiveScientificCell["capabilityRepresentation"] =
      null;
    if (
      scientificCase.interventionId ===
      "support-representation:input_capability_evidence_file:crlf"
    ) {
      const previousArtifactDigest = await sha256Uri(
        artifactFixture.supports.input_capability_evidence_file.csv,
      );
      const changedArtifactDigest = await sha256Uri(
        preparedFixture.supports.input_capability_evidence_file.csv,
      );
      capabilityRepresentation = {
        previousArtifactDigest,
        changedArtifactDigest,
        previousAssignmentId: await sha256Uri(
          [
            "assignment",
            "input_capability_evidence_file",
            previousArtifactDigest,
          ].join("\u001f"),
        ),
        changedAssignmentId: await sha256Uri(
          [
            "assignment",
            "input_capability_evidence_file",
            changedArtifactDigest,
          ].join("\u001f"),
        ),
      };
      expect(changedArtifactDigest).not.toBe(previousArtifactDigest);
    }
    if (scientificCase.rebindCrlfRaw) {
      const previousInputDigest = await sha256Uri(artifactFixture.rawCsv);
      const previousCapabilityEvidenceDigest = await sha256Uri(
        artifactFixture.supports.input_capability_evidence_file.csv,
      );
      const rawMutated = {
        ...artifactFixture,
        rawCsv: artifactFixture.rawCsv
          .replaceAll("\r\n", "\n")
          .replaceAll("\n", "\r\n"),
      };
      expect(
        rawMutated.supports.input_capability_evidence_file.csv,
        `${scientificCase.id}: the pre-rebind sidecar must still name LF raw`,
      ).toContain(previousInputDigest);
      preparedFixture = prepareArtifactFixtureForScientificExecution(
        rawMutated,
        scientificCase.options,
      );
      rawRebind = {
        previousInputDigest,
        reboundInputDigest: await sha256Uri(preparedFixture.rawCsv),
        previousCapabilityEvidenceDigest,
        reboundCapabilityEvidenceDigest: await sha256Uri(
          preparedFixture.supports.input_capability_evidence_file.csv,
        ),
      };
      expect(rawRebind.reboundInputDigest).not.toBe(previousInputDigest);
      expect(rawRebind.reboundCapabilityEvidenceDigest).not.toBe(
        previousCapabilityEvidenceDigest,
      );
      expect(
        preparedFixture.supports.input_capability_evidence_file.csv,
      ).toContain(rawRebind.reboundInputDigest);
    }
    const selectedCorpus = {
      ...corpus,
      csv: preparedFixture.rawCsv,
    };
    const csvBytes = encoder.encode(selectedCorpus.csv);
    const config = {
      id: `scientific:${scientificCase.id}`,
      options: scientificCase.options,
    };
    const requestJson = await runtimeRequestJson(
      selectedCorpus,
      config,
      config.id,
      null,
      csvBytes,
    );
    const supportFiles = supportCsv(selectedCorpus, scientificCase.options);
    supportFiles.set(
      "input_capability_evidence_file",
      preparedFixture.supports.input_capability_evidence_file,
    );
    if (scientificCase.capabilityMode === "missing") {
      supportFiles.delete("input_capability_evidence_file");
    } else if (scientificCase.capabilityMode === "stale") {
      const capability = supportFiles.get("input_capability_evidence_file");
      if (!capability)
        throw new Error(`${scientificCase.id}: capability absent`);
      // Replaced, never mutated in place.
      // prepareArtifactFixtureForScientificExecution returns its argument by
      // reference when no rebind is needed, so this entry is the same object as
      // artifactFixture.supports.input_capability_evidence_file. Assigning to
      // .csv here would zero the digests in the shared fixture and corrupt every
      // later case in the loop.
      supportFiles.set("input_capability_evidence_file", {
        ...capability,
        csv: capability.csv.replaceAll(
          /sha256:[0-9a-f]{64}/g,
          `sha256:${"0".repeat(64)}`,
        ),
      });
    }
    const supports = new runtime.RuntimeSupportFiles();
    const supportArtifacts = new Map<string, Uint8Array>();
    let handle: ReturnType<typeof runtime.execute_workspace> | undefined;
    try {
      for (const [role, file] of supportFiles) {
        const bytes = encoder.encode(file.csv);
        putScientificCampaignSupportArtifact({
          roleId: role,
          fileName: file.name,
          bytes,
          options: scientificCase.options,
          supports,
          supportArtifacts,
        });
      }
      const capability = supportFiles.get("input_capability_evidence_file");
      let result;
      try {
        result = executeScientificCampaignWorkspace({
          runtime,
          options: scientificCase.options,
          requestJson,
          rawBytes: csvBytes,
          supports,
          supportArtifacts,
        });
      } catch (error) {
        expect(scientificCase.expectedStatus, scientificCase.id).toBe(
          "validation_error",
        );
        const validationError = String(error);
        expect(validationError, scientificCase.id).toMatch(
          /invalid_input_capability_evidence:wrong_schema_version/,
        );
        reports.push({
          id: scientificCase.id,
          status: "validation_error",
          executeCalls: 0,
          inputDigest: await sha256Uri(csvBytes),
          capabilityEvidenceDigest: capability
            ? await sha256Uri(capability.csv)
            : null,
          receipt: null,
          workspaceRootDigest: null,
          refusal: null,
          validationError,
          rawRebind,
          capabilityRepresentation,
        });
        continue;
      }
      expect(result.status, scientificCase.id).toBe(
        scientificCase.expectedStatus,
      );
      if (result.status === "refused") {
        expect(result.executeCalls, scientificCase.id).toBe(0);
        const applicability =
          scientificCase.expectedRefusal?.component === "schoedel"
            ? result.receipt.b05Schoedel.schoedelApplicability
            : result.receipt.b05Schoedel.screenApplicability;
        if (!scientificCase.expectedRefusal || !applicability) {
          throw new Error(`${scientificCase.id}: refusal projection is absent`);
        }
        expect(
          {
            component: scientificCase.expectedRefusal.component,
            reason: applicability.refusalReason,
            detail: applicability.refusalDetail,
          },
          scientificCase.id,
        ).toEqual(scientificCase.expectedRefusal);
        if (scientificCase.expectedRefusal.component === "schoedel") {
          expect(
            result.receipt.b05Schoedel.screenApplicability,
            scientificCase.id,
          ).toMatchObject({ executable: true });
        }
        reports.push({
          id: scientificCase.id,
          status: "refused",
          executeCalls: 0,
          inputDigest: await sha256Uri(csvBytes),
          capabilityEvidenceDigest: capability
            ? await sha256Uri(capability.csv)
            : null,
          receipt: result.receipt,
          workspaceRootDigest: null,
          refusal: scientificCase.expectedRefusal,
          validationError: null,
          rawRebind,
          capabilityRepresentation,
        });
      } else {
        handle = result.handle;
        const manifest = JSON.parse(handle.manifest_json()) as CampaignRuntimeManifest;
        if (capabilityRepresentation) {
          expect(
            result.scientificPreflight?.key.activeIngressRoles
              .input_capability_evidence_file,
            scientificCase.id,
          ).toEqual({
            artifactDigest: capabilityRepresentation.changedArtifactDigest,
            assignmentId: capabilityRepresentation.changedAssignmentId,
          });
        }
        reports.push({
          id: scientificCase.id,
          status: "executed",
          executeCalls: 1,
          inputDigest: await sha256Uri(csvBytes),
          capabilityEvidenceDigest: capability
            ? await sha256Uri(capability.csv)
            : null,
          receipt: result.scientificPreflight,
          workspaceRootDigest: manifest.workspaceRootDigest,
          refusal: null,
          validationError: null,
          rawRebind,
          capabilityRepresentation,
        });
      }
    } finally {
      handle?.free();
      supports.free();
    }
  }
  const exact = reports.find(({ id }) => id === "parry-exact-bound");
  const crlf = reports.find(({ id }) => id === "parry-capability-sidecar-crlf");
  if (!exact?.receipt || !crlf?.receipt || !crlf.capabilityRepresentation) {
    throw new Error("capability representation contrast is incomplete");
  }
  const exactRole =
    exact.receipt.key.activeIngressRoles.input_capability_evidence_file;
  const crlfRole =
    crlf.receipt.key.activeIngressRoles.input_capability_evidence_file;
  expect(exactRole).toEqual({
    artifactDigest: crlf.capabilityRepresentation.previousArtifactDigest,
    assignmentId: crlf.capabilityRepresentation.previousAssignmentId,
  });
  expect(crlfRole).toEqual({
    artifactDigest: crlf.capabilityRepresentation.changedArtifactDigest,
    assignmentId: crlf.capabilityRepresentation.changedAssignmentId,
  });
  expect(crlfRole?.artifactDigest).not.toBe(exactRole?.artifactDigest);
  expect(crlfRole?.assignmentId).not.toBe(exactRole?.assignmentId);
  return reports;
}

async function evaluateRequirements(
  corpus: SyntheticChronicleCorpus,
  config: Configuration,
  identity: string,
  omittedRole?: string,
  bindAllSupport = false,
): Promise<{
  ready: boolean;
  openObligations: Array<{ role_id: string; query_group_id: string | null }>;
  roleStates: Record<string, string>;
  queryGroupStates: Record<string, string>;
}> {
  const csvBytes = encoder.encode(corpus.csv);
  const inputDigest = await sha256Uri(csvBytes);
  const workspaceId = await sha256Uri(identity);
  const supports = new runtime.RuntimeSupportFiles();
  const supportArtifacts = new Map<string, Uint8Array>();
  try {
    for (const [role, file] of supportCsv(
      corpus,
      config.options,
      omittedRole,
      bindAllSupport,
    )) {
      putScientificCampaignSupportArtifact({
        roleId: role,
        fileName: file.name,
        bytes: encoder.encode(file.csv),
        options: config.options,
        supports,
        supportArtifacts,
      });
    }
    return JSON.parse(
      runtime.evaluate_workspace_requirements(
        JSON.stringify({
          protocolVersion: "chronicle-preprocessing-runtime/v2",
          requestId: identity,
          command: "ExecuteWorkspace",
          executionEngine: "incremental",
          provenanceEvidence: true,
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
      openObligations: Array<{
        role_id: string;
        query_group_id: string | null;
      }>;
      roleStates: Record<string, string>;
      queryGroupStates: Record<string, string>;
    };
  } finally {
    supports.free();
  }
}

function semanticOutcome(manifest: CampaignRuntimeManifest) {
  return {
    counts: manifest.counts,
    processingSummary: manifest.processingSummary,
  };
}

/** Run-identity bindings inside the evidence summaries. Every scientific
 * receipt binds the verified request's computation-options digest, and the
 * listed artifact digests hash exact kernel receipt bytes that embed that
 * digest, so these fields move whenever any computation-bound wire field
 * changes — including `materialize_visualization_data`, which the view keys
 * drive — while the receipts' semantic payloads (counts, dispositions,
 * `componentOptionsDigest`) stay invariant and remain compared below.
 * Digest-binding correctness is asserted where the digest is computed:
 * `validateScientificCampaignPreflight` and the runtime ingress
 * cross-checks — not by this computation-invariance comparison. */
const EVIDENCE_OPTIONS_IDENTITY_KEYS: ReadonlySet<string> = new Set([
  "optionsDigest",
  "requestOptionsDigest",
  "b05SchoedelValidationReceiptArtifactDigest",
  "b05ScreenConstructionArtifactDigest",
  "schoedelReconstructionArtifactDigest",
  "eyesTaggedFauValidationReceiptArtifactDigest",
  "validationReceiptArtifactDigest",
]);

function withoutEvidenceOptionsIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutEvidenceOptionsIdentity);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !EVIDENCE_OPTIONS_IDENTITY_KEYS.has(key))
        .map(([key, entry]) => [key, withoutEvidenceOptionsIdentity(entry)]),
    );
  }
  return value;
}

function computationalOutcome(manifest: CampaignRuntimeManifest) {
  const processingSummary = Object.fromEntries(
    Object.entries(manifest.processingSummary)
      .filter(
        ([key]) =>
          key !== "publishedOutputsDigest" && key !== "provenanceDigest",
      )
      .map(([key, value]) => [
        key,
        key === "workflowQueryGroupDigests" ||
        key === "workflowQueryGroupCheckpoints"
          ? Object.fromEntries(
              Object.entries(value as Record<string, unknown>).filter(
                ([nodeId]) => nodeId !== "outputs",
              ),
            )
          : key === "workflowQueryDigests" || key === "workflowQueryCheckpoints"
            ? Object.fromEntries(
                Object.entries(value as Record<string, unknown>).filter(
                  ([stepId]) => stepId !== "assemble_result_manifest",
                ),
              )
            : key === "scientificEvidence" || key === "eyesEvidence"
              ? withoutEvidenceOptionsIdentity(value)
              : value,
      ]),
  );
  return { counts: manifest.counts, processingSummary };
}


function outputArtifacts(manifest: CampaignRuntimeManifest): Array<{
  kind: string;
  digest: string;
  size: number;
}> {
  return manifest.artifacts
    .filter((artifact) => isOutputArtifactKind(artifact.kind))
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
  // The alternate must change the RUST PROJECTION, not merely the browser
  // JSON: a presence-tracked key that is absent in a legacy covering row
  // serializes differently but projects to the same wire default, and a
  // perturbation built from it is a semantic no-op. Draw the value from the
  // equivalence-class authority and require a projected difference — the
  // exact property the caller asserts.
  const baselineProjection = JSON.stringify(
    buildRustV2Options(baseline, GOLDEN_RUNTIME),
  );
  const alternate = configurationEquivalenceClasses(key).find(
    ({ value }) =>
      JSON.stringify(
        buildRustV2Options(withValue(baseline, key, value), GOLDEN_RUNTIME),
      ) !== baselineProjection,
  );
  if (!alternate) throw new Error(`no alternate equivalence class for ${key}`);
  return { id: `single-${key}`, options: withValue(baseline, key, alternate.value) };
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

/** A labelled `Configuration` for one perturbed option key. The set-or-delete
 * step is the shared `withValue` helper the other campaigns use; only the id
 * naming is specific to this campaign's context/key/label addressing. */
function configurationWithValue(
  context: PerturbationContext,
  key: string,
  label: string,
  value: unknown,
): Configuration {
  return {
    id: `${context.id}:${key}:${label}`,
    options: withValue(context.options, key, value),
  };
}

function nodeInputKeys(manifest: CampaignRuntimeManifest): Record<string, string> {
  return Object.fromEntries(
    manifest.queryGroupExecutions.map((node) => [
      node.query_group_id,
      node.input_key,
    ]),
  );
}

function nodeStatuses(manifest: CampaignRuntimeManifest): Record<string, string> {
  return Object.fromEntries(
    manifest.queryGroupExecutions.map((node) => [
      node.query_group_id,
      node.status,
    ]),
  );
}

function executedGroupIds(manifest: CampaignRuntimeManifest): string[] {
  return [
    ...new Set(
      manifest.queryExecutions
        .filter((step) => step.status === "recomputed")
        .map((step) => step.query_group_id),
    ),
  ].sort();
}

function obligationRoles(report: {
  openObligations: Array<{ role_id: string }>;
}): string[] {
  return report.openObligations.map((obligation) => obligation.role_id).sort();
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
    expect(generateSyntheticChronicleCorpus(profileA, catalog).csv).not.toBe(
      generateSyntheticChronicleCorpus(profileB, catalog).csv,
    );
  });
});

describe("Rust/WASM configuration-space campaign", () => {
  it("keeps screen-session maximum-duration interventions in a legal pair", () => {
    expect(interventionFields("screenSessionMaximumDurationMinutes")).toEqual([
      "screenSessionMaximumDurationMinutes",
      "screenSessionMaximumDurationDisposition",
    ]);
    const active = withValue(
      ALL_ON,
      "screenSessionMaximumDurationDisposition",
      "exclude_participant",
    );
    expect(active.screenSessionMaximumDurationMinutes).toBe(60);
    expect(validConfiguration(active)).toBe(true);
    expect(
      withValue(active, "screenSessionMaximumDurationMinutes", 0),
    ).toMatchObject({
      screenSessionMaximumDurationMinutes: 0,
      screenSessionMaximumDurationDisposition: "none",
    });
    expect(
      validConfiguration({
        ...ALL_ON,
        screenSessionMaximumDurationMinutes: 60,
        screenSessionMaximumDurationDisposition: "none",
      }),
    ).toBe(false);
  });

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

  it("pins qualification scientific preflight outcomes before execution", async () => {
    const classified = await classifyConfigurations(
      qualificationCorpus,
      t3Configs,
      "qualification-preflight-pin",
    );
    const refused: string[] = [];
    const structural: string[] = [];
    for (const config of classified.executable) {
      if (!requiresLiveScientificPreflight(config.options)) continue;
      const csvBytes = encoder.encode(qualificationCorpus.csv);
      const requestJson = await runtimeRequestJson(
        qualificationCorpus,
        config,
        `qualification-preflight-pin:${config.id}`,
        null,
        csvBytes,
      );
      const supports = new runtime.RuntimeSupportFiles();
      try {
        for (const [role, file] of supportCsv(
          qualificationCorpus,
          config.options,
        )) {
          supports.put_with_name(role, file.name, encoder.encode(file.csv));
        }
        let receipt: RuntimeScientificPreflightReceipt;
        try {
          receipt = JSON.parse(
            runtime.scientific_preflight_json(requestJson, csvBytes, supports),
          ) as RuntimeScientificPreflightReceipt;
        } catch (error) {
          if (errorText(error) !== SELECTED_TIMEZONE_STRUCTURAL_ERROR) {
            throw new Error(`${config.id}: ${errorText(error)}`, { cause: error });
          }
          structural.push(config.id);
          continue;
        }
        if (receipt.b05Schoedel.disposition === "refused") refused.push(config.id);
      } finally {
        supports.free();
      }
    }
    if (process.env.CHRONICLE_PRINT_PINS === "1") {
      // nosemgrep: semgrep.chronicle-ts-console-log -- explicit re-pin dump
      console.log("CHRONICLE_PINS_QUAL_PREFLIGHT " + JSON.stringify(refused));
    }
    expect(classified.executable).toHaveLength(306);
    expect(structural).toEqual(QUALIFICATION_PREFLIGHT_STRUCTURAL_IDS);
    expect(refused).toEqual(
      classified.executable
        .filter(
          ({ options }) =>
            hasSourceSensitiveScreenStrategy(options) &&
            usesInputCapabilityEvidence(options),
        )
        .map(({ id }) => id),
    );
    expect(refused).toHaveLength(204);
  });

  it("executes complete t=3 coverage across every valid synthetic profile plus a high-order sample", async () => {
    const corpusReports: Array<Record<string, unknown>> = [];
    const coldDense = new Map<string, CampaignRuntimeManifest>();
    const coldDenseRefusals = new Map<string, RuntimeScientificPreflightReceipt>();
    const coldDenseStructuralErrors = new Map<string, CampaignStructuralError>();
    const inputDependentRefusals: InputDependentRefusal[] = [];
    const inputDependentStructuralErrors: InputDependentStructuralError[] = [];
    const caseIdentities: string[] = [];
    let coldExecutions = 0;
    // PICT is free to find a different-size covering array as domains and
    // constraints evolve. Pin semantic completeness below, not an incidental
    // row count from one generator run.
    expect(t3Configs.length).toBeGreaterThan(0);
    expect(new Set(t3Configs.map(({ id }) => id)).size).toBe(t3Configs.length);
    // The checked-in covering array must span the CURRENT computational key
    // set -- a frozen array silently kept covering an old axis list for
    // months while claiming 100% coverage (11 axes were missing). A single
    // decoded row may omit `unset` presence-marker keys, so assert on the
    // UNION across rows: every computational key must appear somewhere.
    {
      const coveredKeys = new Set(
        coveringT3.configs.flatMap(({ options }) =>
          Object.keys(options).filter((key) =>
            (COMPUTATIONAL_BROWSER_OPTION_KEYS as readonly string[]).includes(key),
          ),
        ),
      );
      const uncovered = [...COMPUTATIONAL_BROWSER_OPTION_KEYS].filter(
        (key) => !coveredKeys.has(key),
      );
      expect(
        uncovered,
        "computational axes absent from every covering-array row -- regenerate the arrays (scripts/run_combinatorial_coverage.sh)",
      ).toEqual([]);
    }
    expect(seededConfigs).toHaveLength(128);
    const preflightCorpus = corpora[0];
    if (preflightCorpus === undefined) {
      throw new Error("configuration campaign requires at least one corpus");
    }
    const highOrderCorpus = corpora.find(
      (corpus) => corpus.id === "interaction-pathologies",
    )!;
    const t3Classification = await classifyConfigurations(
      preflightCorpus,
      t3Configs,
      "covering-array-t3",
    );
    const seededClassification = await classifyConfigurations(
      highOrderCorpus,
      seededConfigs,
      "seeded-high-order",
    );
    // One-run re-pin aid: dump every observed pin set as JSON, then let the
    // assertions below fail as usual. Used when the covering arrays are
    // deliberately regenerated (all pict_* pins move together).
    if (process.env.CHRONICLE_PRINT_PINS === "1") {
      // nosemgrep: semgrep.chronicle-ts-console-log -- CHRONICLE_PRINT_PINS=1 re-pin dump, silent in normal runs
      console.log(
        "CHRONICLE_PINS_T3_REFUSALS " +
          JSON.stringify(
            t3Classification.refusalReceipts.map(
              ({ configurationId }) => configurationId,
            ),
          ),
      );
      // nosemgrep: semgrep.chronicle-ts-console-log -- CHRONICLE_PRINT_PINS=1 re-pin dump, silent in normal runs
      console.log(
        "CHRONICLE_PINS_SEEDED_REFUSALS " +
          JSON.stringify(
            seededClassification.refusalReceipts.map(
              ({ configurationId }) => configurationId,
            ),
          ),
      );
    }
    expect(
      t3Classification.refusalReceipts.map(
        ({ configurationId }) => configurationId,
      ),
    ).toEqual([
      "pict_1",
      "pict_10",
      "pict_44",
      "pict_47",
      "pict_63",
      "pict_64",
      "pict_70",
      "pict_74",
      "pict_86",
      "pict_96",
      "pict_132",
      "pict_159",
      "pict_182",
      "pict_209",
      "pict_223",
      "pict_237",
      "pict_264",
      "pict_280",
    ]);
    expect(
      seededClassification.refusalReceipts.map(
        ({ configurationId }) => configurationId,
      ),
    ).toEqual([
      "seeded_00c0ffee_2",
      "seeded_00c0ffee_10",
      "seeded_00c0ffee_30",
      "seeded_00c0ffee_41",
      "seeded_00c0ffee_45",
      "seeded_00c0ffee_50",
      "seeded_00c0ffee_51",
      "seeded_00c0ffee_65",
      "seeded_00c0ffee_79",
      "seeded_00c0ffee_120",
    ]);
    expect(t3Classification.executable).toHaveLength(306);
    expect(seededClassification.executable).toHaveLength(118);
    const sourceSensitiveScientificCells =
      await runSourceSensitiveScientificCells();
    expect(
      sourceSensitiveScientificCells.map(({ id, status, executeCalls }) => ({
        id,
        status,
        executeCalls,
      })),
    ).toEqual([
      { id: "parry-exact-bound", status: "executed", executeCalls: 1 },
      { id: "zhu-exact-bound", status: "executed", executeCalls: 1 },
      {
        id: "schoedel-chronicle-exact-bound",
        status: "executed",
        executeCalls: 1,
      },
      { id: "parry-missing-capability", status: "refused", executeCalls: 0 },
      {
        id: "zhu-stale-capability-binding",
        status: "refused",
        executeCalls: 0,
      },
      {
        id: "schoedel-stale-capability-binding",
        status: "refused",
        executeCalls: 0,
      },
      { id: "parry-crlf-raw-rebound", status: "executed", executeCalls: 1 },
      {
        id: "parry-capability-sidecar-crlf",
        status: "executed",
        executeCalls: 1,
      },
      {
        id: "parry-field:support:capability-schema-version-invalid",
        status: "validation_error",
        executeCalls: 0,
      },
      {
        id: "parry-field:support:capability-stale-raw-binding",
        status: "executed",
        executeCalls: 1,
      },
      {
        id: "parry-field:support:capability-wildcard-to-participant",
        status: "executed",
        executeCalls: 1,
      },
      {
        id: "parry-field:support:capability-id-swap",
        status: "executed",
        executeCalls: 1,
      },
      {
        id: "parry-field:support:capability-capable-to-absent",
        status: "refused",
        executeCalls: 0,
      },
      {
        id: "parry-field:support:capability-evidence-basis",
        status: "executed",
        executeCalls: 1,
      },
      {
        id: "parry-field:support:capability-evidence-reference",
        status: "executed",
        executeCalls: 1,
      },
      {
        id: "parry-field:support:capability-evidence-digest",
        status: "executed",
        executeCalls: 1,
      },
    ]);

    for (const corpus of corpora) {
      const published = new Set<string>();
      const provenance = new Set<string>();
      const roots = new Set<string>();
      let minimumProcessed = Number.POSITIVE_INFINITY;
      let maximumProcessed = 0;
      let corpusRefusals = 0;
      let corpusStructuralErrors = 0;
      for (const config of t3Classification.executable) {
        const identity = `cold:t3:${corpus.id}:${config.id}`;
        const attempt = await attemptCampaignExecution(corpus, config, identity);
        if (attempt.refusal !== undefined) {
          inputDependentRefusals.push(
            inputDependentRefusal("covering-array-t3", corpus, config, attempt.refusal),
          );
          corpusRefusals += 1;
          caseIdentities.push(`${identity}:refused:${attempt.refusal.commitDigest}`);
          if (corpus.id === "support-intersections")
            coldDenseRefusals.set(config.id, attempt.refusal);
          continue;
        }
        if (attempt.structuralError !== undefined) {
          inputDependentStructuralErrors.push(
            inputDependentStructuralError(
              "covering-array-t3",
              attempt.structuralError,
            ),
          );
          corpusStructuralErrors += 1;
          caseIdentities.push(
            `${identity}:structural-error:${attempt.structuralError.reason}`,
          );
          if (corpus.id === "support-intersections")
            coldDenseStructuralErrors.set(config.id, attempt.structuralError);
          continue;
        }
        const { manifest } = attempt.run;
        coldExecutions += 1;
        expect(manifest.protocolVersion, identity).toBe(
          "chronicle-preprocessing-runtime/v2",
        );
        expect(manifest.openObligations, identity).toEqual([]);
        expect(manifest.queryGroupExecutions.length, identity).toBeGreaterThan(
          0,
        );
        expect(
          new Set(
            manifest.queryGroupExecutions.map(
              ({ query_group_id }) => query_group_id,
            ),
          ).size,
          identity,
        ).toBe(manifest.queryGroupExecutions.length);
        expect(
          manifest.queryGroupExecutions.every(
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
        t3RowsEnumerated: t3Configs.length,
        t3Executions:
          t3Classification.executable.length -
          corpusRefusals -
          corpusStructuralErrors,
        t3ScientificRefusals: t3Classification.refusalReceipts.length,
        t3InputDependentRefusals: corpusRefusals,
        t3InputDependentStructuralErrors: corpusStructuralErrors,
        uniquePublishedOutputs: published.size,
        uniquePipelineProvenance: provenance.size,
        uniqueWorkspaceRoots: roots.size,
        processedRows: { minimum: minimumProcessed, maximum: maximumProcessed },
      });
    }

    const highOrderPublished = new Set<string>();
    for (const config of seededClassification.executable) {
      const identity = `cold:seeded:${highOrderCorpus.id}:${config.id}`;
      const attempt = await attemptCampaignExecution(highOrderCorpus, config, identity);
      if (attempt.refusal !== undefined) {
        inputDependentRefusals.push(
          inputDependentRefusal("seeded-high-order", highOrderCorpus, config, attempt.refusal),
        );
        caseIdentities.push(`${identity}:refused:${attempt.refusal.commitDigest}`);
        continue;
      }
      if (attempt.structuralError !== undefined) {
        inputDependentStructuralErrors.push(
          inputDependentStructuralError(
            "seeded-high-order",
            attempt.structuralError,
          ),
        );
        caseIdentities.push(
          `${identity}:structural-error:${attempt.structuralError.reason}`,
        );
        continue;
      }
      const { manifest } = attempt.run;
      coldExecutions += 1;
      expect(manifest.openObligations, identity).toEqual([]);
      expect(
        manifest.queryGroupExecutions.every(
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
    /// Executed warm/cold artifact comparisons on the t3 chain. Asserted
    /// non-zero below so a chain that refused every cell cannot leave the
    /// comparison silently unexecuted while the test still passes.
    let t3WarmColdArtifactComparisons = 0;
    for (const config of t3Classification.executable) {
      const warm = await attemptCampaignExecution(
        denseCorpus,
        config,
        warmWorkspace,
        previousRoot,
      );
      const coldRefusal = coldDenseRefusals.get(config.id);
      if (coldRefusal !== undefined || warm.refusal !== undefined) {
        // A cell the cold oracle refused must refuse warm with the identical
        // committed receipt, and never the other way round.
        expect(
          warm.refusal?.commitDigest,
          `incremental ${config.id}: warm/cold refusal identity`,
        ).toBe(coldRefusal?.commitDigest);
        expect(warm.refusal?.commitDigest).toBeDefined();
        continue;
      }
      const coldStructuralError = coldDenseStructuralErrors.get(config.id);
      if (
        coldStructuralError !== undefined ||
        warm.structuralError !== undefined
      ) {
        expect(
          warm.structuralError,
          `incremental ${config.id}: warm/cold structural-error identity`,
        ).toEqual(coldStructuralError);
        expect(warm.structuralError).toBeDefined();
        continue;
      }
      const cold = coldDense.get(config.id)!;
      expect(
        semanticOutcome(warm.run.manifest),
        `incremental ${config.id}`,
      ).toEqual(semanticOutcome(cold));
      // Comparing only the semantic outcome let a wrongly-reused artifact hide
      // behind matching aggregate counts: `publishedOutputsDigest` covers the
      // set as one hash, so a single stale researcher-visible file is visible
      // here only per artifact. Both sides are already materialized manifests,
      // so this costs no additional execution.
      expect(
        outputArtifacts(warm.run.manifest),
        `incremental ${config.id}: warm/cold output artifacts`,
      ).toEqual(outputArtifacts(cold));
      t3WarmColdArtifactComparisons += 1;
      previousRoot = warm.run.manifest.workspaceRootDigest;
    }
    expect(
      t3WarmColdArtifactComparisons,
      "t3 warm chain: executed warm/cold artifact comparisons",
    ).toBeGreaterThan(0);

    // Change each computational option independently. The changed run reuses the
    // baseline workspace and must match a separate cold Rust execution. This
    // is the stale-result oracle: a missing plan binding can no longer hide
    // behind a transition that also changed some correctly-bound option.
    /// Executed warm/cold cell+byte comparisons across the single-option
    /// transitions. Asserted non-zero after the loop: every key can legally
    /// refuse on this corpus, and a loop that compared nothing would otherwise
    /// pass while proving nothing.
    let singleOptionValueOracleCases = 0;
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
      // A real alternate can legitimately refuse at scientific preflight on
      // this corpus (a source-sensitive screen strategy refuses the dense
      // corpus's non-monotonic timestamps). The stale-result oracle still
      // holds for a refused cell: the warm workspace must refuse with exactly
      // the receipt a cold workspace produces. Only a warm/cold disagreement
      // is a defect.
      const attempt = async (identity: string, previousRoot?: string) => {
        try {
          return {
            run: await execute(
              denseCorpus,
              changed,
              identity,
              previousRoot,
              undefined,
              undefined,
              undefined,
              true,
            ),
          };
        } catch (error) {
          const cause = (error as Error).cause;
          if (
            cause instanceof ScientificCampaignRefusalError &&
            cause.receipt !== undefined
          ) {
            return { refusal: cause.receipt };
          }
          throw error;
        }
      };
      const warm = await attempt(
        workspaceIdentity,
        initial.manifest.workspaceRootDigest,
      );
      const cold = await attempt(`single-option-cold:${key}`);
      if (warm.refusal !== undefined || cold.refusal !== undefined) {
        expect(
          warm.refusal?.commitDigest,
          `${key}: warm/cold refusal identity`,
        ).toEqual(cold.refusal?.commitDigest);
        expect(warm.refusal?.commitDigest).toBeDefined();
        continue;
      }
      expect(
        semanticOutcome(warm.run.manifest),
        `${key}: warm/cold semantic outcome`,
      ).toEqual(semanticOutcome(cold.run.manifest));
      expect(
        outputArtifacts(warm.run.manifest),
        `${key}: warm/cold output artifacts`,
      ).toEqual(outputArtifacts(cold.run.manifest));
      // The dangerous direction, empirically. Digest+size is what the run says
      // about itself; these two assertions compare what a consumer reads. Cell
      // equality names the exact column/row when they disagree, byte equality
      // additionally covers ordering, quoting, and header bytes that no cell
      // address carries. A query that failed to re-run although a bound input
      // moved shows up here as a stale cell or byte -- with no model of graph
      // reachability anywhere in the check.
      // Two empty cell maps compare equal, so the comparison is only evidence
      // once the extraction is shown to have produced something.
      // Shape cells (#/shape/rows, #/shape/columns) are emitted even for a
      // header-only CSV, so counting all keys would admit a comparison of
      // zero row-level content. review-summary-json and
      // visualization-data-json are published unconditionally (runtime
      // lib.rs output_artifacts), so a non-shape cell always exists when
      // extraction worked.
      expect(
        Object.keys(warm.run.capturedCells!).filter(
          (address) =>
            !address.endsWith("#/shape/rows") &&
            !address.endsWith("#/shape/columns"),
        ).length,
        `${key}: warm output content cells extracted`,
      ).toBeGreaterThan(0);
      expect(
        changedCellAddresses(
          warm.run.capturedCells!,
          cold.run.capturedCells!,
        ),
        `${key}: warm/cold output cells`,
      ).toEqual([]);
      expect(
        warm.run.capturedArtifacts.size,
        `${key}: canonical artifacts captured`,
      ).toBeGreaterThan(0);
      // Kinds captured is not bytes captured: two all-empty payload maps
      // compare equal, so the byte oracle is only evidence once at least one
      // payload is non-empty (the unconditional JSON artifacts guarantee it).
      expect(
        [...warm.run.capturedArtifacts.values()].reduce(
          (total, bytes) => total + bytes.byteLength,
          0,
        ),
        `${key}: canonical artifact bytes captured`,
      ).toBeGreaterThan(0);
      expect(
        changedCanonicalArtifactBytes(
          warm.run.capturedArtifacts,
          cold.run.capturedArtifacts,
        ),
        `${key}: warm/cold raw artifact bytes`,
      ).toEqual([]);
      // The two side-by-side CSV kinds have byte-level (not cell-level)
      // oracle coverage, and nothing else asserts they were ever captured:
      // their presence must not silently evaporate with a corpus or
      // alternate-value change. write_app_csv_from_iter always emits a header
      // when the axis is on, so a non-empty capture is guaranteed here.
      const expectedSideBySideKind =
        key === "notificationProxyRule"
          ? "notification-contact-csv"
          : key === "polledEmulationMethod"
            ? "polled-emulation-csv"
            : null;
      if (expectedSideBySideKind !== null) {
        for (const [label, captured] of [
          ["warm", warm.run.capturedArtifacts],
          ["cold", cold.run.capturedArtifacts],
        ] as const) {
          expect(
            captured.get(expectedSideBySideKind)?.byteLength ?? 0,
            `${key}: ${label} capture holds ${expectedSideBySideKind}`,
          ).toBeGreaterThan(0);
        }
      }
      singleOptionValueOracleCases += 1;
    }
    expect(
      singleOptionValueOracleCases,
      "single-option transitions: executed warm/cold value comparisons",
    ).toBeGreaterThan(0);

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
      const changedNodes = changedRun.manifest.queryGroupExecutions
        .filter(
          (node) => node.status === "recomputed" || node.status === "error",
        )
        .map((node) => node.query_group_id);
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
        const withoutViewDependentArtifacts = (manifest: CampaignRuntimeManifest) =>
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
    // Both sides already hold the app.csv payload, so binding the warm run's
    // annotated output to the cold run's byte-for-byte is free here and is the
    // narrowest place the digest could have been honest about the wrong bytes.
    // Empty-vs-empty compares equal, so pin that each run actually captured
    // app-csv before trusting the byte comparison below.
    for (const [label, run] of [
      ["initial", annotationInitial],
      ["warm", annotationWarm],
      ["cold", annotationCold],
    ] as const) {
      expect(
        [...run.capturedArtifacts.keys()],
        `studyName: ${label} app.csv captured`,
      ).toEqual(["app-csv"]);
    }
    expect(
      changedCanonicalArtifactBytes(
        annotationWarm.capturedArtifacts,
        annotationCold.capturedArtifacts,
      ),
      "studyName: warm/cold app.csv raw bytes",
    ).toEqual([]);
    expect(
      annotationWarm.manifest.queryGroupExecutions
        .filter((node) => node.status === "recomputed")
        .map((node) => node.query_group_id),
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

    const structuralInvalidRows: string[] = [];
    const qualificationSuccesses: string[] = [];
    for (const config of t3Classification.executable) {
      const identity = `qualification:${config.id}`;
      const shouldFail =
        config.options.timezoneHandling === "selected-filter" &&
        config.options.selectedTimezone === "America/New_York";
      const attempt = await attemptCampaignExecution(
        qualificationCorpus,
        config,
        identity,
      );
      if (attempt.refusal !== undefined) {
        // Scientific refusal has precedence over any downstream structural
        // error the same configuration would encounter during execution.
        inputDependentRefusals.push(
          inputDependentRefusal(
            "qualification",
            qualificationCorpus,
            config,
            attempt.refusal,
          ),
        );
        continue;
      }
      if (attempt.structuralError !== undefined) {
        expect(
          shouldFail,
          `${identity}: ${attempt.structuralError.reason}`,
        ).toBe(true);
        inputDependentStructuralErrors.push(
          inputDependentStructuralError(
            "qualification",
            attempt.structuralError,
          ),
        );
        structuralInvalidRows.push(config.id);
        continue;
      }
      const { manifest } = attempt.run;
      expect(shouldFail, `${identity} unexpectedly succeeded`).toBe(false);
      expect(manifest.openObligations, identity).toEqual([]);
      qualificationSuccesses.push(config.id);
    }
    // Every selected-filter/New_York row is either refused scientifically
    // first or rejected by the exact typed structural outcome below.
    if (process.env.CHRONICLE_PRINT_PINS === "1") {
      // nosemgrep: semgrep.chronicle-ts-console-log -- CHRONICLE_PRINT_PINS=1 re-pin dump, silent in normal runs
      console.log(
        "CHRONICLE_PINS_STRUCTURAL_INVALID " + JSON.stringify(structuralInvalidRows),
      );
    }
    expect(structuralInvalidRows).toEqual(QUALIFICATION_STRUCTURAL_IDS);
    // Input-dependent scientific refusals: only the four source-sensitive
    // screen strategies refuse, only on the corpora whose participant
    // timestamps decrease in physical source order, always with the same
    // typed reason. Anything else here is a new behaviour that must be pinned
    // deliberately, not absorbed.
    for (const refusal of inputDependentRefusals) {
      expect(refusal.component, JSON.stringify(refusal)).toBe("screen");
      expect(
        [
          "parry_toth_2025_session_glance_v1",
          "zhu_2018_unlock_lock_v1",
          "unlock_to_lock_v1",
          "unlock_to_off_or_lock_v1",
        ],
        JSON.stringify(refusal),
      ).toContain(refusal.screenSessionConstructionStrategy);
      expect(refusal.reason, JSON.stringify(refusal)).toBe(
        "non_monotonic_source_timestamps",
      );
    }
    const refusalTally = (family: string) =>
      Object.fromEntries(
        [...new Set(inputDependentRefusals.filter((r) => r.family === family).map((r) => r.corpusId))]
          .sort()
          .map((corpusId) => [
            corpusId,
            inputDependentRefusals.filter((r) => r.family === family && r.corpusId === corpusId).length,
          ]),
      );
    const structuralErrorTally = (family: string) =>
      Object.fromEntries(
        [
          ...new Set(
            inputDependentStructuralErrors
              .filter((error) => error.family === family)
              .map((error) => error.corpusId),
          ),
        ]
          .sort()
          .map((corpusId) => [
            corpusId,
            inputDependentStructuralErrors.filter(
              (error) =>
                error.family === family && error.corpusId === corpusId,
            ).length,
          ]),
      );
    if (process.env.CHRONICLE_PRINT_PINS === "1") {
      // nosemgrep: semgrep.chronicle-ts-console-log -- CHRONICLE_PRINT_PINS=1 re-pin dump, silent in normal runs
      console.log(
        "CHRONICLE_PINS_INPUT_DEPENDENT " +
          JSON.stringify({
            coveringArrayT3: refusalTally("covering-array-t3"),
            seededHighOrder: refusalTally("seeded-high-order"),
            qualification: refusalTally("qualification"),
            qualificationRefusedRows: inputDependentRefusals
              .filter((r) => r.family === "qualification")
              .map((r) => r.configurationId),
          }),
      );
      // nosemgrep: semgrep.chronicle-ts-console-log -- CHRONICLE_PRINT_PINS=1 re-pin dump, silent in normal runs
      console.log(
        "CHRONICLE_PINS_QUAL_PARTITION " +
          JSON.stringify(
            qualificationSuccesses.length +
              structuralInvalidRows.length +
              inputDependentRefusals.filter((r) => r.family === "qualification")
                .length,
          ),
      );
      // nosemgrep: semgrep.chronicle-ts-console-log -- CHRONICLE_PRINT_PINS=1 re-pin dump, silent in normal runs
      console.log(
        "CHRONICLE_PINS_INPUT_DEPENDENT_STRUCTURAL " +
          JSON.stringify({
            tally: {
              coveringArrayT3: structuralErrorTally("covering-array-t3"),
              seededHighOrder: structuralErrorTally("seeded-high-order"),
              qualification: structuralErrorTally("qualification"),
            },
            cases: [...inputDependentStructuralErrors].sort((left, right) =>
              `${left.family}:${left.corpusId}:${left.configurationId}`.localeCompare(
                `${right.family}:${right.corpusId}:${right.configurationId}`,
              ),
            ),
          }),
      );
    }
    expect({
      coveringArrayT3: refusalTally("covering-array-t3"),
      seededHighOrder: refusalTally("seeded-high-order"),
      qualification: refusalTally("qualification"),
    }).toEqual(INPUT_DEPENDENT_REFUSALS_EXPECTED);
    expect(
      inputDependentRefusals
        .filter((r) => r.family === "qualification")
        .map((r) => r.configurationId),
    ).toEqual(
      t3Classification.executable
        .filter(
          ({ options }) =>
            hasSourceSensitiveScreenStrategy(options) &&
            usesInputCapabilityEvidence(options),
        )
        .map(({ id }) => id),
    );
    const coldRefusals = inputDependentRefusals.filter(
      (r) => r.family !== "qualification",
    ).length;
    const coldStructuralErrors = inputDependentStructuralErrors.filter(
      (error) => error.family !== "qualification",
    ).length;
    expect(
      qualificationSuccesses.length +
        structuralInvalidRows.length +
        inputDependentRefusals.filter((r) => r.family === "qualification").length,
    ).toBe(306);
    expect(
      coldDense.size +
        coldDenseRefusals.size +
        coldDenseStructuralErrors.size,
    ).toBe(306);
    expect(coldExecutions).toBe(
      corpora.length * 306 +
        seededClassification.executable.length -
        coldRefusals -
        coldStructuralErrors,
    );
    expect(caseIdentities).toHaveLength(
      coldExecutions + coldRefusals + coldStructuralErrors,
    );

    const evidence = {
      protocolVersion: "chronicle-configuration-space-campaign/v2",
      claimBoundary:
        `The generated t=3 covering array contains ${t3Configs.length} rows. Configuration-only opener-set applicability is checked first, and every remaining active B05/Schoedel/EYES cell invokes the one-shot input-dependent scientific preflight on the exact same Rust/WASM engine, request, raw bytes, and support handle immediately before execution. Typed refusals are committed with executeCalls=0; input-dependent refusals (a source-sensitive screen strategy on a corpus whose participant timestamps decrease in physical source order) are committed per corpus with the same warm/cold receipt identity. The exact no-valid-app-usage runtime error is recorded separately as a structural input outcome and never promoted to a scientific refusal or successful empty result. Exact source-sensitive Parry, Zhu, and Schoedel cells include bound, missing, stale-binding, and CRLF raw-rebind witnesses. Qualification-corpus structural data failures are reported separately and only among preflight-executable rows. The seeded high-order sample follows the same executable/refused/structural partition.`,
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
        executableConfigurations: t3Classification.executable.length,
        scientificRefusalConfigurations:
          t3Classification.refusalReceipts.length,
        // "100%" is re-proven by scripts/run_combinatorial_coverage.sh step
        // 5 (verify-coverage) over the regenerated model, and the key-set
        // assertion above pins the array to the current computational axes;
        // this literal is the recorded claim, not the proof.
        exactValidTupleCoverage: "100%",
      },
      highOrderSample: {
        seed: seededHighOrder.seed,
        configurations: seededConfigs.length,
        executableConfigurations: seededClassification.executable.length,
        scientificRefusalConfigurations:
          seededClassification.refusalReceipts.length,
        inputDependentStructuralErrors: inputDependentStructuralErrors.filter(
          (error) => error.family === "seeded-high-order",
        ).length,
        uniquePublishedOutputs: highOrderPublished.size,
      },
      supportCatalogs: {
        authority: [
          "web/src/testSupport/fixtures/synthetic-catalog-app-codebook.csv",
          "web/src/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv",
          "web/src/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv",
          "web/src/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv",
        ],
        sourceCounts: catalog.sourceCounts,
      },
      campaign: {
        validCorpora: corpora.length,
        coldFullRustConfigurationsEnumerated:
          corpora.length * t3Configs.length + seededConfigs.length,
        coldFullRustExecutions: coldExecutions,
        scientificRefusalExecutionsAvoided:
          corpora.length * t3Classification.refusalReceipts.length +
          seededClassification.refusalReceipts.length,
        inputDependentRefusalsCommitted: coldRefusals,
        inputDependentStructuralErrors: coldStructuralErrors,
        incrementalColdOracleComparisons: t3WarmColdArtifactComparisons,
        singleComputationalOptionColdOracleComparisons:
          COMPUTATIONAL_BROWSER_OPTION_KEYS.length,
        noncomputationalInvarianceComparisons: orthogonalKeys.length,
        annotationDependencyComparisons: ANNOTATION_BROWSER_OPTION_KEYS.length,
        computationalOptionKeys: COMPUTATIONAL_BROWSER_OPTION_KEYS,
        qualification: {
          enumeratedConfigurations: t3Configs.length,
          preflightExecutableConfigurations: t3Classification.executable.length,
          scientificRefusalConfigurations:
            t3Classification.refusalReceipts.length,
          executions:
            qualificationSuccesses.length + structuralInvalidRows.length,
          successes: qualificationSuccesses.length,
          inputDependentRefusals: inputDependentRefusals.filter(
            (r) => r.family === "qualification",
          ).length,
          structuralInvalidConfigurations: structuralInvalidRows.length,
          structuralInvalidRows,
        },
      },
      refusalReceipts: {
        coveringArray: t3Classification.refusalReceipts,
        highOrderSample: seededClassification.refusalReceipts,
        sourceSensitiveScientificCells,
        inputDependent: inputDependentRefusals,
      },
      structuralErrors: {
        inputDependent: inputDependentStructuralErrors,
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
    // The covering campaign completed at ~534s of the old 600s budget once the
    // whole warm phase started genuinely executing; budget follows measured
    // cost, sharded and parallel with the sibling campaigns.
  }, CAMPAIGN_TEST_TIMEOUT_MS);

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
    const staleWorkflowCheckpointCases: Array<Record<string, unknown>> = [];
    // Salsa owns invalidation, so there is no predicted execution set to diff
    // against. What is recorded is the dangerous direction: a query that
    // executed in the warm target with nothing upstream of it having changed.
    const unjustifiedExecutionCases: Array<Record<string, unknown>> = [];
    // A DISTINCT failure, kept in its own list: a query badged `cached` in the
    // warm target while its published output digest moved from the warm source.
    // That reads only observed digests and statuses — never the published
    // declaration — so it fails for reasons the justification check cannot see
    // (a query evaluated outside the window the runtime measures), and merging
    // the two would report one cause under the other's name.
    const selfContradictingBadgeCases: Array<Record<string, unknown>> = [];
    let receipt: ReturnType<typeof authorityReceipt> | undefined;
    let coldExecutions = 0;
    let orderedTransitions = 0;
    let incrementalExecutions = 0;
    let requirementEvaluations = 0;

    for (const key of perturbationKeys) {
      const classes = configurationEquivalenceClasses(key);
      const declaredQueryBinders = new Set<string>();
      const declaredGroupBinders = new Set<string>();
      const declaredRuntimeArtifactBindings = new Set<string>();
      const observedCompatibilityInputKeyNodes = new Set<string>();
      const observedExecutedGroups = new Set<string>();
      const observedSemanticOutputNodes = new Set<string>();
      const observedChangedQueries = new Set<string>();
      const observedArtifactKinds = new Set<string>();
      const observedRoleStateKeys = new Set<string>();
      const observedQueryGroupStateKeys = new Set<string>();
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
            // Corpora where this transition crosses a scientific refusal
            // boundary. Kept separate from corpusObservations, whose entries
            // always carry the executable-transition shape consumed by
            // semanticModelMutation.test.ts.
            corpusRefusals: Array<{
              corpusId: string;
              sourceCommitDigest: string | null;
              targetCommitDigest: string | null;
            }>;
          }
        >();
        for (const from of eligibleClasses) {
          for (const to of eligibleClasses) {
            if (from.label === to.label) continue;
            transitionReports.set(`${from.label}->${to.label}`, {
              from: from.label,
              to: to.label,
              corpusObservations: [],
              corpusRefusals: [],
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
          // A source-sensitive class can legitimately refuse a corpus at
          // scientific preflight (a screen strategy refusing non-monotonic
          // source timestamps). The influence claim for such a cell is the
          // refusal itself: deterministic and identity-bound, warm exactly as
          // cold. Executable→refused transitions assert that boundary below;
          // a refused source has no warm workspace to transition from, so its
          // transitions record the cold refusal identity only.
          const refusalsByLabel = new Map<
            string,
            ScientificCampaignRefusalError["receipt"]
          >();
          const configsByLabel = new Map<string, Configuration>();
          const attemptExecute = async (
            config: Configuration,
            identity: string,
            previousRoot: string | null,
          ) => {
            try {
              return {
                run: await execute(
                  corpus,
                  config,
                  identity,
                  previousRoot,
                  undefined,
                  undefined,
                  true,
                ),
              };
            } catch (error) {
              const cause = (error as Error).cause;
              if (
                cause instanceof ScientificCampaignRefusalError &&
                cause.receipt !== undefined
              ) {
                return { refusal: cause.receipt };
              }
              throw error;
            }
          };
          for (const equivalenceClass of eligibleClasses) {
            const config = configurationWithValue(
              context,
              key,
              equivalenceClass.label,
              equivalenceClass.value,
            );
            configsByLabel.set(equivalenceClass.label, config);
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
            const attempted = await attemptExecute(config, identity, null);
            if (attempted.refusal !== undefined) {
              refusalsByLabel.set(equivalenceClass.label, attempted.refusal);
              continue;
            }
            const run = attempted.run;
            coldExecutions += 1;
            expect(
              run.boundRoles,
              `${identity}: exact active support transport`,
            ).toEqual([
              ...supportCsv(corpus, config.options, undefined, true).keys(),
            ]);
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
              const workspace = `influence:warm:${key}:${context.id}:${corpus.id}:${from.label}:${to.label}`;
              {
                // One intervention moves one configuration field — or, for a
                // key that travels inside the B06 maximum-duration vector, the
                // key itself plus the siblings its one legal pairing forces
                // (`interventionFields`); never anything outside that set.
                const moved = changedFields(
                  configsByLabel.get(from.label)!.options,
                  configsByLabel.get(to.label)!.options,
                );
                const allowed = interventionFields(key);
                expect(
                  moved.filter((field) => !allowed.includes(field)),
                  `${workspace}: intervention must not move fields outside ${JSON.stringify(allowed)}`,
                ).toEqual([]);
                expect(
                  moved.includes(key),
                  `${workspace}: intervention must change ${key}`,
                ).toBe(true);
              }
              const sourceRefusal = refusalsByLabel.get(from.label);
              const targetRefusal = refusalsByLabel.get(to.label);
              if (sourceRefusal !== undefined || targetRefusal !== undefined) {
                if (sourceRefusal === undefined && targetRefusal !== undefined) {
                  // Executable source, refused target: the warm workspace must
                  // refuse the intervention with exactly the receipt the cold
                  // cell produced.
                  const executableSource = coldByLabel.get(from.label)!;
                  const initial = await execute(
                    corpus,
                    executableSource.config,
                    workspace,
                    null,
                    undefined,
                    undefined,
                    true,
                  );
                  incrementalExecutions += 1;
                  expect(
                    semanticOutcome(initial.manifest),
                    `${workspace}: cold source`,
                  ).toEqual(semanticOutcome(executableSource.run.manifest));
                  const warm = await attemptExecute(
                    configsByLabel.get(to.label)!,
                    workspace,
                    initial.manifest.workspaceRootDigest,
                  );
                  expect(
                    warm.refusal?.commitDigest,
                    `${workspace}: warm/cold refusal identity`,
                  ).toEqual(targetRefusal.commitDigest);
                  expect(warm.refusal?.commitDigest).toBeDefined();
                }
                const refusalRecord = {
                  corpusId: corpus.id,
                  sourceCommitDigest: sourceRefusal?.commitDigest ?? null,
                  targetCommitDigest: targetRefusal?.commitDigest ?? null,
                };
                transitionReports
                  .get(`${from.label}->${to.label}`)!
                  .corpusRefusals.push(refusalRecord);
                caseIdentities.push(
                  JSON.stringify([
                    key,
                    context.id,
                    from.label,
                    to.label,
                    { refusal: refusalRecord },
                  ]),
                );
                continue;
              }
              const source = coldByLabel.get(from.label)!;
              const target = coldByLabel.get(to.label)!;
              const changedBoundRoles = [
                ...new Set([
                  ...source.run.boundRoles.filter(
                    (role) => !target.run.boundRoles.includes(role),
                  ),
                  ...target.run.boundRoles.filter(
                    (role) => !source.run.boundRoles.includes(role),
                  ),
                ]),
              ].sort();
              expect(
                changedBoundRoles,
                `${workspace}: capability is the only conditionally transported support role`,
              ).toEqual(
                usesInputCapabilityEvidence(source.config.options) ===
                  usesInputCapabilityEvidence(target.config.options)
                  ? []
                  : ["input_capability_evidence_file"],
              );
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
                staleWorkflowCheckpointCases.push({
                  workspace,
                  optionKey: key,
                  contextId: context.id,
                  corpusId: corpus.id,
                  staleNodes: changedFields(
                    warmNodeOutputDigests,
                    coldTargetNodeOutputDigests,
                  ),
                  coldSemanticChanges: changedFields(
                    source.run.manifest.processingSummary
                      .workflowQueryGroupDigests,
                    target.run.manifest.processingSummary
                      .workflowQueryGroupDigests,
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
                source.run.manifest.processingSummary.workflowQueryGroupDigests,
                target.run.manifest.processingSummary.workflowQueryGroupDigests,
              );
              const changedQueries = changedFields(
                source.run.manifest.processingSummary.workflowQueryDigests,
                target.run.manifest.processingSummary.workflowQueryDigests,
              );
              const checkpointComponentChanges = changedCheckpointComponents(
                source.run.manifest,
                target.run.manifest,
              );
              expect(
                Object.keys(checkpointComponentChanges).sort(),
                `${workspace}: typed checkpoint components do not commit to the terminal graph`,
              ).toEqual(changedSemanticOutputNodes);
              const queryCheckpointComponentChanges =
                changedQueryCheckpointComponents(
                  source.run.manifest,
                  target.run.manifest,
                );
              expect(
                Object.keys(queryCheckpointComponentChanges).sort(),
                `${workspace}: typed query checkpoint components do not commit to the complete query-registry graph`,
              ).toEqual(changedQueries);
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
              const changedQueryGroupStates = changedFields(
                source.requirements.queryGroupStates,
                target.requirements.queryGroupStates,
              );
              const sourceObligations = obligationRoles(source.requirements);
              const targetObligations = obligationRoles(target.requirements);

              const actualExecutedGroups = executedGroupIds(warm.manifest);
              const changedRustRequestFields = changedFields(
                buildRustV2Options(source.config.options, GOLDEN_RUNTIME),
                buildRustV2Options(target.config.options, GOLDEN_RUNTIME),
              );
              const actualExecutedQueries = executedQueryIds(warm.manifest);
              const changedQueryOutputs = new Set(changedQueries);
              const sourceQueryStatuses = queryStatuses(source.run.manifest);
              const targetQueryStatuses = queryStatuses(target.run.manifest);
              const newlyApplicableQueries = workflowContract.execution.queries
                .filter(
                  (step) =>
                    sourceQueryStatuses[step.id] === "bypassed" &&
                    targetQueryStatuses[step.id] !== "bypassed",
                )
                .map(({ id }) => id)
                .sort();
              const directQueryBinders = workflowContract.execution.queries
                .filter(
                  (step) =>
                    newlyApplicableQueries.includes(step.id) ||
                    step.requestFields.some((field) =>
                      changedRustRequestFields.includes(field),
                    ),
                )
                .map(({ id }) => id);
              for (const queryId of directQueryBinders) {
                declaredQueryBinders.add(queryId);
                declaredGroupBinders.add(
                  workflowContract.execution.queries.find(
                    ({ id }) => id === queryId,
                  )!.group,
                );
              }
              for (const field of changedRustRequestFields) {
                if (RUNTIME_ARTIFACT_REQUEST_FIELDS.has(field)) {
                  declaredRuntimeArtifactBindings.add(field);
                  declaredGroupBinders.add("outputs");
                }
              }
              const unjustifiedExecutedQueries = unjustifiedExecutions({
                contract: workflowContract,
                targetOptions: buildRustV2Options(
                  target.config.options,
                  GOLDEN_RUNTIME,
                ),
                sourceStatuses: sourceQueryStatuses,
                targetStatuses: targetQueryStatuses,
                changedRequestFields: new Set(changedRustRequestFields),
                changedQueryOutputs,
                executed: actualExecutedQueries,
              });
              // A Salsa body produces a new value only by running, so `cached`
              // while the published output digest moved from the warm source is
              // a self-contradicting badge. Reads only observed digests and
              // statuses, never the published declaration.
              const selfContradictingBadges = cachedWithChangedOutput(
                initial.manifest,
                warm.manifest,
              );
              if (unjustifiedExecutedQueries.length > 0) {
                unjustifiedExecutionCases.push({
                  workspace,
                  optionKey: key,
                  contextId: context.id,
                  corpusId: corpus.id,
                  changedRustRequestFields,
                  observed: actualExecutedQueries,
                  unjustifiedExecutedQueries,
                  unjustifiedExecutedGroups: [
                    ...new Set(
                      workflowContract.execution.queries
                        .filter((step) =>
                          unjustifiedExecutedQueries.includes(step.id),
                        )
                        .map((step) => step.group),
                    ),
                  ].sort(),
                  changedQueryOutputs: changedQueries,
                  changedSemanticOutputNodes,
                });
              }
              if (selfContradictingBadges.length > 0) {
                selfContradictingBadgeCases.push({
                  workspace,
                  optionKey: key,
                  contextId: context.id,
                  corpusId: corpus.id,
                  changedRustRequestFields,
                  observed: actualExecutedQueries,
                  selfContradictingBadges,
                  changedQueryOutputs: changedQueries,
                  changedSemanticOutputNodes,
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
              changedQueries.forEach((step) =>
                observedChangedQueries.add(step),
              );
              changedArtifactKinds.forEach((kind) =>
                observedArtifactKinds.add(kind),
              );
              changedRoleStates.forEach((role) =>
                observedRoleStateKeys.add(role),
              );
              changedQueryGroupStates.forEach((node) =>
                observedQueryGroupStateKeys.add(node),
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
                changedQueryGroupStates.length > 0 ||
                JSON.stringify(sourceObligations) !==
                  JSON.stringify(targetObligations)
              ) {
                axesWithSubstantiveObservedEffects.add(key);
              }

              const observation = {
                corpusId: corpus.id,
                changedRustRequestFields,
                newlyApplicableQueries,
                changedCompatibilityInputKeyNodes,
                actualExecutedGroups,
                actualExecutedQueries,
                changedSemanticOutputNodes,
                changedQueries,
                checkpointComponentChanges,
                queryCheckpointComponentChanges,
                changedArtifactKinds,
                changedCountFields,
                changedProcessingSummaryFields,
                changedBoundRoles,
                changedRoleStates,
                changedQueryGroupStates,
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
        [...declaredQueryBinders, ...declaredRuntimeArtifactBindings],
        `${key}: no Rust query or runtime-artifact binding was exercised`,
      ).not.toEqual([]);
      const binders = [...declaredGroupBinders].sort();
      const declaredCone = [...descendantsOf(new Set(binders))].sort();
      reports.push({
        optionKey: key,
        classes: classes.map(({ label, value }) => ({ label, value })),
        declaredBinders: binders,
        declaredQueryBinders: [...declaredQueryBinders].sort(),
        declaredRuntimeArtifactBindings: [
          ...declaredRuntimeArtifactBindings,
        ].sort(),
        declaredCone,
        observedCompatibilityInputKeyNodes: [
          ...observedCompatibilityInputKeyNodes,
        ].sort(),
        observedExecutedGroups: [...observedExecutedGroups].sort(),
        observedSemanticOutputNodes: [...observedSemanticOutputNodes].sort(),
        observedChangedQueries: [...observedChangedQueries].sort(),
        observedArtifactKinds: [...observedArtifactKinds].sort(),
        observedRoleStateKeys: [...observedRoleStateKeys].sort(),
        observedQueryGroupStateKeys: [...observedQueryGroupStateKeys].sort(),
        contexts: contextReports,
      });
    }

    const axesWithoutSubstantiveObservedEffects =
      COMPUTATIONAL_BROWSER_OPTION_KEYS.filter(
        (key) => !axesWithSubstantiveObservedEffects.has(key),
      );
    expect(
      staleWorkflowCheckpointCases,
      "every warm workflow query-group checkpoint must equal an independent cold target",
    ).toEqual([]);
    expect(
      unjustifiedExecutionCases,
      "every query that executed in a warm target needs a justification: newly applicable (bypassed in the source), a changed bound request field, a changed active source role, or a changed declared upstream output — and a query bypassed in the target must not execute at all",
    ).toEqual([]);
    expect(
      selfContradictingBadgeCases,
      "no query may be badged cached in the warm target while its published output digest moved from the warm source: a Salsa body produces a new value only by running",
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
      workflowCheckpointProtocol: "chronicle-workflow-checkpoint/v1",
      claimBoundary:
        "Exact complete query-registry and complete query-group execution plus warm/cold equality for the recorded Rust/WASM implementation, equivalence classes, contexts, support bindings, and synthetic corpora. Absence of an observed effect remains bounded to this declared test scope. Query recomputation is taken from actual Salsa query bodies plus explicitly instrumented product-query evaluations inside review-only fused queries. The separate sequential Rust path remains the independent cold oracle.",
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
        workflowQueryGroupCount: order.length,
        workflowQueryCount: workflowContract.execution.queries.length,
        warmColdCheckpointComparisons: orderedTransitions,
        warmColdQueryCheckpointComparisons:
          orderedTransitions * workflowContract.execution.queries.length,
        staleCheckpointCases: staleWorkflowCheckpointCases.length,
        unjustifiedExecutionCases: unjustifiedExecutionCases.length,
        selfContradictingBadgeCases: selfContradictingBadgeCases.length,
      },
      physicalExecutionBoundary:
        "The production runtime executes and reuses the registered Rust product queries through Salsa-tracked queries. The recorded recomputed-query set comes from actual query bodies plus explicitly instrumented product-query evaluations inside review-only fused queries; a restored row transform is not recorded as physically rerun. The query groups are derived from those query IDs. The separate sequential Rust path is used only as an independent cold oracle.",
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
    // Two influence shards exceeded the old 600s budget the first time the
    // warm transition phase ran to depth (every transition executes two full
    // runs); budget follows measured cost.
  }, CAMPAIGN_TEST_TIMEOUT_MS);
});
