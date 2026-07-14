import type { GraphDef } from "@/lib/pipelineGraph/graphTypes";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  ProgressStepKind,
} from "@/lib/types";
import {
  addAppUsageDetailColumns,
  addNoActivityPlaceholderRows,
  applyTimezoneHandling,
  clearFilteredUsageTiming,
  countDuplicateTimestampGroups,
  dedupeExactRows,
  deriveScreenUsageSessions,
  enrichWithCodebookData,
  labelFilteredApps,
  markAppUsageFlags,
  markDataTimeGaps,
  parseRawRows,
  removeSelectedInteractionTypes,
  runAppUsageAlgorithm,
  unalignDuplicateTimestamps,
  type CanonicalRow,
  type CodebookRecord,
  type MatcherRunner,
  type SplitterRunner,
} from "@/lib/browserPipeline";
import { parseInteractionRemap } from "@/lib/interactionTypes";

/**
 * The declared pipeline graph — the execution spine of the browser
 * pipeline. Node ids and labels use the community vocabulary
 * (docs/pipeline-graph/08-prior-art-vocabulary.md).
 *
 * Bodies wrap the existing stage functions of browserPipeline.ts 1:1;
 * every option a body reads MUST be declared as a knob binding so the
 * cache key covers it (staleness would otherwise be silent).
 */

export interface PipelineSupportData {
  filterMap: Map<string, Set<string>>;
  appsForcingScreenOpenMap: Map<string, string>;
  backgroundAppsSet: Set<string>;
  codebookMap: Map<string, CodebookRecord>;
}

export interface PipelineCtx {
  csvText: string;
  options: BrowserProcessingOptions;
  runtime?: BrowserProcessingRuntime;
  support: PipelineSupportData;
  runMatcher: MatcherRunner;
  runSplitter: SplitterRunner;
  emit: (stepKind: ProgressStepKind, percent: number) => void;
}

export interface ParseEventsOutput {
  rows: CanonicalRow[];
  availableTimezones: string[];
  originalRowCount: number;
}

export interface NormalizeTimezonesOutput {
  rows: CanonicalRow[];
  timezone: string;
  action: ReturnType<typeof applyTimezoneHandling>["action"];
  rowsBefore: number;
  rowsAfter: number;
  rowsRemoved: number;
}

export interface DedupAndOrderOutput {
  rows: CanonicalRow[];
  duplicateTimestampsCorrected: number;
  exactDuplicateRowsRemoved: number;
}

export interface PipelineOutputs {
  appRows: CanonicalRow[];
  screenRows: CanonicalRow[];
}

