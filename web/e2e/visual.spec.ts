import { expect, test, type Page } from "@playwright/test";

import { APP_ONLY_RAW_CSV } from "./fixtures";
import {
  gotoApp,
  installDeterministicRuntime,
  processFiles,
  setInputFile,
} from "./helpers";

/**
 * Visual-regression suite (chromium-only baselines, run by
 * scripts/run-visual-regression.sh at pre-push).
 *
 * Determinism: installDeterministicRuntime pins the preprocessing datetime,
 * animations are disabled in every screenshot, and each shot waits for the
 * async state it depends on (file inspection, processing results) before
 * capturing. Baselines live in web/e2e/visual.spec.ts-snapshots/ and must be
 * committed; regenerate intentional UI changes with:
 *   cd web && npx playwright test --project=chromium --grep "@visual" --update-snapshots
 */
// The footer's version/build stamp changes on every wasm rebuild and every
// calendar day, so it is masked out of every baseline.
const screenshotOptions = (page: Page) =>
  ({
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    maxDiffPixels: 100,
    mask: [page.getByTestId("app-footer")],
  }) as const;

test.describe("Visual regression", { tag: "@visual" }, () => {
  // Baselines are captured on chromium only (mirroring the pre-push hook);
  // skip elsewhere so a full multi-browser `playwright test` run stays green.
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "visual baselines are chromium-only",
  );

  test.beforeEach(async ({ page }) => {
    await installDeterministicRuntime(page);
    await gotoApp(page);
  });

  test("app shell on load — Settings tab", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /Settings/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page).toHaveScreenshot(screenshotOptions(page));
  });

  test("Files tab — empty state", async ({ page }) => {
    await page.getByRole("tab", { name: /Files/i }).click();
    await expect(page.getByTestId("raw-file-input")).toBeAttached();
    await expect(page).toHaveScreenshot(screenshotOptions(page));
  });

  test("Files tab — file uploaded", async ({ page }) => {
    await page.getByRole("tab", { name: /Files/i }).click();
    await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
    // Wait for async file inspection to settle so the status pill and row
    // counts are stable before capturing.
    await expect(page.getByTestId("raw-file-row")).toHaveCount(1);
    await expect(page.getByTestId("raw-file-row")).toContainText("Success: Ready");
    await expect(page).toHaveScreenshot(screenshotOptions(page));
  });

  test("Process tab — with results", async ({ page }) => {
    await page.getByRole("tab", { name: /Files/i }).click();
    await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
    await processFiles(page);
    await expect(page).toHaveScreenshot(screenshotOptions(page));
  });
});
