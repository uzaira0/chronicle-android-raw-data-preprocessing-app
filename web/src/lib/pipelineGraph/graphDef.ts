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
import { applyScreenGatedCredit, type CreditResult } from "@/lib/stages/effectiveUsage";
import {
  applyObservationWindow,
  type ObservationWindowResult,
} from "@/lib/stages/observationWindow";
import { attributePerson, type AttributionResult } from "@/lib/stages/attributePerson";
import { scoreCompliance, type ComplianceResult } from "@/lib/stages/scoreCompliance";
import { buildDayCoverage, type DayCoverageResult } from "@/lib/stages/dayCoverage";
import type {
  EnrolledDevice,
  SharingEntry,
  StudyWindow,
  SurveyAnswer,
} from "@/lib/stages/studySupportFiles";

/**
 * The declared pipeline graph — the execution spine of the browser
 * pipeline. Node ids and labels use the community vocabulary
 * (docs/pipeline-graph/08-prior-art-vocabulary.md).
 *
 * Bodies wrap the stage functions 1:1; every option a body reads MUST be
 * declared as a knob binding so the cache key covers it (staleness would
 * otherwise be silent).
 */

export interface PipelineSupportData {
  filterMap: Map<string, Set<string>>;
  appsForcingScreenOpenMap: Map<string, string>;
  backgroundAppsSet: Set<string>;
  codebookMap: Map<string, CodebookRecord>;
  /** Study Inputs (Analyze tier); null = file not provided. */
  studyWindows: StudyWindow[] | null;
  sharingEntries: SharingEntry[] | null;
  surveyAnswers: SurveyAnswer[] | null;
  enrolledDevices: EnrolledDevice[] | null;
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

export interface DayCoverageNodeOutput {
  rows: CanonicalRow[];
  coverage: DayCoverageResult | null;
}

export interface PipelineOutputs {
  appRows: CanonicalRow[];
  screenRows: CanonicalRow[];
  credited: CreditResult | null;
  windowReport: Pick<ObservationWindowResult, "droppedRows" | "participantsWithoutWindow"> | null;
  attribution: AttributionResult["report"] | null;
  coverage: DayCoverageResult | null;
  compliance: ComplianceResult | null;
}

/**
 * Typed view over the untyped options bag `bypassedWhen` receives (the
 * engine and the graph panel both hand it a plain record).
 */
function opts(options: Record<string, unknown>): BrowserProcessingOptions {
  return options as unknown as BrowserProcessingOptions;
}

function requireStudyFile<T>(
  value: T[] | null,
  optionLabel: string,
  fileLabel: string,
): T[] {
  if (value === null) {
    throw new Error(
      `${optionLabel} is enabled but no ${fileLabel} was provided. ` +
        "Upload it under Study Inputs, or turn the option off.",
    );
  }
  return value;
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
        bypassedWhen: (options) => !opts(options).useFilterFile,
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
        bypassedWhen: (options) => !opts(options).processScreenUsage,
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
        bypassedWhen: (options) => !opts(options).processAppUsage,
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
        bypassedWhen: (options) =>
          !opts(options).processAppUsage || !opts(options).useAppCodebook,
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
        bypassedWhen: (options) => !opts(options).processAppUsage,
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
        id: "effective_usage",
        label: "Effective usage (screen-gated credit)",
        section: "clean",
        inputs: ["interval_quality", "app_policy"],
        knobs: [
          { optionKey: "processAppUsage", edge: "gates" },
          { optionKey: "enableScreenGatedCrediting", edge: "gates" },
          { optionKey: "creditedSessionCapMinutes", edge: "tunes" },
          { optionKey: "deviceLivenessGapToleranceMinutes", edge: "tunes" },
          { optionKey: "autoLockBridgeSeconds", edge: "tunes" },
          { optionKey: "noWitnessMinDayApps", edge: "tunes" },
        ],
        bypassedWhen: (options) =>
          !opts(options).processAppUsage || !opts(options).enableScreenGatedCrediting,
        run: (ctx, inputs): CreditResult | null => {
          if (!ctx.options.processAppUsage || !ctx.options.enableScreenGatedCrediting) return null;
          const quality = inputs.interval_quality as CanonicalRow[];
          const events = inputs.app_policy as { rows: CanonicalRow[] };
          return applyScreenGatedCredit(quality, events.rows, {
            capMinutes: ctx.options.creditedSessionCapMinutes,
            livenessToleranceMinutes: ctx.options.deviceLivenessGapToleranceMinutes,
            autoLockBridgeSeconds: ctx.options.autoLockBridgeSeconds,
            noWitnessMinDayApps: ctx.options.noWitnessMinDayApps,
          });
        },
      },
      {
        id: "observation_window",
        label: "Observation-window filtering",
        section: "analyze",
        inputs: ["interval_quality"],
        knobs: [
          { optionKey: "processAppUsage", edge: "gates" },
          { optionKey: "enableStudyWindowFilter", edge: "gates" },
        ],
        supportFiles: ["studyDatesFile"],
        bypassedWhen: (options) =>
          !opts(options).processAppUsage || !opts(options).enableStudyWindowFilter,
        run: (ctx, inputs): ObservationWindowResult => {
          const quality = inputs.interval_quality as CanonicalRow[];
          if (!ctx.options.processAppUsage || !ctx.options.enableStudyWindowFilter) {
            return { rows: quality, droppedRows: 0, participantsWithoutWindow: [] };
          }
          const windows = requireStudyFile(
            ctx.support.studyWindows,
            "The study-window filter",
            "study-dates file",
          );
          return applyObservationWindow(quality, windows);
        },
      },
      {
        id: "attribute_person",
        label: "Person attribution (shared devices)",
        section: "analyze",
        inputs: ["observation_window"],
        knobs: [
          { optionKey: "processAppUsage", edge: "gates" },
          { optionKey: "enablePersonAttribution", edge: "gates" },
        ],
        supportFiles: ["deviceSharingFile", "surveyAttributionFile"],
        bypassedWhen: (options) =>
          !opts(options).processAppUsage || !opts(options).enablePersonAttribution,
        run: (ctx, inputs): AttributionResult | { rows: CanonicalRow[]; report: null } => {
          const windowed = inputs.observation_window as ObservationWindowResult;
          if (!ctx.options.processAppUsage || !ctx.options.enablePersonAttribution) {
            return { rows: windowed.rows, report: null };
          }
          const sharing = requireStudyFile(
            ctx.support.sharingEntries,
            "Person attribution",
            "device-sharing file",
          );
          return attributePerson(windowed.rows, sharing, ctx.support.surveyAnswers ?? []);
        },
      },
      {
        id: "day_coverage",
        label: "Day coverage & placeholders",
        section: "analyze",
        inputs: ["attribute_person", "app_policy"],
        knobs: [
          { optionKey: "processAppUsage", edge: "gates" },
          { optionKey: "addNoActivityPlaceholderDays", edge: "gates" },
          { optionKey: "enableDayCoverage", edge: "gates" },
        ],
        supportFiles: ["studyDatesFile"],
        // Both halves (placeholder rows + coverage table) must be off for the
        // node to be a pure pass-through.
        bypassedWhen: (options) =>
          !opts(options).processAppUsage ||
          (!opts(options).addNoActivityPlaceholderDays && !opts(options).enableDayCoverage),
        run: (ctx, inputs): DayCoverageNodeOutput => {
          if (!ctx.options.processAppUsage) return { rows: [], coverage: null };
          const attributed = inputs.attribute_person as { rows: CanonicalRow[] };
          const events = inputs.app_policy as { rows: CanonicalRow[] };
          const rows = ctx.options.addNoActivityPlaceholderDays
            ? addNoActivityPlaceholderRows(attributed.rows, events.rows)
            : attributed.rows;
          let coverage: DayCoverageResult | null = null;
          if (ctx.options.enableDayCoverage) {
            const rawDates = new Map<string, Set<string>>();
            for (const event of events.rows) {
              const pid = event.participant_id || "unknown";
              let set = rawDates.get(pid);
              if (!set) {
                set = new Set();
                rawDates.set(pid, set);
              }
              set.add(event.date);
            }
            coverage = buildDayCoverage(rows, rawDates, ctx.support.studyWindows ?? []);
          }
          ctx.emit("enrich", 1);
          return { rows, coverage };
        },
      },
      {
        id: "score_compliance",
        label: "Compliance scoring",
        section: "analyze",
        inputs: ["day_coverage", "attribute_person"],
        knobs: [
          { optionKey: "processAppUsage", edge: "gates" },
          { optionKey: "enableComplianceScoring", edge: "gates" },
          { optionKey: "complianceThresholdPercent", edge: "tunes" },
        ],
        supportFiles: ["deviceSharingFile", "enrolledDevicesFile"],
        bypassedWhen: (options) =>
          !opts(options).processAppUsage || !opts(options).enableComplianceScoring,
        run: (ctx, inputs): ComplianceResult | null => {
          if (!ctx.options.processAppUsage || !ctx.options.enableComplianceScoring) return null;
          const covered = inputs.day_coverage as DayCoverageNodeOutput;
          const attributed = inputs.attribute_person as AttributionResult | { report: null };
          const shared = new Set(attributed.report?.sharedParticipants ?? []);
          return scoreCompliance(covered.rows, shared, ctx.options.complianceThresholdPercent);
        },
      },
      {
        id: "outputs",
        label: "Outputs",
        section: "output",
        inputs: [
          "day_coverage",
          "device_state_timeline",
          "effective_usage",
          "observation_window",
          "attribute_person",
          "score_compliance",
        ],
        knobs: [],
        run: (_ctx, inputs): PipelineOutputs => {
          const covered = inputs.day_coverage as DayCoverageNodeOutput;
          const windowed = inputs.observation_window as ObservationWindowResult;
          const attributed = inputs.attribute_person as AttributionResult | { report: null };
          return {
            appRows: covered.rows,
            screenRows: inputs.device_state_timeline as CanonicalRow[],
            credited: inputs.effective_usage as CreditResult | null,
            windowReport: {
              droppedRows: windowed.droppedRows,
              participantsWithoutWindow: windowed.participantsWithoutWindow,
            },
            attribution: attributed.report,
            coverage: covered.coverage,
            compliance: inputs.score_compliance as ComplianceResult | null,
          };
        },
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
