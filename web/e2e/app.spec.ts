import { expect, test } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

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
  assertNoExternalRequests,
  csvHeaders,
  downloadCsv,
  downloadZipEntries,
  expandSectionCard,
  gotoApp,
  installDeterministicRuntime,
  parseCsv,
  processFiles,
  setInputFile,
  trackExternalRequests,
  waitForServiceWorkerControl,
} from "./helpers";

let requestTracker: ReturnType<typeof trackExternalRequests>;

test.beforeEach(async ({ page }) => {
  requestTracker = trackExternalRequests(page);
  await installDeterministicRuntime(page);
  await gotoApp(page);
  assertNoExternalRequests(requestTracker);
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
  assertNoExternalRequests(requestTracker);
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
  const previewMetrics = await page.locator(".preview-table-wrap").evaluate((element) => {
    const panel = element.closest(".result-panel");
    const elementRect = element.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
      overflowX: style.overflowX,
      tableNeedsScroll: element.scrollWidth > element.clientWidth,
      staysInsidePanel: panelRect ? elementRect.right <= panelRect.right + 1 : false,
    };
  });
  expect(previewMetrics).toEqual({
    overflowX: "auto",
    tableNeedsScroll: true,
    staysInsidePanel: true,
  });

  const zipEntries = await downloadZipEntries(page, "download-all-zip");
  expect(Array.from(zipEntries.keys())).toContain("chronicle-processing-report.json");
  const report = JSON.parse(zipEntries.get("chronicle-processing-report.json") ?? "{}");
  expect(report.preprocessorVersion).toBe("1.0.0");
  expect(report.files).toHaveLength(1);
  expect(report.files[0].outputs.map((output: { kind: string }) => output.kind)).toEqual([
    "app",
    "screen",
  ]);

  const appCsv = await downloadCsv(page, "download-app-csv");
  const screenCsv = await downloadCsv(page, "download-screen-csv");
  expect(csvHeaders(appCsv)).toContain("play_store_genreId");
  expect(appCsv).toContain("Filtered App Usage");
  expect(screenCsv).toContain("Screen Usage");
  assertNoExternalRequests(requestTracker);
});

test("searches individual settings and links to matching sections", async ({ page }) => {
  await expect(page.getByTestId("settings-search-input")).toBeVisible();
  await expect(page.getByText("Full Settings Search")).toBeVisible();
  await page.getByTestId("settings-search-input").fill("parallel");
  const results = page.locator(".settings-search-results");
  await expect(results).toContainText("2 settings found");
  await expect(results).toContainText("Parallel processing");
  await expect(results).toContainText("Max parallel workers");
  await expect(results.getByRole("link", { name: /Max parallel workers/i })).toHaveAttribute(
    "href",
    /#performance$/,
  );
  assertNoExternalRequests(requestTracker);
});

test("switches workflow tabs as SPA views while preserving state", async ({ page }) => {
  await expect(page.getByRole("tabpanel", { name: /Settings/i })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: /Files/i })).toBeHidden();
  await expect(page.getByRole("tabpanel", { name: /Process/i })).toBeHidden();

  await page.getByRole("tab", { name: /Files/i }).click();
  await expect(page.getByRole("tabpanel", { name: /Files/i })).toBeVisible();
  await expect(page.getByTestId("settings-search-input")).toBeHidden();
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await expect(page.getByText("1 raw file ready")).toBeVisible();

  await page.getByRole("tab", { name: /Process/i }).click();
  const processPanel = page.getByRole("tabpanel", { name: /Process/i });
  await expect(processPanel).toBeVisible();
  await expect(processPanel.getByText("Raw P01.csv")).toBeVisible();
  await expect(processPanel.getByText("Ready")).toBeVisible();

  await page.getByRole("tab", { name: /Settings/i }).click();
  await expect(page.getByTestId("settings-search-input")).toBeVisible();
  await page.getByRole("tab", { name: /Process/i }).click();
  await expect(processPanel.getByText("Raw P01.csv")).toBeVisible();
  await expect(processPanel.getByText("Ready")).toBeVisible();
  assertNoExternalRequests(requestTracker);
});

test("has no automated axe accessibility violations across workflow tabs", async ({ page }) => {
  for (const tabName of ["Settings", "Files", "Process"]) {
    await page.getByRole("tab", { name: new RegExp(tabName, "i") }).click();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  }
  assertNoExternalRequests(requestTracker);
});

test("supports keyboard-only skip and workflow tab navigation", async ({ page }) => {
  const settingsTab = page.getByRole("tab", { name: /Settings/i });
  const filesTab = page.getByRole("tab", { name: /Files/i });
  const processTab = page.getByRole("tab", { name: /Process/i });

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: /Skip to workflow tabs/i })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#workflow-panels")).toBeFocused();

  await settingsTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(filesTab).toBeFocused();
  await expect(filesTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(processTab).toBeFocused();
  await expect(processTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(settingsTab).toBeFocused();
  await expect(settingsTab).toHaveAttribute("aria-selected", "true");
  assertNoExternalRequests(requestTracker);
});

