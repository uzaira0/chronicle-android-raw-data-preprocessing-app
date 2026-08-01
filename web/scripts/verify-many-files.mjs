/**
 * Empirical hang-fix verification: uploads N small Chronicle CSVs, enables
 * parallel processing, clicks Process, measures wall time. This reproduces
 * the user-reported hang on the pre-fix code (never completed with 90 files)
 * and asserts the fixed worker-pool-based implementation finishes finite.
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] ?? "http://127.0.0.1:4173/";
const fileCount = Number(process.argv[3] ?? "50");
const workerCount = Number(process.argv[4] ?? "4");
const timeoutMs = Number(process.argv[5] ?? "180000");
const fixturePath = process.argv[6] ? path.resolve(process.argv[6]) : null;
const runComparison = process.argv[7] === "compare";
const comparisonWarmupMs = Number(process.argv[8] ?? "0");
const disableStaticPlots = process.argv[9] === "no-plots";
const traceOutputPath = process.argv[10]
  ? path.resolve(process.argv[10])
  : null;
const repeatComparison = process.argv[11] === "repeat";
// "toggle" proves review-summary ETag reuse: edit Arm B to a second config,
// then back to the first. The third pass recomputes a summary digest the
// client still holds in its LRU, so the runtime ships zero artifact bytes and
// the page must show data-comparison-summary-reused="true".
const toggleComparison = process.argv[11] === "toggle";
const performanceTraceId = `many-files-${process.pid}-${Date.now()}`;

/** @param {number} rootPid */
function processTreeRssBytes(rootPid) {
  let snapshot;
  try {
    snapshot = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,rss="], {
      encoding: "utf8",
    });
  } catch {
    return 0;
  }
  const rows = snapshot
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((parts) => parts.length === 3 && parts.every(Number.isFinite));
  const children = new Map();
  for (const [pid, ppid] of rows) {
    const current = children.get(ppid) ?? [];
    current.push(pid);
    children.set(ppid, current);
  }
  const descendants = [rootPid];
  for (let index = 0; index < descendants.length; index += 1) {
    descendants.push(...(children.get(descendants[index]) ?? []));
  }
  const selected = new Set(descendants);
  return rows.reduce(
    (total, [pid, , rssKib]) =>
      total +
      (pid !== undefined && rssKib !== undefined && selected.has(pid) ? rssKib * 1024 : 0),
    0,
  );
}

/** @param {string} participantId */
function buildSmallCsv(participantId) {
  // One filtered and one valid app, same timezone, minimal rows — enough to
  // exercise the full pipeline including the WASM matcher.
  const rows = [
    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
  ];
  const base = Date.parse("2026-03-07T10:00:00-06:00");
  for (let index = 0; index < 6; index += 1) {
    const ts = new Date(base + index * 1000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);
    const type =
      index % 2 === 0 ? "Unknown importance: 1" : "Unknown importance: 2";
    rows.push(
      `Study,${participantId},Target Child,Chat,${type},com.example.chat,${ts},America/Chicago`,
    );
  }
  return rows.join("\n");
}

