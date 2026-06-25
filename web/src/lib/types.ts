export type { BrowserProcessingOptions, BrowserTimezoneHandling, OutputKind } from "@/lib/generatedContract";
import type { OutputKind } from "@/lib/generatedContract";
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
     * Intra-app teardown grace, in nanoseconds. 0 = off (the shared WASM matcher
     * ignores it and runs unchanged). When > 0 the pipeline routes to the JS
     * proximity matcher instead, so the WASM path never sees a non-zero value.
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

export type RawChronicleRow = {
  study_id?: string;
  participant_id?: string;
  possible_device_model?: string;
  username?: string;
  application_label?: string;
  interaction_type?: string;
  app_package_name?: string;
  event_timestamp?: string;
  start_timestamp?: string;
  stop_timestamp?: string;
  timezone?: string;
};

export type BrowserSupportFile = {
  name: string;
  bytes: ArrayBuffer;
};

export type BrowserSupportFiles = {
  filterFile?: BrowserSupportFile;
  appsForcingScreenOpenFile?: BrowserSupportFile;
  backgroundAppsFile?: BrowserSupportFile;
  appCodebookFile?: BrowserSupportFile;
};

export type BrowserProcessingRuntime = {
  datetimeOfPreprocessing?: string;
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
  | { type: "step"; fileName: string; stepKind: ProgressStepKind; percent: number }
  | { type: "file-complete"; fileName: string; result?: ProcessedFileResult; error?: string };

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
   * worker entry points, not by direct `processRawCsvContent` calls.
   */
  inputSha256?: string;
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
};
