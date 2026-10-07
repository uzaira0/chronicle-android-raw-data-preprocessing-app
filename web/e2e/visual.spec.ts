import { expect, test, type Page } from "@playwright/test";

import { APP_AND_SCREEN_RAW_CSV, APP_ONLY_RAW_CSV } from "./fixtures";
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
const screenshotOptions = (page: Page) => ({
  animations: "disabled" as const,
  caret: "hide" as const,
  fullPage: false,
  maxDiffPixels: 100,
  mask: [page.getByTestId("app-footer")],
});

test.describe("Visual regression", { tag: "@visual" }, () => {
  // Baselines are captured on chromium only (mirroring the pre-push hook);
  // skip elsewhere so a full multi-browser `playwright test` run stays green.
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "visual baselines are chromium-only",
  );

  // macOS draws overlay or classic scrollbars depending on whether a mouse is
  // connected ("Show scroll bars: automatically"), and a classic scrollbar
  // narrows the page by about 15 px, shifting every element. Hiding scrollbars
  // keeps the baselines independent of the attached pointing device. The
  // app's CSP forbids injected styles, so these screenshot tests bypass it.
  test.use({ bypassCSP: true });

  test.beforeEach(async ({ page }) => {
    await installDeterministicRuntime(page);
    await gotoApp(page);
    await page.addStyleTag({
      content: "* { scrollbar-width: none !important; }",
    });
  });

  test("app shell on load — Settings tab", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /Settings/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // A pristine visit (fresh browser context, empty localStorage) must not
    // announce "Last used settings restored." — that toast auto-dismisses on a
    // real 5s timer, so baselines embedding it fail on slow runs. Pinned here
    // beyond the pixel diff so a regression names the cause.
    await expect(page.locator(".toast")).toHaveCount(0);
    await expect(page).toHaveScreenshot(screenshotOptions(page));
  });

  test("Files tab — empty state", async ({ page }) => {
    await page.getByRole("tab", { name: /Files/i }).click();
    await expect(page.getByTestId("raw-file-input")).toBeAttached();
    await expect(page).toHaveScreenshot(screenshotOptions(page));
  });

  test("Files tab — file uploaded", async ({ page }) => {
    await page.getByRole("tab", { name: /Files/i }).click();
    // Screen events included, so the default screen-usage output has input
    // and the pill reads Ready rather than the no-screen-events Review.
    await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");
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
    // The completion toast embeds wall-clock timing ("Processed 1/1 files in
    // 0s") that flips to "1s" under load. Dismiss it deterministically and
    // wait for it to detach so the baseline never contains timing text.
    const toast = page.locator(".toast");
    await toast.getByRole("button", { name: "Dismiss" }).click();
    await expect(toast).toHaveCount(0);
    // The toast sits bottom-centre, so the pointer that dismissed it rests on
    // a download link; move it off so the baseline has no hover underline.
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot(screenshotOptions(page));
  });
});