/** @type {string | null} */
let stagedFixtureDirectory = null;
let bytesPerFile;
let totalInputBytes;
/** Distinct SHA-256 count over the staged inputs; 1 in duplicate-content mode. */
let distinctContentCount = null;
let uploadFiles;
if (fixturePath) {
  const fixture = await stat(fixturePath);
  /** @type {string[]} */
  let sourceFiles;
  if (fixture.isDirectory()) {
    // Distinct-input mode: stage the first fileCount sorted CSVs from the
    // directory under the same Raw P###.csv names the duplicate mode uses.
    const names = (await readdir(fixturePath))
      .filter((name) => name.endsWith(".csv"))
      .sort()
      .slice(0, fileCount);
    if (names.length < fileCount) {
      throw new Error(
        `${fixturePath} contains ${names.length} CSV files; ${fileCount} requested`,
      );
    }
    sourceFiles = names.map((name) => path.join(fixturePath, name));
  } else {
    sourceFiles = Array.from({ length: fileCount }, () => fixturePath);
  }
  const stagingDirectory = await mkdtemp(
    path.join(tmpdir(), "chronicle-many-files-"),
  );
  stagedFixtureDirectory = stagingDirectory;
  uploadFiles = await Promise.all(
    sourceFiles.map(async (sourcePath, index) => {
      const stagedPath = path.join(
        stagingDirectory,
        `Raw P${String(index + 1).padStart(3, "0")}.csv`,
      );
      try {
        await link(sourcePath, stagedPath);
      } catch {
        await copyFile(sourcePath, stagedPath);
      }
      return stagedPath;
    }),
  );
  const digestByPath = new Map();
  for (const sourcePath of new Set(sourceFiles)) {
    digestByPath.set(
      sourcePath,
      createHash("sha256").update(await readFile(sourcePath)).digest("hex"),
    );
  }
  distinctContentCount = new Set(
    sourceFiles.map((sourcePath) => digestByPath.get(sourcePath)),
  ).size;
  const sizes = await Promise.all(
    sourceFiles.map(async (sourcePath) => (await stat(sourcePath)).size),
  );
  totalInputBytes = sizes.reduce((total, size) => total + size, 0);
  bytesPerFile = totalInputBytes / fileCount;
} else {
  uploadFiles = Array.from({ length: fileCount }, (_, index) => ({
    name: `Raw P${String(index + 1).padStart(3, "0")}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(
      buildSmallCsv(`P${String(index + 1).padStart(3, "0")}`),
      "utf-8",
    ),
  }));
  bytesPerFile = uploadFiles[0]?.buffer.byteLength ?? 0;
  totalInputBytes = bytesPerFile * fileCount;
}

let browser;
/** @type {import("@playwright/test").Page | undefined} */
let tracePage;
let phase = "setup";
let failureReason = null;
const traceStarted = performance.now();
let summedProcessTreeRssBytes = processTreeRssBytes(process.pid);
let peakSummedProcessTreeRssBytes = summedProcessTreeRssBytes;
let traceWrites = Promise.resolve();
/** @type {Set<import("@playwright/test").Worker>} */
const liveWorkers = new Set();
/** @type {Map<number, {id: number, url: string, createdPhase: string, createdElapsedMs: number, closedPhase?: string, closedElapsedMs?: number}>} */
const workerRecords = new Map();
let workerSerial = 0;
let maxLiveWorkers = 0;
/** @type {Record<string, number>} */
const maxLiveWorkersByPhase = {};
let maxRunningFiles = 0;
/** @type {Record<string, number>} */
const maxRunningFilesByPhase = {};
/** @type {Array<Record<string, unknown>>} */
const runtimePerformanceEvents = [];

if (traceOutputPath) {
  await mkdir(path.dirname(traceOutputPath), { recursive: true });
  await writeFile(traceOutputPath, "");
}

function updatePeaks(runningFiles = 0) {
  maxLiveWorkers = Math.max(maxLiveWorkers, liveWorkers.size);
  maxLiveWorkersByPhase[phase] = Math.max(
    maxLiveWorkersByPhase[phase] ?? 0,
    liveWorkers.size,
  );
  maxRunningFiles = Math.max(maxRunningFiles, runningFiles);
  maxRunningFilesByPhase[phase] = Math.max(
    maxRunningFilesByPhase[phase] ?? 0,
    runningFiles,
  );
}

/** @param {string} event @param {Record<string, unknown>} [extra] */
function queueTrace(event, extra = {}) {
  if (!traceOutputPath) return traceWrites;
  traceWrites = traceWrites.then(async () => {
    /** @type {Record<string, string | number>} */
    let pageState = {};
    try {
      if (tracePage && !tracePage.isClosed()) {
        pageState = await tracePage.evaluate(() => {
          const statuses = [
            ...document.querySelectorAll(
              ".progress-panel .progress-row[data-status]",
            ),
          ].map((row) => row.getAttribute("data-status"));
          const reviewView = document.querySelector(
            '[data-testid="timeline-view"]',
          );
          const comparisonDrawer = document.querySelector(
            '[data-testid="review-compare-drawer"]',
          );
          const comparisonRun = document.querySelector(
            '[data-testid="review-run-comparison"]',
          );
          /** @param {string} status */
          const count = (status) =>
            statuses.filter((value) => value === status).length;
          return {
            pendingFiles: count("pending"),
            runningFiles: count("running"),
            completedFiles: count("complete"),
            errorFiles: count("error"),
            cancelledFiles: count("cancelled"),
            renderedResultRows: document.querySelectorAll(
              '[data-testid="result-row"]',
            ).length,
            effectiveProcessingConcurrency: Number(
              document
                .querySelector("#process")
                ?.getAttribute("data-effective-processing-concurrency") ?? 0,
            ),
            reviewViewText: reviewView?.textContent?.trim().slice(0, 240) ?? "",
            reviewCompareToggleCount: document.querySelectorAll(
              '[data-testid="review-compare-toggle"]',
            ).length,
            comparisonDrawerPresent: Number(Boolean(comparisonDrawer)),
            comparisonRunPresent: Number(Boolean(comparisonRun)),
            comparisonRunDisabled:
              comparisonRun instanceof HTMLButtonElement &&
              comparisonRun.disabled
                ? 1
                : 0,
          };
        });
      }
    } catch (error) {
      pageState = {
        pageStateError: error instanceof Error ? error.message : String(error),
      };
    }
    updatePeaks(
      typeof pageState.runningFiles === "number" ? pageState.runningFiles : 0,
    );
    await appendFile(
      traceOutputPath,
      `${JSON.stringify({
        event,
        phase,
        observedAtElapsedMs: performance.now() - traceStarted,
        summedProcessTreeRssBytes,
        peakSummedProcessTreeRssBytes,
        liveWorkers: liveWorkers.size,
        ...pageState,
        ...extra,
      })}\n`,
    );
  });
  return traceWrites;
}

const rssSampler = setInterval(() => {
  summedProcessTreeRssBytes = processTreeRssBytes(process.pid);
  peakSummedProcessTreeRssBytes = Math.max(
    peakSummedProcessTreeRssBytes,
    summedProcessTreeRssBytes,
  );
  void queueTrace("sample");
}, 500);

try {
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: false,
    // The throughput run measures the current production bundle, not service
    // worker installation/caching. Offline behavior has its own E2E coverage.
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  tracePage = page;
  page.setDefaultTimeout(timeoutMs);
  const workerUrls = new Set();
  page.on("worker", (worker) => {
    const workerId = ++workerSerial;
    liveWorkers.add(worker);
    workerUrls.add(worker.url());
    workerRecords.set(workerId, {
      id: workerId,
      url: worker.url(),
      createdPhase: phase,
      createdElapsedMs: performance.now() - traceStarted,
    });
    updatePeaks();
    worker.on("close", () => {
      liveWorkers.delete(worker);
      const record = workerRecords.get(workerId);
      if (record) {
        record.closedPhase = phase;
        record.closedElapsedMs = performance.now() - traceStarted;
      }
    });
  });
  page.on("crash", () => {
    failureReason = "page crashed";
    void queueTrace("page-crash");
  });
  page.on("close", () => {
    if (phase !== "complete") {
      failureReason ??= "page closed before completion";
      void queueTrace("page-close");
    }
  });
  browser.on("disconnected", () => {
    if (phase !== "complete") {
      failureReason ??= "browser disconnected before completion";
      void queueTrace("browser-disconnected");
    }
  });

  await page.addInitScript((traceId) => {
    window.__CHRONICLE_TEST_RUNTIME__ = {
      datetimeOfPreprocessing: "2026-04-24 00:32:53",
      performanceTraceId: traceId,
    };
  }, performanceTraceId);

  /** @type {string[]} */
  const errors = [];
  page.on("pageerror", (error) => {
    const message = `PAGE ERROR: ${error.message}`;
    errors.push(message);
    console.error(message);
  });
  page.on("console", (message) => {
    const text = message.text();
    if (
      message.type() === "info" &&
      text.startsWith("CHRONICLE_RUNTIME_PERF ")
    ) {
      try {
        const event = JSON.parse(text.slice("CHRONICLE_RUNTIME_PERF ".length));
        if (event.traceId === performanceTraceId) {
          const { elapsedMs: runtimeElapsedMs, ...rest } = event;
          runtimePerformanceEvents.push({
            observedAtElapsedMs: performance.now() - traceStarted,
            runtimeElapsedMs,
            ...rest,
          });
          void queueTrace("runtime-phase", event);
        }
      } catch (error) {
        console.error(
          `INVALID RUNTIME PERFORMANCE EVENT: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }
    if (["error", "warning"].includes(message.type())) {
      console.error(`BROWSER ${message.type().toUpperCase()}: ${text}`);
    }
  });
  page.on("requestfailed", (request) => {
    console.error(
      `BROWSER REQUEST FAILED: ${request.url()} ${request.failure()?.errorText ?? ""}`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      console.error(`BROWSER RESPONSE ${response.status()}: ${response.url()}`);
    }
  });

  phase = "startup";
  await page.goto(target, { waitUntil: "networkidle" });
  await page
    .getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" })
    .waitFor();

  console.log(`Uploading ${fileCount} files (${bytesPerFile} bytes each)…`);
  phase = "file-selection";
  const selectionStarted = performance.now();
  await page.getByTestId("raw-file-input").setInputFiles(uploadFiles);
  const fileSelectionCallElapsedMs = performance.now() - selectionStarted;
  phase = "post-selection-readiness";
  const readinessStarted = performance.now();

  // Let the shared Rust inspection worker finish before changing options. Changing
  // settings while inspection is in flight also asks that worker for a new plan
  // view and measures an artificial contention path instead of file throughput.
  const processButton = page.getByTestId("process-files-button");
  const inspectionDiagnostic = setTimeout(() => {
    void Promise.all([
      processButton.evaluate((button) => ({
        disabled: /** @type {HTMLButtonElement} */ (button).disabled,
        text: button.textContent,
      })),
      page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((name) => /chronicle-worker|\.wasm/.test(name)),
      ),
    ]).then(([button, resources]) => {
      console.error(
        `Inspection still pending after 5s: ${JSON.stringify({ button, resources })}`,
      );
    });
  }, 5_000);
  await page.waitForFunction(
    () => {
      const button = document.querySelector(
        '[data-testid="process-files-button"]',
      );
      return button instanceof HTMLButtonElement && !button.disabled;
    },
    undefined,
    { timeout: timeoutMs },
  );
  clearTimeout(inspectionDiagnostic);
  const postSelectionReadinessElapsedMs = performance.now() - readinessStarted;
  const selectionToReadyElapsedMs = performance.now() - selectionStarted;

  if (disableStaticPlots) {
    await page.locator("#settings-tab").click();
    const plottingToggle = page.getByTestId("toggle-enablePlotting");
    if (await plottingToggle.isChecked()) await plottingToggle.uncheck();
  }

  // Move from the Files tab to the Process tab, then configure its local copy of
  // the synchronized worker controls. The button exists while its tab is hidden,
  // so waiting for visibility before selecting the tab would deadlock the harness.
  await page.locator("#process-tab").click();
  await processButton.waitFor({ state: "visible", timeout: timeoutMs });
  await page.getByTestId("toggle-parallelProcessing-process").check();
  await page
    .getByTestId("parallel-max-workers-process-input")
    .fill(String(workerCount));

  const workersBeforeProcessing = liveWorkers.size;
  phase = "processing";
  const processingStarted = performance.now();
  console.log(
    `Clicking Process after ${(selectionToReadyElapsedMs / 1000).toFixed(1)}s selection-to-ready`,
  );
  await processButton.click({ timeout: timeoutMs });
  await page.waitForFunction(
    () =>
      Number(
        document
          .querySelector("#process")
          ?.getAttribute("data-effective-processing-concurrency") ?? 0,
      ) > 0,
    undefined,
    { timeout: timeoutMs },
  );
  const effectiveProcessingConcurrency = Number(
    await page
      .locator("#process")
      .getAttribute("data-effective-processing-concurrency"),
  );

  // Large batches intentionally defer the per-file result table so thousands
  // of download controls do not delay the View tab. The always-visible summary
  // is derived from the same completed-results array and remains the completion
  // signal for this benchmark.
  const resultSummary = page.locator(".result-panel__summary");
  const completedSummary = resultSummary
    .filter({
      hasText: `${fileCount} ${fileCount === 1 ? "file" : "files"} processed`,
    })
    .first();
  const fatalError = page.locator(".result-panel .error-text").first();
  await Promise.race([
    completedSummary.waitFor({ timeout: timeoutMs }),
    fatalError.waitFor({ timeout: timeoutMs }).then(async () => {
      throw new Error(
        `browser processing failed: ${(await fatalError.textContent()) ?? "unknown error"}`,
      );
    }),
  ]);

  const elapsed = performance.now() - processingStarted;
  // Re-sample after completion: the first sample races the batch start and only
  // sees the pre-measurement static lane count; the adaptive controller raises
  // the attribute after the first worker reports its WASM high-water.
  const finalEffectiveProcessingConcurrency = Number(
    await page
      .locator("#process")
      .getAttribute("data-effective-processing-concurrency"),
  );
  const resultSummaryText = (await completedSummary.textContent()) ?? "";
  const resultCount = Number(
    resultSummaryText.match(/^(\d+) files? processed/)?.[1] ?? 0,
  );
  console.log(
    `Completed ${resultCount}/${fileCount} in ${(elapsed / 1000).toFixed(1)}s`,
  );
  let comparisonElapsedMs = null;
  let repeatedComparisonElapsedMs = null;
  let toggledComparisonElapsedMs = null;
  let toggleReuseEvidence = null;
  let backgroundComparisonEvidence = null;
  const comparisonDigestsByFile = [];
  if (runComparison && resultCount === fileCount) {
    phase = "comparison";
    await page.getByRole("tab", { name: /View/i }).click();
    const compareToggle = page.getByTestId("review-compare-toggle");
    await Promise.race([
      compareToggle.waitFor({ state: "visible", timeout: timeoutMs }),
      page
        .waitForFunction(
          () => {
            const view = document.querySelector(
              '[data-testid="timeline-view"]',
            );
            const toggle = document.querySelector(
              '[data-testid="review-compare-toggle"]',
            );
            const text = view?.textContent?.trim() ?? "";
            return !toggle && text && !text.startsWith("Loading")
              ? text
              : false;
          },
          undefined,
          { timeout: timeoutMs },
        )
        .then((handle) => handle.jsonValue())
        .then((message) => {
          throw new Error(`View review data did not load: ${message}`);
        }),
    ]);
    console.log("Opening comparison drawer…");
    await compareToggle.click();
    const drawer = page.getByTestId("review-compare-drawer");
    await drawer.waitFor({ state: "visible", timeout: timeoutMs });
    console.log("Editing Arm B…");
    await drawer.getByTestId("minimum-usage-duration-input").fill("2");
    if (comparisonWarmupMs > 0) {
      await page.waitForTimeout(comparisonWarmupMs);
    }
    const comparisonDigestBefore = await page
      .getByTestId("timeline-view")
      .getAttribute("data-comparison-digest");
    const comparisonStarted = performance.now();
    console.log("Running Arm B…");
    await drawer.getByTestId("review-run-comparison").click();
    await page.waitForFunction(
      (previousDigest) => {
        const digest = document
          .querySelector('[data-testid="timeline-view"]')
          ?.getAttribute("data-comparison-digest");
        return /^sha256:[0-9a-f]{64}$/.test(digest ?? "") && digest !== previousDigest;
      },
      comparisonDigestBefore,
      { timeout: timeoutMs },
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    comparisonElapsedMs = performance.now() - comparisonStarted;
    await drawer.waitFor({ state: "hidden", timeout: timeoutMs });
    await page.getByTestId("review-mcard-b").waitFor({ timeout: timeoutMs });
    const firstComparisonDigest = await page
      .getByTestId("timeline-view")
      .getAttribute("data-comparison-digest");
    if (repeatComparison || toggleComparison) {
      console.log("Editing Arm B again with the warm worker pool…");
      await compareToggle.click();
      await drawer.waitFor({ state: "visible", timeout: timeoutMs });
      await drawer.getByTestId("minimum-usage-duration-input").fill("3");
      const repeatedDigestBefore = await page
        .getByTestId("timeline-view")
        .getAttribute("data-comparison-digest");
      const repeatedComparisonStarted = performance.now();
      await drawer.getByTestId("review-run-comparison").click();
      await page.waitForFunction(
        (previousDigest) => {
          const digest = document
            .querySelector('[data-testid="timeline-view"]')
            ?.getAttribute("data-comparison-digest");
          return /^sha256:[0-9a-f]{64}$/.test(digest ?? "") && digest !== previousDigest;
        },
        repeatedDigestBefore,
        { timeout: timeoutMs },
      );
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      repeatedComparisonElapsedMs =
        performance.now() - repeatedComparisonStarted;
      await drawer.waitFor({ state: "hidden", timeout: timeoutMs });
      await page.getByTestId("review-mcard-b").waitFor({ timeout: timeoutMs });
    }
    if (toggleComparison) {
      console.log("Toggling Arm B back to its first config (ETag reuse)…");
      await compareToggle.click();
      await drawer.waitFor({ state: "visible", timeout: timeoutMs });
      await drawer.getByTestId("minimum-usage-duration-input").fill("2");
      const toggledDigestBefore = await page
        .getByTestId("timeline-view")
        .getAttribute("data-comparison-digest");
      const toggledComparisonStarted = performance.now();
      await drawer.getByTestId("review-run-comparison").click();
      await page.waitForFunction(
        (previousDigest) => {
          const digest = document
            .querySelector('[data-testid="timeline-view"]')
            ?.getAttribute("data-comparison-digest");
          return /^sha256:[0-9a-f]{64}$/.test(digest ?? "") && digest !== previousDigest;
        },
        toggledDigestBefore,
        { timeout: timeoutMs },
      );
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      toggledComparisonElapsedMs =
        performance.now() - toggledComparisonStarted;
      await drawer.waitFor({ state: "hidden", timeout: timeoutMs });
      await page.getByTestId("review-mcard-b").waitFor({ timeout: timeoutMs });
      const timeline = page.getByTestId("timeline-view");
      toggleReuseEvidence = {
        firstComparisonDigest,
        toggledDigestBefore,
        toggledComparisonDigest: await timeline.getAttribute(
          "data-comparison-digest",
        ),
        summaryReused: await timeline.getAttribute(
          "data-comparison-summary-reused",
        ),
      };
      if (
        toggleReuseEvidence.toggledComparisonDigest !==
          firstComparisonDigest ||
        toggleReuseEvidence.summaryReused !== "true"
      ) {
        throw new Error(
          `toggle-back did not prove review-summary reuse: ${JSON.stringify(toggleReuseEvidence)}`,
        );
      }
    }
    if (fileCount > 1) {
      // Background comparisons complete asynchronously after the selected
      // file's run. With duplicate content they are warm near-instant hits;
      // with distinct files each one is real work, so reading a background
      // file's attributes without waiting for its comparison digest races
      // and observes nulls. Walk every file, wait for its digest, and keep
      // the strict reuse assertion on the first background file (P002).
      const fileSearch = page.getByTestId("timeline-view-file");
      const timeline = page.getByTestId("timeline-view");
      for (let fileIndex = 1; fileIndex <= fileCount; fileIndex += 1) {
        const fileName = `Raw P${String(fileIndex).padStart(3, "0")}.csv`;
        await fileSearch.fill(fileName);
        await page.waitForFunction(
          (expectedFileName) =>
            document
              .querySelector('[data-testid="timeline-view"]')
              ?.getAttribute("data-active-file") === expectedFileName,
          fileName,
          { timeout: timeoutMs },
        );
        await timeline.waitFor({ state: "visible", timeout: timeoutMs });
        await page.waitForFunction(
          () => {
            const digest = document
              .querySelector('[data-testid="timeline-view"]')
              ?.getAttribute("data-comparison-digest");
            return /^sha256:[0-9a-f]{64}$/.test(digest ?? "");
          },
          undefined,
          { timeout: timeoutMs },
        );
        comparisonDigestsByFile.push({
          fileName,
          comparisonDigest: await timeline.getAttribute(
            "data-comparison-digest",
          ),
        });
        if (fileIndex !== 2) continue;
        backgroundComparisonEvidence = await timeline.evaluate((element) => ({
          cacheSources: element.getAttribute("data-comparison-cache-sources"),
          suppliedReviewBaseBytes: Number(
            element.getAttribute("data-comparison-review-base-bytes"),
          ),
          suppliedReconstructionBaseBytes: Number(
            element.getAttribute("data-comparison-reconstruction-base-bytes"),
          ),
          buildEnvironmentDigest: element.getAttribute(
            "data-comparison-build-environment-digest",
          ),
          comparisonDigest: element.getAttribute("data-comparison-digest"),
          previousRoot: element.getAttribute("data-comparison-previous-root"),
          recomputedSteps: element.getAttribute(
            "data-comparison-recomputed-steps",
          ),
          cachedStepCount: Number(
            element.getAttribute("data-comparison-cached-step-count"),
          ),
          totalDayRows: Number(
            document
              .querySelector('[data-testid="review-day-table"]')
              ?.getAttribute("data-total-rows") ?? 0,
          ),
          renderedDayRows: Number(
            document
              .querySelector('[data-testid="review-day-table"]')
              ?.getAttribute("data-rendered-rows") ?? 0,
          ),
        }));
        const expectedCacheSource = repeatComparison
          ? "salsa-memory"
          : "verified-review-base";
        if (
          backgroundComparisonEvidence.cacheSources !== expectedCacheSource ||
          !/^sha256:[0-9a-f]{64}$/.test(
            backgroundComparisonEvidence.buildEnvironmentDigest ?? "",
          ) ||
          !/^sha256:[0-9a-f]{64}$/.test(
            backgroundComparisonEvidence.comparisonDigest ?? "",
          ) ||
          backgroundComparisonEvidence.cachedStepCount <= 0
        ) {
          throw new Error(
            `background comparison did not prove ${expectedCacheSource} reuse: ${JSON.stringify(backgroundComparisonEvidence)}`,
          );
        }
      }
    }
    console.log(
      `Compared ${fileCount} files with the 8-worker A/B path in ${(comparisonElapsedMs / 1000).toFixed(1)}s` +
        (repeatedComparisonElapsedMs === null
          ? ""
          : `; repeated config edit in ${(repeatedComparisonElapsedMs / 1000).toFixed(1)}s`),
    );
  }
  phase = "complete";
  if (errors.length) {
    console.log("PAGE ERRORS:", errors);
  }
  if (resultCount !== fileCount) {
    console.error(`FAIL: expected ${fileCount} results, got ${resultCount}`);
    process.exitCode = 1;
  }
  console.log(
    JSON.stringify(
      {
        fileCount,
        requestedWorkerCap: workerCount,
        workersBeforeProcessing,
        maxLiveWorkers,
        workerUrls: [...workerUrls].sort(),
        disableStaticPlots,
        fixturePath,
        bytesPerFile,
        totalInputBytes,
        distinctContentCount,
        fileSelectionCallElapsedMs,
        postSelectionReadinessElapsedMs,
        selectionToReadyElapsedMs,
        clickToRenderedResultsMs: elapsed,
        effectiveProcessingConcurrency,
        finalEffectiveProcessingConcurrency,
        resultCount,
        comparisonElapsedMs,
        repeatedComparisonElapsedMs,
        toggledComparisonElapsedMs,
        toggleReuseEvidence,
        comparisonWarmupMs,
        backgroundComparisonEvidence,
        comparedFileCount: comparisonDigestsByFile.length,
        distinctComparisonDigests: new Set(
          comparisonDigestsByFile.map((entry) => entry.comparisonDigest),
        ).size,
        comparisonDigestsByFile,
        peakSummedProcessTreeRssBytes,
        maxLiveWorkersByPhase,
        maxRunningFiles,
        maxRunningFilesByPhase,
        workerLifecycles: [...workerRecords.values()],
        traceOutputPath,
        performanceTraceId,
        reviewKernelMs: runtimePerformanceEvents
          .filter(
            (event) =>
              event.materialization === "review" && event.phase === "kernel",
          )
          .map((event) => event.runtimeElapsedMs),
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  await queueTrace("success", {
    resultCount,
    effectiveProcessingConcurrency,
    clickToRenderedResultsMs: elapsed,
    comparisonElapsedMs,
  });
} catch (error) {
  failureReason ??= error instanceof Error ? error.message : String(error);
  await queueTrace("failure", { failureReason });
  throw error;
} finally {
  clearInterval(rssSampler);
  await traceWrites;
  await browser?.close();
  if (stagedFixtureDirectory) {
    await rm(stagedFixtureDirectory, { recursive: true, force: true });
  }
}
