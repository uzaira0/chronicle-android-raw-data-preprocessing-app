/**
 * Browser transport and persistence boundary for the authoritative Rust/WASM
 * preprocessing runtime. The legacy parity helper at the end of this module is
 * retained only as migration-test evidence; production calls executeRustRuntime.
 */
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFile,
  BrowserSupportFiles,
  ProcessedFileResult,
  RustShadowArtifactComparison,
  RustShadowReport,
} from "@/lib/types";
import defaultAppCodebookUrl from "@/assets/defaults/unified_app_codebook.csv?url";
import defaultAppsToFilterUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?url";
import defaultAppsForcingScreenOpenUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?url";
import defaultBackgroundAppsUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?url";
import {
  exportRuntimeClosure,
  garbageCollectRuntimeObjects,
  importRuntimeClosure,
  openOpfsWorkspace,
  persistRuntimeWorkspace,
  readRuntimeObject,
  recoverRuntimeWorkspace,
  runtimeClosureWorkspaceId,
  type PersistedRuntimeArtifact,
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

type KernelModule = {
  default(): Promise<unknown>;
  runtime_version(): string;
  plan_stage_view_json(optionsJson: string): string;
  RuntimeSupportFiles: new () => RuntimeSupportFilesHandle;
  discover_timezones_v2(csvBytes: Uint8Array): string[];
  execute_workspace(
    requestJson: string,
    csvBytes: Uint8Array,
    supportFiles: RuntimeSupportFilesHandle,
  ): KernelHandle;
  execute_bounded_v2_shadow(
    requestJson: string,
    csvBytes: Uint8Array,
    supportFiles: RuntimeSupportFilesHandle,
  ): KernelHandle;
  verify_evidence_journal_cbor(bytes: Uint8Array): number;
};

type RuntimeArtifactMetadata = {
  kind: string;
  digest: string;
  size: number;
  rowCount?: number;
};

export type RuntimeManifest = {
  counts: { original: number; processed: number; app: number; screen: number };
  input: { digest: string };
  workspaceRootDigest: string;
  workspaceId: string;
  planDigest: string;
  profileDigest: string;
  profileLockDigest: string;
  productContractDigest: string;
  openObligations: unknown[];
  journalDigest: string;
  artifacts: RuntimeArtifactMetadata[];
  previousWorkspaceRootDigest: string | null;
  roleAssignments: Array<{
    role_id: string;
    artifact: { digest: string; size: number; mediaType: string };
  }>;
  nodeExecutions: Array<{
    node_id: string;
    status: "cached" | "recomputed" | "error" | "skipped" | "bypassed";
    reason_id: string;
  }>;
  processingSummary: {
    availableTimezones: string[];
    timezone: string;
    timezoneAction:
      | "none"
      | "filtered_to_selected"
      | "converted_to_selected"
      | "filtered_to_primary"
      | "converted_to_primary";
    rowsBeforeTimezoneHandling: number;
    rowsAfterTimezoneHandling: number;
    rowsRemovedByTimezone: number;
    duplicateTimestampsCorrected: number;
    exactDuplicateRowsRemoved: number;
  };
};

export type RustRuntimeExecution = {
  workspaceId: string;
  manifest: RuntimeManifest;
  artifacts: Map<string, Uint8Array>;
  persistedWorkspace?: WorkspaceRootSlot;
};

let initPromise: Promise<KernelModule> | null = null;

export type RustPersistenceAdapter = {
  openRoot(workspaceId: string): Promise<FileSystemDirectoryHandle>;
  recover(
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
    },
  ): Promise<WorkspaceRootSlot>;
};

