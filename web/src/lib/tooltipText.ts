import type { TooltipContent } from "@/components/Tooltip";

/**
 * Per-control tooltip copy. Keys mirror BrowserProcessingOptions field names
 * plus a few UI-only keys (`runMode`, `interactionTypesGroup`).
 *
 * Source notes:
 * - Sourced from docs/app-usage-semantic-decisions.md and
 *   docs/deferred-semantic-quirks.md where the behavior is documented.
 * - Fallback descriptions for fields without a doc reference are paraphrased
 *   from how the pipeline uses each option in browserPipeline.ts.
 */
export const TOOLTIPS = {
  studyName: {
    title: "Study name",
    body: "Your label for this study. Written into the `study_name` column of every output row. This is your own naming, not the `study_id` column from the raw data — that is preserved unchanged.",
  },
  processAppUsage: {
    title: "App usage output",
    body: "Run the app-usage algorithm and include the app-usage CSV in the output ZIP. Each session spans from an Activity Resumed to its matching stop event.",
  },
  processScreenUsage: {
    title: "Screen usage output",
    body: "Derive screen-usage sessions and include the screen-usage CSV in the output ZIP. Sessions are inferred from Screen Interactive / Screen Non-Interactive events.",
  },
  runMode: {
    title: "Process files",
    body: "Runs the preprocessing pipeline on your uploaded raw Chronicle CSVs. The demo card on the top-right runs the same pipeline on a built-in sample so you can demo the output without uploading anything.",
  },

  selectedTimezone: {
    title: "Selected timezone",
    body: "Pick from the typical IANA names (e.g. America/Chicago). When discovery runs, found timezones from your file are added to the suggestions.",
  },
  timezoneHandling: {
    title: "Timezone handling",
    body: "Decides what happens to rows with timezones that differ from the selected one — keep only the matching rows, convert mixed rows to a common zone, or anchor on the file's primary zone.",
  },

  useFilterFile: {
    title: "Use filter file",
    body: "If on, the pipeline labels apps in your filter list as filtered (instead of dropping them). Without an uploaded file the app falls back to the bundled default.",
  },
  useAppsForcingScreenOpenFile: {
    title: "Use apps-forcing-screen-open file",
    body: "Apps in this list are treated as ones that force the screen to stay on during screen-usage derivation, which influences how locks/unlocks are interpreted.",
  },
  useAppCodebook: {
    title: "Use app codebook",
    body: "Enriches each output row with category metadata from the codebook (Play Store genre, USC category, UMich classifications, etc.). Without an uploaded codebook the bundled default is used.",
  },

  longDurationThresholdHours: {
    title: "Max session duration threshold",
    body: "Sessions longer than this many hours are flagged as suspiciously long, which may indicate an instrumentation gap rather than real use.",
    example: "default 12 hours",
  },
  customAppEngagementDuration: {
    title: "Custom app engagement duration",
    body: "Window in seconds within which two consecutive activities on the same app count as continued engagement. Affects how 'first new engagement' is detected.",
    example: "default 300 seconds",
  },
  longUsageDurationThresholds: {
    title: "Long-usage thresholds (hours)",
    body: "Comma-separated hour values. For each value the pipeline emits a column flagging sessions whose duration exceeds it.",
    example: "default 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12",
  },
  longDataTimeGapThresholds: {
    title: "Long data-gap thresholds (hours)",
    body: "Comma-separated hour values. For each value the pipeline emits a column flagging time gaps between events that exceed it.",
    example: "default 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12",
  },
  correctDuplicateEventTimestamps: {
    title: "Correct duplicate timestamps",
    body: "When two events share the same timestamp, nudge the second one forward by microseconds so ordering is preserved deterministically.",
  },
  allowStopEventReuse: {
    title: "Allow stop-event reuse",
    body: "Lets a single stop event close multiple overlapping sessions. Off by default — stop events are consumed once.",
  },
  useActivityStoppedAsFallback: {
    title: "Use Activity Stopped fallback",
    body: "If a session has no explicit stop, fall back to the next 'Activity Stopped' event for the same app. Helps with noisy traces.",
  },
  applyThresholdToFallback: {
    title: "Apply threshold to fallback",
    body: "When the fallback path is used and the implied session is longer than the max threshold above, treat it as a missing-end-of-usage instead of a real session.",
  },

  screenUsageAutoLockTimeoutSeconds: {
    title: "Auto-lock timeout (seconds)",
    body: "Idle period after which the screen is assumed to have auto-locked. Used to infer screen-off time when an explicit lock is missing.",
    example: "default 120 seconds",
  },
  screenUsageAutoLockToleranceSeconds: {
    title: "Auto-lock tolerance (seconds)",
    body: "Slack window around the auto-lock timeout to absorb small clock skews when classifying lock events.",
    example: "default 30 seconds",
  },
  screenUsageManualLockMaxTailGapSeconds: {
    title: "Manual-lock max tail gap (seconds)",
    body: "Maximum allowed gap between the last meaningful activity and an explicit lock event for the lock to count as manual.",
    example: "default 30 seconds",
  },
  screenUsageKeyguardNearStopSeconds: {
    title: "Keyguard-near-stop window (seconds)",
    body: "If the keyguard appears within this many seconds of a session stop, treat it as part of the same lock event.",
    example: "default 2 seconds",
  },

  sameAppInteractionTypesToStopUsageAt: {
    title: "Same-app stop types",
    body: "Interaction types that, when seen for the same app as the current session, end that session.",
  },
  otherInteractionTypesToStopUsageAt: {
    title: "Other-app stop types",
    body: "Interaction types from any other source that close the current session — e.g. a different app coming to the foreground or the device shutting down.",
  },
  interactionTypesToRemove: {
    title: "Interaction types to remove",
    body: "Rows of these types are dropped from the final output. Useful for stripping noisy events you don't want surfaced in the CSV.",
  },

  parallelProcessing: {
    title: "Enable parallel file processing",
    body: "When this is on, the app can process more than one uploaded raw file at the same time. It usually helps only when you upload multiple files; one file still runs by itself.",
  },
  parallelMaxWorkers: {
    title: "Max parallel workers",
    body: "The maximum number of files the app may process at the same time. Use 0 to let the app choose a safe number based on file sizes and browser capacity. Lower it if the browser becomes slow or memory-heavy.",
  },

  enablePlotting: {
    title: "Generate app-usage plots",
    body: "After preprocessing, renders one horizontal-bar timeline chart per participant and includes the PNGs in the output ZIP. Each bar is coloured by app category.",
  },
  includeFilteredAppUsageInPlots: {
    title: "Include filtered apps in plots",
    body: "When on, bars for apps that were filtered (but retained in the output) are drawn alongside normal app-usage bars.",
  },
} as const satisfies Record<string, TooltipContent>;

export type TooltipKey = keyof typeof TOOLTIPS;

export function tooltipFor(key: TooltipKey): TooltipContent {
  return TOOLTIPS[key];
}
