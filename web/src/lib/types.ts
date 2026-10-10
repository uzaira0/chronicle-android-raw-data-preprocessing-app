export type {
  BrowserProcessingOptions,
  BrowserTimezoneHandling,
  OutputKind,
} from "@/lib/generatedContract";
import type {
  BrowserProcessingOptions,
  OutputKind,
  RAW_CHRONICLE_COLUMNS,
} from "@/lib/generatedContract";
import type { RustExecutionLedger } from "@/lib/rustExecutionRecords";
import type { Scene, SceneRegion } from "@/lib/plotScene";

/** One participant's interactive day-grid timeline: the render scene plus the
 * per-session hover regions, powering the in-app View tab (#18). */
export type TimelineParticipantView = {
  participantId: string;
  scene: Scene;
  regions: SceneRegion[];
};

/** Interactive timeline payload for one processed file: app and screen views,
 * one entry per participant. Present only when the timeline viewer is enabled. */
export type TimelineViewData = {
  timezone: string;
  includeFilteredAppUsageInPlots?: boolean;
  appFilteredIncluded?: TimelineParticipantView[];
  appFilteredExcluded?: TimelineParticipantView[];
  app: TimelineParticipantView[];
  screen: TimelineParticipantView[];
};

export type MatcherInput = {
  appCodes: Int32Array;
  timestampNs: BigInt64Array;
  resumed: Uint8Array;
  sameStop: Uint8Array;
  otherStop: Uint8Array;
  stopped: Uint8Array;
  /** Per-event flag: 1 when the event's app is a declared background app. */
  background: Uint8Array;
  options: {
    allowStopEventReuse: boolean;
    useActivityStoppedAsFallback: boolean;
    applyThresholdToFallback: boolean;
    longDurationThresholdNs: bigint;
    /**
     * Intra-app teardown grace, in nanoseconds. 0 selects the optimized sparse
     * Rust path; a positive value selects the reference-compatible Rust grace
     * path in the same WASM module.
     */
    proximityNs: bigint;
  };
};

export type MatcherOutput = {
  startIndices: number[];
  stopStartIndices: number[];
  stopEventIndices: number[];
  missingIndices: number[];
};

/** One row returned by the WASM `splitOverlappingSessions` export. */
export type LayeredSessionRow = {
  sessionIndex: number;
  startNs: bigint;
  stopNs: bigint;
  layer: "primary" | "secondary";
};

/**
 * Input to `splitOverlappingSessions`: parallel arrays of start/stop
 * nanosecond timestamps for the already-paired app sessions.
 */
export type SplitterInput = {
  starts: BigInt64Array;
  stops: BigInt64Array;
};

/** Output of `splitOverlappingSessions`. */
export type SplitterOutput = LayeredSessionRow[];

/**
 * One raw Chronicle CSV row, keyed by the LITERAL export headers. Derived
 * from the generated contract (RawChronicleEventRecord in
 * schema/chronicle-local-contract.linkml.yaml) so the ingest boundary has a
 * single source of truth. Every field is optional at the type level — the
 * required columns are an advisory expectation enforced as warnings by
 * fileInspection, never a parse gate.
 */
export type RawChronicleRow = Partial<
  Record<(typeof RAW_CHRONICLE_COLUMNS)[number], string>
>;

export type BrowserSupportFile = {
  name: string;
  bytes: ArrayBuffer;
};

export type BrowserSupportFiles = {
  filterFile?: BrowserSupportFile;
  appsForcingScreenOpenFile?: BrowserSupportFile;
  backgroundAppsFile?: BrowserSupportFile;
  appCodebookFile?: BrowserSupportFile;
  /** Study Inputs (Analyze tier) — see docs/workflow/. */
  studyDatesFile?: BrowserSupportFile;
  deviceSharingFile?: BrowserSupportFile;
  surveyAttributionFile?: BrowserSupportFile;
  enrolledDevicesFile?: BrowserSupportFile;
  inputCapabilityEvidenceFile?: BrowserSupportFile;
  analysisFeatureMatrixFile?: BrowserSupportFile;
  callSmsEligibilityFile?: BrowserSupportFile;
  phoneStudyPsCommunicationFile?: BrowserSupportFile;
  phoneStudyEsFile?: BrowserSupportFile;
  anchorEventsFile?: BrowserSupportFile;
};

