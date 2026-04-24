import { expect, test } from "@playwright/test";

import {
  APP_AND_SCREEN_RAW_CSV,
  APP_ONLY_RAW_CSV,
  CODEBOOK_CSV,
  createFilterWorkbookBytes,
  FILTER_FILE_CSV,
  KEEP_AWAKE_CSV,
  MALFORMED_RAW_CSV,
  MIXED_TIMEZONE_RAW_CSV,
  MULTI_FILE_RAW_CSV_A,
  MULTI_FILE_RAW_CSV_B,
} from "./fixtures";
import {
  csvHeaders,
  downloadCsv,
  gotoApp,
  installDeterministicRuntime,
  parseCsv,
  processFiles,
  setInputFile,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await installDeterministicRuntime(page);
  await gotoApp(page);
});

test("@smoke boots locally and processes the bundled sample entirely on localhost", async ({
  page,
}) => {
  await page.getByTestId("run-sample-button").click();
  await expect(page.getByTestId("result-card")).toHaveCount(1);
  const appCsv = await downloadCsv(page, "download-app-csv");
  const rows = parseCsv(appCsv);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0]?.datetime_of_preprocessing).toBe("2026-04-24 00:32:53");
});

test("processes app and screen outputs with CSV support files and downloads both results", async ({
  page,
}) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");
  await page.getByTestId("usage-mode-select").selectOption("app_and_screen_usage");
  await page.getByTestId("toggle-useKeepAwakeAppsFile").check();
  await setInputFile(page, "filter-file-input", "filter.csv", FILTER_FILE_CSV, "text/csv");
  await setInputFile(page, "keep-awake-file-input", "keep_awake.csv", KEEP_AWAKE_CSV, "text/csv");
  await setInputFile(page, "app-codebook-file-input", "codebook.csv", CODEBOOK_CSV, "text/csv");
  await processFiles(page);

  const appCsv = await downloadCsv(page, "download-app-csv");
  const screenCsv = await downloadCsv(page, "download-screen-csv");
  expect(csvHeaders(appCsv)).toContain("play_store_genreId");
  expect(appCsv).toContain("Filtered App Usage");
  expect(screenCsv).toContain("Screen Usage");
});

test("accepts an XLSX filter file and still produces filtered app usage locally", async ({
  page,
}) => {
  const xlsxBytes = await createFilterWorkbookBytes();
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");
  await setInputFile(
    page,
    "filter-file-input",
    "filter.xlsx",
    xlsxBytes,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  await processFiles(page);

  const appCsv = await downloadCsv(page, "download-app-csv");
  expect(appCsv).toContain("Filtered App Usage");
});

test("discovers timezones and honors selected-filter output behavior", async ({ page }) => {
  await setInputFile(
    page,
    "raw-file-input",
    "Raw Mixed.csv",
    MIXED_TIMEZONE_RAW_CSV,
    "text/csv",
  );
  await page.getByTestId("discover-timezones-button").click();
  await page.getByTestId("selected-timezone-input").fill("America/Chicago");
  await page.getByTestId("timezone-handling-select").selectOption("selected-filter");
  await processFiles(page);

  const appCsv = await downloadCsv(page, "download-app-csv");
  const rows = parseCsv(appCsv);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.timezone).toBe("America/Chicago");
  expect(appCsv).not.toContain("America/New_York");
});

test("converts mixed-timezone data into the selected timezone", async ({ page }) => {
  await setInputFile(
    page,
    "raw-file-input",
    "Raw Mixed.csv",
    MIXED_TIMEZONE_RAW_CSV,
    "text/csv",
  );
  await page.getByTestId("selected-timezone-input").fill("America/Chicago");
  await page.getByTestId("timezone-handling-select").selectOption("selected-convert");
  await processFiles(page);

  const appCsv = await downloadCsv(page, "download-app-csv");
  const rows = parseCsv(appCsv);
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((row) => row.timezone))).toEqual(new Set(["America/Chicago"]));
});