const defaultPersistenceAdapter: RustPersistenceAdapter = {
  openRoot: openOpfsWorkspace,
  recover: recoverRuntimeWorkspace,
  async verify(root, slot, kernel, workspaceId) {
    const rootBytes = await readRuntimeObject(root, slot.workspaceRootDigest);
    await verifyRootClosure(
      rootBytes,
      (digest) => readRuntimeObject(root, digest),
      slot.artifactDigests,
      slot.previousWorkspaceRootDigest,
      kernel,
      workspaceId,
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
): Promise<void> {
  const commit = JSON.parse(new TextDecoder().decode(rootBytes)) as {
    protocolVersion: string;
    command: string;
    workspaceId: string;
    previousWorkspaceRootDigest: string | null;
    artifactDigests: string[];
    journalDigest: string;
    artifactClosureDigest: string;
  };
  if (
    commit.protocolVersion !== "chronicle-preprocessing-runtime/v1" ||
    commit.command !== "ExecuteWorkspace" ||
    commit.workspaceId !== expectedWorkspaceId ||
    commit.previousWorkspaceRootDigest !== expectedPreviousRoot ||
    !commit.artifactDigests.includes(commit.journalDigest) ||
    !commit.artifactDigests.includes(commit.artifactClosureDigest)
  ) {
    throw new Error("recovered workspace root contract is invalid");
  }
  const retained = new Set(retainedDigests);
  if (!commit.artifactDigests.every((digest) => retained.has(digest))) {
    throw new Error("recovered workspace closure is incomplete");
  }
  const journal = await object(commit.journalDigest);
  kernel.verify_evidence_journal_cbor(journal);
  const closure = JSON.parse(
    new TextDecoder().decode(await object(commit.artifactClosureDigest)),
  ) as {
    protocolVersion: string;
    workspaceId: string;
    journalDigest: string;
    artifacts: Array<{ digest: string }>;
  };
  if (
    closure.protocolVersion !== "chronicle-artifact-closure/v1" ||
    closure.workspaceId !== expectedWorkspaceId ||
    closure.journalDigest !== commit.journalDigest ||
    !closure.artifacts.every(({ digest }) =>
      commit.artifactDigests.includes(digest),
    )
  ) {
    throw new Error("recovered artifact closure is invalid");
  }
}

async function verifyPortableClosure(
  closure: RuntimeClosureInspection,
  kernel: KernelModule,
  workspaceId: string,
): Promise<void> {
  await verifyRootClosure(
    closure.object(closure.manifest.workspaceRootDigest),
    (digest) => closure.object(digest),
    closure.manifest.objects.map(({ digest }) => digest),
    closure.manifest.previousWorkspaceRootDigest,
    kernel,
    workspaceId,
  );
}

let persistenceAdapter = defaultPersistenceAdapter;

/** Test-only dependency seam for initializing the generated module from local bytes. */
export function setRustRuntimeForTesting(module: KernelModule): void {
  initPromise = Promise.resolve(module);
}

export async function discoverRustTimezones(
  csvBytes: Uint8Array,
): Promise<string[]> {
  const kernel = await loadKernel();
  return kernel.discover_timezones_v2(csvBytes);
}

export async function verifyPersistedRustWorkspace(
  workspaceId: string,
): Promise<
  WorkspaceRootSlot | undefined
> {
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
): Promise<Uint8Array> {
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
  archive: Uint8Array,
): Promise<WorkspaceRootSlot> {
  if (runtimeClosureWorkspaceId(archive) !== workspaceId) {
    throw new Error("runtime closure workspace identity does not match the import target");
  }
  const [kernel, root] = await Promise.all([
    loadKernel(),
    openOpfsWorkspace(workspaceId),
  ]);
  return importRuntimeClosure(root, archive, (closure) =>
    verifyPortableClosure(closure, kernel, workspaceId),
  );
}

export async function importPersistedRustWorkspaceArchive(
  archive: Uint8Array,
): Promise<{ workspaceId: string; slot: WorkspaceRootSlot }> {
  const workspaceId = runtimeClosureWorkspaceId(archive);
  return {
    workspaceId,
    slot: await importPersistedRustWorkspace(workspaceId, archive),
  };
}

export async function garbageCollectPersistedRustWorkspace(
  workspaceId: string,
): Promise<number> {
  const root = await openOpfsWorkspace(workspaceId);
  const slot = await recoverRuntimeWorkspace(root);
  return garbageCollectRuntimeObjects(root, slot ? [slot] : []);
}

export async function readPersistedRustArtifact(
  workspaceId: string,
  kind: string,
): Promise<Uint8Array> {
  const [kernel, root] = await Promise.all([
    loadKernel(),
    openOpfsWorkspace(workspaceId),
  ]);
  const slot = await recoverRuntimeWorkspace(root);
  if (!slot) throw new Error("no persisted Rust workspace exists");
  await defaultPersistenceAdapter.verify?.(root, slot, kernel, workspaceId);
  const rootCommit = JSON.parse(
    new TextDecoder().decode(
      await readRuntimeObject(root, slot.workspaceRootDigest),
    ),
  ) as { artifactClosureDigest: string };
  const closure = JSON.parse(
    new TextDecoder().decode(
      await readRuntimeObject(root, rootCommit.artifactClosureDigest),
    ),
  ) as { artifacts: Array<{ kind: string; digest: string }> };
  const artifact = closure.artifacts.find((candidate) => candidate.kind === kind);
  if (!artifact) throw new Error(`persisted Rust artifact is missing: ${kind}`);
  return readRuntimeObject(root, artifact.digest);
}

/** Test-only dependency seam for deterministic OPFS fault/recovery tests. */
export function setRustPersistenceForTesting(
  adapter: RustPersistenceAdapter | null,
): void {
  persistenceAdapter = adapter ?? defaultPersistenceAdapter;
}

async function loadKernel(): Promise<KernelModule> {
  if (!initPromise) {
    /* v8 ignore start -- Vite's browser WASM loader is exercised by the Playwright offline/runtime smoke; unit tests inject the exact compiled module bytes. */
    initPromise = (async () => {
      const module =
        (await import("@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js")) as unknown as KernelModule;
      await module.default();
      return module;
    })();
    /* v8 ignore stop */
  }
  return initPromise;
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
    options.timezoneHandling.startsWith("selected-") && !options.selectedTimezone?.trim()
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

const bundledSupportBytes = new Map<string, Promise<Uint8Array>>();

async function supportBytes(
  enabled: boolean,
  file: BrowserSupportFile | undefined,
  bundledUrl: string,
): Promise<Uint8Array> {
  if (!enabled) return new Uint8Array();
  if (file) return fileBytes(file);
  let pending = bundledSupportBytes.get(bundledUrl);
  if (!pending) {
    pending = fetch(bundledUrl).then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `failed to load bundled support asset (${response.status}): ${bundledUrl}`,
        );
      }
      return new Uint8Array(await response.arrayBuffer());
    });
    bundledSupportBytes.set(bundledUrl, pending);
  }
  return pending;
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
export function rustV2IneligibilityReasons(
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
    : "screen_usage";
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
    credited_session_cap_minutes: options.creditedSessionCapMinutes,
    device_liveness_gap_tolerance_minutes:
      options.deviceLivenessGapToleranceMinutes,
    auto_lock_bridge_seconds: options.autoLockBridgeSeconds,
    no_witness_min_day_apps: options.noWitnessMinDayApps,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", owned.buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function compareArtifact(
  kind: RustShadowArtifactComparison["kind"],
  tsResult: ProcessedFileResult,
  rustBytes: Uint8Array,
): Promise<RustShadowArtifactComparison> {
  const outputSuffix = {
    "credited-app": " Credited App Usage.csv",
    "day-coverage": " Day Coverage.csv",
    compliance: " Compliance Report.csv",
    "aggregate-daily": " Daily Summary.csv",
    "aggregate-weekly": " Weekly Summary.csv",
    "aggregate-top-apps": " Top Apps.csv",
    "aggregate-category-budget": " Category Time Budget.csv",
    "aggregate-co-usage": " App Co-Usage.csv",
    "app-spss": " Automatically Preprocessed.sav",
    "screen-spss": " Screen Usage Automatically Preprocessed.sav",
  } as const;
  const tsOutput = tsResult.outputs.find((output) => {
    if (kind === "app" || kind === "screen") return output.kind === kind;
    if (kind === "app-parquet" || kind === "screen-parquet") return false;
    return output.outputFileName.endsWith(outputSuffix[kind]);
  });
  const tsBytes = tsOutput
    ? new Uint8Array(await tsOutput.blob.arrayBuffer())
    : new Uint8Array();
  const [typescriptSha256, rustSha256] = await Promise.all([
    sha256Hex(tsBytes),
    sha256Hex(rustBytes),
  ]);
  return {
    kind,
    typescriptSha256,
    rustSha256,
    typescriptBytes: tsBytes.byteLength,
    rustBytes: rustBytes.byteLength,
    matches:
      typescriptSha256 === rustSha256 &&
      tsBytes.byteLength === rustBytes.byteLength,
    comparison: "exact-bytes",
  };
}