export type MethodProfileReceipt = {
  methodProfileId: string;
  sourceWorkId: string;
  sourceMethodVariantId: string;
  /** Exact source-declared levels selected within the outer configuration space. */
  sourceMethodVariantIds: string[];
  /** Exact source-enumerated combination, when the source names one. */
  sourceMethodCombinationId?: string;
  methodProfileVersion: string;
  settingIds: string[];
  bindings: Array<{
    settingId: string;
    slot: string;
    value: unknown;
    conformanceFixtureId: string;
    conformanceResultDigest: string;
  }>;
  inputBindings?: Array<{
    settingId: string;
    routeKind: "protocol_input" | "native_operator_parameter";
    inputRole: string;
    schemaId: string;
    adapterId: string;
    adapterVersion: string;
    requiredFields: string[];
    sourceValue: unknown;
    sourceWorkId?: string;
    sourceValueSha256?: string;
    sourceSchema?: {
      methodSettingId: string;
      sourceWorkId: string;
      sourceValue: unknown;
      sourceValueSha256: string;
      kind: "event_type" | "field_alias" | "field_passthrough" | "scope_guard";
      sourceExact?: boolean;
      sourceField: string;
      sourceMatchValue?: string;
      canonicalField?: "interaction_type" | "event_timestamp" | "app_package_name";
      canonicalValue?: string;
      requiresPackage: boolean;
    };
    conformanceFixtureId: string;
    conformanceResultDigest: string;
  }>;
  /** Exact source-published output tuple fields bound to Chronicle's emitted columns. */
  outputBindings?: Array<{
    settingId: string;
    outputKind: "app-csv" | "screen-csv";
    sourceField: string;
    sourcePosition: number;
    canonicalField: string;
    conformanceFixtureId: string;
    conformanceResultDigest: string;
  }>;
  documentaryBindings?: Array<{
    settingId: string;
    registryInput: Record<string, unknown>;
    conformanceFixtureId: string;
    conformanceResultDigest: string;
    executionEligible: false;
  }>;
  /** Content-bound execution through a registered, source-versioned analysis runtime. */
  externalBindings?: Array<{
    executorId: string;
    destinationId: string;
    sourceConfigurationId: string;
    bindingKind: "model" | "campaign";
    settingIds: string[];
    receiptId: string;
    modelName?: string;
    formula?: string;
    observations?: number;
    aggregateEvidence?: {
      methodExecutionPassed: true;
      publishedNumericOraclePassed: boolean;
      sourceJobCount: number;
      executedSourceJobCount: number;
      generatedResultRows: number;
      publishedOracleRows: number;
      publishedOracleJobCount: number;
      numericOracleCellsCompared: number;
      numericOracleCellsMismatched: number;
      jobsWithoutPublishedNumericOracles: number;
      sourceJobsSha256: string;
      sourceResultsSha256: string;
      generatedResultManifestSha256: string;
    };
    runtime: string;
    runtimeVersion: string;
    containerImageDigest: string;
    conformanceFixtureId: string;
    conformanceResultDigest: string;
    executionReceiptDigest: string;
  }>;
  diaryReplicationBinding?: DiaryReplicationBindingReceipt;
};

export type MethodProfileReceipts = {
  android?: MethodProfileReceipt;
  sleepDiary?: MethodProfileReceipt;
};

/** Which optional support inputs a method receipt's settings require. */
export type MethodReceiptInputUses = {
  inputCapabilityEvidence: boolean;
  analysisFeatureMatrix: boolean;
  callSmsEligibility: boolean;
  phoneStudyPsCommunication: boolean;
  phoneStudyEs: boolean;
  anchorEvents: boolean;
};

