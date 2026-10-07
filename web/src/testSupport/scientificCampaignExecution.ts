import { createHash } from "node:crypto";

import { canonicalJson } from "@/lib/canonicalJson";
import type {
  B05RefusalReason,
  RuntimeB05RefusalDetail,
  RuntimeScientificPreflightReceipt,
  RuntimeSchoedelRefusalDetail,
  SchoedelRefusalReason,
} from "@/lib/generatedRuntimeBoundary";
import {
  BROWSER_PROCESSING_OPTION_KEYS,
  NUMBER_ARRAY_BROWSER_OPTION_KEYS,
} from "@/lib/generatedContract";
import { usesInputCapabilityEvidence } from "@/lib/inputCapabilityEvidence";
import { buildRustV2Options } from "@/lib/rustPipelineRuntime";
import { decodeScientificPreflightReceipt } from "@/lib/scientificPreflightBoundary";
import { sanitizeOptions } from "@/lib/settingsPersistence";
import type { BrowserProcessingOptions } from "@/lib/types";
import { GOLDEN_RUNTIME } from "@/testSupport/rustCampaignGraph";

type CampaignSupportFiles = object;

/**
 * Complete sparse historical campaign rows with modern defaults. Every key —
 * including the presence-tracked ones (micro_use_classification_policy,
 * minimum_duration_comparator, minimum_duration_disposition,
 * screen_session_construction_strategy) — is completed, because all four are
 * exact bound request fields and certified cache-relevant option keys: the
 * production browser always sends them (`buildRustV2Options` projects them
 * unconditionally) and the runtime fails closed on their absence, both at the
 * bound-field check and at the certified semantic-option projection. A row
 * that omitted them therefore has no valid modern request shape other than
 * the contract default. The earlier behavior — deleting these keys when the
 * historical row omitted them, to preserve an absence receipt — predates the
 * fields being contract-bound and produced requests production can never send.
 */
export function completeLegacyScientificCampaignOptions(
  sparse: unknown,
): BrowserProcessingOptions {
  if (typeof sparse !== "object" || sparse === null || Array.isArray(sparse)) {
    throw new Error("legacy scientific campaign options must be an object");
  }
  const source = sparse as Record<string, unknown>;
  const knownKeys = new Set<string>(BROWSER_PROCESSING_OPTION_KEYS);
  const unknownKeys = Object.keys(source).filter((key) => !knownKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(
      `legacy scientific campaign options contain unknown keys: ${unknownKeys.sort().join(", ")}`,
    );
  }
  const sanitized = sanitizeOptions(source);
  const numberArrayKeys = new Set<string>(NUMBER_ARRAY_BROWSER_OPTION_KEYS);
  for (const key of Object.keys(source)) {
    if (numberArrayKeys.has(key)) {
      const value = source[key];
      if (
        !Array.isArray(value) ||
        !value.every(
          (entry) => typeof entry === "number" && Number.isFinite(entry),
        )
      ) {
        throw new Error(
          `legacy scientific campaign option ${key} is outside the current contract`,
        );
      }
      continue;
    }
    if (
      canonicalJson(source[key]) !==
      canonicalJson((sanitized as unknown as Record<string, unknown>)[key])
    ) {
      throw new Error(
        `legacy scientific campaign option ${key} is outside the current contract`,
      );
    }
  }
  return {
    ...sanitized,
    ...source,
  };
}

type CampaignSupportFileWriter = {
  put_with_name(roleId: string, fileName: string, bytes: Uint8Array): void;
};

export type ScientificCampaignRuntime<Handle> = {
  scientific_preflight_json(
    requestJson: string,
    rawBytes: Uint8Array,
    supports: CampaignSupportFiles,
  ): string;
  execute_workspace(
    requestJson: string,
    rawBytes: Uint8Array,
    supports: CampaignSupportFiles,
  ): Handle;
  /** The kernel's exported workflow contract. Supplies
   * `runtimeArtifactRequestFields`, the artifact-only wire fields the runtime
   * excludes from the options digest bound into scientific receipts. */
  workflow_contract_json(): string;
};

