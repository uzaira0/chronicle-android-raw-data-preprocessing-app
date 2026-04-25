/**
 * Empirical hang-fix verification: uploads N small Chronicle CSVs, enables
 * parallel processing, clicks Process, measures wall time. This reproduces
 * the user-reported hang on the pre-fix code (never completed with 90 files)
 * and asserts the fixed worker-pool-based implementation finishes finite.
 */
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] ?? "http://127.0.0.1:4173/";
const fileCount = Number(process.argv[3] ?? "50");
const workerCount = Number(process.argv[4] ?? "4");
const timeoutMs = Number(process.argv[5] ?? "180000");

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

const files = Array.from({ length: fileCount }, (_, index) => ({
  name: `Raw P${String(index + 1).padStart(3, "0")}.csv`,
  mimeType: "text/csv",
  buffer: Buffer.from(buildSmallCsv(`P${String(index + 1).padStart(3, "0")}`), "utf-8"),
}));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: false,
});
const page = await context.newPage();

await page.addInitScript(() => {
  window.__CHRONICLE_TEST_RUNTIME__ = { datetimeOfPreprocessing: "2026-04-24 00:32:53" };
});

const errors = [];
page.on("pageerror", (error) => errors.push(`PAGE ERROR: ${error.message}`));

await page.goto(target, { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }).waitFor();

console.log(`Uploading ${fileCount} files…`);
await page.getByTestId("raw-file-input").setInputFiles(files);

// Expand the Performance card and enable parallel processing with the
// requested worker count.
const perfCard = page.locator('[data-section-id="performance"]');
await perfCard.waitFor();
const perfHeader = perfCard.locator(".section-card__header");
if ((await perfHeader.getAttribute("aria-expanded")) === "false") {
  await perfHeader.click();
}
await page.getByTestId("toggle-parallelProcessing").check();
await page.getByTestId("parallel-max-workers-input").fill(String(workerCount));

const started = performance.now();
console.log(`Clicking Process at t=${started.toFixed(0)}ms`);
await page.getByTestId("process-files-button").click();

// Wait for result-card count to match the input file count.
await page.locator('[data-testid="result-card"]').nth(fileCount - 1).waitFor({ timeout: timeoutMs });

const elapsed = performance.now() - started;
const resultCount = await page.locator('[data-testid="result-card"]').count();
console.log(`Completed ${resultCount}/${fileCount} in ${(elapsed / 1000).toFixed(1)}s`);
if (errors.length) {
  console.log("PAGE ERRORS:", errors);
}
if (resultCount !== fileCount) {
  console.error(`FAIL: expected ${fileCount} results, got ${resultCount}`);
  process.exitCode = 1;
}
await browser.close();
