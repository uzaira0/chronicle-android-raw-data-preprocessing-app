import { readFile } from "node:fs/promises";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { buildChronicleGraph } from "@/lib/pipelineGraph/graphDef";
import { topoSort } from "@/lib/pipelineGraph/engine";
import type { PipelineCtx, PipelineSupportData } from "@/lib/pipelineGraph/graphDef";
import type { GraphDef } from "@/lib/pipelineGraph/graphTypes";
import type {
  BrowserProcessingOptions,
  MatcherInput,
  MatcherOutput,
  SplitterInput,
  SplitterOutput,
} from "@/lib/types";
import type { CanonicalRow, CodebookRecord } from "@/lib/browserPipeline";

/**
 * Shared harness for the pipeline-graph validation suites
 * (graphValidation.test.ts, enginePropertyValidation.test.ts): real-WASM
 * matcher/splitter init, the pathological one-participant fixture, support
 * construction, the closed-form bypass spec, cone computation, and the
 * per-option alternate-value table. Test-only module — not shipped.
 */

// ── Real wasm matcher/splitter (same init path as scripts/run_browser_processing.mts)

let initPromise: Promise<void> | null = null;

export async function ensureWasm(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const module = await import("@/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js");
    const wasmPath = new URL(
      "../../wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm_bg.wasm",
      import.meta.url,
    );
    // Same cast rationale as workers/chronicle-worker.ts: the pkg .d.ts does
    // not resolve the init signature under this tsconfig's Bundler resolution.
    const init = module.default as unknown as (input: { module_or_path: unknown }) => Promise<unknown>;
    await init({ module_or_path: await readFile(wasmPath) });
  })();
  return initPromise;
}

export async function runMatcher(input: MatcherInput): Promise<MatcherOutput> {
  await ensureWasm();
  const module = await import("@/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js");
  return module.matchAppUsageUpdateIndices(
    input.appCodes,
    input.timestampNs,
    input.resumed,
    input.sameStop,
    input.otherStop,
    input.stopped,
    input.background,
    input.options.allowStopEventReuse,
    input.options.useActivityStoppedAsFallback,
    input.options.applyThresholdToFallback,
    input.options.longDurationThresholdNs,
  ) as MatcherOutput;
}

export async function runSplitter(input: SplitterInput): Promise<SplitterOutput> {
  await ensureWasm();
  const module = await import("@/wasm/chronicle_app_usage_wasm/pkg/chronicle_app_usage_wasm.js");
  const wasmModule = module as unknown as {
    splitOverlappingSessions: (starts: BigInt64Array, stops: BigInt64Array) => SplitterOutput;
  };
  return wasmModule.splitOverlappingSessions(input.starts, input.stops);
}

// ── Fixture: one participant, valid app + junk app + background app + EOUM
//    + screen sessions + a raw-only second day (placeholder/coverage path).

export const JUNK_PACKAGE = "com.junk.game";
export const BG_PACKAGE = "com.bg.music";

export const FIXTURE_CSV = [
  "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
  "Study,P01,Target Child,System,Unknown importance: 15,android,2026-03-07 10:00:00,America/Chicago",
  "Study,P01,Target Child,Chat,Unknown importance: 1,com.valid.chat,2026-03-07 10:00:05,America/Chicago",
  "Study,P01,Target Child,Chat,Unknown importance: 2,com.valid.chat,2026-03-07 10:00:35,America/Chicago",
  `Study,P01,Target Child,Junk Game,Unknown importance: 1,${JUNK_PACKAGE},2026-03-07 10:00:36,America/Chicago`,
  `Study,P01,Target Child,Junk Game,Unknown importance: 2,${JUNK_PACKAGE},2026-03-07 10:01:36,America/Chicago`,
  "Study,P01,Target Child,Chat,Unknown importance: 1,com.valid.chat,2026-03-07 10:01:40,America/Chicago",
  "Study,P01,Target Child,Chat,Unknown importance: 2,com.valid.chat,2026-03-07 10:02:50,America/Chicago",
  `Study,P01,Target Child,Music,Unknown importance: 1,${BG_PACKAGE},2026-03-07 10:02:55,America/Chicago`,
  `Study,P01,Target Child,Music,Unknown importance: 23,${BG_PACKAGE},2026-03-07 10:03:40,America/Chicago`,
  "Study,P01,Target Child,System,Unknown importance: 16,android,2026-03-07 10:04:00,America/Chicago",
  "Study,P01,Target Child,Chat,Unknown importance: 1,com.valid.chat,2026-03-07 11:00:00,America/Chicago",
  "Study,P01,Target Child,System,Unknown importance: 15,android,2026-03-08 09:00:00,America/Chicago",
].join("\n");

