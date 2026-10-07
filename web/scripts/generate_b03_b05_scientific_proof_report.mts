/**
 * Deterministic B03-B05 synthetic engineering proof report.
 *
 * This runner is intentionally opt-in. It executes only when the exact
 * `--assert-b03-b05-scientific-proof` flag is present, verifies every committed
 * fixture before loading the runtime, calls the one-shot scientific preflight
 * on the same Rust/WASM engine immediately before execution, and compares a
 * PHI-free projection to independently frozen expectations. It never compares
 * two modes of the current implementation and never treats synthetic numbers
 * as empirical findings.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { canonicalJson } from "../src/lib/canonicalJson";
import {
  AGGREGATE_SHAPE_VALUES,
  DEFAULT_BROWSER_OPTIONS,
  EPISODE_RECONSTRUCTION_STRATEGY_VALUES,
  EVENT_RETENTION_SET_VALUES,
  INTERVAL_QUALITY_POLICY_VALUES,
  MICRO_USE_CLASSIFICATION_POLICY_VALUES,
  MINIMUM_DURATION_COMPARATOR_VALUES,
  MINIMUM_DURATION_DISPOSITION_VALUES,
  OPENER_SET_VALUES,
  SCREEN_SESSION_CONSTRUCTION_STRATEGY_VALUES,
  SESSION_GROUPING_POLICY_VALUES,
  TIMEZONE_HANDLING_VALUES,
  type BrowserProcessingOptions,
} from "../src/lib/generatedContract";
import type {
  EyesTaggedFauValidationReceipt,
  RuntimeArtifactMetadata,
  RuntimeB05ApplicabilityProjection,
  RuntimeB05SchoedelPreflightReceipt,
  RuntimeEyesEvidenceSummary,
  RuntimeMinimumDurationReceipt,
  RuntimeSchoedelApplicabilityProjection,
  RuntimeScientificEvidenceSummary,
  RuntimeScientificPreflightReceipt,
  RuntimeScreenConstructionReceipt,
  RuntimeZeroDurationCleanupReceipt,
  MicroUseReceipt,
} from "../src/lib/generatedRuntimeBoundary";
import { requiresLiveScientificPreflight } from "../src/lib/inputCapabilityEvidence";
import { decodeScientificPreflightReceipt } from "../src/lib/scientificPreflightBoundary";
import {
  buildRustV2Options,
  decodeRuntimeManifest,
} from "../src/lib/rustPipelineRuntime";

type RuntimeSupportFilesHandle = {
  put_with_name(role: string, name: string, bytes: Uint8Array): void;
  free(): void;
};

type RuntimeHandle = {
  readonly artifact_count: number;
  manifest_json(): string;
  artifact_metadata_json(index: number): string;
  take_artifact_bytes(index: number): Uint8Array;
  free(): void;
};

type RuntimeModule = {
  initSync(input: { module: Uint8Array }): unknown;
  runtime_identity_json(): string;
  workflow_contract_json(): string;
  RuntimeSupportFiles: new () => RuntimeSupportFilesHandle;
  scientific_preflight_json(
    requestJson: string,
    csvBytes: Uint8Array,
    supportFiles: RuntimeSupportFilesHandle,
  ): string;
  execute_workspace(
    requestJson: string,
    csvBytes: Uint8Array,
    supportFiles: RuntimeSupportFilesHandle,
  ): RuntimeHandle;
};

type FixtureEntry = {
  id: string;
  path: string;
  sha256: string;
  boundRawInputSha256?: string;
};

type FixtureManifest = {
  protocolVersion: string;
  status: string;
  limitations: string[];
  fixtures: FixtureEntry[];
};

type PreflightProjection = {
  disposition: RuntimeB05SchoedelPreflightReceipt["disposition"];
  requestedScreenStrategyId: string;
  effectiveScreenStrategyId: string;
  requestedEpisodeStrategyId: string;
  effectiveEpisodeStrategyId: string | null;
  screenConstructionPhase: RuntimeB05SchoedelPreflightReceipt["screenConstructionPhase"];
  schoedelReconstructionPhase: RuntimeB05SchoedelPreflightReceipt["schoedelReconstructionPhase"];
  screenApplicability: RuntimeB05ApplicabilityProjection | null;
  schoedelApplicability: RuntimeSchoedelApplicabilityProjection | null;
  eyesDisposition: RuntimeScientificPreflightReceipt["eyesInputPartition"]["disposition"];
  eyesRefusalReason: RuntimeScientificPreflightReceipt["eyesInputPartition"]["refusalReason"];
  activeCapabilityRole: {
    artifactDigest: string;
    assignmentId: string;
  } | null;
};

type FoundationalProjection = {
  microUse: MicroUseReceipt;
  minimumDuration: RuntimeMinimumDurationReceipt;
  zeroDurationCleanup: RuntimeZeroDurationCleanupReceipt;
};

type B05Projection = {
  b05ScreenConstruction: RuntimeScreenConstructionReceipt;
};

type AppRowProjection = {
  participantId: string;
  appPackageName: string;
  durationSeconds: string | null;
  microUseClassification?: string;
  rawEpisodeDurationSeconds?: string;
  minimumDurationQualified?: string;
  minimumDurationAggregateEligible?: string;
  schoedelCompletion?: string;
  appUsageEndReason?: string;
};

type AppRowSelector = Pick<
  AppRowProjection,
  "participantId" | "appPackageName"
> & {
  schoedelCompletion?: string;
};

type EyesEvidenceProjection = {
  participantCount: number;
  p01AlphaFragmentStatuses: string[];
  endpointSelections: Array<{
    participantId: string;
    appPackageName: string;
    selectedEndInference: string;
  }>;
};

type ArtifactCatalogProjection = {
  artifactId: string;
  mediaType: string;
  digest: string;
  size: number;
  derivedFrom: string[];
  scientificSourceBindings: Array<{
    roleId: string;
    artifactDigest: string;
    assignmentId: string;
  }>;
  rowCount: number | null;
};

type ScientificProjection = Partial<FoundationalProjection & B05Projection> & {
  schoedelReconstruction?: Record<string, unknown>;
  eyesValidation?: Partial<EyesTaggedFauValidationReceipt>;
  eyesEvidence?: EyesEvidenceProjection;
  appRows?: AppRowProjection[];
  absentAppRows?: AppRowSelector[];
  appUsageEndReasons?: string[];
  minimumDurationExcludedLineage?: unknown[];
  requiredArtifactKinds: string[];
  forbiddenArtifactKinds: string[];
  /**
   * Filled only after the final runtime/dependency reseal and independent
   * review. `null` deliberately prevents --check/--update from learning a
   * catalog from the implementation it is meant to check.
   */
  scientificArtifactCatalog: Record<string, ArtifactCatalogProjection> | null;
};

type ExpectedOutcome = {
  status: "executed" | "refused";
  preflight: PreflightProjection | null;
  scientific: ScientificProjection | null;
};

type ProofArm = {
  id: string;
  fixtureId: string;
  supportFixtureId?: string;
  witnessIds: string[];
  options: Partial<BrowserProcessingOptions>;
  expected: ExpectedOutcome;
};

type ProofExpectations = {
  protocolVersion: string;
  fixtureManifestSha256: string;
  status: string;
  limitations: string[];
  arms: ProofArm[];
};

type RuntimeIdentity = {
  protocolVersion: string;
  implementationDigest: string;
  buildEnvironmentDigest: string;
  productContractDigest: string;
  planDigest: string;
  profileDigest: string;
  profileLockDigest: string;
  runtimeAuthorityDigest: string;
  dependencyCertificateDigest: string;
};

type ArmReport = {
  id: string;
  fixtureId: string;
  fixtureSha256: string;
  supportFixtureId: string | null;
  supportFixtureSha256: string | null;
  witnessIds: string[];
  options: BrowserProcessingOptions;
  optionVectorSha256: string;
  requestOptionsDigest: string;
  preflightCommitDigest: string | null;
  executeCalls: number;
  scientificArtifactCatalog: Record<string, ArtifactCatalogProjection>;
  dependencyCacheDecision: {
    mode: "certified_narrow" | "not_executed";
    certificateDigest: string | null;
    bindingSurfaceDigest: string | null;
    empiricalEvidenceCurrent: true | null;
    reasons: string[];
  };
  expected: ExpectedOutcome;
  observed: ExpectedOutcome;
};

type ProofReport = {
  protocolVersion: "chronicle-b03-b05-scientific-proof-report/v1";
  status: "synthetic_engineering_evidence_only";
  headlineEmpiricalMagnitudeClaim: "cannot_support_headline_empirical_magnitudes";
  evidenceScope: "low_level_authoritative_runtime_wasm";
  limitations: string[];
  fixtureManifest: {
    sha256: string;
    protocolVersion: string;
    fixtures: Array<{ id: string; sha256: string }>;
  };
  expectationSha256: string;
  runtime: {
    wasmSha256: string;
    identity: RuntimeIdentity;
    workflowContractSha256: string;
  };
  proofIds: string[];
  arms: ArmReport[];
};

