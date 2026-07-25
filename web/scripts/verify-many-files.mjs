/**
 * Empirical hang-fix verification: uploads N small Chronicle CSVs, enables
 * parallel processing, clicks Process, measures wall time. This reproduces
 * the user-reported hang on the pre-fix code (never completed with 90 files)
 * and asserts the fixed worker-pool-based implementation finishes finite.
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFile, link, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] ?? "http://127.0.0.1:4173/";
const fileCount = Number(process.argv[3] ?? "50");
const workerCount = Number(process.argv[4] ?? "4");
const timeoutMs = Number(process.argv[5] ?? "180000");
const fixturePath = process.argv[6] ? path.resolve(process.argv[6]) : null;

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
    (total, [pid, , rssKib]) => total + (selected.has(pid) ? rssKib * 1024 : 0),
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
    const ts = new Date(base + index * 1000).toISOString().replace("T", " ").slice(0, 19);
    const type = index % 2 === 0 ? "Unknown importance: 1" : "Unknown importance: 2";
    rows.push(`Study,${participantId},Target Child,Chat,${type},com.example.chat,${ts},America/Chicago`);
  }
  return rows.join("\n");
}

/** @type {string | null} */
let stagedFixtureDirectory = null;
let bytesPerFile;
let uploadFiles;
if (fixturePath) {
  const fixture = await stat(fixturePath);
  bytesPerFile = fixture.size;
  const stagingDirectory = await mkdtemp(path.join(tmpdir(), "chronicle-many-files-"));
  stagedFixtureDirectory = stagingDirectory;
  uploadFiles = await Promise.all(
    Array.from({ length: fileCount }, async (_, index) => {
      const stagedPath = path.join(
        stagingDirectory,
        `Raw P${String(index + 1).padStart(3, "0")}.csv`,
      );
      try {
        await link(fixturePath, stagedPath);
      } catch {
        await copyFile(fixturePath, stagedPath);
      }
      return stagedPath;
    }),
  );
} else {
  uploadFiles = Array.from({ length: fileCount }, (_, index) => ({
    name: `Raw P${String(index + 1).padStart(3, "0")}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(buildSmallCsv(`P${String(index + 1).padStart(3, "0")}`), "utf-8"),
  }));
  bytesPerFile = uploadFiles[0]?.buffer.byteLength ?? 0;
}

let peakProcessTreeRssBytes = processTreeRssBytes(process.pid);
const rssSampler = setInterval(() => {
  peakProcessTreeRssBytes = Math.max(
    peakProcessTreeRssBytes,
    processTreeRssBytes(process.pid),
  );
}, 500);

let browser;
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
page.setDefaultTimeout(timeoutMs);

await page.addInitScript(() => {
  window.__CHRONICLE_TEST_RUNTIME__ = { datetimeOfPreprocessing: "2026-04-24 00:32:53" };
});

/** @type {string[]} */
const errors = [];
page.on("pageerror", (error) => {
  const message = `PAGE ERROR: ${error.message}`;
  errors.push(message);
  console.error(message);
});
page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) {
    console.error(`BROWSER ${message.type().toUpperCase()}: ${message.text()}`);
  }
});
page.on("requestfailed", (request) => {
  console.error(`BROWSER REQUEST FAILED: ${request.url()} ${request.failure()?.errorText ?? ""}`);
});
page.on("response", (response) => {
  if (response.status() >= 400) {
    console.error(`BROWSER RESPONSE ${response.status()}: ${response.url()}`);
  }
});

await page.goto(target, { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }).waitFor();

console.log(
  `Uploading ${fileCount} files (${bytesPerFile} bytes each)…`,
);
await page.getByTestId("raw-file-input").setInputFiles(uploadFiles);
const started = performance.now();

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
    console.error(`Inspection still pending after 5s: ${JSON.stringify({ button, resources })}`);
  });
}, 5_000);
await page.waitForFunction(
  () => {
    const button = document.querySelector('[data-testid="process-files-button"]');
    return button instanceof HTMLButtonElement && !button.disabled;
  },
  undefined,
  { timeout: timeoutMs },
);
clearTimeout(inspectionDiagnostic);

// Move from the Files tab to the Process tab, then configure its local copy of
// the synchronized worker controls. The button exists while its tab is hidden,
// so waiting for visibility before selecting the tab would deadlock the harness.
await page.locator("#process-tab").click();
await processButton.waitFor({ state: "visible", timeout: timeoutMs });
await page.getByTestId("toggle-parallelProcessing-process").check();
await page.getByTestId("parallel-max-workers-process-input").fill(String(workerCount));

console.log(`Clicking Process at t=${started.toFixed(0)}ms`);
await processButton.click({ timeout: timeoutMs });

// The current batch table exposes one result-row per completed file.
const expectedResult = page.locator('[data-testid="result-row"]').nth(fileCount - 1);
const fatalError = page.locator(".result-panel .error-text").first();
await Promise.race([
  expectedResult.waitFor({ timeout: timeoutMs }),
  fatalError.waitFor({ timeout: timeoutMs }).then(async () => {
    throw new Error(`browser processing failed: ${(await fatalError.textContent()) ?? "unknown error"}`);
  }),
]);

const elapsed = performance.now() - started;
const resultCount = await page.locator('[data-testid="result-row"]').count();
console.log(`Completed ${resultCount}/${fileCount} in ${(elapsed / 1000).toFixed(1)}s`);
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
      workerCount,
      fixturePath,
      bytesPerFile,
      totalInputBytes: bytesPerFile * fileCount,
      elapsedMs: elapsed,
      resultCount,
      peakProcessTreeRssBytes,
      pageErrors: errors,
    },
    null,
    2,
  ),
);
} finally {
  clearInterval(rssSampler);
  await browser?.close();
  if (stagedFixtureDirectory) {
    await rm(stagedFixtureDirectory, { recursive: true, force: true });
  }
}