export function buildSupport(options: BrowserProcessingOptions): PipelineSupportData {
  // Mirrors processRawCsvContent: maps are only populated when their option
  // is on; study inputs are provided (the error path is tested separately).
  return {
    filterMap: options.useFilterFile
      ? new Map([[JUNK_PACKAGE, new Set<string>()]])
      : new Map<string, Set<string>>(),
    appsForcingScreenOpenMap: new Map(),
    backgroundAppsSet: options.useBackgroundAppsFile ? new Set([BG_PACKAGE]) : new Set(),
    codebookMap: options.useAppCodebook
      ? new Map<string, CodebookRecord>([
          [
            "com.valid.chat",
            { genre: "Communication", store: "Play Store", storeUrl: "", iconUrl: "" },
          ],
        ])
      : new Map<string, CodebookRecord>(),
    studyWindows: [{ participantId: "P01", startDate: "2026-03-06", endDate: "2026-03-09" }],
    sharingEntries: [{ participantId: "P01", status: "Shared" }],
    surveyAnswers: [],
    enrolledDevices: [],
  };
}

export function makeCtx(
  options: BrowserProcessingOptions,
  support: PipelineSupportData = buildSupport(options),
): PipelineCtx {
  return {
    csvText: FIXTURE_CSV,
    options,
    // Mirrors the app contract: processRawCsvContent resolves ONE stamp per
    // (file, content) session, so node bodies never read the clock. Leaving
    // this undefined would make every row-carrying node impure (the
    // enginePropertyValidation from-scratch consistency property catches it
    // as a wall-clock-dependent flake at second boundaries).
    runtime: { datetimeOfPreprocessing: "2026-01-01 00:00:00 UTC" },
    support,
    runMatcher,
    runSplitter,
    emit: () => {},
  };
}

export const RUN_KEYS = (
  options: BrowserProcessingOptions,
  extra?: Partial<{ supportFileHashes: Record<string, string>; inputHash: string }>,
) => ({
  options: options as unknown as Record<string, unknown>,
  supportFileHashes: extra?.supportFileHashes ?? {},
  inputHash: extra?.inputHash ?? "fixture-1",
});

/** Everything on: every gate enabled, no node bypassed. */
export const ALL_ON: BrowserProcessingOptions = {
  ...DEFAULT_BROWSER_OPTIONS,
  processAppUsage: true,
  processScreenUsage: true,
  useFilterFile: true,
  useAppsForcingScreenOpenFile: true,
  useBackgroundAppsFile: true,
  useAppCodebook: true,
  includeCategoryColumn: true,
  modelConcurrentUsage: true,
  applyMinimumUsageDurationToConcurrentSubintervals: true,
  filterZeroDurationSessions: true,
  interactionTypesToRemove: ["Usage Stat"],
  interactionTypeRemap: [],
  timezoneHandling: "selected-convert",
  selectedTimezone: "America/Chicago",
  enableScreenGatedCrediting: true,
  enableStudyWindowFilter: true,
  enablePersonAttribution: true,
  enableComplianceScoring: true,
  addNoActivityPlaceholderDays: true,
  enableDayCoverage: true,
};

// ── Shared graph helpers

export const def = buildChronicleGraph();
export const byId = new Map(def.nodes.map((node) => [node.id, node]));
export const order = topoSort(def as GraphDef<unknown>);

