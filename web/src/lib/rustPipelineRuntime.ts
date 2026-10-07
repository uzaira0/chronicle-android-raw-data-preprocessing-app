/**
 * Browser transport and persistence boundary for the authoritative Rust/WASM
 * preprocessing runtime.
 */
import type { PayloadSpillBridge } from "@/workers/payloadSpill";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFile,
  BrowserSupportFiles,
  TimezoneAction,
} from "@/lib/types";
import type { RawFileInspection } from "@/lib/fileInspection";
import { requireDefined } from "@/lib/invariant";
import type { ParticipantPartitionTransport } from "@/lib/fileInspection";
import type { RuntimeIdentity } from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm";
import defaultAppCodebookUrl from "@/assets/defaults/unified_app_codebook.csv?url";
import defaultAppsToFilterUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?url";
import defaultAppsForcingScreenOpenUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?url";
import defaultBackgroundAppsUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?url";
import { fetchBundledAssetBytes } from "@/lib/bundledAssetLoader";
import { canonicalJson } from "@/lib/canonicalJson";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  browserSupportFileKeyForRole,
  literatureComponentExecutionForSettings,
  literatureInputAdapterForSetting,
  methodReceiptUsesInputCapabilityEvidence,
  type RegisteredLiteratureComponentExecution,
  literatureComponentTableMediaType,
  literatureComponentInputRole,
} from "@/lib/literatureInputAdapters";
import {
  requiresLiveScientificPreflight,
  usesInputCapabilityEvidence,
  validateInputCapabilityEvidenceFile,
} from "@/lib/inputCapabilityEvidence";
import {
  WORKFLOW_QUERY_GROUP_IDS,
  WORKFLOW_QUERY_IDS,
} from "@/lib/generatedInteractionTypes";
import {
  RUNTIME_BOUNDARY_MODEL,
  type MaximumDurationReceipt,
  type MaximumDurationPreflightDecision as SerializedMaximumDurationPreflightDecision,
  type OpenerSetEvidence,
  type OpenerSetPreflightDecision as SerializedOpenerSetPreflightDecision,
  type WorkflowCheckpoint,
  type RuntimeArtifactMetadata,
  type ReviewRuntimeManifest as SerializedReviewRuntimeManifest,
  type RuntimeManifest as SerializedRuntimeManifest,
} from "@/lib/generatedRuntimeBoundary";
import { decodeScientificPreflightReceipt } from "@/lib/scientificPreflightBoundary";
import type { RuntimeScientificPreflightReceipt as SerializedRuntimeScientificPreflightReceipt } from "@/lib/generatedRuntimeBoundary";
import {
  arrayAt,
  checkpointComponentDigestAt,
  contractError,
  decodeBoundaryStruct,
  digestAt,
  integerAt,
  objectAt,
  stringAt,
} from "@/lib/runtimeBoundaryModel";
import {
  collectRuntimeVerifiedHistory,
  commitPersistedRuntimeWorkspace,
  exportRuntimeClosure,
  garbageCollectRuntimeObjects,
  removeOpfsWorkspace,
  importRuntimeClosure,
  inspectVerifiedRuntimeClosure,
  isRecoverableClosureObjectError,
  openOpfsWorkspace,
  persistRuntimeObjects,
  persistRuntimeWorkspace,
  readRuntimeObject,
  readRuntimeObjectPrefix,
  recoverRuntimeWorkspace,
  recoverRuntimeWorkspaceHead,
  recoverRuntimeWorkspaceRoots,
  runtimeClosureWorkspaceId,
  type PersistedRuntimeArtifact,
  type PersistedRuntimeArtifactMetadata,
  type RuntimeClosureInspection,
  type RuntimeClosureManifest,
  type WorkspaceRootSlot,
} from "@/lib/opfsArtifactStore";

type KernelHandle = {
  readonly artifact_count: number;
  manifest_json(): string;
  artifact_metadata_json(index: number): string;
  take_artifact_bytes(index: number): Uint8Array;
  free(): void;
};

type RuntimeSupportFilesHandle = {
  put(role: string, bytes: Uint8Array): void;
  put_with_name(role: string, name: string, bytes: Uint8Array): void;
  free(): void;
};

type PreparedReviewWorkspaceHandle = {
  required_base_kind(): string;
  execute_selected_base(selectedBaseBytes: Uint8Array): KernelHandle;
  execute_selected_base_pair(
    reviewBaseBytes: Uint8Array,
    reconstructionBaseBytes: Uint8Array,
  ): KernelHandle;
  free(): void;
};

type KernelModule = {
  default(input?: { module_or_path: WebAssembly.Module }): Promise<unknown>;
  runtime_version(): string;
  implementation_build_digest(): string;
  build_environment_digest(): string;
  runtime_identity(): RuntimeIdentity;
  runtime_identity_json(): string;
  workflow_contract_json(): string;
  opener_set_applicability_json(requestJson: string): string;
  maximum_duration_applicability_json(requestJson: string): string;
  plan_workflow_explorer_view_json(requestJson: string): string;
  review_base_probe_spec_json(): string;
  RuntimeSupportFiles: new () => RuntimeSupportFilesHandle;
  discover_timezones_v2(csvBytes: Uint8Array): string[];
  split_raw_by_study_v1?(csvBytes: Uint8Array): {
    study_ids(): string[];
    take_part(index: number): Uint8Array;
    free(): void;
  };
  inspect_raw_file_v1(
    csvBytes: Uint8Array,
    fileName: string,
    sizeBytes: number,
  ): string;
  begin_raw_inspection_batch?(secretBytes: Uint8Array): string;
  dispose_raw_inspection_batch?(batchId: string): boolean;
  inspect_raw_file_v2?(
    csvBytes: Uint8Array,
    fileName: string,
    sizeBytes: number,
    participantPartitionBatchId: string,
  ): string;
  register_raw_participant_partition_artifact?(
    csvBytes: Uint8Array,
    participantPartitionBatchId: string,
  ): void;
  scientific_preflight_json?(
    requestJson: string,
    csvBytes: Uint8Array,
    supportFiles: RuntimeSupportFilesHandle,
  ): string;
  execute_workspace(
    requestJson: string,
    csvBytes: Uint8Array,
    supportFiles: RuntimeSupportFilesHandle,
  ): KernelHandle;
  execute_literature_component?(
    componentId: string,
    requestJson: string,
    csvBytes: Uint8Array,
    supportFiles: RuntimeSupportFilesHandle,
  ): KernelHandle;
  execute_workspace_with_review_base(
    requestJson: string,
    csvBytes: Uint8Array,
    reviewBaseBytes: Uint8Array,
    supportFiles: RuntimeSupportFilesHandle,
  ): KernelHandle;
  execute_workspace_with_review_bases(
    requestJson: string,
    csvBytes: Uint8Array,
    reviewBaseBytes: Uint8Array,
    reconstructionBaseBytes: Uint8Array,
    supportFiles: RuntimeSupportFilesHandle,
  ): KernelHandle;
  prepare_workspace_review(
    requestJson: string,
    csvBytes: Uint8Array,
    reviewBaseProbe: Uint8Array,
    reconstructionBaseProbe: Uint8Array,
    supportFiles: RuntimeSupportFilesHandle,
  ): PreparedReviewWorkspaceHandle;
  prepare_persisted_workspace_review(
    requestJson: string,
    inputSizeBytes: number,
    reviewBaseProbe: Uint8Array,
    reconstructionBaseProbe: Uint8Array,
    supportFiles: RuntimeSupportFilesHandle,
  ): PreparedReviewWorkspaceHandle;
  /**
   * Optional because a stubbed kernel in a test may not provide it. Production
   * builds always export it (pinned in scripts/check_wasm_exports.mjs); it is
   * called only after an execution has already failed with open binding holes,
   * to recover the column-level reason that failure discards.
   */
  evaluate_workspace_requirements?(
    requestJson: string,
    csvBytes: Uint8Array,
    supportFiles: RuntimeSupportFilesHandle,
  ): string;
  verify_evidence_journal_cbor(bytes: Uint8Array): number;
  set_comparison_cache_capacity(capacity: number): void;
  set_payload_budget_bytes(bytes: bigint): void;
  install_payload_spill(bridge: PayloadSpillBridge, budgetBytes: bigint): void;
  get_comparison_cache_retained(): number;
};

/**
 * The manifest as the browser consumes it: the generated Rust serialization
 * type, narrowed on the three values whose vocabulary lives in the product
 * rather than in a Rust enum — the protocol pin, the command pin, and the
 * timezone action. Every other field, including its nullability and value
 * domain, comes from `generatedRuntimeBoundary.ts`, so a Rust rename or retype
 * fails `npm run typecheck` here instead of silently passing through.
 */
export type RuntimeManifest = Omit<
  SerializedRuntimeManifest,
  "protocolVersion" | "command" | "processingSummary"
> & {
  protocolVersion: "chronicle-preprocessing-runtime/v2";
  command: "ExecuteWorkspace";
  processingSummary: Omit<
    SerializedRuntimeManifest["processingSummary"],
    "timezoneAction"
  > & { timezoneAction: TimezoneAction };
};

export type OpenerSetPreflightDecision = SerializedOpenerSetPreflightDecision;
export type MaximumDurationPreflightDecision =
  SerializedMaximumDurationPreflightDecision;
export type RuntimeScientificPreflightReceipt =
  SerializedRuntimeScientificPreflightReceipt;

export class RustOpenerSetRefusalError extends Error {
  readonly code = "opener_set_refused";

  constructor(readonly decision: OpenerSetPreflightDecision) {
    super(
      `Opener set ${decision.requestedOpenerSetId} is incompatible with the selected reconstruction strategy (${decision.reasonCode ?? "unspecified_reason"})`,
    );
    this.name = "RustOpenerSetRefusalError";
  }
}

export class RustMaximumDurationRefusalError extends Error {
  readonly code = "maximum_duration_refused";

  constructor(readonly decision: MaximumDurationPreflightDecision) {
    super(
      `Maximum-duration policy ${decision.applicability.requestedPolicy} cannot run with the selected settings (${decision.reasonCode ?? "unspecified_reason"})`,
    );
    this.name = "RustMaximumDurationRefusalError";
  }
}

/** Researcher-facing wording for the refusals a default-shaped batch can meet. */
const PREFLIGHT_REFUSAL_WORDS: Partial<Record<string, string>> = {
  participant_stream_fragmented:
    "This file's participant also appears in another file of this batch, and " +
    "sessions cannot be closed safely across a split export. Combine the " +
    "participant's files into one, or turn off screen usage to process app usage alone.",
  capability_evidence_absent:
    "The selected screen-session strategy needs an input capability evidence CSV " +
    "(Files → Study inputs). Supply one, or choose the Chronicle screen strategy.",
};

export class RustScientificPreflightRefusalError extends Error {
  readonly code = "scientific_preflight_refused";

  constructor(readonly receipt: RuntimeScientificPreflightReceipt) {
    const b05 = receipt.b05Schoedel;
    const b05Applicability =
      b05.screenApplicability?.executable === false
        ? b05.screenApplicability
        : b05.schoedelApplicability?.executable === false
          ? b05.schoedelApplicability
          : null;
    const eyes = receipt.eyesInputPartition;
    const axis =
      b05.disposition === "refused"
        ? "B05/Schoedel"
        : eyes.disposition === "refused"
          ? "EYES input partition"
          : "scientific input";
    const reason =
      b05Applicability?.refusalReason ?? eyes.refusalReason ?? "non_executable";
    const detail =
      b05Applicability?.refusalDetail ?? eyes.refusalDetail ?? "unspecified";
    const code = `Scientific preflight refused (${axis}: ${reason}/${detail}).`;
    const plain = PREFLIGHT_REFUSAL_WORDS[detail];
    super(plain ? `${plain} ${code}` : code);
    this.name = "RustScientificPreflightRefusalError";
  }
}

export { decodeScientificPreflightReceipt };

export function decodeOpenerSetPreflightDecision(
  value: unknown,
): OpenerSetPreflightDecision {
  const decision = decodeBoundaryStruct<SerializedOpenerSetPreflightDecision>(
    RUNTIME_BOUNDARY_MODEL,
    "OpenerSetPreflightDecision",
    value,
    "openerSetPreflightDecision",
  );
  if (decision.status === "refused") {
    if (
      decision.relation !== "refused" ||
      decision.effectiveOpenerSetId !== null ||
      decision.reasonCode !== "eyes_requires_lifecycle_triplets"
    ) {
      contractError(
        "openerSetPreflightDecision",
        "refused decision has inconsistent relation, effective id, or reason",
      );
    }
  } else if (
    decision.relation === "refused" ||
    decision.effectiveOpenerSetId !== decision.resolvedOpenerSetId ||
    decision.reasonCode !== null
  ) {
    contractError(
      "openerSetPreflightDecision",
      "executable decision has inconsistent relation, effective id, or reason",
    );
  }
  return decision;
}

export function decodeMaximumDurationPreflightDecision(
  value: unknown,
): MaximumDurationPreflightDecision {
  const decision =
    decodeBoundaryStruct<SerializedMaximumDurationPreflightDecision>(
      RUNTIME_BOUNDARY_MODEL,
      "MaximumDurationPreflightDecision",
      value,
      "maximumDurationPreflightDecision",
    );
  const applicability = decision.applicability;
  if (decision.status === "refused") {
    // `reasonCode` is the kernel's canonical refusal id
    // (`maximum_duration_<reason>`); `applicability.refusalReason` is the
    // typed reason. Both must be present on a refusal, neither on success.
    if (
      applicability.relation !== "refused" ||
      applicability.refusalReason === null ||
      decision.reasonCode === null ||
      !decision.reasonCode.endsWith(applicability.refusalReason)
    ) {
      contractError(
        "maximumDurationPreflightDecision",
        "refused decision has inconsistent relation or reason",
      );
    }
  } else if (
    applicability.relation === "refused" ||
    applicability.refusalReason !== null ||
    decision.reasonCode !== null
  ) {
    contractError(
      "maximumDurationPreflightDecision",
      "executable decision has inconsistent relation or reason",
    );
  }
  return decision;
}

/// Runs only for an explicit maximum-duration selection: with every B06 key
/// absent the kernel emits no receipt and there is nothing to preflight.
export function isExplicitMaximumDurationSelection(
  options: BrowserProcessingOptions,
): boolean {
  return (
    typeof options.maximumDurationPolicy === "string" ||
    typeof options.maximumDurationDisposition === "string" ||
    typeof options.maximumDurationThresholdSource === "string" ||
    typeof options.maximumDurationThresholdNs === "string"
  );
}

