import { expect, test } from "@playwright/test";

import { APP_ONLY_RAW_CSV, MALFORMED_RAW_CSV } from "./fixtures";
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
 * Persona 2 — Novice user.
 *
 * First-timer who doesn't read docs, does things in the wrong order, feeds the
 * app bad input, and must be able to recover. Every mistake should produce a
 * helpful, visible message — never a crash, a blank screen, or silent
 * corruption.
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

test("cannot start processing before selecting any file (button is disabled, not broken)", async ({
  page,
}) => {
  await page.getByRole("tab", { name: /Process/i }).click();
  const processButton = page.getByTestId("process-files-button");
  await expect(processButton).toBeVisible();
  await expect(processButton).toBeDisabled();
  // Clicking the disabled control does nothing harmful.
  await processButton.click({ force: true }).catch(() => {});
  await expect(page.getByTestId("result-panel")).toHaveCount(0);
  assertNoExternalRequests(requestTracker);
});

test("opening the View tab before processing shows a friendly empty state, not an error", async ({
  page,
}) => {
  await page.getByRole("tab", { name: /View/i }).click();
  const empty = page.getByTestId("timeline-view-empty");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText(/Nothing to review yet/i);
  // It's an empty state, not a failure: no error styling/text present.
  await expect(page.locator(".error-text")).toHaveCount(0);
  assertNoExternalRequests(requestTracker);
});

test("a wrong file type is flagged for review rather than accepted silently", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Notes.txt", "just some notes, not a chronicle export", "text/plain");
  await page.getByRole("tab", { name: /Files/i }).click();
  const filesPanel = page.getByRole("tabpanel", { name: /Files/i });
  await expect(filesPanel.getByText(/Warning: Review/i)).toBeVisible();
  await expect(filesPanel.getByText(/File extension is not \.csv\./i)).toBeVisible();
  assertNoExternalRequests(requestTracker);
});

test("malformed data fails loudly with a readable message, then the user recovers", async ({
  page,
}) => {
  // Mistake: upload a CSV with an unparseable timestamp and hit process.
  await setInputFile(page, "raw-file-input", "Raw Broken.csv", MALFORMED_RAW_CSV, "text/csv");
  await page.getByRole("tab", { name: /Process/i }).click();
  await page.getByTestId("process-files-button").click();
  await expect(page.locator(".error-text")).toContainText(/Invalid event_timestamp/i);
  // The screen is not blank and not stuck — the rest of the UI is still usable.
  await expect(page.getByRole("tab", { name: /Settings/i })).toBeVisible();

  // Recovery: replace the bad file with a good one and succeed.
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
  const rows = parseCsv(await downloadCsv(page, "download-app-csv"));
  expect(rows.length).toBeGreaterThan(0);
  // The earlier error banner is gone after a clean run.
  await expect(page.locator(".error-text")).toHaveCount(0);
  assertNoExternalRequests(requestTracker);
});

test("re-uploading replaces files instead of duplicating them", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByRole("tab", { name: /Files/i }).click();
  await expect(page.getByTestId("raw-file-row")).toHaveCount(1);
  // The novice picks the file again, expecting it to "just update".
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await expect(page.getByTestId("raw-file-row")).toHaveCount(1);
  assertNoExternalRequests(requestTracker);
});

test("a novice can turn off an output they didn't want and it disappears next run", async ({
  page,
}) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  // Screen usage is on by default, so the first run emits a Screen output.
  await processFiles(page);
  await expect(page.getByTestId("result-row").first()).toContainText(/Screen/);

  // The novice unchecks the screen output they didn't want and re-runs. Re-pick
  // the file so the previous result panel is cleared and we wait on a fresh run
  // (the batch "Screen ZIP" button stays rendered-but-disabled, so we assert on
  // the per-file outputs, which is the honest signal that screen output is gone).
  await page.getByRole("tab", { name: /Settings/i }).click();
  await page.getByTestId("toggle-processScreenUsage").uncheck();
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
  const row = page.getByTestId("result-row").first();
  await expect(row).toContainText(/App CSV/);
  await expect(row).not.toContainText(/Screen/);
  assertNoExternalRequests(requestTracker);
});
