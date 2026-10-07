/**
 * Every processing option, one change at a time, through the whole app on a
 * realistic-shape file (the real corpus's median size): the share-link
 * `?config=` boot path, the Process run, the View tab and the Download-all
 * ZIP. A case passes when the setting survived boot, the file processed without
 * an error, every CSV in the ZIP parses, no plot was skipped, the output the
 * option switches on is actually offered, and nothing left the browser.
 *
 * Each case also writes its output digests to web/.tmp/preview-matrix/ so the
 * options that changed nothing on this file can be listed afterwards.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import {
  AGGREGATE_SHAPE_VALUES,
  BROWSER_PROCESSING_OPTION_KEYS,
  DEFAULT_BROWSER_OPTIONS,
  RESEARCH_AXIS_VALUES_BY_OPTION,
  TIMEZONE_HANDLING_VALUES,
} from "../src/lib/generatedContract";
import {
  completeMaximumDurationVector,
  MAXIMUM_DURATION_VECTOR_KEYS,
  type MaximumDurationVectorKey,
} from "../src/lib/maximumDurationVector";
import {
  assertNoExternalRequests,
  downloadZipEntries,
  installDeterministicRuntime,
  parseCsv,
  trackExternalRequests,
} from "./helpers";

type Options = Record<string, unknown>;
type Case = { name: string; diff: Options };

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_DIR = path.join(WEB_ROOT, ".tmp", "preview-matrix");
const DEFAULTS = DEFAULT_BROWSER_OPTIONS as unknown as Options;

const ENUM_VALUES: Record<string, readonly string[]> = {
  ...RESEARCH_AXIS_VALUES_BY_OPTION,
  aggregateShape: AGGREGATE_SHAPE_VALUES,
  timezoneHandling: TIMEZONE_HANDLING_VALUES,
};

/** Values for options that are neither enums nor booleans: edges and a typical change. */
const VALUE_CASES: Record<string, unknown[]> = {
  studyName: ["Matrix Study"],
  selectedTimezone: ["America/Chicago", "Asia/Kolkata"],
  longDurationThresholdHours: [1, 6, 48],
  longDurationThresholdHoursExplicit: [true],
  maximumDurationThresholdNs: ["3600000000000"],
  minimumUsageDuration: [0, 2, 600],
  customAppEngagementDuration: [30, 3600],
  longUsageDurationThresholds: [[1], [2, 24]],
  longDataTimeGapThresholds: [[1], [24]],
  screenUsageAutoLockTimeoutSeconds: [1, 30, 1800], // range 1–3600
  screenUsageAutoLockToleranceSeconds: [0, 300],
  screenUsageManualLockMaxTailGapSeconds: [0, 300],
  screenUsageKeyguardNearStopSeconds: [0, 60],
  parallelMaxWorkers: [1],
  sameAppInteractionTypesToStopUsageAt: [[]],
  otherInteractionTypesToStopUsageAt: [[]],
  interactionTypesToRemove: [["Unknown importance: 11"]],
  interactionTypeRemap: [["Unknown importance: 1 => Activity Resumed"]],
  proximityIntervalSeconds: [0, 60],
  creditedSessionCapMinutes: [1, 1440],
  deviceLivenessGapToleranceMinutes: [1, 1440], // range 1–1440
  autoLockBridgeSeconds: [0, 600],
  noWitnessMinDayApps: [1, 10], // range 1–100
  polledEmulationIntervalSeconds: [1, 60],
  polledEmulationGapSeconds: [1, 120],
  complianceThresholdPercent: [0, 100],
  applicationLabelExclusions: [["System"]],
  aggregateTopAppsLimit: [1, 5],
  screenSessionMaximumDurationMinutes: [1, 1440],
};