test("drops codebook-enriched columns when app codebook use is disabled", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByTestId("toggle-useAppCodebook").uncheck();
  await processFiles(page);

  const appCsv = await downloadCsv(page, "download-app-csv");
  const headers = csvHeaders(appCsv);
  expect(headers).not.toContain("genreId_scraped");
  expect(headers).not.toContain("play_store_genreId");
});

test("classifies keep-awake screen sessions through the local screen pipeline", async ({
  page,
}) => {
  const keepAwakeRawCsv = [
    "study_id,participant_id,possible_device_model,username,application_label,interaction_type,app_package_name,event_timestamp,start_timestamp,stop_timestamp,timezone",
    "study,P01,Android,Target Child,System,Unknown importance: 15,android,2026-03-07 10:00:00,,,America/Chicago",
    "study,P01,Android,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:05,,,America/Chicago",
    "study,P01,Android,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:00:10,,,America/Chicago",
    "study,P01,Android,Target Child,System,Unknown importance: 16,android,2026-03-07 10:02:30,,,America/Chicago",
  ].join("\n");

  await setInputFile(page, "raw-file-input", "Raw P01.csv", keepAwakeRawCsv, "text/csv");
  await page.getByTestId("usage-mode-select").selectOption("app_and_screen_usage");
  await page.getByTestId("toggle-useKeepAwakeAppsFile").check();
  await setInputFile(page, "keep-awake-file-input", "keep_awake.csv", KEEP_AWAKE_CSV, "text/csv");
  await processFiles(page);

  const screenCsv = await downloadCsv(page, "download-screen-csv");
  expect(screenCsv).toContain("app_kept_awake_or_extended");
  expect(screenCsv).toContain("Chat");
});

test("changes output semantics when Activity Stopped fallback is disabled", async ({ page }) => {
  const fallbackRawCsv = [
    "study_id,participant_id,possible_device_model,username,application_label,interaction_type,app_package_name,event_timestamp,start_timestamp,stop_timestamp,timezone",
    "study,P01,Android,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,,,America/Chicago",
    "study,P01,Android,Target Child,Chat,Unknown importance: 23,com.example.chat,2026-03-07 10:05:00,,,America/Chicago",
    "study,P01,Android,Target Child,System,Unknown importance: 10,android,2026-03-07 10:10:00,,,America/Chicago",
  ].join("\n");

  await setInputFile(page, "raw-file-input", "Raw P01.csv", fallbackRawCsv, "text/csv");
  await processFiles(page);
  const fallbackOnCsv = await downloadCsv(page, "download-app-csv");
  const fallbackOnRows = parseCsv(fallbackOnCsv);
  expect(fallbackOnRows[0]?.interaction_type).toBe("App Usage");
  expect(fallbackOnRows[0]?.duration_seconds).toBe("300.0");

  await page.reload();
  await installDeterministicRuntime(page);
  await gotoApp(page);
  await setInputFile(page, "raw-file-input", "Raw P01.csv", fallbackRawCsv, "text/csv");
  await page.getByTestId("toggle-useActivityStoppedAsFallback").uncheck();
  await processFiles(page);
  const fallbackOffCsv = await downloadCsv(page, "download-app-csv");
  const fallbackOffRows = parseCsv(fallbackOffCsv);
  expect(fallbackOffRows[0]?.interaction_type).toBe("App Usage");
  expect(fallbackOffRows[0]?.duration_seconds).toBe("600.0");
});

test("handles malformed raw CSV input with a visible local error", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw Broken.csv", MALFORMED_RAW_CSV, "text/csv");
  await page.getByTestId("process-files-button").click();
  await expect(page.locator(".error-text")).toContainText("Invalid event_timestamp");
});

test("processes multiple uploaded files with parallel workers enabled", async ({ page }) => {
  await page.getByTestId("raw-file-input").setInputFiles([
    {
      name: "Raw P01.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(MULTI_FILE_RAW_CSV_A, "utf-8"),
    },
    {
      name: "Raw P02.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(MULTI_FILE_RAW_CSV_B, "utf-8"),
    },
  ]);
  await page.getByTestId("toggle-parallelProcessing").check();
  await page.getByTestId("parallel-max-workers-input").fill("2");
  await processFiles(page);
  await expect(page.getByTestId("result-card")).toHaveCount(2);
});
