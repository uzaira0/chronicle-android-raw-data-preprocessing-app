export type {
  BrowserProcessingOptions,
  BrowserTimezoneHandling,
  OutputKind,
} from "@/lib/generatedContract";
import type {
  OutputKind,
  RAW_CHRONICLE_COLUMNS,
} from "@/lib/generatedContract";
import type {
  RustExecutionLedger,
  RustExecutionStatus,
} from "@/lib/rustExecutionRecords";
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
  /** Study Inputs (Analyze tier) — see docs/pipeline-graph/. */
  studyDatesFile?: BrowserSupportFile;
  deviceSharingFile?: BrowserSupportFile;
  surveyAttributionFile?: BrowserSupportFile;
  enrolledDevicesFile?: BrowserSupportFile;
};

export type BrowserProcessingRuntime = {
  datetimeOfPreprocessing?: string;
  /** The only supported computational authority. */
  executionAuthority?: "rust";
  /** Persist verified Rust artifacts and alternating roots in OPFS. */
  persistRustWorkspace?: boolean;
};

export type RustStageView = {
  protocol_version: "0.1";
  view_id: "chronicle.stage.v1";
  family: "incremental-dataflow";
  schema_id: "urn:chronicle:view:stage:v1";
  revision: number;
  root_digest: string;
  payload: {
    stage: string | null;
    node_states: Array<{
      node_id: string;
      label: string;
      section: "preprocess" | "clean" | "analyze" | "output";
      input_nodes: string[];
      can_bypass: boolean;
      materialization_state:
        | "open"
        | "ready"
        | "satisfied"
        | "blocked"
        | "invalid"
        | "not_applicable";
      execution_status: RustExecutionStatus | null;
      reason_ids: string[];
    }>;
    step_states: Array<{
      step_id: string;
      unit_id: string;
      label: string;
      description: string;
      input_steps: string[];
      can_bypass: boolean;
      execution_status: RustExecutionStatus | null;
    }>;
  };
};

export type RustRuntimeReceipt = {
  protocolVersion: "chronicle-preprocessing-runtime/v1";
  workspaceId: string;
  workspaceRootDigest: string;
  previousWorkspaceRootDigest: string | null;
  implementationDigest: string;
  planDigest: string;
  profileDigest: string;
  profileLockDigest: string;
  productContractDigest: string;
  journalDigest: string;
  openObligationCount: number;
  persistedGeneration?: number;
};

/** Exact identities for a fast, non-persisted A/B review calculation. */
export type RustReviewReceipt = {
  protocolVersion: "chronicle-preprocessing-runtime/v1";
  workspaceId: string;
  previousWorkspaceRootDigest: string | null;
  inputDigest: string;
  optionsDigest: string;
  implementationDigest: string;
  planDigest: string;
  profileDigest: string;
  profileLockDigest: string;
  productContractDigest: string;
  dependencyCertificateDigest: string;
  reviewSummaryDigest: string;
  comparisonDigest: string;
  recomputedStepIds: string[];
  cachedStepIds: string[];
  bypassedStepIds: string[];
  skippedStepIds: string[];
  errorStepIds: string[];
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
  blob: Blob;
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

export type ProcessedFileResult = {
  inputFileName: string;
  outputs: ProcessedOutputFileResult[];
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
  /**
   * SHA-256 (hex) of the raw input file, computed in the worker where the
   * bytes live (the parallel path transfers them off the main thread). Used
   * for the run-manifest provenance sidecar. Optional: only populated by the
   * worker entry points, never by a main-thread preprocessing implementation.
   */
  inputSha256?: string;
  /** Rust/WASM authority and content-addressed workspace receipt. */
  rustRuntimeReceipt?: RustRuntimeReceipt;
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
   * True when this result was rehydrated from the lightweight last-run cache: the
   * heavy artifacts (`outputs[].blob`, `timelineView`) were dropped before
   * persisting so a refresh can't exhaust memory/quota. Counts and
   * {@link reviewSummary} survive; downloads and the interactive timeline need a
   * re-run. The UI uses this to explain why and to skip "no outputs" warnings.
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
  rustStageView?: RustStageView;
};
