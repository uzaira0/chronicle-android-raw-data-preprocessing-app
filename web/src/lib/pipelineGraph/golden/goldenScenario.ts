import {
  clearPipelineEngines,
  DEFAULT_BROWSER_OPTIONS,
  processRawCsvContent,
} from "@/lib/browserPipeline";
import type {
  BrowserProcessingOptions,
  BrowserProcessingRuntime,
  BrowserSupportFile,
  BrowserSupportFiles,
  ProcessedFileResult,
} from "@/lib/types";

/**
 * Golden reproduction harness — the pipeline's byte-for-byte baseline lock.
 *
 * NORTH STAR (docs/pipeline-graph/13-research-ontology-design.md): the ontology /
 * provenance / LinkML work is descriptive scaffolding around the EXISTING
 * algorithm — it must never change an output. Each scenario runs the real
 * algorithm end-to-end on fixed inputs and produces its exact text outputs;
 * `goldenParity.test.ts` locks them against recorded golden files. Any change —
 * refactor or ontology increment — that alters a byte is surfaced as a failing
 * diff, which is the point.
 *
 * Determinism by construction:
 *  - `proximityIntervalSeconds` stays at its default (2s), so the REAL in-process
 *    JS proximity matcher runs — no WASM, no injected mock. The `runMatcher` /
 *    `runSplitter` stubs THROW, so if any covered config were to route to the
 *    WASM matcher or the concurrent-usage splitter the run would fail loudly
 *    rather than pass on mocked output. (The throw guards the WASM *fallback*; it
 *    does not by itself assert the matcher was invoked — every current scenario
 *    feeds `Activity Resumed` rows so it is, and the byte-lock below is the actual
 *    regression guard.)
 *  - `datetimeOfPreprocessing` is pinned, so stamped output columns are fixed.
 *  - Plotting/heatmaps (the only canvas-touching steps) are off; they are
 *    visualization, not algorithm output.
 *
 * COVERAGE BOUNDARY (do not read this as "the whole pipeline"):
 *  - The concurrent-usage / background-apps branch is NOT locked. It requires the
 *    WASM splitter, which is deliberately stubbed to throw here, so no scenario
 *    sets `modelConcurrentUsage` or supplies a background-apps file. The
 *    `usage_layer` column and Co-Usage aggregate are therefore not exercised by
 *    any golden — changes to that branch will not fail this test.
 *  - Outputs embed `Intl.DateTimeFormat`-rendered local timestamps, whose bytes
 *    depend on the runtime's ICU/tz data. Record and verify goldens on the pinned
 *    toolchain (web/.node-version); an ICU/tz-rule change can shift bytes with no
 *    real algorithm change (re-record with `UPDATE_GOLDEN=1` only on that pin).
 *
 * ONE PARTICIPANT PER SCENARIO. The matcher keys sessions on `app_package_name`,
 * not participant (production feeds one raw file per participant), so mixing
 * participants that share a package cross-contaminates matching. Each scenario is
 * therefore a single participant, mirroring real use.
 */

/** Pinned preprocessing stamp so `datetime_of_preprocessing` is deterministic. */
export const GOLDEN_RUNTIME: BrowserProcessingRuntime = {
  datetimeOfPreprocessing: "2026-07-18 00:00:00 UTC",
};

function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

function file(name: string, text: string): BrowserSupportFile {
  return { name, bytes: bytes(text) };
}

const CODEBOOK_CSV = [
  "app_package_name,application_label,bcm_play_store_genreId,usc_genreId,babyemu_genreId_scraped",
  "com.example.chat,Chat,COMMUNICATION,COMMUNICATION,COMMUNICATION",
  "com.example.social,Social,SOCIAL,SOCIAL,SOCIAL",
  "com.amazon.tahoe,Kids Home,FAMILY,FAMILY,FAMILY",
].join("\n");

/**
 * Option overrides on top of the production defaults. The defaults ARE the
 * baseline we reproduce; we override only environment-incompatible bits (canvas
 * plotting) and turn ON the Analyze tier so its outputs are locked too — that
 * tier is exactly where the ontology's AttributionStatus / coverage work lands.
 */