function preflightMaximumDuration(
  kernel: KernelModule,
  requestJson: string,
  options: BrowserProcessingOptions,
): MaximumDurationPreflightDecision | null {
  if (!isExplicitMaximumDurationSelection(options)) return null;
  let decision: MaximumDurationPreflightDecision;
  try {
    decision = decodeMaximumDurationPreflightDecision(
      JSON.parse(kernel.maximum_duration_applicability_json(requestJson)),
    );
  } catch (error) {
    throw new Error(
      `maximum-duration preflight failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (decision.applicability.shape === "omitted_legacy") {
    contractError(
      "maximumDurationPreflightDecision",
      "explicit request resolved to the omitted shape",
    );
  }
  if (decision.status === "refused") {
    throw new RustMaximumDurationRefusalError(decision);
  }
  return decision;
}

function verifyMaximumDurationExecutionAgreement(
  optionsDigest: string,
  receipt: MaximumDurationReceipt | undefined,
  decision: MaximumDurationPreflightDecision | null,
  manifestName: "review manifest" | "runtime manifest",
  receiptPath: string,
): void {
  if (decision === null) {
    if (receipt !== undefined) {
      contractError(
        receiptPath,
        "maximum-duration receipt present for an omitted request",
      );
    }
    return;
  }
  if (optionsDigest !== decision.optionsDigest) {
    throw new Error(
      `${manifestName} options identity disagrees with maximum-duration preflight`,
    );
  }
  if (receipt === undefined) {
    contractError(
      receiptPath,
      "maximum-duration receipt missing for an explicit request",
    );
  }
  if (
    JSON.stringify(receipt.applicability) !==
    JSON.stringify(decision.applicability)
  ) {
    contractError(
      receiptPath,
      "maximum-duration execution receipt disagrees with preflight",
    );
  }
}

function verifyOpenerReceiptMatchesDecision(
  receipt: OpenerSetEvidence,
  decision: OpenerSetPreflightDecision,
  path: string,
): void {
  const applicability = receipt.applicability;
  if (
    applicability.requested !== decision.resolvedOpenerSetId ||
    applicability.effective !== decision.effectiveOpenerSetId ||
    applicability.relation !== decision.relation ||
    applicability.refusalReason !== decision.reasonCode
  ) {
    contractError(
      path,
      "opener-set execution receipt disagrees with preflight",
    );
  }
}

function preflightOpenerSet(
  kernel: KernelModule,
  requestJson: string,
  expectedOpenerSetId: string,
): OpenerSetPreflightDecision {
  let decision: OpenerSetPreflightDecision;
  try {
    decision = decodeOpenerSetPreflightDecision(
      JSON.parse(kernel.opener_set_applicability_json(requestJson)),
    );
  } catch (error) {
    throw new Error(
      `opener-set preflight failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (
    decision.requestedOpenerSetId !== expectedOpenerSetId ||
    decision.resolvedOpenerSetId !== expectedOpenerSetId
  ) {
    contractError(
      "openerSetPreflightDecision",
      "requested or resolved id disagrees with sanitized browser settings",
    );
  }
  if (decision.status === "refused") {
    throw new RustOpenerSetRefusalError(decision);
  }
  return decision;
}

export function preflightScientificInputs(
  kernel: KernelModule,
  requestJson: string,
  csvBytes: Uint8Array,
  supportFiles: RuntimeSupportFilesHandle,
  options: BrowserProcessingOptions,
  expectedInputDigest: string,
  persistedReviewOnly: boolean,
): RuntimeScientificPreflightReceipt | null {
  if (!requiresLiveScientificPreflight(options)) return null;
  if (csvBytes.byteLength === 0) {
    // A raw-less review attempt has nothing to preflight over. Rust decides
    // whether the persisted base it selects carries a commitment that covers
    // this measurement, and names its refusal when it does not, so leaving the
    // pending preflight unset here is what lets that decision happen at all.
    if (persistedReviewOnly) return null;
    throw new Error(
      "Scientific preflight requires the verified raw artifact; re-inspect and retry.",
    );
  }
  let receipt: RuntimeScientificPreflightReceipt;
  try {
    const scientificPreflight = kernel.scientific_preflight_json?.bind(kernel);
    if (!scientificPreflight) {
      throw new Error(
        "runtime WASM does not expose the v2 scientific-preflight boundary",
      );
    }
    receipt = decodeScientificPreflightReceipt(
      JSON.parse(scientificPreflight(requestJson, csvBytes, supportFiles)),
    );
  } catch (error) {
    // A support file that fails its content check surfaces here first when
    // screen usage is on, so it gets the same plain-language description.
    const described = describeOpenBindingHolesError(
      error,
      kernel,
      requestJson,
      csvBytes,
      supportFiles,
    );
    if (described !== error) throw described;
    throw new Error(
      `Scientific preflight failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (
    receipt.key.inputDigest !== expectedInputDigest ||
    receipt.key.inputSizeBytes !== csvBytes.byteLength ||
    receipt.eyesInputPartition.inputDigest !== expectedInputDigest
  ) {
    contractError(
      "scientificPreflightReceipt.key",
      "input identity disagrees with the verified raw artifact",
    );
  }
  const b05Required =
    options.processScreenUsage ||
    (options.processAppUsage &&
      options.episodeReconstructionStrategy ===
        "schoedel_2026_app_within_screen_prose_v1");
  const eyesRequired =
    options.processAppUsage &&
    options.episodeReconstructionStrategy === "eyes_complement";
  if (
    (b05Required && receipt.b05Schoedel.disposition !== "executable") ||
    (eyesRequired && receipt.eyesInputPartition.disposition !== "executable")
  ) {
    if (
      receipt.b05Schoedel.disposition === "refused" ||
      receipt.eyesInputPartition.disposition === "refused"
    ) {
      throw new RustScientificPreflightRefusalError(receipt);
    }
    contractError(
      "scientificPreflightReceipt",
      "an active scientific arm must be executable or explicitly refused",
    );
  }
  return receipt;
}

function verifyOpenerExecutionAgreement(
  optionsDigest: string,
  receipt: OpenerSetEvidence,
  decision: OpenerSetPreflightDecision,
  manifestName: "review manifest" | "runtime manifest",
  receiptPath: string,
): void {
  if (optionsDigest !== decision.optionsDigest) {
    throw new Error(
      `${manifestName} options identity disagrees with opener preflight`,
    );
  }
  verifyOpenerReceiptMatchesDecision(receipt, decision, receiptPath);
}

const TIMEZONE_ACTIONS = new Set<string>([
  "none",
  "filtered_to_selected",
  "converted_to_selected",
  "filtered_to_primary",
  "converted_to_primary",
]);
const CHECKPOINT_PROTOCOL_VERSION = "chronicle-workflow-checkpoint/v1";
const SUPPORTED_CACHE_SOURCES = new Set<string>([
  "salsa-memory",
  "verified-review-base",
  "verified-reconstruction-base",
]);
const WORKFLOW_CONTRACT_DIGEST_FIELDS = [
  "semantic",
  "presentation",
  "execution",
  "checkpointPolicy",
  "evidence",
  "workspaceCompatibility",
] as const;

type WorkflowContractDigests = Record<
  (typeof WORKFLOW_CONTRACT_DIGEST_FIELDS)[number],
  string
>;

function workflowContractDigestsAt(
  value: unknown,
  path: string,
): WorkflowContractDigests {
  const source = objectAt(value, path);
  return Object.fromEntries(
    WORKFLOW_CONTRACT_DIGEST_FIELDS.map((field) => [
      field,
      digestAt(source[field], `${path}.${field}`),
    ]),
  ) as WorkflowContractDigests;
}

function hasExactIdentityDomain(
  observed: readonly string[],
  expected: readonly string[],
): boolean {
  const sortedObserved = [...observed].sort();
  const sortedExpected = [...expected].sort();
  return (
    observed.length === expected.length &&
    new Set(observed).size === observed.length &&
    sortedObserved.every((id, index) => id === sortedExpected[index])
  );
}

/**
 * Artifact metadata reaches the browser in three places — the manifest
 * catalog, the persisted artifact-closure JSON, and each
 * `artifact_metadata_json()` payload — and all three are the same Rust
 * `RuntimeArtifactMetadata`, so all three decode through the generated model.
 */
function artifactMetadataAt(
  value: unknown,
  path: string,
): RuntimeArtifactMetadata {
  return decodeBoundaryStruct<RuntimeArtifactMetadata>(
    RUNTIME_BOUNDARY_MODEL,
    "RuntimeArtifactMetadata",
    value,
    path,
  );
}

/**
 * Semantic check over one checkpoint domain. The structural pass already
 * proved the maps and their fields exist and are strings; what stays here is
 * the product agreement the Rust types cannot express: the checkpoint protocol
 * pin, the xxh3-128 component family, the stage identity, the terminal digest
 * matching its domain entry, and exact agreement with the execution registry.
 */
function verifyCheckpointDomain(
  digests: Record<string, string>,
  checkpoints: Record<string, WorkflowCheckpoint>,
  path: string,
  expectedIds: readonly string[],
): void {
  for (const [id, checkpoint] of Object.entries(checkpoints)) {
    const checkpointPath = `${path}Checkpoints.${id}`;
    for (const component of [
      "rowMembershipDigest",
      "rowOrderDigest",
      "temporalStateDigest",
      "classificationDigest",
      "payloadDigest",
      "schemaDigest",
    ] as const) {
      checkpointComponentDigestAt(
        checkpoint[component],
        `${checkpointPath}.${component}`,
      );
    }
    digestAt(checkpoint.terminalDigest, `${checkpointPath}.terminalDigest`);
    if (checkpoint.protocolVersion !== CHECKPOINT_PROTOCOL_VERSION) {
      contractError(
        `${checkpointPath}.protocolVersion`,
        "unsupported checkpoint protocol",
      );
    }
    if (
      checkpoint.subjectId !== id ||
      checkpoint.terminalDigest !== digests[id]
    ) {
      contractError(
        checkpointPath,
        "checkpoint identity or terminal digest does not match its domain",
      );
    }
  }
  const digestIds = Object.keys(digests).sort();
  const checkpointIds = Object.keys(checkpoints).sort();
  const registryIds = [...expectedIds].sort();
  if (
    registryIds.length === 0 ||
    new Set(registryIds).size !== registryIds.length ||
    JSON.stringify(digestIds) !== JSON.stringify(checkpointIds) ||
    JSON.stringify(digestIds) !== JSON.stringify(registryIds)
  ) {
    contractError(
      `${path}Checkpoints`,
      "digest, checkpoint, and execution-registry domains must contain the same identities",
    );
  }
}

/**
 * Fail-closed decoder for the product-owned Rust/WASM execution contract.
 *
 * The STRUCTURAL half — which fields exist, their JSON names, nullability,
 * value domains (non-empty string, sha256 digest, non-negative integer,
 * boolean), collection shapes, and legal enum spellings — is checked against
 * `RUNTIME_BOUNDARY_MODEL`, generated from the Rust serialization model by
 * `rust/chronicle_preprocessing_runtime_wasm/examples/boundary_model.rs`.
 * Unknown fields remain forward-transportable and are dropped.
 *
 * The SEMANTIC half stays here because no Rust type expresses it: protocol and
 * command pins, the two-mode dependency-cache claim and its agreement with the
 * manifest certificate, non-empty unique query registries, checkpoint-domain
 * agreement, query output agreement, timezone row accounting, and identity
 * uniqueness across artifacts, roles, and query groups.
 */
export function decodeRuntimeManifest(value: unknown): RuntimeManifest {
  const source = objectAt(value, "manifest");
  if (source.protocolVersion !== "chronicle-preprocessing-runtime/v2") {
    contractError("manifest.protocolVersion", "unsupported protocol version");
  }
  if (source.command !== "ExecuteWorkspace") {
    contractError("manifest.command", "expected ExecuteWorkspace");
  }
  // Pinned before the structural pass so an unrecognized mode names the two
  // modes the browser accepts rather than reporting a generic enum rejection.
  const declaredMode = objectAt(
    source.dependencyCacheDecision,
    "manifest.dependencyCacheDecision",
  ).mode;
  if (
    declaredMode !== "certified_narrow" &&
    declaredMode !== "conservative_full"
  ) {
    contractError(
      "manifest.dependencyCacheDecision.mode",
      "expected certified_narrow or conservative_full",
    );
  }

  const manifest = decodeBoundaryStruct<SerializedRuntimeManifest>(
    RUNTIME_BOUNDARY_MODEL,
    "RuntimeManifest",
    value,
    "manifest",
  );

  const cacheDecision = manifest.dependencyCacheDecision;
  if (
    cacheDecision.mode === "certified_narrow" &&
    (!cacheDecision.certificate_digest || !cacheDecision.binding_surface_digest)
  ) {
    contractError(
      "manifest.dependencyCacheDecision",
      "certified_narrow requires certificate and binding-surface identity",
    );
  }
  if (
    cacheDecision.certificate_digest !== null &&
    cacheDecision.certificate_digest !== manifest.dependencyCertificateDigest
  ) {
    contractError(
      "manifest.dependencyCacheDecision.certificate_digest",
      "does not match manifest dependency certificate",
    );
  }

  const {
    queryGroupExecutions,
    queryExecutions,
    artifacts,
    processingSummary: summary,
  } = manifest;
  if (
    !hasExactIdentityDomain(
      queryGroupExecutions.map((execution) => execution.query_group_id),
      WORKFLOW_QUERY_GROUP_IDS,
    )
  ) {
    contractError(
      "manifest.queryGroupExecutions",
      "query-group executions do not match the generated workflow registry",
    );
  }
  if (
    !hasExactIdentityDomain(
      queryExecutions.map((execution) => execution.query_id),
      WORKFLOW_QUERY_IDS,
    )
  ) {
    contractError(
      "manifest.queryExecutions",
      "query executions do not match the generated workflow registry",
    );
  }

  if (!TIMEZONE_ACTIONS.has(summary.timezoneAction)) {
    contractError(
      "manifest.processingSummary.timezoneAction",
      "unknown timezone action",
    );
  }
  verifyCheckpointDomain(
    summary.workflowQueryGroupDigests,
    summary.workflowQueryGroupCheckpoints,
    "manifest.processingSummary.workflowQueryGroup",
    queryGroupExecutions.map(({ query_group_id }) => query_group_id),
  );
  verifyCheckpointDomain(
    summary.workflowQueryDigests,
    summary.workflowQueryCheckpoints,
    "manifest.processingSummary.workflowQuery",
    queryExecutions.map(({ query_id }) => query_id),
  );
  for (const execution of queryExecutions) {
    if (
      summary.workflowQueryDigests[execution.query_id] !==
      execution.output_digest
    ) {
      contractError(
        `manifest.queryExecutions.${execution.query_id}`,
        "query execution output does not match its Rust checkpoint",
      );
    }
  }
  if (
    summary.rowsBeforeTimezoneHandling - summary.rowsRemovedByTimezone !==
    summary.rowsAfterTimezoneHandling
  ) {
    contractError(
      "manifest.processingSummary",
      "timezone row accounting is inconsistent",
    );
  }

  for (const [field, values] of [
    ["artifact kind", artifacts.map(({ kind }) => kind)],
    ["artifact id", artifacts.map(({ artifactId }) => artifactId)],
    ["role", manifest.roleAssignments.map(({ role_id }) => role_id)],
    [
      "query group",
      manifest.queryGroupExecutions.map(({ query_group_id }) => query_group_id),
    ],
  ] as const) {
    if (new Set(values).size !== values.length) {
      contractError("manifest", `duplicate ${field}`);
    }
  }

  return manifest as RuntimeManifest;
}

export function verifyRuntimeArtifactCatalog(
  manifest: RuntimeManifest,
  exposedArtifacts: readonly RuntimeArtifactMetadata[],
): void {
  const exposedByKind = new Map(
    exposedArtifacts.map((metadata) => [metadata.kind, metadata]),
  );
  if (
    exposedByKind.size !== exposedArtifacts.length ||
    manifest.artifacts.length !== exposedByKind.size
  ) {
    throw new Error("runtime manifest artifact catalog length mismatch");
  }
  for (const metadata of manifest.artifacts) {
    const exposed = exposedByKind.get(metadata.kind);
    if (!exposed || canonicalJson(exposed) !== canonicalJson(metadata)) {
      throw new Error(
        `runtime manifest artifact catalog mismatch: ${metadata.kind}`,
      );
    }
  }
  const manifestArtifactDigests = new Set(
    manifest.artifacts.map(({ digest }) => digest),
  );
  if (
    !manifestArtifactDigests.has(manifest.journalDigest) ||
    !manifestArtifactDigests.has(manifest.dependencyCertificateDigest)
  ) {
    throw new Error(
      "runtime manifest artifact catalog omits evidence or dependency certificate",
    );
  }
}

export type RustRuntimeExecution = {
  workspaceId: string;
  manifestJson: string;
  manifest: RuntimeManifest;
  /**
   * Complete for an ephemeral execution. After a durable OPFS commit this map
   * contains only the small views the immediate caller requested; the manifest
   * remains the complete artifact catalog and all other bytes are read through
   * their exact persisted root.
   */
  artifacts: Map<string, Uint8Array>;
  persistedWorkspace?: WorkspaceRootSlot;
};

export type RustReviewExecution = {
  workspaceId: string;
  previousWorkspaceRootDigest: string | null;
  manifestJson: string;
  inputDigest: string;
  optionsDigest: string;
  implementationDigest: string;
  buildEnvironmentDigest: string;
  planDigest: string;
  profileDigest: string;
  profileLockDigest: string;
  productContractDigest: string;
  dependencyCertificateDigest: string;
  openerSetReceipt: OpenerSetEvidence;
  /** Present only for an explicit maximum-duration selection. */
  maximumDurationReceipt?: MaximumDurationReceipt;
  comparisonDigest: string;
  reviewSummaryDigest: string;
  counts: { original: number; processed: number; app: number; screen: number };
  availableTimezones: string[];
  timezone: string;
  timezoneAction: TimezoneAction;
  rowsBeforeTimezoneHandling: number;
  rowsAfterTimezoneHandling: number;
  rowsRemovedByTimezone: number;
  duplicateTimestampsCorrected: number;
  exactDuplicateRowsRemoved: number;
  cacheSources: Array<
    "salsa-memory" | "verified-review-base" | "verified-reconstruction-base"
  >;
  /** Bytes loaded from the receipt-pinned OPFS head and supplied to Rust. */
  suppliedReviewBaseBytes: number;
  suppliedReconstructionBaseBytes: number;
  recomputedQueryIds: string[];
  cachedQueryIds: string[];
  bypassedQueryIds: string[];
  skippedQueryIds: string[];
  errorQueryIds: string[];
  /** True when the runtime matched the caller's known digest and omitted only
   * the summary bytes; scientific sidecars are still verified and discarded. */
  reviewSummaryReused: boolean;
  reviewSummaryJsonBytes?: Uint8Array;
};

type DecodedReviewRuntimeManifest = Omit<
  RustReviewExecution,
  | "manifestJson"
  | "reviewSummaryJsonBytes"
  | "suppliedReviewBaseBytes"
  | "suppliedReconstructionBaseBytes"
>;

type DecodedReviewRuntimeEnvelope = {
  execution: DecodedReviewRuntimeManifest;
  artifactCatalog: RuntimeArtifactMetadata[];
  expectedArtifactJson: ReadonlyMap<string, unknown>;
};

const REVIEW_SCIENTIFIC_ARTIFACT_DIGEST_FIELDS = [
  [
    "foundational-semantics-receipt-json",
    "foundationalSemanticsArtifactDigest",
  ],
  [
    "minimum-duration-excluded-lineage-json",
    "minimumDurationExcludedLineageArtifactDigest",
  ],
  [
    "zero-duration-cleanup-evidence-json",
    "zeroDurationCleanupEvidenceArtifactDigest",
  ],
  [
    "zero-duration-removed-lineage-json",
    "zeroDurationRemovedLineageArtifactDigest",
  ],
  [
    "b05-screen-construction-evidence-json",
    "b05ScreenConstructionArtifactDigest",
  ],
  [
    "schoedel-reconstruction-evidence-json",
    "schoedelReconstructionArtifactDigest",
  ],
  [
    "b05-schoedel-validation-receipt-json",
    "b05SchoedelValidationReceiptArtifactDigest",
  ],
] as const;

const REVIEW_SUMMARY_KIND = "review-summary-json";
const EYES_TAGGED_FAU_EVIDENCE_KIND = "eyes-tagged-fau-evidence-json";
const EYES_TAGGED_FAU_VALIDATION_RECEIPT_KIND =
  "eyes-tagged-fau-validation-receipt-json";

function screenRelationMatchesStrategy(
  strategyId: SerializedReviewRuntimeManifest["scientificEvidence"]["b05SchoedelValidationReceipt"]["selectedB05StrategyId"],
  relation: string,
): boolean {
  switch (strategyId) {
    case "chronicle_screen_interactive_v1":
      return (
        relation === "baseline_native" || relation === "baseline_equivalent"
      );
    case "parry_toth_2025_session_glance_v1":
    case "zhu_2018_unlock_lock_v1":
    case "unlock_to_lock_v1":
    case "unlock_to_off_or_lock_v1":
      return relation === "source_aligned_adapter";
  }
}

function reviewScientificArtifactDigestClaims(
  manifest: SerializedReviewRuntimeManifest,
): Map<string, string> {
  const scientific = manifest.scientificEvidence;
  const eyes = manifest.eyesEvidence;
  if (
    scientific.protocolVersion !==
    "chronicle-runtime-scientific-evidence-summary/v2"
  ) {
    contractError(
      "reviewManifest.scientificEvidence.protocolVersion",
      "unsupported scientific evidence summary protocol",
    );
  }
  if (eyes.protocolVersion !== "chronicle-eyes-runtime-summary/v2") {
    contractError(
      "reviewManifest.eyesEvidence.protocolVersion",
      "unsupported EYES evidence summary protocol",
    );
  }
  // The kernel strips the contract-declared artifact-only request fields
  // before hashing the options identity it binds into scientific receipts.
  // Options are presence-tracked on the wire, so the computation digest
  // equals the full request digest exactly when the request carried no
  // artifact-only field; no inequality can be asserted here.

  if (
    scientific.microUseReceipt.protocolVersion !==
    "chronicle-micro-use-receipt/v2"
  ) {
    contractError(
      "reviewManifest.scientificEvidence.microUseReceipt.protocolVersion",
      "unsupported micro-use receipt protocol",
    );
  }

  if (
    scientific.minimumDurationReceipt.protocolVersion !==
    "chronicle-minimum-duration-receipt/v2"
  ) {
    contractError(
      "reviewManifest.scientificEvidence.minimumDurationReceipt.protocolVersion",
      "unsupported minimum-duration receipt protocol",
    );
  }
  if (
    scientific.concurrentSubintervalFloorReceipt.protocolVersion !==
    "chronicle-concurrent-subinterval-floor-receipt/v1"
  ) {
    contractError(
      "reviewManifest.scientificEvidence.concurrentSubintervalFloorReceipt.protocolVersion",
      "unsupported concurrent-subinterval-floor receipt protocol",
    );
  }
  if (
    scientific.zeroDurationCleanupReceipt.protocolVersion !==
    "chronicle-zero-duration-cleanup-receipt/v1"
  ) {
    contractError(
      "reviewManifest.scientificEvidence.zeroDurationCleanupReceipt.protocolVersion",
      "unsupported zero-duration cleanup receipt protocol",
    );
  }

  const minimumLineagePresent =
    scientific.minimumDurationExcludedLineageArtifactDigest !== null;
  if (
    minimumLineagePresent !==
    scientific.minimumDurationReceipt.retainedExcludedCount +
      scientific.minimumDurationReceipt.droppedCount >
      0
  ) {
    contractError(
      "reviewManifest.scientificEvidence.minimumDurationExcludedLineageArtifactDigest",
      "minimum-duration lineage digest presence disagrees with its receipt",
    );
  }
  if (
    (scientific.zeroDurationRemovedLineageArtifactDigest !== null) !==
    scientific.zeroDurationCleanupReceipt.removedRowCount > 0
  ) {
    contractError(
      "reviewManifest.scientificEvidence.zeroDurationRemovedLineageArtifactDigest",
      "zero-duration lineage digest presence disagrees with its receipt",
    );
  }
  for (const [receipt, digest, path] of [
    [
      scientific.b05ScreenConstructionReceipt,
      scientific.b05ScreenConstructionArtifactDigest,
      "b05ScreenConstructionArtifactDigest",
    ],
    [
      scientific.schoedelReconstructionReceipt,
      scientific.schoedelReconstructionArtifactDigest,
      "schoedelReconstructionArtifactDigest",
    ],
  ] as const) {
    if ((receipt === null) !== (digest === null)) {
      contractError(
        `reviewManifest.scientificEvidence.${path}`,
        "scientific receipt and artifact digest presence disagree",
      );
    }
  }
  const screenReceipt = scientific.b05ScreenConstructionReceipt;
  const schoedelReceipt = scientific.schoedelReconstructionReceipt;
  if (
    screenReceipt !== null &&
    screenReceipt.protocolVersion !== "chronicle-b05-foundational-semantics/v1"
  ) {
    contractError(
      "reviewManifest.scientificEvidence.b05ScreenConstructionReceipt.protocolVersion",
      "unsupported B05 screen-construction receipt protocol",
    );
  }
  if (
    schoedelReceipt !== null &&
    schoedelReceipt.protocolVersion !==
      "chronicle-schoedel-reconstruction-receipt/v1"
  ) {
    contractError(
      "reviewManifest.scientificEvidence.schoedelReconstructionReceipt.protocolVersion",
      "unsupported Schoedel reconstruction receipt protocol",
    );
  }
  const validationReceipt = scientific.b05SchoedelValidationReceipt;
  if (
    validationReceipt.protocolVersion !==
    "chronicle-b05-schoedel-validation-receipt/v1"
  ) {
    contractError(
      "reviewManifest.scientificEvidence.b05SchoedelValidationReceipt.protocolVersion",
      "unsupported B05/Schoedel validation receipt protocol",
    );
  }
  const validationPresenceAgrees =
    (validationReceipt.status === "not_applicable" &&
      screenReceipt === null &&
      schoedelReceipt === null) ||
    (validationReceipt.status === "screen_validated" &&
      screenReceipt !== null &&
      schoedelReceipt === null) ||
    (validationReceipt.status === "screen_and_schoedel_validated" &&
      screenReceipt !== null &&
      schoedelReceipt !== null);
  if (!validationPresenceAgrees) {
    contractError(
      "reviewManifest.scientificEvidence.b05SchoedelValidationReceipt.status",
      "B05/Schoedel validation status and artifact presence disagree",
    );
  }
  const finalized = scientific.finalizedB05Schoedel;
  if (
    finalized.protocolVersion !== "chronicle-b05-schoedel-preflight/v1" ||
    finalized.optionsDigest !== manifest.computationOptionsDigest ||
    finalized.optionsDigestOrigin !== "verified_request_jcs" ||
    finalized.requestedEpisodeStrategyId !==
      eyes.episodeReconstructionStrategy ||
    finalized.requestedScreenStrategyId !==
      validationReceipt.selectedB05StrategyId ||
    finalized.effectiveScreenStrategyId !==
      validationReceipt.selectedB05StrategyId
  ) {
    contractError(
      "reviewManifest.scientificEvidence.finalizedB05Schoedel",
      "finalized B05/Schoedel identity is invalid",
    );
  }
  const screenValidated = validationReceipt.status !== "not_applicable";
  const schoedelValidated =
    validationReceipt.status === "screen_and_schoedel_validated";
  if (
    finalized.disposition !==
      (screenValidated ? "executable" : "not_applicable") ||
    finalized.screenConstructionPhase !==
      (screenValidated ? "finalized" : "not_applicable") ||
    finalized.schoedelReconstructionPhase !==
      (schoedelValidated ? "finalized" : "not_applicable") ||
    (finalized.screenApplicability !== null) !== screenValidated ||
    (finalized.schoedelApplicability !== null) !== schoedelValidated ||
    (finalized.effectiveEpisodeStrategyId !== null) !== schoedelValidated
  ) {
    contractError(
      "reviewManifest.scientificEvidence.finalizedB05Schoedel",
      "finalized B05/Schoedel phase and validation status disagree",
    );
  }
  for (const [applicability, label] of [
    [finalized.screenApplicability, "screenApplicability"],
    [finalized.schoedelApplicability, "schoedelApplicability"],
  ] as const) {
    if (
      applicability !== null &&
      (applicability.protocolVersion !==
        "chronicle-b05-foundational-semantics/v1" ||
        applicability.executable !== true ||
        applicability.relation === "refused" ||
        applicability.refusalReason !== null ||
        applicability.refusalDetail !== null)
    ) {
      contractError(
        `reviewManifest.scientificEvidence.finalizedB05Schoedel.${label}`,
        "finalized applicability is invalid",
      );
    }
  }
  if (
    finalized.screenApplicability !== null &&
    !screenRelationMatchesStrategy(
      validationReceipt.selectedB05StrategyId,
      finalized.screenApplicability.relation,
    )
  ) {
    contractError(
      "reviewManifest.scientificEvidence.finalizedB05Schoedel.screenApplicability.relation",
      "screen applicability relation disagrees with the selected B05 strategy",
    );
  }
  if (
    finalized.schoedelApplicability !== null &&
    finalized.schoedelApplicability.relation !== "controlled_derivative"
  ) {
    contractError(
      "reviewManifest.scientificEvidence.finalizedB05Schoedel.schoedelApplicability.relation",
      "Schoedel applicability relation is not the controlled derivative",
    );
  }
  if (
    (screenReceipt !== null &&
      (screenReceipt.strategyId !== validationReceipt.selectedB05StrategyId ||
        screenReceipt.inputRowCount !==
          validationReceipt.decodedInputRowCount ||
        screenReceipt.relation !== finalized.screenApplicability?.relation ||
        !screenRelationMatchesStrategy(
          validationReceipt.selectedB05StrategyId,
          screenReceipt.relation,
        ) ||
        screenReceipt.intervalCount !==
          screenReceipt.sessionCount + screenReceipt.glanceCount ||
        screenReceipt.rightCensoredCount > screenReceipt.intervalCount)) ||
    (schoedelReceipt !== null &&
      (schoedelReceipt.strategyId !== finalized.requestedEpisodeStrategyId ||
        finalized.effectiveEpisodeStrategyId !==
          finalized.requestedEpisodeStrategyId ||
        schoedelReceipt.relation !== "controlled_derivative" ||
        schoedelReceipt.relation !==
          finalized.schoedelApplicability?.relation ||
        schoedelReceipt.inputScreenIntervalCount !==
          screenReceipt?.intervalCount ||
        schoedelReceipt.inputEventCount !==
          validationReceipt.trustedSchoedelRetainedEventCount ||
        schoedelReceipt.episodeCount !==
          schoedelReceipt.boundedEpisodeCount +
            schoedelReceipt.rightCensoredEvidenceCount ||
        schoedelReceipt.singletonZeroLengthCount >
          schoedelReceipt.boundedEpisodeCount ||
        schoedelReceipt.episodeCount !==
          validationReceipt.foundationalEpisodeCount ||
        schoedelReceipt.boundedEpisodeCount !==
          validationReceipt.foundationalBoundedEpisodeCount ||
        schoedelReceipt.rightCensoredEvidenceCount !==
          validationReceipt.foundationalUnboundedEpisodeCount)) ||
    manifest.counts.original > validationReceipt.decodedInputRowCount ||
    validationReceipt.foundationalBoundedEpisodeCount !==
      scientific.minimumDurationReceipt.boundedEpisodeCount ||
    validationReceipt.foundationalUnboundedEpisodeCount !==
      scientific.minimumDurationReceipt.unboundedEpisodeCount ||
    validationReceipt.foundationalEpisodeCount !==
      validationReceipt.foundationalBoundedEpisodeCount +
        validationReceipt.foundationalUnboundedEpisodeCount ||
    validationReceipt.minimumDurationExcludedEpisodeCount !==
      scientific.minimumDurationReceipt.retainedExcludedCount +
        scientific.minimumDurationReceipt.droppedCount ||
    validationReceipt.concurrentGeneratedSubintervalCount !==
      scientific.concurrentSubintervalFloorReceipt.generatedSubintervalCount ||
    validationReceipt.zeroDurationRemovedRowCount !==
      scientific.zeroDurationCleanupReceipt.removedRowCount ||
    (validationReceipt.trustedSchoedelRetainedEventCount !== null) !==
      schoedelValidated ||
    (!schoedelValidated &&
      validationReceipt.schoedelDecisiveParticipantCount !== 0)
  ) {
    contractError(
      "reviewManifest.scientificEvidence.b05SchoedelValidationReceipt",
      "B05/Schoedel validation receipt disagrees with finalized evidence",
    );
  }

  const eyesActive = eyes.status === "partial_replay";
  const eyesPresence = [
    eyes.taggedFauArtifactDigest,
    eyes.validationReceipt,
    eyes.validationReceiptArtifactDigest,
    scientific.eyesInputPartition,
    scientific.eyesTaggedFauValidationReceipt,
    scientific.eyesTaggedFauValidationReceiptArtifactDigest,
  ].map((value) => value !== null);
  if (
    eyesPresence.some((present) => present !== eyesActive) ||
    (eyes.episodeReconstructionStrategy === "eyes_complement") !== eyesActive
  ) {
    contractError(
      "reviewManifest.eyesEvidence",
      "EYES status, strategy, receipt, and artifact presence disagree",
    );
  }
  if (
    eyes.validationReceiptArtifactDigest !==
      scientific.eyesTaggedFauValidationReceiptArtifactDigest ||
    canonicalJson(eyes.validationReceipt) !==
      canonicalJson(scientific.eyesTaggedFauValidationReceipt)
  ) {
    contractError(
      "reviewManifest.eyesEvidence.validationReceipt",
      "EYES evidence and scientific evidence summaries disagree",
    );
  }
  if (eyesActive) {
    // The presence check above rejects an active EYES status with any
    // receipt or partition missing.
    const eyesPartition = requireDefined(scientific.eyesInputPartition, "active EYES evidence has an input partition");
    const eyesReceipt = requireDefined(eyes.validationReceipt, "active EYES evidence has a validation receipt");
    if (
      eyesPartition.protocolVersion !==
        "chronicle-eyes-input-partition-preflight/v2" ||
      eyesPartition.disposition !== "executable" ||
      eyesPartition.inputDigest !== manifest.inputDigest ||
      eyesPartition.optionsDigest !== manifest.computationOptionsDigest ||
      eyesPartition.optionsDigestOrigin !== "verified_request_jcs" ||
      eyesPartition.requestedEpisodeStrategyId !== "eyes_complement" ||
      eyesPartition.effectiveEpisodeStrategyId !== "eyes_complement" ||
      eyesPartition.relation !== "partial_replay" ||
      eyesPartition.refusalReason !== null ||
      eyesPartition.refusalDetail !== null ||
      eyesPartition.fragmentedParticipantCount !== 0
    ) {
      contractError(
        "reviewManifest.scientificEvidence.eyesInputPartition",
        "active EYES partition protocol or disposition is invalid",
      );
    }
    if (
      eyesReceipt.protocolVersion !==
        "chronicle-eyes-tagged-fau-validation-receipt/v1" ||
      eyesReceipt.status !== "validated" ||
      eyesReceipt.verifiedRawInputDigest !== manifest.inputDigest ||
      eyesReceipt.decodedInputRowCount < manifest.counts.original ||
      eyesReceipt.decodedInputRowCount !==
        validationReceipt.decodedInputRowCount ||
      eyesReceipt.requestOptionsDigest !== manifest.computationOptionsDigest ||
      eyesReceipt.optionsDigestOrigin !== "verified_request_jcs" ||
      eyesReceipt.finalPartitionResolutionDigest !==
        eyesPartition.resolutionDigest ||
      eyesReceipt.taggedFauArtifactJcsDigest !== eyes.taggedFauArtifactDigest
    ) {
      contractError(
        "reviewManifest.eyesEvidence.validationReceipt",
        "active EYES validation receipt protocol, status, or artifact digest is invalid",
      );
    }
  }

  const claims = new Map<string, string>();
  for (const [kind, field] of REVIEW_SCIENTIFIC_ARTIFACT_DIGEST_FIELDS) {
    const digest = scientific[field];
    if (digest !== null) claims.set(kind, digest);
  }
  if (eyes.taggedFauArtifactDigest !== null) {
    claims.set(EYES_TAGGED_FAU_EVIDENCE_KIND, eyes.taggedFauArtifactDigest);
  }
  if (eyes.validationReceiptArtifactDigest !== null) {
    claims.set(
      EYES_TAGGED_FAU_VALIDATION_RECEIPT_KIND,
      eyes.validationReceiptArtifactDigest,
    );
  }
  return claims;
}

function verifyReviewManifestArtifactCatalog(
  manifest: SerializedReviewRuntimeManifest,
  expectedRequestArtifactJson: ReadonlyMap<string, unknown>,
): void {
  const expectedDigests = reviewScientificArtifactDigestClaims(manifest);
  for (const kind of expectedRequestArtifactJson.keys()) {
    const metadata = manifest.artifacts.find(
      (artifact) => artifact.kind === kind,
    );
    if (!metadata)
      throw new Error(`review manifest artifact catalog is missing: ${kind}`);
    expectedDigests.set(kind, metadata.digest);
  }
  const summaryCount = manifest.artifacts.filter(
    ({ kind }) => kind === REVIEW_SUMMARY_KIND,
  ).length;
  if (summaryCount !== (manifest.reviewSummaryReused ? 0 : 1)) {
    throw new Error("review summary catalog and reuse status disagree");
  }
  if (!manifest.reviewSummaryReused) {
    expectedDigests.set(REVIEW_SUMMARY_KIND, manifest.reviewSummaryDigest);
  }
  const seenKinds = new Set<string>();
  const seenIds = new Set<string>();
  for (const metadata of manifest.artifacts) {
    if (seenKinds.has(metadata.kind)) {
      throw new Error(`duplicate review artifact kind: ${metadata.kind}`);
    }
    if (seenIds.has(metadata.artifactId)) {
      throw new Error(`duplicate review artifact id: ${metadata.artifactId}`);
    }
    seenKinds.add(metadata.kind);
    seenIds.add(metadata.artifactId);
    const expectedDigest = expectedDigests.get(metadata.kind);
    if (expectedDigest === undefined) {
      throw new Error(`unexpected review artifact kind: ${metadata.kind}`);
    }
    if (metadata.mediaType !== "application/json") {
      throw new Error(
        `review artifact media type is invalid: ${metadata.kind}`,
      );
    }
    if (metadata.size === 0) {
      throw new Error(`review artifact size is invalid: ${metadata.kind}`);
    }
    if (metadata.digest !== expectedDigest) {
      throw new Error(
        `review manifest artifact digest claim mismatch: ${metadata.kind}`,
      );
    }
  }
  // Every entry above is a unique kind that `expectedDigests` holds, so once
  // every expected kind has been seen the two sets are the same size; there is
  // no separate length rule to apply here.
  for (const kind of expectedDigests.keys()) {
    if (!seenKinds.has(kind)) {
      throw new Error(`review manifest artifact catalog is missing: ${kind}`);
    }
  }
}

/** Decode and validate the compact manifest returned by the Rust review query. */
function decodeReviewRuntimeEnvelope(
  value: unknown,
  expectedRequestArtifactJson: ReadonlyMap<string, unknown> = new Map(),
): DecodedReviewRuntimeEnvelope {
  const source = objectAt(value, "reviewManifest");
  if (source.protocolVersion !== "chronicle-preprocessing-runtime/v2") {
    contractError(
      "reviewManifest.protocolVersion",
      "unsupported protocol version",
    );
  }
  if (source.command !== "QueryReview") {
    contractError("reviewManifest.command", "expected QueryReview");
  }

  const manifest = decodeBoundaryStruct<SerializedReviewRuntimeManifest>(
    RUNTIME_BOUNDARY_MODEL,
    "ReviewRuntimeManifest",
    value,
    "reviewManifest",
  );

  if (!TIMEZONE_ACTIONS.has(manifest.timezoneAction)) {
    contractError("reviewManifest.timezoneAction", "unknown timezone action");
  }
  const queryGroups = manifest.queryGroupExecutions;
  if (
    !hasExactIdentityDomain(
      queryGroups.map(({ query_group_id }) => query_group_id),
      WORKFLOW_QUERY_GROUP_IDS,
    )
  ) {
    contractError(
      "reviewManifest.queryGroupExecutions",
      "query-group executions do not match the generated workflow registry",
    );
  }
  const queries = manifest.queryExecutions;
  if (
    !hasExactIdentityDomain(
      queries.map(({ query_id }) => query_id),
      WORKFLOW_QUERY_IDS,
    )
  ) {
    contractError(
      "reviewManifest.queryExecutions",
      "query executions do not match the generated workflow registry",
    );
  }
  const { cacheSources } = manifest;
  if (
    new Set(cacheSources).size !== cacheSources.length ||
    cacheSources.some((source) => !SUPPORTED_CACHE_SOURCES.has(source))
  ) {
    contractError(
      "reviewManifest.cacheSources",
      "unknown or duplicate cache source",
    );
  }
  verifyReviewManifestArtifactCatalog(manifest, expectedRequestArtifactJson);
  const queryIdsWithStatus = (
    status: SerializedReviewRuntimeManifest["queryExecutions"][number]["status"],
  ): string[] =>
    queries
      .filter((query) => query.status === status)
      .map(({ query_id }) => query_id);

  return {
    artifactCatalog: manifest.artifacts,
    expectedArtifactJson: new Map([
      ...expectedRequestArtifactJson,
      ...(manifest.eyesEvidence.validationReceipt === null
        ? []
        : ([
            [
              EYES_TAGGED_FAU_VALIDATION_RECEIPT_KIND,
              manifest.eyesEvidence.validationReceipt,
            ],
          ] as const)),
    ]),
    execution: {
      workspaceId: manifest.workspaceId,
      previousWorkspaceRootDigest: manifest.previousWorkspaceRootDigest,
      inputDigest: manifest.inputDigest,
      optionsDigest: manifest.optionsDigest,
      implementationDigest: manifest.implementationDigest,
      buildEnvironmentDigest: manifest.buildEnvironmentDigest,
      planDigest: manifest.planDigest,
      profileDigest: manifest.profileDigest,
      profileLockDigest: manifest.profileLockDigest,
      productContractDigest: manifest.productContractDigest,
      dependencyCertificateDigest: manifest.dependencyCertificateDigest,
      openerSetReceipt: manifest.openerSetReceipt,
      ...(manifest.maximumDurationReceipt === undefined
        ? {}
        : { maximumDurationReceipt: manifest.maximumDurationReceipt }),
      comparisonDigest: manifest.comparisonDigest,
      reviewSummaryDigest: manifest.reviewSummaryDigest,
      reviewSummaryReused: manifest.reviewSummaryReused,
      counts: manifest.counts,
      availableTimezones: manifest.availableTimezones,
      timezone: manifest.timezone,
      timezoneAction: manifest.timezoneAction as TimezoneAction,
      rowsBeforeTimezoneHandling: manifest.rowsBeforeTimezoneHandling,
      rowsAfterTimezoneHandling: manifest.rowsAfterTimezoneHandling,
      rowsRemovedByTimezone: manifest.rowsRemovedByTimezone,
      duplicateTimestampsCorrected: manifest.duplicateTimestampsCorrected,
      exactDuplicateRowsRemoved: manifest.exactDuplicateRowsRemoved,
      cacheSources: cacheSources as RustReviewExecution["cacheSources"],
      recomputedQueryIds: queryIdsWithStatus("recomputed"),
      cachedQueryIds: queryIdsWithStatus("cached"),
      bypassedQueryIds: queryIdsWithStatus("bypassed"),
      skippedQueryIds: queryIdsWithStatus("skipped"),
      errorQueryIds: queryIdsWithStatus("error"),
    },
  };
}

export function decodeReviewRuntimeManifest(
  value: unknown,
): DecodedReviewRuntimeManifest {
  return decodeReviewRuntimeEnvelope(value).execution;
}

type RuntimePhaseTracer = <T>(
  phase: string,
  operation: () => T | Promise<T>,
  counts?: { bytes?: number | (() => number); items?: number },
) => Promise<T>;

async function extractAndVerifyReviewArtifacts(
  handle: KernelHandle,
  artifactCatalog: readonly RuntimeArtifactMetadata[],
  expectedArtifactJson: ReadonlyMap<string, unknown>,
  traced: RuntimePhaseTracer,
): Promise<Uint8Array | undefined> {
  if (handle.artifact_count !== artifactCatalog.length) {
    throw new Error("review manifest/handle artifact count mismatch");
  }
  const manifestMetadataByKind = new Map(
    artifactCatalog.map((metadata) => [metadata.kind, metadata]),
  );
  const handleMetadata: Array<{
    index: number;
    metadata: RuntimeArtifactMetadata;
  }> = [];
  const handleKinds = new Set<string>();
  const handleIds = new Set<string>();
  for (let index = 0; index < handle.artifact_count; index += 1) {
    let metadataValue: unknown;
    try {
      metadataValue = JSON.parse(handle.artifact_metadata_json(index));
    } catch (error) {
      throw new Error(
        `review artifact metadata is not valid JSON at index ${index}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const metadata = artifactMetadataAt(
      metadataValue,
      `reviewArtifactMetadata[${index}]`,
    );
    if (handleKinds.has(metadata.kind)) {
      throw new Error(
        `duplicate review handle artifact kind: ${metadata.kind}`,
      );
    }
    if (handleIds.has(metadata.artifactId)) {
      throw new Error(
        `duplicate review handle artifact id: ${metadata.artifactId}`,
      );
    }
    handleKinds.add(metadata.kind);
    handleIds.add(metadata.artifactId);
    if (metadata.mediaType !== "application/json") {
      throw new Error(
        `review handle artifact media type is invalid: ${metadata.kind}`,
      );
    }
    const catalogMetadata = manifestMetadataByKind.get(metadata.kind);
    if (
      !catalogMetadata ||
      canonicalJson(catalogMetadata) !== canonicalJson(metadata)
    ) {
      throw new Error(
        `review manifest/handle artifact catalog mismatch: ${metadata.kind}`,
      );
    }
    handleMetadata.push({ index, metadata });
  }

  let reviewSummaryJsonBytes: Uint8Array | undefined;
  try {
    for (const { index, metadata } of handleMetadata) {
      let bytes: Uint8Array | undefined;
      let retainBytes = false;
      try {
        await traced(
          "artifact-extract",
          () => {
            bytes = handle.take_artifact_bytes(index);
          },
          { bytes: metadata.size, items: 1 },
        );
        if (!(bytes instanceof Uint8Array)) {
          throw new Error(
            `review artifact did not expose a byte buffer: ${metadata.kind}`,
          );
        }
        const extracted = bytes;
        await traced(
          "artifact-integrity",
          async () => {
            if (
              metadata.size !== extracted.byteLength ||
              metadata.digest !== `sha256:${await sha256Hex(extracted)}`
            ) {
              throw new Error(
                `review artifact integrity mismatch: ${metadata.kind}`,
              );
            }
          },
          { bytes: bytes.byteLength, items: 1 },
        );
        const expectedJson = expectedArtifactJson.get(metadata.kind);
        if (expectedJson !== undefined) {
          const expectedBytes = new TextEncoder().encode(
            canonicalReviewReceiptJson(expectedJson),
          );
          if (
            bytes.byteLength !== expectedBytes.byteLength ||
            bytes.some((byte, index) => byte !== expectedBytes[index])
          ) {
            throw new Error(
              `review artifact bytes disagree with canonical manifest receipt: ${metadata.kind}`,
            );
          }
        }
        if (metadata.kind === REVIEW_SUMMARY_KIND) {
          reviewSummaryJsonBytes = bytes;
          retainBytes = true;
        }
      } finally {
        // A handle that hands back something other than a byte buffer is
        // refused above; wiping it here would replace that refusal with a
        // TypeError from the cleanup.
        if (bytes instanceof Uint8Array && !retainBytes) bytes.fill(0);
      }
    }
    return reviewSummaryJsonBytes;
  } catch (error) {
    reviewSummaryJsonBytes?.fill(0);
    throw error;
  }
}

function canonicalReviewReceiptJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new Error("review manifest receipt is not JSON-serializable");
    }
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalReviewReceiptJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([, entry]) => entry === undefined)) {
    throw new Error("review manifest receipt contains an undefined field");
  }
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(
      ([key, entry]) =>
        `${JSON.stringify(key)}:${canonicalReviewReceiptJson(entry)}`,
    )
    .join(",")}}`;
}

let initPromise: Promise<KernelModule> | null = null;

type CachedRuntimeSupportFiles = {
  handle: RuntimeSupportFilesHandle;
  activeUsers: number;
  invalid: boolean;
};

function runtimeMethodProfileReceipts(runtime: BrowserProcessingRuntime) {
  return runtime.methodProfileReceipts?.length
    ? runtime.methodProfileReceipts
    : runtime.methodProfileReceipt
      ? [runtime.methodProfileReceipt]
      : [];
}

function methodProfileReviewArtifactJson(
  runtime: BrowserProcessingRuntime,
): ReadonlyMap<string, unknown> {
  const receipts = runtimeMethodProfileReceipts(runtime).map((receipt) => ({
    ...receipt,
    inputBindings: receipt.inputBindings ?? [],
    documentaryBindings: receipt.documentaryBindings ?? [],
    outputBindings: receipt.outputBindings ?? [],
  }));
  if (!receipts.length) return new Map();
  if (receipts.length === 1) {
    return new Map([["method-profile-receipt-json", receipts[0]]]);
  }
  return new Map([
    [
      "method-profile-receipts-json",
      [...receipts].sort(
        (left, right) =>
          Number(left.diaryReplicationBinding !== undefined) -
          Number(right.diaryReplicationBinding !== undefined),
      ),
    ],
  ]);
}

const runtimeSupportFilesCache = new Map<string, CachedRuntimeSupportFiles>();
const MAX_RUNTIME_SUPPORT_BUNDLES = 2;

function runtimeSupportFilesCacheKey(
  verifiedBundleKey: string,
  options: BrowserProcessingOptions,
  runtime: BrowserProcessingRuntime,
): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(verifiedBundleKey)) {
    throw new Error("verified support cache key is invalid");
  }
  const enabledRoles = [
    options.useFilterFile,
    options.useAppsForcingScreenOpenFile,
    options.useBackgroundAppsFile,
    options.useAppCodebook,
    options.enableStudyWindowFilter || options.enableDayCoverage,
    options.enablePersonAttribution,
    usesInputCapabilityEvidence(options) ||
      methodReceiptUsesInputCapabilityEvidence(
        runtimeMethodProfileReceipts(runtime).flatMap(
          (receipt) => receipt.settingIds,
        ),
      ),
  ]
    .map((enabled) => (enabled ? "1" : "0"))
    .join("");
  return `${verifiedBundleKey}:${enabledRoles}`;
}

function inputCapabilityEvidenceIngress(
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
): { bytes: Uint8Array; name: string } {
  const supportFile =
    usesInputCapabilityEvidence(options) ||
    methodReceiptUsesInputCapabilityEvidence(
      runtimeMethodProfileReceipts(runtime).flatMap(
        (receipt) => receipt.settingIds,
      ),
    )
      ? supportFiles?.inputCapabilityEvidenceFile
      : undefined;
  if (supportFile) validateInputCapabilityEvidenceFile(supportFile);
  return {
    bytes: fileBytes(supportFile),
    name: supportFile?.name ?? "input_capability_evidence.csv",
  };
}

function pruneRuntimeSupportFilesCache(): void {
  while (runtimeSupportFilesCache.size > MAX_RUNTIME_SUPPORT_BUNDLES) {
    const candidate = [...runtimeSupportFilesCache.entries()].find(
      ([, entry]) => entry.activeUsers === 0,
    );
    if (!candidate) return;
    const [key, entry] = candidate;
    runtimeSupportFilesCache.delete(key);
    try {
      entry.handle.free();
    } catch {
      // The entry is already unreachable; cleanup cannot affect correctness.
    }
  }
}

function releaseRuntimeSupportFilesCacheEntry(
  key: string,
  entry: CachedRuntimeSupportFiles,
): void {
  entry.activeUsers = Math.max(0, entry.activeUsers - 1);
  if (entry.invalid && entry.activeUsers === 0) {
    if (runtimeSupportFilesCache.get(key) === entry) {
      runtimeSupportFilesCache.delete(key);
    }
    try {
      entry.handle.free();
    } catch {
      // Preserve the primary execution error.
    }
  }
  pruneRuntimeSupportFilesCache();
}

function clearRuntimeSupportFilesCache(): void {
  for (const entry of runtimeSupportFilesCache.values()) {
    entry.invalid = true;
    if (entry.activeUsers === 0) {
      try {
        entry.handle.free();
      } catch {
        // Runtime replacement remains fail-safe.
      }
    }
  }
  runtimeSupportFilesCache.clear();
}

// The Rust worker retains exactly one live Salsa database. Keep the matching
// root token here when OPFS persistence is disabled so repeated calls still
// continue that database instead of accidentally forcing a cold reset.
let ephemeralContinuation:
  { workspaceId: string; workspaceRootDigest: string } | undefined;

// These encoded-size limits mirror the Rust runtime's pre-decode limits. OPFS
// checks them before File.arrayBuffer() so a bad closure cannot allocate an
// oversized cache merely to have Rust reject it afterward.
const MAX_REVIEW_BASE_ENCODED_BYTES = 64 * 1024 * 1024;
const MAX_RECONSTRUCTION_BASE_ENCODED_BYTES = 96 * 1024 * 1024;
const MAX_COMBINED_PERSISTED_BASE_ENCODED_BYTES = 128 * 1024 * 1024;
// Large checkpoints are decoded and retained by the current Rust workspace.
// Keeping the same encoded bytes alive in JavaScript doubles worker memory
// without helping the warm path; retain only small checkpoints that are cheap
// enough to benefit a later OPFS miss after the Rust workspace is evicted.
const MAX_SELECTED_PERSISTED_BASE_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_PROCESSING_OPTIONS_BYTES = 1024 * 1024;

function persistedBaseProbeSizes(kernel: KernelModule): {
  review: number;
  reconstruction: number;
} {
  const spec = objectAt(
    JSON.parse(kernel.review_base_probe_spec_json()),
    "reviewBaseProbeSpec",
  );
  const reviewProbeBytes = integerAt(
    spec.reviewBaseBytes,
    "reviewBaseProbeSpec.reviewBaseBytes",
  );
  const reconstructionProbeBytes = integerAt(
    spec.reconstructionBaseBytes,
    "reviewBaseProbeSpec.reconstructionBaseBytes",
  );
  return { review: reviewProbeBytes, reconstruction: reconstructionProbeBytes };
}

export type RustPersistenceAdapter = {
  openRoot(workspaceId: string): Promise<FileSystemDirectoryHandle>;
  recover(
    root: FileSystemDirectoryHandle,
  ): Promise<WorkspaceRootSlot | undefined>;
  recoverHead?(
    root: FileSystemDirectoryHandle,
  ): Promise<WorkspaceRootSlot | undefined>;
  verify?(
    root: FileSystemDirectoryHandle,
    slot: WorkspaceRootSlot,
    kernel: KernelModule,
    workspaceId: string,
    /** Accept a head committed by an earlier runtime build (see the call site). */
    acceptEarlierRuntimeHead?: boolean,
  ): Promise<void>;
  persist(
    root: FileSystemDirectoryHandle,
    input: {
      workspaceRootDigest: string;
      previousWorkspaceRootDigest: string | null;
      artifacts: PersistedRuntimeArtifact[];
      recoveredSlot?: WorkspaceRootSlot;
    },
  ): Promise<WorkspaceRootSlot>;
};

type PersistedArtifactDescriptor = { digest: string; size: number };

async function readArtifactsFromWorkspaceSlot(
  root: FileSystemDirectoryHandle,
  slot: WorkspaceRootSlot,
  kinds: readonly string[],
  expected?: {
    implementationDigest?: string;
    buildEnvironmentDigest?: string;
    workspaceId?: string;
    inputDigest?: string;
  },
  prefixBytesByKind?: Readonly<Record<string, number>>,
  descriptorSink?: Map<string, PersistedArtifactDescriptor>,
): Promise<Map<string, Uint8Array>> {
  const rootBytes = await readRuntimeObject(root, slot.workspaceRootDigest);
  const rootCommit = JSON.parse(new TextDecoder().decode(rootBytes)) as {
    artifactClosureDigest: string;
    implementationDigest: string;
    buildEnvironmentDigest: string;
    workspaceId: string;
    inputDigest: string;
  };
  if (
    (expected?.implementationDigest !== undefined &&
      rootCommit.implementationDigest !== expected.implementationDigest) ||
    (expected?.buildEnvironmentDigest !== undefined &&
      rootCommit.buildEnvironmentDigest !== expected.buildEnvironmentDigest) ||
    (expected?.workspaceId !== undefined &&
      rootCommit.workspaceId !== expected.workspaceId) ||
    (expected?.inputDigest !== undefined &&
      rootCommit.inputDigest !== expected.inputDigest)
  ) {
    throw new Error("persisted Rust workspace identity mismatch");
  }
  const closureBytes = await readRuntimeObject(
    root,
    rootCommit.artifactClosureDigest,
  );
  const closure = JSON.parse(new TextDecoder().decode(closureBytes)) as {
    implementationDigest: string;
    buildEnvironmentDigest: string;
    workspaceId: string;
    inputDigest: string;
    artifacts: Array<{ kind: string; digest: string; size: number }>;
  };
  if (
    closure.implementationDigest !== rootCommit.implementationDigest ||
    closure.buildEnvironmentDigest !== rootCommit.buildEnvironmentDigest ||
    closure.workspaceId !== rootCommit.workspaceId ||
    closure.inputDigest !== rootCommit.inputDigest
  ) {
    throw new Error("persisted Rust artifact closure identity mismatch");
  }
  const selected = kinds.flatMap((kind) => {
    const artifact = closure.artifacts.find(
      (candidate) => candidate.kind === kind,
    );
    const limit =
      kind === "review-base"
        ? MAX_REVIEW_BASE_ENCODED_BYTES
        : kind === "reconstruction-base"
          ? MAX_RECONSTRUCTION_BASE_ENCODED_BYTES
          : kind === "processing-options-json"
            ? MAX_PROCESSING_OPTIONS_BYTES
            : undefined;
    return artifact ? [{ kind, artifact, limit }] : [];
  });
  let combinedBaseBytes = 0;
  for (const { kind, artifact, limit } of selected) {
    if (!Number.isSafeInteger(artifact.size) || artifact.size < 0) {
      throw new Error(`persisted Rust artifact size is invalid: ${kind}`);
    }
    if (limit !== undefined && artifact.size > limit) {
      throw new Error(`persisted Rust artifact exceeds size limit: ${kind}`);
    }
    if (kind === "review-base" || kind === "reconstruction-base") {
      combinedBaseBytes += artifact.size;
    }
  }
  if (combinedBaseBytes > MAX_COMBINED_PERSISTED_BASE_ENCODED_BYTES) {
    throw new Error("combined persisted Rust bases exceed size limit");
  }
  for (const { kind, artifact } of selected) {
    descriptorSink?.set(kind, {
      digest: artifact.digest,
      size: artifact.size,
    });
  }
  const entries = await Promise.all(
    selected.map(async ({ kind, artifact, limit }) => {
      const prefixBytes = prefixBytesByKind?.[kind];
      const bytes =
        prefixBytes === undefined
          ? await readRuntimeObject(root, artifact.digest, limit)
          : await readRuntimeObjectPrefix(
              root,
              artifact.digest,
              artifact.size,
              prefixBytes,
              limit,
            );
      return { kind, artifact, bytes };
    }),
  );
  const requested = new Map<string, Uint8Array>();
  for (const { kind, artifact, bytes } of entries) {
    // readRuntimeObject already verifies the content digest. Keep the closure's
    // declared-size check here without hashing every multi-megabyte base twice.
    const expectedBytes =
      prefixBytesByKind?.[kind] === undefined
        ? artifact.size
        : Math.min(prefixBytesByKind[kind], artifact.size);
    if (bytes.byteLength !== expectedBytes) {
      throw new Error(`persisted Rust artifact integrity mismatch: ${kind}`);
    }
    requested.set(kind, bytes);
  }
  return requested;
}

export async function readPersistedRustReviewBases(
  root: FileSystemDirectoryHandle,
  slot: WorkspaceRootSlot,
  expected: {
    implementationDigest: string;
    buildEnvironmentDigest: string;
    workspaceId: string;
    inputDigest: string;
  },
): Promise<{
  reviewBaseBytes: Uint8Array;
  reconstructionBaseBytes: Uint8Array;
  datetimeOfPreprocessing?: string;
}> {
  const artifacts = await readArtifactsFromWorkspaceSlot(
    root,
    slot,
    ["review-base", "reconstruction-base", "processing-options-json"],
    expected,
  );
  const reviewBaseBytes = artifacts.get("review-base") ?? new Uint8Array();
  const reconstructionBaseBytes =
    artifacts.get("reconstruction-base") ?? new Uint8Array();
  const optionsBytes = artifacts.get("processing-options-json");
  let datetimeOfPreprocessing: string | undefined;
  if (optionsBytes) {
    const options = objectAt(
      JSON.parse(new TextDecoder().decode(optionsBytes)),
      "persistedProcessingOptions",
    );
    datetimeOfPreprocessing = stringAt(
      options.datetime_of_preprocessing,
      "persistedProcessingOptions.datetime_of_preprocessing",
    );
    if (!datetimeOfPreprocessing.trim()) {
      contractError(
        "persistedProcessingOptions.datetime_of_preprocessing",
        "expected a non-empty timestamp",
      );
    }
  } else if (
    reviewBaseBytes.byteLength > 0 ||
    reconstructionBaseBytes.byteLength > 0
  ) {
    throw new Error(
      "persisted Rust review bases are missing their processing options",
    );
  }
  return {
    reviewBaseBytes,
    reconstructionBaseBytes,
    datetimeOfPreprocessing,
  };
}

type PersistedReviewExpectedIdentity = {
  implementationDigest: string;
  buildEnvironmentDigest: string;
  workspaceId: string;
  inputDigest: string;
};

type PersistedRustReviewProbes = {
  reviewProbe: Uint8Array;
  reconstructionProbe: Uint8Array;
  datetimeOfPreprocessing?: string;
  descriptors: Map<string, PersistedArtifactDescriptor>;
};

type PersistedReviewBaseKind = "review-base" | "reconstruction-base";

function persistedReviewCacheKey(
  slot: WorkspaceRootSlot,
  expected: PersistedReviewExpectedIdentity,
): string {
  return [
    slot.workspaceRootDigest,
    expected.implementationDigest,
    expected.buildEnvironmentDigest,
    expected.workspaceId,
    expected.inputDigest,
  ].join("\u0000");
}

async function readPersistedRustReviewProbes(
  kernel: KernelModule,
  root: FileSystemDirectoryHandle,
  slot: WorkspaceRootSlot,
  expected: PersistedReviewExpectedIdentity,
): Promise<PersistedRustReviewProbes> {
  const sizes = persistedBaseProbeSizes(kernel);
  const descriptors = new Map<string, PersistedArtifactDescriptor>();
  const artifacts = await readArtifactsFromWorkspaceSlot(
    root,
    slot,
    ["review-base", "reconstruction-base", "processing-options-json"],
    expected,
    {
      "review-base": sizes.review,
      "reconstruction-base": sizes.reconstruction,
    },
    descriptors,
  );
  const reviewProbe = artifacts.get("review-base") ?? new Uint8Array();
  const reconstructionProbe =
    artifacts.get("reconstruction-base") ?? new Uint8Array();
  if (
    (reviewProbe.byteLength > 0 && reviewProbe.byteLength !== sizes.review) ||
    (reconstructionProbe.byteLength > 0 &&
      reconstructionProbe.byteLength !== sizes.reconstruction)
  ) {
    throw new Error("persisted Rust review base is shorter than its probe");
  }
  const optionsBytes = artifacts.get("processing-options-json");
  let datetimeOfPreprocessing: string | undefined;
  if (optionsBytes) {
    const options = objectAt(
      JSON.parse(new TextDecoder().decode(optionsBytes)),
      "persistedProcessingOptions",
    );
    datetimeOfPreprocessing = stringAt(
      options.datetime_of_preprocessing,
      "persistedProcessingOptions.datetime_of_preprocessing",
    );
    if (!datetimeOfPreprocessing.trim()) {
      contractError(
        "persistedProcessingOptions.datetime_of_preprocessing",
        "expected a non-empty timestamp",
      );
    }
  } else if (reviewProbe.byteLength || reconstructionProbe.byteLength) {
    throw new Error(
      "persisted Rust review bases are missing their processing options",
    );
  }
  return {
    reviewProbe,
    reconstructionProbe,
    datetimeOfPreprocessing,
    descriptors,
  };
}

let persistedRustReviewProbesCache:
  { key: string; value: PersistedRustReviewProbes } | undefined;
let persistedRustSelectedReviewBaseCache:
  { key: string; value: Uint8Array } | undefined;

async function readCachedPersistedRustReviewProbes(
  kernel: KernelModule,
  root: FileSystemDirectoryHandle,
  slot: WorkspaceRootSlot,
  expected: PersistedReviewExpectedIdentity,
): Promise<PersistedRustReviewProbes> {
  const key = persistedReviewCacheKey(slot, expected);
  if (persistedRustReviewProbesCache?.key === key) {
    return persistedRustReviewProbesCache.value;
  }
  const value = await readPersistedRustReviewProbes(
    kernel,
    root,
    slot,
    expected,
  );
  persistedRustReviewProbesCache = { key, value };
  return value;
}

async function readCachedSelectedPersistedRustReviewBase(
  root: FileSystemDirectoryHandle,
  slot: WorkspaceRootSlot,
  expected: PersistedReviewExpectedIdentity,
  kind: PersistedReviewBaseKind,
  descriptor: PersistedArtifactDescriptor,
): Promise<Uint8Array> {
  const key = `${persistedReviewCacheKey(slot, expected)}\u0000${kind}`;
  if (persistedRustSelectedReviewBaseCache?.key === key) {
    return persistedRustSelectedReviewBaseCache.value;
  }
  const limit =
    kind === "review-base"
      ? MAX_REVIEW_BASE_ENCODED_BYTES
      : MAX_RECONSTRUCTION_BASE_ENCODED_BYTES;
  const value = await readRuntimeObject(root, descriptor.digest, limit);
  if (value.byteLength !== descriptor.size) {
    throw new Error(`persisted Rust artifact integrity mismatch: ${kind}`);
  }
  persistedRustSelectedReviewBaseCache =
    value.byteLength <= MAX_SELECTED_PERSISTED_BASE_CACHE_BYTES
      ? { key, value }
      : undefined;
  return value;
}

const defaultPersistenceAdapter: RustPersistenceAdapter = {
  openRoot: openOpfsWorkspace,
  recover: recoverRuntimeWorkspace,
  recoverHead: recoverRuntimeWorkspaceHead,
  async verify(root, slot, kernel, workspaceId, acceptEarlierRuntimeHead) {
    const rootBytes = await readRuntimeObject(root, slot.workspaceRootDigest);
    const history = await collectRuntimeVerifiedHistory(
      root,
      slot.workspaceRootDigest,
    );
    if (
      history.headDirectDigests.some(
        (digest) => !slot.artifactDigests.includes(digest),
      ) ||
      slot.artifactDigests.some(
        (digest) => !history.verifiedSizes.has(digest),
      )
    ) {
      throw new Error("workspace slot does not match its committed head root");
    }
    await verifyRootClosure(
      rootBytes,
      (digest) => readRuntimeObject(root, digest),
      history.digests,
      slot.previousWorkspaceRootDigest,
      kernel,
      workspaceId,
      slot.workspaceRootDigest,
      true,
      history.verifiedSizes,
      acceptEarlierRuntimeHead,
    );
  },
  persist: persistRuntimeWorkspace,
};

async function verifyRootClosure(
  rootBytes: Uint8Array,
  object: (digest: string) => Promise<Uint8Array> | Uint8Array,
  retainedDigests: readonly string[],
  expectedPreviousRoot: string | null,
  kernel: KernelModule,
  expectedWorkspaceId: string,
  expectedWorkspaceRootDigest: string,
  verifyHistory = true,
  verifiedObjectSizes?: ReadonlyMap<string, number>,
  acceptEarlierRuntimeHead = false,
): Promise<void> {
  try {
    if (objectAt(JSON.parse(new TextDecoder().decode(rootBytes)), "root").protocolVersion === "chronicle-literature-component-root/v1") {
      const retained = new Set(retainedDigests.map((digest) => digestAt(digest, "retainedDigest")));
      if (retained.size !== retainedDigests.length) throw new Error("component history has duplicate retained objects");
      const allowed = new Set<string>();
      const seen = new Set<string>();
      const read = async (digest: string): Promise<Uint8Array> => {
        digestAt(digest, "component object digest");
        const bytes = digest === expectedWorkspaceRootDigest ? Uint8Array.from(rootBytes) : await object(digest);
        if (`sha256:${await sha256Hex(bytes)}` !== digest) {
          bytes.fill(0);
          throw new Error("component history object digest mismatch");
        }
        allowed.add(digest);
        return bytes;
      };
      let current: string | null = expectedWorkspaceRootDigest;
      while (current !== null) {
        if (seen.has(current) || seen.size >= 10_000) throw new Error("component history is cyclic or too large");
        seen.add(current);
        const bytes = await read(current);
        try {
          const commit = objectAt(JSON.parse(new TextDecoder().decode(bytes)), "component history root");
          const registration = literatureComponentExecutionForSettings(stringListAt(commit.settingIds, "component history settings"));
          if (!registration) throw new Error("component history has no exact registered method");
          const previous = nullableDigestAt(commit.previousWorkspaceRootDigest, "component history previous root");
          if (current === expectedWorkspaceRootDigest) {
            if (previous !== expectedPreviousRoot) throw new Error("component history head identity mismatch");
            const identity = objectAt(kernel.runtime_identity(), "runtime identity");
            if (commit.implementationDigest !== identity.implementationDigest || commit.buildEnvironmentDigest !== identity.buildEnvironmentDigest) {
              throw new Error("component history head was produced by a different runtime identity");
            }
          }
          await verifyLiteratureComponentRoot(bytes, read, registration, {
            workspaceId: expectedWorkspaceId,
            workspaceRootDigest: current,
            previousWorkspaceRootDigest: previous,
            inputDigest: digestAt(commit.inputDigest, "component history input"),
          });
          current = verifyHistory ? previous : null;
        } finally {
          bytes.fill(0);
        }
      }
      if (allowed.size !== retained.size || [...allowed].some((digest) => !retained.has(digest))) {
        throw new Error("component history has missing or unbound objects");
      }
      return;
    }
    const currentIdentity = objectAt(kernel.runtime_identity(), "runtimeIdentity");
    const identityFields = [
      "implementationDigest",
      "buildEnvironmentDigest",
      "productContractDigest",
      "planDigest",
      "profileDigest",
      "profileLockDigest",
      "runtimeAuthorityDigest",
      "dependencyCertificateDigest",
    ] as const;
    if (
      currentIdentity.protocolVersion !== "chronicle-preprocessing-runtime/v2"
    ) {
      throw new Error("loaded runtime identity protocol is invalid");
    }
    for (const field of identityFields)
      digestAt(currentIdentity[field], `runtimeIdentity.${field}`);
    const workflowContract = objectAt(
      JSON.parse(kernel.workflow_contract_json()),
      "workflowContract",
    );
    if (workflowContract.protocolVersion !== "chronicle-workflow-contract/v1") {
      throw new Error("loaded workflow contract protocol is invalid");
    }
    const workflowModelVersion = stringAt(
      workflowContract.workflowModelVersion,
      "workflowContract.workflowModelVersion",
    );
    const workflowContractDigests = workflowContractDigestsAt(
      workflowContract.digests,
      "workflowContract.digests",
    );
    const requiredViews = new Map([
      [
        "chronicle-workflow-explorer/v1",
        {
          artifactKind: "workflow-explorer-view-json",
          schemaId: "urn:chronicle:view:workflow-explorer:v1",
        },
      ],
      [
        "chronicle.artifact.v1",
        {
          artifactKind: "artifact-view-json",
          schemaId: "urn:chronicle:view:artifact:v1",
        },
      ],
      [
        "chronicle.obligation.v1",
        {
          artifactKind: "obligation-view-json",
          schemaId: "urn:chronicle:view:obligation:v1",
        },
      ],
      [
        "chronicle.explanation.v1",
        {
          artifactKind: "explanation-view-json",
          schemaId: "urn:chronicle:view:explanation:v1",
        },
      ],
    ]);
    const retained = new Set(
      retainedDigests.map((digest) => digestAt(digest, "retainedDigest")),
    );
    if (
      retained.size !== retainedDigests.length ||
      !retained.has(expectedWorkspaceRootDigest)
    ) {
      throw new Error("recovered workspace retained-object table is invalid");
    }
    let rootBytesAvailable = true;
    const withObjectBytes = async <T>(
      digest: string,
      consume: (bytes: Uint8Array) => T | Promise<T>,
    ): Promise<T> => {
      digestAt(digest, "objectDigest");
      const bytes =
        digest === expectedWorkspaceRootDigest && rootBytesAvailable
          ? rootBytes
          : await object(digest);
      if (bytes === rootBytes) rootBytesAvailable = false;
      try {
        return await consume(bytes);
      } finally {
        bytes.fill(0);
      }
    };
    const decodeObject = <T extends Record<string, unknown>>(
      bytes: Uint8Array,
    ): T => JSON.parse(new TextDecoder().decode(bytes)) as T;
    type Root = {
      protocolVersion: string;
      workflowModelVersion: string;
      workflowCompatibilityDigest: string;
      command: string;
      implementationDigest: string;
      buildEnvironmentDigest: string;
      productContractDigest: string;
      planDigest: string;
      profileDigest: string;
      profileLockDigest: string;
      runtimeAuthorityDigest: string;
      dependencyCertificateDigest: string;
      dependencyCacheMode: "certified_narrow" | "conservative_full";
      workspaceId: string;
      previousWorkspaceRootDigest: string | null;
      inputDigest: string;
      optionsDigest: string;
      assignmentDigests: Record<string, string>;
      artifactDigests: string[];
      executionStateDigest: string;
      requiredViews: Array<{
        artifactKind: string;
        viewId: string;
        schemaId: string;
        artifactDigest: string;
      }>;
      journalDigest: string;
      artifactClosureDigest: string;
    };
    const decodeRoot = (bytes: Uint8Array): Root => {
      const root = JSON.parse(new TextDecoder().decode(bytes)) as Root;
      if (
        root.protocolVersion !== "chronicle-preprocessing-runtime/v2" ||
        root.command !== "ExecuteWorkspace" ||
        !["certified_narrow", "conservative_full"].includes(
          root.dependencyCacheMode,
        ) ||
        !Array.isArray(root.artifactDigests) ||
        new Set(root.artifactDigests).size !== root.artifactDigests.length ||
        !Array.isArray(root.requiredViews) ||
        root.requiredViews.length !== requiredViews.size ||
        !root.assignmentDigests ||
        typeof root.assignmentDigests !== "object" ||
        Array.isArray(root.assignmentDigests)
      ) {
        throw new Error("recovered workspace root contract is invalid");
      }
      digestAt(
        root.workflowCompatibilityDigest,
        "root.workflowCompatibilityDigest",
      );
      for (const digest of [
        root.implementationDigest,
        root.buildEnvironmentDigest,
        root.productContractDigest,
        root.planDigest,
        root.profileDigest,
        root.profileLockDigest,
        root.runtimeAuthorityDigest,
        root.dependencyCertificateDigest,
        root.workspaceId,
        root.inputDigest,
        root.optionsDigest,
        root.executionStateDigest,
        root.journalDigest,
        root.artifactClosureDigest,
        ...root.artifactDigests,
        ...Object.values(root.assignmentDigests),
      ])
        digestAt(digest, "root digest");
      stringAt(root.workflowModelVersion, "root.workflowModelVersion");
      if (root.previousWorkspaceRootDigest !== null) {
        digestAt(
          root.previousWorkspaceRootDigest,
          "root.previousWorkspaceRootDigest",
        );
      }
      return root;
    };

    const allowed = new Set<string>();
    const seenRoots = new Set<string>();
    let rootDigest: string | null = expectedWorkspaceRootDigest;
    let head = true;
    while (rootDigest !== null) {
      if (seenRoots.has(rootDigest) || seenRoots.size >= 10_000) {
        throw new Error("recovered workspace history is cyclic or too large");
      }
      seenRoots.add(rootDigest);
      const commit: Root = await withObjectBytes(rootDigest, (bytes) =>
        decodeRoot(bytes),
      );
      if (
        commit.workflowModelVersion !== workflowModelVersion ||
        commit.workflowCompatibilityDigest !==
          workflowContractDigests.workspaceCompatibility
      ) {
        throw new Error("recovered workspace workflow identity is invalid");
      }
      if (
        head &&
        !acceptEarlierRuntimeHead &&
        identityFields.some((field) => commit[field] !== currentIdentity[field])
      ) {
        throw new Error(
          "recovered workspace head was produced by a different runtime identity",
        );
      }
      if (
        commit.workspaceId !== expectedWorkspaceId ||
        (head && commit.previousWorkspaceRootDigest !== expectedPreviousRoot)
      ) {
        throw new Error("recovered workspace root identity is invalid");
      }
      head = false;
      const assignmentDigests = Object.values(commit.assignmentDigests);
      for (const digest of [
        rootDigest,
        commit.inputDigest,
        commit.optionsDigest,
        ...assignmentDigests,
        ...commit.artifactDigests,
      ])
        allowed.add(digest);
      if (
        !commit.artifactDigests.includes(commit.dependencyCertificateDigest) ||
        !commit.artifactDigests.includes(commit.executionStateDigest) ||
        !commit.artifactDigests.includes(commit.journalDigest) ||
        !commit.artifactDigests.includes(commit.artifactClosureDigest)
      ) {
        throw new Error("recovered workspace root omits a required artifact");
      }

      const bindings = new Map<string, Root["requiredViews"][number]>();
      for (const binding of commit.requiredViews) {
        const expected = requiredViews.get(binding.viewId);
        digestAt(binding.artifactDigest, "root.requiredViews.artifactDigest");
        if (
          !expected ||
          bindings.has(binding.viewId) ||
          binding.artifactKind !== expected.artifactKind ||
          binding.schemaId !== expected.schemaId ||
          !commit.artifactDigests.includes(binding.artifactDigest)
        ) {
          throw new Error("recovered workspace view binding is invalid");
        }
        bindings.set(binding.viewId, binding);
      }
      const state = await withObjectBytes(
        commit.executionStateDigest,
        decodeObject<Record<string, unknown>>,
      );
      const stateArtifacts = arrayAt(
        state.computationalArtifactDigests,
        "executionState.computationalArtifactDigests",
      ).map((digest, index) =>
        digestAt(digest, `executionState.artifacts[${index}]`),
      );
      const expectedStateArtifacts = commit.artifactDigests.filter(
        (digest) =>
          digest !== commit.executionStateDigest &&
          digest !== commit.artifactClosureDigest &&
          ![...bindings.values()].some(
            (binding) => binding.artifactDigest === digest,
          ),
      );
      if (
        state.protocolVersion !== "chronicle-execution-state/v1" ||
        state.workspaceId !== commit.workspaceId ||
        state.previousWorkspaceRootDigest !==
          commit.previousWorkspaceRootDigest ||
        state.inputDigest !== commit.inputDigest ||
        state.optionsDigest !== commit.optionsDigest ||
        canonicalJson(state.assignmentDigests) !==
          canonicalJson(commit.assignmentDigests) ||
        state.journalDigest !== commit.journalDigest ||
        state.dependencyCacheMode !== commit.dependencyCacheMode ||
        canonicalJson([...stateArtifacts].sort()) !==
          canonicalJson([...expectedStateArtifacts].sort())
      ) {
        throw new Error("recovered execution state is invalid");
      }
      for (const field of [
        "implementationDigest",
        "buildEnvironmentDigest",
        "productContractDigest",
        "planDigest",
        "profileDigest",
        "profileLockDigest",
        "runtimeAuthorityDigest",
        "dependencyCertificateDigest",
      ] as const) {
        if (state[field] !== commit[field]) {
          throw new Error(
            `recovered execution state identity mismatch: ${field}`,
          );
        }
      }

      await withObjectBytes(commit.journalDigest, (bytes) =>
        kernel.verify_evidence_journal_cbor(bytes),
      );
      const closure = await withObjectBytes(
        commit.artifactClosureDigest,
        decodeObject<Record<string, unknown>>,
      );
      const closureArtifacts = arrayAt(
        closure.artifacts,
        "closure.artifacts",
      ).map((value, index) =>
        artifactMetadataAt(value, `closure.artifacts[${index}]`),
      );
      const closureKinds = closureArtifacts.map(({ kind }) => kind);
      const closureDigests = closureArtifacts.map(({ digest }) => digest);
      const uniqueClosureDigests = [...new Set(closureDigests)].sort();
      if (
        closure.protocolVersion !== "chronicle-artifact-closure/v1" ||
        new Set(closureKinds).size !== closureKinds.length ||
        canonicalJson(uniqueClosureDigests) !==
          canonicalJson(
            commit.artifactDigests
              .filter((digest) => digest !== commit.artifactClosureDigest)
              .sort(),
          )
      ) {
        throw new Error("recovered artifact closure set is invalid");
      }
      for (const field of [
        "workspaceId",
        "inputDigest",
        "implementationDigest",
        "buildEnvironmentDigest",
        "planDigest",
        "profileDigest",
        "profileLockDigest",
        "runtimeAuthorityDigest",
        "productContractDigest",
        "dependencyCertificateDigest",
        "dependencyCacheMode",
        "previousWorkspaceRootDigest",
        "optionsDigest",
        "assignmentDigests",
        "executionStateDigest",
        "journalDigest",
      ] as const) {
        if (canonicalJson(closure[field]) !== canonicalJson(commit[field])) {
          throw new Error(
            `recovered artifact closure identity mismatch: ${field}`,
          );
        }
      }
      for (const metadata of closureArtifacts) {
        const verifiedSize = verifiedObjectSizes?.get(metadata.digest);
        if (verifiedSize === undefined) {
          await withObjectBytes(metadata.digest, (bytes) => {
            if (bytes.byteLength !== metadata.size) {
              throw new Error(`recovered artifact size mismatch: ${metadata.kind}`);
            }
          });
        } else if (verifiedSize !== metadata.size) {
          throw new Error(`recovered artifact size mismatch: ${metadata.kind}`);
        }
      }
      for (const binding of bindings.values()) {
        const metadata = closureArtifacts.find(
          (artifact) => artifact.kind === binding.artifactKind,
        );
        const view = await withObjectBytes(
          binding.artifactDigest,
          decodeObject<Record<string, unknown>>,
        );
        const viewContractDigests =
          binding.viewId === "chronicle-workflow-explorer/v1"
            ? workflowContractDigestsAt(
                view.contractDigests,
                "workflowExplorer.contractDigests",
              )
            : undefined;
        const workflowExplorerIsValid =
          binding.viewId === "chronicle-workflow-explorer/v1" &&
          view.protocolVersion === "chronicle-workflow-explorer/v1" &&
          view.viewId === binding.viewId &&
          view.schemaId === binding.schemaId &&
          view.rootDigest === commit.executionStateDigest &&
          viewContractDigests?.workspaceCompatibility ===
            commit.workflowCompatibilityDigest &&
          Number.isSafeInteger(view.revision) &&
          Array.isArray(view.phases) &&
          Array.isArray(view.operations) &&
          Array.isArray(view.artifacts) &&
          Array.isArray(view.queries) &&
          Array.isArray(view.decisions);
        const semanticAdapterViewIsValid =
          binding.viewId !== "chronicle-workflow-explorer/v1" &&
          view.protocol_version === "0.1" &&
          view.view_id === binding.viewId &&
          view.family === "incremental-dataflow" &&
          view.schema_id === binding.schemaId &&
          view.root_digest === commit.executionStateDigest &&
          Number.isSafeInteger(view.revision) &&
          "payload" in view;
        if (
          metadata?.digest !== binding.artifactDigest ||
          (!workflowExplorerIsValid && !semanticAdapterViewIsValid)
        ) {
          throw new Error(`recovered typed view is invalid: ${binding.viewId}`);
        }
      }
      rootDigest = verifyHistory ? commit.previousWorkspaceRootDigest : null;
    }
    if (
      allowed.size !== retained.size ||
      [...allowed].some((digest) => !retained.has(digest))
    ) {
      throw new Error(
        "recovered workspace closure has missing or unbound objects",
      );
    }
  } finally {
    rootBytes.fill(0);
  }
}

async function verifyPortableClosure(
  closure: RuntimeClosureInspection,
  kernel: KernelModule,
  workspaceId: string,
): Promise<void> {
  // Every archive-backed object is owned only for one verification callback
  // and wiped immediately, keeping both peak heap and sensitive residency
  // bounded no matter how large the closure is.
  await verifyRootClosure(
    await closure.object(closure.manifest.workspaceRootDigest),
    (digest) => closure.object(digest),
    closure.manifest.objects.map(({ digest }) => digest),
    closure.manifest.previousWorkspaceRootDigest,
    kernel,
    workspaceId,
    closure.manifest.workspaceRootDigest,
  );
}

let persistenceAdapter = defaultPersistenceAdapter;

/** Test-only dependency seam for initializing the generated module from local bytes. */
export function setRustRuntimeForTesting(module: KernelModule): void {
  clearRuntimeSupportFilesCache();
  initPromise = Promise.resolve(module);
}

/** Instantiate the generated bindings from a module compiled once by the main
 * thread. Each worker still owns an independent WASM memory and Rust runtime. */
/**
 * Routes the runtime's payload spills to `bridge` and caps resident payload
 * bytes. Must run before the first execution in this worker.
 */
export async function installRustPayloadSpill(
  bridge: PayloadSpillBridge,
  budgetBytes: number,
): Promise<void> {
  (await loadKernel()).install_payload_spill(bridge, BigInt(budgetBytes));
}

export async function initializeRustRuntime(
  compiledModule: WebAssembly.Module,
): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const module =
        (await import("@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js")) as unknown as KernelModule;
      captureWasmMemory(
        await module.default({ module_or_path: compiledModule }),
      );
      return module;
    })();
  }
  await initPromise;
}

export async function discoverRustTimezones(
  csvBytes: Uint8Array,
): Promise<string[]> {
  const kernel = await loadKernel();
  return kernel.discover_timezones_v2(csvBytes);
}

/** One raw part per study for a file that mixes studies; empty otherwise. */
export async function splitRustRawFileByStudy(
  csvBytes: Uint8Array,
): Promise<Array<{ studyId: string; bytes: Uint8Array }>> {
  const kernel = await loadKernel();
  if (!kernel.split_raw_by_study_v1) {
    throw new Error("runtime WASM does not expose the raw study split");
  }
  const split = kernel.split_raw_by_study_v1(csvBytes);
  try {
    return split.study_ids().map((studyId, index) => ({
      studyId,
      bytes: split.take_part(index),
    }));
  } finally {
    split.free();
  }
}

export async function inspectRustRawFile(
  csvBytes: Uint8Array,
  fileName: string,
  sizeBytes: number,
  participantPartitionBatchId?: string,
): Promise<RawFileInspection> {
  const kernel = await loadKernel();
  const inspectV2 = kernel.inspect_raw_file_v2?.bind(kernel);
  if (participantPartitionBatchId && !inspectV2) {
    throw new Error(
      "runtime WASM does not expose the v2 raw-inspection boundary",
    );
  }
  const parsed: unknown = JSON.parse(
    participantPartitionBatchId
      ? requireDefined(inspectV2, "a batch inspection was refused above unless the v2 boundary exists")(
          csvBytes,
          fileName,
          sizeBytes,
          participantPartitionBatchId,
        )
      : kernel.inspect_raw_file_v1(csvBytes, fileName, sizeBytes),
  );
  // v1 inspection is advisory-only and predates opaque participant partition
  // fields. Preserve that envelope safely for legacy/test callers; every
  // scientific batch uses v2 and is never allowed this empty fallback.
  if (
    !participantPartitionBatchId &&
    typeof parsed === "object" &&
    parsed !== null
  ) {
    const legacy = parsed as Record<string, unknown>;
    legacy.participantPartitionBatchId ??= null;
    legacy.participantTokens ??= [];
  }
  const inspection = decodeBoundaryStruct<RawFileInspection>(
    RUNTIME_BOUNDARY_MODEL,
    "RawFileInspection",
    parsed,
    "rawFileInspection",
  );
  if (
    inspection.fileName !== fileName ||
    inspection.participantPartitionBatchId !==
      (participantPartitionBatchId ?? null) ||
    (participantPartitionBatchId !== undefined &&
      inspection.participantCount !== inspection.participantTokens.length) ||
    inspection.participantTokens.some(
      (token, index) =>
        index > 0 &&
        requireDefined(inspection.participantTokens[index - 1], "a token after the first has a predecessor") >= token,
    )
  ) {
    throw new Error("Rust raw-file inspection returned an invalid identity.");
  }
  return inspection;
}

export async function beginRustRawInspectionBatch(
  secretBytes: Uint8Array,
): Promise<string> {
  if (secretBytes.byteLength !== 32) {
    throw new Error("raw inspection batch requires exactly 32 secret bytes");
  }
  const kernel = await loadKernel();
  const beginBatch = kernel.begin_raw_inspection_batch?.bind(kernel);
  if (!beginBatch) {
    throw new Error(
      "runtime WASM does not expose the v2 raw-inspection batch boundary",
    );
  }
  return beginBatch(secretBytes);
}

export async function disposeRustRawInspectionBatch(
  participantPartitionBatchId: string,
): Promise<boolean> {
  const kernel = await loadKernel();
  const disposeBatch = kernel.dispose_raw_inspection_batch?.bind(kernel);
  if (!disposeBatch) {
    throw new Error(
      "runtime WASM does not expose the v2 raw-inspection batch boundary",
    );
  }
  return disposeBatch(participantPartitionBatchId);
}

export async function registerRustRawParticipantPartitionArtifact(
  csvBytes: Uint8Array,
  participantPartitionBatchId: string,
): Promise<void> {
  const kernel = await loadKernel();
  const registerArtifact =
    kernel.register_raw_participant_partition_artifact?.bind(kernel);
  if (!registerArtifact) {
    throw new Error(
      "runtime WASM does not expose the v2 participant-partition boundary",
    );
  }
  registerArtifact(csvBytes, participantPartitionBatchId);
}

export async function verifyPersistedRustWorkspace(
  workspaceId: string,
): Promise<WorkspaceRootSlot | undefined> {
  const [kernel, root] = await Promise.all([
    loadKernel(),
    openOpfsWorkspace(workspaceId),
  ]);
  const slot = await recoverRuntimeWorkspace(root);
  if (slot) {
    await defaultPersistenceAdapter.verify?.(root, slot, kernel, workspaceId);
  }
  return slot;
}

/**
 * Whether the root commit `rootDigest` was built directly on `parentDigest`.
 * With two alternating slots, a store that fell back after losing the newest
 * save recovers exactly the lost root's parent, so one root read decides it.
 * An unreadable root answers false: the relationship is then unknown, never
 * assumed.
 */
async function rootBuiltOn(
  root: FileSystemDirectoryHandle,
  rootDigest: string,
  parentDigest: string,
): Promise<boolean> {
  try {
    const commit = JSON.parse(
      new TextDecoder().decode(await readRuntimeObject(root, rootDigest)),
    ) as { previousWorkspaceRootDigest?: unknown };
    return commit.previousWorkspaceRootDigest === parentDigest;
  } catch {
    return false;
  }
}

export async function exportPersistedRustWorkspace(
  workspaceId: string,
  expectedWorkspaceRootDigest?: string,
): Promise<Blob> {
  return withWorkspaceLock(workspaceId, async () => {
    const [kernel, root] = await Promise.all([
      loadKernel(),
      openOpfsWorkspace(workspaceId),
    ]);
    const slot = await recoverRuntimeWorkspace(root);
    if (!slot) throw new Error("no persisted Rust workspace exists");
    // Never hand out a different root than the result on screen. The two ways
    // they differ need different explanations: the workspace moved on (a later
    // run committed), or the displayed root's own save could not be recovered
    // and the store fell back to an earlier, still verifiable save.
    if (expectedWorkspaceRootDigest !== undefined && slot.workspaceRootDigest !== expectedWorkspaceRootDigest) {
      if (await rootBuiltOn(root, expectedWorkspaceRootDigest, slot.workspaceRootDigest)) {
        throw new Error(
          `The newest saved workspace could not be recovered, so this browser fell back to the earlier save at generation ${slot.generation}. The result shown belongs to the newer save and cannot be exported; process the files again to save and export it.`,
        );
      }
      throw new Error("The saved workspace has changed since this result was displayed. Reopen the current result before exporting.");
    }
    await defaultPersistenceAdapter.verify?.(root, slot, kernel, workspaceId);
    return exportRuntimeClosure(root, slot);
  });
}

export async function importPersistedRustWorkspace(
  workspaceId: string,
  archive: Blob,
): Promise<WorkspaceRootSlot> {
  if ((await runtimeClosureWorkspaceId(archive)) !== workspaceId) {
    throw new Error(
      "runtime closure workspace identity does not match the import target",
    );
  }
  return withWorkspaceLock(workspaceId, async () => {
    const [kernel, root] = await Promise.all([
      loadKernel(),
      openOpfsWorkspace(workspaceId),
    ]);
    return importRuntimeClosure(root, archive, (closure) =>
      verifyPortableClosure(closure, kernel, workspaceId),
    );
  });
}

export async function importPersistedRustWorkspaceArchive(
  archive: Blob,
): Promise<{ workspaceId: string; slot: WorkspaceRootSlot }> {
  const workspaceId = await runtimeClosureWorkspaceId(archive);
  return {
    workspaceId,
    slot: await importPersistedRustWorkspace(workspaceId, archive),
  };
}

export async function garbageCollectPersistedRustWorkspace(
  workspaceId: string,
): Promise<number> {
  return withWorkspaceLock(workspaceId, async () => {
    const root = await openOpfsWorkspace(workspaceId);
    const slots = await recoverRuntimeWorkspaceRoots(root);
    return garbageCollectRuntimeObjects(root, slots);
  });
}

/**
 * Delete a workspace's persisted history from OPFS under its exclusive Web
 * Lock, so a run or garbage collection holding the same workspace cannot
 * interleave with the removal. The in-worker byte caches keyed by that
 * workspace's roots are dropped too: they hold decoded review bases, which are
 * participant data, and must not outlive the files they were read from.
 */
export async function deletePersistedRustWorkspace(
  workspaceId: string,
): Promise<void> {
  return withWorkspaceLock(workspaceId, async () => {
    await removeOpfsWorkspace(workspaceId);
    persistedRustReviewProbesCache = undefined;
    persistedRustSelectedReviewBaseCache = undefined;
    if (ephemeralContinuation?.workspaceId === workspaceId) {
      ephemeralContinuation = undefined;
    }
  });
}

const RECOVERED_SLOT_INVARIANT =
  "a read without a pinned root digest recovered a workspace slot or was refused";

export async function readPersistedRustArtifact(
  workspaceId: string,
  kind: string,
  expectedWorkspaceRootDigest?: string,
): Promise<Uint8Array> {
  return withWorkspaceLock(
    workspaceId,
    async () => {
      const root = await openOpfsWorkspace(workspaceId);
      const slot = expectedWorkspaceRootDigest
        ? undefined
        : await recoverRuntimeWorkspace(root);
      if (!expectedWorkspaceRootDigest && !slot) {
        throw new Error("no persisted Rust workspace exists");
      }
      // Old callers without a receipt pin retain the full identity/history
      // verification. Current output locators pass the exact root digest, so a
      // content-addressed read needs only the root, closure, and requested
      // object (the same Merkle-path pattern used by the persisted bases).
      if (expectedWorkspaceRootDigest === undefined) {
        const kernel = await loadKernel();
        await defaultPersistenceAdapter.verify?.(
          root,
          requireDefined(slot, RECOVERED_SLOT_INVARIANT),
          kernel,
          workspaceId,
        );
      }
      const selectedRootDigest =
        expectedWorkspaceRootDigest ?? requireDefined(slot, RECOVERED_SLOT_INVARIANT).workspaceRootDigest;
      const rootBytes = await readRuntimeObject(root, selectedRootDigest);
      const rootCommit = JSON.parse(new TextDecoder().decode(rootBytes)) as {
        artifactClosureDigest: string; workspaceId: string;
      };
      if (rootCommit.workspaceId !== workspaceId) {
        throw new Error("persisted Rust workspace identity mismatch");
      }
      if (kind === "workspace-root-json") return rootBytes;
      const closureBytes = await readRuntimeObject(
        root,
        rootCommit.artifactClosureDigest,
      );
      // The closure cannot list itself without making its own digest recursive.
      // Its exact bytes are nevertheless addressed by the verified root commit.
      if (kind === "artifact-closure-json") return closureBytes;
      const closure = JSON.parse(new TextDecoder().decode(closureBytes)) as {
        workspaceId: string;
        artifacts: Array<{ kind: string; digest: string; size: number }>;
      };
      if (closure.workspaceId !== workspaceId) {
        throw new Error("persisted Rust artifact closure identity mismatch");
      }
      const artifact = closure.artifacts.find(
        (candidate) => candidate.kind === kind,
      );
      if (!artifact)
        throw new Error(`persisted Rust artifact is missing: ${kind}`);
      const bytes = await readRuntimeObject(root, artifact.digest);
      if (bytes.byteLength !== artifact.size) {
        throw new Error(`persisted Rust artifact integrity mismatch: ${kind}`);
      }
      return bytes;
    },
    "shared",
  );
}

export type VerifiedSemanticIndexSnapshot = {
  workspaceRootDigest: string;
  revision: number;
  source: Uint8Array;
  scientificArtifactBundle: Uint8Array;
};

type VerifiedRuntimeObjectReader = (
  digest: string,
  maxBytes?: number,
) => Promise<Uint8Array>;

async function assembleVerifiedSemanticIndexSnapshot(
  workspaceId: string,
  workspaceRootDigest: string,
  revision: number,
  readObject: VerifiedRuntimeObjectReader,
): Promise<VerifiedSemanticIndexSnapshot> {
  const decodeSensitiveObject = async (digest: string, path: string) => {
    const bytes = await readObject(digest);
    try {
      return objectAt(JSON.parse(new TextDecoder().decode(bytes)), path);
    } finally {
      bytes.fill(0);
    }
  };
  const rootCommit = await decodeSensitiveObject(
    workspaceRootDigest,
    "semanticSnapshot.root",
  );
  const closureDigest = digestAt(
    rootCommit.artifactClosureDigest,
    "semanticSnapshot.root.artifactClosureDigest",
  );
  const closure = await decodeSensitiveObject(
    closureDigest,
    "semanticSnapshot.closure",
  );
  if (closure.workspaceId !== workspaceId) {
    throw new Error("persisted Rust artifact closure identity mismatch");
  }
  const closureArtifacts = arrayAt(
    closure.artifacts,
    "semanticSnapshot.closure.artifacts",
  ).map((value, index) =>
    objectAt(value, `semanticSnapshot.closure.artifacts[${index}]`),
  );
  const sourceMetadata = closureArtifacts.find(
    (artifact) => artifact.kind === "semantic-index-source-json",
  );
  if (!sourceMetadata) {
    throw new Error(
      "persisted Rust artifact is missing: semantic-index-source-json",
    );
  }
  const sourceDigest = digestAt(
    sourceMetadata.digest,
    "semanticSnapshot.source.digest",
  );
  const sourceSize = integerAt(
    sourceMetadata.size,
    "semanticSnapshot.source.size",
  );
  const source = await readObject(sourceDigest, sourceSize);
  let sourceOwned = true;
  let scientificArtifactBundle: Uint8Array | undefined;
  try {
    if (source.byteLength !== sourceSize) {
      throw new Error(
        "persisted Rust artifact integrity mismatch: semantic-index-source-json",
      );
    }
    const sourceValue = objectAt(
      JSON.parse(new TextDecoder().decode(source)),
      "semanticSnapshot.source",
    );
    if (sourceValue.protocolVersion !== "chronicle-semantic-index-source/v7") {
      throw new Error("unsupported semantic index source protocol");
    }
    const substrateKinds = arrayAt(
      sourceValue.scientificValidationSubstrateKinds,
      "semanticSnapshot.source.scientificValidationSubstrateKinds",
    ).map((kind, index) =>
      stringAt(
        kind,
        `semanticSnapshot.source.scientificValidationSubstrateKinds[${index}]`,
      ),
    );
    const allowedSubstrateKinds = new Set([
      "b05-schoedel-validation-receipt-json",
      "b05-screen-construction-evidence-json",
      "eyes-tagged-fau-evidence-json",
      "foundational-semantics-receipt-json",
      "schoedel-reconstruction-evidence-json",
    ]);
    if (
      substrateKinds.length < 2 ||
      substrateKinds.length > allowedSubstrateKinds.size ||
      substrateKinds[0] !== "b05-schoedel-validation-receipt-json" ||
      !substrateKinds.includes("foundational-semantics-receipt-json") ||
      substrateKinds.some(
        (kind, index) =>
          !allowedSubstrateKinds.has(kind) ||
          (index > 0 &&
            requireDefined(substrateKinds[index - 1], "a kind after the first has a predecessor") >= kind),
      )
    ) {
      throw new Error(
        "semantic scientific validation substrate set is invalid",
      );
    }
    const scientificMetadata = arrayAt(
      sourceValue.scientificEvidenceArtifacts,
      "semanticSnapshot.source.scientificEvidenceArtifacts",
    ).map((value, index) =>
      objectAt(
        value,
        `semanticSnapshot.source.scientificEvidenceArtifacts[${index}]`,
      ),
    );
    const scientificKinds = new Set([
      "b05-schoedel-validation-receipt-json",
      "b05-screen-construction-evidence-json",
      "eyes-tagged-fau-evidence-json",
      "eyes-tagged-fau-validation-receipt-json",
      "foundational-semantics-receipt-json",
      "minimum-duration-excluded-lineage-json",
      "schoedel-reconstruction-evidence-json",
      "zero-duration-cleanup-evidence-json",
      "zero-duration-removed-lineage-json",
    ]);
    const closureScientificMetadata = closureArtifacts.filter((artifact) =>
      scientificKinds.has(String(artifact.kind)),
    );
    if (
      scientificMetadata.length === 0 ||
      scientificMetadata.length !== closureScientificMetadata.length ||
      scientificMetadata.some((artifact, index) => {
        const kind = String(artifact.kind);
        const previous = scientificMetadata[index - 1];
        const previousKind =
          previous === undefined ? undefined : String(previous.kind);
        const closureArtifact = closureScientificMetadata.find(
          (candidate) => candidate.kind === kind,
        );
        return (
          !scientificKinds.has(kind) ||
          (previousKind !== undefined && previousKind >= kind) ||
          !closureArtifact ||
          canonicalJson(artifact) !== canonicalJson(closureArtifact)
        );
      })
    ) {
      throw new Error("semantic scientific artifact closure metadata mismatch");
    }
    const descriptors = substrateKinds.map((kind) => {
      const sourceArtifact = scientificMetadata.find(
        (artifact) => artifact.kind === kind,
      );
      const closureArtifact = closureArtifacts.find(
        (artifact) => artifact.kind === kind,
      );
      if (!sourceArtifact || !closureArtifact) {
        throw new Error(`persisted Rust artifact is missing: ${kind}`);
      }
      // The closure-metadata rule above already compares every source
      // scientific artifact against the closure entry of the same kind, and
      // `closureScientificMetadata` is `closureArtifacts` filtered in order, so
      // the two lookups here resolve to the same entry and cannot disagree.
      if (sourceArtifact.mediaType !== "application/json") {
        throw new Error(`semantic scientific artifact media invalid: ${kind}`);
      }
      return {
        kind,
        digest: digestAt(
          sourceArtifact.digest,
          `semanticSnapshot.source.${kind}.digest`,
        ),
        size: integerAt(
          sourceArtifact.size,
          `semanticSnapshot.source.${kind}.size`,
        ),
      };
    });
    const maximumBundleBytes = 128 * 1024 * 1024;
    let totalSize = 0;
    for (const descriptor of descriptors) {
      totalSize += descriptor.size;
      if (!Number.isSafeInteger(totalSize) || totalSize > maximumBundleBytes) {
        throw new Error("semantic scientific artifact bundle size invalid");
      }
    }
    scientificArtifactBundle = new Uint8Array(totalSize);
    let offset = 0;
    for (const descriptor of descriptors) {
      const bytes = await readObject(descriptor.digest, maximumBundleBytes);
      try {
        if (bytes.byteLength !== descriptor.size) {
          throw new Error(
            `persisted Rust artifact integrity mismatch: ${descriptor.kind}`,
          );
        }
        scientificArtifactBundle.set(bytes, offset);
        offset += bytes.byteLength;
      } finally {
        bytes.fill(0);
      }
    }
    sourceOwned = false;
    return {
      workspaceRootDigest,
      revision,
      source,
      scientificArtifactBundle,
    };
  } catch (error) {
    scientificArtifactBundle?.fill(0);
    throw error;
  } finally {
    if (sourceOwned) source.fill(0);
  }
}

/**
 * Verify an archive's bytes and Rust-owned closure semantics without importing
 * it. The returned accessor is safe for semantic selection by kind through the
 * verified root and artifact-closure objects.
 */
async function inspectVerifiedPersistedRustWorkspaceArchive(
  archive: Blob,
  requireFreshRoot = false,
): Promise<RuntimeClosureInspection> {
  const [kernel, closure] = await Promise.all([
    loadKernel(),
    inspectVerifiedRuntimeClosure(archive),
  ]);
  if (requireFreshRoot) {
    assertFreshPortableSemanticArchive(closure.manifest);
  }
  await verifyPortableClosure(closure, kernel, closure.manifest.workspaceId);
  return closure;
}

export type VerifiedPersistedRustWorkspaceArchiveCapture = {
  manifest: RuntimeClosureManifest;
  objectCount: number;
};

export const FRESH_PORTABLE_SEMANTIC_INDEX_REVISION = 1 as const;

export function assertFreshPortableSemanticArchive(
  manifest: RuntimeClosureManifest,
): void {
  if (manifest.previousWorkspaceRootDigest !== null) {
    throw new Error(
      "portable semantic snapshot requires a fresh one-root workspace closure",
    );
  }
}

/**
 * Verify a portable archive and materialize its exact physical object census.
 * The result is evidence data only: no public API accepts it as an authority
 * input, so callers cannot forge a structural "verified" capability.
 */
export async function readVerifiedPersistedRustWorkspaceArchiveCapture(
  archive: Blob,
  visit: (
    object: RuntimeClosureManifest["objects"][number],
    bytes: Uint8Array,
  ) => Promise<void>,
): Promise<VerifiedPersistedRustWorkspaceArchiveCapture> {
  const closure = await inspectVerifiedPersistedRustWorkspaceArchive(archive);
  for (const object of closure.manifest.objects) {
    const bytes = await closure.object(object.digest);
    try {
      await visit(structuredClone(object), bytes);
    } finally {
      bytes.fill(0);
    }
  }
  return {
    manifest: structuredClone(closure.manifest),
    objectCount: closure.manifest.objects.length,
  };
}

/** Assemble the exact semantic rebuild inputs from a verified closure realm. */
export async function readVerifiedSemanticIndexSnapshotFromArchive(
  archive: Blob,
): Promise<VerifiedSemanticIndexSnapshot> {
  const closure = await inspectVerifiedPersistedRustWorkspaceArchive(
    archive,
    true,
  );
  return assembleVerifiedSemanticIndexSnapshot(
    closure.manifest.workspaceId,
    closure.manifest.workspaceRootDigest,
    FRESH_PORTABLE_SEMANTIC_INDEX_REVISION,
    (digest) => closure.object(digest),
  );
}

export async function readVerifiedSemanticIndexSnapshot(
  workspaceId: string,
): Promise<VerifiedSemanticIndexSnapshot> {
  return withWorkspaceLock(
    workspaceId,
    async () => {
      const [kernel, root] = await Promise.all([
        loadKernel(),
        openOpfsWorkspace(workspaceId),
      ]);
      const slot = await recoverRuntimeWorkspace(root);
      if (!slot) throw new Error("no persisted Rust workspace exists");
      await persistenceAdapter.verify?.(root, slot, kernel, workspaceId);
      return assembleVerifiedSemanticIndexSnapshot(
        workspaceId,
        slot.workspaceRootDigest,
        slot.generation,
        (digest, maxBytes) => readRuntimeObject(root, digest, maxBytes),
      );
    },
    "shared",
  );
}

/**
 * Read only the newest independently recoverable root. A semantic index that
 * was already fully verified for this exact digest can use this cheap check
 * instead of re-reading and hashing the complete append-only history.
 */
export async function readPersistedRustWorkspaceHead(
  workspaceId: string,
): Promise<string | null> {
  return withWorkspaceLock(
    workspaceId,
    async () => {
      const root = await openOpfsWorkspace(workspaceId);
      return (
        (await recoverRuntimeWorkspaceHead(root))?.workspaceRootDigest ?? null
      );
    },
    "shared",
  );
}

/** Test-only dependency seam for deterministic OPFS fault/recovery tests. */
export function setRustPersistenceForTesting(
  adapter: RustPersistenceAdapter | null,
): void {
  persistenceAdapter = adapter ?? defaultPersistenceAdapter;
  ephemeralContinuation = undefined;
  persistedRustReviewProbesCache = undefined;
  persistedRustSelectedReviewBaseCache = undefined;
}

async function loadKernel(): Promise<KernelModule> {
  if (!initPromise) {
    /* v8 ignore start -- Vite's browser WASM loader is exercised by the Playwright offline/runtime smoke; unit tests inject the exact compiled module bytes. */
    initPromise = (async () => {
      const module =
        (await import("@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js")) as unknown as KernelModule;
      captureWasmMemory(await module.default());
      return module;
    })();
    /* v8 ignore stop */
  }
  return initPromise;
}

/** The instantiated kernel's linear memory; null until wasm-bindgen init runs. */
let kernelWasmMemory: WebAssembly.Memory | null = null;

function captureWasmMemory(initOutput: unknown): void {
  const memory = (initOutput as { memory?: WebAssembly.Memory } | undefined)
    ?.memory;
  if (memory instanceof WebAssembly.Memory) kernelWasmMemory = memory;
}

/**
 * Current WASM linear-memory size of this thread's kernel instance, in bytes.
 * WASM memory never shrinks, so this is also the high-water mark — the input
 * `computeAdaptiveLaneTarget` uses for measured batch admission. Null when the
 * kernel has not initialized (or was injected via setRustRuntimeForTesting).
 */
export function rustWasmMemoryBytes(): number | null {
  return kernelWasmMemory ? kernelWasmMemory.buffer.byteLength : null;
}

export async function setComparisonCacheCapacity(
  capacity: number,
): Promise<void> {
  (await loadKernel()).set_comparison_cache_capacity(capacity);
}

export async function getComparisonCacheRetained(): Promise<number> {
  return (await loadKernel()).get_comparison_cache_retained();
}

export async function getRustRuntimeVersion(): Promise<string> {
  return (await loadKernel()).runtime_version();
}

export async function getRustWorkflowExplorerView(
  options: BrowserProcessingOptions,
  supportRoles: import("@/lib/types").WorkflowExplorerSupportRole[] = [],
): Promise<import("@/lib/types").RustWorkflowExplorerView> {
  const kernel = await loadKernel();
  // The pre-run projection has no raw input from which to discover a timezone.
  // A deterministic placeholder satisfies the execution ABI only; Rust still
  // evaluates all topology and applicability, and the actual run separately
  // resolves or rejects the selected timezone before ingestion.
  const projectionOptions =
    options.timezoneHandling.startsWith("selected-") &&
    !options.selectedTimezone?.trim()
      ? { ...options, selectedTimezone: "UTC" }
      : options;
  return JSON.parse(
    kernel.plan_workflow_explorer_view_json(
      JSON.stringify({
        options: buildRustV2Options(projectionOptions, {
          datetimeOfPreprocessing: "1970-01-01 00:00:00 UTC",
        }),
        supportRoles,
      }),
    ),
  ) as import("@/lib/types").RustWorkflowExplorerView;
}

function fileBytes(file: BrowserSupportFile | undefined): Uint8Array {
  return file ? new Uint8Array(file.bytes) : new Uint8Array();
}

async function supportBytes(
  enabled: boolean,
  file: BrowserSupportFile | undefined,
  bundledUrl: string,
): Promise<Uint8Array> {
  if (!enabled) return new Uint8Array();
  if (file) return fileBytes(file);
  return new Uint8Array(await fetchBundledAssetBytes(bundledUrl));
}

function requiredUploadedBytes(
  enabled: boolean,
  file: BrowserSupportFile | undefined,
  role: string,
): Uint8Array {
  if (!enabled) return new Uint8Array();
  if (!file) {
    throw new Error(`${role} is required when its processing stage is enabled`);
  }
  return fileBytes(file);
}

function putSupport(
  supportFiles: RuntimeSupportFilesHandle,
  role: string,
  name: string,
  bytes: Uint8Array,
): void {
  if (bytes.byteLength > 0) supportFiles.put_with_name(role, name, bytes);
}

/**
 * Exact, conservative eligibility boundary for the existing fused v2 kernel.
 * Every unsupported option is loud; adding support requires changing this
 * list and proving it with parity fixtures.
 */
function rustRuntimeIneligibilityReasons(
  options: BrowserProcessingOptions,
): string[] {
  const reasons: string[] = [];
  if (
    options.timezoneHandling.startsWith("selected-") &&
    !options.selectedTimezone?.trim()
  ) {
    reasons.push(
      "selectedTimezone is required for the selected timezone policy",
    );
  }
  return reasons;
}

/// Rust's `Display` for `f64` and JavaScript's `Number#toString` agree on the
/// shortest round-trip spelling for every finite value that JavaScript prints
/// without an exponent (|v| in [1e-6, 1e21)); the kernel re-derives the same
/// spelling with `canonical_legacy_hours_from_binary64_v1` and refuses when the
/// two disagree, so this never silently rounds.
function canonicalLegacyHoursSpelling(hours: number): string {
  if (!Number.isFinite(hours)) return String(hours);
  if (hours === 0) return "0";
  return String(hours);
}