test("does not rely on color alone for file status", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByRole("tab", { name: /Files/i }).click();
  const filesPanel = page.getByRole("tabpanel", { name: /Files/i });
  await expect(filesPanel.getByText("Success: Ready")).toBeVisible();

  await setInputFile(page, "raw-file-input", "Raw Bad.txt", "not,a,raw,file", "text/plain");
  await expect(filesPanel.getByText("Warning: Review")).toBeVisible();
  assertNoExternalRequests(requestTracker);
});

test("supports reduced motion, forced colors, and practical pointer targets", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await page.locator(".btn").first().evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      transitionDuration: style.transitionDuration,
      animationName: style.animationName,
    };
  });
  expect(reducedMotion).toEqual({ transitionDuration: "0s", animationName: "none" });

  await page.emulateMedia({ forcedColors: "active" });
  await page.getByRole("tab", { name: /Process/i }).click();
  const forcedColors = await page.getByRole("tab", { name: /Process/i }).evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderColor,
    };
  });
  expect(forcedColors.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(forcedColors.color).not.toBe(forcedColors.backgroundColor);
  expect(forcedColors.borderColor).not.toBe("rgba(0, 0, 0, 0)");

  const targetFailures = await page.evaluate(() => {
    const selectors = [".btn", ".input", ".select", "[role='tab']", "input[type='file']"];
    return selectors.flatMap((selector) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            element.getAttribute("aria-hidden") !== "true" &&
            !element.classList.contains("visually-hidden-file-input")
          );
        })
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width < 44 || rect.height < 44;
        })
        .map((element) => {
          const label = element.textContent?.trim() || element.getAttribute("data-testid") || element.tagName;
          return `${selector}: ${label}`;
        }),
    );
  });
  expect(targetFailures).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

test("reflows at narrow widths without page-level horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  for (const tabName of ["Settings", "Files", "Process"]) {
    await page.getByRole("tab", { name: new RegExp(tabName, "i") }).click();
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth + 1);
    expect(overflow.bodyWidth).toBeLessThanOrEqual(overflow.viewportWidth + 1);
  }
  assertNoExternalRequests(requestTracker);
});

test("validates selected raw files before processing", async ({ page }) => {
  const badRawCsv = [
    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone,timezone",
    "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,not-a-date,Not/AZone,Not/AZone",
    "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,,America/Chicago,America/Chicago",
    "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:00:00,,",
    "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:00:00,America/Chicago,America/Chicago",
  ].join("\n");

  await setInputFile(page, "raw-file-input", "Raw P01.txt", badRawCsv, "text/plain");

  await page.getByRole("tab", { name: /Files/i }).click();
  const filesPanel = page.getByRole("tabpanel", { name: /Files/i });
  await expect(filesPanel.getByText("File extension is not .csv.")).toBeVisible();
  await expect(filesPanel.getByText("Duplicate column headers found.")).toBeVisible();
  await expect(filesPanel.getByText(/rows have invalid event_timestamp values/)).toBeVisible();
  await expect(filesPanel.getByText(/Invalid timezone values/)).toBeVisible();
  assertNoExternalRequests(requestTracker);
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
  assertNoExternalRequests(requestTracker);
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
  assertNoExternalRequests(requestTracker);
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
  assertNoExternalRequests(requestTracker);
});

test("drops codebook-enriched columns when app codebook use is disabled", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByTestId("toggle-useAppCodebook").uncheck();
  await processFiles(page);

  const appCsv = await downloadCsv(page, "download-app-csv");
  const headers = csvHeaders(appCsv);
  expect(headers).not.toContain("genreId_scraped");
  expect(headers).not.toContain("play_store_genreId");
  assertNoExternalRequests(requestTracker);
});

test("shows result warnings for suspicious successful outputs", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByTestId("usage-mode-select").selectOption("app_and_screen_usage");
  await processFiles(page);

  await expect(page.locator(".result-warnings")).toContainText("zero screen-usage rows");
  await expect(page.locator(".result-warnings")).toContainText("contains zero data rows");
  assertNoExternalRequests(requestTracker);
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
  assertNoExternalRequests(requestTracker);
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
  assertNoExternalRequests(requestTracker);
});

