/**
 * Every processing option, one change at a time, through the whole app on a
 * realistic-shape file (the real corpus's median size): the share-link
 * `?config=` boot path, the Process run, the View tab and the Download-all
 * ZIP. A case passes when the setting survived boot, the file processed without
 * an error, every CSV in the ZIP parses, no plot was skipped, the output the
 * option switches on is actually offered, and nothing left the browser.
 *
 * Each case also writes its output digests to web/.tmp/preview-matrix/ so the
 * options that changed nothing on this file can be listed afterwards.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import {
  assertNoExternalRequests,
  downloadZipEntries,
  installDeterministicRuntime,
  parseCsv,
  trackExternalRequests,
} from "./helpers";
import { CASES, EXPECTED_REFUSALS, UNCOVERED, type Options } from "./optionMatrix";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_DIR = path.join(WEB_ROOT, ".tmp", "preview-matrix");

/** The output an option switches on must be offered to the researcher. */
function expectedOffers(diff: Options): { testIds: string[]; entry?: RegExp; noEntry?: RegExp } {
  const testIds: string[] = [];
  if (diff.enableParquetExport === true) testIds.push("download-parquet-zip");
  if (diff.enableSpssExport === true) testIds.push("download-spss-zip");
  if (diff.enableAggregates === true) testIds.push("download-aggregates-zip");
  if (diff.enableInteractiveTimeline === true) testIds.push("download-timeline-viewer");
  if (diff.exportPlotsAsSvg === true) return { testIds, entry: /\.svg$/ };
  if (diff.enablePlotting === false) return { testIds, noEntry: /\.(png|svg)$/ };
  if (diff.enableActivityHeatmap === false) return { testIds, noEntry: /Heatmap/ };
  if (diff.processScreenUsage === false) return { testIds, noEntry: /Screen Usage.*\.csv$/ };
  return { testIds };
}

let fixturePath = "";

// eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern for the fixtures argument
test.beforeAll(({}, workerInfo) => {
  mkdirSync(WORK_DIR, { recursive: true });
  fixturePath = path.join(WORK_DIR, `median-${workerInfo.workerIndex}.csv`);
  if (existsSync(fixturePath)) return;
  execFileSync(
    path.join(WEB_ROOT, "node_modules", ".bin", "vite-node"),
    [
      "scripts/generate_benchmark_fixture.mts",
      "--realistic",
      "--days", "14",
      "--rows-per-day", "400",
      "--seed", "4242",
      "--output", fixturePath,
    ],
    { cwd: WEB_ROOT, stdio: "ignore" },
  );
});

test("@matrix every processing option has a matrix case", () => {
  expect(UNCOVERED).toEqual([]);
});

async function readExportedSettings(page: Page): Promise<Options> {
  await page.getByRole("tab", { name: /Settings/i }).click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-config-button").click();
  const file = await (await download).path();
  if (!file) throw new Error("no exported config");
  return (JSON.parse(readFileSync(file, "utf-8")) as { currentSettings: Options }).currentSettings;
}


for (const matrixCase of CASES) {
  test(`@matrix ${matrixCase.name}`, async ({ page }, testInfo) => {
    test.setTimeout(testInfo.project.name === "firefox" ? 360_000 : 180_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const tracker = trackExternalRequests(page);
    await installDeterministicRuntime(page);

    await page.goto(`./?config=${encodeURIComponent(JSON.stringify(matrixCase.diff))}`);
    await expect(
      page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
    ).toBeVisible();

    // The share link must reach the app unchanged: a sanitizer that drops a
    // valid value runs the default instead and every assertion below is moot.
    const applied = await readExportedSettings(page);
    for (const [key, value] of Object.entries(matrixCase.diff)) {
      expect(applied[key], `setting ${key} after boot`).toEqual(value);
    }

    await page.getByTestId("raw-file-input").setInputFiles(fixturePath);
    await page.getByRole("tab", { name: /Process/i }).click();
    const processButton = page.getByTestId("process-files-button");
    await expect(processButton).toBeEnabled();
    await processButton.click();
    const refusal = EXPECTED_REFUSALS[matrixCase.name];
    if (refusal) {
      await expect(page.getByText(refusal).first()).toBeVisible({ timeout: 150_000 });
      await expect(page.getByTestId("result-row")).toHaveCount(0);
      expect(pageErrors).toEqual([]);
      return;
    }
    await expect(page.getByTestId("result-row").or(page.getByTestId("error-detail")).first())
      .toBeVisible({ timeout: 150_000 });
    await expect(page.getByTestId("cancel-process-button")).toHaveCount(0, { timeout: 150_000 });
    await expect(page.getByTestId("error-detail")).toHaveCount(0);
    await expect(page.getByTestId("raw-file-row-error")).toHaveCount(0);

    const entries = await downloadZipEntries(page, "download-all-zip");
    await expect(page.getByTestId("download-error")).toHaveCount(0);
    await expect(page.getByTestId("download-skipped")).toHaveCount(0);
    const names = [...entries.keys()];
    expect(names.some((name) => name.endsWith(".csv")), "ZIP has a CSV").toBe(true);
    for (const [name, text] of entries) {
      if (!name.endsWith(".csv")) continue;
      expect(() => parseCsv(text), `${name} parses`).not.toThrow();
    }

    const offers = expectedOffers(matrixCase.diff);
    for (const testId of offers.testIds) {
      await expect(page.getByTestId(testId).first(), `${testId} offered`).toBeVisible();
    }
    if (offers.entry) expect(names.some((name) => offers.entry!.test(name))).toBe(true);
    if (offers.noEntry) expect(names.filter((name) => offers.noEntry!.test(name))).toEqual([]);

    await page.getByRole("tab", { name: /View/i }).click();
    await expect(
      page.getByTestId("timeline-view").or(page.getByTestId("timeline-view-empty")).first(),
    ).toBeVisible({ timeout: 60_000 });

    writeFileSync(
      path.join(WORK_DIR, `${testInfo.project.name}--${matrixCase.name.replace(/[^\w=.-]+/g, "_")}.json`),
      JSON.stringify({
        case: matrixCase.name,
        diff: matrixCase.diff,
        entries: Object.fromEntries(
          [...entries].map(([name, text]) => [
            name,
            createHash("sha256").update(text).digest("hex"),
          ]),
        ),
      }),
    );
    expect(pageErrors).toEqual([]);
    assertNoExternalRequests(tracker);
  });
}
