import { expect, test, type Page } from "@playwright/test";

import { APP_ONLY_RAW_CSV } from "./fixtures";
import {
  assertNoExternalRequests,
  downloadCsv,
  gotoApp,
  installDeterministicRuntime,
  parseCsv,
  processFiles,
  setInputFile,
  trackExternalRequests,
} from "./helpers";

/**
 * Persona 5 — Data integrity auditor.
 *
 * A regulator/scientist proving correct, reproducible results: same input →
 * same output, the download matches the screen, data survives reload, and the
 * export is byte-identical online and offline (this is a local-only pipeline,
 * so "offline" must change nothing).
 */
test.describe.configure({ mode: "serial" });

let requestTracker: ReturnType<typeof trackExternalRequests>;
let pageErrors: string[];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  requestTracker = trackExternalRequests(page);
  await installDeterministicRuntime(page);
  await gotoApp(page);
  assertNoExternalRequests(requestTracker);
});

test.afterEach(() => {
  expect(pageErrors, "no uncaught errors").toEqual([]);
});

/** The App-count cell of the first result row, as the UI renders it. */
async function displayedAppCount(page: Page): Promise<number> {
  // Columns: File, Status, Original, Processed, App → App is the 3rd numeric cell.
  const cell = page.getByTestId("result-row").first().locator(".result-table__num").nth(2);
  const text = (await cell.innerText()).replace(/[^\d]/g, "");
  return Number(text);
}

test("identical inputs produce byte-identical CSV output (deterministic)", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
  const first = await downloadCsv(page, "download-app-csv");

  // Fresh upload of the same bytes, fresh run.
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
  const second = await downloadCsv(page, "download-app-csv");

  expect(second).toBe(first);
  assertNoExternalRequests(requestTracker);
});

test("the downloaded CSV row count matches the count shown on screen", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);

  const shown = await displayedAppCount(page);
  const rows = parseCsv(await downloadCsv(page, "download-app-csv"));
  expect(shown).toBeGreaterThan(0);
  expect(rows.length).toBe(shown);
  assertNoExternalRequests(requestTracker);
});

test("processed counts survive a reload (lightweight restore keeps the numbers)", async ({
  page,
}) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
  const before = await displayedAppCount(page);

  await page.reload();
  await installDeterministicRuntime(page);
  await gotoApp(page);
  await expect(page.getByTestId("result-panel")).toContainText("1 file processed");
  await expect(page.getByTestId("restored-lightweight-note")).toBeVisible();
  const after = await displayedAppCount(page);
  expect(after).toBe(before);
  assertNoExternalRequests(requestTracker);
});

test("the export is byte-identical online and offline", async ({ page, context }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
  const online = await downloadCsv(page, "download-app-csv");

  // Drop the network and re-run the very same in-memory file.
  await context.setOffline(true);
  await page.getByRole("tab", { name: /Process/i }).click();
  await page.getByTestId("process-files-button").click();
  await expect(page.getByTestId("result-panel").first()).toBeVisible({ timeout: 15_000 });
  const offline = await downloadCsv(page, "download-app-csv");

  expect(offline).toBe(online);
  await context.setOffline(false);
  assertNoExternalRequests(requestTracker);
});
