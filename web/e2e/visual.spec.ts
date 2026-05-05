import { expect, test } from "@playwright/test";

import { APP_ONLY_RAW_CSV } from "./fixtures";
import {
  gotoApp,
  installDeterministicRuntime,
  processFiles,
  setInputFile,
} from "./helpers";

test.describe("Visual regression", { tag: "@visual" }, () => {
  test("initial load — Settings tab", async ({ page }) => {
    await installDeterministicRuntime(page);
    await gotoApp(page);
    await expect(page).toHaveScreenshot({ fullPage: false, maxDiffPixels: 50 });
  });

  test("Files tab — empty state", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("tab", { name: /Files/i }).click();
    await expect(page).toHaveScreenshot({ maxDiffPixels: 50 });
  });

  test("Files tab — file uploaded", async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("tab", { name: /Files/i }).click();
    await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
    await expect(page).toHaveScreenshot({ maxDiffPixels: 50 });
  });

  test("Process tab — with results", async ({ page }) => {
    await installDeterministicRuntime(page);
    await gotoApp(page);
    await page.getByRole("tab", { name: /Files/i }).click();
    await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
    await processFiles(page);
    await expect(page).toHaveScreenshot({ maxDiffPixels: 50 });
  });
});