const artifactRequestFieldsByRuntime = new WeakMap<object, readonly string[]>();

function runtimeArtifactRequestFields(
  runtime: Pick<ScientificCampaignRuntime<unknown>, "workflow_contract_json">,
): readonly string[] {
  const cached = artifactRequestFieldsByRuntime.get(runtime);
  if (cached) return cached;
  const contract = JSON.parse(runtime.workflow_contract_json()) as {
    runtimeArtifactRequestFields?: unknown;
  };
  const fields = contract.runtimeArtifactRequestFields;
  if (
    !Array.isArray(fields) ||
    fields.length === 0 ||
    !fields.every((field) => typeof field === "string")
  ) {
    throw new Error(
      "workflow contract does not publish runtimeArtifactRequestFields",
    );
  }
  artifactRequestFieldsByRuntime.set(runtime, fields);
  return fields;
}

export type ScientificCampaignExecution<Handle> =
  | {
      status: "executed";
      handle: Handle;
      scientificPreflight: RuntimeScientificPreflightReceipt | null;
      executeCalls: 1;
    }
  | {
      status: "refused";
      receipt: RuntimeScientificPreflightReceipt;
      executeCalls: 0;
    };

/**
 * Bind one support artifact at the campaign/WASM boundary. Capability
 * evidence is never transported when its exact scientific vector is inactive.
 */
export function putScientificCampaignSupportArtifact(input: {
  roleId: string;
  fileName: string;
  bytes: Uint8Array;
  options: BrowserProcessingOptions;
  supports: CampaignSupportFileWriter;
  supportArtifacts: Map<string, Uint8Array>;
}): boolean {
  if (
    input.roleId === "input_capability_evidence_file" &&
    !usesInputCapabilityEvidence(input.options)
  ) {
    return false;
  }
  input.supports.put_with_name(input.roleId, input.fileName, input.bytes);
  input.supportArtifacts.set(input.roleId, input.bytes);
  return true;
}