const FIXTURE_ROOT = path.resolve("src/testSupport/fixtures");
const MANIFEST_PATH = path.join(FIXTURE_ROOT, "b03-b05-fixture-manifest.json");
const EXPECTATION_PATH = path.join(
  FIXTURE_ROOT,
  "b03-b05-scientific-proof-expectations.json",
);
const WASM_PATH = path.resolve(
  "src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm",
);
const REPORT_JSON_PATH = path.resolve(
  "../docs/paper/b03-b05-foundational-semantics-synthetic-proof-report.json",
);
const REPORT_MARKDOWN_PATH = path.resolve(
  "../docs/paper/b03-b05-foundational-semantics-synthetic-proof-report.md",
);
export const B03_B05_PROOF_REPORT_PATHS = {
  json: REPORT_JSON_PATH,
  markdown: REPORT_MARKDOWN_PATH,
} as const;
const FIXED_PREPROCESSING_TIME = "2026-08-12 00:00:00 UTC";
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const EXPECTED_FIXTURE_IDS = [
  "b03_b04_duration_boundaries",
  "b05_screen_construction",
  "schoedel_prose_reconstruction",
  "eyes_fau_close_provenance",
  "b05_input_capability_evidence",
  "schoedel_input_capability_evidence",
] as const;
const EXPECTED_WITNESS_IDS = [
  "b03_b04_inclusive_exclude_zero_vector",
  "b03_b04_strict_credit_vector",
  "b04_chronicle_blank_vector",
  "b04_strict_drop_lineage_vector",
  "b05_chronicle_baseline_vector",
  "b05_parry_combined_label_refusal_vector",
  "b05_parry_missing_capability_refusal_vector",
  "eyes_partial_replay_vector",
  "schoedel_chronicle_prose_vector",
] as const;

export function parseMode(argv: string[]): "check" | "update" {
  const exactFlag = "--assert-b03-b05-scientific-proof";
  if (!argv.includes(exactFlag)) {
    throw new Error(
      `${exactFlag} is required; no general runner mode may emit the synthetic proof report`,
    );
  }
  const check = argv.includes("--check");
  const update = argv.includes("--update");
  if (check === update) {
    throw new Error("exactly one of --check or --update is required");
  }
  const allowed = new Set([exactFlag, "--check", "--update"]);
  const unknown = argv.filter((argument) => !allowed.has(argument));
  if (unknown.length > 0) {
    throw new Error(`unknown proof-runner arguments: ${unknown.join(", ")}`);
  }
  return check ? "check" : "update";
}

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertSha256(label: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(
      `${label} is not a canonical SHA-256 digest: ${String(value)}`,
    );
  }
}

function assertUniqueSorted(label: string, values: string[]): void {
  if (
    values.some((value) => !value) ||
    values.some(
      (value, index) => index > 0 && (values[index - 1] ?? "") >= value,
    )
  ) {
    throw new Error(`${label} must be nonempty, unique, and strictly sorted`);
  }
}

const OPTION_ENUMS: Partial<
  Record<keyof BrowserProcessingOptions, readonly string[]>
> = {
  timezoneHandling: TIMEZONE_HANDLING_VALUES,
  aggregateShape: AGGREGATE_SHAPE_VALUES,
  eventRetentionSet: EVENT_RETENTION_SET_VALUES,
  openerSet: OPENER_SET_VALUES,
  episodeReconstructionStrategy: EPISODE_RECONSTRUCTION_STRATEGY_VALUES,
  microUseClassificationPolicy: MICRO_USE_CLASSIFICATION_POLICY_VALUES,
  minimumDurationComparator: MINIMUM_DURATION_COMPARATOR_VALUES,
  minimumDurationDisposition: MINIMUM_DURATION_DISPOSITION_VALUES,
  intervalQualityPolicy: INTERVAL_QUALITY_POLICY_VALUES,
  sessionGroupingPolicy: SESSION_GROUPING_POLICY_VALUES,
  screenSessionConstructionStrategy:
    SCREEN_SESSION_CONSTRUCTION_STRATEGY_VALUES,
};

/**
 * Expectations are hand-authored evidence, not application settings. Unknown
 * keys must therefore fail rather than flowing through a tolerant UI decoder
 * and silently selecting a runtime default.
 */