/// Exact `hours * 3_600_000_000_000` evaluated on the decimal digit string
/// with BigInt (never through a binary64 multiply). The result carries a
/// fractional part when the hours are not a whole number of nanoseconds; the
/// kernel then refuses with `legacy_threshold_not_integer_ns` instead of
/// accepting a rounded value.
export function exactLegacyHoursToNsSpelling(canonicalHours: string): string {
  const negative = canonicalHours.startsWith("-");
  const unsigned = negative ? canonicalHours.slice(1) : canonicalHours;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(unsigned);
  if (!match) return canonicalHours;
  const integerDigits = match[1];
  const fractionDigits = match[2] ?? "";
  const scale = BigInt(fractionDigits.length);
  const coefficient = BigInt(`${integerDigits}${fractionDigits}`);
  const numerator = coefficient * 3_600_000_000_000n;
  const denominator = 10n ** scale;
  const whole = numerator / denominator;
  const remainder = numerator % denominator;
  const sign = negative && (whole !== 0n || remainder !== 0n) ? "-" : "";
  if (remainder === 0n) return `${sign}${whole}`;
  const fraction = (remainder * 10n ** scale) / denominator;
  const fractionText = fraction
    .toString()
    .padStart(Number(scale), "0")
    .replace(/0+$/, "");
  return `${sign}${whole}.${fractionText}`;
}