function sha256(value: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function rustJsonDigest(value: Record<string, unknown>): string {
  return sha256(JSON.stringify(value));
}

const B05_REFUSAL_DETAILS: Readonly<
  Record<B05RefusalReason, RuntimeB05RefusalDetail>
> = {
  input_capability_evidence_absent: "capability_evidence_absent",
  capability_evidence_not_bound_to_input:
    "capability_evidence_not_bound_to_input",
  participant_scope_undetermined: "participant_scope_undetermined",
  multiple_device_streams_aliased: "multiple_device_streams_aliased",
  device_stream_scope_unknown: "device_stream_scope_unknown",
  combined_event_representation: "combined_event_representation",
  source_stream_incomplete: "source_stream_incomplete",
  source_stream_completeness_unknown: "source_stream_completeness_unknown",
  source_order_not_preserved: "source_order_not_preserved",
  source_order_unknown: "source_order_unknown",
  unsupported_input_chunk: "participant_stream_fragmented",
  input_chunk_status_unknown: "input_chunk_status_unknown",
  missing_required_signal: "missing_required_signal",
  required_signal_capability_unknown: "required_signal_capability_unknown",
  unorderable_full_stream_row: "unorderable_full_stream_row",
  non_monotonic_source_timestamps: "non_monotonic_source_timestamps",
  ambiguous_equal_timestamp: "ambiguous_equal_timestamp",
};

const SCHOEDEL_REFUSAL_DETAILS: Readonly<
  Record<SchoedelRefusalReason, RuntimeSchoedelRefusalDetail>
> = {
  ambiguous_equal_timestamp: "ambiguous_equal_timestamp",
  unorderable_full_stream_row: "unorderable_full_stream_row",
  invalid_screen_interval_dependency: "invalid_screen_interval_dependency",
  schoedel_full_osf_missing_prerequisites: "full_osf_prerequisites_unavailable",
  capability_evidence_not_bound_to_input:
    "capability_evidence_not_bound_to_input",
};

type ScientificActivation = {
  processAppUsage: boolean;
  processScreenUsage: boolean;
  episodeReconstructionStrategy: string;
  screenSessionConstructionStrategy: string;
  screenSessionConstructionStrategyExplicit: boolean;
};

function scientificActivationFromRequest(
  requestJson: string,
  browserOptions: BrowserProcessingOptions,
): {
  request: {
    inputSha256?: unknown;
    options: Record<string, unknown>;
    participantPartitionBatchId?: unknown;
    fragmentedParticipantTokens?: unknown;
  };
  activation: ScientificActivation;
  requiresPreflight: boolean;
  usesCapabilityEvidence: boolean;
  b05Required: boolean;
  eyesRequired: boolean;
} {
  const parsed = JSON.parse(requestJson) as Record<string, unknown>;
  if (
    parsed.options === null ||
    typeof parsed.options !== "object" ||
    Array.isArray(parsed.options)
  ) {
    throw new Error("scientific campaign request options are malformed");
  }
  const request = {
    inputSha256: parsed.inputSha256,
    options: parsed.options as Record<string, unknown>,
    participantPartitionBatchId: parsed.participantPartitionBatchId,
    fragmentedParticipantTokens: parsed.fragmentedParticipantTokens,
  };
  const usageMode = request.options.usage_session_mode;
  const usageFlags: readonly [boolean, boolean] | null =
    usageMode === "app_and_screen_usage"
      ? [true, true]
      : usageMode === "app_usage"
        ? [true, false]
        : usageMode === "screen_usage"
          ? [false, true]
          : usageMode === "no_usage"
            ? [false, false]
            : null;
  if (
    usageFlags === null ||
    typeof request.options.episode_reconstruction_strategy !== "string" ||
    typeof request.options.screen_session_maximum_duration_disposition !==
      "string" ||
    typeof request.options.locked_screen_audio_disposition !== "string" ||
    (request.options.screen_session_construction_strategy !== undefined &&
      typeof request.options.screen_session_construction_strategy !== "string")
  ) {
    throw new Error("scientific campaign request activation is malformed");
  }
  const activation: ScientificActivation = {
    processAppUsage: usageFlags[0],
    processScreenUsage: usageFlags[1],
    episodeReconstructionStrategy:
      request.options.episode_reconstruction_strategy,
    screenSessionConstructionStrategy:
      request.options.screen_session_construction_strategy ??
      "chronicle_screen_interactive_v1",
    screenSessionConstructionStrategyExplicit:
      request.options.screen_session_construction_strategy !== undefined,
  };
  const expected: ScientificActivation = {
    processAppUsage: browserOptions.processAppUsage,
    processScreenUsage: browserOptions.processScreenUsage,
    episodeReconstructionStrategy: browserOptions.episodeReconstructionStrategy,
    screenSessionConstructionStrategy:
      browserOptions.screenSessionConstructionStrategy ??
      "chronicle_screen_interactive_v1",
    screenSessionConstructionStrategyExplicit:
      browserOptions.screenSessionConstructionStrategy !== undefined,
  };
  if (
    canonicalJson(request.options) !==
      canonicalJson(buildRustV2Options(browserOptions, GOLDEN_RUNTIME)) ||
    canonicalJson(activation) !== canonicalJson(expected) ||
    request.options.include_app_output !== activation.processAppUsage ||
    request.options.include_screen_output !== activation.processScreenUsage
  ) {
    throw new Error(
      "scientific campaign browser/request activation identity drifted",
    );
  }
  const b05Required =
    activation.processScreenUsage ||
    (activation.processAppUsage &&
      activation.episodeReconstructionStrategy ===
        "schoedel_2026_app_within_screen_prose_v1") ||
    request.options.screen_session_maximum_duration_disposition ===
      "exclude_participant" ||
    request.options.locked_screen_audio_disposition ===
      "exclude_from_phone_and_app_sessions";
  const eyesRequired =
    activation.processAppUsage &&
    activation.episodeReconstructionStrategy === "eyes_complement";
  return {
    request,
    activation,
    requiresPreflight: b05Required || eyesRequired,
    usesCapabilityEvidence: usesInputCapabilityEvidence(browserOptions),
    b05Required,
    eyesRequired,
  };
}

function validateScientificCampaignPreflight(input: {
  receipt: RuntimeScientificPreflightReceipt;
  rawBytes: Uint8Array;
  supportArtifacts: ReadonlyMap<string, Uint8Array>;
  request: {
    inputSha256?: unknown;
    options: Record<string, unknown>;
    participantPartitionBatchId?: unknown;
    fragmentedParticipantTokens?: unknown;
  };
  usesCapabilityEvidence: boolean;
  activation: ScientificActivation;
  b05Required: boolean;
  eyesRequired: boolean;
  artifactRequestFields: readonly string[];
}): void {
  const {
    receipt,
    rawBytes,
    supportArtifacts,
    request,
    usesCapabilityEvidence,
    activation,
    b05Required,
    eyesRequired,
    artifactRequestFields,
  } = input;
  const inputDigest = sha256(rawBytes);
  const optionsDigest = sha256(canonicalJson(request.options));
  // The kernel binds the computation projection — exact options minus the
  // artifact-only fields — into scientific receipts, so a pure output-format
  // toggle (SPSS/Parquet/plot flags) cannot perturb tracked fingerprints. The
  // preflight-commit key keeps the full exact-options digest.
  const computationOptions = Object.fromEntries(
    Object.entries(request.options).filter(
      ([key]) => !artifactRequestFields.includes(key),
    ),
  );
  const computationOptionsDigest = sha256(canonicalJson(computationOptions));
  if (
    request.inputSha256 !== inputDigest ||
    request.participantPartitionBatchId !== undefined ||
    request.fragmentedParticipantTokens !== undefined
  ) {
    throw new Error("scientific campaign request identity drifted");
  }
  if (
    !usesCapabilityEvidence &&
    supportArtifacts.has("input_capability_evidence_file")
  ) {
    throw new Error(
      "inactive scientific campaign capability evidence crossed the boundary",
    );
  }
  const roleIdentity = (roleId: string, artifactDigest: string) => ({
    artifactDigest,
    assignmentId: sha256(["assignment", roleId, artifactDigest].join("\u001f")),
  });
  const activeIngressRoles: Record<
    string,
    { artifactDigest: string; assignmentId: string }
  > = {
    processing_options: roleIdentity("processing_options", optionsDigest),
    raw_chronicle_csv: roleIdentity("raw_chronicle_csv", inputDigest),
  };
  for (const [roleId, bytes] of supportArtifacts) {
    if (
      roleId === "input_capability_evidence_file" &&
      !usesCapabilityEvidence
    ) {
      continue;
    }
    activeIngressRoles[roleId] = roleIdentity(roleId, sha256(bytes));
  }
  const expectedKey = {
    protocolVersion: "chronicle-runtime-scientific-preflight/v2",
    optionsDigest,
    inputDigest,
    inputSizeBytes: rawBytes.byteLength,
    activeIngressRoles,
    fragmentedParticipantCount: 0,
    fragmentedParticipantTokenScopeDigest: sha256(canonicalJson([])),
  };
  const schoedelRequired =
    activation.processAppUsage &&
    activation.episodeReconstructionStrategy ===
      "schoedel_2026_app_within_screen_prose_v1";
  const expectedScreenPhase = b05Required ? "finalized" : "not_applicable";
  const expectedSchoedelPhase = !schoedelRequired
    ? "not_applicable"
    : "finalized";
  const screenApplicability = receipt.b05Schoedel.screenApplicability;
  const schoedelApplicability = receipt.b05Schoedel.schoedelApplicability;
  const expectedScreenRelation =
    activation.screenSessionConstructionStrategy ===
    "chronicle_screen_interactive_v1"
      ? activation.screenSessionConstructionStrategyExplicit
        ? "baseline_equivalent"
        : "baseline_native"
      : "source_aligned_adapter";
  const validApplicability = (
    applicability:
      | RuntimeScientificPreflightReceipt["b05Schoedel"]["screenApplicability"]
      | RuntimeScientificPreflightReceipt["b05Schoedel"]["schoedelApplicability"],
    executableRelation:
      | "baseline_equivalent"
      | "baseline_native"
      | "source_aligned_adapter"
      | "controlled_derivative",
    refusalDetails: Readonly<Record<string, string>>,
  ): boolean =>
    applicability !== null &&
    applicability.protocolVersion ===
      "chronicle-b05-foundational-semantics/v1" &&
    (applicability.executable
      ? applicability.relation === executableRelation &&
        applicability.refusalReason === null &&
        applicability.refusalDetail === null
      : applicability.relation === "refused" &&
        applicability.refusalReason !== null &&
        applicability.refusalDetail ===
          refusalDetails[applicability.refusalReason]);
  const screenExecutable = screenApplicability?.executable ?? false;
  const schoedelExecutable = schoedelApplicability?.executable ?? false;
  const validSchoedelDependencyRefusal =
    !schoedelRequired ||
    screenExecutable ||
    (schoedelApplicability?.executable === false &&
      schoedelApplicability.refusalReason ===
        "invalid_screen_interval_dependency" &&
      schoedelApplicability.refusalDetail ===
        "invalid_screen_interval_dependency");
  const expectedB05Disposition = !b05Required
    ? "not_applicable"
    : screenExecutable && (!schoedelRequired || schoedelExecutable)
      ? "executable"
      : "refused";
  const eyesDisposition = receipt.eyesInputPartition.disposition;
  const validEyesApplicability = !eyesRequired
    ? eyesDisposition === "not_applicable" &&
      receipt.eyesInputPartition.effectiveEpisodeStrategyId === null &&
      receipt.eyesInputPartition.relation === null &&
      receipt.eyesInputPartition.refusalReason === null &&
      receipt.eyesInputPartition.refusalDetail === null
    : eyesDisposition === "executable" &&
      receipt.eyesInputPartition.effectiveEpisodeStrategyId ===
        "eyes_complement" &&
      receipt.eyesInputPartition.relation === "partial_replay" &&
      receipt.eyesInputPartition.refusalReason === null &&
      receipt.eyesInputPartition.refusalDetail === null;
  const expectedRouterOptionsDigest = rustJsonDigest({
    protocolVersion: "chronicle-b05-schoedel-preflight/v1",
    usageSessionMode: request.options.usage_session_mode,
    screenSessionConstructionStrategy:
      activation.screenSessionConstructionStrategy,
    screenSessionConstructionStrategyExplicit:
      activation.screenSessionConstructionStrategyExplicit,
    episodeReconstructionStrategy:
      request.options.episode_reconstruction_strategy,
  });
  const expectedScreenOptionsDigest = rustJsonDigest({
    protocolVersion: "chronicle-b05-screen-options/v1",
    screenSessionConstructionStrategy:
      activation.screenSessionConstructionStrategy,
  });
  const expectedSchoedelOptionsDigest = rustJsonDigest({
    protocolVersion: "chronicle-schoedel-options/v1",
    screenSessionConstructionStrategy:
      activation.screenSessionConstructionStrategy,
    episodeReconstructionStrategy:
      request.options.episode_reconstruction_strategy,
    eventRetentionSet: request.options.event_retention_set,
    openerSet: request.options.opener_set,
  });
  const expectedEyesResolutionDigest = sha256(
    JSON.stringify({
      protocolVersion: receipt.eyesInputPartition.protocolVersion,
      disposition: receipt.eyesInputPartition.disposition,
      inputDigest: receipt.eyesInputPartition.inputDigest,
      optionsDigest: receipt.eyesInputPartition.optionsDigest,
      optionsDigestOrigin: receipt.eyesInputPartition.optionsDigestOrigin,
      requestedEpisodeStrategyId:
        receipt.eyesInputPartition.requestedEpisodeStrategyId,
      effectiveEpisodeStrategyId:
        receipt.eyesInputPartition.effectiveEpisodeStrategyId,
      relation: receipt.eyesInputPartition.relation,
      refusalReason: receipt.eyesInputPartition.refusalReason,
      refusalDetail: receipt.eyesInputPartition.refusalDetail,
      fragmentedParticipantCount:
        receipt.eyesInputPartition.fragmentedParticipantCount,
      resolutionDigest: "",
    }),
  );
  if (
    canonicalJson(receipt.key) !== canonicalJson(expectedKey) ||
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
    receipt.protocolVersion !== "chronicle-runtime-scientific-preflight/v2" ||
    receipt.b05Schoedel.protocolVersion !==
      "chronicle-b05-schoedel-preflight/v1" ||
    receipt.eyesInputPartition.protocolVersion !==
      "chronicle-eyes-input-partition-preflight/v2" ||
    receipt.b05Schoedel.optionsDigest !== computationOptionsDigest ||
    receipt.b05Schoedel.componentOptionsDigest !==
      expectedRouterOptionsDigest ||
    receipt.b05Schoedel.screenComponentOptionsDigest !==
      expectedScreenOptionsDigest ||
    receipt.b05Schoedel.schoedelComponentOptionsDigest !==
      expectedSchoedelOptionsDigest ||
    receipt.b05Schoedel.optionsDigestOrigin !== "verified_request_jcs" ||
    receipt.eyesInputPartition.inputDigest !== inputDigest ||
    receipt.eyesInputPartition.optionsDigest !== computationOptionsDigest ||
    receipt.eyesInputPartition.optionsDigestOrigin !== "verified_request_jcs" ||
    receipt.eyesInputPartition.fragmentedParticipantCount !==
      receipt.key.fragmentedParticipantCount ||
    receipt.eyesInputPartition.resolutionDigest !==
      expectedEyesResolutionDigest ||
    receipt.b05Schoedel.requestedScreenStrategyId !==
      activation.screenSessionConstructionStrategy ||
    receipt.b05Schoedel.requestedEpisodeStrategyId !==
      activation.episodeReconstructionStrategy ||
    receipt.eyesInputPartition.requestedEpisodeStrategyId !==
      activation.episodeReconstructionStrategy ||
    receipt.b05Schoedel.effectiveScreenStrategyId !==
      activation.screenSessionConstructionStrategy ||
    receipt.b05Schoedel.effectiveEpisodeStrategyId !==
      (activation.processAppUsage &&
      activation.episodeReconstructionStrategy ===
        "schoedel_2026_app_within_screen_prose_v1"
        ? activation.episodeReconstructionStrategy
        : null) ||
    receipt.b05Schoedel.disposition !== expectedB05Disposition ||
    receipt.b05Schoedel.screenConstructionPhase !== expectedScreenPhase ||
    receipt.b05Schoedel.schoedelReconstructionPhase !== expectedSchoedelPhase ||
    b05Required !== (screenApplicability !== null) ||
    (screenApplicability !== null &&
      !validApplicability(
        screenApplicability,
        expectedScreenRelation,
        B05_REFUSAL_DETAILS,
      )) ||
    schoedelRequired !== (schoedelApplicability !== null) ||
    (schoedelApplicability !== null &&
      !validApplicability(
        schoedelApplicability,
        "controlled_derivative",
        SCHOEDEL_REFUSAL_DETAILS,
      )) ||
    !validSchoedelDependencyRefusal ||
    !validEyesApplicability
  ) {
    throw new Error("scientific campaign preflight identity drifted");
  }
}

/**
 * Execute one campaign cell through the same one-shot scientific boundary as
 * production. The exact request, raw bytes, support handle, and runtime
 * instance are reused without an await or mutation between preflight and
 * execution.
 */
export function executeScientificCampaignWorkspace<Handle>(input: {
  runtime: ScientificCampaignRuntime<Handle>;
  options: BrowserProcessingOptions;
  requestJson: string;
  rawBytes: Uint8Array;
  supports: CampaignSupportFiles;
  supportArtifacts: ReadonlyMap<string, Uint8Array>;
}): ScientificCampaignExecution<Handle> {
  const {
    runtime,
    options,
    requestJson,
    rawBytes,
    supports,
    supportArtifacts,
  } = input;
  const requestActivation = scientificActivationFromRequest(
    requestJson,
    options,
  );
  if (
    !requestActivation.usesCapabilityEvidence &&
    supportArtifacts.has("input_capability_evidence_file")
  ) {
    throw new Error(
      "inactive scientific campaign capability evidence crossed the boundary",
    );
  }
  let scientificPreflight: RuntimeScientificPreflightReceipt | null = null;
  if (requestActivation.requiresPreflight) {
    scientificPreflight = decodeScientificPreflightReceipt(
      JSON.parse(
        runtime.scientific_preflight_json(requestJson, rawBytes, supports),
      ),
    );
    validateScientificCampaignPreflight({
      receipt: scientificPreflight,
      rawBytes,
      supportArtifacts,
      request: requestActivation.request,
      usesCapabilityEvidence: requestActivation.usesCapabilityEvidence,
      activation: requestActivation.activation,
      b05Required: requestActivation.b05Required,
      eyesRequired: requestActivation.eyesRequired,
      artifactRequestFields: runtimeArtifactRequestFields(runtime),
    });
    const b05Disposition = scientificPreflight.b05Schoedel.disposition;
    const eyesDisposition = scientificPreflight.eyesInputPartition.disposition;
    if (
      (!requestActivation.b05Required && b05Disposition !== "not_applicable") ||
      (!requestActivation.eyesRequired && eyesDisposition !== "not_applicable")
    ) {
      throw new Error(
        "inactive scientific campaign preflight component was not not_applicable",
      );
    }
    if (
      (requestActivation.b05Required && b05Disposition === "refused") ||
      (requestActivation.eyesRequired && eyesDisposition === "refused")
    ) {
      return {
        status: "refused",
        receipt: scientificPreflight,
        executeCalls: 0,
      };
    }
    if (
      (requestActivation.b05Required && b05Disposition !== "executable") ||
      (requestActivation.eyesRequired && eyesDisposition !== "executable")
    ) {
      throw new Error(
        "an active scientific campaign component must be executable or explicitly refused",
      );
    }
  }
  const handle = runtime.execute_workspace(requestJson, rawBytes, supports);
  return {
    status: "executed",
    handle,
    scientificPreflight,
    executeCalls: 1,
  };
}

export class ScientificCampaignRefusalError extends Error {
  readonly code = "scientific_preflight_refused";

  constructor(readonly receipt: RuntimeScientificPreflightReceipt) {
    super("scientific campaign cell was refused before execution");
    this.name = "ScientificCampaignRefusalError";
  }
}

export function requireExecutedScientificCampaign<Handle>(
  result: ScientificCampaignExecution<Handle>,
): Extract<ScientificCampaignExecution<Handle>, { status: "executed" }> {
  if (result.status === "refused") {
    throw new ScientificCampaignRefusalError(result.receipt);
  }
  return result;
}