export function validateProofOptionOverrides(
  label: string,
  value: unknown,
): asserts value is Partial<BrowserProcessingOptions> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an exact browser-option object`);
  }
  const defaults = DEFAULT_BROWSER_OPTIONS as Record<string, unknown>;
  for (const [rawKey, observed] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(defaults, rawKey)) {
      throw new Error(`${label} contains unknown option ${rawKey}`);
    }
    const key = rawKey as keyof BrowserProcessingOptions;
    const allowed = OPTION_ENUMS[key];
    if (allowed) {
      if (typeof observed !== "string" || !allowed.includes(observed)) {
        throw new Error(`${label}.${rawKey} is outside its exact enum domain`);
      }
      continue;
    }
    const expected = defaults[rawKey];
    if (Array.isArray(expected)) {
      if (
        !Array.isArray(observed) ||
        observed.some((entry) =>
          expected.length > 0
            ? typeof entry !== typeof expected[0]
            : typeof entry !== "string",
        )
      ) {
        throw new Error(`${label}.${rawKey} has the wrong array element type`);
      }
      continue;
    }
    if (rawKey === "parallelMaxWorkers") {
      if (
        typeof observed !== "number" ||
        !Number.isSafeInteger(observed) ||
        observed < 1
      ) {
        throw new Error(`${label}.${rawKey} must be a positive safe integer`);
      }
      continue;
    }
    if (typeof observed !== typeof expected) {
      throw new Error(`${label}.${rawKey} has the wrong JSON type`);
    }
    if (
      typeof observed === "number" &&
      (!Number.isFinite(observed) || observed < 0)
    ) {
      throw new Error(`${label}.${rawKey} must be finite and nonnegative`);
    }
  }
}

export function validateBoundSupportFixture(
  label: string,
  support: Pick<FixtureEntry, "boundRawInputSha256">,
  rawInputSha256: string,
): void {
  assertSha256(`${label} raw input`, rawInputSha256);
  assertSha256(`${label} bound raw input`, support.boundRawInputSha256);
  if (support.boundRawInputSha256 !== rawInputSha256) {
    throw new Error(`${label} is not bound to its exact raw input`);
  }
}

function exactEqual(label: string, observed: unknown, expected: unknown): void {
  const observedJson = canonicalJson(observed);
  const expectedJson = canonicalJson(expected);
  if (observedJson !== expectedJson) {
    throw new Error(
      `${label} drifted\nexpected ${expectedJson}\nobserved ${observedJson}`,
    );
  }
}

function projectExpectedShape(observed: unknown, expected: unknown): unknown {
  if (Array.isArray(expected)) return observed;
  if (expected && typeof expected === "object") {
    if (!observed || typeof observed !== "object" || Array.isArray(observed)) {
      return observed;
    }
    return Object.fromEntries(
      Object.entries(expected).map(([key, nestedExpected]) => [
        key,
        projectExpectedShape(
          (observed as Record<string, unknown>)[key],
          nestedExpected,
        ),
      ]),
    );
  }
  return observed;
}

function projectPreflight(
  receipt: RuntimeScientificPreflightReceipt,
): PreflightProjection {
  const activeCapabilityRole =
    receipt.key.activeIngressRoles.input_capability_evidence_file ?? null;
  return {
    disposition: receipt.b05Schoedel.disposition,
    requestedScreenStrategyId: receipt.b05Schoedel.requestedScreenStrategyId,
    effectiveScreenStrategyId: receipt.b05Schoedel.effectiveScreenStrategyId,
    requestedEpisodeStrategyId: receipt.b05Schoedel.requestedEpisodeStrategyId,
    effectiveEpisodeStrategyId: receipt.b05Schoedel.effectiveEpisodeStrategyId,
    screenConstructionPhase: receipt.b05Schoedel.screenConstructionPhase,
    schoedelReconstructionPhase:
      receipt.b05Schoedel.schoedelReconstructionPhase,
    screenApplicability: receipt.b05Schoedel.screenApplicability,
    schoedelApplicability: receipt.b05Schoedel.schoedelApplicability,
    eyesDisposition: receipt.eyesInputPartition.disposition,
    eyesRefusalReason: receipt.eyesInputPartition.refusalReason,
    activeCapabilityRole,
  };
}

export function assertPreflightBeforeExecution(
  armId: string,
  expectedStatus: ExpectedOutcome["status"],
  expectedPreflight: PreflightProjection | null,
  observedPreflight: PreflightProjection | null,
): void {
  exactEqual(
    `arm ${armId} preflight before execution`,
    observedPreflight,
    expectedPreflight,
  );
  const refused =
    observedPreflight?.disposition === "refused" ||
    observedPreflight?.eyesDisposition === "refused";
  if (expectedStatus === "refused" && !refused) {
    throw new Error(
      `arm ${armId}: expected refusal became executable; execute is forbidden`,
    );
  }
  if (expectedStatus === "executed" && refused) {
    throw new Error(`arm ${armId}: expected executable vector was refused`);
  }
}

function stripFoundationalLineageDigests(
  summary: RuntimeScientificEvidenceSummary,
): FoundationalProjection {
  return {
    microUse: summary.microUseReceipt,
    minimumDuration: summary.minimumDurationReceipt,
    zeroDurationCleanup: summary.zeroDurationCleanupReceipt,
  };
}

function projectB05Screen(
  receipt: RuntimeScreenConstructionReceipt,
): RuntimeScreenConstructionReceipt {
  return receipt;
}

export function validatePreflightIdentity(
  arm: ProofArm,
  receipt: RuntimeScientificPreflightReceipt,
  requestJson: string,
  fixture: { entry: FixtureEntry; bytes: Uint8Array },
  supportFixture: { entry: FixtureEntry; bytes: Uint8Array } | undefined,
): void {
  const request = JSON.parse(requestJson) as { options?: unknown };
  const optionsDigest = sha256(canonicalJson(request.options));
  const roleIdentity = (roleId: string, artifactDigest: string) => ({
    artifactDigest,
    assignmentId: sha256(["assignment", roleId, artifactDigest].join("\u001f")),
  });
  const activeIngressRoles: Record<
    string,
    { artifactDigest: string; assignmentId: string }
  > = {
    processing_options: roleIdentity("processing_options", optionsDigest),
    raw_chronicle_csv: roleIdentity("raw_chronicle_csv", fixture.entry.sha256),
  };
  if (supportFixture) {
    activeIngressRoles.input_capability_evidence_file = roleIdentity(
      "input_capability_evidence_file",
      supportFixture.entry.sha256,
    );
  }
  exactEqual(`arm ${arm.id} exact preflight key`, receipt.key, {
    protocolVersion: "chronicle-runtime-scientific-preflight/v2",
    optionsDigest,
    inputDigest: fixture.entry.sha256,
    inputSizeBytes: fixture.bytes.byteLength,
    activeIngressRoles,
    fragmentedParticipantCount: 0,
    fragmentedParticipantTokenScopeDigest:
      "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  });
  if (
    receipt.protocolVersion !== "chronicle-runtime-scientific-preflight/v2" ||
    receipt.keyDigest !== sha256(canonicalJson(receipt.key)) ||
    receipt.b05SchoedelDigest !== sha256(canonicalJson(receipt.b05Schoedel)) ||
    receipt.eyesInputPartitionDigest !==
      sha256(canonicalJson(receipt.eyesInputPartition)) ||
    receipt.commitDigest !==
      sha256(
        canonicalJson({
          protocolVersion: receipt.protocolVersion,
          keyDigest: receipt.keyDigest,
          b05SchoedelDigest: receipt.b05SchoedelDigest,
          eyesInputPartitionDigest: receipt.eyesInputPartitionDigest,
        }),
      ) ||
    receipt.b05Schoedel.optionsDigest !== optionsDigest ||
    receipt.b05Schoedel.optionsDigestOrigin !== "verified_request_jcs" ||
    receipt.eyesInputPartition.optionsDigest !== optionsDigest ||
    receipt.eyesInputPartition.optionsDigestOrigin !== "verified_request_jcs" ||
    receipt.eyesInputPartition.inputDigest !== fixture.entry.sha256 ||
    receipt.eyesInputPartition.fragmentedParticipantCount !==
      receipt.key.fragmentedParticipantCount
  ) {
    throw new Error(
      `arm ${arm.id}: scientific preflight digest closure drifted`,
    );
  }
}

export function validateExecutedCapabilityBindings(
  arm: ProofArm,
  manifest: ReturnType<typeof decodeRuntimeManifest>,
  scientificArtifactCatalog: Record<string, ArtifactCatalogProjection>,
): void {
  const expected = arm.expected.preflight?.activeCapabilityRole ?? null;
  const assignment = manifest.roleAssignments.find(
    ({ role_id: roleId }) => roleId === "input_capability_evidence_file",
  );
  if (!expected) {
    if (assignment) {
      throw new Error(
        `arm ${arm.id}: inactive capability assignment was published`,
      );
    }
    for (const metadata of Object.values(scientificArtifactCatalog)) {
      if (
        metadata.scientificSourceBindings.some(
          ({ roleId }) => roleId === "input_capability_evidence_file",
        )
      ) {
        throw new Error(
          `arm ${arm.id}: inactive capability science binding was published`,
        );
      }
    }
    return;
  }
  if (
    !assignment ||
    assignment.artifact.digest !== expected.artifactDigest ||
    assignment.assignment_id !== expected.assignmentId
  ) {
    throw new Error(`arm ${arm.id}: manifest capability assignment mismatch`);
  }
  const options = buildOptions(arm.options);
  const sourceSensitiveScreen =
    options.processScreenUsage &&
    ["parry_toth_2025_session_glance_v1", "zhu_2018_unlock_lock_v1"].includes(
      options.screenSessionConstructionStrategy,
    );
  const schoedel =
    options.processAppUsage &&
    options.episodeReconstructionStrategy ===
      "schoedel_2026_app_within_screen_prose_v1";
  const expectedBindingKinds = new Set<string>([
    "b05-schoedel-validation-receipt-json",
    ...(sourceSensitiveScreen ? ["b05-screen-construction-evidence-json"] : []),
    ...(schoedel
      ? [
          "foundational-semantics-receipt-json",
          "schoedel-reconstruction-evidence-json",
        ]
      : []),
  ]);
  for (const [kind, metadata] of Object.entries(scientificArtifactCatalog)) {
    const binding = metadata.scientificSourceBindings.find(
      ({ roleId }) => roleId === "input_capability_evidence_file",
    );
    if (!expectedBindingKinds.has(kind)) {
      if (binding) {
        throw new Error(
          `arm ${arm.id}: ${kind} published a non-causal capability binding`,
        );
      }
      continue;
    }
    if (!binding) {
      throw new Error(`arm ${arm.id}: ${kind} omits active capability binding`);
    }
    exactEqual(`arm ${arm.id} ${kind} capability binding`, binding, {
      roleId: "input_capability_evidence_file",
      artifactDigest: expected.artifactDigest,
      assignmentId: expected.assignmentId,
    });
  }
}

function projectEyesValidation(
  summary: RuntimeEyesEvidenceSummary,
): EyesTaggedFauValidationReceipt {
  const receipt = summary.validationReceipt;
  if (!receipt) {
    throw new Error(
      "active EYES arm did not publish its aggregate validation receipt",
    );
  }
  return receipt;
}

function projectEyesEvidence(value: unknown): EyesEvidenceProjection {
  if (!value || typeof value !== "object") {
    throw new Error("EYES evidence artifact is not an object");
  }
  const participants = (value as { participants?: unknown }).participants;
  if (!Array.isArray(participants)) {
    throw new Error("EYES evidence artifact has no participant array");
  }
  let p01AlphaFragmentStatuses: string[] | null = null;
  const endpointSelections: EyesEvidenceProjection["endpointSelections"] = [];
  for (const [index, participant] of participants.entries()) {
    if (!participant || typeof participant !== "object") {
      throw new Error(`EYES participant ${index} is not an object`);
    }
    const evidence = (participant as { evidence?: unknown }).evidence;
    const participantId = (participant as { participantId?: unknown })
      .participantId;
    if (!evidence || typeof evidence !== "object") {
      throw new Error(`EYES participant ${index} has no evidence object`);
    }
    if (typeof participantId !== "string") {
      throw new Error(`EYES participant ${index} has no participant id`);
    }
    const fragments = (evidence as { fragments?: unknown }).fragments;
    const endpoints = (evidence as { chunkEndpoints?: unknown }).chunkEndpoints;
    const episodes = (evidence as { episodes?: unknown }).episodes;
    if (
      !Array.isArray(fragments) ||
      !Array.isArray(endpoints) ||
      !Array.isArray(episodes)
    ) {
      throw new Error(
        `EYES participant ${index} has malformed fragments/endpoints`,
      );
    }
    const fragmentStatuses = fragments.map((fragment, fragmentIndex) => {
      if (!fragment || typeof fragment !== "object") {
        throw new Error(
          `EYES participant ${index} fragment ${fragmentIndex} is malformed`,
        );
      }
      const status = (fragment as { deviceStatus?: unknown }).deviceStatus;
      if (typeof status !== "string") {
        throw new Error(
          `EYES participant ${index} fragment ${fragmentIndex} has no status`,
        );
      }
      return status;
    });
    if (participantId === "P01") {
      const p01AlphaStatuses = fragments.flatMap((fragment) => {
        if (!fragment || typeof fragment !== "object") return [];
        return (fragment as { appPackageName?: unknown }).appPackageName ===
          "com.example.alpha"
          ? [(fragment as { deviceStatus: string }).deviceStatus]
          : [];
      });
      p01AlphaFragmentStatuses =
        p01AlphaStatuses.length > 0 ? p01AlphaStatuses : fragmentStatuses;
    }
    for (const [endpointIndex, endpoint] of endpoints.entries()) {
      if (!endpoint || typeof endpoint !== "object") {
        throw new Error(
          `EYES participant ${index} endpoint ${endpointIndex} is malformed`,
        );
      }
      const inference = (endpoint as { selectedEndInference?: unknown })
        .selectedEndInference;
      if (typeof inference !== "string") {
        throw new Error(
          `EYES participant ${index} endpoint ${endpointIndex} has no inference`,
        );
      }
      const selectedEpisodeIndex = (
        endpoint as { selectedEpisodeIndex?: unknown }
      ).selectedEpisodeIndex;
      if (
        typeof selectedEpisodeIndex !== "number" ||
        !Number.isInteger(selectedEpisodeIndex) ||
        selectedEpisodeIndex < 0 ||
        selectedEpisodeIndex >= episodes.length
      ) {
        throw new Error(
          `EYES participant ${index} endpoint ${endpointIndex} has an invalid selected episode`,
        );
      }
      const selectedEpisode = episodes[selectedEpisodeIndex];
      const appPackageName =
        selectedEpisode && typeof selectedEpisode === "object"
          ? (selectedEpisode as { appPackageName?: unknown }).appPackageName
          : undefined;
      if (typeof appPackageName !== "string") {
        throw new Error(
          `EYES participant ${index} endpoint ${endpointIndex} has no package`,
        );
      }
      if (
        (participantId === "P01" || participantId === "P02") &&
        appPackageName === "com.example.alpha"
      ) {
        endpointSelections.push({
          participantId,
          appPackageName,
          selectedEndInference: inference,
        });
      }
    }
  }
  if (!p01AlphaFragmentStatuses) {
    throw new Error("EYES evidence lacks the P01 Alpha fragment witness");
  }
  endpointSelections.sort((left, right) =>
    canonicalJson(left).localeCompare(canonicalJson(right)),
  );
  return {
    participantCount: participants.length,
    p01AlphaFragmentStatuses,
    endpointSelections,
  };
}

async function loadAndVerifyInputs(): Promise<{
  manifestBytes: Uint8Array;
  manifest: FixtureManifest;
  expectationBytes: Uint8Array;
  expectations: ProofExpectations;
  fixtures: Map<string, { entry: FixtureEntry; bytes: Uint8Array }>;
}> {
  const manifestBytes = new Uint8Array(await readFile(MANIFEST_PATH));
  const expectationBytes = new Uint8Array(await readFile(EXPECTATION_PATH));
  const manifest = JSON.parse(
    new TextDecoder().decode(manifestBytes),
  ) as FixtureManifest;
  const expectations = JSON.parse(
    new TextDecoder().decode(expectationBytes),
  ) as ProofExpectations;
  const manifestDigest = sha256(manifestBytes);
  assertSha256(
    "expectation manifest digest",
    expectations.fixtureManifestSha256,
  );
  if (manifestDigest !== expectations.fixtureManifestSha256) {
    throw new Error(
      `fixture manifest drift: expected ${expectations.fixtureManifestSha256}, observed ${manifestDigest}`,
    );
  }
  if (
    manifest.protocolVersion !== "chronicle-b03-b05-scientific-fixtures/v1" ||
    expectations.protocolVersion !==
      "chronicle-b03-b05-scientific-proof-expectations/v1"
  ) {
    throw new Error("fixture or expectation protocol drifted");
  }
  if (
    manifest.status !== "synthetic_engineering_evidence_only" ||
    expectations.status !== "synthetic_engineering_evidence_only"
  ) {
    throw new Error("synthetic-only status drifted");
  }
  exactEqual(
    "expectation limitations",
    expectations.limitations,
    manifest.limitations,
  );
  exactEqual(
    "fixture id domain",
    manifest.fixtures.map(({ id }) => id),
    EXPECTED_FIXTURE_IDS,
  );
  const fixtures = new Map<
    string,
    { entry: FixtureEntry; bytes: Uint8Array }
  >();
  for (const entry of manifest.fixtures) {
    if (path.basename(entry.path) !== entry.path) {
      throw new Error(`fixture ${entry.id} path escapes its fixture directory`);
    }
    assertSha256(`fixture ${entry.id} digest`, entry.sha256);
    if (entry.boundRawInputSha256 !== undefined) {
      assertSha256(
        `fixture ${entry.id} bound raw digest`,
        entry.boundRawInputSha256,
      );
    }
    const bytes = new Uint8Array(
      await readFile(path.join(FIXTURE_ROOT, entry.path)),
    );
    const observed = sha256(bytes);
    if (observed !== entry.sha256) {
      throw new Error(
        `fixture ${entry.id} drift: expected ${entry.sha256}, observed ${observed}`,
      );
    }
    fixtures.set(entry.id, { entry, bytes });
  }
  assertUniqueSorted(
    "expectation arm ids",
    expectations.arms.map(({ id }) => id).sort(),
  );
  const witnessIds = [
    ...new Set(expectations.arms.flatMap(({ witnessIds }) => witnessIds)),
  ].sort();
  exactEqual("witness id domain", witnessIds, EXPECTED_WITNESS_IDS);
  for (const arm of expectations.arms) {
    if (!fixtures.has(arm.fixtureId)) {
      throw new Error(
        `arm ${arm.id} references unknown fixture ${arm.fixtureId}`,
      );
    }
    if (arm.supportFixtureId && !fixtures.has(arm.supportFixtureId)) {
      throw new Error(
        `arm ${arm.id} references unknown support fixture ${arm.supportFixtureId}`,
      );
    }
    if (arm.supportFixtureId) {
      const support = fixtures.get(arm.supportFixtureId);
      const raw = fixtures.get(arm.fixtureId);
      if (!support || !raw)
        throw new Error(`arm ${arm.id} fixtures disappeared`);
      validateBoundSupportFixture(
        `arm ${arm.id} support fixture`,
        support.entry,
        raw.entry.sha256,
      );
    }
    assertUniqueSorted(`arm ${arm.id} witness ids`, arm.witnessIds);
    validateProofOptionOverrides(`arm ${arm.id}.options`, arm.options);
    if (arm.expected.status === "executed") {
      const scientific = arm.expected.scientific;
      if (!scientific) {
        throw new Error(
          `arm ${arm.id} executed expectation lacks scientific evidence`,
        );
      }
      assertUniqueSorted(
        `arm ${arm.id} required scientific kinds`,
        scientific.requiredArtifactKinds,
      );
      assertUniqueSorted(
        `arm ${arm.id} forbidden scientific kinds`,
        scientific.forbiddenArtifactKinds,
      );
      if (scientific.scientificArtifactCatalog === null) {
        throw new Error(
          `arm ${arm.id} has no independently frozen scientific artifact catalog; reseal and review expectations before running the report`,
        );
      }
    }
  }
  return { manifestBytes, manifest, expectationBytes, expectations, fixtures };
}

function buildOptions(
  overrides: Partial<BrowserProcessingOptions>,
): BrowserProcessingOptions {
  return {
    ...DEFAULT_BROWSER_OPTIONS,
    studyName: "B03-B05 synthetic engineering proof",
    selectedTimezone: "America/Chicago",
    timezoneHandling: "selected-filter",
    useFilterFile: false,
    useAppsForcingScreenOpenFile: false,
    useBackgroundAppsFile: false,
    useAppCodebook: false,
    enablePlotting: false,
    enableActivityHeatmap: false,
    enableAggregates: false,
    enableInteractiveTimeline: false,
    enableParquetExport: false,
    enableSpssExport: false,
    parallelProcessing: false,
    ...overrides,
  };
}

function buildRequest(
  arm: ProofArm,
  options: BrowserProcessingOptions,
  fixture: FixtureEntry,
): string {
  return JSON.stringify({
    protocolVersion: "chronicle-preprocessing-runtime/v2",
    requestId: `b03-b05-proof:${arm.id}`,
    command: "ExecuteWorkspace",
    executionEngine: "incremental",
    provenanceEvidence: true,
    workspaceRootDigest: null,
    workspaceId: sha256(`b03-b05-proof:${arm.id}:${fixture.sha256}`),
    inputFileName: fixture.path,
    inputSha256: fixture.sha256,
    options: buildRustV2Options(options, {
      datetimeOfPreprocessing: FIXED_PREPROCESSING_TIME,
    }),
  });
}

function requestOptionsDigest(requestJson: string): string {
  const request = JSON.parse(requestJson) as { options?: unknown };
  if (!request.options || typeof request.options !== "object") {
    throw new Error("proof request lacks its exact runtime options object");
  }
  return sha256(canonicalJson(request.options));
}

export function validateExecutionEnvelopeIdentity(
  armId: string,
  requestJson: string,
  fixture: Pick<FixtureEntry, "sha256"> & { size: number },
  manifest: ReturnType<typeof decodeRuntimeManifest>,
  runtimeIdentity: RuntimeIdentity,
): string {
  const expected = requestOptionsDigest(requestJson);
  const request = JSON.parse(requestJson) as {
    protocolVersion?: unknown;
    requestId?: unknown;
    command?: unknown;
    workspaceId?: unknown;
    workspaceRootDigest?: unknown;
    inputSha256?: unknown;
    options?: unknown;
  };
  const expectedArtifact = (
    roleId: string,
    digest: string,
    mediaType: string,
    size: number,
  ) => ({
    artifact_id: `urn:chronicle:artifact:${roleId}:${digest.slice(7)}`,
    digest,
    media_type: mediaType,
    size,
    derived_from: [],
    qualifiers: {},
  });
  const expectedAssignment = (
    roleId: string,
    artifact: ReturnType<typeof expectedArtifact>,
    revision: number,
  ) => ({
    assignment_id: sha256(
      ["assignment", roleId, artifact.digest].join("\u001f"),
    ),
    role_id: roleId,
    artifact,
    qualifiers: {},
    revision,
  });
  const processingAssignments = manifest.roleAssignments.filter(
    ({ role_id: roleId }) => roleId === "processing_options",
  );
  const rawAssignments = manifest.roleAssignments.filter(
    ({ role_id: roleId }) => roleId === "raw_chronicle_csv",
  );
  if (processingAssignments.length !== 1 || rawAssignments.length !== 1) {
    throw new Error(`arm ${armId}: execution envelope identity drifted`);
  }
  const [processingAssignment] = processingAssignments;
  const [rawAssignment] = rawAssignments;
  if (!processingAssignment || !rawAssignment) {
    throw new Error(`arm ${armId}: execution envelope identity drifted`);
  }
  const rawArtifact = expectedArtifact(
    "raw_chronicle_csv",
    fixture.sha256,
    "text/csv",
    fixture.size,
  );
  const optionsArtifact = expectedArtifact(
    "processing_options",
    expected,
    "application/json",
    new TextEncoder().encode(canonicalJson(request.options)).byteLength,
  );
  exactEqual(
    `arm ${armId} manifest request envelope`,
    {
      protocolVersion: manifest.protocolVersion,
      requestId: manifest.requestId,
      command: manifest.command,
      workspaceId: manifest.workspaceId,
      previousWorkspaceRootDigest: manifest.previousWorkspaceRootDigest,
    },
    {
      protocolVersion: request.protocolVersion,
      requestId: request.requestId,
      command: request.command,
      workspaceId: request.workspaceId,
      previousWorkspaceRootDigest: request.workspaceRootDigest,
    },
  );
  exactEqual(
    `arm ${armId} manifest runtime identity`,
    {
      protocolVersion: manifest.protocolVersion,
      implementationDigest: manifest.implementationDigest,
      buildEnvironmentDigest: manifest.buildEnvironmentDigest,
      productContractDigest: manifest.productContractDigest,
      planDigest: manifest.planDigest,
      profileDigest: manifest.profileDigest,
      profileLockDigest: manifest.profileLockDigest,
      runtimeAuthorityDigest: manifest.runtimeAuthorityDigest,
      dependencyCertificateDigest: manifest.dependencyCertificateDigest,
    },
    runtimeIdentity,
  );
  exactEqual(
    `arm ${armId} runtime implementation`,
    {
      implementation: manifest.implementation,
      scope: manifest.scope,
    },
    {
      implementation: "chronicle_preprocessing_runtime_wasm/0.1.0",
      scope: "selected-runtime-csv-artifacts",
    },
  );
  exactEqual(
    `arm ${armId} manifest options digest`,
    manifest.optionsDigest,
    expected,
  );
  exactEqual(
    `arm ${armId} request input digest`,
    request.inputSha256,
    fixture.sha256,
  );
  exactEqual(`arm ${armId} manifest input`, manifest.input, rawArtifact);
  exactEqual(
    `arm ${armId} raw assignment`,
    rawAssignment,
    expectedAssignment("raw_chronicle_csv", rawArtifact, 1),
  );
  exactEqual(
    `arm ${armId} processing assignment`,
    processingAssignment,
    expectedAssignment("processing_options", optionsArtifact, 2),
  );
  return expected;
}

const RUNTIME_IDENTITY_ARTIFACTS = [
  ["chronicle-plan-json", "planDigest"],
  ["dependency-certificate-json", "dependencyCertificateDigest"],
  ["runtime-authority-json", "runtimeAuthorityDigest"],
  ["semantic-profile-json", "profileDigest"],
  ["semantic-profile-lock-json", "profileLockDigest"],
] as const;

/**
 * Authenticate every artifact root named by the runtime identity. All bytes
 * are independently taken and rehashed immediately after this check.
 */
export function validateRuntimeEvidenceRoots(
  armId: string,
  manifest: Pick<
    ReturnType<typeof decodeRuntimeManifest>,
    "input" | "journalDigest" | "optionsDigest" | "productContractDigest"
  >,
  artifacts: readonly RuntimeArtifactMetadata[],
  runtimeIdentity: RuntimeIdentity,
): void {
  const byKind = new Map<string, RuntimeArtifactMetadata>();
  for (const artifact of artifacts) {
    if (byKind.has(artifact.kind)) {
      throw new Error(`arm ${armId}: duplicate runtime evidence artifact kind`);
    }
    byKind.set(artifact.kind, artifact);
  }
  const expectedRoots: Array<{
    kind: string;
    digest: string;
    mediaType: string;
    requiresEmptyDependencies: boolean;
  }> = [
    {
      kind: "evidence-journal",
      digest: manifest.journalDigest,
      mediaType: "application/cbor",
      requiresEmptyDependencies: false,
    },
    ...RUNTIME_IDENTITY_ARTIFACTS.map(([kind, identityField]) => ({
      kind,
      digest: runtimeIdentity[identityField],
      mediaType: "application/json",
      requiresEmptyDependencies: true,
    })),
  ];
  const productContract = byKind.get("product-contract-json");
  if (productContract) {
    expectedRoots.push({
      kind: "product-contract-json",
      digest: runtimeIdentity.productContractDigest,
      mediaType: "application/json",
      requiresEmptyDependencies: true,
    });
  }
  exactEqual(
    `arm ${armId} runtime/product contract digest`,
    manifest.productContractDigest,
    runtimeIdentity.productContractDigest,
  );
  for (const expectedRoot of expectedRoots) {
    const artifact = byKind.get(expectedRoot.kind);
    if (!artifact) {
      throw new Error(
        `arm ${armId}: runtime evidence root ${expectedRoot.kind} is absent`,
      );
    }
    exactEqual(
      `arm ${armId} runtime evidence root ${expectedRoot.kind}`,
      {
        artifactId: artifact.artifactId,
        kind: artifact.kind,
        mediaType: artifact.mediaType,
        digest: artifact.digest,
        derivedFrom: artifact.derivedFrom,
      },
      {
        artifactId: `urn:chronicle:artifact:${expectedRoot.kind}:${expectedRoot.digest.slice(7)}`,
        kind: expectedRoot.kind,
        mediaType: expectedRoot.mediaType,
        digest: expectedRoot.digest,
        derivedFrom: expectedRoot.requiresEmptyDependencies
          ? []
          : [manifest.input.digest, manifest.optionsDigest],
      },
    );
  }
}

export function validateCertifiedDependencyDecision(
  armId: string,
  decision: ReturnType<typeof decodeRuntimeManifest>["dependencyCacheDecision"],
  runtimeIdentity: RuntimeIdentity,
): void {
  exactEqual(
    `arm ${armId} certified dependency decision`,
    {
      mode: decision.mode,
      certificateDigest: decision.certificate_digest,
      empiricalEvidenceCurrent: decision.empirical_evidence_current,
      reasons: decision.reasons,
    },
    {
      mode: "certified_narrow",
      certificateDigest: runtimeIdentity.dependencyCertificateDigest,
      empiricalEvidenceCurrent: true,
      reasons: ["dependency_surface_structurally_certified"],
    },
  );
  assertSha256(
    `arm ${armId} dependency binding surface`,
    decision.binding_surface_digest,
  );
}

function artifactMap(
  handle: RuntimeHandle,
  manifestArtifacts: RuntimeArtifactMetadata[],
): Map<string, { metadata: RuntimeArtifactMetadata; index: number }> {
  if (handle.artifact_count !== manifestArtifacts.length) {
    throw new Error(
      `manifest/handle artifact cardinality differs: ${manifestArtifacts.length} != ${handle.artifact_count}`,
    );
  }
  const declaredById = new Map<string, RuntimeArtifactMetadata>();
  const declaredKinds = new Set<string>();
  for (const metadata of manifestArtifacts) {
    if (
      declaredById.has(metadata.artifactId) ||
      declaredKinds.has(metadata.kind)
    ) {
      throw new Error("manifest artifact ids and kinds must both be unique");
    }
    declaredById.set(metadata.artifactId, metadata);
    declaredKinds.add(metadata.kind);
  }
  const catalog = new Map<
    string,
    { metadata: RuntimeArtifactMetadata; index: number }
  >();
  const observedIds = new Set<string>();
  for (let index = 0; index < handle.artifact_count; index += 1) {
    const metadata = JSON.parse(
      handle.artifact_metadata_json(index),
    ) as RuntimeArtifactMetadata;
    assertSha256(`artifact ${metadata.kind} digest`, metadata.digest);
    const declared = declaredById.get(metadata.artifactId);
    if (!declared) {
      throw new Error(
        `handle artifact ${metadata.artifactId} is absent from manifest`,
      );
    }
    exactEqual(`manifest artifact ${metadata.kind}`, metadata, declared);
    if (catalog.has(metadata.kind) || observedIds.has(metadata.artifactId)) {
      throw new Error(
        `handle artifact id/kind ${metadata.artifactId} is not unique`,
      );
    }
    observedIds.add(metadata.artifactId);
    catalog.set(metadata.kind, { metadata, index });
  }
  if (
    observedIds.size !== declaredById.size ||
    [...declaredById.keys()].some((artifactId) => !observedIds.has(artifactId))
  ) {
    throw new Error(
      "manifest contains an artifact absent from the handle catalog",
    );
  }
  return catalog;
}

const SCIENTIFIC_ARTIFACT_KINDS = new Set([
  "foundational-semantics-receipt-json",
  "minimum-duration-excluded-lineage-json",
  "zero-duration-cleanup-evidence-json",
  "zero-duration-removed-lineage-json",
  "b05-screen-construction-evidence-json",
  "schoedel-reconstruction-evidence-json",
  "b05-schoedel-validation-receipt-json",
  "eyes-tagged-fau-evidence-json",
  "eyes-tagged-fau-validation-receipt-json",
]);

function verifyArtifactKinds(
  armId: string,
  catalog: Map<string, unknown>,
  required: string[],
  forbidden: string[],
): void {
  assertUniqueSorted(`arm ${armId} required artifact kinds`, required);
  assertUniqueSorted(`arm ${armId} forbidden artifact kinds`, forbidden);
  for (const kind of required) {
    if (!catalog.has(kind)) {
      throw new Error(`arm ${armId}: required artifact ${kind} is missing`);
    }
  }
  for (const kind of forbidden) {
    if (catalog.has(kind)) {
      throw new Error(`arm ${armId}: forbidden artifact ${kind} was published`);
    }
  }
  const observedScientificKinds = [...catalog.keys()]
    .filter((kind) => SCIENTIFIC_ARTIFACT_KINDS.has(kind))
    .sort();
  exactEqual(
    `arm ${armId} exact scientific artifact kind set`,
    observedScientificKinds,
    required,
  );
}

function takeAndVerifyArtifact(
  handle: RuntimeHandle,
  entry: { metadata: RuntimeArtifactMetadata; index: number },
): Uint8Array {
  const bytes = handle.take_artifact_bytes(entry.index);
  if (bytes.byteLength !== entry.metadata.size) {
    throw new Error(
      `artifact ${entry.metadata.kind} size disagrees with metadata`,
    );
  }
  const observed = sha256(bytes);
  if (observed !== entry.metadata.digest) {
    throw new Error(
      `artifact ${entry.metadata.kind} digest drift: expected ${entry.metadata.digest}, observed ${observed}`,
    );
  }
  return bytes;
}

function parseMinimumDurationLineage(bytes: Uint8Array): unknown {
  // These nanosecond timestamps exceed JavaScript's safe-integer range. Quote
  // only the two frozen i64 fields before JSON parsing so the report compares
  // their exact decimal values instead of silently rounding them.
  const text = new TextDecoder()
    .decode(bytes)
    .replace(
      /"(rawStartTimestampNs|rawStopTimestampNs)"\s*:\s*(-?[0-9]+)/g,
      '"$1":"$2"',
    );
  return JSON.parse(text) as unknown;
}

/** Minimal RFC4180 reader for the authoritative CSV artifact bytes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV artifact has an unterminated quoted field");
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some(Boolean));
}

function projectExpectedAppRows(
  bytes: Uint8Array,
  expectedRows: AppRowProjection[],
): AppRowProjection[] {
  const records = parseCsv(new TextDecoder().decode(bytes));
  const headers = records[0];
  if (!headers) throw new Error("app-csv has no header");
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const cell = (row: string[], name: string): string | undefined => {
    const index = headerIndex.get(name);
    return index === undefined ? undefined : (row[index] ?? "");
  };
  const candidates = records.slice(1);
  return expectedRows.map((expected) => {
    const matches = candidates.filter(
      (row) =>
        cell(row, "participant_id") === expected.participantId &&
        cell(row, "app_package_name") === expected.appPackageName &&
        (expected.schoedelCompletion === undefined ||
          cell(row, "schoedel_completion") === expected.schoedelCompletion),
    );
    if (matches.length !== 1) {
      throw new Error(
        `expected exactly one app row for ${expected.participantId}/${expected.appPackageName}/${expected.schoedelCompletion ?? "ordinary"}, observed ${matches.length}`,
      );
    }
    const row = matches[0];
    if (!row) throw new Error("selected app row disappeared");
    const projected: AppRowProjection = {
      participantId: cell(row, "participant_id") ?? "",
      appPackageName: cell(row, "app_package_name") ?? "",
      durationSeconds:
        (cell(row, "duration_seconds") ?? "") === ""
          ? null
          : (cell(row, "duration_seconds") ?? ""),
    };
    for (const [property, column] of [
      ["microUseClassification", "micro_use_classification"],
      ["rawEpisodeDurationSeconds", "raw_episode_duration_seconds"],
      ["minimumDurationQualified", "minimum_duration_qualified"],
      [
        "minimumDurationAggregateEligible",
        "minimum_duration_aggregate_eligible",
      ],
      ["schoedelCompletion", "schoedel_completion"],
      ["appUsageEndReason", "app_usage_end_reason"],
    ] as const) {
      if (property in expected) projected[property] = cell(row, column) ?? "";
    }
    return projected;
  });
}

function verifyAbsentAppRows(
  bytes: Uint8Array,
  expectedRows: AppRowSelector[],
): AppRowSelector[] {
  const records = parseCsv(new TextDecoder().decode(bytes));
  const headers = records[0];
  if (!headers) throw new Error("app-csv has no header");
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const cell = (row: string[], name: string): string | undefined => {
    const index = headerIndex.get(name);
    return index === undefined ? undefined : (row[index] ?? "");
  };
  const candidates = records.slice(1);
  for (const expected of expectedRows) {
    const matches = candidates.filter(
      (row) =>
        cell(row, "participant_id") === expected.participantId &&
        cell(row, "app_package_name") === expected.appPackageName &&
        (expected.schoedelCompletion === undefined ||
          cell(row, "schoedel_completion") === expected.schoedelCompletion),
    );
    if (matches.length !== 0) {
      throw new Error(
        `expected no app row for ${expected.participantId}/${expected.appPackageName}/${expected.schoedelCompletion ?? "ordinary"}, observed ${matches.length}`,
      );
    }
  }
  return expectedRows;
}

function projectAppUsageEndReasons(bytes: Uint8Array): string[] {
  const records = parseCsv(new TextDecoder().decode(bytes));
  const headers = records[0];
  if (!headers) throw new Error("app-csv has no header");
  const column = headers.indexOf("app_usage_end_reason");
  if (column < 0) throw new Error("app-csv lacks app_usage_end_reason");
  return [
    ...new Set(
      records
        .slice(1)
        .map((row) => row[column])
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();
}

function scientificArtifactCatalogProjection(
  handle: RuntimeHandle,
  catalog: Map<string, { metadata: RuntimeArtifactMetadata; index: number }>,
): {
  metadata: Record<string, ArtifactCatalogProjection>;
  bytes: Map<string, Uint8Array>;
} {
  const metadata: Record<string, ArtifactCatalogProjection> = {};
  const bytes = new Map<string, Uint8Array>();
  for (const kind of [...catalog.keys()].sort()) {
    const entry = catalog.get(kind);
    if (!entry)
      throw new Error(`artifact ${kind} disappeared during extraction`);
    bytes.set(kind, takeAndVerifyArtifact(handle, entry));
    if (SCIENTIFIC_ARTIFACT_KINDS.has(kind)) {
      metadata[kind] = {
        artifactId: entry.metadata.artifactId,
        mediaType: entry.metadata.mediaType,
        digest: entry.metadata.digest,
        size: entry.metadata.size,
        derivedFrom: entry.metadata.derivedFrom,
        scientificSourceBindings: entry.metadata.scientificSourceBindings ?? [],
        rowCount: entry.metadata.rowCount ?? null,
      };
    }
  }
  return { metadata, bytes };
}

export function verifyProofArtifactClosure(
  handle: RuntimeHandle,
  manifestArtifacts: RuntimeArtifactMetadata[],
): Record<string, ArtifactCatalogProjection> {
  const catalog = artifactMap(handle, manifestArtifacts);
  return scientificArtifactCatalogProjection(handle, catalog).metadata;
}

function projectExecution(
  arm: ProofArm,
  preflight: PreflightProjection | null,
  requestJson: string,
  fixture: { entry: FixtureEntry; bytes: Uint8Array },
  runtimeIdentity: RuntimeIdentity,
  handle: RuntimeHandle,
): {
  observed: ExpectedOutcome;
  requestOptionsDigest: string;
  scientificArtifactCatalog: Record<string, ArtifactCatalogProjection>;
  dependencyCacheDecision: ArmReport["dependencyCacheDecision"];
} {
  const manifest = decodeRuntimeManifest(JSON.parse(handle.manifest_json()));
  const expectedOptionsDigest = validateExecutionEnvelopeIdentity(
    arm.id,
    requestJson,
    { sha256: fixture.entry.sha256, size: fixture.bytes.byteLength },
    manifest,
    runtimeIdentity,
  );
  validateCertifiedDependencyDecision(
    arm.id,
    manifest.dependencyCacheDecision,
    runtimeIdentity,
  );
  const catalog = artifactMap(handle, manifest.artifacts);
  validateRuntimeEvidenceRoots(
    arm.id,
    manifest,
    [...catalog.values()].map(({ metadata }) => metadata),
    runtimeIdentity,
  );
  const expectedScientific = arm.expected.scientific;
  if (!expectedScientific) {
    throw new Error(
      `arm ${arm.id}: executed expectation lacks scientific projection`,
    );
  }
  verifyArtifactKinds(
    arm.id,
    catalog,
    expectedScientific.requiredArtifactKinds,
    expectedScientific.forbiddenArtifactKinds,
  );
  const extracted = scientificArtifactCatalogProjection(handle, catalog);
  if (!expectedScientific.scientificArtifactCatalog) {
    throw new Error(
      `arm ${arm.id}: independently frozen scientific artifact catalog is absent`,
    );
  }
  exactEqual(
    `arm ${arm.id} scientific artifact catalog`,
    extracted.metadata,
    expectedScientific.scientificArtifactCatalog,
  );
  validateExecutedCapabilityBindings(arm, manifest, extracted.metadata);
  const scientific: ScientificProjection = {
    requiredArtifactKinds: expectedScientific.requiredArtifactKinds,
    forbiddenArtifactKinds: expectedScientific.forbiddenArtifactKinds,
    scientificArtifactCatalog: expectedScientific.scientificArtifactCatalog,
  };
  if (expectedScientific.microUse) {
    Object.assign(
      scientific,
      stripFoundationalLineageDigests(manifest.scientificEvidence),
    );
  }
  if (expectedScientific.b05ScreenConstruction) {
    const receipt = manifest.scientificEvidence.b05ScreenConstructionReceipt;
    if (!receipt) {
      throw new Error(`arm ${arm.id}: B05 screen receipt is absent`);
    }
    scientific.b05ScreenConstruction = projectB05Screen(receipt);
  }
  if (expectedScientific.schoedelReconstruction) {
    const receipt = manifest.scientificEvidence.schoedelReconstructionReceipt;
    if (!receipt) {
      throw new Error(`arm ${arm.id}: Schoedel receipt is absent`);
    }
    scientific.schoedelReconstruction = receipt;
  }
  if (expectedScientific.minimumDurationExcludedLineage) {
    const foundationalBytes = extracted.bytes.get(
      "foundational-semantics-receipt-json",
    );
    const lineageBytes = extracted.bytes.get(
      "minimum-duration-excluded-lineage-json",
    );
    if (!foundationalBytes || !lineageBytes) {
      throw new Error(`arm ${arm.id}: excluded-lineage evidence is absent`);
    }
    const foundational = parseMinimumDurationLineage(foundationalBytes) as {
      minimumDurationExcludedEpisodes?: unknown;
    };
    const lineage = parseMinimumDurationLineage(lineageBytes);
    exactEqual(
      `arm ${arm.id} foundational/dedicated excluded lineage`,
      foundational.minimumDurationExcludedEpisodes,
      lineage,
    );
    if (!Array.isArray(lineage)) {
      throw new Error(`arm ${arm.id}: excluded lineage is not an array`);
    }
    scientific.minimumDurationExcludedLineage = lineage;
  }
  if (expectedScientific.appRows) {
    const appBytes = extracted.bytes.get("app-csv");
    if (!appBytes) throw new Error(`arm ${arm.id}: app-csv is absent`);
    scientific.appRows = projectExpectedAppRows(
      appBytes,
      expectedScientific.appRows,
    );
  }
  if (expectedScientific.absentAppRows) {
    const appBytes = extracted.bytes.get("app-csv");
    if (!appBytes) throw new Error(`arm ${arm.id}: app-csv is absent`);
    scientific.absentAppRows = verifyAbsentAppRows(
      appBytes,
      expectedScientific.absentAppRows,
    );
  }
  if (expectedScientific.appUsageEndReasons) {
    const appBytes = extracted.bytes.get("app-csv");
    if (!appBytes) {
      throw new Error(`arm ${arm.id}: app-csv is absent`);
    }
    scientific.appUsageEndReasons = projectAppUsageEndReasons(appBytes);
  }
  if (expectedScientific.eyesValidation || expectedScientific.eyesEvidence) {
    const fullValidationReceipt = projectEyesValidation(manifest.eyesEvidence);
    const validationReceiptBytes = extracted.bytes.get(
      "eyes-tagged-fau-validation-receipt-json",
    );
    if (!validationReceiptBytes) {
      throw new Error(
        `arm ${arm.id}: EYES validation receipt artifact is absent`,
      );
    }
    const artifactValidationReceipt = JSON.parse(
      new TextDecoder().decode(validationReceiptBytes),
    ) as unknown;
    exactEqual(
      `arm ${arm.id} full EYES manifest/artifact validation receipt`,
      artifactValidationReceipt,
      fullValidationReceipt,
    );
    // The independently frozen scientific-artifact catalog commits the exact
    // receipt bytes above, including every count and internal digest. The
    // selected fields below are only the human-readable report projection.
    scientific.eyesValidation = projectExpectedShape(
      fullValidationReceipt,
      expectedScientific.eyesValidation,
    ) as Partial<EyesTaggedFauValidationReceipt>;
    const evidenceEntry = catalog.get("eyes-tagged-fau-evidence-json");
    if (!evidenceEntry) {
      throw new Error(`arm ${arm.id}: EYES evidence artifact is absent`);
    }
    const bytes = extracted.bytes.get("eyes-tagged-fau-evidence-json");
    if (!bytes)
      throw new Error(`arm ${arm.id}: EYES evidence bytes are absent`);
    scientific.eyesEvidence = projectEyesEvidence(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
  }
  return {
    observed: { status: "executed", preflight, scientific },
    requestOptionsDigest: expectedOptionsDigest,
    scientificArtifactCatalog: extracted.metadata,
    dependencyCacheDecision: {
      mode: "certified_narrow",
      certificateDigest: manifest.dependencyCacheDecision.certificate_digest,
      bindingSurfaceDigest:
        manifest.dependencyCacheDecision.binding_surface_digest,
      empiricalEvidenceCurrent: true,
      reasons: manifest.dependencyCacheDecision.reasons,
    },
  };
}

async function executeProofArms(
  runtime: RuntimeModule,
  runtimeIdentity: RuntimeIdentity,
  expectations: ProofExpectations,
  fixtures: Map<string, { entry: FixtureEntry; bytes: Uint8Array }>,
): Promise<ArmReport[]> {
  const reports: ArmReport[] = [];
  for (const arm of expectations.arms) {
    const fixture = fixtures.get(arm.fixtureId);
    if (!fixture) throw new Error(`arm ${arm.id}: raw fixture disappeared`);
    const supportFixture = arm.supportFixtureId
      ? fixtures.get(arm.supportFixtureId)
      : undefined;
    const options = buildOptions(arm.options);
    const requestJson = buildRequest(arm, options, fixture.entry);
    const supports = new runtime.RuntimeSupportFiles();
    let handle: RuntimeHandle | null = null;
    try {
      if (supportFixture) {
        supports.put_with_name(
          "input_capability_evidence_file",
          supportFixture.entry.path,
          supportFixture.bytes,
        );
      }
      let preflightReceipt: RuntimeScientificPreflightReceipt | null = null;
      let preflight: PreflightProjection | null = null;
      if (requiresLiveScientificPreflight(options)) {
        preflightReceipt = decodeScientificPreflightReceipt(
          JSON.parse(
            runtime.scientific_preflight_json(
              requestJson,
              fixture.bytes,
              supports,
            ),
          ),
        );
        validatePreflightIdentity(
          arm,
          preflightReceipt,
          requestJson,
          fixture,
          supportFixture,
        );
        preflight = projectPreflight(preflightReceipt);
      } else if (supportFixture) {
        throw new Error(
          `arm ${arm.id}: inactive arm supplied capability evidence`,
        );
      }
      assertPreflightBeforeExecution(
        arm.id,
        arm.expected.status,
        arm.expected.preflight,
        preflight,
      );
      const refused =
        preflight?.disposition === "refused" ||
        preflight?.eyesDisposition === "refused";
      let observed: ExpectedOutcome;
      let requestOptionsDigest: string;
      let scientificArtifactCatalog: Record<string, ArtifactCatalogProjection> =
        {};
      let dependencyCacheDecision: ArmReport["dependencyCacheDecision"] = {
        mode: "not_executed",
        certificateDigest: null,
        bindingSurfaceDigest: null,
        empiricalEvidenceCurrent: null,
        reasons: [],
      };
      let executeCalls = 0;
      if (refused) {
        observed = { status: "refused", preflight, scientific: null };
        if (!preflightReceipt) {
          throw new Error(
            `arm ${arm.id}: refusal lacks its typed preflight receipt`,
          );
        }
        requestOptionsDigest = preflightReceipt.key.optionsDigest;
      } else {
        executeCalls += 1;
        handle = runtime.execute_workspace(
          requestJson,
          fixture.bytes,
          supports,
        );
        ({
          observed,
          requestOptionsDigest,
          scientificArtifactCatalog,
          dependencyCacheDecision,
        } = projectExecution(
          arm,
          preflight,
          requestJson,
          fixture,
          runtimeIdentity,
          handle,
        ));
      }
      if (arm.expected.status === "refused" && executeCalls !== 0) {
        throw new Error(
          `arm ${arm.id}: refused vector invoked execute_workspace`,
        );
      }
      if (arm.expected.status === "executed" && executeCalls !== 1) {
        throw new Error(
          `arm ${arm.id}: executable vector did not execute exactly once`,
        );
      }
      exactEqual(`arm ${arm.id} outcome`, observed, arm.expected);
      reports.push({
        id: arm.id,
        fixtureId: arm.fixtureId,
        fixtureSha256: fixture.entry.sha256,
        supportFixtureId: arm.supportFixtureId ?? null,
        supportFixtureSha256: supportFixture?.entry.sha256 ?? null,
        witnessIds: arm.witnessIds,
        options,
        optionVectorSha256: sha256(canonicalJson(options)),
        requestOptionsDigest,
        preflightCommitDigest: preflightReceipt?.commitDigest ?? null,
        executeCalls,
        scientificArtifactCatalog,
        dependencyCacheDecision,
        expected: arm.expected,
        observed,
      });
    } finally {
      handle?.free();
      supports.free();
    }
  }
  return reports;
}

function reportMarkdown(report: ProofReport): string {
  const lines = [
    "# B03–B05 foundational semantics synthetic proof report",
    "",
    `Protocol: \`${report.protocolVersion}\``,
    "",
    `Status: **${report.status}**`,
    "",
    `Claim boundary: **${report.headlineEmpiricalMagnitudeClaim}**`,
    "",
    `Evidence scope: **${report.evidenceScope}**`,
    "",
    "This report is deterministic synthetic engineering evidence. It verifies",
    "that the low-level authoritative Rust/WASM boundary reaches frozen",
    "scientific outcomes and typed refusals for exact committed fixtures.",
    "Worker, Comlink, batch-registration, and UI reachability are proved by",
    "separate browser gates; this report does not claim those paths. It is not a",
    "measurement of participants, a study population, or an empirical effect.",
    "",
    "## Sealed inputs",
    "",
    `- Fixture manifest: \`${report.fixtureManifest.sha256}\``,
    `- Frozen expectations: \`${report.expectationSha256}\``,
    `- Runtime WASM: \`${report.runtime.wasmSha256}\``,
    `- Runtime implementation: \`${report.runtime.identity.implementationDigest}\``,
    `- Dependency certificate: \`${report.runtime.identity.dependencyCertificateDigest}\``,
    `- Workflow contract: \`${report.runtime.workflowContractSha256}\``,
    "",
    "## Limitations",
    "",
    ...report.limitations.map((limitation) => `- \`${limitation}\``),
    "",
    "## Arms",
    "",
    "| Arm | Fixture | Outcome | Witness ID |",
    "|---|---|---|---|",
    ...report.arms.map(
      (arm) =>
        `| \`${arm.id}\` | \`${arm.fixtureId}\` (${arm.fixtureSha256}) | \`${arm.observed.status}\` | ${arm.witnessIds.map((id) => `\`${id}\``).join(", ")} |`,
    ),
    "",
    "Exact option vectors, preflight decisions, execute-call counts, complete",
    "rehash-verified known-scientific-artifact catalogs, and observed projections",
    "are recorded in the companion JSON report. Every manifest artifact is",
    "independently taken, size-checked, and rehashed even when it is outside that",
    "frozen scientific-kind catalog.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function atomicWrite(
  filePath: string,
  bytes: Uint8Array | string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function assertFileBytes(
  filePath: string,
  expected: Uint8Array,
): Promise<void> {
  let observed: Uint8Array;
  try {
    observed = new Uint8Array(await readFile(filePath));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `generated proof report is missing; run the authorized post-reseal update (${filePath}): ${reason}`,
    );
  }
  if (!Buffer.from(observed).equals(Buffer.from(expected))) {
    throw new Error(
      `generated proof report is stale: ${filePath}; run the authorized post-reseal update`,
    );
  }
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const { manifestBytes, manifest, expectationBytes, expectations, fixtures } =
    await loadAndVerifyInputs();

  // The runtime is imported only after fixture/expectation verification. A
  // drifted fixture therefore fails before any scientific execution begins.
  const wasmBytes = new Uint8Array(await readFile(WASM_PATH));
  const runtime =
    (await import("../src/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js")) as unknown as RuntimeModule;
  if (typeof runtime.scientific_preflight_json !== "function") {
    throw new Error(
      "runtime WASM lacks scientific_preflight_json; reseal generated runtime artifacts before generating/checking this report",
    );
  }
  runtime.initSync({ module: wasmBytes });
  const runtimeIdentity = JSON.parse(
    runtime.runtime_identity_json(),
  ) as RuntimeIdentity;
  if (
    runtimeIdentity.protocolVersion !== "chronicle-preprocessing-runtime/v2"
  ) {
    throw new Error(
      `runtime identity protocol drifted: ${runtimeIdentity.protocolVersion}`,
    );
  }
  for (const [field, digest] of Object.entries(runtimeIdentity)) {
    if (field !== "protocolVersion")
      assertSha256(`runtime identity ${field}`, digest);
  }
  const workflowContractJson = runtime.workflow_contract_json();
  const arms = await executeProofArms(
    runtime,
    runtimeIdentity,
    expectations,
    fixtures,
  );
  const report: ProofReport = {
    protocolVersion: "chronicle-b03-b05-scientific-proof-report/v1",
    status: "synthetic_engineering_evidence_only",
    headlineEmpiricalMagnitudeClaim:
      "cannot_support_headline_empirical_magnitudes",
    evidenceScope: "low_level_authoritative_runtime_wasm",
    limitations: expectations.limitations,
    fixtureManifest: {
      sha256: sha256(manifestBytes),
      protocolVersion: manifest.protocolVersion,
      fixtures: manifest.fixtures.map(({ id, sha256: digest }) => ({
        id,
        sha256: digest,
      })),
    },
    expectationSha256: sha256(expectationBytes),
    runtime: {
      wasmSha256: sha256(wasmBytes),
      identity: runtimeIdentity,
      workflowContractSha256: sha256(workflowContractJson),
    },
    proofIds: ["scientific_fixture_report"],
    arms,
  };
  const jsonBytes = new TextEncoder().encode(
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const markdownBytes = new TextEncoder().encode(reportMarkdown(report));
  if (mode === "check") {
    await assertFileBytes(REPORT_JSON_PATH, jsonBytes);
    await assertFileBytes(REPORT_MARKDOWN_PATH, markdownBytes);
    return;
  }
  await atomicWrite(REPORT_JSON_PATH, jsonBytes);
  await atomicWrite(REPORT_MARKDOWN_PATH, markdownBytes);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) await main();