export type DiarySourceAdapterReceipt = {
  contractVersion: "diary-source-adapter-receipt-v1";
  mappingProfileId: string;
  mappingProfileVersion: string;
  adapterId: string;
  adapterVersion: string;
  conformanceFixtureIds: string[];
  sourceSha256: string;
  normalizedSha256: string;
};

/** Exact, fail-closed binding to the generated Sleep Scoring diary authority. */
export type DiaryReplicationBindingReceipt = {
  contractVersion: "chronicle-diary-replication-binding-v1";
  settingId: string;
  bridgePayloadSha256: string;
  catalogSourceSha256: string;
  versionDefinitionId: string;
  sourceMethodVariantId: string;
  mappingProfileId: string;
  mappingProfileVersion: string;
  adapterId: string;
  adapterVersion: string;
  fixtureId: string;
  fixtureInputSha256: string;
  fixtureNormalizedSha256: string;
  profileExecutionStatus: "blocked";
  blockerCodes: string[];
  diaryItemCount: number;
  formElementCount: number;
  scheduleRuleCount: number;
  administrationScheduleCount: number;
  ruleDefinitionCount: number;
  sourceAdapterReceipt: DiarySourceAdapterReceipt;
};

export type BrowserProcessingRuntime = {
  datetimeOfPreprocessing?: string;
  /** The only supported computational authority. */
  executionAuthority?: "rust";
  /** Persist verified Rust artifacts and alternating roots in OPFS. */
  persistRustWorkspace?: boolean;
  /**
   * Run the Salsa incremental engine (memoized queries, warm A/B review,
   * persisted resume bases). Only `true` enables it; `false` or absent sends
   * every request through the sequential scheduler, which recomputes the
   * whole registry from the raw file. The app sets it from a local
   * Performance toggle that defaults off.
   */
  incrementalEngine?: boolean;
  /**
   * Build the three optional provenance evidence Arrow files. Only `true`
   * enables their builders; `false` or absent skips them.
   */
  provenanceEvidence?: boolean;
  /** Opt-in benchmark trace ID; never enters semantic inputs or artifacts. */
  performanceTraceId?: string;
  /** Source-paper profile identity and exact bindings; committed as a runtime artifact. */
  methodProfileReceipt?: MethodProfileReceipt;
  /** Independently validated Android and sleep-diary receipts. */
  methodProfileReceipts?: MethodProfileReceipt[];
};

/** Presence-only support-role input for the pre-run Workflow Explorer request. */
export type WorkflowExplorerSupportRole = {
  roleId: string;
  present: boolean;
  digest?: string;
};

export type RustWorkflowExplorerView = {
  protocolVersion: "chronicle-workflow-explorer/v1";
  viewId: "chronicle-workflow-explorer/v1";
  schemaId: "urn:chronicle:view:workflow-explorer:v1";
  revision: number;
  rootDigest: string;
  selectedRunRoot: string | null;
  contractDigests: {
    semantic: string;
    presentation: string;
    execution: string;
    checkpointPolicy: string;
    evidence: string;
    workspaceCompatibility: string;
  };
  phases: Array<{
    phaseId: string;
    label: string;
    description: string;
    displayOrder: number;
    inputPhaseIds: string[];
    applicable: boolean;
  }>;
  operations: Array<{
    operationId: string;
    label: string;
    description: string;
    phaseId: string;
    role: string;
    epistemicRole: string;
    inputArtifactIds: string[];
    outputArtifactIds: string[];
    dataEffects: string[];
    applicable: boolean;
    runState:
      "applied" | "bypassed" | "not_applicable" | "not_observed" | "error";
    offReason: string | null;
  }>;
  artifacts: Array<{
    artifactId: string;
    label: string;
    kind: string;
    producerOperationId: string | null;
    consumerOperationIds: string[];
    runState: "materialized" | "absent" | "not_observed" | "error";
  }>;
  queries: Array<{
    queryId: string;
    queryGroupId: string;
    inputQueryIds: string[];
    operationIds: string[];
    outputArtifactIds: string[];
    applicability: "applicable" | "not_applicable";
    physicalState:
      | "executed"
      | "memoized"
      | "restored"
      | "omitted"
      | "not_observed"
      | "error";
    reuseReason: string | null;
    checkpointSource: string | null;
  }>;
  decisions: Array<{
    inputId: string;
    inputKind: "option" | "support";
    directQueryIds: string[];
    affectedOperationIds: string[];
    affectedArtifactIds: string[];
  }>;
};

