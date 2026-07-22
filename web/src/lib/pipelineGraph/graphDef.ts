import type { GraphDef } from "@/lib/pipelineGraph/graphTypes";
import type { BrowserProcessingOptions } from "@/lib/types";
import type { CanonicalRow } from "@/lib/browserPipeline";
import type { CreditResult } from "@/lib/stages/effectiveUsage";
import type { ObservationWindowResult } from "@/lib/stages/observationWindow";
import type { ComplianceResult } from "@/lib/stages/scoreCompliance";
import { runUnit } from "@/lib/pipelineGraph/stepRunner";
// Direct module imports (not the steps/index barrel): graphDef is in the
// same Rollup chunk as the wiring modules, and re-importing them through the
// barrel would create a circular chunk dependency with GraphPanel's lazy
// ALL_UNIT_WIRINGS import.
import { appPolicyWiring } from "@/lib/pipelineGraph/steps/appPolicy";
import { attributePersonWiring } from "@/lib/pipelineGraph/steps/attributePerson";
import { categorizeAppsWiring } from "@/lib/pipelineGraph/steps/categorizeApps";
import { dayCoverageWiring } from "@/lib/pipelineGraph/steps/dayCoverage";
import { dedupAndOrderWiring } from "@/lib/pipelineGraph/steps/dedupAndOrder";
import { deviceStateTimelineWiring } from "@/lib/pipelineGraph/steps/deviceStateTimeline";
import { effectiveUsageWiring } from "@/lib/pipelineGraph/steps/effectiveUsage";
import { episodeAnnotationsWiring } from "@/lib/pipelineGraph/steps/episodeAnnotations";
import { intervalCleaningWiring } from "@/lib/pipelineGraph/steps/intervalCleaning";
import { normalizeTimezonesWiring } from "@/lib/pipelineGraph/steps/normalizeTimezones";
import { observationWindowWiring } from "@/lib/pipelineGraph/steps/observationWindow";
import { outputsWiring } from "@/lib/pipelineGraph/steps/outputs";
import { parseEventsWiring } from "@/lib/pipelineGraph/steps/parseEvents";
import { reconstructEpisodesWiring } from "@/lib/pipelineGraph/steps/reconstructEpisodes";
import { scoreComplianceWiring } from "@/lib/pipelineGraph/steps/scoreCompliance";
import type {
  AttributePersonOutput,
  DayCoverageNodeOutput,
  DedupAndOrderOutput,
  NormalizeTimezonesOutput,
  ParseEventsOutput,
  PipelineCtx,
  PipelineOutputs,
} from "@/lib/pipelineGraph/unitContracts";

/**
 * The declared pipeline graph — the execution spine of the browser
 * pipeline. Node ids and labels use the community vocabulary
 * (docs/pipeline-graph/08-prior-art-vocabulary.md).
 *
 * Bodies execute the unit's STEP WIRING (src/lib/pipelineGraph/steps/*)
 * through the step runner, so the fine-grained DAG the graph view and the
 * contract artifact derive is exactly the dataflow that runs. Every option
 * a step reads MUST be declared as a knob binding so the cache key covers
 * it (staleness would otherwise be silent).
 */

