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

export type BrowserTimezoneHandling =
  | "selected-filter"
  | "selected-convert"
  | "primary-filter"
  | "primary-convert";

export type BrowserUsageSessionMode =
  | "app_usage"
  | "screen_usage"
  | "app_and_screen_usage";

export type BrowserSupportFile = {
  name: string;
  bytes: ArrayBuffer;
};

export type BrowserSupportFiles = {
  filterFile?: BrowserSupportFile | null;
  keepAwakeAppsFile?: BrowserSupportFile | null;
  appCodebookFile?: BrowserSupportFile | null;
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
  includeFilteredAppUsageInPlots: boolean;
  plotOnlyTargetChildData: boolean;
  minimumUsageDuration: number;
  customAppEngagementDuration: number;
  longUsageDurationThresholds: number[];
  longDataTimeGapThresholds: number[];
  screenUsageAutoLockTimeoutSeconds: number;
  screenUsageAutoLockToleranceSeconds: number;
  screenUsageManualLockMaxTailGapSeconds: number;
  screenUsageKeyguardNearStopSeconds: number;
  parallelProcessing: boolean;
  parallelMaxWorkers: number | null;
  sameAppInteractionTypesToStopUsageAt: string[];
  otherInteractionTypesToStopUsageAt: string[];
  interactionTypesToRemove: string[];
};

export type ProcessedOutputFileResult = {
  kind: "app" | "screen";
  outputFileName: string;
  csv: string;
  rowCount: number;
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