export type RustRuntimeReceipt = {
  protocolVersion: "chronicle-preprocessing-runtime/v2";
  workspaceId: string;
  workspaceRootDigest: string;
  previousWorkspaceRootDigest: string | null;
  implementationDigest: string;
  buildEnvironmentDigest: string;
  planDigest: string;
  profileDigest: string;
  profileLockDigest: string;
  productContractDigest: string;
  journalDigest: string;
  openObligationCount: number;
  persistedGeneration?: number;
};

/**
 * Exact inputs needed to render browser-owned static plots from the verified
 * Rust visualization artifact. Keeping this small descriptor avoids retaining
 * every PNG/SVG blob while a large batch is being processed.
 */
export type PersistedPlotRequest = {
  workspaceId: string;
  workspaceRootDigest: string;
  inputFileName: string;
  timezone: string;
  preprocessorVersion: string;
  options: Pick<
    BrowserProcessingOptions,
    | "processAppUsage"
    | "processScreenUsage"
    | "enablePlotting"
    | "includeFilteredAppUsageInPlots"
    | "enableActivityHeatmap"
    | "exportPlotsAsSvg"
  >;
};

/**
 * Exact inputs needed to build the selected interactive timeline from the
 * verified Rust visualization artifact without retaining every file's scene.
 */
export type PersistedTimelineRequest = {
  workspaceId: string;
  workspaceRootDigest: string;
  inputFileName: string;
  timezone: string;
  preprocessorVersion: string;
  options: Pick<
    BrowserProcessingOptions,
    | "processAppUsage"
    | "processScreenUsage"
    | "includeFilteredAppUsageInPlots"
    | "enableInteractiveTimeline"
  >;
};

/** Exact identities for a fast, non-persisted A/B review calculation. */
export type RustReviewReceipt = {
  protocolVersion: "chronicle-preprocessing-runtime/v2";
  workspaceId: string;
  previousWorkspaceRootDigest: string | null;
  inputDigest: string;
  optionsDigest: string;
  implementationDigest: string;
  buildEnvironmentDigest: string;
  planDigest: string;
  profileDigest: string;
  profileLockDigest: string;
  productContractDigest: string;
  dependencyCertificateDigest: string;
  reviewSummaryDigest: string;
  comparisonDigest: string;
  cacheSources: Array<
    "salsa-memory" | "verified-review-base" | "verified-reconstruction-base"
  >;
  /** Exact persisted cache bytes supplied to the Rust comparison call. */
  suppliedReviewBaseBytes: number;
  suppliedReconstructionBaseBytes: number;
  recomputedQueryIds: string[];
  cachedQueryIds: string[];
  bypassedQueryIds: string[];
  skippedQueryIds: string[];
  errorQueryIds: string[];
};

export type ProgressStepKind =
  | "parse"
  | "timezone"
  | "filter"
  | "screen"
  | "matcher"
  | "codebook"
  | "enrich"
  | "output";

export type ProgressEvent =
  | { type: "file-start"; fileName: string }
  | {
      type: "step";
      fileName: string;
      stepKind: ProgressStepKind;
      percent: number;
    }
  | {
      type: "file-complete";
      fileName: string;
      result?: ProcessedFileResult;
      error?: string;
      scientificPreflightRefusal?: import("@/lib/generatedRuntimeBoundary").RuntimeScientificPreflightReceipt;
    };

/**
 * One generated output file (app or screen). The CSV bytes live in `blob`
 * (file-backed in Chrome once it exceeds the in-memory threshold), so the
 * main thread keeps only a cheap reference instead of pinning the full CSV
 * string in the JS heap. `previewRows` is precomputed by the pipeline (first
 * 1 header + up to 50 data rows already split into cells) so the result
 * panel can render the preview without re-parsing the blob.
 */