test("handles malformed raw CSV input with a visible local error", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw Broken.csv", MALFORMED_RAW_CSV, "text/csv");
  await page.getByRole("tab", { name: /Process/i }).click();
  await page.getByTestId("process-files-button").click();
  await expect(page.locator(".error-text")).toContainText("Invalid event_timestamp");
  assertNoExternalRequests(requestTracker);
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
  await expandSectionCard(page, "performance");
  await page.getByTestId("toggle-parallelProcessing").check();
  await page.getByTestId("parallel-max-workers-input").fill("2");
  await processFiles(page);
  await expect(page.getByTestId("result-panel")).toContainText("2 files processed");
  assertNoExternalRequests(requestTracker);
});

test("persists all edited settings across reload and supports settings import", async ({ page }) => {
  await page.getByTestId("study-name-input").fill("TECH pilot");
  await page.getByTestId("usage-mode-select").selectOption("app_and_screen_usage");
  await expandSectionCard(page, "timezone");
  await page.getByTestId("timezone-handling-select").selectOption("selected-convert");
  await page.getByTestId("selected-timezone-input").fill("America/Chicago");
  await expandSectionCard(page, "session-detection");
  await page.getByTestId("long-duration-threshold-input").fill("6");
  await page.getByTestId("custom-engagement-duration-input").fill("45");
  await page.getByTestId("long-usage-thresholds-input").fill("2, 4, 8");
  await page.getByTestId("toggle-allowStopEventReuse").check();
  await expandSectionCard(page, "performance");
  await page.getByTestId("toggle-parallelProcessing").check();
  await page.getByTestId("parallel-max-workers-input").fill("3");

  await page.reload();
  await installDeterministicRuntime(page);
  await expect(page.getByTestId("study-name-input")).toHaveValue("TECH pilot");
  await expect(page.getByTestId("usage-mode-select")).toHaveValue("app_and_screen_usage");
  await expandSectionCard(page, "timezone");
  await expect(page.getByTestId("timezone-handling-select")).toHaveValue("selected-convert");
  await expect(page.getByTestId("selected-timezone-input")).toHaveValue("America/Chicago");
  await expandSectionCard(page, "session-detection");
  await expect(page.getByTestId("long-duration-threshold-input")).toHaveValue("6");
  await expect(page.getByTestId("custom-engagement-duration-input")).toHaveValue("45");
  await expect(page.getByTestId("long-usage-thresholds-input")).toHaveValue("2, 4, 8");
  await expect(page.getByTestId("toggle-allowStopEventReuse")).toBeChecked();
  await expandSectionCard(page, "performance");
  await expect(page.getByTestId("toggle-parallelProcessing")).toBeChecked();
  await expect(page.getByTestId("parallel-max-workers-input")).toHaveValue("3");

  await page.getByTestId("import-settings-input").setInputFiles({
    name: "settings.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        options: {
          studyName: "Imported study",
          usageSessionMode: "screen_usage",
          useAppCodebook: false,
          longDataTimeGapThresholds: [1.5, 2.5],
        },
      }),
      "utf-8",
    ),
  });

  await expect(page.getByTestId("study-name-input")).toHaveValue("Imported study");
  await expect(page.getByTestId("usage-mode-select")).toHaveValue("screen_usage");
  await expect(page.getByTestId("toggle-useAppCodebook")).not.toBeChecked();
  await expandSectionCard(page, "session-detection");
  await expect(page.getByTestId("long-gap-thresholds-input")).toHaveValue("1.5, 2.5");
  assertNoExternalRequests(requestTracker);
});

test("@privacy exposes a restrictive same-origin CSP policy", async ({ page }) => {
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("worker-src 'self' blob:");
  expect(csp).not.toContain("https://");
  assertNoExternalRequests(requestTracker);
});

test("@offline warms the cache, reloads offline, and still processes locally", async ({
  page,
  context,
}) => {
  await waitForServiceWorkerControl(page);
  await expect(
    page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
  ).toBeVisible();
  await expect(page.getByText(/your data never leaves your device/i)).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
  ).toBeVisible();
  await expect(page.getByText(/your data never leaves your device/i)).toBeVisible();

  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
  const appCsv = await downloadCsv(page, "download-app-csv");
  const rows = parseCsv(appCsv);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.interaction_type).toBe("App Usage");
  assertNoExternalRequests(requestTracker);
});

test("@install keeps the simplified hero stable when beforeinstallprompt fires", async ({
  page,
}) => {
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted"; platform: string }>;
      preventDefault: () => void;
    };
    event.prompt = async () => {};
    event.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
    window.dispatchEvent(event);
  });

  await expect(
    page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
  ).toBeVisible();
  await expect(page.getByText(/your data never leaves your device/i)).toBeVisible();
  await expect(page.getByRole("tab", { name: /Settings/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Files/i })).toBeVisible();
  await page.getByRole("tab", { name: /Process/i }).click();
  await expect(page.getByTestId("process-files-button")).toBeVisible();
  assertNoExternalRequests(requestTracker);
});