export function descendantsOf(seed: ReadonlySet<string>): Set<string> {
  const dependents = new Map<string, string[]>();
  for (const node of def.nodes) {
    for (const input of node.inputs) {
      const list = dependents.get(input) ?? [];
      list.push(node.id);
      dependents.set(input, list);
    }
  }
  const cone = new Set<string>(seed);
  const queue = [...seed];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const dependent of dependents.get(id) ?? []) {
      if (!cone.has(dependent)) {
        cone.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return cone;
}

/** Closed-form bypass spec — restates the intended state machine. */
export function expectedBypassed(id: string, o: BrowserProcessingOptions): boolean {
  switch (id) {
    case "parse_events":
    case "normalize_timezones":
    case "dedup_and_order":
    case "outputs":
      return false;
    case "app_policy":
      return !o.useFilterFile;
    case "device_state_timeline":
      return !o.processScreenUsage;
    case "reconstruct_episodes":
    case "episode_annotations":
      return !o.processAppUsage;
    case "categorize_apps":
      return !o.processAppUsage || !o.useAppCodebook;
    case "interval_cleaning":
      return (
        !o.processAppUsage ||
        (!o.useFilterFile &&
          (o.interactionTypesToRemove?.length ?? 0) === 0 &&
          !o.filterZeroDurationSessions)
      );
    case "effective_usage":
      return !o.processAppUsage || !o.enableScreenGatedCrediting;
    case "observation_window":
      return !o.processAppUsage || !o.enableStudyWindowFilter;
    case "attribute_person":
      return !o.processAppUsage || !o.enablePersonAttribution;
    case "day_coverage":
      return !o.processAppUsage || (!o.addNoActivityPlaceholderDays && !o.enableDayCoverage);
    case "score_compliance":
      return !o.processAppUsage || !o.enableComplianceScoring;
    default:
      throw new Error(`no bypass spec for node "${id}" — extend the state-machine spec`);
  }
}

export const SUPPORT_FIELD_TO_FILE: Record<keyof PipelineSupportData, string> = {
  filterMap: "filterFile",
  appsForcingScreenOpenMap: "appsForcingScreenOpenFile",
  backgroundAppsSet: "backgroundAppsFile",
  codebookMap: "appCodebookFile",
  studyWindows: "studyDatesFile",
  sharingEntries: "deviceSharingFile",
  surveyAnswers: "surveyAttributionFile",
  enrolledDevices: "enrolledDevicesFile",
};

export const VALID_SUPPORT_FILE_KEYS = new Set(Object.values(SUPPORT_FIELD_TO_FILE));
export const CONTRACT_KEYS = new Set(Object.keys(DEFAULT_BROWSER_OPTIONS));

/**
 * The valid_app_* engagement-walk columns are DEFINED over a filter-dependent
 * universe (the valid walk excludes junk apps), so they legitimately differ
 * with the filter on vs off. The any_app_* columns are NOT excluded: junk
 * rows keep real timing through the walk (blanked only afterwards, in
 * interval cleaning), so the any-app walk sees the same neighbours and the
 * same timestamps in both worlds. Caveat: under concurrent modeling a junk
 * session that OVERLAPS other usage is split in the filter-off world but not
 * in the filter-on world, which can shift any_app_* gaps around the overlap —
 * this fixture has no such overlap, so the strict assertion holds.
 */
export const FILTER_DEPENDENT_ANNOTATION_COLUMNS = new Set([
  "valid_app_new_engage_30s",
  "valid_app_new_engage_custom",
  "valid_app_switched_app",
  "valid_app_usage_time_gap_hours",
]);

export function serializeRows(rows: CanonicalRow[], omit: ReadonlySet<string> = new Set()): string {
  return JSON.stringify(rows, (key, value: unknown) => {
    if (omit.has(key)) return undefined;
    return typeof value === "bigint" ? `${value}n` : value;
  });
}

/** A value guaranteed to change the cache key, valid for the pipeline. */
export function altValue(key: string, value: unknown): unknown {
  if (typeof value === "boolean") return !value;
  if (typeof value === "number") return value + 1;
  switch (key) {
    case "selectedTimezone":
      return "America/New_York";
    case "timezoneHandling":
      return "selected-filter";
    case "sameAppInteractionTypesToStopUsageAt":
      return [...(value as string[]), "Activity Stopped"];
    case "otherInteractionTypesToStopUsageAt":
      return [...(value as string[]), "Device Startup"];
    case "interactionTypesToRemove":
      return [...(value as string[]), "Notification Seen"];
    case "interactionTypeRemap":
      return ["Notification Seen=>Activity Paused"];
    case "longUsageDurationThresholds":
    case "longDataTimeGapThresholds":
      return [...(value as number[]), 24];
    default:
      throw new Error(`no alternate value for option "${key}" — extend altValue`);
  }
}

export const boundOptionKeys = [
  ...new Set(def.nodes.flatMap((node) => node.knobs.map((knob) => knob.optionKey))),
];