export function buildChronicleGraph(): GraphDef<PipelineCtx> {
  return {
    nodes: [
      {
        id: "parse_events",
        label: "Event parsing",
        section: "preprocess",
        inputs: [],
        knobs: [{ optionKey: "interactionTypeRemap", edge: "tunes" }],
        run: (ctx): ParseEventsOutput => {
          ctx.emit("parse", 0);
          const remap = parseInteractionRemap(ctx.options.interactionTypeRemap);
          const rows = parseRawRows(ctx.csvText, ctx.runtime, remap);
          const availableTimezones = Array.from(
            new Set(rows.map((row) => row.timezone).filter(Boolean)),
          ).sort((left, right) => left.localeCompare(right));
          ctx.emit("parse", 1);
          return { rows, availableTimezones, originalRowCount: rows.length };
        },
      },
      {
        id: "normalize_timezones",
        label: "Timezone normalization",
        section: "preprocess",
        inputs: ["parse_events"],
        knobs: [
          { optionKey: "selectedTimezone", edge: "tunes" },
          { optionKey: "timezoneHandling", edge: "tunes" },
        ],
        run: (ctx, inputs): NormalizeTimezonesOutput => {
          ctx.emit("timezone", 0);
          const parsed = inputs.parse_events as ParseEventsOutput;
          const result = applyTimezoneHandling(parsed.rows, ctx.options);
          ctx.emit("timezone", 0.5);
          return result;
        },
      },
      {
        id: "dedup_and_order",
        label: "Event dedup & ordering",
        section: "preprocess",
        inputs: ["normalize_timezones"],
        knobs: [
          { optionKey: "deduplicateExactRows", edge: "gates" },
          { optionKey: "correctDuplicateEventTimestamps", edge: "gates" },
          { optionKey: "sameAppInteractionTypesToStopUsageAt", edge: "tunes" },
          { optionKey: "otherInteractionTypesToStopUsageAt", edge: "tunes" },
        ],
        run: (ctx, inputs): DedupAndOrderOutput => {
          const normalized = inputs.normalize_timezones as NormalizeTimezonesOutput;
          const dedupeResult = ctx.options.deduplicateExactRows
            ? dedupeExactRows(normalized.rows)
            : { rows: normalized.rows, removed: 0 };
          const duplicatesBefore = countDuplicateTimestampGroups(dedupeResult.rows);
          const corrected = ctx.options.correctDuplicateEventTimestamps
            ? unalignDuplicateTimestamps(dedupeResult.rows, ctx.options)
            : dedupeResult.rows;
          const rows = markDataTimeGaps(corrected);
          ctx.emit("timezone", 1);
          return {
            rows,
            duplicateTimestampsCorrected: ctx.options.correctDuplicateEventTimestamps
              ? duplicatesBefore
              : 0,
            exactDuplicateRowsRemoved: dedupeResult.removed,
          };
        },
      },
      {
        id: "app_policy",
        label: "App policy (per-package actions)",
        section: "clean",
        inputs: ["dedup_and_order"],
        knobs: [{ optionKey: "useFilterFile", edge: "gates" }],
        supportFiles: ["filterFile"],
        run: (ctx, inputs): { rows: CanonicalRow[] } => {
          ctx.emit("filter", 0);
          const upstream = inputs.dedup_and_order as DedupAndOrderOutput;
          const rows = ctx.options.useFilterFile
            ? labelFilteredApps(upstream.rows, ctx.support.filterMap)
            : upstream.rows;
          ctx.emit("filter", 1);
          return { rows };
        },
      },
      {
        id: "device_state_timeline",
        label: "Device-state timeline (screen sessions)",
        section: "preprocess",
        inputs: ["app_policy"],
        knobs: [
          { optionKey: "processScreenUsage", edge: "gates" },
          { optionKey: "useAppsForcingScreenOpenFile", edge: "gates" },
          { optionKey: "screenUsageAutoLockTimeoutSeconds", edge: "tunes" },
          { optionKey: "screenUsageAutoLockToleranceSeconds", edge: "tunes" },
          { optionKey: "screenUsageManualLockMaxTailGapSeconds", edge: "tunes" },
          { optionKey: "screenUsageKeyguardNearStopSeconds", edge: "tunes" },
        ],
        supportFiles: ["appsForcingScreenOpenFile"],
        run: (ctx, inputs): CanonicalRow[] => {
          if (!ctx.options.processScreenUsage) return [];
          ctx.emit("screen", 0);
          const upstream = inputs.app_policy as { rows: CanonicalRow[] };
          const screenRows = deriveScreenUsageSessions(
            upstream.rows,
            ctx.options,
            ctx.support.appsForcingScreenOpenMap,
          );
          ctx.emit("screen", 1);
          return screenRows;
        },
      },
      {
        id: "reconstruct_episodes",
        label: "Usage-episode reconstruction",
        section: "preprocess",
        inputs: ["app_policy"],
        knobs: [
          { optionKey: "processAppUsage", edge: "gates" },
          { optionKey: "useFilterFile", edge: "tunes" },
          { optionKey: "useBackgroundAppsFile", edge: "gates" },
          { optionKey: "allowStopEventReuse", edge: "tunes" },
          { optionKey: "useActivityStoppedAsFallback", edge: "tunes" },
          { optionKey: "applyThresholdToFallback", edge: "tunes" },
          { optionKey: "longDurationThresholdHours", edge: "tunes" },
          { optionKey: "minimumUsageDuration", edge: "tunes" },
          { optionKey: "proximityIntervalSeconds", edge: "tunes" },
          { optionKey: "modelConcurrentUsage", edge: "gates" },
          { optionKey: "applyMinimumUsageDurationToConcurrentSubintervals", edge: "tunes" },
          { optionKey: "sameAppInteractionTypesToStopUsageAt", edge: "tunes" },
          { optionKey: "otherInteractionTypesToStopUsageAt", edge: "tunes" },
        ],
        supportFiles: ["backgroundAppsFile"],
        run: async (ctx, inputs): Promise<CanonicalRow[]> => {
          if (!ctx.options.processAppUsage) return [];
          ctx.emit("matcher", 0);
          const upstream = inputs.app_policy as { rows: CanonicalRow[] };
          const appRows = await runAppUsageAlgorithm(
            upstream.rows,
            ctx.options,
            ctx.runMatcher,
            ctx.runSplitter,
            ctx.support.backgroundAppsSet,
          );
          ctx.emit("matcher", 1);
          return appRows;
        },
      },
      {
        id: "categorize_apps",
        label: "App categorization",
        section: "preprocess",
        inputs: ["reconstruct_episodes"],
        knobs: [
          { optionKey: "processAppUsage", edge: "gates" },
          { optionKey: "useAppCodebook", edge: "gates" },
          { optionKey: "includeCategoryColumn", edge: "tunes" },
        ],
        supportFiles: ["appCodebookFile"],
        run: (ctx, inputs): CanonicalRow[] => {
          if (!ctx.options.processAppUsage) return [];
          ctx.emit("codebook", 0);
          const episodes = inputs.reconstruct_episodes as CanonicalRow[];
          const enriched = enrichWithCodebookData(episodes, ctx.options, ctx.support.codebookMap);
          ctx.emit("codebook", 1);
          return enriched;
        },
      },
      {
        id: "interval_quality",
        label: "Interval quality (flags & floors)",
        section: "clean",
        inputs: ["categorize_apps"],
        knobs: [
          { optionKey: "processAppUsage", edge: "gates" },
          { optionKey: "longUsageDurationThresholds", edge: "tunes" },
          { optionKey: "longDataTimeGapThresholds", edge: "tunes" },
          { optionKey: "customAppEngagementDuration", edge: "tunes" },
          { optionKey: "interactionTypesToRemove", edge: "tunes" },
          { optionKey: "filterZeroDurationSessions", edge: "gates" },
          { optionKey: "minimumUsageDuration", edge: "tunes" },
        ],
        run: (ctx, inputs): CanonicalRow[] => {
          if (!ctx.options.processAppUsage) return [];
          ctx.emit("enrich", 0);
          const categorized = inputs.categorize_apps as CanonicalRow[];
          let rows = addAppUsageDetailColumns(categorized, ctx.options);
          rows = markAppUsageFlags(rows, ctx.options);
          rows = clearFilteredUsageTiming(rows);
          rows = removeSelectedInteractionTypes(rows, ctx.options);
          if (ctx.options.filterZeroDurationSessions) {
            rows = rows.filter(
              (row) =>
                row.interaction_type !== "App Usage" ||
                row.duration_seconds === null ||
                row.duration_seconds > 0,
            );
          }
          ctx.emit("enrich", 0.5);
          return rows;
        },
      },
      {
        id: "day_coverage",
        label: "Day coverage & placeholders",
        section: "analyze",
        inputs: ["interval_quality", "app_policy"],
        knobs: [
          { optionKey: "processAppUsage", edge: "gates" },
          { optionKey: "addNoActivityPlaceholderDays", edge: "gates" },
        ],
        run: (ctx, inputs): CanonicalRow[] => {
          if (!ctx.options.processAppUsage) return [];
          const quality = inputs.interval_quality as CanonicalRow[];
          const events = inputs.app_policy as { rows: CanonicalRow[] };
          const rows = ctx.options.addNoActivityPlaceholderDays
            ? addNoActivityPlaceholderRows(quality, events.rows)
            : quality;
          ctx.emit("enrich", 1);
          return rows;
        },
      },
      {
        id: "outputs",
        label: "Outputs",
        section: "output",
        inputs: ["day_coverage", "device_state_timeline"],
        knobs: [],
        run: (_ctx, inputs): PipelineOutputs => ({
          appRows: inputs.day_coverage as CanonicalRow[],
          screenRows: inputs.device_state_timeline as CanonicalRow[],
        }),
      },
    ],
  };
}

/**
 * Option keys that intentionally have NO node binding: they configure
 * presentation, export encoders, or runtime scheduling — none of which
 * change the session rows the graph computes.
 */
export const UNBOUND_OPTION_KEYS: ReadonlySet<string> = new Set([
  "studyName", // stamped into CSV records at output-assembly time
  "enablePlotting",
  "includeFilteredAppUsageInPlots",
  "enableActivityHeatmap",
  "exportPlotsAsSvg",
  "enableAggregates",
  "aggregateShape",
  "enableParquetExport",
  "enableSpssExport",
  "enableInteractiveTimeline",
  "plotOnlyTargetChildData",
  "parallelProcessing",
  "parallelMaxWorkers",
  "datetimeOfPreprocessing", // covered by the run input hash
]);