/** An option whose effect needs another option on is tested with that option on. */
const PARENT: Record<string, Options> = {
  aggregateShape: { enableAggregates: true },
  packageExclusionPreset: { useFilterFile: true },
  longDurationThresholdHoursExplicit: { longDurationThresholdHours: 6 },
  applyMinimumUsageDurationToConcurrentSubintervals: { modelConcurrentUsage: true },
  sessionGapBasis: { sessionGroupingPolicy: "ross_15s" },
  sessionBoundaryScope: { sessionGroupingPolicy: "ross_15s" },
  emitSessionBreakLineage: { sessionGroupingPolicy: "ross_15s" },
  screenGatingRule: { enableScreenGatedCrediting: true },
  creditedSessionCapMinutes: { enableScreenGatedCrediting: true },
  deviceLivenessGapToleranceMinutes: { enableScreenGatedCrediting: true },
  autoLockBridgeSeconds: { enableScreenGatedCrediting: true },
  noWitnessMinDayApps: { enableScreenGatedCrediting: true },
  polledEmulationIntervalSeconds: { polledEmulationMethod: "ross_2025_sampled_gap_v1" },
  polledEmulationGapSeconds: { polledEmulationMethod: "ross_2025_sampled_gap_v1" },
  complianceThresholdPercent: { enableComplianceScoring: true },
  aggregateTopAppsLimit: { enableAggregates: true },
  // The screen-session cap travels as a pair: (none, 0) or (truncate |
  // exclude_participant, > 0); the kernel refuses any other shape. Each case is
  // the pair applyScreenMaximumDurationChange (ScreenDetectionCard) completes a
  // single-control change to: a positive minute value turns "none" into
  // "truncate", and an active disposition starts from 60 minutes.
  screenSessionMaximumDurationMinutes: { screenSessionMaximumDurationDisposition: "truncate" },
  screenSessionMaximumDurationDisposition: { screenSessionMaximumDurationMinutes: 60 },
};

function buildCases(): { cases: Case[]; uncovered: string[] } {
  const cases: Case[] = [{ name: "defaults", diff: {} }];
  const uncovered: string[] = [];
  for (const key of BROWSER_PROCESSING_OPTION_KEYS) {
    const fallback = DEFAULTS[key];
    let values: unknown[];
    if (ENUM_VALUES[key]) values = ENUM_VALUES[key].filter((value) => value !== fallback);
    else if (typeof fallback === "boolean") values = [!fallback];
    else if (VALUE_CASES[key]) values = VALUE_CASES[key];
    else {
      uncovered.push(key);
      continue;
    }
    for (const value of values) {
      // The four maximum-duration keys travel as one of five legal vectors; a
      // partial set is returned to omission on purpose, so each case is the
      // vector the Settings control would complete it to.
      const diff = (MAXIMUM_DURATION_VECTOR_KEYS as readonly string[]).includes(key)
        ? Object.fromEntries(
            Object.entries(
              completeMaximumDurationVector({}, key as MaximumDurationVectorKey, value),
            ).filter(([, entry]) => entry !== undefined),
          )
        : { ...(PARENT[key] ?? {}), [key]: value };
      cases.push({ name: `${key}=${JSON.stringify(value)}`, diff });
    }
  }
  return { cases, uncovered };
}

const { cases: CASES, uncovered: UNCOVERED } = buildCases();

/** The output an option switches on must be offered to the researcher. */
function expectedOffers(diff: Options): { testIds: string[]; entry?: RegExp; noEntry?: RegExp } {
  const testIds: string[] = [];
  if (diff.enableParquetExport === true) testIds.push("download-parquet-zip");
  if (diff.enableSpssExport === true) testIds.push("download-spss-zip");
  if (diff.enableAggregates === true) testIds.push("download-aggregates-zip");
  if (diff.enableInteractiveTimeline === true) testIds.push("download-timeline-viewer");
  if (diff.exportPlotsAsSvg === true) return { testIds, entry: /\.svg$/ };
  if (diff.enablePlotting === false) return { testIds, noEntry: /\.(png|svg)$/ };
  if (diff.enableActivityHeatmap === false) return { testIds, noEntry: /Heatmap/ };
  if (diff.processScreenUsage === false) return { testIds, noEntry: /Screen Usage.*\.csv$/ };
  return { testIds };
}

let fixturePath = "";

// eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern for the fixtures argument
test.beforeAll(({}, workerInfo) => {
  mkdirSync(WORK_DIR, { recursive: true });
  fixturePath = path.join(WORK_DIR, `median-${workerInfo.workerIndex}.csv`);
  if (existsSync(fixturePath)) return;
  execFileSync(
    path.join(WEB_ROOT, "node_modules", ".bin", "vite-node"),
    [
      "scripts/generate_benchmark_fixture.mts",
      "--realistic",
      "--days", "14",
      "--rows-per-day", "400",
      "--seed", "4242",
      "--output", fixturePath,
    ],
    { cwd: WEB_ROOT, stdio: "ignore" },
  );
});

test("@matrix every processing option has a matrix case", () => {
  expect(UNCOVERED).toEqual([]);
});

async function readExportedSettings(page: Page): Promise<Options> {
  await page.getByRole("tab", { name: /Settings/i }).click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-config-button").click();
  const file = await (await download).path();
  if (!file) throw new Error("no exported config");
  return (JSON.parse(readFileSync(file, "utf-8")) as { currentSettings: Options }).currentSettings;
}