const BASE_OPTIONS: BrowserProcessingOptions = {
  ...DEFAULT_BROWSER_OPTIONS,
  enablePlotting: false,
  enableActivityHeatmap: false,
  timezoneHandling: "selected-filter",
  selectedTimezone: "America/Chicago",
  enableStudyWindowFilter: true,
  enablePersonAttribution: true,
  enableDayCoverage: true,
  enableComplianceScoring: true,
  addNoActivityPlaceholderDays: true,
};

export interface GoldenScenario {
  name: string;
  inputFileName: string;
  inputCsv: string;
  options: BrowserProcessingOptions;
  supportFiles: BrowserSupportFiles;
}

export const GOLDEN_SCENARIOS: GoldenScenario[] = [
  {
    // Single-user (Non-Shared) device: app + screen usage on 03-07, then a
    // 03-08 with raw activity but no app usage (a coverage / no-activity day).
    name: "single-user device",
    inputFileName: "SingleUser.csv",
    inputCsv: [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P01,Target Child,System,Screen Interactive,android,2026-03-07 10:00:00,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:05,America/Chicago",
      "Study,P01,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:02:05,America/Chicago",
      "Study,P01,Target Child,Kids Home,Activity Resumed,com.amazon.tahoe,2026-03-07 10:05:00,America/Chicago",
      "Study,P01,Target Child,Kids Home,Activity Paused,com.amazon.tahoe,2026-03-07 10:09:00,America/Chicago",
      "Study,P01,Target Child,System,Screen Non-Interactive,android,2026-03-07 10:09:30,America/Chicago",
      "Study,P01,Target Child,System,Screen Interactive,android,2026-03-08 09:00:00,America/Chicago",
      "Study,P01,Target Child,System,Screen Non-Interactive,android,2026-03-08 09:00:40,America/Chicago",
    ].join("\n"),
    options: BASE_OPTIONS,
    supportFiles: {
      appCodebookFile: file("codebook.csv", CODEBOOK_CSV),
      studyDatesFile: file("study_dates.csv", ["participant_id,start_date,end_date", "P01,2026-03-07,2026-03-09"].join("\n")),
      deviceSharingFile: file("device_sharing.csv", ["participant_id,sharing_status", "P01,Non-Shared"].join("\n")),
      enrolledDevicesFile: file("enrolled_devices.csv", ["participant_id,device_count", "P01,1"].join("\n")),
    },
  },
  {
    // Shared device: three sessions land in every attribution bucket — unlabeled
    // non-kids-shell usage -> "None" (unresolved/unknown), kids-shell usage ->
    // "Target Child" (known), and an explicitly "Other" session (known
    // non-target). Compliance = known/(known+unknown).
    name: "shared device",
    inputFileName: "SharedDevice.csv",
    inputCsv: [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P02,,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:00,America/Chicago",
      "Study,P02,,Chat,Activity Paused,com.example.chat,2026-03-07 10:03:00,America/Chicago",
      "Study,P02,,Kids Home,Activity Resumed,com.amazon.tahoe,2026-03-07 10:10:00,America/Chicago",
      "Study,P02,,Kids Home,Activity Paused,com.amazon.tahoe,2026-03-07 10:16:00,America/Chicago",
      "Study,P02,Other,Social,Activity Resumed,com.example.social,2026-03-07 10:20:00,America/Chicago",
      "Study,P02,Other,Social,Activity Paused,com.example.social,2026-03-07 10:25:00,America/Chicago",
    ].join("\n"),
    options: BASE_OPTIONS,
    supportFiles: {
      appCodebookFile: file("codebook.csv", CODEBOOK_CSV),
      studyDatesFile: file("study_dates.csv", ["participant_id,start_date,end_date", "P02,2026-03-07,2026-03-09"].join("\n")),
      deviceSharingFile: file("device_sharing.csv", ["participant_id,sharing_status", "P02,Shared"].join("\n")),
      enrolledDevicesFile: file("enrolled_devices.csv", ["participant_id,device_count", "P02,1"].join("\n")),
    },
  },
  {
    // Filter-file scenario: a Non-Shared participant with a normal app (Chat)
    // and a filter-listed junk app (com.example.filtered / label "Filtered").
    // `useFilterFile: true` + a filterFile support CSV routes the junk-blind
    // matcher path: the junk app's own rows are relabeled to the "Filtered App"
    // interaction family, while the valid app is matched identically. Locks the
    // filtered-app relabeling.
    name: "filter-file device",
    inputFileName: "FilterFile.csv",
    inputCsv: [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P03,Target Child,System,Screen Interactive,android,2026-03-07 10:00:00,America/Chicago",
      "Study,P03,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:05,America/Chicago",
      "Study,P03,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:02:05,America/Chicago",
      "Study,P03,Target Child,Filtered,Activity Resumed,com.example.filtered,2026-03-07 10:05:00,America/Chicago",
      "Study,P03,Target Child,Filtered,Activity Paused,com.example.filtered,2026-03-07 10:07:00,America/Chicago",
      "Study,P03,Target Child,System,Screen Non-Interactive,android,2026-03-07 10:07:30,America/Chicago",
    ].join("\n"),
    options: { ...BASE_OPTIONS, useFilterFile: true },
    supportFiles: {
      appCodebookFile: file("codebook.csv", CODEBOOK_CSV),
      filterFile: file(
        "filter.csv",
        ["app_package_name,known_application_labels", "com.example.filtered,Filtered"].join("\n"),
      ),
      studyDatesFile: file("study_dates.csv", ["participant_id,start_date,end_date", "P03,2026-03-07,2026-03-09"].join("\n")),
      deviceSharingFile: file("device_sharing.csv", ["participant_id,sharing_status", "P03,Non-Shared"].join("\n")),
      enrolledDevicesFile: file("enrolled_devices.csv", ["participant_id,device_count", "P03,1"].join("\n")),
    },
  },
  {
    // Aggregates scenario: a Non-Shared participant with a few app sessions
    // spread across two days. `enableAggregates: true` produces the Daily
    // Summary / Weekly Summary / Top Apps CSVs, plus (codebook supplied)
    // Category Time Budget. Locks the aggregation math.
    name: "aggregates device",
    inputFileName: "Aggregates.csv",
    inputCsv: [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P04,Target Child,System,Screen Interactive,android,2026-03-07 10:00:00,America/Chicago",
      "Study,P04,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:05,America/Chicago",
      "Study,P04,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:04:05,America/Chicago",
      "Study,P04,Target Child,Social,Activity Resumed,com.example.social,2026-03-07 10:10:00,America/Chicago",
      "Study,P04,Target Child,Social,Activity Paused,com.example.social,2026-03-07 10:16:00,America/Chicago",
      "Study,P04,Target Child,System,Screen Non-Interactive,android,2026-03-07 10:16:30,America/Chicago",
      "Study,P04,Target Child,System,Screen Interactive,android,2026-03-08 09:00:00,America/Chicago",
      "Study,P04,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-08 09:00:05,America/Chicago",
      "Study,P04,Target Child,Chat,Activity Paused,com.example.chat,2026-03-08 09:03:05,America/Chicago",
      "Study,P04,Target Child,System,Screen Non-Interactive,android,2026-03-08 09:03:30,America/Chicago",
    ].join("\n"),
    options: { ...BASE_OPTIONS, enableAggregates: true },
    supportFiles: {
      appCodebookFile: file("codebook.csv", CODEBOOK_CSV),
      studyDatesFile: file("study_dates.csv", ["participant_id,start_date,end_date", "P04,2026-03-07,2026-03-09"].join("\n")),
      deviceSharingFile: file("device_sharing.csv", ["participant_id,sharing_status", "P04,Non-Shared"].join("\n")),
      enrolledDevicesFile: file("enrolled_devices.csv", ["participant_id,device_count", "P04,1"].join("\n")),
    },
  },
  {
    // Screen-gated crediting scenario: a Non-Shared participant with app usage
    // during a screen-on window. `enableScreenGatedCrediting: true` (with the
    // default `processScreenUsage: true`) emits the side-by-side
    // "Credited App Usage.csv" from the effective_usage node — locking the
    // crediting math without altering the headline App Usage CSV.
    name: "screen-gated crediting device",
    inputFileName: "Crediting.csv",
    inputCsv: [
      "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
      "Study,P05,Target Child,System,Screen Interactive,android,2026-03-07 10:00:00,America/Chicago",
      "Study,P05,Target Child,Chat,Activity Resumed,com.example.chat,2026-03-07 10:00:05,America/Chicago",
      "Study,P05,Target Child,Chat,Activity Paused,com.example.chat,2026-03-07 10:03:05,America/Chicago",
      "Study,P05,Target Child,Social,Activity Resumed,com.example.social,2026-03-07 10:05:00,America/Chicago",
      "Study,P05,Target Child,Social,Activity Paused,com.example.social,2026-03-07 10:09:00,America/Chicago",
      "Study,P05,Target Child,System,Screen Non-Interactive,android,2026-03-07 10:09:30,America/Chicago",
    ].join("\n"),
    options: { ...BASE_OPTIONS, enableScreenGatedCrediting: true },
    supportFiles: {
      appCodebookFile: file("codebook.csv", CODEBOOK_CSV),
      studyDatesFile: file("study_dates.csv", ["participant_id,start_date,end_date", "P05,2026-03-07,2026-03-09"].join("\n")),
      deviceSharingFile: file("device_sharing.csv", ["participant_id,sharing_status", "P05,Non-Shared"].join("\n")),
      enrolledDevicesFile: file("enrolled_devices.csv", ["participant_id,device_count", "P05,1"].join("\n")),
    },
  },
];