/// The B06 request keys exactly as the kernel reads them. The four selection
/// keys travel only when the browser holds a value (own-property presence is
/// the omitted/explicit distinction on the wire); the two legacy-threshold
/// companions travel only for an explicit selection, because that is the only
/// shape whose canonicalization the kernel evaluates.
export function buildMaximumDurationRequestFields(
  options: BrowserProcessingOptions,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (typeof options.maximumDurationPolicy === "string") {
    fields.maximum_duration_policy = options.maximumDurationPolicy;
  }
  if (typeof options.maximumDurationDisposition === "string") {
    fields.maximum_duration_disposition = options.maximumDurationDisposition;
  }
  if (typeof options.maximumDurationThresholdSource === "string") {
    fields.maximum_duration_threshold_source =
      options.maximumDurationThresholdSource;
  }
  if (typeof options.maximumDurationThresholdNs === "string") {
    fields.maximum_duration_threshold_ns = options.maximumDurationThresholdNs;
  }
  if (options.longDurationThresholdHoursExplicit === true) {
    fields.long_duration_threshold_explicit = true;
  }
  if (isExplicitMaximumDurationSelection(options)) {
    const hoursCanonical = canonicalLegacyHoursSpelling(
      options.longDurationThresholdHours,
    );
    fields.b06_legacy_threshold_hours_canonical = hoursCanonical;
    fields.b06_legacy_threshold_ns_canonical =
      exactLegacyHoursToNsSpelling(hoursCanonical);
  }
  return fields;
}

