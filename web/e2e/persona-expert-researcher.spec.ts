import { expect, test, type Page } from "@playwright/test";

import {
  APP_AND_SCREEN_RAW_CSV,
  APP_ONLY_RAW_CSV,
  APPS_FORCING_SCREEN_OPEN_CSV,
  CODEBOOK_CSV,
  FILTER_FILE_CSV,
  MULTI_FILE_RAW_CSV_B,
} from "./fixtures";
import {
  assertNoExternalRequests,
  csvHeaders,
  downloadCsv,
  expandSectionCard,
  gotoApp,
  installDeterministicRuntime,
  parseCsv,
  processFiles,
  setInputFile,
  setRawFiles,
  trackExternalRequests,
} from "./helpers";

/**
 * Persona 1 — Expert power user.
 *
 * Someone who has read every doc, wants to use every feature, and customises
 * every setting. If the app advertises a capability, this persona uses it and
 * verifies the artifact reflects the settings. Pure browser interaction, no
 * mocks, no store access. Everything stays on localhost (the privacy contract).
 */
test.describe.configure({ mode: "serial" });

let requestTracker: ReturnType<typeof trackExternalRequests>;
let pageErrors: string[];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("response", (response) => {
    if (Math.floor(response.status() / 100) === 5) {
      pageErrors.push(`5xx ${response.status()} ${response.url()}`);
    }
  });
  requestTracker = trackExternalRequests(page);
  await installDeterministicRuntime(page);
  await gotoApp(page);
  assertNoExternalRequests(requestTracker);
});

test.afterEach(() => {
  expect(pageErrors, "no uncaught errors or 5xx responses").toEqual([]);
});

async function uploadFullSupportSet(page: Page): Promise<void> {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");
  await setInputFile(page, "filter-file-input", "filter.csv", FILTER_FILE_CSV, "text/csv");
  await setInputFile(page, "app-codebook-file-input", "codebook.csv", CODEBOOK_CSV, "text/csv");
}

test("configures every export + processing feature and the artifacts reflect them", async ({
  page,
}) => {
  // Turn on every output surface the app advertises.
  await page.getByTestId("toggle-processScreenUsage").check();
  await page.getByTestId("toggle-useAppsForcingScreenOpenFile").check();
  await page.getByTestId("toggle-enableAggregates").check();
  await page.getByTestId("toggle-enableParquetExport").check();
  await page.getByTestId("toggle-enableSpssExport").check();
  await page.getByTestId("toggle-enableInteractiveTimeline").check();
  await page.getByTestId("toggle-includeFilteredAppUsageInPlots").check();
  // App filtering is a cleaning step and off by default; this persona turns
  // every processing feature on and asserts filter semantics in the output.
  await page.getByTestId("toggle-useFilterFile").check();

  await uploadFullSupportSet(page);
  await setInputFile(
    page,
    "apps-forcing-screen-open-file-input",
    "apps_forcing_screen_open.csv",
    APPS_FORCING_SCREEN_OPEN_CSV,
    "text/csv",
  );
  await processFiles(page);

  // Every advertised export produced a download affordance.
  await expect(page.getByTestId("download-app-csv")).toBeVisible();
  await expect(page.getByTestId("download-screen-csv")).toBeVisible();
  await expect(page.getByTestId("download-aggregates-zip")).toBeVisible();
  await expect(page.getByTestId("download-parquet-zip")).toBeVisible();
  await expect(page.getByTestId("download-spss-zip")).toBeVisible();
  await expect(page.getByTestId("download-timeline-viewer")).toBeVisible();

  // Codebook enrichment columns and the filter semantics are visible in output.
  const appCsv = await downloadCsv(page, "download-app-csv");
  expect(csvHeaders(appCsv)).toContain("bcm_play_store_genreId");
  expect(appCsv).toContain("Filtered App Usage");
  const screenCsv = await downloadCsv(page, "download-screen-csv");
  expect(screenCsv).toContain("Screen Usage");
  assertNoExternalRequests(requestTracker);
});

test("every edited setting round-trips through reload", async ({ page }) => {
  await page.getByTestId("study-name-input").fill("EXPERT pilot");
  await page.getByTestId("toggle-processScreenUsage").check();
  await expandSectionCard(page, "timezone");
  await page.getByTestId("timezone-handling-select").selectOption("selected-convert");
  await page.getByTestId("selected-timezone-input").fill("America/Chicago");
  await expandSectionCard(page, "session-detection");
  await page.getByTestId("long-duration-threshold-input").fill("7");
  await page.getByTestId("custom-engagement-duration-input").fill("33");
  await page.getByTestId("long-usage-thresholds-input").fill("1, 3, 9");
  await page.getByTestId("toggle-allowStopEventReuse").check();
  await expandSectionCard(page, "performance");
  await page.getByTestId("toggle-parallelProcessing").check();
  await page.getByTestId("parallel-max-workers-input").fill("4");

  await page.reload();
  await installDeterministicRuntime(page);
  await gotoApp(page);

  await expect(page.getByTestId("study-name-input")).toHaveValue("EXPERT pilot");
  await expect(page.getByTestId("toggle-processScreenUsage")).toBeChecked();
  await expandSectionCard(page, "timezone");
  await expect(page.getByTestId("timezone-handling-select")).toHaveValue("selected-convert");
  await expect(page.getByTestId("selected-timezone-input")).toHaveValue("America/Chicago");
  await expandSectionCard(page, "session-detection");
  await expect(page.getByTestId("long-duration-threshold-input")).toHaveValue("7");
  await expect(page.getByTestId("custom-engagement-duration-input")).toHaveValue("33");
  await expect(page.getByTestId("long-usage-thresholds-input")).toHaveValue("1, 3, 9");
  await expect(page.getByTestId("toggle-allowStopEventReuse")).toBeChecked();
  await expandSectionCard(page, "performance");
  await expect(page.getByTestId("toggle-parallelProcessing")).toBeChecked();
  await expect(page.getByTestId("parallel-max-workers-input")).toHaveValue("4");
  assertNoExternalRequests(requestTracker);
});