/** A matcher that MUST NOT be called — proves the real proximity path is used. */
const throwingMatcher = (): Promise<never> =>
  Promise.reject(
    new Error(
      "golden: runMatcher was called, but proximityIntervalSeconds>0 must route " +
        "through the real in-process JS proximity matcher instead.",
    ),
  );

/** A splitter that MUST NOT be called — proves no concurrent split is taken. */
const throwingSplitter = (): Promise<never> =>
  Promise.reject(
    new Error(
      "golden: runSplitter was called, but modelConcurrentUsage is off and no " +
        "background apps are configured, so no split should run.",
    ),
  );

/**
 * Run the real algorithm end-to-end for one scenario. Clears the per-file engine
 * cache first so this is always a genuine recompute, never a cached passthrough.
 */
export async function runGoldenScenario(
  scenario: GoldenScenario,
): Promise<ProcessedFileResult> {
  clearPipelineEngines();
  return processRawCsvContent(
    scenario.inputFileName,
    scenario.inputCsv,
    scenario.options,
    scenario.supportFiles,
    throwingMatcher,
    GOLDEN_RUNTIME,
    undefined,
    throwingSplitter,
  );
}

/**
 * Serialize a run's TEXT outputs (CSV app/screen/analyze reports) to a
 * `filename -> content` map. Binary twins (parquet/sav) and canvas plots are
 * intentionally excluded — the CSVs are the algorithm's canonical outputs and
 * the only thing a byte-for-byte diff can meaningfully lock.
 */
export async function serializeGoldenOutputs(
  result: ProcessedFileResult,
): Promise<Map<string, string>> {
  const TEXT_KINDS = new Set(["app", "screen", "aggregate"]);
  const out = new Map<string, string>();
  for (const output of result.outputs) {
    if (!TEXT_KINDS.has(output.kind)) continue;
    if (out.has(output.outputFileName)) {
      throw new Error(`golden: duplicate output filename "${output.outputFileName}"`);
    }
    out.set(output.outputFileName, await output.blob.text());
  }
  return new Map([...out.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}