export function buildRustV2Options(
  options: BrowserProcessingOptions,
  runtime: BrowserProcessingRuntime,
): Record<string, unknown> {
  if (
    options.timezoneHandling.startsWith("selected-") &&
    !options.selectedTimezone?.trim()
  ) {
    throw new Error(
      "selectedTimezone is required for the selected timezone policy",
    );
  }
  if (!runtime.datetimeOfPreprocessing)
    throw new Error("datetimeOfPreprocessing is required");
  const usageSessionMode = options.processAppUsage
    ? options.processScreenUsage
      ? "app_and_screen_usage"
      : "app_usage"
    : options.processScreenUsage
      ? "screen_usage"
      : "no_usage";
  return {
    study_name: options.studyName,
    timezone: options.selectedTimezone?.trim() || "UTC",
    timezone_handling: options.timezoneHandling,
    usage_session_mode: usageSessionMode,
    include_app_output: options.processAppUsage,
    include_screen_output: options.processScreenUsage,
    use_filter_file: options.useFilterFile,
    filter_match_field: options.filterMatchField,
    application_label_exclusions: options.applicationLabelExclusions,
    use_apps_forcing_screen_open: options.useAppsForcingScreenOpenFile,
    use_background_apps_file: options.useBackgroundAppsFile,
    use_app_codebook: options.useAppCodebook,
    include_category_column: options.includeCategoryColumn,
    include_app_usage_end_reason: options.includeAppUsageEndReason,
    // An optional wire field, sent only when on: an off request stays
    // byte-identical to one built before the option existed, so its options
    // digest and every receipt bound to it are unchanged.
    ...(options.neutralizeSpreadsheetFormulas === true
      ? { neutralize_spreadsheet_formulas: true }
      : {}),
    deduplicate_exact_rows: options.deduplicateExactRows,
    drop_out_of_source_order_events: options.dropOutOfSourceOrderEvents,
    interaction_type_remap: options.interactionTypeRemap,
    correct_duplicate_event_timestamps: options.correctDuplicateEventTimestamps,
    event_retention_set: options.eventRetentionSet,
    opener_set: options.openerSet,
    episode_reconstruction_strategy: options.episodeReconstructionStrategy,
    micro_use_classification_policy: options.microUseClassificationPolicy,
    allow_stop_event_reuse: options.allowStopEventReuse,
    use_activity_stopped_as_fallback: options.useActivityStoppedAsFallback,
    apply_threshold_to_fallback: options.applyThresholdToFallback,
    // Rounded: the kernel field is an i64, and 2.3 h is 8279999999999.999 in
    // binary64, which serde refuses with an opaque type error.
    long_duration_threshold_ns: Math.round(
      options.longDurationThresholdHours * 3_600_000_000_000,
    ),
    proximity_interval_ns: Math.round(
      options.proximityIntervalSeconds * 1_000_000_000,
    ),
    custom_app_engagement_duration: options.customAppEngagementDuration,
    long_data_time_gap_thresholds: options.longDataTimeGapThresholds,
    long_usage_duration_thresholds: options.longUsageDurationThresholds,
    same_app_stop_types: options.sameAppInteractionTypesToStopUsageAt,
    other_stop_types: options.otherInteractionTypesToStopUsageAt,
    interaction_types_to_remove: options.interactionTypesToRemove,
    interaction_type_removal_mode: options.interactionTypeRemovalMode,
    screen_auto_lock_timeout_seconds: options.screenUsageAutoLockTimeoutSeconds,
    screen_auto_lock_tolerance_seconds:
      options.screenUsageAutoLockToleranceSeconds,
    screen_manual_lock_max_tail_seconds:
      options.screenUsageManualLockMaxTailGapSeconds,
    screen_keyguard_near_stop_seconds:
      options.screenUsageKeyguardNearStopSeconds,
    datetime_of_preprocessing: runtime.datetimeOfPreprocessing,
    model_concurrent_usage: options.modelConcurrentUsage,
    minimum_usage_duration: options.minimumUsageDuration,
    minimum_duration_comparator: options.minimumDurationComparator,
    minimum_duration_disposition: options.minimumDurationDisposition,
    ...buildMaximumDurationRequestFields(options),
    apply_minimum_usage_duration_to_concurrent_subintervals:
      options.applyMinimumUsageDurationToConcurrentSubintervals,
    filter_zero_duration_sessions: options.filterZeroDurationSessions,
    interval_quality_policy: options.intervalQualityPolicy,
    session_grouping_policy: options.sessionGroupingPolicy,
    session_gap_basis: options.sessionGapBasis,
    session_boundary_scope: options.sessionBoundaryScope,
    emit_session_break_lineage: options.emitSessionBreakLineage,
    add_no_activity_placeholder_days: options.addNoActivityPlaceholderDays,
    enable_study_window_filter: options.enableStudyWindowFilter,
    enable_person_attribution: options.enablePersonAttribution,
    enable_day_coverage: options.enableDayCoverage,
    enable_compliance_scoring: options.enableComplianceScoring,
    compliance_threshold_percent: options.complianceThresholdPercent,
    enable_screen_gated_crediting: options.enableScreenGatedCrediting,
    enable_parquet_export: options.enableParquetExport,
    enable_spss_export: options.enableSpssExport,
    enable_aggregates: options.enableAggregates,
    aggregate_shape: options.aggregateShape,
    aggregate_top_apps_limit: options.aggregateTopAppsLimit,
    enable_participant_amount_summary: options.enableParticipantAmountSummary,
    enable_plotting: options.enablePlotting,
    enable_activity_heatmap: options.enableActivityHeatmap,
    export_plots_as_svg: options.exportPlotsAsSvg,
    enable_interactive_timeline: options.enableInteractiveTimeline,
    include_filtered_app_usage_in_plots: options.includeFilteredAppUsageInPlots,
    materialize_visualization_data:
      options.enablePlotting || options.enableInteractiveTimeline,
    credited_session_cap_minutes: options.creditedSessionCapMinutes,
    device_liveness_gap_tolerance_minutes:
      options.deviceLivenessGapToleranceMinutes,
    auto_lock_bridge_seconds: options.autoLockBridgeSeconds,
    no_witness_min_day_apps: options.noWitnessMinDayApps,
    screen_gating_rule: options.screenGatingRule,
    day_boundary_attribution: options.dayBoundaryAttribution,
    package_exclusion_preset: options.packageExclusionPreset,
    notification_proxy_rule: options.notificationProxyRule,
    polled_emulation_method: options.polledEmulationMethod,
    polled_emulation_interval_seconds: options.polledEmulationIntervalSeconds,
    polled_emulation_gap_seconds: options.polledEmulationGapSeconds,
    interval_expansion_method: options.intervalExpansionMethod,
    screen_session_construction_strategy:
      options.screenSessionConstructionStrategy,
    screen_session_classification_policy:
      options.screenSessionClassificationPolicy,
    screen_session_maximum_duration_minutes:
      options.screenSessionMaximumDurationMinutes,
    screen_session_maximum_duration_disposition:
      options.screenSessionMaximumDurationDisposition,
    locked_screen_audio_disposition: options.lockedScreenAudioDisposition,
  };
}

