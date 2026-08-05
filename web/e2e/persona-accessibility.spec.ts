import { expect, test } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

import { APP_AND_SCREEN_RAW_CSV, APP_ONLY_RAW_CSV } from "./fixtures";
import {
  assertNoExternalRequests,
  gotoApp,
  installDeterministicRuntime,
  processFiles,
  setInputFile,
  setTheme,
  trackExternalRequests,
} from "./helpers";

/**
 * Persona 4 — Accessibility simulator.
 *
 * Keyboard-only and screen-reader users. Goes beyond the existing axe smoke by
 * scanning the View/review surface (the newest UI) and the open compare drawer,
 * completing a run by keyboard activation, and asserting screen-reader
 * semantics by DOM inspection. WCAG 2.1 AA: zero critical/serious violations.
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

function seriousViolations(
  results: { violations: { id: string; impact?: string | null }[] },
): { id: string; impact?: string | null }[] {
  return results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
}

test("the review (View) surface and the compare drawer have no serious axe violations", async ({
  page,
}) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");
  await processFiles(page);

  await page.getByRole("tab", { name: /View/i }).click();
  await expect(page.getByTestId("timeline-view")).toBeVisible();
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    const viewScan = await new AxeBuilder({ page }).analyze();
    expect(seriousViolations(viewScan), `${theme}: review surface`).toEqual([]);
  }
  await setTheme(page, "light");

  // Open the A/B compare drawer and re-scan — the drawer is an inline disclosure
  // (not a modal), so it must remain in the normal reading + tab order.
  await page.getByTestId("review-compare-toggle").click();
  const drawer = page.getByTestId("review-compare-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: /Close/i })).toBeVisible();
  const drawerScan = await new AxeBuilder({ page }).analyze();
  expect(seriousViolations(drawerScan)).toEqual([]);

  // The drawer closes from the keyboard-reachable Close control.
  await drawer.getByRole("button", { name: /Close/i }).click();
  await expect(drawer).toBeHidden();

  // Running the comparison adds the B and Δ metric cards, whose arm-coloured
  // headings are the only place those identity colours are used as text.
  await page.getByTestId("review-compare-toggle").click();
  await expect(drawer).toBeVisible();
  await drawer.getByTestId("minimum-usage-duration-input").fill("999999");
  await page.getByTestId("review-run-comparison").click();
  await expect(page.getByTestId("review-mcard-delta")).toBeVisible();
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    const comparedScan = await new AxeBuilder({ page }).analyze();
    expect(seriousViolations(comparedScan), `${theme}: compared review surface`).toEqual([]);
  }
  await setTheme(page, "light");
  assertNoExternalRequests(requestTracker);
});

test("the Pipeline Explorer has no serious axe violations across interpretation layers and run evidence", async ({
  page,
}) => {
  // Both themes: node labels and evidence badges are the smallest text in the
  // explorer, while Audit also adds search and phase-collapse controls.
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);

    await page.getByRole("tab", { name: /Graph/i }).click();
    await expect(page.getByTestId("graph-canvas")).toBeVisible();
    for (const mode of ["overview", "decisions", "audit"] as const) {
      await page.getByTestId(`graph-mode-${mode}`).click();
      await expect(page.getByTestId(`graph-mode-${mode}`)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      const scan = await new AxeBuilder({ page }).analyze();
      expect(seriousViolations(scan), `${theme}: graph ${mode} mode`).toEqual([]);
    }
  }

  // Post-run: physical queries carry execution-ledger metrics and the emitted
  // output list becomes the run's truthful deliverables section.
  await setTheme(page, "light");
  await page.getByRole("tab", { name: /^Files$/i }).click();
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");
  await processFiles(page);
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    await page.getByRole("tab", { name: /Graph/i }).click();
    await expect(page.getByTestId("graph-canvas")).toBeVisible();
    await page.getByTestId("graph-mode-execution").click();
    await expect(page.getByTestId("graph-node-metrics").first()).toBeVisible();
    await expect(page.getByTestId("graph-deliverables").getByRole("listitem").first())
      .toBeVisible();
    const postRunScan = await new AxeBuilder({ page }).analyze();
    expect(seriousViolations(postRunScan), `${theme}: graph after a run`).toEqual([]);
  }
  await setTheme(page, "light");
  assertNoExternalRequests(requestTracker);
});

test("a keyboard user can select the Process tab by arrow keys and run by Enter", async ({
  page,
}) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");

  const settingsTab = page.getByRole("tab", { name: /^Settings$/i });
  const filesTab = page.getByRole("tab", { name: /^Files$/i });
  const processTab = page.getByRole("tab", { name: /^Process$/i });
  // Wait for focus to land between presses so the roving-tabindex state settles.
  await settingsTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(filesTab).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(processTab).toBeFocused();
  await expect(processTab).toHaveAttribute("aria-selected", "true");

  // The process button is in the tab order and activates from the keyboard.
  const button = page.getByTestId("process-files-button");
  await expect(button).toBeEnabled();
  expect(await button.evaluate((el) => el.tabIndex)).toBeGreaterThanOrEqual(0);
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("result-panel").first()).toBeVisible({ timeout: 15_000 });
  assertNoExternalRequests(requestTracker);
});

test("every visible button has an accessible name and every field has a label", async ({
  page,
}) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
  await page.getByRole("tab", { name: /View/i }).click();
  await expect(page.getByTestId("timeline-view")).toBeVisible();

  const problems = await page.evaluate(() => {
    const accessibleName = (el: Element): string => {
      const aria = el.getAttribute("aria-label");
      if (aria && aria.trim()) return aria.trim();
      const labelledby = el.getAttribute("aria-labelledby");
      if (labelledby) {
        const text = labelledby
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim();
        if (text) return text;
      }
      const title = el.getAttribute("title");
      if (title && title.trim()) return title.trim();
      return (el.textContent ?? "").trim();
    };

    const visible = (el: HTMLElement): boolean => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        el.getAttribute("aria-hidden") !== "true"
      );
    };

    const found: string[] = [];
    document.querySelectorAll<HTMLElement>("button").forEach((button) => {
      if (visible(button) && !accessibleName(button)) {
        found.push(`button@${button.getAttribute("data-testid") ?? button.className}`);
      }
    });

    document
      .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input:not([type=hidden]), select, textarea",
      )
      .forEach((field) => {
        if (!visible(field)) return;
        const id = field.id;
        const hasLabelFor = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);
        const wrapped = field.closest("label");
        const named =
          field.getAttribute("aria-label") ||
          field.getAttribute("aria-labelledby") ||
          field.getAttribute("title");
        if (!hasLabelFor && !wrapped && !named) {
          found.push(`field@${field.getAttribute("data-testid") ?? field.getAttribute("name") ?? field.className}`);
        }
      });
    return found;
  });
  expect(problems).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

test("the timeline waterfall is fully keyboard-operable: move + zoom by arrows (#22)", async ({
  page,
}) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");
  // The waterfall canvas only exists when the opt-in per-session timeline
  // geometry was generated; without it the View tab has metrics but no scene.
  await page.getByTestId("toggle-enableInteractiveTimeline").check();
  await processFiles(page);
  await page.getByRole("tab", { name: /View/i }).click();
  await expect(page.getByTestId("timeline-view")).toBeVisible();

  // The canvas is a focusable group; arrow keys drive a live-region announcement.
  const canvas = page.locator(".timeline-view__canvas").first();
  await canvas.focus();
  await expect(canvas).toBeFocused();
  const announce = page.getByTestId("timeline-focus-announce").first();

  await page.keyboard.press("ArrowDown");
  await expect(announce).toContainText(/Row 1 of/i);
  // Right arrow zooms the focused day; the announcement reflects the zoom factor.
  await page.keyboard.press("ArrowRight");
  await expect(announce).toContainText(/zoomed/i);
  // Escape resets that day's zoom.
  await page.keyboard.press("Escape");
  await expect(announce).not.toContainText(/zoomed/i);
  assertNoExternalRequests(requestTracker);
});

test("the layout reflows at 200% zoom (half viewport) without horizontal scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 720 });
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
  for (const name of ["Settings", "Files", "Process", "View"]) {
    await page.getByRole("tab", { name: new RegExp(`^${name}$`, "i") }).click();
    const overflow = await page.evaluate(() => ({
      docWidth: document.documentElement.scrollWidth,
      viewWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.docWidth, `no horizontal scroll on ${name}`).toBeLessThanOrEqual(
      overflow.viewWidth + 1,
    );
  }
  assertNoExternalRequests(requestTracker);
});