export type {
  AttributePersonOutput,
  DayCoverageNodeOutput,
  DedupAndOrderOutput,
  NormalizeTimezonesOutput,
  ParseEventsOutput,
  PipelineCtx,
  PipelineOutputs,
  PipelineSupportData,
} from "@/lib/pipelineGraph/unitContracts";

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
        description:
          "Reads the raw Chronicle CSV into typed event rows (one row per " +
          "logged interaction) and collects the timezones seen in the file.",
        section: "preprocess",
        inputs: [],
        knobs: [{ optionKey: "interactionTypeRemap", edge: "tunes" }],
        // Early cutoff (Salsa backdating): a remap that matches no event type
        // in the file leaves the parsed rows identical, so the whole
        // downstream graph — including the expensive matcher and splitter —
        // stays cached. Checked by deep equality against the cached value
        // (free on first run; hashing here cost ~14% of pipeline wall time).
        earlyCutoff: true,
        run: async (ctx, inputs): Promise<ParseEventsOutput> => {
          ctx.emit("parse", 0);
          const parsed = await runUnit(parseEventsWiring, ctx, inputs);
          ctx.emit("parse", 1);
          return parsed;
        },
      },
      {
        id: "normalize_timezones",
        label: "Timezone normalization",
        description:
          "Puts every event on one clock (convert or filter, per the " +
          "timezone-handling setting) so durations and day boundaries are " +
          "computed consistently. The original timezone column is preserved.",
        section: "preprocess",
        inputs: ["parse_events"],
        knobs: [
          { optionKey: "selectedTimezone", edge: "tunes" },
          { optionKey: "timezoneHandling", edge: "tunes" },
        ],
        // Early cutoff: an upstream restamp whose rows are unchanged, or a
        // timezone-handling change that is a no-op on this file, keeps the
        // downstream cone cached.
        earlyCutoff: true,
        run: async (ctx, inputs): Promise<NormalizeTimezonesOutput> => {
          ctx.emit("timezone", 0);
          const result = await runUnit(normalizeTimezonesWiring, ctx, inputs);
          ctx.emit("timezone", 0.5);
          return result;
        },
      },
      {
        id: "dedup_and_order",
        label: "Event dedup & ordering",
        description:
          "Removes exact duplicate rows, nudges same-timestamp events apart " +
          "so ordering is deterministic, and marks gaps in the data stream. " +
          "Also fixes the event order the episode builder depends on.",
        section: "preprocess",
        inputs: ["normalize_timezones"],
        knobs: [
          { optionKey: "deduplicateExactRows", edge: "gates" },
          { optionKey: "correctDuplicateEventTimestamps", edge: "gates" },
          { optionKey: "sameAppInteractionTypesToStopUsageAt", edge: "tunes" },
          { optionKey: "otherInteractionTypesToStopUsageAt", edge: "tunes" },
        ],
        // Early cutoff: on a file with no exact-duplicate rows and no
        // duplicate timestamps, the dedup/correct flags are no-ops, so
        // toggling them reruns this node but leaves its output unchanged and
        // the matcher downstream cached.
        earlyCutoff: true,
        run: async (ctx, inputs): Promise<DedupAndOrderOutput> => {
          const result = await runUnit(dedupAndOrderWiring, ctx, inputs);
          ctx.emit("timezone", 1);
          return result;
        },
      },
      {
        id: "app_policy",
        label: "App policy — tag filtered packages",
        description:
          "TAGGING ONLY, nothing is dropped, blanked, or matched here: a junk " +
          "(filter-listed) package's raw events are tagged 'Filtered App *' so " +
          "the filter list is visible downstream. The matcher is junk-BLIND — it " +
          "folds these tags back and matches every app identically — and the one " +
          "lossy filter decision (relabel + blank the junk apps' own episodes) " +
          "lives after matching, in episode reconstruction. So the filter choice " +
          "is NOT a matcher input and valid apps' episodes are provably identical " +
          "with it on or off (pinned by tests). This tag also feeds the screen " +
          "timeline, which is invariant to app-event labels.",
        section: "clean",
        inputs: ["dedup_and_order"],
        knobs: [{ optionKey: "useFilterFile", edge: "gates" }],
        supportFiles: ["filterFile"],
        bypassedWhen: (options) => !opts(options).useFilterFile,
        // Early cutoff: tagging is a pure pass-through when useFilterFile is
        // off (or when the file names no package present here), so the
        // matcher downstream stays cached across those changes.
        earlyCutoff: true,
        run: async (ctx, inputs): Promise<{ rows: CanonicalRow[] }> => {
          ctx.emit("filter", 0);
          const result = await runUnit(appPolicyWiring, ctx, inputs);
          ctx.emit("filter", 1);
          return result;
        },
      },
      {
        id: "device_state_timeline",
        label: "Device-state timeline (screen sessions)",
        description:
          "Builds screen-on/screen-off sessions from the interactive/keyguard " +
          "events (the device-state layer — EYES blocks / Parry & Toth " +
          "brackets). Independent of app episodes; feeds screen outputs and " +
          "the screen-gated credit.",
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
        run: async (ctx, inputs): Promise<CanonicalRow[]> => {
          if (!ctx.options.processScreenUsage) return [];
          ctx.emit("screen", 0);
          const screenRows = await runUnit(deviceStateTimelineWiring, ctx, inputs);
          ctx.emit("screen", 1);
          return screenRows;
        },
      },
      {
        id: "reconstruct_episodes",
        label: "Usage-episode reconstruction",
        description:
          "Pairs app resume/pause/stop events into usage episodes (start, " +
          "stop, duration per app run), applying the proximity glue, the " +
          "minimum-duration floor, stop-event rules, and optional concurrent " +
          "modeling. The measurement core of the pipeline. Runs JUNK-BLIND: " +
          "every app is matched identically, then the junk (filter-listed) apps' " +
          "OWN episodes are relabeled 'Filtered App Usage' — or kept as " +
          "'Filtered App Background Usage' for a background app — the one lossy " +
          "filter decision, downstream of matching. Their timing stays real " +
          "through episode annotation (so engagement gaps are computed against " +
          "real neighbours) and is blanked in interval cleaning.",
        section: "preprocess",
        inputs: ["app_policy"],
        knobs: [
          { optionKey: "processAppUsage", edge: "gates" },
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
          const appRows = await runUnit(reconstructEpisodesWiring, ctx, inputs);
          ctx.emit("matcher", 1);
          return appRows;
        },
      },
      {
        id: "categorize_apps",
        label: "App categorization",
        description:
          "Joins each episode's package name against the app codebook to add " +
          "category and store-metadata columns. Label enrichment only — " +
          "timing is untouched.",
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
        run: async (ctx, inputs): Promise<CanonicalRow[]> => {
          if (!ctx.options.processAppUsage) return [];
          ctx.emit("codebook", 0);
          const enriched = await runUnit(categorizeAppsWiring, ctx, inputs);
          ctx.emit("codebook", 1);
          return enriched;
        },
      },
      {
        id: "episode_annotations",
        label: "Episode annotation (engagement & flags)",
        description:
          "Adds columns, removes nothing: the engagement walk (new-engagement " +
          "30 s / custom threshold, app switches, gaps between episodes) and " +
          "flag-and-retain quality flags for long usage and long data gaps. " +
          "Lossless annotation — the last preprocessing step.",
        section: "preprocess",
        inputs: ["categorize_apps"],
        knobs: [
          { optionKey: "processAppUsage", edge: "gates" },
          { optionKey: "longUsageDurationThresholds", edge: "tunes" },
          { optionKey: "longDataTimeGapThresholds", edge: "tunes" },
          { optionKey: "customAppEngagementDuration", edge: "tunes" },
        ],
        bypassedWhen: (options) => !opts(options).processAppUsage,
        run: async (ctx, inputs): Promise<CanonicalRow[]> => {
          if (!ctx.options.processAppUsage) return [];
          ctx.emit("enrich", 0);
          return runUnit(episodeAnnotationsWiring, ctx, inputs);
        },
      },
      {
        id: "interval_cleaning",
        label: "Interval cleaning (blank & drop)",
        description:
          "The lossy steps, applied AFTER episodes are fully built and " +
          "annotated: blanks the timing of junk (filter-listed) usage rows — " +
          "the SOLE blanking site, after the engagement walk has read their " +
          "real timing; constructed background sessions keep real timing — " +
          "drops event types selected for removal (kept when " +
          "they witness a large data gap), and optionally drops zero-duration " +
          "episodes.",
        section: "clean",
        inputs: ["episode_annotations"],
        knobs: [
          { optionKey: "processAppUsage", edge: "gates" },
          { optionKey: "useFilterFile", edge: "tunes" },
          { optionKey: "interactionTypesToRemove", edge: "tunes" },
          { optionKey: "longDataTimeGapThresholds", edge: "tunes" },
          { optionKey: "filterZeroDurationSessions", edge: "gates" },
        ],
        bypassedWhen: (options) =>
          !opts(options).processAppUsage ||
          (!opts(options).useFilterFile &&
            (opts(options).interactionTypesToRemove?.length ?? 0) === 0 &&
            !opts(options).filterZeroDurationSessions),
        run: async (ctx, inputs): Promise<CanonicalRow[]> => {
          if (!ctx.options.processAppUsage) return [];
          const rows = await runUnit(intervalCleaningWiring, ctx, inputs);
          ctx.emit("enrich", 0.5);
          return rows;
        },
      },
      {
        id: "effective_usage",
        label: "Effective usage (screen-gated credit)",
        description:
          "Credits app time only while the screen is on AND the device is " +
          "provably alive (episodes ∩ device-active, like EYES's Final App " +
          "Usage), then truncates each credited session at the cap. Optional " +
          "and side-by-side — never mutates the headline output.",
        section: "clean",
        inputs: ["interval_cleaning", "app_policy"],
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
        run: async (ctx, inputs): Promise<CreditResult | null> => {
          if (!ctx.options.processAppUsage || !ctx.options.enableScreenGatedCrediting) return null;
          return runUnit(effectiveUsageWiring, ctx, inputs);
        },
      },
      {
        id: "observation_window",
        label: "Observation-window filtering",
        description:
          "Keeps only rows inside each participant's study window (from the " +
          "study-dates file) — a measurement convention applied at analysis " +
          "time, never during preprocessing.",
        section: "analyze",
        inputs: ["interval_cleaning"],
        knobs: [
          { optionKey: "processAppUsage", edge: "gates" },
          { optionKey: "enableStudyWindowFilter", edge: "gates" },
        ],
        supportFiles: ["studyDatesFile"],
        bypassedWhen: (options) =>
          !opts(options).processAppUsage || !opts(options).enableStudyWindowFilter,
        run: async (ctx, inputs): Promise<ObservationWindowResult> => {
          if (!ctx.options.processAppUsage || !ctx.options.enableStudyWindowFilter) {
            const quality = inputs.interval_cleaning as CanonicalRow[];
            return { rows: quality, droppedRows: 0, participantsWithoutWindow: [] };
          }
          requireStudyFile(
            ctx.support.studyWindows,
            "The study-window filter",
            "study-dates file",
          );
          return runUnit(observationWindowWiring, ctx, inputs);
        },
      },
      {
        id: "attribute_person",
        label: "Person attribution (shared devices)",
        description:
          "On shared devices, assigns each episode to a person (target child " +
          "vs others) using the device-sharing file and survey answers. " +
          "Single-user devices pass through unchanged.",
        section: "analyze",
        inputs: ["observation_window"],
        knobs: [
          { optionKey: "processAppUsage", edge: "gates" },
          { optionKey: "enablePersonAttribution", edge: "gates" },
        ],
        supportFiles: ["deviceSharingFile", "surveyAttributionFile"],
        bypassedWhen: (options) =>
          !opts(options).processAppUsage || !opts(options).enablePersonAttribution,
        run: async (ctx, inputs): Promise<AttributePersonOutput> => {
          if (!ctx.options.processAppUsage || !ctx.options.enablePersonAttribution) {
            const windowed = inputs.observation_window as ObservationWindowResult;
            return { rows: windowed.rows, report: null };
          }
          requireStudyFile(
            ctx.support.sharingEntries,
            "Person attribution",
            "device-sharing file",
          );
          return runUnit(attributePersonWiring, ctx, inputs);
        },
      },
      {
        id: "day_coverage",
        label: "Day coverage & placeholders",
        description:
          "Accounts for days, never changes timing: adds explicit no-activity " +
          "placeholder rows for silent days, and builds the per-day coverage " +
          "table (which study days have data, which are gaps).",
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
        run: async (ctx, inputs): Promise<DayCoverageNodeOutput> => {
          if (!ctx.options.processAppUsage) return { rows: [], coverage: null };
          const result = await runUnit(dayCoverageWiring, ctx, inputs);
          ctx.emit("enrich", 1);
          return result;
        },
      },
      {
        id: "score_compliance",
        label: "Compliance scoring",
        description:
          "Scores each shared-device day as known/(known+unknown) usage " +
          "attribution against the compliance threshold. Reads the attributed " +
          "rows; changes nothing upstream.",
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
        run: async (ctx, inputs): Promise<ComplianceResult | null> => {
          if (!ctx.options.processAppUsage || !ctx.options.enableComplianceScoring) return null;
          return runUnit(scoreComplianceWiring, ctx, inputs);
        },
      },
      {
        id: "outputs",
        label: "Outputs",
        description:
          "Assembles everything the run produced — app rows, screen sessions, " +
          "credited usage, window/attribution/coverage/compliance reports — " +
          "into the downloadable result set.",
        section: "output",
        inputs: [
          // Visualization output includes the canonical post-policy event
          // substrate even when every app/screen analysis branch is disabled.
          // Stage-local cold/warm intervention proved that routing only
          // through optional analysis branches can hide this dependency.
          "app_policy",
          "attribute_person",
          "day_coverage",
          "device_state_timeline",
          "effective_usage",
          "observation_window",
          "score_compliance",
        ],
        knobs: [
          // These values are consumed by the Rust output assembly even though
          // the legacy TypeScript host also performs presentation/export work
          // after the logical graph. They must participate in the product plan
          // or an incremental Rust run can reuse stale stamped/aggregate bytes.
          { optionKey: "studyName", edge: "tunes" },
          { optionKey: "enableAggregates", edge: "gates" },
          { optionKey: "aggregateShape", edge: "tunes" },
          { optionKey: "includeCategoryColumn", edge: "gates" },
          { optionKey: "enableParquetExport", edge: "gates" },
          { optionKey: "enableSpssExport", edge: "gates" },
        ],
        run: (ctx, inputs): Promise<PipelineOutputs> => runUnit(outputsWiring, ctx, inputs),
      },
    ],
  };
}

/**
 * Option keys that intentionally have NO node binding: they configure
 * presentation or runtime scheduling — none of which
 * change the session rows the graph computes.
 */
export const UNBOUND_OPTION_KEYS: ReadonlySet<string> = new Set([
  "enablePlotting",
  "includeFilteredAppUsageInPlots",
  "enableActivityHeatmap",
  "exportPlotsAsSvg",
  "enableInteractiveTimeline",
  "plotOnlyTargetChildData",
  "parallelProcessing",
  "parallelMaxWorkers",
  "datetimeOfPreprocessing", // covered by the run input hash
]);