function buildRustRuntimeRequestJson({
  requestId,
  workspaceId,
  previousWorkspaceRootDigest,
  inputFileName,
  inputSha256,
  materialization,
  options,
  runtime,
  persistedDatetimeOfPreprocessing,
  knownReviewSummaryDigests,
  participantPartition,
}: {
  requestId: string;
  workspaceId: string;
  previousWorkspaceRootDigest: string | null;
  inputFileName: string;
  inputSha256: string;
  materialization: "full" | "review";
  options: BrowserProcessingOptions;
  runtime: BrowserProcessingRuntime;
  persistedDatetimeOfPreprocessing?: string;
  knownReviewSummaryDigests?: string[];
  participantPartition?: ParticipantPartitionTransport;
}): string {
  const requestOptions = buildRustV2Options(options, runtime);
  const methodProfileReceipts = runtimeMethodProfileReceipts(runtime);
  if (materialization === "review" && persistedDatetimeOfPreprocessing) {
    // A/B holds the original run timestamp fixed. A receiving worker's wall
    // clock is not a researcher-controlled comparison setting and would
    // invalidate otherwise exact persisted bases.
    requestOptions.datetime_of_preprocessing = persistedDatetimeOfPreprocessing;
  }
  const activeParticipantPartition =
    requiresLiveScientificPreflight(options) &&
    participantPartition?.fragmentedParticipantTokens.length
      ? participantPartition
      : undefined;
  return JSON.stringify({
    protocolVersion: "chronicle-preprocessing-runtime/v2",
    requestId,
    command: materialization === "review" ? "QueryReview" : "ExecuteWorkspace",
    workspaceRootDigest: previousWorkspaceRootDigest,
    workspaceId,
    inputFileName,
    inputSha256: `sha256:${inputSha256}`,
    ...(materialization === "review" && knownReviewSummaryDigests?.length
      ? { knownReviewSummaryDigests }
      : {}),
    executionEngine:
      runtime.incrementalEngine === true ? "incremental" : "sequential",
    provenanceEvidence: runtime.provenanceEvidence === true,
    ...(activeParticipantPartition
      ? {
          participantPartitionBatchId:
            activeParticipantPartition.participantPartitionBatchId,
          fragmentedParticipantTokens:
            activeParticipantPartition.fragmentedParticipantTokens,
        }
      : {}),
    ...(methodProfileReceipts.length ? { methodProfileReceipts } : {}),
    options: requestOptions,
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned =
    bytes.buffer instanceof ArrayBuffer
      ? (bytes as Uint8Array<ArrayBuffer>)
      : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", owned);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

const PERFORMANCE_TRACE_PREFIX = "CHRONICLE_RUNTIME_PERF ";

async function traceRuntimePhase<T>(
  runtime: BrowserProcessingRuntime,
  details: {
    operationId: string;
    workspaceId: string;
    inputFileName: string;
    materialization: "full" | "review";
    phase: string;
    bytes?: number | (() => number);
    items?: number;
  },
  operation: () => T | Promise<T>,
): Promise<T> {
  if (!runtime.performanceTraceId) return operation();
  const started = performance.now();
  try {
    const result = await operation();
    console.info(
      `${PERFORMANCE_TRACE_PREFIX}${JSON.stringify({
        kind: "runtime-phase",
        schemaVersion: 1,
        traceId: runtime.performanceTraceId,
        ...details,
        bytes:
          typeof details.bytes === "function" ? details.bytes() : details.bytes,
        outcome: "ok",
        elapsedMs: performance.now() - started,
      })}`,
    );
    return result;
  } catch (error) {
    console.info(
      `${PERFORMANCE_TRACE_PREFIX}${JSON.stringify({
        kind: "runtime-phase",
        schemaVersion: 1,
        traceId: runtime.performanceTraceId,
        ...details,
        bytes:
          typeof details.bytes === "function" ? details.bytes() : details.bytes,
        outcome: "error",
        elapsedMs: performance.now() - started,
        error: error instanceof Error ? error.message : String(error),
      })}`,
    );
    throw error;
  }
}

/**
 * Resolve every ingress role the kernel can be handed for one run: the bytes
 * map and the display-name map. Kept out of {@link executeRustRuntimeUnlocked}
 * because the optional-support-file fan-out is pure per-role branching that
 * otherwise dominates that function's cyclomatic complexity.
 */
async function collectRuntimeIngress(
  csvBytes: Uint8Array,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
): Promise<{
  ingressBytesByRole: Map<string, Uint8Array>;
  supportNameByRole: Map<string, string>;
}> {
  const [filterBytes, forcingBytes, backgroundBytes, codebookBytes] =
    await Promise.all([
      supportBytes(
        options.useFilterFile,
        supportFiles?.filterFile,
        defaultAppsToFilterUrl,
      ),
      supportBytes(
        options.useAppsForcingScreenOpenFile,
        supportFiles?.appsForcingScreenOpenFile,
        defaultAppsForcingScreenOpenUrl,
      ),
      supportBytes(
        options.useBackgroundAppsFile,
        supportFiles?.backgroundAppsFile,
        defaultBackgroundAppsUrl,
      ),
      supportBytes(
        options.useAppCodebook,
        supportFiles?.appCodebookFile,
        defaultAppCodebookUrl,
      ),
    ]);
  const studyDatesBytes = options.enableStudyWindowFilter
    ? requiredUploadedBytes(
        true,
        supportFiles?.studyDatesFile,
        "studyDatesFile",
      )
    : options.enableDayCoverage
      ? fileBytes(supportFiles?.studyDatesFile)
      : new Uint8Array();
  const deviceSharingBytes = requiredUploadedBytes(
    options.enablePersonAttribution,
    supportFiles?.deviceSharingFile,
    "deviceSharingFile",
  );
  const surveyAttributionBytes = fileBytes(
    supportFiles?.surveyAttributionFile,
  );
  const enrolledDevicesBytes = fileBytes(supportFiles?.enrolledDevicesFile);
  const inputCapabilityEvidence = inputCapabilityEvidenceIngress(
    options,
    supportFiles,
    runtime,
  );
  const analysisFeatureMatrixBytes = fileBytes(
    supportFiles?.analysisFeatureMatrixFile,
  );
  const callSmsEligibilityBytes = fileBytes(
    supportFiles?.callSmsEligibilityFile,
  );
  const phoneStudyPsCommunicationBytes = fileBytes(
    supportFiles?.phoneStudyPsCommunicationFile,
  );
  const phoneStudyEsBytes = fileBytes(supportFiles?.phoneStudyEsFile);
  const anchorEventsBytes = fileBytes(supportFiles?.anchorEventsFile);
  const ingressBytesByRole = new Map<string, Uint8Array>([
    ["raw_chronicle_csv", csvBytes],
    ["filter_file", filterBytes],
    ["apps_forcing_screen_open_file", forcingBytes],
    ["background_apps_file", backgroundBytes],
    ["app_codebook_file", codebookBytes],
    ["study_dates_file", studyDatesBytes],
    ["device_sharing_file", deviceSharingBytes],
    ["survey_attribution_file", surveyAttributionBytes],
    ["enrolled_devices_file", enrolledDevicesBytes],
    ["input_capability_evidence_file", inputCapabilityEvidence.bytes],
  ]);
  const optionalIngress: ReadonlyArray<readonly [string, Uint8Array]> = [
    ["analysis_feature_matrix_file", analysisFeatureMatrixBytes],
    ["call_sms_eligibility_file", callSmsEligibilityBytes],
    ["phonestudy_ps_communication_file", phoneStudyPsCommunicationBytes],
    ["phonestudy_es_file", phoneStudyEsBytes],
    ["anchor_events_file", anchorEventsBytes],
  ];
  for (const [role, bytes] of optionalIngress) {
    if (bytes.byteLength > 0) ingressBytesByRole.set(role, bytes);
  }
  const supportNameByRole = new Map<string, string>([
    [
      "filter_file",
      supportFiles?.filterFile?.name ??
        "Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv",
    ],
    [
      "apps_forcing_screen_open_file",
      supportFiles?.appsForcingScreenOpenFile?.name ??
        "Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv",
    ],
    [
      "background_apps_file",
      supportFiles?.backgroundAppsFile?.name ??
        "Chronicle_Android_raw_data_preprocessor_background_apps.csv",
    ],
    [
      "app_codebook_file",
      supportFiles?.appCodebookFile?.name ?? "unified_app_codebook.csv",
    ],
    [
      "study_dates_file",
      supportFiles?.studyDatesFile?.name ?? "study_dates.csv",
    ],
    [
      "device_sharing_file",
      supportFiles?.deviceSharingFile?.name ?? "device_sharing.csv",
    ],
    [
      "survey_attribution_file",
      supportFiles?.surveyAttributionFile?.name ?? "survey_attribution.csv",
    ],
    [
      "enrolled_devices_file",
      supportFiles?.enrolledDevicesFile?.name ?? "enrolled_devices.csv",
    ],
    ["input_capability_evidence_file", inputCapabilityEvidence.name],
    [
      "analysis_feature_matrix_file",
      supportFiles?.analysisFeatureMatrixFile?.name ??
        "analysis_feature_matrix.csv",
    ],
    [
      "call_sms_eligibility_file",
      supportFiles?.callSmsEligibilityFile?.name ??
        "call_sms_eligibility.csv",
    ],
    [
      "phonestudy_ps_communication_file",
      supportFiles?.phoneStudyPsCommunicationFile?.name ??
        "ps_communication.csv",
    ],
    [
      "phonestudy_es_file",
      supportFiles?.phoneStudyEsFile?.name ?? "phonestudy_es.csv",
    ],
    [
      "anchor_events_file",
      supportFiles?.anchorEventsFile?.name ?? "anchor_events.csv",
    ],
  ]);
  return { ingressBytesByRole, supportNameByRole };
}

async function executeRustRuntimeUnlocked(
  workspaceId: string,
  csvBytes: Uint8Array,
  inputSizeBytes: number,
  inputFileName: string,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
  inputSha256: string,
  materialization: "full",
  persistedReviewOnly?: false,
  verifiedSupportCacheKey?: undefined,
  knownReviewSummaryDigests?: undefined,
  participantPartition?: ParticipantPartitionTransport,
): Promise<RustRuntimeExecution>;
async function executeRustRuntimeUnlocked(
  workspaceId: string,
  csvBytes: Uint8Array,
  inputSizeBytes: number,
  inputFileName: string,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
  inputSha256: string,
  materialization: "review",
  persistedReviewOnly?: boolean,
  verifiedSupportCacheKey?: string,
  knownReviewSummaryDigests?: string[],
  participantPartition?: ParticipantPartitionTransport,
): Promise<RustReviewExecution>;
async function executeRustRuntimeUnlocked(
  workspaceId: string,
  csvBytes: Uint8Array,
  inputSizeBytes: number,
  inputFileName: string,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
  inputSha256: string,
  materialization: "full" | "review",
  persistedReviewOnly = false,
  verifiedSupportCacheKey?: string,
  knownReviewSummaryDigests?: string[],
  participantPartition?: ParticipantPartitionTransport,
): Promise<RustRuntimeExecution | RustReviewExecution> {
  const reasons = rustRuntimeIneligibilityReasons(options);
  if (reasons.length > 0) {
    throw new Error(`Rust runtime is ineligible: ${reasons.join("; ")}`);
  }
  // Whether a raw-less review can satisfy a live scientific preflight depends
  // on which base Rust selects, so the decision moved below `required_base_kind`.
  // A persisted base carries the preflight receipt of the run that wrote it; a
  // warm Salsa engine has no such base and still misses.
  const traceBase = {
    operationId: `${materialization}:${inputSha256.slice(0, 16)}:${workspaceId.slice(-16)}`,
    workspaceId,
    inputFileName,
    materialization,
  } as const;
  const traced = <T>(
    phase: string,
    operation: () => T | Promise<T>,
    counts: { bytes?: number | (() => number); items?: number } = {},
  ): Promise<T> =>
    traceRuntimePhase(runtime, { ...traceBase, phase, ...counts }, operation);
  let handle: KernelHandle | null = null;
  let runtimeSupportFiles: RuntimeSupportFilesHandle | null = null;
  let runtimeSupportCacheEntry:
    { key: string; entry: CachedRuntimeSupportFiles } | undefined;
  let executionSucceeded = false;
  try {
    const kernel = await loadKernel();
    const { ingressBytesByRole, supportNameByRole } = await collectRuntimeIngress(
      csvBytes,
      options,
      supportFiles,
      runtime,
    );
    const supportHandleKey =
      materialization === "review" && verifiedSupportCacheKey
        ? runtimeSupportFilesCacheKey(verifiedSupportCacheKey, options, runtime)
        : undefined;
    const cachedSupport = supportHandleKey
      ? runtimeSupportFilesCache.get(supportHandleKey)
      : undefined;
    // A cached entry exists only under a key, so the key check never changes
    // which arm runs; it lets the compiler see the key is present.
    if (supportHandleKey && cachedSupport && !cachedSupport.invalid) {
      runtimeSupportFilesCache.delete(supportHandleKey);
      runtimeSupportFilesCache.set(supportHandleKey, cachedSupport);
      cachedSupport.activeUsers += 1;
      runtimeSupportFiles = cachedSupport.handle;
      runtimeSupportCacheEntry = {
        key: supportHandleKey,
        entry: cachedSupport,
      };
    } else {
      runtimeSupportFiles = new kernel.RuntimeSupportFiles();
      for (const [role, bytes] of ingressBytesByRole) {
        if (role !== "raw_chronicle_csv") {
          putSupport(
            runtimeSupportFiles,
            role,
            supportNameByRole.get(role) ?? `${role}.csv`,
            bytes,
          );
        }
      }
      if (supportHandleKey) {
        const entry: CachedRuntimeSupportFiles = {
          handle: runtimeSupportFiles,
          activeUsers: 1,
          invalid: false,
        };
        runtimeSupportFilesCache.set(supportHandleKey, entry);
        runtimeSupportCacheEntry = { key: supportHandleKey, entry };
        pruneRuntimeSupportFilesCache();
      }
    }
    const supportFilesHandle = runtimeSupportFiles;
    let opfsRoot: FileSystemDirectoryHandle | undefined;
    let recoveredRoot: WorkspaceRootSlot | undefined;
    if (runtime.persistRustWorkspace) {
      await traced("previous-root-recovery", async () => {
        opfsRoot = await persistenceAdapter.openRoot(workspaceId);
        recoveredRoot =
          materialization === "full" &&
          persistenceAdapter === defaultPersistenceAdapter
            ? await recoverRuntimeWorkspaceHead(opfsRoot, true)
            : materialization === "review"
            ? await (
                persistenceAdapter.recoverHead ?? persistenceAdapter.recover
              )(opfsRoot)
            : await persistenceAdapter.recover(opfsRoot);
        if (recoveredRoot && materialization === "full") {
          // The workspace is keyed by input content alone, so a file processed
          // before an app update finds a head committed by the earlier runtime
          // build. A full run only chains onto that head and never reuses its
          // outputs, so the head's closure is still verified but its runtime
          // identity is not required to match; refusing it here failed every
          // re-run of such a file until site data was cleared.
          try {
            await persistenceAdapter.verify?.(
              opfsRoot,
              recoveredRoot,
              kernel,
              workspaceId,
              true,
            );
          } catch (error) {
            // A signed newest head can still have a damaged downstream
            // object. Full recovery then selects the prior independent slot;
            // semantic failures on an intact head keep their original error.
            if (
              persistenceAdapter !== defaultPersistenceAdapter ||
              !isRecoverableClosureObjectError(error)
            ) throw error;
            const fallback = await persistenceAdapter.recover(opfsRoot);
            if (
              !fallback ||
              fallback.workspaceRootDigest === recoveredRoot.workspaceRootDigest
            ) {
              throw error;
            }
            await persistenceAdapter.verify?.(
              opfsRoot,
              fallback,
              kernel,
              workspaceId,
              true,
            );
            recoveredRoot = fallback;
          }
        }
      });
    }
    const previousWorkspaceRootDigest =
      recoveredRoot?.workspaceRootDigest ??
      (!runtime.persistRustWorkspace &&
      ephemeralContinuation?.workspaceId === workspaceId
        ? ephemeralContinuation.workspaceRootDigest
        : null);
    const requestId = `${materialization === "review" ? "review" : "execute"}-${inputSha256.slice(0, 16)}`;
    let reviewBaseProbe: Uint8Array = new Uint8Array();
    let reconstructionBaseProbe: Uint8Array = new Uint8Array();
    let persistedDatetimeOfPreprocessing: string | undefined;
    let persistedReviewDescriptors = new Map<
      string,
      PersistedArtifactDescriptor
    >();
    let persistedReviewExpected: PersistedReviewExpectedIdentity | undefined;
    if (
      materialization === "review" &&
      opfsRoot &&
      recoveredRoot &&
      persistenceAdapter === defaultPersistenceAdapter
    ) {
      let resolvedBaseBytes = 0;
      const reviewRoot = opfsRoot;
      const reviewSlot = recoveredRoot;
      const reviewExpected: PersistedReviewExpectedIdentity = {
        implementationDigest: kernel.implementation_build_digest(),
        buildEnvironmentDigest: kernel.build_environment_digest(),
        workspaceId,
        inputDigest: `sha256:${inputSha256}`,
      };
      persistedReviewExpected = reviewExpected;
      ({
        reviewProbe: reviewBaseProbe,
        reconstructionProbe: reconstructionBaseProbe,
        datetimeOfPreprocessing: persistedDatetimeOfPreprocessing,
        descriptors: persistedReviewDescriptors,
      } = await traced(
        "persisted-base-resolve",
        async () => {
          const probes = await readCachedPersistedRustReviewProbes(
            kernel,
            reviewRoot,
            reviewSlot,
            reviewExpected,
          );
          resolvedBaseBytes =
            probes.reviewProbe.byteLength +
            probes.reconstructionProbe.byteLength;
          return probes;
        },
        {
          bytes: () => resolvedBaseBytes,
          items: 2,
        },
      ));
    }
    const requestJson = buildRustRuntimeRequestJson({
      requestId,
      workspaceId,
      previousWorkspaceRootDigest,
      inputFileName,
      inputSha256,
      materialization,
      options,
      runtime,
      persistedDatetimeOfPreprocessing,
      knownReviewSummaryDigests,
      participantPartition,
    });
    const openerSetPreflight = preflightOpenerSet(
      kernel,
      requestJson,
      options.openerSet,
    );
    const maximumDurationPreflight = preflightMaximumDuration(
      kernel,
      requestJson,
      options,
    );
    await traced(
      "scientific-preflight",
      () =>
        preflightScientificInputs(
          kernel,
          requestJson,
          csvBytes,
          supportFilesHandle,
          options,
          `sha256:${inputSha256}`,
          persistedReviewOnly,
        ),
      { bytes: csvBytes.byteLength, items: 1 },
    );
    const hasPersistedReviewBase =
      materialization === "review" &&
      (reviewBaseProbe.byteLength > 0 ||
        reconstructionBaseProbe.byteLength > 0);
    const probes = hasPersistedReviewBase
      ? {
          reviewProbe: reviewBaseProbe,
          reconstructionProbe: reconstructionBaseProbe,
          descriptors: persistedReviewDescriptors,
        }
      : undefined;
    let suppliedReviewBaseBytes = probes?.reviewProbe.byteLength ?? 0;
    let suppliedReconstructionBaseBytes =
      probes?.reconstructionProbe.byteLength ?? 0;
    let kernelBoundaryBytes = probes
      ? probes.reviewProbe.byteLength + probes.reconstructionProbe.byteLength
      : csvBytes.byteLength;
    const runKernel = () =>
      traced(
        "kernel",
        async () => {
          if (!probes) {
            if (persistedReviewOnly) throw new PersistedReviewMiss();
            return kernel.execute_workspace(
              requestJson,
              csvBytes,
              supportFilesHandle,
            );
          }
          const prepared = kernel.prepare_persisted_workspace_review(
            requestJson,
            inputSizeBytes,
            probes.reviewProbe,
            probes.reconstructionProbe,
            supportFilesHandle,
          );
          try {
            const required = prepared.required_base_kind();
            if (
              required !== "none" &&
              required !== "salsa-memory" &&
              required !== "review-base" &&
              required !== "reconstruction-base"
            ) {
              throw new Error(
                `Rust selected an unknown review base: ${required}`,
              );
            }
            if (
              persistedReviewOnly &&
              required === "salsa-memory" &&
              requiresLiveScientificPreflight(options)
            ) {
              // A warm Salsa engine holds no persisted base, so there is no
              // scientific commitment for Rust to adopt and it would refuse the
              // run for the raw file. Report the miss here rather than making the
              // caller read that refusal out of an exception message.
              throw new PersistedReviewMiss();
            }
            if (required === "salsa-memory") {
              return prepared.execute_selected_base(new Uint8Array());
            }
            if (required === "none") {
              if (persistedReviewOnly) throw new PersistedReviewMiss();
              kernelBoundaryBytes += csvBytes.byteLength;
              return kernel.execute_workspace(
                requestJson,
                csvBytes,
                supportFilesHandle,
              );
            }
            if (!opfsRoot || !recoveredRoot || !persistedReviewExpected) {
              throw new Error(
                "persisted Rust review selection lost its workspace",
              );
            }
            const selected = await readCachedSelectedPersistedRustReviewBase(
              opfsRoot,
              recoveredRoot,
              persistedReviewExpected,
              required,
              probes.descriptors.get(required) ??
                (() => {
                  throw new Error(
                    `persisted Rust workspace is missing ${required}`,
                  );
                })(),
            );
            if (required === "review-base") {
              suppliedReviewBaseBytes += selected.byteLength;
              kernelBoundaryBytes += selected.byteLength;
              return prepared.execute_selected_base(selected);
            }
            // A reconstruction resume needs both complete envelopes: the
            // reconstruction base carries the validated reconstruction and
            // foundational receipts while the independently keyed review base
            // carries the annotation substrate, and the kernel fails closed on
            // a header-only review base.
            const reviewCompanion =
              await readCachedSelectedPersistedRustReviewBase(
                opfsRoot,
                recoveredRoot,
                persistedReviewExpected,
                "review-base",
                probes.descriptors.get("review-base") ??
                  (() => {
                    throw new Error(
                      "persisted Rust workspace is missing review-base",
                    );
                  })(),
              );
            suppliedReviewBaseBytes += reviewCompanion.byteLength;
            suppliedReconstructionBaseBytes += selected.byteLength;
            kernelBoundaryBytes +=
              reviewCompanion.byteLength + selected.byteLength;
            return prepared.execute_selected_base_pair(
              reviewCompanion,
              selected,
            );
          } finally {
            prepared.free();
          }
        },
        {
          bytes: () => kernelBoundaryBytes,
          items: 1,
        },
      );
    try {
      handle = await runKernel();
    } catch (error) {
      throw describeOpenBindingHolesError(
        error,
        kernel,
        requestJson,
        csvBytes,
        runtimeSupportFiles,
      );
    }
    let manifestValue: unknown;
    let manifestJson: string;
    try {
      manifestJson = handle.manifest_json();
      manifestValue = JSON.parse(manifestJson);
    } catch (error) {
      throw new Error(
        `runtime manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (materialization === "review") {
      const decodedReview = decodeReviewRuntimeEnvelope(
        manifestValue,
        methodProfileReviewArtifactJson(runtime),
      );
      const manifest = decodedReview.execution;
      verifyOpenerExecutionAgreement(
        manifest.optionsDigest,
        manifest.openerSetReceipt,
        openerSetPreflight,
        "review manifest",
        "reviewManifest.openerSetReceipt",
      );
      verifyMaximumDurationExecutionAgreement(
        manifest.optionsDigest,
        manifest.maximumDurationReceipt,
        maximumDurationPreflight,
        "review manifest",
        "reviewManifest.maximumDurationReceipt",
      );
      if (manifest.workspaceId !== workspaceId) {
        throw new Error("review manifest workspace identity mismatch");
      }
      if (manifest.inputDigest !== `sha256:${inputSha256}`) {
        throw new Error("review manifest input identity mismatch");
      }
      if (
        manifest.previousWorkspaceRootDigest !== previousWorkspaceRootDigest
      ) {
        throw new Error("review manifest previous-root identity mismatch");
      }
      if (
        manifest.implementationDigest !== kernel.implementation_build_digest()
      ) {
        throw new Error("review manifest implementation identity mismatch");
      }
      if (
        manifest.buildEnvironmentDigest !== kernel.build_environment_digest()
      ) {
        throw new Error("review manifest build-environment identity mismatch");
      }
      if (
        manifest.reviewSummaryReused &&
        !knownReviewSummaryDigests?.includes(manifest.reviewSummaryDigest)
      ) {
        throw new Error(
          "review manifest reused a summary digest the caller never offered",
        );
      }
      const reviewSummaryJsonBytes = await extractAndVerifyReviewArtifacts(
        handle,
        decodedReview.artifactCatalog,
        decodedReview.expectedArtifactJson,
        traced,
      );
      if (!manifest.reviewSummaryReused && !reviewSummaryJsonBytes) {
        throw new Error("cold review query did not expose its summary bytes");
      }
      executionSucceeded = true;
      return {
        ...manifest,
        manifestJson,
        ...(reviewSummaryJsonBytes ? { reviewSummaryJsonBytes } : {}),
        suppliedReviewBaseBytes,
        suppliedReconstructionBaseBytes,
      };
    }
    const manifest = decodeRuntimeManifest(manifestValue);
    verifyOpenerExecutionAgreement(
      manifest.optionsDigest,
      manifest.processingSummary.openerSetReceipt,
      openerSetPreflight,
      "runtime manifest",
      "manifest.processingSummary.openerSetReceipt",
    );
    verifyMaximumDurationExecutionAgreement(
      manifest.optionsDigest,
      manifest.processingSummary.maximumDurationReceipt,
      maximumDurationPreflight,
      "runtime manifest",
      "manifest.processingSummary.maximumDurationReceipt",
    );
    if (manifest.requestId !== requestId) {
      throw new Error("runtime manifest request identity mismatch");
    }
    if (manifest.workspaceId !== workspaceId) {
      throw new Error("runtime manifest workspace identity mismatch");
    }
    if (
      manifest.implementationDigest !== kernel.implementation_build_digest()
    ) {
      throw new Error("runtime manifest implementation identity mismatch");
    }
    if (manifest.buildEnvironmentDigest !== kernel.build_environment_digest()) {
      throw new Error("runtime manifest build-environment identity mismatch");
    }
    if (
      manifest.input.digest !== `sha256:${inputSha256}` ||
      manifest.input.size !== csvBytes.byteLength
    ) {
      throw new Error("runtime manifest input identity mismatch");
    }
    if (manifest.previousWorkspaceRootDigest !== previousWorkspaceRootDigest) {
      throw new Error("runtime manifest previous-root identity mismatch");
    }
    const runtimeHandle = handle;
    const artifacts = new Map<string, Uint8Array>();
    const handleMetadata = new Map<string, RuntimeArtifactMetadata>();
    const handleArtifacts: Array<{
      index: number;
      metadata: RuntimeArtifactMetadata;
    }> = [];
    for (let index = 0; index < handle.artifact_count; index += 1) {
      let metadataValue: unknown;
      try {
        metadataValue = JSON.parse(handle.artifact_metadata_json(index));
      } catch (error) {
        throw new Error(
          `runtime artifact metadata is not valid JSON at index ${index}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      const metadata = artifactMetadataAt(
        metadataValue,
        `artifactMetadata[${index}]`,
      );
      if (handleMetadata.has(metadata.kind)) {
        throw new Error(`duplicate runtime artifact kind: ${metadata.kind}`);
      }
      handleMetadata.set(metadata.kind, metadata);
      handleArtifacts.push({ index, metadata });
    }
    verifyRuntimeArtifactCatalog(manifest, [...handleMetadata.values()]);
    const streamToOpfs =
      runtime.persistRustWorkspace &&
      opfsRoot !== undefined &&
      persistenceAdapter === defaultPersistenceAdapter;
    const callerArtifactKinds = new Set([
      "execution-ledger-json",
      "workflow-explorer-view-json",
      ...(options.enableInteractiveTimeline && !streamToOpfs
        ? ["visualization-data-json"]
        : []),
    ]);
    let persistedWorkspace: WorkspaceRootSlot | undefined;
    if (streamToOpfs && opfsRoot) {
      const workspaceRoot = opfsRoot;
      const persistedMetadata: PersistedRuntimeArtifactMetadata[] = [];
      // Take, verify, and store one artifact at a time. WASM memory can be
      // released before the next 40–100 MB artifact crosses into JavaScript.
      const sortedHandleArtifacts = [...handleArtifacts].sort(
        (left, right) => right.metadata.size - left.metadata.size,
      );
      for (let start = 0; start < sortedHandleArtifacts.length; start += 2) {
        const batchMetadata = sortedHandleArtifacts.slice(start, start + 2);
        const batchBytes = batchMetadata.reduce(
          (total, { metadata }) => total + metadata.size,
          0,
        );
        const batch = await traced(
          "artifact-extract",
          () =>
            batchMetadata.map(({ index, metadata }) => ({
              metadata,
              bytes: runtimeHandle.take_artifact_bytes(index),
            })),
          { bytes: batchBytes, items: batchMetadata.length },
        );
        await traced(
          "opfs-object-placement",
          () =>
            persistRuntimeObjects(
              workspaceRoot,
              batch.map(({ metadata, bytes }) => ({
                ...metadata,
                bytes,
                digestVerified: true,
              })),
            ),
          { bytes: batchBytes, items: batch.length },
        );
        for (const { metadata, bytes } of batch) {
          if (callerArtifactKinds.has(metadata.kind)) {
            artifacts.set(metadata.kind, bytes);
          }
          persistedMetadata.push({ ...metadata, digestVerified: true });
        }
      }
      const ingressArtifacts: PersistedRuntimeArtifact[] = [];
      for (const assignment of manifest.roleAssignments) {
        if (assignment.role_id === "processing_options") continue;
        const bytes = ingressBytesByRole.get(assignment.role_id);
        if (!bytes) {
          throw new Error(
            `runtime declared an unknown ingress role: ${assignment.role_id}`,
          );
        }
        if (assignment.artifact.size !== bytes.byteLength) {
          throw new Error(
            `runtime ingress assignment integrity mismatch: ${assignment.role_id}`,
          );
        }
        const metadata = {
          kind: `ingress:${assignment.role_id}`,
          digest: assignment.artifact.digest,
          size: assignment.artifact.size,
          digestVerified: true as const,
        };
        ingressArtifacts.push({ ...metadata, bytes });
        persistedMetadata.push(metadata);
      }
      const ingressBytes = ingressArtifacts.reduce(
        (total, artifact) => total + artifact.size,
        0,
      );
      await traced(
        "opfs-ingress-placement",
        () => persistRuntimeObjects(workspaceRoot, ingressArtifacts),
        { bytes: ingressBytes, items: ingressArtifacts.length },
      );
      await traced(
        "new-root-verification",
        async () =>
          verifyRootClosure(
            await readRuntimeObject(workspaceRoot, manifest.workspaceRootDigest),
            (digest) => readRuntimeObject(workspaceRoot, digest),
            [...new Set(persistedMetadata.map(({ digest }) => digest))],
            manifest.previousWorkspaceRootDigest,
            kernel,
            workspaceId,
            manifest.workspaceRootDigest,
            false,
            new Map(persistedMetadata.map(({ digest, size }) => [digest, size])),
          ),
        { items: persistedMetadata.length },
      );
      persistedWorkspace = await traced("root-commit", () =>
        commitPersistedRuntimeWorkspace(workspaceRoot, {
          workspaceRootDigest: manifest.workspaceRootDigest,
          previousWorkspaceRootDigest: manifest.previousWorkspaceRootDigest,
          artifacts: persistedMetadata,
          recoveredSlot: recoveredRoot,
        }),
      );
    } else {
      const extractedArtifacts: Array<{
        metadata: RuntimeArtifactMetadata;
        bytes: Uint8Array;
      }> = [];
      for (const { index, metadata } of handleArtifacts) {
        const bytes = handle.take_artifact_bytes(index);
        if (metadata.size !== bytes.byteLength) {
          throw new Error(
            `runtime artifact integrity mismatch: ${metadata.kind}`,
          );
        }
        extractedArtifacts.push({ metadata, bytes });
      }
      const verificationQueue = [...extractedArtifacts].sort(
        (left, right) => right.bytes.byteLength - left.bytes.byteLength,
      );
      let verificationIndex = 0;
      const verifyNext = async (): Promise<void> => {
        for (;;) {
          const entry = verificationQueue[verificationIndex];
          verificationIndex += 1;
          if (!entry) return;
          if (
            entry.metadata.digest !== `sha256:${await sha256Hex(entry.bytes)}`
          ) {
            throw new Error(
              `runtime artifact integrity mismatch: ${entry.metadata.kind}`,
            );
          }
        }
      };
      await Promise.all([verifyNext(), verifyNext()]);
      const persistedArtifacts: PersistedRuntimeArtifact[] =
        extractedArtifacts.map(({ metadata, bytes }) => ({
          ...metadata,
          bytes,
          digestVerified: true,
        }));
      for (const { metadata, bytes } of extractedArtifacts) {
        artifacts.set(metadata.kind, bytes);
      }
      for (const assignment of manifest.roleAssignments) {
        if (assignment.role_id === "processing_options") continue;
        const bytes = ingressBytesByRole.get(assignment.role_id);
        if (!bytes) {
          throw new Error(
            `runtime declared an unknown ingress role: ${assignment.role_id}`,
          );
        }
        if (assignment.artifact.size !== bytes.byteLength) {
          throw new Error(
            `runtime ingress assignment size mismatch: ${assignment.role_id}`,
          );
        }
        persistedArtifacts.push({
          kind: `ingress:${assignment.role_id}`,
          digest: assignment.artifact.digest,
          size: assignment.artifact.size,
          bytes,
          digestVerified: true,
        });
      }
      const persistedByDigest = new Map(
        persistedArtifacts.map((artifact) => [artifact.digest, artifact.bytes]),
      );
      const storedRootBytes = persistedByDigest.get(
        manifest.workspaceRootDigest,
      );
      const rootBytes = storedRootBytes && Uint8Array.from(storedRootBytes);
      if (!rootBytes) {
        throw new Error("runtime artifact set is missing its workspace root");
      }
      await verifyRootClosure(
        rootBytes,
        (digest) => {
          const bytes = persistedByDigest.get(digest);
          if (!bytes)
            throw new Error(`runtime artifact set is missing ${digest}`);
          return Uint8Array.from(bytes);
        },
        [...persistedByDigest.keys()],
        manifest.previousWorkspaceRootDigest,
        kernel,
        workspaceId,
        manifest.workspaceRootDigest,
        false,
      );
      persistedWorkspace =
        runtime.persistRustWorkspace && opfsRoot
          ? await persistenceAdapter.persist(opfsRoot, {
              workspaceRootDigest: manifest.workspaceRootDigest,
              previousWorkspaceRootDigest: manifest.previousWorkspaceRootDigest,
              artifacts: persistedArtifacts,
              recoveredSlot: recoveredRoot,
            })
          : undefined;
    }
    if (runtime.persistRustWorkspace) {
      ephemeralContinuation = undefined;
    } else {
      ephemeralContinuation = {
        workspaceId,
        workspaceRootDigest: manifest.workspaceRootDigest,
      };
    }
    // The complete closure was verified above, and the OPFS adapter returned
    // only after per-object read-back verification and an atomic root commit.
    // Keep only the small views the immediate browser projection parses;
    // downloadable outputs use receipt-pinned OPFS locators.
    if (materialization === "full" && persistedWorkspace) {
      for (const kind of artifacts.keys()) {
        if (!callerArtifactKinds.has(kind)) artifacts.delete(kind);
      }
    }
    executionSucceeded = true;
    return {
      workspaceId,
      manifestJson,
      manifest,
      artifacts,
      persistedWorkspace,
    };
  } finally {
    // A trapped WASM call can leave wasm-bindgen's internal borrow flag set.
    // Cleanup must not replace the primary execution error with a secondary
    // "attempted to take ownership while borrowed" exception.
    try {
      handle?.free();
    } catch (error) {
      console.warn("Could not release trapped Rust runtime handle", error);
    }
    if (runtimeSupportCacheEntry) {
      if (!executionSucceeded) runtimeSupportCacheEntry.entry.invalid = true;
      releaseRuntimeSupportFilesCacheEntry(
        runtimeSupportCacheEntry.key,
        runtimeSupportCacheEntry.entry,
      );
    } else {
      try {
        runtimeSupportFiles?.free();
      } catch (error) {
        console.warn("Could not release trapped Rust support handle", error);
      }
    }
  }
}

/**
 * `reject_open_binding_holes` names the roles it refused and nothing else.
 *
 * That one message covers two different problems: a support file that was never
 * supplied, and a supplied file whose schema was rejected. The reason for the
 * second — either of `validate_support_csv`'s two arms in `pipeline_v2.rs`:
 * "{role}: missing required column(s) ..." for a role with a fixed column set,
 * or "{role}: requires one of columns ...", the arm `filter_file` and the two
 * package-list roles take because they accept either `app_package_name` or
 * `package_name` (line numbers deliberately omitted; both literals are
 * greppable and the file moves) — is computed during qualification, stored as the `content_validation_error`
 * qualifier on the role assignment, and then read only as the boolean
 * `content_validation` sibling, so it never reaches the failure. The user was
 * told to "evaluate requirements before execution" by a message from a function
 * the app never called.
 *
 * It is called here, on the failure path only, with the same request and the
 * same support handle, and its report carries the qualifier verbatim.
 */
const OPEN_BINDING_HOLES_PREFIX =
  "unresolved binding holes for required roles: ";

export function parseOpenBindingHoleRoles(message: string): string[] {
  const start = message.indexOf(OPEN_BINDING_HOLES_PREFIX);
  if (start < 0) return [];
  const rest = message.slice(start + OPEN_BINDING_HOLES_PREFIX.length);
  const end = rest.indexOf(";");
  return (end < 0 ? rest : rest.slice(0, end))
    .split(",")
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
}

/** One sentence per refused role, naming the column when Rust named it. */
export function describeOpenBindingHoles(
  reportJson: string,
  roles: readonly string[],
): string | null {
  let report: {
    roleAssignments?: Array<{
      role_id?: unknown;
      qualifiers?: Record<string, unknown>;
    }>;
    roleStates?: Record<string, unknown>;
  };
  try {
    report = JSON.parse(reportJson) as typeof report;
  } catch {
    return null;
  }
  const details: string[] = [];
  for (const role of roles) {
    const reasons = new Set<string>();
    for (const assignment of report.roleAssignments ?? []) {
      if (assignment.role_id !== role) continue;
      const reason = assignment.qualifiers?.["content_validation_error"];
      if (typeof reason === "string" && reason.length) reasons.add(reason);
    }
    if (reasons.size) {
      details.push(...reasons);
      continue;
    }
    // `MaterializationState` has six variants and only two of them can be
    // described without guessing. Everything else — `ready`, `satisfied`,
    // `blocked`, `not_applicable`, or a role the report does not mention at
    // all — means the re-query disagrees with the execution that just failed
    // (they are separate ingress materializations, so they can race). Inventing
    // "no file is bound" there would REPLACE the kernel's real refusal with a
    // fabrication while a file is in fact bound, so the whole enrichment is
    // abandoned and the original refusal stands.
    const state = report.roleStates?.[role];
    if (state === "invalid") {
      details.push(`${role}: the supplied file was rejected`);
    } else if (state === "open") {
      details.push(`${role}: no file is bound to this required role`);
    } else {
      return null;
    }
  }
  return details.length ? details.join("; ") : null;
}

/**
 * The kernel's refusal for required roles, re-described from the requirements
 * report; the original error when it names no role or cannot be described.
 */
function describeOpenBindingHolesError(
  error: unknown,
  kernel: KernelModule,
  requestJson: string,
  csvBytes: Uint8Array,
  supportFiles: RuntimeSupportFilesHandle,
): unknown {
  const message = error instanceof Error ? error.message : String(error);
  const roles = parseOpenBindingHoleRoles(message);
  if (!roles.length || !kernel.evaluate_workspace_requirements) return error;
  let detail: string | null;
  try {
    detail = describeOpenBindingHoles(
      kernel.evaluate_workspace_requirements(requestJson, csvBytes, supportFiles),
      roles,
    );
  } catch {
    // The report is a diagnostic. If it cannot be produced, the original
    // refusal is still the truth and must not be replaced by this failure.
    detail = null;
  }
  if (!detail) return error;
  return new Error(openBindingHolesMessage(message, detail), { cause: error });
}

export function openBindingHolesMessage(
  originalMessage: string,
  detail: string,
): string {
  return (
    `Support file requirements are not met — ${detail}. ` +
    "Fix the file's columns, supply the file, or turn off the option that " +
    `requires it, then run again. (${originalMessage})`
  );
}

export async function runtimeWorkspaceId(
  _inputFileName: string,
  csvBytes: Uint8Array,
  verifiedInputSha256?: string,
): Promise<string> {
  const inputDigest = verifiedInputSha256 ?? (await sha256Hex(csvBytes));
  if (!/^[0-9a-f]{64}$/.test(inputDigest)) {
    throw new Error(
      "verified input digest must be 64 lowercase hexadecimal characters",
    );
  }
  // A filename is a display/output label, not a computational input: the Rust
  // runtime validates it but never reads it while producing artifacts. Keying
  // the workspace by content lets renamed or duplicated files share the same
  // content-addressed history instead of writing identical 100 MB objects to
  // separate OPFS stores.
  return `sha256:${await sha256Hex(
    new TextEncoder().encode(`chronicle-workflow-v1-workspace:${inputDigest}`),
  )}`;
}

async function withWorkspaceLock<T>(
  workspaceId: string,
  operation: () => Promise<T>,
  mode: "exclusive" | "shared" = "exclusive",
): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    throw new Error(
      "Durable workspace mutation requires the browser Web Locks API",
    );
  }
  return navigator.locks.request(
    `chronicle-workflow-v1:${workspaceId}`,
    { mode },
    operation,
  );
}

export async function executeRustRuntime(
  csvBytes: Uint8Array,
  inputFileName: string,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
  verifiedInputSha256?: string,
  participantPartition?: ParticipantPartitionTransport,
): Promise<RustRuntimeExecution> {
  const inputSha256 = verifiedInputSha256 ?? (await sha256Hex(csvBytes));
  const workspaceId = await runtimeWorkspaceId(
    inputFileName,
    csvBytes,
    inputSha256,
  );
  const execute = () =>
    executeRustRuntimeUnlocked(
      workspaceId,
      csvBytes,
      csvBytes.byteLength,
      inputFileName,
      options,
      supportFiles,
      runtime,
      inputSha256,
      "full",
      false,
      undefined,
      undefined,
      participantPartition,
    );
  if (!runtime.persistRustWorkspace) return execute();
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    if (persistenceAdapter === defaultPersistenceAdapter) {
      throw new Error(
        "Durable processing requires the browser Web Locks API to serialize workspace commits",
      );
    }
    return execute();
  }
  return withWorkspaceLock(workspaceId, execute);
}

export type LiteratureComponentRuntimeManifest = {
  protocolVersion: "chronicle-literature-component-runtime/v1";
  requestId: string;
  command: "ExecuteLiteratureComponent";
  workspaceId: string;
  previousWorkspaceRootDigest: string | null;
  workspaceRootDigest: string;
  artifactClosureDigest: string;
  inputFileName: string;
  inputDigest: string;
  componentId: string;
  componentExecutionReceiptDigest: string;
  sourceRowCount: number;
  derivedResultRowCount: number;
  implementationDigest: string;
  buildEnvironmentDigest: string;
  inputAdapterContractDigest: string;
  inputAdapterConformanceDigest: string;
  androidMethodProfileRegistryContentDigest: string;
  artifacts: RuntimeArtifactMetadata[];
};

export type LiteratureComponentExecutionReceipt = {
  protocolVersion: "chronicle-literature-component-execution-receipt/v1";
  componentId: string;
  componentExecutionStatus: "executed";
  fullProfileExecutionStatus: "blocked";
  parentMethodProfileId: string;
  sourceWorkId: string;
  sourceMethodVariantId: string;
  methodProfileVersion: string;
  settingIds: string[];
  limitations: string[];
  originalInputDigest: string;
  supportArtifactDigests: Record<string, string>;
  supportAdapterInputDigests: Record<string, string>;
  supportFormats: Record<string, string>;
  componentMethodReceiptDigest: string;
  adaptationReceiptDigest: string;
  derivedResultKind: string;
  derivedResultDigest: string;
  derivedResultRowCount: number;
  oracleId: string;
  kernelInputEligible: false;
  canonicalKernelInputDigest: null;
  implementationDigest: string;
  buildEnvironmentDigest: string;
  inputAdapterContractDigest: string;
  inputAdapterConformanceDigest: string;
  androidMethodProfileRegistryContentDigest: string;
};

export type LiteratureComponentArtifactResult = {
  metadata: RuntimeArtifactMetadata;
  /** Present only when the caller explicitly chose the ephemeral branch. */
  bytes?: Uint8Array;
  /** Present only after the complete component root was committed to OPFS. */
  persistedArtifact?: {
    workspaceId: string;
    workspaceRootDigest: string;
    kind: string;
    mediaType: string;
    size: number;
  };
};

export type LiteratureComponentRuntimeExecution = {
  workspaceId: string;
  manifestJson: string;
  manifest: LiteratureComponentRuntimeManifest;
  componentExecutionReceipt: LiteratureComponentExecutionReceipt;
  artifacts: LiteratureComponentArtifactResult[];
  persistedWorkspace?: WorkspaceRootSlot;
};

const COMPONENT_CONTENT_KINDS = [
  "literature-component-method-receipt-json",
  "literature-input-adaptation-receipt-json",
  "literature-component-execution-receipt-json",
] as const;

function exactObjectAt(
  value: unknown,
  path: string,
  fields: readonly string[],
): Record<string, unknown> {
  const source = objectAt(value, path);
  const observed = Object.keys(source).sort();
  const expected = [...fields].sort();
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    contractError(path, "unexpected or missing fields");
  }
  return source;
}