test("saves a named preset and a named config, then exports the whole config", async ({ page }) => {
  await page.getByTestId("study-name-input").fill("ExpertConfig");
  await page.getByTestId("preset-name-input").fill("Expert Snapshot");
  await page.getByTestId("save-preset-button").click();
  await expect(page.getByTestId("preset-list")).toContainText("Expert Snapshot");

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-config-button").click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  if (!stream) throw new Error("config export produced no stream");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  expect(exported.currentSettings.studyName).toBe("ExpertConfig");
  expect(exported.presets.map((p: { name: string }) => p.name)).toContain("Expert Snapshot");
  assertNoExternalRequests(requestTracker);
});

test("drives the full review + A/B comparison workflow in the View tab", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");
  await processFiles(page);

  await page.getByRole("tab", { name: /View/i }).click();
  await expect(page.getByTestId("timeline-view")).toBeVisible();
  await expect(page.getByTestId("review-rail")).toBeVisible();
  await expect(page.getByTestId("review-metrics")).toBeVisible();

  // Drill into a day.
  const dayRows = page.getByTestId("review-day-table").locator("tbody tr");
  await expect(dayRows.first()).toBeVisible();
  await dayRows.first().click();
  await expect(page.getByTestId("review-day-detail")).toBeVisible();

  // Run an Arm-B comparison and confirm the single interleaved waterfall.
  await page.getByTestId("review-compare-toggle").click();
  const drawer = page.getByTestId("review-compare-drawer");
  await expect(drawer).toBeVisible();
  await drawer.getByTestId("minimum-usage-duration-input").fill("999999");
  await page.getByTestId("review-run-comparison").click();
  await expect(page.getByTestId("review-mcard-b")).toBeVisible();
  await expect(page.getByTestId("review-mcard-delta")).toBeVisible();
  await expect(page.getByTestId("review-compare-legend")).toBeVisible();
  await expect(page.getByTestId("timeline-view-participant-title")).toHaveCount(1);
  assertNoExternalRequests(requestTracker);
});

test("a power user can re-run with parquet only after toggling other exports off", async ({
  page,
}) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByTestId("toggle-enableParquetExport").check();
  await processFiles(page);
  await expect(page.getByTestId("download-parquet-zip")).toBeVisible();

  // Toggle it back off; a fresh run should not advertise parquet.
  await page.getByRole("tab", { name: /Settings/i }).click();
  await page.getByTestId("toggle-enableParquetExport").uncheck();
  await processFiles(page);
  await expect(page.getByTestId("download-parquet-zip")).toHaveCount(0);
  const rows = parseCsv(await downloadCsv(page, "download-app-csv"));
  expect(rows.length).toBeGreaterThan(0);
  assertNoExternalRequests(requestTracker);
});

test("switches the colour theme and the choice persists across reload (#21)", async ({ page }) => {
  const html = page.locator("html");
  // Pick dark explicitly; the document theme token flips immediately.
  await page.getByTestId("theme-dark").click();
  await expect(html).toHaveAttribute("data-theme", "dark");

  // Persisted to localStorage and re-applied at boot (before first paint).
  await page.reload();
  await expect(page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" })).toBeVisible();
  await expect(html).toHaveAttribute("data-theme", "dark");
  // The toggle reflects the persisted choice as the pressed option.
  await expect(page.getByTestId("theme-dark")).toHaveAttribute("aria-pressed", "true");

  // And back to light, also immediate.
  await page.getByTestId("theme-light").click();
  await expect(html).toHaveAttribute("data-theme", "light");
  assertNoExternalRequests(requestTracker);
});

test("can reorder and remove queued raw files before processing (#24)", async ({ page }) => {
  // One picker action with both files (the queue is replaced per pick, not appended).
  await setRawFiles(page, [
    { name: "Raw P01.csv", content: APP_ONLY_RAW_CSV },
    { name: "Raw P02.csv", content: MULTI_FILE_RAW_CSV_B },
  ]);
  await page.getByRole("tab", { name: /Files/i }).click();
  const rows = page.getByTestId("raw-file-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Raw P01.csv");
  await expect(rows.nth(1)).toContainText("Raw P02.csv");

  // Reorder: send the first file down — the order flips and the control follows.
  await rows.nth(0).getByTestId("move-file-down").click();
  await expect(rows.nth(0)).toContainText("Raw P02.csv");
  await expect(rows.nth(1)).toContainText("Raw P01.csv");

  // Remove the now-first file — the queue shrinks cleanly, no orphan row.
  await rows.nth(0).getByTestId("remove-file").click();
  await expect(page.getByTestId("raw-file-row")).toHaveCount(1);
  await expect(page.getByTestId("raw-file-row")).toContainText("Raw P01.csv");
  assertNoExternalRequests(requestTracker);
});
