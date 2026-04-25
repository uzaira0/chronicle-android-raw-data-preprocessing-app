import type {
  BrowserTimezoneHandling,
  BrowserUsageSessionMode,
  OutputKind,
} from "@/lib/generatedContract";

export type MatcherInput = {
  appCodes: Int32Array;
  timestampNs: BigInt64Array;
  resumed: Uint8Array;
  sameStop: Uint8Array;
  otherStop: Uint8Array;
  stopped: Uint8Array;
  options: {
    allowStopEventReuse: boolean;
    useActivityStoppedAsFallback: boolean;
    applyThresholdToFallback: boolean;
    longDurationThresholdNs: bigint;
  };
};

export type MatcherOutput = {
  startIndices: number[];
  stopStartIndices: number[];
  stopEventIndices: number[];
  missingIndices: number[];
};

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
  keepAwakeAppsFile?: BrowserSupportFile;
  appCodebookFile?: BrowserSupportFile;
};

export type BrowserProcessingRuntime = {
  datetimeOfPreprocessing?: string;
};

export type BrowserProcessingOptions = {
  studyName: string;
  usageSessionMode: BrowserUsageSessionMode;
  allowStopEventReuse: boolean;
  useActivityStoppedAsFallback: boolean;
  applyThresholdToFallback: boolean;
  longDurationThresholdHours: number;
  correctDuplicateEventTimestamps: boolean;
  selectedTimezone?: string;
  timezoneHandling: BrowserTimezoneHandling;
  useFilterFile: boolean;
  useKeepAwakeAppsFile: boolean;
  useAppCodebook: boolean;
  /** @deprecated Plotting is desktop-only. The web pipeline ignores this. */
  includeFilteredAppUsageInPlots?: boolean;
  /** @deprecated Plotting is desktop-only. The web pipeline ignores this. */
  plotOnlyTargetChildData?: boolean;
  /** @deprecated Compatibility-only — never read by the pipeline. */
  minimumUsageDuration?: number;
  customAppEngagementDuration: number;
  longUsageDurationThresholds: number[];
  longDataTimeGapThresholds: number[];
  screenUsageAutoLockTimeoutSeconds: number;
  screenUsageAutoLockToleranceSeconds: number;
  screenUsageManualLockMaxTailGapSeconds: number;
  screenUsageKeyguardNearStopSeconds: number;
  parallelProcessing: boolean;
  parallelMaxWorkers?: number;
  sameAppInteractionTypesToStopUsageAt: string[];
  otherInteractionTypesToStopUsageAt: string[];
  interactionTypesToRemove: string[];
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

export type ProcessedFileResult = {
  inputFileName: string;
  outputs: ProcessedOutputFileResult[];
  originalRowCount: number;
  processedRowCount: number;
  availableTimezones: string[];
  timezone: string;
  appRowCount: number;
  screenRowCount: number;
};
