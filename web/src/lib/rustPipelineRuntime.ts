/**
 * Browser transport and persistence boundary for the authoritative Rust/WASM
 * preprocessing runtime.
 */
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFile,
  BrowserSupportFiles,
  TimezoneAction,
} from "@/lib/types";
import type { RawFileInspection } from "@/lib/fileInspection";
import defaultAppCodebookUrl from "@/assets/defaults/unified_app_codebook.csv?url";
import defaultAppsToFilterUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?url";
import defaultAppsForcingScreenOpenUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?url";
import defaultBackgroundAppsUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?url";
import { fetchBundledAssetBytes } from "@/lib/bundledAssetLoader";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  RUNTIME_BOUNDARY_MODEL,
  type LogicalStageCheckpoint,
  type RuntimeArtifactMetadata,
  type ReviewRuntimeManifest as SerializedReviewRuntimeManifest,
  type RuntimeManifest as SerializedRuntimeManifest,
} from "@/lib/generatedRuntimeBoundary";
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
  collectRuntimeHistoryDigests,
  commitPersistedRuntimeWorkspace,
  exportRuntimeClosure,
  garbageCollectRuntimeObjects,
  importRuntimeClosure,
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
  free(): void;
};

type KernelModule = {
  default(input?: { module_or_path: WebAssembly.Module }): Promise<unknown>;
  runtime_version(): string;
  implementation_build_digest(): string;
  build_environment_digest(): string;
  runtime_identity_json(): string;
  pipeline_step_contract_json(): string;
  plan_stage_view_json(optionsJson: string): string;
  review_base_probe_spec_json(): string;
  RuntimeSupportFiles: new () => RuntimeSupportFilesHandle;
  discover_timezones_v2(csvBytes: Uint8Array): string[];
  inspect_raw_file_v1(
    csvBytes: Uint8Array,
    fileName: string,
    sizeBytes: number,
  ): string;
  execute_workspace(
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
  verify_evidence_journal_cbor(bytes: Uint8Array): number;
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
  protocolVersion: "chronicle-preprocessing-runtime/v1";
  command: "ExecuteWorkspace";
  processingSummary: Omit<
    SerializedRuntimeManifest["processingSummary"],
    "timezoneAction"
  > & { timezoneAction: TimezoneAction };
};

const TIMEZONE_ACTIONS = new Set<string>([
  "none",
  "filtered_to_selected",
  "converted_to_selected",
  "filtered_to_primary",
  "converted_to_primary",
]);
const CHECKPOINT_PROTOCOL_VERSION = "chronicle-logical-stage-checkpoint/v7";
const SUPPORTED_CACHE_SOURCES = new Set<string>([
  "salsa-memory",
  "verified-review-base",
  "verified-reconstruction-base",
]);

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
 * matching its domain entry, and the exact domain size.
 */
function verifyCheckpointDomain(
  digests: Record<string, string>,
  checkpoints: Record<string, LogicalStageCheckpoint>,
  path: string,
  expectedCount: number,
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
    if (checkpoint.nodeId !== id || checkpoint.terminalDigest !== digests[id]) {
      contractError(
        checkpointPath,
        "checkpoint identity or terminal digest does not match its domain",
      );
    }
  }
  const digestIds = Object.keys(digests).sort();
  const checkpointIds = Object.keys(checkpoints).sort();
  if (
    digestIds.length !== expectedCount ||
    JSON.stringify(digestIds) !== JSON.stringify(checkpointIds)
  ) {
    contractError(
      `${path}Checkpoints`,
      `digest and checkpoint domains must contain the same ${expectedCount} identities`,
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
 * manifest certificate, exactly 55 unique step executions, the checkpoint
 * domains, step output agreeing with its Rust checkpoint, timezone row
 * accounting, and identity uniqueness across artifacts, roles, and nodes.
 */
export function decodeRuntimeManifest(value: unknown): RuntimeManifest {
  const source = objectAt(value, "manifest");
  if (source.protocolVersion !== "chronicle-preprocessing-runtime/v1") {
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

  const { stepExecutions, artifacts, processingSummary: summary } = manifest;
  if (
    stepExecutions.length !== 55 ||
    new Set(stepExecutions.map((execution) => execution.step_id)).size !== 55
  ) {
    contractError(
      "manifest.stepExecutions",
      "expected exactly 55 unique Rust step executions",
    );
  }

  if (!TIMEZONE_ACTIONS.has(summary.timezoneAction)) {
    contractError(
      "manifest.processingSummary.timezoneAction",
      "unknown timezone action",
    );
  }
  verifyCheckpointDomain(
    summary.logicalStageDigests,
    summary.logicalStageCheckpoints,
    "manifest.processingSummary.logicalStage",
    15,
  );
  verifyCheckpointDomain(
    summary.pipelineStepDigests,
    summary.pipelineStepCheckpoints,
    "manifest.processingSummary.pipelineStep",
    55,
  );
  for (const execution of stepExecutions) {
    if (
      summary.pipelineStepDigests[execution.step_id] !== execution.output_digest
    ) {
      contractError(
        `manifest.stepExecutions.${execution.step_id}`,
        "step execution output does not match its Rust checkpoint",
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
    ["node", manifest.nodeExecutions.map(({ node_id }) => node_id)],
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
  recomputedStepIds: string[];
  cachedStepIds: string[];
  bypassedStepIds: string[];
  skippedStepIds: string[];
  errorStepIds: string[];
  /** True when the runtime matched the caller's known digest and returned no
   * artifact bytes; the caller must reattach its cached summary bytes. */
  reviewSummaryReused: boolean;
  reviewSummaryJsonBytes?: Uint8Array;
};

/** Decode and validate the compact manifest returned by the Rust review query. */
export function decodeReviewRuntimeManifest(
  value: unknown,
): Omit<
  RustReviewExecution,
  | "manifestJson"
  | "reviewSummaryJsonBytes"
  | "suppliedReviewBaseBytes"
  | "suppliedReconstructionBaseBytes"
> {
  const source = objectAt(value, "reviewManifest");
  if (source.protocolVersion !== "chronicle-preprocessing-runtime/v1") {
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
  const steps = manifest.stepExecutions;
  if (
    steps.length !== 55 ||
    new Set(steps.map(({ step_id }) => step_id)).size !== 55
  ) {
    contractError(
      "reviewManifest.stepExecutions",
      "expected exactly 55 unique Rust step executions",
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
  const stepIdsWithStatus = (
    status: SerializedReviewRuntimeManifest["stepExecutions"][number]["status"],
  ): string[] =>
    steps
      .filter((step) => step.status === status)
      .map(({ step_id }) => step_id);

  return {
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
    recomputedStepIds: stepIdsWithStatus("recomputed"),
    cachedStepIds: stepIdsWithStatus("cached"),
    bypassedStepIds: stepIdsWithStatus("bypassed"),
    skippedStepIds: stepIdsWithStatus("skipped"),
    errorStepIds: stepIdsWithStatus("error"),
  };
}

let initPromise: Promise<KernelModule> | null = null;

type CachedRuntimeSupportFiles = {
  handle: RuntimeSupportFilesHandle;
  activeUsers: number;
  invalid: boolean;
};

const runtimeSupportFilesCache = new Map<string, CachedRuntimeSupportFiles>();
const MAX_RUNTIME_SUPPORT_BUNDLES = 2;

function runtimeSupportFilesCacheKey(
  verifiedBundleKey: string,
  options: BrowserProcessingOptions,
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
  ]
    .map((enabled) => (enabled ? "1" : "0"))
    .join("");
  return `${verifiedBundleKey}:${enabledRoles}`;
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
  async verify(root, slot, kernel, workspaceId) {
    const rootBytes = await readRuntimeObject(root, slot.workspaceRootDigest);
    const historyDigests = await collectRuntimeHistoryDigests(
      root,
      slot.workspaceRootDigest,
    );
    await verifyRootClosure(
      rootBytes,
      (digest) => readRuntimeObject(root, digest),
      historyDigests,
      slot.previousWorkspaceRootDigest,
      kernel,
      workspaceId,
      slot.workspaceRootDigest,
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
): Promise<void> {
  // Large outputs are read once for digest/size verification and immediately
  // released. Retaining every 10–40 MB artifact until the entire closure has
  // been walked multiplied peak memory without strengthening the check.
  const maxCachedObjectBytes = 1024 * 1024;
  const currentIdentity = objectAt(
    JSON.parse(kernel.runtime_identity_json()),
    "runtimeIdentity",
  );
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
    currentIdentity.protocolVersion !== "chronicle-preprocessing-runtime/v1"
  ) {
    throw new Error("loaded runtime identity protocol is invalid");
  }
  for (const field of identityFields)
    digestAt(currentIdentity[field], `runtimeIdentity.${field}`);
  const requiredViews = new Map([
    [
      "chronicle.stage.v1",
      {
        artifactKind: "stage-view-json",
        schemaId: "urn:chronicle:view:stage:v1",
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
  const bytesByDigest = new Map<string, Uint8Array>([
    [expectedWorkspaceRootDigest, rootBytes],
  ]);
  const readObject = async (digest: string): Promise<Uint8Array> => {
    digestAt(digest, "objectDigest");
    const cached = bytesByDigest.get(digest);
    if (cached) return cached;
    const bytes = await object(digest);
    if (bytes.byteLength <= maxCachedObjectBytes) {
      bytesByDigest.set(digest, bytes);
    }
    return bytes;
  };
  type Root = {
    protocolVersion: string;
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
      root.protocolVersion !== "chronicle-preprocessing-runtime/v1" ||
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
    const commit = decodeRoot(await readObject(rootDigest));
    if (
      head &&
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
    const state = JSON.parse(
      new TextDecoder().decode(await readObject(commit.executionStateDigest)),
    ) as Record<string, unknown>;
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

    kernel.verify_evidence_journal_cbor(await readObject(commit.journalDigest));
    const closure = JSON.parse(
      new TextDecoder().decode(await readObject(commit.artifactClosureDigest)),
    ) as Record<string, unknown>;
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
      if ((await readObject(metadata.digest)).byteLength !== metadata.size) {
        throw new Error(`recovered artifact size mismatch: ${metadata.kind}`);
      }
    }
    for (const binding of bindings.values()) {
      const metadata = closureArtifacts.find(
        (artifact) => artifact.kind === binding.artifactKind,
      );
      const view = JSON.parse(
        new TextDecoder().decode(await readObject(binding.artifactDigest)),
      ) as Record<string, unknown>;
      if (
        metadata?.digest !== binding.artifactDigest ||
        view.protocol_version !== "0.1" ||
        view.view_id !== binding.viewId ||
        view.family !== "incremental-dataflow" ||
        view.schema_id !== binding.schemaId ||
        view.root_digest !== commit.executionStateDigest ||
        !Number.isSafeInteger(view.revision) ||
        !("payload" in view)
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
}

async function verifyPortableClosure(
  closure: RuntimeClosureInspection,
  kernel: KernelModule,
  workspaceId: string,
): Promise<void> {
  // verifyRootClosure already reads objects lazily through this accessor and
  // caches only objects under 1 MiB, so an archive-backed accessor keeps the
  // semantic closure check bounded no matter how large the closure is.
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
export async function initializeRustRuntime(
  compiledModule: WebAssembly.Module,
): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const module =
        (await import("@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js")) as unknown as KernelModule;
      captureWasmMemory(await module.default({ module_or_path: compiledModule }));
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

export async function inspectRustRawFile(
  csvBytes: Uint8Array,
  fileName: string,
  sizeBytes: number,
): Promise<RawFileInspection> {
  const kernel = await loadKernel();
  const parsed: unknown = JSON.parse(
    kernel.inspect_raw_file_v1(csvBytes, fileName, sizeBytes),
  );
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { fileName?: unknown }).fileName !== fileName ||
    !Array.isArray((parsed as { warnings?: unknown }).warnings) ||
    !Array.isArray((parsed as { columns?: unknown }).columns) ||
    !Array.isArray((parsed as { timezones?: unknown }).timezones)
  ) {
    throw new Error("Rust raw-file inspection returned an invalid result.");
  }
  return parsed as RawFileInspection;
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

export async function exportPersistedRustWorkspace(
  workspaceId: string,
): Promise<Blob> {
  const [kernel, root] = await Promise.all([
    loadKernel(),
    openOpfsWorkspace(workspaceId),
  ]);
  const slot = await recoverRuntimeWorkspace(root);
  if (!slot) throw new Error("no persisted Rust workspace exists");
  await defaultPersistenceAdapter.verify?.(root, slot, kernel, workspaceId);
  return exportRuntimeClosure(root, slot);
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
          slot!,
          kernel,
          workspaceId,
        );
      }
      const selectedRootDigest =
        expectedWorkspaceRootDigest ?? slot!.workspaceRootDigest;
      const rootCommit = JSON.parse(
        new TextDecoder().decode(
          await readRuntimeObject(root, selectedRootDigest),
        ),
      ) as { artifactClosureDigest: string; workspaceId: string };
      if (rootCommit.workspaceId !== workspaceId) {
        throw new Error("persisted Rust workspace identity mismatch");
      }
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

export async function readVerifiedSemanticIndexSnapshot(
  workspaceId: string,
): Promise<{ workspaceRootDigest: string; source: Uint8Array }> {
  return withWorkspaceLock(
    workspaceId,
    async () => {
      const [kernel, root] = await Promise.all([
        loadKernel(),
        openOpfsWorkspace(workspaceId),
      ]);
      const slot = await recoverRuntimeWorkspace(root);
      if (!slot) throw new Error("no persisted Rust workspace exists");
      await defaultPersistenceAdapter.verify?.(root, slot, kernel, workspaceId);
      const artifacts = await readArtifactsFromWorkspaceSlot(root, slot, [
        "semantic-index-source-json",
      ]);
      const source = artifacts.get("semantic-index-source-json");
      if (!source) {
        throw new Error(
          "persisted Rust artifact is missing: semantic-index-source-json",
        );
      }
      return { workspaceRootDigest: slot.workspaceRootDigest, source };
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

export async function getRustRuntimeVersion(): Promise<string> {
  return (await loadKernel()).runtime_version();
}

export async function getRustPlanStageView(
  options: BrowserProcessingOptions,
): Promise<import("@/lib/types").RustStageView> {
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
    kernel.plan_stage_view_json(
      JSON.stringify(
        buildRustV2Options(projectionOptions, {
          datetimeOfPreprocessing: "1970-01-01 00:00:00 UTC",
        }),
      ),
    ),
  ) as import("@/lib/types").RustStageView;
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
    use_apps_forcing_screen_open: options.useAppsForcingScreenOpenFile,
    use_background_apps_file: options.useBackgroundAppsFile,
    use_app_codebook: options.useAppCodebook,
    include_category_column: options.includeCategoryColumn,
    deduplicate_exact_rows: options.deduplicateExactRows,
    interaction_type_remap: options.interactionTypeRemap,
    correct_duplicate_event_timestamps: options.correctDuplicateEventTimestamps,
    allow_stop_event_reuse: options.allowStopEventReuse,
    use_activity_stopped_as_fallback: options.useActivityStoppedAsFallback,
    apply_threshold_to_fallback: options.applyThresholdToFallback,
    long_duration_threshold_ns:
      options.longDurationThresholdHours * 3_600_000_000_000,
    proximity_interval_ns: options.proximityIntervalSeconds * 1_000_000_000,
    custom_app_engagement_duration: options.customAppEngagementDuration,
    long_data_time_gap_thresholds: options.longDataTimeGapThresholds,
    long_usage_duration_thresholds: options.longUsageDurationThresholds,
    same_app_stop_types: options.sameAppInteractionTypesToStopUsageAt,
    other_stop_types: options.otherInteractionTypesToStopUsageAt,
    interaction_types_to_remove: options.interactionTypesToRemove,
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
    apply_minimum_usage_duration_to_concurrent_subintervals:
      options.applyMinimumUsageDurationToConcurrentSubintervals,
    filter_zero_duration_sessions: options.filterZeroDurationSessions,
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
  };
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
): Promise<RustRuntimeExecution | RustReviewExecution> {
  const reasons = rustRuntimeIneligibilityReasons(options);
  if (reasons.length > 0) {
    throw new Error(`Rust runtime is ineligible: ${reasons.join("; ")}`);
  }
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
    ]);
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
    ]);
    const supportHandleKey =
      materialization === "review" && verifiedSupportCacheKey
        ? runtimeSupportFilesCacheKey(verifiedSupportCacheKey, options)
        : undefined;
    const cachedSupport = supportHandleKey
      ? runtimeSupportFilesCache.get(supportHandleKey)
      : undefined;
    if (cachedSupport && !cachedSupport.invalid) {
      runtimeSupportFilesCache.delete(supportHandleKey!);
      runtimeSupportFilesCache.set(supportHandleKey!, cachedSupport);
      cachedSupport.activeUsers += 1;
      runtimeSupportFiles = cachedSupport.handle;
      runtimeSupportCacheEntry = {
        key: supportHandleKey!,
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
    let opfsRoot: FileSystemDirectoryHandle | undefined;
    let recoveredRoot: WorkspaceRootSlot | undefined;
    if (runtime.persistRustWorkspace) {
      await traced("previous-root-recovery", async () => {
        opfsRoot = await persistenceAdapter.openRoot(workspaceId);
        recoveredRoot =
          materialization === "review"
            ? await (
                persistenceAdapter.recoverHead ?? persistenceAdapter.recover
              )(opfsRoot)
            : await persistenceAdapter.recover(opfsRoot);
        if (recoveredRoot && materialization === "full") {
          await persistenceAdapter.verify?.(
            opfsRoot,
            recoveredRoot,
            kernel,
            workspaceId,
          );
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
      persistedReviewExpected = {
        implementationDigest: kernel.implementation_build_digest(),
        buildEnvironmentDigest: kernel.build_environment_digest(),
        workspaceId,
        inputDigest: `sha256:${inputSha256}`,
      };
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
            opfsRoot!,
            recoveredRoot!,
            persistedReviewExpected!,
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
    const requestOptions = buildRustV2Options(options, runtime);
    if (materialization === "review" && persistedDatetimeOfPreprocessing) {
      // A/B holds the original run timestamp fixed. A receiving worker's wall
      // clock is not a researcher-controlled comparison setting and would
      // invalidate otherwise exact persisted bases.
      requestOptions.datetime_of_preprocessing =
        persistedDatetimeOfPreprocessing;
    }
    const requestJson = JSON.stringify({
      protocolVersion: "chronicle-preprocessing-runtime/v1",
      requestId,
      command:
        materialization === "review" ? "QueryReview" : "ExecuteWorkspace",
      workspaceRootDigest: previousWorkspaceRootDigest,
      workspaceId,
      inputFileName,
      inputSha256: `sha256:${inputSha256}`,
      ...(materialization === "review" && knownReviewSummaryDigests?.length
        ? { knownReviewSummaryDigests }
        : {}),
      options: requestOptions,
    });
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
    handle = await traced(
      "kernel",
      async () => {
        if (!probes) {
          if (persistedReviewOnly) throw new PersistedReviewMiss();
          return kernel.execute_workspace(
            requestJson,
            csvBytes,
            runtimeSupportFiles!,
          );
        }
        const prepared = kernel.prepare_persisted_workspace_review(
          requestJson,
          inputSizeBytes,
          probes.reviewProbe,
          probes.reconstructionProbe,
          runtimeSupportFiles!,
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
          if (required === "salsa-memory") {
            return prepared.execute_selected_base(new Uint8Array());
          }
          if (required === "none") {
            if (persistedReviewOnly) throw new PersistedReviewMiss();
            kernelBoundaryBytes += csvBytes.byteLength;
            return kernel.execute_workspace(
              requestJson,
              csvBytes,
              runtimeSupportFiles!,
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
          } else {
            suppliedReconstructionBaseBytes += selected.byteLength;
          }
          kernelBoundaryBytes += selected.byteLength;
          return prepared.execute_selected_base(selected);
        } finally {
          prepared.free();
        }
      },
      {
        bytes: () => kernelBoundaryBytes,
        items: 1,
      },
    );
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
      const manifest = decodeReviewRuntimeManifest(manifestValue);
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
      if (manifest.reviewSummaryReused) {
        if (
          !knownReviewSummaryDigests?.includes(manifest.reviewSummaryDigest)
        ) {
          throw new Error(
            "review manifest reused a summary digest the caller never offered",
          );
        }
        if (handle.artifact_count !== 0) {
          throw new Error(
            "reused review query must not expose artifact bytes",
          );
        }
        executionSucceeded = true;
        return {
          ...manifest,
          manifestJson,
          suppliedReviewBaseBytes,
          suppliedReconstructionBaseBytes,
        };
      }
      if (handle.artifact_count !== 1) {
        throw new Error(
          "review query must expose exactly one compact artifact",
        );
      }
      const metadata = artifactMetadataAt(
        JSON.parse(handle.artifact_metadata_json(0)),
        "reviewArtifact",
      );
      if (
        metadata.kind !== "review-summary-json" ||
        metadata.digest !== manifest.reviewSummaryDigest
      ) {
        throw new Error("review artifact identity mismatch");
      }
      const reviewBytes = await traced(
        "artifact-extract",
        () => handle!.take_artifact_bytes(0),
        { bytes: metadata.size, items: 1 },
      );
      await traced(
        "artifact-integrity",
        async () => {
          if (
            metadata.size !== reviewBytes.byteLength ||
            metadata.digest !== `sha256:${await sha256Hex(reviewBytes)}`
          ) {
            throw new Error("review artifact integrity mismatch");
          }
        },
        { bytes: reviewBytes.byteLength, items: 1 },
      );
      executionSucceeded = true;
      return {
        ...manifest,
        manifestJson,
        reviewSummaryJsonBytes: reviewBytes,
        suppliedReviewBaseBytes,
        suppliedReconstructionBaseBytes,
      };
    }
    const manifest = decodeRuntimeManifest(manifestValue);
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
      "stage-view-json",
      ...(options.enableInteractiveTimeline && !streamToOpfs
        ? ["visualization-data-json"]
        : []),
    ]);
    let persistedWorkspace: WorkspaceRootSlot | undefined;
    if (streamToOpfs && opfsRoot) {
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
              opfsRoot!,
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
        () => persistRuntimeObjects(opfsRoot!, ingressArtifacts),
        { bytes: ingressBytes, items: ingressArtifacts.length },
      );
      await traced(
        "new-root-verification",
        async () =>
          verifyRootClosure(
            await readRuntimeObject(opfsRoot!, manifest.workspaceRootDigest),
            (digest) => readRuntimeObject(opfsRoot!, digest),
            [...new Set(persistedMetadata.map(({ digest }) => digest))],
            manifest.previousWorkspaceRootDigest,
            kernel,
            workspaceId,
            manifest.workspaceRootDigest,
            false,
          ),
        { items: persistedMetadata.length },
      );
      persistedWorkspace = await traced("root-commit", () =>
        commitPersistedRuntimeWorkspace(opfsRoot!, {
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
      const rootBytes = persistedByDigest.get(manifest.workspaceRootDigest);
      if (!rootBytes) {
        throw new Error("runtime artifact set is missing its workspace root");
      }
      await verifyRootClosure(
        rootBytes,
        (digest) => {
          const bytes = persistedByDigest.get(digest);
          if (!bytes)
            throw new Error(`runtime artifact set is missing ${digest}`);
          return bytes;
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
    if (
      persistedWorkspace &&
      recoveredRoot &&
      opfsRoot &&
      persistenceAdapter === defaultPersistenceAdapter
    ) {
      try {
        await traced("garbage-collection", () =>
          garbageCollectRuntimeObjects(opfsRoot!, [persistedWorkspace]),
        );
      } catch (error) {
        console.warn(
          "Committed Rust workspace but could not reclaim stale OPFS objects",
          error,
        );
      }
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
    new TextEncoder().encode(
      `chronicle-preprocessing-workspace:${inputDigest}`,
    ),
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
    `chronicle-preprocessing:${workspaceId}`,
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
    throw error;
  }
}