// Values the app offers but refuses by design, with the refusal they must show.
const EXPECTED_REFUSALS: Record<string, string> = {
  'maximumDurationThresholdSource="b12_adaptive_participant"':
    "adaptive_maximum_threshold_provider_unavailable",
  // The source-sensitive screen arms need a capability evidence CSV (none here).
  'screenSessionConstructionStrategy="parry_toth_2025_session_glance_v1"':
    "needs an input capability evidence CSV",
  'screenSessionConstructionStrategy="zhu_2018_unlock_lock_v1"':
    "needs an input capability evidence CSV",
  'screenSessionConstructionStrategy="unlock_to_lock_v1"':
    "needs an input capability evidence CSV",
  'screenSessionConstructionStrategy="unlock_to_off_or_lock_v1"':
    "needs an input capability evidence CSV",
  // Stages whose companion file this fixture does not supply.
  "enablePersonAttribution=true": "deviceSharingFile is required",
  "enableStudyWindowFilter=true": "studyDatesFile is required",
};

for (const matrixCase of CASES) {
  test(`@matrix ${matrixCase.name}`, async ({ page }, testInfo) => {
    test.setTimeout(testInfo.project.name === "firefox" ? 360_000 : 180_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const tracker = trackExternalRequests(page);
    await installDeterministicRuntime(page);

    await page.goto(`./?config=${encodeURIComponent(JSON.stringify(matrixCase.diff))}`);
    await expect(
      page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
    ).toBeVisible();

    // The share link must reach the app unchanged: a sanitizer that drops a
    // valid value runs the default instead and every assertion below is moot.
    const applied = await readExportedSettings(page);
    for (const [key, value] of Object.entries(matrixCase.diff)) {
      expect(applied[key], `setting ${key} after boot`).toEqual(value);
    }

    await page.getByTestId("raw-file-input").setInputFiles(fixturePath);
    await page.getByRole("tab", { name: /Process/i }).click();
    const processButton = page.getByTestId("process-files-button");
    await expect(processButton).toBeEnabled();
    await processButton.click();
    const refusal = EXPECTED_REFUSALS[matrixCase.name];
    if (refusal) {
      await expect(page.getByText(refusal).first()).toBeVisible({ timeout: 150_000 });
      await expect(page.getByTestId("result-row")).toHaveCount(0);
      expect(pageErrors).toEqual([]);
      return;
    }
    await expect(page.getByTestId("result-row").or(page.getByTestId("error-detail")).first())
      .toBeVisible({ timeout: 150_000 });
    await expect(page.getByTestId("cancel-process-button")).toHaveCount(0, { timeout: 150_000 });
    await expect(page.getByTestId("error-detail")).toHaveCount(0);
    await expect(page.getByTestId("raw-file-row-error")).toHaveCount(0);

    const entries = await downloadZipEntries(page, "download-all-zip");
    await expect(page.getByTestId("download-error")).toHaveCount(0);
    await expect(page.getByTestId("download-skipped")).toHaveCount(0);
    const names = [...entries.keys()];
    expect(names.some((name) => name.endsWith(".csv")), "ZIP has a CSV").toBe(true);
    for (const [name, text] of entries) {
      if (!name.endsWith(".csv")) continue;
      expect(() => parseCsv(text), `${name} parses`).not.toThrow();
    }

    const offers = expectedOffers(matrixCase.diff);
    for (const testId of offers.testIds) {
      await expect(page.getByTestId(testId).first(), `${testId} offered`).toBeVisible();
    }
    if (offers.entry) expect(names.some((name) => offers.entry!.test(name))).toBe(true);
    if (offers.noEntry) expect(names.filter((name) => offers.noEntry!.test(name))).toEqual([]);

    await page.getByRole("tab", { name: /View/i }).click();
    await expect(
      page.getByTestId("timeline-view").or(page.getByTestId("timeline-view-empty")).first(),
    ).toBeVisible({ timeout: 60_000 });

    writeFileSync(
      path.join(WORK_DIR, `${testInfo.project.name}--${matrixCase.name.replace(/[^\w=.-]+/g, "_")}.json`),
      JSON.stringify({
        case: matrixCase.name,
        diff: matrixCase.diff,
        entries: Object.fromEntries(
          [...entries].map(([name, text]) => [
            name,
            createHash("sha256").update(text).digest("hex"),
          ]),
        ),
      }),
    );
    expect(pageErrors).toEqual([]);
    assertNoExternalRequests(tracker);
  });
}
