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

// Viewport visual tests — run on mobile-chrome, mobile-safari, and tablet projects
// (those projects have grep: /@visual|@viewport/ so these tests only execute there).
// To generate snapshot baselines for the first time, run:
//   npx playwright test --grep "@visual|@viewport" --update-snapshots
test.describe("Viewport visual regression", { tag: ["@visual", "@viewport"] }, () => {
  test("initial load at mobile (390×844)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installDeterministicRuntime(page);
    await gotoApp(page);
    await expect(page).toHaveScreenshot({ fullPage: false, maxDiffPixels: 80 });
  });

  test("initial load at tablet (768×1024)", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await installDeterministicRuntime(page);
    await gotoApp(page);
    await expect(page).toHaveScreenshot({ fullPage: false, maxDiffPixels: 80 });
  });

  test("initial load at desktop (1440×900)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installDeterministicRuntime(page);
    await gotoApp(page);
    await expect(page).toHaveScreenshot({ fullPage: false, maxDiffPixels: 80 });
  });

  test("Files tab at mobile viewport shows no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page);
    await page.getByRole("tab", { name: /Files/i }).click();
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth + 1);
    expect(overflow.bodyWidth).toBeLessThanOrEqual(overflow.viewportWidth + 1);
  });

  test("Process tab at mobile viewport renders correctly", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installDeterministicRuntime(page);
    await gotoApp(page);
    await page.getByRole("tab", { name: /Process/i }).click();
    await expect(page.getByTestId("process-files-button")).toBeVisible();
    await expect(page).toHaveScreenshot({ fullPage: false, maxDiffPixels: 80 });
  });
});