async function compareParquetArtifact(
  kind: "app-parquet" | "screen-parquet",
  tsResult: ProcessedFileResult,
  rustBytes: Uint8Array,
): Promise<RustShadowArtifactComparison> {
  const suffix =
    kind === "app-parquet"
      ? " Automatically Preprocessed.parquet"
      : " Screen Usage Automatically Preprocessed.parquet";
  const tsOutput = tsResult.outputs.find(
    (output) =>
      output.kind === "parquet" && output.outputFileName.endsWith(suffix),
  );
  const tsBytes = tsOutput
    ? new Uint8Array(await tsOutput.blob.arrayBuffer())
    : new Uint8Array();
  const { parquetReadObjects } = await import("hyparquet");
  const read = (bytes: Uint8Array) =>
    parquetReadObjects({
      file: {
        byteLength: bytes.byteLength,
        slice: (start: number, end?: number) =>
          Uint8Array.from(bytes).buffer.slice(start, end),
      },
    });
  const [typescriptRows, rustRows, typescriptSha256, rustSha256] =
    await Promise.all([
      read(tsBytes),
      read(rustBytes),
      sha256Hex(tsBytes),
      sha256Hex(rustBytes),
    ]);
  return {
    kind,
    typescriptSha256,
    rustSha256,
    typescriptBytes: tsBytes.byteLength,
    rustBytes: rustBytes.byteLength,
    matches: canonicalJson(typescriptRows) === canonicalJson(rustRows),
    comparison: "decoded-values",
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function firstJsonDifference(
  left: unknown,
  right: unknown,
  path = "$",
): string | undefined {
  if (Object.is(left, right)) return undefined;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return `${path}.length: Rust=${left.length} TypeScript=${right.length}`;
    }
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstJsonDifference(
        left[index],
        right[index],
        `${path}[${index}]`,
      );
      if (difference) return difference;
    }
    return undefined;
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    const keys = new Set([
      ...Object.keys(left),
      ...Object.keys(right),
    ]);
    for (const key of [...keys].sort()) {
      const difference = firstJsonDifference(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
      if (difference) return difference;
    }
    return undefined;
  }
  return `${path}: Rust=${JSON.stringify(left)} TypeScript=${JSON.stringify(right)}`;
}