export type ProcessedOutputFileResult = {
  kind: OutputKind;
  outputFileName: string;
  /** Present for generated browser-only files and non-persisted executions. */
  blob: Blob | null;
  /** Durable Rust outputs stay in OPFS and are loaded only when downloaded. */
  persistedArtifact?: {
    workspaceId: string;
    /** Pins the download to the exact run that advertised this output. */
    workspaceRootDigest: string;
    kind: string;
    mediaType: string;
    size: number;
  };
  rowCount: number;
  previewRows: string[][];
};

export type TimezoneAction =
  | "none"
  | "filtered_to_selected"
  | "converted_to_selected"
  | "filtered_to_primary"
  | "converted_to_primary";

/**
 * Per-day, per-participant flag surfaced in the View-tab review. Extensible —
 * `no_usage_day` marks a calendar day inside a participant's observed span that
 * has no app or screen sessions (a gap day, the reference's `no_data_day`).
 */
export type ReviewFlag = "no_usage_day";

/** One app's contribution to a single day, for the day-detail breakdown. */
export type ReviewTopApp = {
  appPackageName: string;
  applicationLabel: string;
  category: string | null;
  minutes: number;
};

/** Authoritative per-day metrics for one participant, sourced from the same
 * aggregation primitives that back the daily-summary export. */
export type ReviewDayMetrics = {
  date: string;
  appUsageMinutes: number;
  backgroundAppUsageMinutes: number;
  screenUsageMinutes: number;
  appSessionCount: number;
  screenSessionCount: number;
  flags: ReviewFlag[];
};

export type ReviewParticipantTotals = {
  appUsageMinutes: number;
  backgroundAppUsageMinutes: number;
  screenUsageMinutes: number;
  appSessionCount: number;
  screenSessionCount: number;
  daysWithUsage: number;
  totalDays: number;
};

export type ReviewParticipantSummary = {
  participantId: string;
  studyId: string;
  totals: ReviewParticipantTotals;
  perDay: ReviewDayMetrics[];
  /** Top apps by minutes for each observed date (for the day-detail panel). */
  topAppsByDate: Record<string, ReviewTopApp[]>;
};

/**
 * Compact review payload computed for every run (independent of the HTML-export
 * toggle) so the View tab can show metric cards, a per-day table, and day detail
 * without re-parsing output blobs. One entry per participant in the file.
 */
export type ReviewSummary = {
  participants: ReviewParticipantSummary[];
};

/** Spill-bridge traffic counters; see `ProcessedFileResult.workerPayloadSpill`. */
export type PayloadSpillStats = {
  puts: number;
  gets: number;
  putBytes: number;
  getBytes: number;
  putMs: number;
  getMs: number;
};

/** An output that could not be generated or read and was left out, with why. */
export type SkippedOutput = { outputFileName: string; reason: string };

export type CleaningSummaryStep = {
  step: string;
  detail: string;
  count: number;
};