function nullableDigestAt(value: unknown, path: string): string | null {
  return value === null ? null : digestAt(value, path);
}

function stringListAt(value: unknown, path: string): string[] {
  return arrayAt(value, path).map((entry, index) =>
    stringAt(entry, `${path}[${index}]`),
  );
}

function exactDigestRecordAt(
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, string> {
  const source = exactObjectAt(value, path, keys);
  return Object.fromEntries(
    keys.map((key) => [key, digestAt(source[key], `${path}.${key}`)]),
  );
}

function canonicalJsonArtifactAt(bytes: Uint8Array, path: string): unknown {
  const text = new TextDecoder().decode(bytes);
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${path} is not valid JSON`, { cause: error });
  }
  if (canonicalJson(value) !== text) {
    throw new Error(`${path} is not canonical JSON`);
  }
  return value;
}

function exactStringRecordAt(
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, string> {
  const source = exactObjectAt(value, path, keys);
  return Object.fromEntries(
    keys.map((key) => [key, stringAt(source[key], `${path}.${key}`)]),
  );
}

export function decodeLiteratureComponentRuntimeManifest(
  value: unknown,
): LiteratureComponentRuntimeManifest {
  const source = exactObjectAt(value, "componentManifest", [
    "protocolVersion",
    "requestId",
    "command",
    "workspaceId",
    "previousWorkspaceRootDigest",
    "workspaceRootDigest",
    "artifactClosureDigest",
    "inputFileName",
    "inputDigest",
    "componentId",
    "componentExecutionReceiptDigest",
    "sourceRowCount",
    "derivedResultRowCount",
    "implementationDigest",
    "buildEnvironmentDigest",
    "inputAdapterContractDigest",
    "inputAdapterConformanceDigest",
    "androidMethodProfileRegistryContentDigest",
    "artifacts",
  ]);
  if (
    source.protocolVersion !== "chronicle-literature-component-runtime/v1" ||
    source.command !== "ExecuteLiteratureComponent"
  ) {
    contractError("componentManifest", "unsupported protocol or command");
  }
  const artifacts = arrayAt(
    source.artifacts,
    "componentManifest.artifacts",
  ).map((artifact, index) =>
    artifactMetadataAt(artifact, `componentManifest.artifacts[${index}]`),
  );
  if (
    new Set(artifacts.map(({ kind }) => kind)).size !== artifacts.length ||
    new Set(artifacts.map(({ artifactId }) => artifactId)).size !==
      artifacts.length
  ) {
    contractError(
      "componentManifest.artifacts",
      "duplicate kind or artifact id",
    );
  }
  return {
    protocolVersion: source.protocolVersion,
    requestId: stringAt(source.requestId, "componentManifest.requestId"),
    command: source.command,
    workspaceId: digestAt(source.workspaceId, "componentManifest.workspaceId"),
    previousWorkspaceRootDigest: nullableDigestAt(
      source.previousWorkspaceRootDigest,
      "componentManifest.previousWorkspaceRootDigest",
    ),
    workspaceRootDigest: digestAt(
      source.workspaceRootDigest,
      "componentManifest.workspaceRootDigest",
    ),
    artifactClosureDigest: digestAt(
      source.artifactClosureDigest,
      "componentManifest.artifactClosureDigest",
    ),
    inputFileName: stringAt(
      source.inputFileName,
      "componentManifest.inputFileName",
    ),
    inputDigest: digestAt(source.inputDigest, "componentManifest.inputDigest"),
    componentId: stringAt(source.componentId, "componentManifest.componentId"),
    componentExecutionReceiptDigest: digestAt(
      source.componentExecutionReceiptDigest,
      "componentManifest.componentExecutionReceiptDigest",
    ),
    sourceRowCount: integerAt(
      source.sourceRowCount,
      "componentManifest.sourceRowCount",
    ),
    derivedResultRowCount: integerAt(
      source.derivedResultRowCount,
      "componentManifest.derivedResultRowCount",
    ),
    implementationDigest: digestAt(
      source.implementationDigest,
      "componentManifest.implementationDigest",
    ),
    buildEnvironmentDigest: digestAt(
      source.buildEnvironmentDigest,
      "componentManifest.buildEnvironmentDigest",
    ),
    inputAdapterContractDigest: digestAt(
      source.inputAdapterContractDigest,
      "componentManifest.inputAdapterContractDigest",
    ),
    inputAdapterConformanceDigest: digestAt(
      source.inputAdapterConformanceDigest,
      "componentManifest.inputAdapterConformanceDigest",
    ),
    androidMethodProfileRegistryContentDigest: digestAt(
      source.androidMethodProfileRegistryContentDigest,
      "componentManifest.androidMethodProfileRegistryContentDigest",
    ),
    artifacts,
  };
}

function decodeLiteratureComponentExecutionReceipt(
  value: unknown,
  registration: RegisteredLiteratureComponentExecution,
): LiteratureComponentExecutionReceipt {
  const limitationFields = registration.limitations.length
    ? ["limitations"]
    : [];
  const source = exactObjectAt(value, "componentExecutionReceipt", [
    "protocolVersion",
    "componentId",
    "componentExecutionStatus",
    "fullProfileExecutionStatus",
    "parentMethodProfileId",
    "sourceWorkId",
    "sourceMethodVariantId",
    "methodProfileVersion",
    "settingIds",
    ...limitationFields,
    "originalInputDigest",
    "supportArtifactDigests",
    "supportAdapterInputDigests",
    "supportFormats",
    "componentMethodReceiptDigest",
    "adaptationReceiptDigest",
    "derivedResultKind",
    "derivedResultDigest",
    "derivedResultRowCount",
    "oracleId",
    "kernelInputEligible",
    "canonicalKernelInputDigest",
    "implementationDigest",
    "buildEnvironmentDigest",
    "inputAdapterContractDigest",
    "inputAdapterConformanceDigest",
    "androidMethodProfileRegistryContentDigest",
  ]);
  if (
    source.protocolVersion !==
      "chronicle-literature-component-execution-receipt/v1" ||
    source.componentExecutionStatus !== "executed" ||
    source.fullProfileExecutionStatus !== "blocked" ||
    source.kernelInputEligible !== false ||
    source.canonicalKernelInputDigest !== null
  ) {
    contractError(
      "componentExecutionReceipt",
      "invalid execution or blocked-parent status",
    );
  }
  return {
    protocolVersion: source.protocolVersion,
    componentId: stringAt(
      source.componentId,
      "componentExecutionReceipt.componentId",
    ),
    componentExecutionStatus: source.componentExecutionStatus,
    fullProfileExecutionStatus: source.fullProfileExecutionStatus,
    parentMethodProfileId: stringAt(
      source.parentMethodProfileId,
      "componentExecutionReceipt.parentMethodProfileId",
    ),
    sourceWorkId: stringAt(
      source.sourceWorkId,
      "componentExecutionReceipt.sourceWorkId",
    ),
    sourceMethodVariantId: stringAt(
      source.sourceMethodVariantId,
      "componentExecutionReceipt.sourceMethodVariantId",
    ),
    methodProfileVersion: stringAt(
      source.methodProfileVersion,
      "componentExecutionReceipt.methodProfileVersion",
    ),
    settingIds: stringListAt(
      source.settingIds,
      "componentExecutionReceipt.settingIds",
    ),
    limitations: registration.limitations.length
      ? stringListAt(
          source.limitations,
          "componentExecutionReceipt.limitations",
        )
      : [],
    originalInputDigest: digestAt(
      source.originalInputDigest,
      "componentExecutionReceipt.originalInputDigest",
    ),
    supportArtifactDigests: exactDigestRecordAt(
      source.supportArtifactDigests,
      "componentExecutionReceipt.supportArtifactDigests",
      registration.requiredSupportRoles,
    ),
    supportAdapterInputDigests: exactDigestRecordAt(
      source.supportAdapterInputDigests,
      "componentExecutionReceipt.supportAdapterInputDigests",
      registration.requiredSupportRoles,
    ),
    supportFormats: exactStringRecordAt(
      source.supportFormats,
      "componentExecutionReceipt.supportFormats",
      registration.requiredSupportRoles,
    ),
    componentMethodReceiptDigest: digestAt(
      source.componentMethodReceiptDigest,
      "componentExecutionReceipt.componentMethodReceiptDigest",
    ),
    adaptationReceiptDigest: digestAt(
      source.adaptationReceiptDigest,
      "componentExecutionReceipt.adaptationReceiptDigest",
    ),
    derivedResultKind: stringAt(
      source.derivedResultKind,
      "componentExecutionReceipt.derivedResultKind",
    ),
    derivedResultDigest: digestAt(
      source.derivedResultDigest,
      "componentExecutionReceipt.derivedResultDigest",
    ),
    derivedResultRowCount: integerAt(
      source.derivedResultRowCount,
      "componentExecutionReceipt.derivedResultRowCount",
    ),
    oracleId: stringAt(source.oracleId, "componentExecutionReceipt.oracleId"),
    kernelInputEligible: source.kernelInputEligible,
    canonicalKernelInputDigest: source.canonicalKernelInputDigest,
    implementationDigest: digestAt(
      source.implementationDigest,
      "componentExecutionReceipt.implementationDigest",
    ),
    buildEnvironmentDigest: digestAt(
      source.buildEnvironmentDigest,
      "componentExecutionReceipt.buildEnvironmentDigest",
    ),
    inputAdapterContractDigest: digestAt(
      source.inputAdapterContractDigest,
      "componentExecutionReceipt.inputAdapterContractDigest",
    ),
    inputAdapterConformanceDigest: digestAt(
      source.inputAdapterConformanceDigest,
      "componentExecutionReceipt.inputAdapterConformanceDigest",
    ),
    androidMethodProfileRegistryContentDigest: digestAt(
      source.androidMethodProfileRegistryContentDigest,
      "componentExecutionReceipt.androidMethodProfileRegistryContentDigest",
    ),
  };
}

function assertComponentRegistrationIdentity(
  source: Record<string, unknown>,
  path: string,
  registration: RegisteredLiteratureComponentExecution,
): void {
  if (
    source.componentId !== registration.componentId ||
    source.parentMethodProfileId !== registration.parentMethodProfileId ||
    source.fullProfileExecutionStatus !== "blocked" ||
    source.sourceWorkId !== registration.sourceWorkId ||
    source.sourceMethodVariantId !== registration.sourceMethodVariantId ||
    source.methodProfileVersion !== registration.methodProfileVersion ||
    canonicalJson(source.settingIds) !==
      canonicalJson(registration.methodSettingIds)
  ) {
    contractError(path, "component registration identity mismatch");
  }
}

const COMPONENT_IDENTITY_FIELDS = [
  "workspaceId",
  "previousWorkspaceRootDigest",
  "inputDigest",
  "assignmentDigests",
  "supportArtifactDigests",
  "supportAdapterInputDigests",
  "componentId",
  "parentMethodProfileId",
  "fullProfileExecutionStatus",
  "sourceWorkId",
  "sourceMethodVariantId",
  "methodProfileVersion",
  "settingIds",
  "componentExecutionReceiptDigest",
  "oracleId",
  "implementationDigest",
  "buildEnvironmentDigest",
  "inputAdapterContractDigest",
  "inputAdapterConformanceDigest",
  "androidMethodProfileRegistryContentDigest",
] as const;

function componentAdapterIds(registration: RegisteredLiteratureComponentExecution): string[] {
  return [...new Set(registration.methodSettingIds.map((settingId) => {
    const adapter = requireDefined(
      literatureInputAdapterForSetting(settingId),
      "every registered literature component setting has an input adapter",
    );
    return `${adapter.adapterId}/${adapter.adapterVersion}`;
  }))].sort();
}

async function verifyLiteratureComponentRoot(
  rootBytes: Uint8Array,
  readObject: (digest: string) => Promise<Uint8Array>,
  registration: RegisteredLiteratureComponentExecution,
  expected: {
    workspaceId: string;
    workspaceRootDigest: string;
    previousWorkspaceRootDigest: string | null;
    inputDigest: string;
    supportDigests?: Record<string, string>;
    manifest?: LiteratureComponentRuntimeManifest;
  },
): Promise<void> {
  if (`sha256:${await sha256Hex(rootBytes)}` !== expected.workspaceRootDigest) {
    throw new Error("literature component workspace-root digest mismatch");
  }
  const root = exactObjectAt(
    canonicalJsonArtifactAt(rootBytes, "literature component workspace root"),
    "componentRoot",
    [
      "protocolVersion",
      ...COMPONENT_IDENTITY_FIELDS,
      "artifactDigests",
      "artifactClosureDigest",
    ],
  );
  if (root.protocolVersion !== "chronicle-literature-component-root/v1") {
    contractError("componentRoot.protocolVersion", "unsupported protocol");
  }
  assertComponentRegistrationIdentity(root, "componentRoot", registration);
  const workspaceId = digestAt(root.workspaceId, "componentRoot.workspaceId");
  const previous = nullableDigestAt(
    root.previousWorkspaceRootDigest,
    "componentRoot.previousWorkspaceRootDigest",
  );
  const inputDigest = digestAt(root.inputDigest, "componentRoot.inputDigest");
  if (
    workspaceId !== expected.workspaceId ||
    workspaceId !== await literatureComponentWorkspaceId(registration.componentId, inputDigest.slice(7)) ||
    previous !== expected.previousWorkspaceRootDigest ||
    inputDigest !== expected.inputDigest
  ) {
    throw new Error("literature component workspace-root identity mismatch");
  }
  const assignments = exactDigestRecordAt(
    root.assignmentDigests,
    "componentRoot.assignmentDigests",
    [literatureComponentInputRole(registration), ...registration.requiredSupportRoles],
  );
  const supportArtifacts = exactDigestRecordAt(
    root.supportArtifactDigests,
    "componentRoot.supportArtifactDigests",
    registration.requiredSupportRoles,
  );
  const supportInputs = exactDigestRecordAt(
    root.supportAdapterInputDigests,
    "componentRoot.supportAdapterInputDigests",
    registration.requiredSupportRoles,
  );
  if (
    assignments[literatureComponentInputRole(registration)] !== inputDigest ||
    registration.requiredSupportRoles.some(
      (role) =>
        assignments[role] !== supportArtifacts[role] ||
        supportInputs[role] !== supportArtifacts[role] ||
        (expected.supportDigests !== undefined &&
          supportArtifacts[role] !== expected.supportDigests[role]),
    )
  ) {
    throw new Error("literature component ingress assignment mismatch");
  }
  const closureDigest = digestAt(
    root.artifactClosureDigest,
    "componentRoot.artifactClosureDigest",
  );
  const artifactDigests = stringListAt(
    root.artifactDigests,
    "componentRoot.artifactDigests",
  ).map((digest, index) =>
    digestAt(digest, `componentRoot.artifactDigests[${index}]`),
  );
  if (
    new Set(artifactDigests).size !== artifactDigests.length ||
    !artifactDigests.includes(closureDigest)
  ) {
    throw new Error("literature component root artifact set is invalid");
  }
  const closureBytes = await readObject(closureDigest);
  let closure: Record<string, unknown>;
  try {
    closure = exactObjectAt(canonicalJsonArtifactAt(closureBytes, "literature component artifact closure"), "componentClosure", ["protocolVersion", ...COMPONENT_IDENTITY_FIELDS, "artifacts"]);
  } finally {
    closureBytes.fill(0);
  }
  if (
    closure.protocolVersion !==
    "chronicle-literature-component-artifact-closure/v1"
  ) {
    contractError("componentClosure.protocolVersion", "unsupported protocol");
  }
  assertComponentRegistrationIdentity(
    closure,
    "componentClosure",
    registration,
  );
  for (const field of COMPONENT_IDENTITY_FIELDS) {
    if (canonicalJson(root[field]) !== canonicalJson(closure[field])) {
      throw new Error(
        `literature component root/closure identity mismatch: ${field}`,
      );
    }
  }
  const closureArtifacts = arrayAt(
    closure.artifacts,
    "componentClosure.artifacts",
  ).map((artifact, index) =>
    artifactMetadataAt(artifact, `componentClosure.artifacts[${index}]`),
  );
  const expectedContentKinds = new Set([
    ...COMPONENT_CONTENT_KINDS,
    registration.derivedResultKind,
    ...(registration.adaptedResultKind ? [registration.adaptedResultKind] : []),
  ]);
  if (
    closureArtifacts.length !== expectedContentKinds.size ||
    new Set(closureArtifacts.map(({ kind }) => kind)).size !==
      closureArtifacts.length ||
    closureArtifacts.some(({ kind }) => !expectedContentKinds.has(kind))
  ) {
    throw new Error("literature component closure content set is invalid");
  }
  const expectedRootDigests = [
    ...closureArtifacts.map(({ digest }) => digest),
    closureDigest,
  ].sort();
  if (
    canonicalJson([...artifactDigests].sort()) !==
    canonicalJson(expectedRootDigests)
  ) {
    throw new Error("literature component root/closure digest set mismatch");
  }
  if (expected.manifest) {
    const byKind = new Map(
      expected.manifest.artifacts.map((metadata) => [metadata.kind, metadata]),
    );
    for (const metadata of closureArtifacts) {
      if (
        canonicalJson(metadata) !== canonicalJson(byKind.get(metadata.kind))
      ) {
        throw new Error(
          `literature component manifest/closure mismatch: ${metadata.kind}`,
        );
      }
    }
  }
  const receipts = new Map<string, Record<string, unknown>>();
  for (const metadata of closureArtifacts) {
    const bytes = await readObject(metadata.digest);
    try {
      if (bytes.byteLength !== metadata.size) {
        throw new Error(`literature component artifact size mismatch: ${metadata.kind}`);
      }
      if (metadata.mediaType === "application/json") {
        receipts.set(metadata.kind, objectAt(canonicalJsonArtifactAt(bytes, metadata.kind), metadata.kind));
      }
    } finally {
      bytes.fill(0);
    }
  }
  const metadataByKind = new Map(closureArtifacts.map((entry) => [entry.kind, entry]));
  // The content-set check above proved the closure holds exactly the expected
  // kinds, so every expected kind has metadata.
  const closureMetadata = (kind: string): RuntimeArtifactMetadata =>
    requireDefined(metadataByKind.get(kind), "the verified component closure holds artifact kind " + kind);
  const execution = decodeLiteratureComponentExecutionReceipt(receipts.get("literature-component-execution-receipt-json"), registration);
  const derived = closureMetadata(registration.derivedResultKind);
  assertComponentRegistrationIdentity(execution, "saved component execution", registration);
  const method = requireDefined(receipts.get("literature-component-method-receipt-json"), "the saved component method receipt is a JSON artifact");
  assertComponentRegistrationIdentity({ ...method, fullProfileExecutionStatus: method.parentProfileExecutionStatus }, "saved component method", registration);
  const adaptation = requireDefined(receipts.get("literature-input-adaptation-receipt-json"), "the saved input adaptation receipt is a JSON artifact");
  const adaptationDerived = objectAt(adaptation.derivedResult, "saved component derived result");
  const adaptationOracle = adaptation.sourceOracleId ?? (adaptation.schoedelScreenPreprocessing as { oracleId?: unknown } | undefined)?.oracleId;
  const bindingIds = arrayAt(method.inputBindings, "saved component bindings").map((binding) => stringAt(objectAt(binding, "saved binding").settingId, "saved binding setting"));
  const identityFields = ["implementationDigest", "buildEnvironmentDigest", "inputAdapterContractDigest", "inputAdapterConformanceDigest", "androidMethodProfileRegistryContentDigest"] as const;
  if (method.protocolVersion !== "chronicle-literature-component-method-receipt/v1" ||
      canonicalJson(bindingIds) !== canonicalJson(registration.methodSettingIds) ||
      canonicalJson(method.limitations ?? []) !== canonicalJson(registration.limitations) ||
      canonicalJson(execution.limitations) !== canonicalJson(registration.limitations) ||
      execution.oracleId !== registration.sourceOracleId || root.oracleId !== execution.oracleId ||
      root.componentExecutionReceiptDigest !== closureMetadata("literature-component-execution-receipt-json").digest ||
      execution.componentMethodReceiptDigest !== closureMetadata("literature-component-method-receipt-json").digest ||
      execution.adaptationReceiptDigest !== closureMetadata("literature-input-adaptation-receipt-json").digest ||
      execution.originalInputDigest !== inputDigest ||
      canonicalJson(execution.supportArtifactDigests) !== canonicalJson(supportArtifacts) ||
      canonicalJson(execution.supportAdapterInputDigests) !== canonicalJson(supportInputs) ||
      registration.requiredSupportRoles.some((role) => execution.supportFormats[role] !== "text/csv; normalizedFromXlsx=false") ||
      identityFields.some((field) => method[field] !== root[field] || execution[field] !== root[field]) ||
      derived.mediaType !== literatureComponentTableMediaType(registration) || execution.derivedResultKind !== derived.kind || execution.derivedResultDigest !== derived.digest || execution.derivedResultRowCount !== derived.rowCount ||
      adaptation.protocolVersion !== "chronicle-literature-input-adaptation-receipt/v1" ||
      adaptation.originalInputDigest !== inputDigest ||
      adaptationOracle !== registration.sourceOracleId ||
      canonicalJson(adaptation.adapterIds) !== canonicalJson(componentAdapterIds(registration)) ||
      canonicalJson(stringListAt(adaptation.settingIds, "saved adaptation settings").sort()) !== canonicalJson([...registration.methodSettingIds].sort()) ||
      adaptationDerived.kind !== derived.kind || adaptationDerived.digest !== derived.digest || adaptationDerived.rowCount !== derived.rowCount) {
    throw new Error("saved literature component receipt identity mismatch");
  }
  if (registration.adaptedResultKind) {
    const adapted = closureMetadata(registration.adaptedResultKind);
    if (adapted.mediaType !== literatureComponentTableMediaType(registration) || adapted.digest !== adaptation.adaptedInputDigest || adapted.rowCount !== adaptation.emittedRowCount) {
      throw new Error("saved literature component adapted-result receipt mismatch");
    }
  }
  for (const digest of [inputDigest, ...Object.values(supportArtifacts)]) {
    (await readObject(digest)).fill(0);
  }
}

export async function literatureComponentWorkspaceId(
  componentId: string,
  inputSha256: string,
): Promise<string> {
  if (!componentId.trim() || !/^[0-9a-f]{64}$/.test(inputSha256)) {
    throw new Error("literature component workspace identity is invalid");
  }
  return `sha256:${await sha256Hex(
    new TextEncoder().encode(
      `chronicle-literature-component-v1-workspace:${componentId}:${inputSha256}`,
    ),
  )}`;
}

/** Reopen a saved component without executing its method or trusting cached result fields. */
export async function reopenImportedLiteratureComponent(workspaceId: string, workspaceRootDigest: string): Promise<LiteratureComponentRuntimeExecution | null> {
  const rootBytes = await readPersistedRustArtifact(workspaceId, "workspace-root-json", workspaceRootDigest);
  const root = objectAt(canonicalJsonArtifactAt(rootBytes, "imported root"), "imported root");
  if (root.protocolVersion !== "chronicle-literature-component-root/v1") return null;
  const closureBytes = await readPersistedRustArtifact(workspaceId, "artifact-closure-json", workspaceRootDigest);
  const closure = objectAt(canonicalJsonArtifactAt(closureBytes, "imported closure"), "imported closure");
  const artifacts = arrayAt(closure.artifacts, "imported artifacts").map((item, index) => artifactMetadataAt(item, `imported artifacts[${index}]`));
  const adaptation = objectAt(canonicalJsonArtifactAt(await readPersistedRustArtifact(workspaceId, "literature-input-adaptation-receipt-json", workspaceRootDigest), "imported adaptation"), "imported adaptation");
  const execution = objectAt(canonicalJsonArtifactAt(await readPersistedRustArtifact(workspaceId, "literature-component-execution-receipt-json", workspaceRootDigest), "imported execution"), "imported execution");
  const closureDigest = digestAt(root.artifactClosureDigest, "imported closure digest");
  // Reconstruct only the display envelope from committed artifacts. A transport
  // request ID and original filename are not in the archive; label them as restored.
  const envelopeArtifact = (kind: string, digest: string, size: number, derivedFrom: string[]): RuntimeArtifactMetadata => ({
    artifactId: `urn:chronicle:artifact:${kind}:${digest.slice(7)}`, kind, digest, size, derivedFrom, mediaType: "application/json",
  });
  const manifest = {
    protocolVersion: "chronicle-literature-component-runtime/v1", command: "ExecuteLiteratureComponent",
    requestId: `reopened:${workspaceRootDigest}`, inputFileName: "Restored component input",
    workspaceId, workspaceRootDigest, previousWorkspaceRootDigest: root.previousWorkspaceRootDigest,
    artifactClosureDigest: closureDigest, inputDigest: root.inputDigest, componentId: root.componentId,
    componentExecutionReceiptDigest: root.componentExecutionReceiptDigest,
    sourceRowCount: adaptation.sourceRowCount, derivedResultRowCount: execution.derivedResultRowCount,
    ...Object.fromEntries((["implementationDigest", "buildEnvironmentDigest", "inputAdapterContractDigest", "inputAdapterConformanceDigest", "androidMethodProfileRegistryContentDigest"] as const).map((key) => [key, root[key]])),
    artifacts: [...artifacts,
      envelopeArtifact("artifact-closure-json", closureDigest, closureBytes.byteLength, artifacts.map((artifact) => artifact.digest)),
      envelopeArtifact("workspace-root-json", workspaceRootDigest, rootBytes.byteLength, [closureDigest])],
  };
  return reopenLiteratureComponentResult(JSON.stringify(manifest));
}

export async function reopenLiteratureComponentResult(manifestJson: string): Promise<LiteratureComponentRuntimeExecution> {
  const manifest = decodeLiteratureComponentRuntimeManifest(JSON.parse(manifestJson));
  return withWorkspaceLock(manifest.workspaceId, async () => {
    const root = await openOpfsWorkspace(manifest.workspaceId);
    const rootBytes = await readRuntimeObject(root, manifest.workspaceRootDigest);
    const commit = objectAt(canonicalJsonArtifactAt(rootBytes, "saved component root"), "saved component root");
    const registration = literatureComponentExecutionForSettings(stringListAt(commit.settingIds, "saved component settings"));
    if (!registration || registration.componentId !== manifest.componentId) throw new Error("Saved component registration mismatch");
    const expectedKinds = [...COMPONENT_CONTENT_KINDS, registration.derivedResultKind, ...(registration.adaptedResultKind ? [registration.adaptedResultKind] : []), "artifact-closure-json", "workspace-root-json"].sort();
    if (canonicalJson(manifest.artifacts.map((artifact) => artifact.kind).sort()) !== canonicalJson(expectedKinds)) throw new Error("Saved component artifact inventory mismatch");
    await verifyLiteratureComponentRoot(rootBytes, (digest) => readRuntimeObject(root, digest), registration, {
      workspaceId: manifest.workspaceId,
      workspaceRootDigest: manifest.workspaceRootDigest,
      previousWorkspaceRootDigest: manifest.previousWorkspaceRootDigest,
      inputDigest: manifest.inputDigest,
      manifest,
    });
    const artifacts: LiteratureComponentArtifactResult[] = [];
    let receipt: LiteratureComponentExecutionReceipt | undefined;
    for (const metadata of manifest.artifacts) {
      const bytes = await readRuntimeObject(root, metadata.digest);
      try {
        if (bytes.byteLength !== metadata.size) throw new Error("Saved component artifact size mismatch");
        if (metadata.kind === "workspace-root-json" && metadata.digest !== manifest.workspaceRootDigest) throw new Error("Saved component root mismatch");
        if (metadata.kind === "artifact-closure-json" && metadata.digest !== commit.artifactClosureDigest) throw new Error("Saved component closure mismatch");
        if (metadata.kind === "literature-component-execution-receipt-json") {
          receipt = decodeLiteratureComponentExecutionReceipt(canonicalJsonArtifactAt(bytes, metadata.kind), registration);
          if (metadata.digest !== manifest.componentExecutionReceiptDigest) throw new Error("Saved component receipt mismatch");
        }
        if (metadata.kind === "literature-input-adaptation-receipt-json") {
          const adaptation = objectAt(canonicalJsonArtifactAt(bytes, metadata.kind), metadata.kind);
          if (adaptation.sourceRowCount !== manifest.sourceRowCount) throw new Error("Saved component source count mismatch");
        }
      } finally { bytes.fill(0); }
      artifacts.push({ metadata, persistedArtifact: { workspaceId: manifest.workspaceId, workspaceRootDigest: manifest.workspaceRootDigest, kind: metadata.kind, mediaType: metadata.mediaType, size: metadata.size } });
    }
    if (!receipt || receipt.derivedResultRowCount !== manifest.derivedResultRowCount || manifest.artifactClosureDigest !== commit.artifactClosureDigest ||
      (["implementationDigest", "buildEnvironmentDigest", "inputAdapterContractDigest", "inputAdapterConformanceDigest", "androidMethodProfileRegistryContentDigest"] as const).some((key) => manifest[key] !== receipt[key])) {
      throw new Error("Saved component manifest identity mismatch");
    }
    return { workspaceId: manifest.workspaceId, manifestJson, manifest, componentExecutionReceipt: receipt, artifacts };
  }, "shared");
}

async function executeLiteratureComponentRuntimeUnlocked(
  registration: RegisteredLiteratureComponentExecution,
  csvBytes: Uint8Array,
  inputFileName: string,
  supportFiles: BrowserSupportFiles,
  persist: boolean,
  inputSha256: string,
  workspaceId: string,
): Promise<LiteratureComponentRuntimeExecution> {
  if (!inputFileName.trim()) throw new Error("inputFileName is required");
  if (
    new Set(registration.requiredSupportRoles).size !==
      registration.requiredSupportRoles.length ||
    registration.requiredSupportRoles.some((role) => !role.trim())
  ) {
    throw new Error("literature component required support roles are invalid");
  }
  const registeredSupportFiles = registration.requiredSupportRoles.map(
    (role) => {
      const key = browserSupportFileKeyForRole(role);
      const file = key ? supportFiles[key] : undefined;
      if (!file) throw new Error(`${role} is required`);
      if (!file.name.toLowerCase().endsWith(".csv")) {
        throw new Error(`${role} must use source-faithful CSV format`);
      }
      const bytes = new Uint8Array(file.bytes);
      if (bytes.byteLength === 0) throw new Error(`${role} is required`);
      return { role, file, bytes };
    },
  );
  const inputDigest = `sha256:${inputSha256}`;
  const supportDigests: Record<string, string> = Object.fromEntries(
    await Promise.all(
      registeredSupportFiles.map(async ({ role, bytes }): Promise<[string, string]> => [
        role,
        `sha256:${await sha256Hex(bytes)}`,
      ]),
    ),
  );
  const singleSupport =
    registeredSupportFiles.length === 1 ? registeredSupportFiles[0] : undefined;
  const requestSupportIdentity =
    singleSupport
      ? requireDefined(
          supportDigests[singleSupport.role],
          "every registered support role was digested",
        ).slice(7, 23)
      : (
          await sha256Hex(
            new TextEncoder().encode(canonicalJson(supportDigests)),
          )
        ).slice(0, 16);
  let supportHandle: RuntimeSupportFilesHandle | null = null;
  let resultHandle: KernelHandle | null = null;
  try {
    const kernel = await loadKernel();
    if (typeof kernel.execute_literature_component !== "function") {
      throw new Error(
        "loaded Rust runtime does not expose literature component execution",
      );
    }
    let opfsRoot: FileSystemDirectoryHandle | undefined;
    let recovered: WorkspaceRootSlot | undefined;
    if (persist) {
      const componentRoot = await persistenceAdapter.openRoot(workspaceId);
      opfsRoot = componentRoot;
      recovered = await persistenceAdapter.recover(componentRoot);
      if (recovered) {
        const rootBytes = await readRuntimeObject(
          componentRoot,
          recovered.workspaceRootDigest,
        );
        await verifyLiteratureComponentRoot(
          rootBytes,
          (digest) => readRuntimeObject(componentRoot, digest),
          registration,
          {
            workspaceId,
            workspaceRootDigest: recovered.workspaceRootDigest,
            previousWorkspaceRootDigest: recovered.previousWorkspaceRootDigest,
            inputDigest,
          },
        );
      }
    }
    const previousWorkspaceRootDigest = recovered?.workspaceRootDigest ?? null;
    const requestId = `component-${inputSha256.slice(0, 16)}-${requestSupportIdentity}`;
    const requestJson = JSON.stringify({
      protocolVersion: "chronicle-preprocessing-runtime/v2",
      requestId,
      command: "ExecuteWorkspace",
      workspaceRootDigest: previousWorkspaceRootDigest,
      workspaceId,
      inputFileName,
      inputSha256: inputDigest,
      // RuntimeRequest owns this compatibility field. The component never
      // enters the event kernel and never treats these defaults as paper settings.
      options: buildRustV2Options(
        { ...DEFAULT_BROWSER_OPTIONS, selectedTimezone: "UTC" },
        {
          datetimeOfPreprocessing: "1970-01-01 00:00:00 UTC",
        },
      ),
    });
    supportHandle = new kernel.RuntimeSupportFiles();
    for (const { role, file, bytes } of registeredSupportFiles) {
      supportHandle.put_with_name(role, file.name, bytes);
    }
    resultHandle = kernel.execute_literature_component(
      registration.componentId,
      requestJson,
      csvBytes,
      supportHandle,
    );
    const manifestJson = resultHandle.manifest_json();
    const manifest = decodeLiteratureComponentRuntimeManifest(
      JSON.parse(manifestJson) as unknown,
    );
    if (
      canonicalJson(JSON.parse(manifestJson) as unknown) !== manifestJson ||
      manifest.requestId !== requestId ||
      manifest.workspaceId !== workspaceId ||
      manifest.previousWorkspaceRootDigest !== previousWorkspaceRootDigest ||
      manifest.inputFileName !== inputFileName ||
      manifest.inputDigest !== inputDigest ||
      manifest.componentId !== registration.componentId ||
      manifest.implementationDigest !== kernel.implementation_build_digest() ||
      manifest.buildEnvironmentDigest !== kernel.build_environment_digest()
    ) {
      throw new Error(
        "literature component runtime manifest identity mismatch",
      );
    }
    if (resultHandle.artifact_count !== manifest.artifacts.length) {
      throw new Error("literature component manifest/handle count mismatch");
    }
    const artifacts: Array<{
      metadata: RuntimeArtifactMetadata;
      bytes: Uint8Array;
    }> = [];
    const manifestByKind = new Map(
      manifest.artifacts.map((metadata) => [metadata.kind, metadata]),
    );
    for (let index = 0; index < resultHandle.artifact_count; index += 1) {
      const metadata = artifactMetadataAt(
        JSON.parse(resultHandle.artifact_metadata_json(index)) as unknown,
        `componentArtifactMetadata[${index}]`,
      );
      const advertised = manifestByKind.get(metadata.kind);
      if (
        !advertised ||
        canonicalJson(advertised) !== canonicalJson(metadata)
      ) {
        throw new Error(
          `literature component manifest/handle mismatch: ${metadata.kind}`,
        );
      }
      const expectedArtifactId = `urn:chronicle:artifact:${metadata.kind}:${metadata.digest.slice(7)}`;
      const bytes = resultHandle.take_artifact_bytes(index);
      if (
        metadata.artifactId !== expectedArtifactId ||
        metadata.size !== bytes.byteLength ||
        metadata.digest !== `sha256:${await sha256Hex(bytes)}`
      ) {
        throw new Error(
          `literature component artifact integrity mismatch: ${metadata.kind}`,
        );
      }
      artifacts.push({ metadata, bytes });
    }
    const expectedKinds = new Set([
      ...COMPONENT_CONTENT_KINDS,
      registration.derivedResultKind,
      ...(registration.adaptedResultKind ? [registration.adaptedResultKind] : []),
      "artifact-closure-json",
      "workspace-root-json",
    ]);
    if (
      manifestByKind.size !== expectedKinds.size ||
      [...manifestByKind.keys()].some((kind) => !expectedKinds.has(kind)) ||
      artifacts.some(
        ({ metadata }) =>
          metadata.kind !== registration.derivedResultKind &&
          metadata.kind !== registration.adaptedResultKind &&
          metadata.mediaType !== "application/json",
      )
    ) {
      throw new Error("literature component artifact catalog is invalid");
    }
    const artifactByKind = new Map(
      artifacts.map((artifact) => [artifact.metadata.kind, artifact]),
    );
    const derived = artifactByKind.get(registration.derivedResultKind);
    const closure = artifactByKind.get("artifact-closure-json");
    const root = artifactByKind.get("workspace-root-json");
    const executionReceiptArtifact = artifactByKind.get(
      "literature-component-execution-receipt-json",
    );
    if (!derived || !closure || !root || !executionReceiptArtifact) {
      throw new Error("literature component omitted a required artifact");
    }
    if (
      derived.metadata.mediaType !== literatureComponentTableMediaType(registration) ||
      derived.metadata.rowCount !== manifest.derivedResultRowCount ||
      closure.metadata.mediaType !== "application/json" ||
      closure.metadata.digest !== manifest.artifactClosureDigest ||
      canonicalJson(closure.metadata.derivedFrom) !==
        canonicalJson(
          artifacts
            .filter(
              ({ metadata }) =>
                metadata.kind !== "artifact-closure-json" &&
                metadata.kind !== "workspace-root-json",
            )
            .map(({ metadata }) => metadata.digest),
        ) ||
      root.metadata.mediaType !== "application/json" ||
      root.metadata.digest !== manifest.workspaceRootDigest ||
      canonicalJson(root.metadata.derivedFrom) !==
        canonicalJson([manifest.artifactClosureDigest])
    ) {
      throw new Error("literature component root/closure metadata mismatch");
    }
    for (const { metadata, bytes } of artifacts) {
      if (metadata.mediaType === "application/json") {
        canonicalJsonArtifactAt(bytes, `literature component ${metadata.kind}`);
      }
    }
    const componentExecutionReceipt = decodeLiteratureComponentExecutionReceipt(
      canonicalJsonArtifactAt(
        executionReceiptArtifact.bytes,
        "literature component execution receipt",
      ),
      registration,
    );
    const methodReceipt = exactObjectAt(
      canonicalJsonArtifactAt(
        requireDefined(
          artifactByKind.get("literature-component-method-receipt-json"),
          "the component handle returned its method receipt",
        ).bytes,
        "literature component method receipt",
      ),
      "componentMethodReceipt",
      [
        "protocolVersion",
        "componentId",
        "parentMethodProfileId",
        "parentProfileExecutionStatus",
        "sourceWorkId",
        "sourceMethodVariantId",
        "methodProfileVersion",
        "settingIds",
        ...(registration.limitations.length ? ["limitations"] : []),
        "inputBindings",
        "implementationDigest",
        "buildEnvironmentDigest",
        "inputAdapterContractDigest",
        "inputAdapterConformanceDigest",
        "androidMethodProfileRegistryContentDigest",
      ],
    );
    const inputBindingSettingIds = arrayAt(
      methodReceipt.inputBindings,
      "componentMethodReceipt.inputBindings",
    ).map((binding, index) =>
      stringAt(
        objectAt(binding, `componentMethodReceipt.inputBindings[${index}]`)
          .settingId,
        `componentMethodReceipt.inputBindings[${index}].settingId`,
      ),
    );
    if (
      methodReceipt.protocolVersion !==
        "chronicle-literature-component-method-receipt/v1" ||
      methodReceipt.parentProfileExecutionStatus !== "blocked" ||
      methodReceipt.componentId !== registration.componentId ||
      methodReceipt.parentMethodProfileId !==
        registration.parentMethodProfileId ||
      methodReceipt.sourceWorkId !== registration.sourceWorkId ||
      methodReceipt.sourceMethodVariantId !==
        registration.sourceMethodVariantId ||
      methodReceipt.methodProfileVersion !==
        registration.methodProfileVersion ||
      canonicalJson(methodReceipt.settingIds) !==
        canonicalJson(registration.methodSettingIds) ||
      canonicalJson(
        registration.limitations.length
          ? stringListAt(
              methodReceipt.limitations,
              "componentMethodReceipt.limitations",
            )
          : [],
      ) !== canonicalJson(registration.limitations) ||
      canonicalJson(inputBindingSettingIds) !==
        canonicalJson(registration.methodSettingIds)
    ) {
      throw new Error("literature component method receipt mismatch");
    }
    const adaptationReceipt = objectAt(
      canonicalJsonArtifactAt(
        requireDefined(
          artifactByKind.get("literature-input-adaptation-receipt-json"),
          "the component handle returned its adaptation receipt",
        ).bytes,
        "literature component adaptation receipt",
      ),
      "componentAdaptationReceipt",
    );
    const adaptationDerivedResult = objectAt(
      adaptationReceipt.derivedResult,
      "componentAdaptationReceipt.derivedResult",
    );
    const adaptationSettingIds = stringListAt(
      adaptationReceipt.settingIds,
      "componentAdaptationReceipt.settingIds",
    );
    if (registration.adaptedResultKind) {
      const adapted = requireDefined(
        artifactByKind.get(registration.adaptedResultKind),
        "the component handle returned its adapted result",
      );
      if (adapted.metadata.mediaType !== literatureComponentTableMediaType(registration) ||
          adapted.metadata.digest !== adaptationReceipt.adaptedInputDigest ||
          adapted.metadata.rowCount !== integerAt(adaptationReceipt.emittedRowCount, "componentAdaptationReceipt.emittedRowCount")) {
        throw new Error("literature component adapted-result receipt mismatch");
      }
    }
    if (
      adaptationReceipt.protocolVersion !==
        "chronicle-literature-input-adaptation-receipt/v1" ||
      adaptationReceipt.originalInputDigest !== inputDigest ||
      new Set(adaptationSettingIds).size !== adaptationSettingIds.length ||
      canonicalJson([...adaptationSettingIds].sort()) !==
        canonicalJson([...registration.methodSettingIds].sort()) ||
      canonicalJson(adaptationReceipt.adapterIds) !==
        canonicalJson(componentAdapterIds(registration)) ||
      integerAt(
        adaptationReceipt.sourceRowCount,
        "componentAdaptationReceipt.sourceRowCount",
      ) !== manifest.sourceRowCount ||
      adaptationDerivedResult.kind !== registration.derivedResultKind ||
      adaptationDerivedResult.digest !== derived.metadata.digest ||
      integerAt(
        adaptationDerivedResult.rowCount,
        "componentAdaptationReceipt.derivedResult.rowCount",
      ) !== manifest.derivedResultRowCount
    ) {
      throw new Error("literature component adaptation receipt mismatch");
    }
    const receiptIdentityFields = [
      "implementationDigest",
      "buildEnvironmentDigest",
      "inputAdapterContractDigest",
      "inputAdapterConformanceDigest",
      "androidMethodProfileRegistryContentDigest",
    ] as const;
    if (
      componentExecutionReceipt.componentId !== registration.componentId ||
      componentExecutionReceipt.parentMethodProfileId !==
        registration.parentMethodProfileId ||
      componentExecutionReceipt.sourceWorkId !== registration.sourceWorkId ||
      componentExecutionReceipt.sourceMethodVariantId !==
        registration.sourceMethodVariantId ||
      componentExecutionReceipt.methodProfileVersion !==
        registration.methodProfileVersion ||
      canonicalJson(componentExecutionReceipt.settingIds) !==
        canonicalJson(registration.methodSettingIds) ||
      canonicalJson(componentExecutionReceipt.limitations) !==
        canonicalJson(registration.limitations) ||
      componentExecutionReceipt.originalInputDigest !== inputDigest ||
      canonicalJson(componentExecutionReceipt.supportArtifactDigests) !==
        canonicalJson(supportDigests) ||
      canonicalJson(componentExecutionReceipt.supportAdapterInputDigests) !==
        canonicalJson(supportDigests) ||
      registration.requiredSupportRoles.some(
        (role) =>
          componentExecutionReceipt.supportFormats[role] !==
          "text/csv; normalizedFromXlsx=false",
      ) ||
      componentExecutionReceipt.derivedResultKind !==
        registration.derivedResultKind ||
      componentExecutionReceipt.derivedResultDigest !==
        derived.metadata.digest ||
      componentExecutionReceipt.derivedResultRowCount !==
        manifest.derivedResultRowCount ||
      componentExecutionReceipt.componentMethodReceiptDigest !==
        artifactByKind.get("literature-component-method-receipt-json")?.metadata
          .digest ||
      componentExecutionReceipt.adaptationReceiptDigest !==
        artifactByKind.get("literature-input-adaptation-receipt-json")?.metadata
          .digest ||
      manifest.componentExecutionReceiptDigest !==
        executionReceiptArtifact.metadata.digest ||
      receiptIdentityFields.some(
        (field) => componentExecutionReceipt[field] !== manifest[field],
      )
    ) {
      throw new Error("literature component execution receipt mismatch");
    }
    const allPersistedArtifacts: PersistedRuntimeArtifact[] = [
      ...artifacts.map(({ metadata, bytes }) => ({
        ...metadata,
        bytes,
        digestVerified: true as const,
      })),
      {
        kind: `ingress:${literatureComponentInputRole(registration)}`,
        digest: inputDigest,
        size: csvBytes.byteLength,
        bytes: csvBytes,
        digestVerified: true,
      },
      ...registeredSupportFiles.map(({ role, bytes }) => ({
        kind: `ingress:${role}`,
        digest: requireDefined(supportDigests[role], "every registered support role was digested"),
        size: bytes.byteLength,
        bytes,
        digestVerified: true as const,
      })),
    ];
    const byDigest = new Map(
      allPersistedArtifacts.map((artifact) => [
        artifact.digest,
        artifact.bytes,
      ]),
    );
    await verifyLiteratureComponentRoot(
      Uint8Array.from(root.bytes),
      (digest) => {
        const bytes = byDigest.get(digest);
        return bytes
          ? Promise.resolve(Uint8Array.from(bytes))
          : Promise.reject(
              new Error(
                `literature component artifact set is missing ${digest}`,
              ),
            );
      },
      registration,
      {
        workspaceId,
        workspaceRootDigest: manifest.workspaceRootDigest,
        previousWorkspaceRootDigest,
        inputDigest,
        supportDigests,
        manifest,
      },
    );
    const persistedWorkspace =
      persist && opfsRoot
        ? await persistenceAdapter.persist(opfsRoot, {
            workspaceRootDigest: manifest.workspaceRootDigest,
            previousWorkspaceRootDigest,
            artifacts: allPersistedArtifacts,
            recoveredSlot: recovered,
          })
        : undefined;
    return {
      workspaceId,
      manifestJson,
      manifest,
      componentExecutionReceipt,
      artifacts: artifacts.map(({ metadata, bytes }) => ({
        metadata,
        ...(persistedWorkspace
          ? {
              persistedArtifact: {
                workspaceId,
                workspaceRootDigest: manifest.workspaceRootDigest,
                kind: metadata.kind,
                mediaType: metadata.mediaType,
                size: metadata.size,
              },
            }
          : { bytes }),
      })),
      ...(persistedWorkspace ? { persistedWorkspace } : {}),
    };
  } finally {
    try {
      resultHandle?.free();
    } finally {
      supportHandle?.free();
    }
  }
}

/** Execute one registered source-faithful component without the Chronicle kernel. */
export async function executeLiteratureComponentRuntime(
  registration: RegisteredLiteratureComponentExecution,
  csvBytes: Uint8Array,
  inputFileName: string,
  supportFiles: BrowserSupportFiles,
  persistRustWorkspace: boolean,
  verifiedInputSha256?: string,
): Promise<LiteratureComponentRuntimeExecution> {
  const inputSha256 = verifiedInputSha256 ?? (await sha256Hex(csvBytes));
  if (!/^[0-9a-f]{64}$/.test(inputSha256)) {
    throw new Error(
      "verified input digest must be 64 lowercase hexadecimal characters",
    );
  }
  const workspaceId = await literatureComponentWorkspaceId(
    registration.componentId,
    inputSha256,
  );
  const execute = () =>
    executeLiteratureComponentRuntimeUnlocked(
      registration,
      csvBytes,
      inputFileName,
      supportFiles,
      persistRustWorkspace,
      inputSha256,
      workspaceId,
    );
  if (!persistRustWorkspace) return execute();
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    if (persistenceAdapter === defaultPersistenceAdapter) {
      throw new Error(
        "Durable component execution requires the browser Web Locks API",
      );
    }
    return execute();
  }
  return withWorkspaceLock(workspaceId, execute);
}

/**
 * Re-evaluate the authoritative Rust graph for interactive A/B review without
 * serializing downloadable exports, timeline geometry, or a new OPFS root.
 * The returned comparison digest commits to the exact input, options, plan,
 * implementation, and review bytes used by the UI.
 */
export async function queryRustReview(
  csvBytes: Uint8Array,
  inputFileName: string,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
  verifiedInputSha256?: string,
  verifiedSupportCacheKey?: string,
  knownReviewSummaryDigests?: string[],
  participantPartition?: ParticipantPartitionTransport,
): Promise<RustReviewExecution> {
  const inputSha256 = verifiedInputSha256 ?? (await sha256Hex(csvBytes));
  const workspaceId = await runtimeWorkspaceId(
    inputFileName,
    csvBytes,
    inputSha256,
  );
  const execute = () =>
    executeRustRuntimeUnlocked(
      workspaceId,
      csvBytes,
      csvBytes.byteLength,
      inputFileName,
      options,
      supportFiles,
      runtime,
      inputSha256,
      "review",
      false,
      verifiedSupportCacheKey,
      knownReviewSummaryDigests,
      participantPartition,
    );
  if (!runtime.persistRustWorkspace) return execute();
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    if (persistenceAdapter === defaultPersistenceAdapter) {
      throw new Error(
        "Durable comparison requires the browser Web Locks API to serialize access to the Rust workspace",
      );
    }
    return execute();
  }
  return withWorkspaceLock(workspaceId, execute, "shared");
}

class PersistedReviewMiss extends Error {}

/**
 * Probe the receipt-pinned OPFS bases before reading the raw File again. A
 * clean miss returns null so the caller can transfer the raw bytes and run the
 * ordinary fail-closed path; corrupt persisted state still throws.
 */
export async function queryPersistedRustReview(
  inputSizeBytes: number,
  inputFileName: string,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
  verifiedInputSha256: string,
  verifiedSupportCacheKey?: string,
  knownReviewSummaryDigests?: string[],
): Promise<RustReviewExecution | null> {
  if (!Number.isSafeInteger(inputSizeBytes) || inputSizeBytes < 0) {
    throw new Error("verified input size must be a non-negative safe integer");
  }
  if (!/^[0-9a-f]{64}$/.test(verifiedInputSha256)) {
    throw new Error(
      "verified input digest must be 64 lowercase hexadecimal characters",
    );
  }
  // H1: this is the ONLY persisted-review entry point that forces
  // `persistRustWorkspace: true` and takes the workspace lock unconditionally,
  // unlike `executeRustRuntime` and `queryRustReview`, which both bypass the
  // lock when persistence is off. In an ephemeral context there is no
  // persisted workspace to consult AND no Web Locks API to take, so the lock
  // threw "Durable workspace mutation requires the browser Web Locks API" —
  // neither a `PersistedReviewMiss` nor the preflight sentinel, so it
  // propagated and every A/B comparison failed while the ephemeral banner
  // promised the run still works. A context that cannot persist is by
  // definition a persisted-review miss: return null and let the caller's
  // existing raw-path fallback do the work.
  if (runtime.persistRustWorkspace === false) return null;
  const empty = new Uint8Array();
  const workspaceId = await runtimeWorkspaceId(
    inputFileName,
    empty,
    verifiedInputSha256,
  );
  const execute = () =>
    executeRustRuntimeUnlocked(
      workspaceId,
      empty,
      inputSizeBytes,
      inputFileName,
      options,
      supportFiles,
      { ...runtime, persistRustWorkspace: true },
      verifiedInputSha256,
      "review",
      true,
      verifiedSupportCacheKey,
      knownReviewSummaryDigests,
    );
  try {
    return await withWorkspaceLock(workspaceId, execute, "shared");
  } catch (error) {
    if (error instanceof PersistedReviewMiss) return null;
    // Rust is the authority on whether a persisted base can stand in for a
    // live scientific preflight, and it says so by name. Treat its refusal as
    // a cache miss so the caller falls back to the raw file, not as a failure.
    // wasm-bindgen throws the kernel's `JsValue::from_str` as a bare string,
    // so this must not test `instanceof Error`.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("scientific_preflight_retry_required")) return null;
    // The kernel names the same situation from below: a query that has to run
    // from the raw bytes met a raw-less resume.
    if (message.includes("retained_raw_input_required")) return null;
    throw error;
  }
}