async function executeRustRuntimeUnlocked(
  workspaceId: string,
  csvBytes: Uint8Array,
  inputFileName: string,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
): Promise<RustRuntimeExecution> {
  const reasons = rustV2IneligibilityReasons(options);
  if (reasons.length > 0) {
    throw new Error(`Rust runtime is ineligible: ${reasons.join("; ")}`);
  }
  let handle: KernelHandle | null = null;
  let runtimeSupportFiles: RuntimeSupportFilesHandle | null = null;
  try {
    const kernel = await loadKernel();
    const inputSha256 = await sha256Hex(csvBytes);
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
      ["study_dates_file", supportFiles?.studyDatesFile?.name ?? "study_dates.csv"],
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
    let opfsRoot: FileSystemDirectoryHandle | undefined;
    let recoveredRoot: WorkspaceRootSlot | undefined;
    if (runtime.persistRustWorkspace) {
      opfsRoot = await persistenceAdapter.openRoot(workspaceId);
      recoveredRoot = await persistenceAdapter.recover(opfsRoot);
      if (recoveredRoot) {
        await persistenceAdapter.verify?.(
          opfsRoot,
          recoveredRoot,
          kernel,
          workspaceId,
        );
      }
    }
    handle = kernel.execute_workspace(
      JSON.stringify({
        protocolVersion: "chronicle-preprocessing-runtime/v1",
        requestId: `execute-${inputSha256.slice(0, 16)}`,
        command: "ExecuteWorkspace",
        workspaceRootDigest: recoveredRoot?.workspaceRootDigest ?? null,
        workspaceId,
        inputFileName,
        inputSha256: `sha256:${inputSha256}`,
        options: buildRustV2Options(options, runtime),
      }),
      csvBytes,
      runtimeSupportFiles,
    );
    const manifest = JSON.parse(handle.manifest_json()) as RuntimeManifest;
    if (manifest.workspaceId !== workspaceId) {
      throw new Error("runtime manifest workspace identity mismatch");
    }
    const artifacts = new Map<string, Uint8Array>();
    const persistedArtifacts: PersistedRuntimeArtifact[] = [];
    for (let index = 0; index < handle.artifact_count; index += 1) {
      const metadata = JSON.parse(
        handle.artifact_metadata_json(index),
      ) as RuntimeArtifactMetadata;
      const bytes = handle.take_artifact_bytes(index);
      if (
        metadata.size !== bytes.byteLength ||
        metadata.digest !== `sha256:${await sha256Hex(bytes)}`
      ) {
        throw new Error(
          `runtime artifact integrity mismatch: ${metadata.kind}`,
        );
      }
      if (artifacts.has(metadata.kind)) {
        throw new Error(`duplicate runtime artifact kind: ${metadata.kind}`);
      }
      artifacts.set(metadata.kind, bytes);
      persistedArtifacts.push({ ...metadata, bytes });
    }
    for (const assignment of manifest.roleAssignments) {
      if (assignment.role_id === "processing_options") continue;
      const bytes = ingressBytesByRole.get(assignment.role_id);
      if (!bytes) {
        throw new Error(
          `runtime declared an unknown ingress role: ${assignment.role_id}`,
        );
      }
      if (
        assignment.artifact.size !== bytes.byteLength ||
        assignment.artifact.digest !== `sha256:${await sha256Hex(bytes)}`
      ) {
        throw new Error(
          `runtime ingress assignment integrity mismatch: ${assignment.role_id}`,
        );
      }
      persistedArtifacts.push({
        kind: `ingress:${assignment.role_id}`,
        digest: assignment.artifact.digest,
        size: assignment.artifact.size,
        bytes,
      });
    }
    const persistedWorkspace =
      runtime.persistRustWorkspace && opfsRoot
        ? await persistenceAdapter.persist(opfsRoot, {
            workspaceRootDigest: manifest.workspaceRootDigest,
            previousWorkspaceRootDigest:
              manifest.previousWorkspaceRootDigest,
            artifacts: persistedArtifacts,
          })
        : undefined;
    return { workspaceId, manifest, artifacts, persistedWorkspace };
  } finally {
    handle?.free();
    runtimeSupportFiles?.free();
  }
}