export type ProcessedFileResult = {
  inputFileName: string;
  outputs: ProcessedOutputFileResult[];
  /** Outputs drawn during processing that failed (a plot past the browser's
   * canvas limits) and were left out instead of failing the file. */
  skippedOutputs?: SkippedOutput[];
  originalRowCount: number;
  processedRowCount: number;
  availableTimezones: string[];
  timezone: string;
  appRowCount: number;
  screenRowCount: number;
  timezoneAction: TimezoneAction;
  rowsBeforeTimezoneHandling: number;
  rowsAfterTimezoneHandling: number;
  rowsRemovedByTimezone: number;
  duplicateTimestampsCorrected: number;
  /** Count of fully-identical raw rows collapsed by {@link dedupeExactRows}. */
  exactDuplicateRowsRemoved: number;
  /** Cleaning settings applied during full processing, with their affected counts. */
  cleaningSummary?: CleaningSummaryStep[];
  /**
   * SHA-256 (hex) of the raw input file, computed in the worker where the
   * bytes live (the parallel path transfers them off the main thread). Used
   * for the run-manifest provenance sidecar. Optional: only populated by the
   * worker entry points, never by a main-thread preprocessing implementation.
   */
  inputSha256?: string;
  /**
   * The processing worker's WASM linear-memory size (bytes) right after this
   * file finished. WASM memory never shrinks, so this is the worker's
   * high-water mark; the batch scheduler feeds it to
   * `computeAdaptiveLaneTarget` to admit more concurrent files when measured
   * cost is below the static worst-case guess. Worker entry points only.
   */
  workerWasmMemoryBytes?: number;
  /**
   * The worker's payload-spill traffic for this file: counts, bytes and the
   * time spent inside the OPFS sync-access-handle read/write calls, measured
   * with performance.now() around each call. Absent when no spill backend was
   * installed (no sync access handles). Worker entry points only.
   */
  workerPayloadSpill?: PayloadSpillStats;
  /** Rust/WASM authority and content-addressed workspace receipt. */
  rustRuntimeReceipt?: RustRuntimeReceipt;
  /** Static plots that can be regenerated from a receipt-pinned OPFS artifact. */
  persistedPlotRequest?: PersistedPlotRequest;
  /** Interactive timeline that can be loaded from a receipt-pinned OPFS artifact. */
  persistedTimelineRequest?: PersistedTimelineRequest;
  /** Exact Rust identities for a fast View-tab comparison calculation. */
  rustReviewReceipt?: RustReviewReceipt;
  /** True when only review metrics were requested, so export/timeline bytes are absent. */
  reviewOnly?: boolean;
  /**
   * Interactive timeline payload for the in-app View tab (#18). Present only
   * when `enableInteractiveTimeline` is on (it carries per-session geometry, so
   * it is opt-in to keep default runs light).
   */
  timelineView?: TimelineViewData;
  /**
   * Compact per-participant review metrics (totals, per-day rows, day-detail top
   * apps) computed for every run. Optional only for backward compatibility with
   * results persisted before this field existed.
   */
  reviewSummary?: ReviewSummary;
  /**
   * Review-only workers keep the exact Rust JSON as transferable bytes. The
   * View tab parses only the selected Arm-B file instead of retaining hundreds
   * of expanded JavaScript object graphs at once.
   */
  reviewSummaryJsonBytes?: Uint8Array;
  /**
   * True when the runtime matched the caller's `knownReviewSummaryDigests` list and
   * returned no summary bytes; the dispatching client reattaches its cached
   * copy (ETag semantics for the 2+ MB review summary).
   */
  reviewSummaryReused?: boolean;
  /**
   * True when this result was rehydrated from the lightweight last-run cache: the
   * browser-only blobs and timeline geometry were dropped before persisting so a
   * refresh cannot exhaust memory/quota. Receipt-pinned Rust outputs remain
   * downloadable, and the selected review summary is loaded from verified OPFS.
   * Static plots remain regenerable from `persistedPlotRequest`; only the
   * interactive timeline needs a re-run.
   */
  restoredWithoutArtifacts?: boolean;
  /**
   * Loud configuration-contradiction notices. Populated when active support
   * lists make contradictory claims about the same package (e.g. an app on
   * both the filter list and the background-apps list) and the pipeline had
   * to apply a precedence rule. Each entry names the packages and states the
   * rule applied, so the resolution is declared instead of silent.
   */
  configNotices?: string[];
  /**
   * Per-node engine statuses + errors from the pipeline graph run that produced
   * this result (Graph tab badges). Optional: absent on results persisted
   * before this field existed.
   */
  /**
   * Per-unit/per-step execution ledger for the run that produced this
   * result (timing, row counts, loss accounting, expectation results) —
   * the runtime-lineage SSOT projected into the run manifest and the
   * PROV-O sidecar. Optional: absent on results persisted before this
   * field existed.
   */
  executionLedger?: RustExecutionLedger;
  /** Product-typed Rust projection used by the Graph tab; never inferred by UI code. */
  workflowExplorerView?: RustWorkflowExplorerView;
};