async function workspaceIdForInput(inputFileName: string): Promise<string> {
  return `sha256:${await sha256Hex(
    new TextEncoder().encode(`chronicle-preprocessing-workspace:${inputFileName}`),
  )}`;
}

export async function executeRustRuntime(
  csvBytes: Uint8Array,
  inputFileName: string,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
): Promise<RustRuntimeExecution> {
  const workspaceId = await workspaceIdForInput(inputFileName);
  const execute = () =>
    executeRustRuntimeUnlocked(
      workspaceId,
      csvBytes,
      inputFileName,
      options,
      supportFiles,
      runtime,
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
  return navigator.locks.request(
    `chronicle-preprocessing:${workspaceId}`,
    { mode: "exclusive" },
    execute,
  );
}

export async function runRustV2Shadow(
  csvBytes: Uint8Array,
  options: BrowserProcessingOptions,
  supportFiles: BrowserSupportFiles | undefined,
  runtime: BrowserProcessingRuntime,
  typescriptResult: ProcessedFileResult,
): Promise<RustShadowReport> {
  const reasons = rustV2IneligibilityReasons(options);
  if (reasons.length > 0) {
    return {
      protocolVersion: "chronicle-rust-shadow/v1",
      implementation:
        "chronicle_preprocessing_runtime_wasm/execute_bounded_v2_shadow",
      scope: "selected-runtime-csv-artifacts",
      status: "ineligible",
      reasons,
      artifacts: [],
    };
  }

  try {
    const execution = await executeRustRuntime(
      csvBytes,
      typescriptResult.inputFileName,
      options,
      supportFiles,
      runtime,
    );
    const { manifest, artifacts: runtimeArtifacts, persistedWorkspace } =
      execution;
    const rustCounts = manifest.counts;
    const tsCounts = {
      original: typescriptResult.originalRowCount,
      processed: typescriptResult.processedRowCount,
      app: typescriptResult.appRowCount,
      screen: typescriptResult.screenRowCount,
    };
    const artifacts = await Promise.all([
      ...(options.processAppUsage
        ? [
            compareArtifact(
              "app" as const,
              typescriptResult,
              runtimeArtifacts.get("app-csv") ?? new Uint8Array(),
            ),
          ]
        : []),
      ...(options.processScreenUsage
        ? [
            compareArtifact(
              "screen" as const,
              typescriptResult,
              runtimeArtifacts.get("screen-csv") ?? new Uint8Array(),
            ),
          ]
        : []),
      ...(options.enableDayCoverage
        ? [
            compareArtifact(
              "day-coverage" as const,
              typescriptResult,
              runtimeArtifacts.get("day-coverage-csv") ?? new Uint8Array(),
            ),
          ]
        : []),
      ...(options.enableScreenGatedCrediting
        ? [
            compareArtifact(
              "credited-app" as const,
              typescriptResult,
              runtimeArtifacts.get("credited-app-csv") ?? new Uint8Array(),
            ),
          ]
        : []),
      ...(options.enableComplianceScoring
        ? [
            compareArtifact(
              "compliance" as const,
              typescriptResult,
              runtimeArtifacts.get("compliance-csv") ?? new Uint8Array(),
            ),
          ]
        : []),
      ...(options.enableAggregates
        ? [
            compareArtifact(
              "aggregate-daily" as const,
              typescriptResult,
              runtimeArtifacts.get("aggregate-daily-summary-csv") ??
                new Uint8Array(),
            ),
            compareArtifact(
              "aggregate-weekly" as const,
              typescriptResult,
              runtimeArtifacts.get("aggregate-weekly-summary-csv") ??
                new Uint8Array(),
            ),
            compareArtifact(
              "aggregate-top-apps" as const,
              typescriptResult,
              runtimeArtifacts.get("aggregate-top-apps-csv") ??
                new Uint8Array(),
            ),
            ...(options.useAppCodebook
              ? [
                  compareArtifact(
                    "aggregate-category-budget" as const,
                    typescriptResult,
                    runtimeArtifacts.get(
                      "aggregate-category-time-budget-csv",
                    ) ?? new Uint8Array(),
                  ),
                ]
              : []),
            ...(options.modelConcurrentUsage || options.useBackgroundAppsFile
              ? [
                  compareArtifact(
                    "aggregate-co-usage" as const,
                    typescriptResult,
                    runtimeArtifacts.get("aggregate-app-co-usage-csv") ??
                      new Uint8Array(),
                  ),
                ]
              : []),
          ]
        : []),
      ...(options.enableParquetExport
        ? [
            ...(options.processAppUsage
              ? [
                  compareParquetArtifact(
                    "app-parquet",
                    typescriptResult,
                    runtimeArtifacts.get("app-parquet") ?? new Uint8Array(),
                  ),
                ]
              : []),
            ...(options.processScreenUsage
              ? [
                  compareParquetArtifact(
                    "screen-parquet",
                    typescriptResult,
                    runtimeArtifacts.get("screen-parquet") ?? new Uint8Array(),
                  ),
                ]
              : []),
          ]
        : []),
      ...(options.enableSpssExport
        ? [
            ...(options.processAppUsage
              ? [
                  compareArtifact(
                    "app-spss",
                    typescriptResult,
                    runtimeArtifacts.get("app-spss") ?? new Uint8Array(),
                  ),
                ]
              : []),
            ...(options.processScreenUsage
              ? [
                  compareArtifact(
                    "screen-spss",
                    typescriptResult,
                    runtimeArtifacts.get("screen-spss") ?? new Uint8Array(),
                  ),
                ]
              : []),
          ]
        : []),
    ]);
    const rustReviewSummary = JSON.parse(
      new TextDecoder().decode(
        runtimeArtifacts.get("review-summary-json") ?? new Uint8Array(),
      ),
    ) as unknown;
    const reviewSummaryMatches =
      canonicalJson(rustReviewSummary) ===
      canonicalJson(typescriptResult.reviewSummary ?? { participants: [] });
    const reviewSummaryDifference = reviewSummaryMatches
      ? undefined
      : firstJsonDifference(
          rustReviewSummary,
          typescriptResult.reviewSummary ?? { participants: [] },
        );
    const countsMatch = JSON.stringify(tsCounts) === JSON.stringify(rustCounts);
    const matched =
      countsMatch &&
      reviewSummaryMatches &&
      artifacts.every((artifact) => artifact.matches);
    return {
      protocolVersion: "chronicle-rust-shadow/v1",
      implementation:
        "chronicle_preprocessing_runtime_wasm/execute_bounded_v2_shadow",
      scope: "selected-runtime-csv-artifacts",
      status: matched ? "matched" : "diverged",
      reasons: matched
        ? []
        : [
            "selected Rust CSV artifacts, review summary, or authoritative counts differ",
            ...(reviewSummaryDifference ? [reviewSummaryDifference] : []),
          ],
      artifacts,
      workspaceRootDigest: manifest.workspaceRootDigest,
      planDigest: manifest.planDigest,
      productContractDigest: manifest.productContractDigest,
      openObligationCount: manifest.openObligations.length,
      journalDigest: manifest.journalDigest,
      reviewSummaryMatches,
      ...(persistedWorkspace
        ? {
            persistedWorkspace: {
              generation: persistedWorkspace.generation,
              workspaceRootDigest: persistedWorkspace.workspaceRootDigest,
            },
          }
        : {}),
      counts: { typescript: tsCounts, rust: rustCounts, matches: countsMatch },
    };
  } catch (error) {
    return {
      protocolVersion: "chronicle-rust-shadow/v1",
      implementation:
        "chronicle_preprocessing_runtime_wasm/execute_bounded_v2_shadow",
      scope: "selected-runtime-csv-artifacts",
      status: "failed",
      reasons: [error instanceof Error ? error.message : String(error)],
      artifacts: [],
    };
  }
}
