import type { Download, Locator, Page } from "@playwright/test";
import Papa from "papaparse";

import { DEFAULT_BROWSER_OPTIONS } from "../src/lib/generatedContract";
import {
  LAST_RUN_DB_NAME,
  LAST_RUN_DB_VERSION,
  LAST_RUN_RECORD_ID,
  LAST_RUN_STORE_NAME,
} from "../src/lib/lastRunStore";
import type { TimelineParticipantView } from "../src/lib/types";
import { WORKFLOW_CLOSURE_MAGIC_TEXT } from "../src/lib/workflowClosureProtocol";
// The durability context: these attacks export and re-import workspace
// closures, which need durable storage. On webkit-durable that is the
// persistent profile; Playwright's default WebKit context is private browsing,
// where the app correctly offers no workspace export at all.
import { expect, test as base } from "./durabilityContext";
import {
  APP_ONLY_RAW_CSV,
  APPS_FORCING_SCREEN_OPEN_CSV,
  CODEBOOK_CSV,
  FILTER_FILE_CSV,
  createFilterWorkbookBytes,
} from "./fixtures";
import {
  assertNoExternalRequests,
  downloadClosure,
  downloadCsv,
  downloadZipEntries,
  expandSectionCard,
  gotoApp,
  inspectClosure,
  installDeterministicRuntime,
  parseCsv,
  processFiles,
  setInputFile,
  setRawFiles,
  trackExternalRequests,
} from "./helpers";

const WAIT = 60_000;
const HEADING = "Chronicle Android Raw Data Preprocessor";
const OPTIONS_KEY = "chronicle.processingOptions.v1";
const SCHEMA_VERSION = 13;

type ObservedPage = {
  page: Page;
  errors: string[];
  dialogs: string[];
  requests: ReturnType<typeof trackExternalRequests>;
};
type Guard = { clean: () => Promise<void> };

// An automatic fixture also checks failed test bodies and newly opened export pages.
// The sentinel is installed before navigation; the dialog listener never accepts an attack.
const test = base.extend<{ guard: Guard }>({
  guard: [async ({ context, page }, use) => {
    const observed: ObservedPage[] = [];
    const observe = (target: Page) => {
      if (observed.some((entry) => entry.page === target)) return;
      const entry: ObservedPage = {
        page: target, errors: [], dialogs: [], requests: trackExternalRequests(target),
      };
      observed.push(entry);
      target.on("pageerror", (error) => entry.errors.push(error.message));
      target.on("dialog", async (dialog) => {
        // The app's own leave-while-running prompt is not attack content; the
        // test that reloads mid-run answers it with "leave".
        if (dialog.type() === "beforeunload") return dialog.accept();
        entry.dialogs.push(`${dialog.type()}: ${dialog.message()}`);
        await dialog.dismiss();
      });
    };
    context.on("page", observe);
    context.pages().forEach(observe);
    await context.addInitScript(() => {
      (window as unknown as { __pwned: number }).__pwned = 0;
    });
    await installDeterministicRuntime(page);
    const clean = async () => {
      for (const entry of observed) {
        expect(entry.errors, `uncaught errors in ${entry.page.url()}`).toEqual([]);
        expect(entry.dialogs, "hostile content opened a browser dialog").toEqual([]);
        if (!entry.page.isClosed()) {
          expect(await entry.page.evaluate(() =>
            (window as unknown as { __pwned?: number }).__pwned ?? 0,
          ), "hostile content executed").toBe(0);
        }
        assertNoExternalRequests(entry.requests);
      }
    };
    try {
      await use({ clean });
    } finally {
      context.off("page", observe);
      await clean();
    }
  }, { auto: true }],
});

test.describe.configure({ mode: "parallel", timeout: 180_000 });

async function ready(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: HEADING })).toBeVisible({ timeout: WAIT });
  await expect(page.getByTestId("boot-error")).toHaveCount(0, { timeout: WAIT });
}

async function config(page: Page, options: Record<string, unknown>): Promise<void> {
  await page.goto(`./?config=${encodeURIComponent(JSON.stringify(options))}`);
  await ready(page);
}

async function tab(page: Page, name: "Settings" | "Files" | "Process" | "View"): Promise<void> {
  await page.getByRole("tab", { name, exact: true }).click({ timeout: WAIT });
}

// Preserve the fixture's actual header, spelling, and interaction types. Papa's
// writer handles quotes, CR, embedded newlines, and commas in attack cells.
function rawCsv(overrides: Record<string, string> = {}, warning?: string): string {
  const rows: Array<Record<string, string>> = parseCsv(APP_ONLY_RAW_CSV).map((row) => ({
    ...row,
    timezone: "UTC",
    ...overrides,
  }));
  rows[1]!.event_timestamp = overrides.event_timestamp ?? "2026-03-07 10:02:00";
  if (warning !== undefined) {
    rows.splice(1, 0, {
      ...rows[0]!, interaction_type: warning, event_timestamp: "2026-03-07 10:01:00",
    });
  }
  return Papa.unparse(rows, { newline: "\n" });
}

function assertOneEpisode(rows: Array<Record<string, string>>): void {
  const episodes = rows.filter((row) => row.interaction_type === "App Usage");
  expect(episodes, "one reconstructed episode, no duplicate run").toHaveLength(1);
  expect(Number(episodes[0]!.duration_seconds)).toBe(120);
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("The browser did not provide the downloaded file");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

// downloadZipEntries returns a Map, which hides duplicate names. Inspect only
// name multiplicity here, then reuse that helper for decoded CSV/SVG contents.
function zipNames(bytes: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    expect(bytes.readUInt16LE(offset + 8), "stored ZIP entry").toBe(0);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const start = offset + 30;
    names.push(bytes.subarray(start, start + nameLength).toString("utf8"));
    offset = start + nameLength + extraLength + size;
    expect(offset, "entry fits within the downloaded ZIP").toBeLessThanOrEqual(bytes.length);
  }
  expect(names.length, "the ZIP really contains entries").toBeGreaterThan(0);
  expect(bytes.readUInt32LE(offset), "central directory follows the entries").toBe(0x02014b50);
  return names;
}

async function zipWithNames(page: Page, id: string): Promise<{
  entries: Map<string, string>; names: string[];
}> {
  const download = page.waitForEvent("download", { timeout: WAIT });
  const entries = await downloadZipEntries(page, id);
  const names = zipNames(await downloadBytes(await download));
  return { entries, names };
}

async function hoverSession(page: Page, canvas: Locator, view: TimelineParticipantView,
  tooltip: Locator, attack: string): Promise<void> {
  const region = view.regions.find((entry) => !entry.kind || entry.kind === "session");
  expect(region, "a real session must reach the interactive viewer").toBeDefined();
  await expect(canvas).toBeVisible({ timeout: WAIT });
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const scale = box!.width / view.scene.width;
  await page.mouse.move(
    box!.x + (region!.x + region!.w / 2) * scale,
    box!.y + (region!.y + region!.h / 2) * scale,
  );
  await expect(tooltip).toBeVisible({ timeout: WAIT });
  await expect(tooltip).toContainText(attack, { timeout: WAIT });
  await expect(tooltip.locator("img, svg, script")).toHaveCount(0, { timeout: WAIT });
}

const HOSTILE_STRINGS = [
  { name: "img handler", value: '<img src=x onerror="window.__pwned++;alert(1)">' },
  { name: "script terminator", value: '</script><script>window.__pwned++;alert(2)</script>' },
  { name: "svg attribute breakout", value: '"><svg onload="window.__pwned++;alert(3)">' },
  { name: "RTL override", value: "hostile\u202ecsv.exe" },
  { name: "zero width joiners", value: "hostile\u200d\u200dlabel" },
  { name: "NUL", value: "hostile\0label" },
  // 6 KB: a GitHub Pages request target over ~8 KB is refused ("URI Too Long") before the app loads.
  { name: "6 KB", value: "H".repeat(6 * 1024) },
  { name: "emoji", value: "🧪👩🏽‍💻📦💥" },
];

test.describe("1. Hostile strings", () => {
  for (const attack of HOSTILE_STRINGS) {
    for (const origin of ["study-name-input", "query config"] as const) {
      test(`@adversarial strings: ${attack.name} through ${origin}, HTML and SVG exports`,
        async ({ page, context, guard }) => {
          const value = attack.value;
          const name = `${value}.csv`;
          await config(page, {
            enableInteractiveTimeline: true, exportPlotsAsSvg: true,
            includeCategoryColumn: true, minimumUsageDuration: 0,
            processScreenUsage: false, selectedTimezone: "UTC",
            studyName: origin === "query config" ? value : "",
          });
          if (origin === "study-name-input") await page.getByTestId(origin).fill(value);
          // Firefox drops NUL from typed text; the stored name is what was typed.
          const studyName = origin === "study-name-input" && attack.value.includes("\0")
            ? await page.getByTestId("study-name-input").inputValue() : value;
          expect([value, value.replace(/\0/g, "")]).toContain(studyName);
          await expect(page.getByTestId("study-name-input")).toHaveValue(studyName, { timeout: WAIT });
          await setInputFile(page, "app-codebook-file-input", `${value}-codebook.csv`,
            Papa.unparse([{ ...parseCsv(CODEBOOK_CSV)[0]!,
              app_package_name: value, application_label: value,
              bcm_play_store_broad_app_category: value }], { newline: "\n" }), "text/csv");
          await setInputFile(page, "raw-file-input", name,
            rawCsv({ app_package_name: value, application_label: value, participant_id: value }, value),
            "text/csv");
          await tab(page, "Files");
          await expect(page.getByTestId("raw-file-row").locator("strong")).toHaveText(name, { timeout: WAIT });
          await expect(page.locator(".raw-file-row__warning")).toContainText(value, { timeout: WAIT });
          await guard.clean();

          await processFiles(page);
          await expect(page.getByTestId("result-row")).toHaveCount(1, { timeout: WAIT });
          await expect(page.getByTestId("result-row").locator("td").first()).toHaveText(name, { timeout: WAIT });
          const output = parseCsv(await downloadCsv(page, "download-app-csv"));
          expect(output.length).toBeGreaterThan(0);
          for (const column of ["app_package_name", "application_label", "participant_id", "study_name"]) {
            const expected = column === "study_name" ? studyName : value;
            expect(output.some((row) => row[column] === expected), `${column} reached the output`).toBe(true);
          }
          expect(output.some((row) => row.bcm_play_store_broad_app_category === value),
            "the hostile codebook label reached the result").toBe(true);
          await guard.clean();

          // Load the actual downloaded HTML bytes in a fresh page, including its scripts.
          const html = await downloadCsv(page, "download-timeline-viewer");
          const viewer = await context.newPage();
          await viewer.goto(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
          // HTML's text parser replaces literal NUL with U+FFFD. That is safe
          // display normalization; JSON-backed tooltips still preserve the data.
          await expect(viewer.locator("h1")).toHaveText(
            new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\0/g, "\ufffd?")}$`),
            { timeout: WAIT },
          );
          // Rendered text drops or replaces NUL; either is safe display.
          await expect(viewer.locator("#panel-app .tv-scene-title")).toHaveText(
            new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\0/g, "\ufffd?")}$`),
            { timeout: WAIT },
          );
          const views = await viewer.locator("#tv-data").evaluate((element) =>
            JSON.parse(element.textContent ?? "{}") as { app: TimelineParticipantView[] },
          );
          expect(views.app).toHaveLength(1);
          await hoverSession(viewer, viewer.locator("#panel-app canvas").first(), views.app[0]!,
            viewer.locator("#panel-app .tv-tooltip").first(), value);
          await viewer.getByRole("tab", { name: "Screen usage", exact: true }).click();
          await expect(viewer.locator("#panel-screen")).toBeVisible({ timeout: WAIT });
          await viewer.getByRole("tab", { name: "App usage", exact: true }).click();
          await guard.clean();

          await tab(page, "View");
          await expect(page.getByTestId("timeline-view-participant-title")).toContainText(value, { timeout: WAIT });
          await hoverSession(page, page.locator(".timeline-view__canvas").first(), views.app[0]!,
            page.locator(".timeline-view__tooltip").first(), value);
          await guard.clean();
          await tab(page, "Process");
          const plots = await downloadZipEntries(page, "download-plots-zip");
          const svgs = [...plots].filter(([file]) => file.endsWith(".svg"));
          expect(svgs.length, "exportPlotsAsSvg generated SVGs").toBeGreaterThan(0);
          for (const [, svg] of svgs) {
            const structure = await page.evaluate((text) => {
              const doc = new DOMParser().parseFromString(text, "image/svg+xml");
              return {
                parseErrors: doc.querySelectorAll("parsererror").length,
                scripts: doc.querySelectorAll("script, foreignObject").length,
                handlers: [...doc.querySelectorAll("*")].flatMap((element) =>
                  [...element.attributes].filter((attribute) =>
                    /^on/i.test(attribute.name) ||
                    (/^(?:href|xlink:href|src)$/i.test(attribute.name) && /^(?:javascript:|https?:)/i.test(attribute.value)),
                  ).map((attribute) => attribute.name)),
              };
            }, svg);
            expect(structure).toEqual({ parseErrors: 0, scripts: 0, handlers: [] });
            const svgPage = await context.newPage();
            await svgPage.goto(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
            await expect(svgPage.locator("svg")).toBeVisible({ timeout: WAIT });
          }
          await ready(page);
          await guard.clean();
        });
    }
  }
});

test.describe("2. Formula injection", () => {
  // Policy (operator decision 2026-10-03): output CSVs keep raw values by
  // default, because analysis scripts read them; the opt-in
  // neutralizeSpreadsheetFormulas setting prefixes text cells that a
  // spreadsheet would execute. Both arms are asserted.
  test("@adversarial formula: by default the value is kept exactly as given", async ({ page, guard }) => {
    const value = "=SUM(1,1)";
    await config(page, { selectedTimezone: "UTC", minimumUsageDuration: 0, processScreenUsage: false });
    await setInputFile(page, "raw-file-input", "formula.csv",
      rawCsv({ app_package_name: value, application_label: value }), "text/csv");
    await processFiles(page);
    const app = parseCsv(await downloadCsv(page, "download-app-csv"));
    const cells = app.flatMap((row) => Object.entries(row)
      .filter(([column]) => /app_package|application_label|app_label|package_name/.test(column))
      .map(([, cell]) => cell)
      // Columns the row does not populate stay empty.
      .filter((cell) => cell !== ""));
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.filter((cell) => cell !== value), "default output must keep the raw value").toEqual([]);
    await guard.clean();
  });
  for (const prefix of ["=", "+", "-", "@", "\t", "\r"]) {
    test(`@adversarial formula: prefix ${JSON.stringify(prefix)} is spreadsheet safe with neutralization on`, async ({ page, guard }) => {
      // No documented raw-value exception was found. CSV quoting alone does not
      // prevent spreadsheet execution; inspect parsed cells, including ZIP outputs.
      const value = `${prefix}${prefix === "\t" || prefix === "\r" ? "=" : ""}SUM(1,1)`;
      await config(page, { selectedTimezone: "UTC", minimumUsageDuration: 0,
        enableAggregates: true, processScreenUsage: false, neutralizeSpreadsheetFormulas: true });
      await setInputFile(page, "raw-file-input", "formula.csv",
        rawCsv({ app_package_name: value, application_label: value }), "text/csv");
      await processFiles(page);
      const app = parseCsv(await downloadCsv(page, "download-app-csv"));
      const zip = await downloadZipEntries(page, "download-all-zip");
      const tables = [app, ...[...zip].filter(([name]) => name.endsWith(".csv"))
        .map(([, text]) => parseCsv(text))];
      const cells = tables.flat().flatMap((row) => Object.entries(row)
        .filter(([column]) => /app_package|application_label|app_label|package_name/.test(column))
        .map(([, cell]) => cell));
      expect(cells.some((cell) => cell.includes("SUM(1,1)")), "attack survived as data").toBe(true);
      for (const cell of cells) {
        // eslint-disable-next-line no-control-regex -- leading control characters are part of the CSV-injection prefix being refused
        expect(cell, "CSV data must not become a spreadsheet formula").not.toMatch(/^[\s\u0000-\u001f]*[=+\-@]/);
      }
      await guard.clean();
    });
  }
});

type RawAttack = {
  name: string;
  bytes: () => string | Buffer | Promise<Uint8Array>;
  correct?: Record<string, string>;
  labelBytes?: number;
};
const RAW_ATTACKS: RawAttack[] = [
  { name: "empty", bytes: () => "" },
  { name: "header only", bytes: () => APP_ONLY_RAW_CSV.slice(0, APP_ONLY_RAW_CSV.indexOf("\n")) },
  { name: "UTF-8 BOM", bytes: () => `\ufeff${rawCsv()}`, correct: { app_package_name: "com.example.chat", duration_seconds: "120" } },
  { name: "UTF-16LE", bytes: () => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(rawCsv(), "utf16le")]) },
  { name: "CRLF", bytes: () => rawCsv().replace(/\n/g, "\r\n"), correct: { duration_seconds: "120" } },
  { name: "lone CR", bytes: () => rawCsv().replace(/\n/g, "\r"), correct: { duration_seconds: "120" } },
  { name: "unterminated quote", bytes: () => `${APP_ONLY_RAW_CSV.slice(0, APP_ONLY_RAW_CSV.indexOf("\n"))}\n"unterminated` },
  { name: "2 MB single line", bytes: () => rawCsv({ application_label: "X".repeat(2 * 1024 * 1024) }),
    correct: { duration_seconds: "120" }, labelBytes: 2 * 1024 * 1024 },
  { name: "duplicate header", bytes: () => {
    const rows = rawCsv().split("\n");
    return rows.map((row, index) => `${row},${index === 0 ? "app_package_name" : "com.last.column"}`).join("\n");
  }, correct: { app_package_name: "com.last.column", duration_seconds: "120" } },
  { name: "missing required columns", bytes: () => "participant_id,event_timestamp,timezone\nP01,2026-03-07 10:00:00,UTC" },
  { name: "extra columns", bytes: () => rawCsv().split("\n")
    .map((row, index) => `${row},${index === 0 ? "surprise_column" : "harmless"}`).join("\n"),
    correct: { duration_seconds: "120" } },
  // Timestamps are absolute instants and the default selected-convert re-clocks
  // every row to the selected zone, so an unknown row label is replaced, not used.
  { name: "wrong timezone", bytes: () => rawCsv({ timezone: "Mars/Olympus_Mons" }),
    correct: { duration_seconds: "120" } },
  { name: "garbage timestamp", bytes: () => rawCsv({ event_timestamp: "2026-03-07 garbage" }) },
  { name: "year 1970", bytes: () => rawCsv().replace(/2026-03-07/g, "1970-01-01"),
    correct: { duration_seconds: "120" } },
  { name: "year 9999", bytes: () => rawCsv().replace(/2026-03-07/g, "9999-12-31"),
    correct: { duration_seconds: "120" } },
  { name: "leap second", bytes: () => rawCsv({ event_timestamp: "2016-12-31 23:59:60" }) },
  { name: "PNG renamed CSV", bytes: () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 255]) },
  { name: "XLSX renamed CSV", bytes: () => createFilterWorkbookBytes() },
];

async function inspected(page: Page): Promise<void> {
  await tab(page, "Files");
  await expect(page.getByTestId("raw-file-row").first()).toBeVisible({ timeout: WAIT });
  await expect(page.getByTestId("raw-file-row").filter({ hasText: "Inspecting" })).toHaveCount(0, { timeout: WAIT });
}

test.describe("3. Malformed raw files", () => {
  for (const attack of RAW_ATTACKS) {
    test(`@adversarial raw: ${attack.name} isolates failure and processes the good batch member`,
      async ({ page, guard }) => {
        await config(page, { selectedTimezone: "UTC", minimumUsageDuration: 0,
          enablePlotting: false, enableActivityHeatmap: false, processScreenUsage: false });
        const content = await attack.bytes();
        await page.getByTestId("raw-file-input").setInputFiles([
          { name: "attacked.csv", mimeType: "text/csv", buffer: Buffer.from(content) },
          { name: "healthy.csv", mimeType: "text/csv",
            buffer: Buffer.from(rawCsv({ participant_id: "HEALTHY" })) },
        ]);
        await inspected(page);
        const attackedRow = page.getByTestId("raw-file-row").filter({ hasText: "attacked.csv" });
        const rejectedAtInspection = await attackedRow.getByTestId("raw-file-row-error").isVisible();
        if (rejectedAtInspection) {
          await expect(attackedRow.getByTestId("raw-file-row-error")).toContainText(/cannot|missing|invalid|empty/i, { timeout: WAIT });
        }
        if (rejectedAtInspection) {
          // Policy (App.tsx processing guard): a refused file blocks the batch,
          // because its missing columns would otherwise be read as blanks and
          // reported as success. The block names the file and one Remove lets
          // the healthy member run.
          await tab(page, "Process");
          await expect(page.getByTestId("process-files-button")).toBeDisabled({ timeout: WAIT });
          await expect(page.getByRole("tabpanel", { name: /Process/i }).getByText(/attacked\.csv/).first())
            .toBeVisible({ timeout: WAIT });
          await tab(page, "Files");
          await attackedRow.getByTestId("remove-file").click();
          await expect(page.getByTestId("raw-file-row")).toHaveCount(1, { timeout: WAIT });
        }
        await tab(page, "Process");
        await expect(page.getByTestId("process-files-button")).toBeEnabled({ timeout: WAIT });
        await page.getByTestId("process-files-button").click();
        await expect(page.getByTestId("process-files-button")).toBeEnabled({ timeout: WAIT });
        await expect(page.getByTestId("result-row").filter({ hasText: "healthy.csv" })).toBeVisible({ timeout: WAIT });
        const zip = await downloadZipEntries(page, "download-all-zip");
        const healthy = [...zip].find(([name]) => name === "healthy Automatically Preprocessed.csv");
        expect(healthy, "healthy output must survive the bad file").toBeDefined();
        expect(parseCsv(healthy![1]).some((row) => row.participant_id === "HEALTHY" && Number(row.duration_seconds) === 120)).toBe(true);

        const result = page.getByTestId("result-row").filter({ hasText: "attacked.csv" });
        if (await result.count()) {
          expect(rejectedAtInspection, "a refused file cannot later be reported as a success").toBe(false);
          const attacked = [...zip].find(([name]) => name === "attacked Automatically Preprocessed.csv");
          expect(attacked).toBeDefined();
          const rows = parseCsv(attacked![1]);
          expect(rows.length, "no silently empty success").toBeGreaterThan(0);
          await expect(result.locator(".result-table__num").first()).not.toHaveText("0", { timeout: WAIT });
          if (attack.correct) {
            const expected = { study_id: "study", participant_id: "P01", timezone: "UTC",
              app_package_name: "com.example.chat", ...attack.correct };
            expect(rows.some((row) => Object.entries(expected).every(([key, value]) =>
              key === "duration_seconds" ? Number(row[key]) === Number(value) : row[key] === value)),
              "accepted data must be decoded and processed correctly").toBe(true);
            if (attack.labelBytes) expect(rows.every((row) => row.application_label?.length === attack.labelBytes)).toBe(true);
            if (attack.name === "year 1970" || attack.name === "year 9999") {
              const date = attack.name === "year 1970" ? "1970-01-01" : "9999-12-31";
              expect(rows.every((row) => row.date === date), "do not wrap an extreme timestamp into another year").toBe(true);
            }
          } else {
            // These inputs cannot be interpreted as Chronicle event rows.
            expect(["empty", "header only", "UTF-16LE", "unterminated quote", "missing required columns",
              "garbage timestamp", "PNG renamed CSV", "XLSX renamed CSV"])
              .not.toContain(attack.name);
            // A parser that accepts a leap second must retain the instant.
            expect(rows.every((row) => row.event_timestamp?.includes("2016-12-31") ||
              row.event_timestamp?.includes("2017-01-01"))).toBe(true);
          }
        } else if (!rejectedAtInspection) {
          const details = page.getByRole("button", { name: "Show processing details", exact: true });
          if (await details.isVisible()) await details.click();
          const failure = page.locator(".progress-row.is-error").filter({ hasText: "attacked.csv" });
          await expect(failure).toBeVisible({ timeout: WAIT });
          await failure.locator(".progress-row__error-toggle").click();
          await expect(failure.getByTestId("error-detail")).toContainText(/invalid|missing|empty|timestamp|timezone|csv|utf|parse|decode|row|no valid/i, { timeout: WAIT });
        }
        await ready(page);
        await guard.clean();
      });
  }
});

type SettingsAttack = { name: string; json: () => string; invalid?: boolean; defaults?: boolean; count?: number };
const SETTINGS_ATTACKS: SettingsAttack[] = [
  { name: "prototype keys", json: () => '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"studyName":"settings attack"}', defaults: true },
  { name: "wrong types", json: () => JSON.stringify({ studyName: {}, processAppUsage: "false",
    minimumUsageDuration: "123", longDurationThresholdHours: "24",
    longUsageDurationThresholds: {}, longDataTimeGapThresholds: { 0: 1 },
    interactionTypesToRemove: {}, interactionTypeRemap: {}, selectedTimezone: [] }), defaults: true },
  { name: "NaN", json: () => '{"minimumUsageDuration":NaN}', invalid: true, defaults: true },
  { name: "Infinity", json: () => '{"minimumUsageDuration":1e999,"longDurationThresholdHours":1e999}', defaults: true },
  { name: "negative thresholds", json: () => JSON.stringify({ minimumUsageDuration: -10,
    longDurationThresholdHours: -1, customAppEngagementDuration: -1 }) },
  { name: "1e308 thresholds", json: () => JSON.stringify({ minimumUsageDuration: 1e308,
    longDurationThresholdHours: 1e308, customAppEngagementDuration: 1e308 }) },
  { name: "unknown enums", json: () => JSON.stringify({ timezoneHandling: "evil", enableAggregates: true, aggregateShape: "evil",
    eventRetentionSet: "evil", episodeReconstructionStrategy: "evil", sessionGroupingPolicy: "evil" }), defaults: true },
  { name: "invalid array entries", json: () => JSON.stringify({
    longUsageDurationThresholds: [-1, null, "NaN", "Infinity", {}, 1.5],
    longDataTimeGapThresholds: [-1, null, "NaN", "Infinity", {}, 1.5] }) },
  { name: "100k arrays", json: () => JSON.stringify({
    longUsageDurationThresholds: Array.from({ length: 100_000 }, () => 1),
    longDataTimeGapThresholds: Array.from({ length: 100_000 }, () => 2),
    interactionTypesToRemove: Array.from({ length: 100_000 }, () => "unused attack event"),
  }), count: 100_000 },
  { name: "invalid JSON", json: () => '{"studyName":"broken",', invalid: true, defaults: true },
];

async function assertSettings(page: Page, attack: SettingsAttack): Promise<void> {
  await tab(page, "Settings");
  await expandSectionCard(page, "optional-cleaning");
  await expandSectionCard(page, "session-detection");
  await expandSectionCard(page, "timezone");
  for (const [id, min, max, defaultValue] of [
    ["minimum-usage-duration-input", 0, 3600, DEFAULT_BROWSER_OPTIONS.minimumUsageDuration],
    ["long-duration-threshold-input", 1, 48, DEFAULT_BROWSER_OPTIONS.longDurationThresholdHours],
    ["custom-engagement-duration-input", 1, 3600, DEFAULT_BROWSER_OPTIONS.customAppEngagementDuration],
  ] as const) {
    const control = page.getByTestId(id);
    await expect(control).toBeVisible({ timeout: WAIT });
    const text = await control.inputValue();
    const value = Number(text);
    if (text && Number.isFinite(value) && value >= min && value <= max) {
      if (attack.defaults) await expect(control).toHaveValue(String(defaultValue), { timeout: WAIT });
    } else {
      // Retaining an out-of-range edit is valid only with a visible refusal.
      await expect(control.locator("xpath=ancestor::div[contains(concat(' ',normalize-space(@class),' '),' settings-field ')][1]")
        .locator(".settings-field__error")).toContainText(/between|least|most|number|integer/i, { timeout: WAIT });
    }
  }
  await expect(page.getByTestId("timezone-handling-select")).toHaveValue(DEFAULT_BROWSER_OPTIONS.timezoneHandling, { timeout: WAIT });
  await expect(page.getByTestId("toggle-processAppUsage")).toBeChecked({ timeout: WAIT });
  if (attack.name === "unknown enums") {
    await expect(page.getByTestId("select-aggregateShape")).toHaveValue(DEFAULT_BROWSER_OPTIONS.aggregateShape, { timeout: WAIT });
    for (const [id, expected] of [
      ["event-retention-set-select", DEFAULT_BROWSER_OPTIONS.eventRetentionSet],
      ["episode-reconstruction-strategy-select", DEFAULT_BROWSER_OPTIONS.episodeReconstructionStrategy],
      ["session-grouping-policy-select", DEFAULT_BROWSER_OPTIONS.sessionGroupingPolicy],
    ] as const) await expect(page.getByTestId(id)).toHaveValue(expected, { timeout: WAIT });
    // React can display the first <option> for an unknown controlled value.
    // Verify exported state too, so that visual fallback cannot mask poison.
    const exported = JSON.parse(await downloadCsv(page, "export-config-button")) as {
      currentSettings: Record<string, unknown>;
    };
    for (const key of ["timezoneHandling", "aggregateShape", "eventRetentionSet",
      "episodeReconstructionStrategy", "sessionGroupingPolicy"] as const) {
      expect(exported.currentSettings[key]).toBe(DEFAULT_BROWSER_OPTIONS[key]);
    }
  }
  for (const [id, defaults] of [
    ["long-usage-thresholds-input", DEFAULT_BROWSER_OPTIONS.longUsageDurationThresholds],
    ["long-gap-thresholds-input", DEFAULT_BROWSER_OPTIONS.longDataTimeGapThresholds],
  ] as const) {
    const control = page.getByTestId(id);
    await expect(control).toBeVisible({ timeout: WAIT });
    const shown = await control.inputValue();
    const values = shown.split(",").map((value) => Number(value.trim()));
    // Positive hours; the kernel takes fractional hours (f64), so 1.5 is valid.
    const valid = values.length > 0 && values.every((value) => Number.isFinite(value) && value > 0);
    if (!valid) {
      await expect(control.locator("xpath=ancestor::div[contains(concat(' ',normalize-space(@class),' '),' settings-field ')][1]")
        .locator("[role=alert]")).toBeVisible({ timeout: WAIT });
    } else if (attack.defaults) {
      await expect(control).toHaveValue(defaults.join(", "), { timeout: WAIT });
    } else if (attack.count) {
      // All entries are valid. Sanitizing duplicates to a shorter valid list or
      // retaining the whole list both satisfy the contract; no invented size cap.
      // A ~1.5 MB share link can exceed the browser's URL limit (Firefox), and
      // an unreadable link boots the defaults, which is also safe.
      expect(values.length).toBeLessThanOrEqual(attack.count);
      const attacked = values.every((value) => value === (id === "long-usage-thresholds-input" ? 1 : 2));
      expect(attacked || shown === defaults.join(", ")).toBe(true);
    }
  }
  expect(await page.evaluate(() => ({} as { polluted?: unknown }).polluted), "Object.prototype is clean").toBeUndefined();
  await ready(page);
}

test.describe("4. Hostile settings", () => {
  for (const attack of SETTINGS_ATTACKS) {
    for (const ingress of ["query", "Import config", "localStorage"] as const) {
      test(`@adversarial settings: ${attack.name} through ${ingress}`, async ({ page, guard }) => {
        const json = attack.json();
        if (ingress === "query") {
          if (attack.count) {
            // Keep the static-document request small: GitHub Pages can reject
            // enormous request targets before Chronicle executes. Install the
            // exact query in the browser URL before App reads location.search.
            await page.addInitScript((value) => {
              const url = new URL(location.href);
              url.searchParams.set("config", value);
              history.replaceState(null, "", url);
            }, json);
            await page.goto("./");
          } else await page.goto(`./?config=${encodeURIComponent(json)}`);
          await ready(page);
        } else {
          await gotoApp(page);
          if (ingress === "Import config") {
            const envelope = attack.invalid ? json :
              `{"schemaVersion":${SCHEMA_VERSION},"currentSettings":${json},"presets":[]}`;
            await setInputFile(page, "import-config-input", "attack.json", envelope, "application/json");
            await expect(page.getByText(attack.invalid ? /Could not import config:.*not valid JSON/i : /Config imported: active settings replaced/i))
              .toBeVisible({ timeout: WAIT });
          } else {
            // Tamper the real persisted envelope once; leave subsequent writes
            // alone so the app has the opportunity to repair it on boot.
            await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
              key: OPTIONS_KEY,
              value: attack.invalid ? json : `{"schemaVersion":${SCHEMA_VERSION},"options":${json}}`,
            });
            await page.reload();
            await ready(page);
          }
        }
        await assertSettings(page, attack);
        await guard.clean();
      });
    }
  }
});

// A rerun stamps its own datetime_of_preprocessing.
function withoutProcessingTime(csv: string): string {
  return csv.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC(?=,|$)/gm, "<processing time>");
}

const SUPPORT_ROLES = [
  { id: "filter-file-input", toggle: "useFilterFile", valid: FILTER_FILE_CSV },
  { id: "apps-forcing-screen-open-file-input", toggle: "useAppsForcingScreenOpenFile", valid: APPS_FORCING_SCREEN_OPEN_CSV },
  { id: "background-apps-file-input", toggle: "useBackgroundAppsFile", valid: "package_name\ncom.example.background" },
  { id: "app-codebook-file-input", toggle: "useAppCodebook", valid: CODEBOOK_CSV },
];

test.describe("5. Hostile companion files", () => {
  for (const role of SUPPORT_ROLES) {
    for (const attack of ["unsupported extension", "wrong schema CSV", "truncated XLSX"] as const) {
      test(`@adversarial companion: ${role.id} ${attack} preserves the workspace`, async ({ page, guard }) => {
        await config(page, { selectedTimezone: "UTC", [role.toggle]: true });
        await setInputFile(page, role.id, "original-support.csv", role.valid, "text/csv");
        await setInputFile(page, "raw-file-input", "original.csv", rawCsv(), "text/csv");
        await processFiles(page);
        const beforeCsv = await downloadCsv(page, "download-app-csv");
        const beforeClosure = inspectClosure(await downloadClosure(page));
        const beforeRow = await page.getByTestId("result-row").innerText();
        await tab(page, "Files");
        await expandSectionCard(page, "files");
        const bytes = attack === "wrong schema CSV" ? "unrelated_header\nmalformed support" :
          attack === "truncated XLSX" ? Buffer.from([0x50, 0x4b, 3, 4, 0, 0]) : Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        await setInputFile(page, role.id,
          attack === "unsupported extension" ? "attack.png" : attack === "truncated XLSX" ? "attack.xlsx" : "attack.csv",
          bytes, "application/octet-stream");
        if (attack === "unsupported extension") {
          await expect(page.getByTestId(`${role.id}-format-error`)).toContainText(/csv|xlsx|supported|format/i, { timeout: WAIT });
        } else {
          await tab(page, "Process");
          await expect(page.getByTestId("process-files-button")).toBeEnabled({ timeout: WAIT });
          await page.getByTestId("process-files-button").click();
          await expect(page.locator("#process-panel .error-text").first()).toContainText(/column|csv|xlsx|workbook|zip|invalid|support|header/i, { timeout: WAIT });
          if (attack === "wrong schema CSV") {
            // Plain words naming the needed column, not only the runtime's refusal.
            await expect(page.locator("#process-panel .error-text").first())
              .toContainText("Support file requirements are not met", { timeout: WAIT });
          }
          await expect(page.getByTestId("process-files-button")).toBeEnabled({ timeout: WAIT });
          // A failed run shows its own outcome (policy: the latest run is what is
          // displayed). The bad file must not poison the workspace: putting the
          // valid file back reproduces the original results exactly.
          await tab(page, "Files");
          await expandSectionCard(page, "files");
          await setInputFile(page, role.id, "original-support.csv", role.valid, "text/csv");
          await processFiles(page);
        }
        await tab(page, "Process");
        await expect(page.getByTestId("result-row")).toHaveText(beforeRow, { timeout: WAIT, useInnerText: true });
        // The rejected extension never runs, so its CSV must match byte for
        // byte; the recovery run is a new run with its own processing time.
        const afterCsv = await downloadCsv(page, "download-app-csv");
        if (attack === "unsupported extension") expect(afterCsv).toBe(beforeCsv);
        else expect(withoutProcessingTime(afterCsv)).toBe(withoutProcessingTime(beforeCsv));
        const after = inspectClosure(await downloadClosure(page));
        expect(after.manifest.workspaceId).toBe(beforeClosure.manifest.workspaceId);
        // The recovery run appends a root to the workspace history; with no run
        // (rejected extension) the root itself must be untouched.
        if (attack === "unsupported extension") {
          expect(after.manifest.workspaceRootDigest).toBe(beforeClosure.manifest.workspaceRootDigest);
        }
        await ready(page);
        await guard.clean();
      });
    }
  }

  for (const corruption of ["truncated", "oversized length", "wrong magic", "digest mismatch"] as const) {
    test(`@adversarial closure: ${corruption} is rejected atomically`, async ({ page, guard }) => {
      await config(page, { selectedTimezone: "UTC" });
      await setInputFile(page, "raw-file-input", "original.csv", rawCsv(), "text/csv");
      await processFiles(page);
      const archive = Buffer.from(await downloadClosure(page));
      const before = inspectClosure(archive);
      const csv = await downloadCsv(page, "download-app-csv");
      const magicLength = Buffer.byteLength(WORKFLOW_CLOSURE_MAGIC_TEXT);
      let corrupted = Buffer.from(archive);
      if (corruption === "truncated") corrupted = corrupted.subarray(0, archive.length - 1);
      if (corruption === "oversized length") corrupted.writeUInt32LE(0xffffffff, magicLength);
      if (corruption === "wrong magic") corrupted[0] = corrupted[0]! ^ 0xff;
      if (corruption === "digest mismatch") {
        const payloadStart = magicLength + 4 + archive.readUInt32LE(magicLength);
        const root = before.manifest.objects.find((object) => object.digest === before.manifest.workspaceRootDigest)!;
        expect(root.size).toBeGreaterThan(0);
        const byte = payloadStart + root.offset + Math.floor(root.size / 2);
        corrupted[byte] = corrupted[byte]! ^ 1;
      }
      await setInputFile(page, "import-workspace-file", "attack.chronicle-workspace", corrupted,
        "application/vnd.chronicle.workflow-workspace");
      await expect(page.getByTestId("workspace-backup-status")).toContainText(
        /invalid|truncat|length|bounds|magic|digest|corrupt|mismatch|unexpected|archive|manifest/i, { timeout: WAIT });
      await expect(page.getByTestId("workspace-backup-status")).not.toContainText("Verified workspace restored", { timeout: WAIT });
      await expect(page.getByTestId("import-workspace-closure")).toBeEnabled({ timeout: WAIT });
      expect(await downloadCsv(page, "download-app-csv")).toBe(csv);
      const after = inspectClosure(await downloadClosure(page));
      expect(after.manifest).toEqual(before.manifest);
      expect(after.root).toEqual(before.root);
      await ready(page);
      await guard.clean();
    });
  }
});

// Hold real Comlink requests at the browser/worker boundary. Release forwards
// the original message and transfer list; Rust, OPFS, and results are never mocked.
// A terminated worker is never resurrected by a release after cancellation.
async function holdWorkerRequests(page: Page, methods: string | string[]): Promise<void> {
  await page.evaluate((heldMethods) => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-invoked only through .call(worker, ...)
    const originalPost = Worker.prototype.postMessage;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-invoked only through .call(worker)
    const originalTerminate = Worker.prototype.terminate;
    const terminated = new WeakSet<Worker>();
    const queued: Array<{ worker: Worker; message: unknown; transfer: Transferable[] }> = [];
    const state = { held: 0, release: () => {} };
    (window as unknown as { __adversarialRace: typeof state }).__adversarialRace = state;
    Worker.prototype.postMessage = function (message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
      const call = message as { type?: string; path?: string[] } | null;
      if (call?.type === "APPLY" && call.path?.some((method) => heldMethods.includes(method))) {
        queued.push({ worker: this, message, transfer: Array.isArray(transfer) ? transfer : transfer?.transfer ?? [] });
        state.held += 1;
        return;
      }
      originalPost.call(this, message, { transfer: Array.isArray(transfer) ? transfer : transfer?.transfer ?? [] });
    };
    Worker.prototype.terminate = function () {
      terminated.add(this);
      originalTerminate.call(this);
    };
    state.release = () => {
      Worker.prototype.postMessage = originalPost;
      Worker.prototype.terminate = originalTerminate;
      for (const call of queued.splice(0)) {
        if (!terminated.has(call.worker)) originalPost.call(call.worker, call.message, { transfer: call.transfer });
      }
    };
  }, typeof methods === "string" ? [methods] : methods);
}

async function held(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __adversarialRace: { held: number } }).__adversarialRace.held,
  ), { timeout: WAIT, message: "the run is demonstrably in flight" }).toBeGreaterThan(0);
}

async function release(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { __adversarialRace: { release: () => void } }).__adversarialRace.release(),
  );
}

async function queuedRaw(page: Page): Promise<void> {
  await config(page, { selectedTimezone: "UTC", studyName: "before race",
    minimumUsageDuration: 0, enableInteractiveTimeline: true });
  // A shared-config URL deliberately suppresses last-run restoration. These
  // races test an ordinary visit/reload after configuring the workspace.
  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.delete("config");
    history.replaceState(null, "", url);
  });
  await setInputFile(page, "raw-file-input", "race.csv", rawCsv(), "text/csv");
  await tab(page, "Process");
  await expect(page.getByTestId("process-files-button")).toBeEnabled({ timeout: WAIT });
}

async function savedStudy(page: Page): Promise<string | null> {
  return page.evaluate(({ database, version, store, id }) => new Promise<string | null>((resolve, reject) => {
    const open = indexedDB.open(database, version);
    // Verification must not manufacture an app database if no run was saved.
    open.onupgradeneeded = () => open.transaction?.abort();
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction(store, "readonly");
      const read = transaction.objectStore(store).get(id);
      read.onsuccess = () => resolve((read.result as { options?: { studyName?: string } } | undefined)?.options?.studyName ?? null);
      read.onerror = () => reject(read.error ?? new Error("IndexedDB read failed"));
      transaction.oncomplete = () => db.close();
      transaction.onabort = () => db.close();
    };
  }), { database: LAST_RUN_DB_NAME, version: LAST_RUN_DB_VERSION, store: LAST_RUN_STORE_NAME, id: LAST_RUN_RECORD_ID });
}

test.describe("6. Races", () => {
  test("@adversarial race: actual double click while worker dispatch is pending commits one run", async ({ page, guard }) => {
    await queuedRaw(page);
    await holdWorkerRequests(page, "processRawCsvBytes");
    await page.getByTestId("process-files-button").dblclick();
    await held(page);
    expect(await page.evaluate(() =>
      (window as unknown as { __adversarialRace: { held: number } }).__adversarialRace.held,
    )).toBe(1);
    await release(page);
    await expect(page.getByTestId("result-row")).toHaveCount(1, { timeout: WAIT });
    await expect(page.getByTestId("process-files-button")).toBeEnabled({ timeout: WAIT });
    assertOneEpisode(parseCsv(await downloadCsv(page, "download-app-csv")));
    await guard.clean();
  });

  test("@adversarial race: Process Cancel Process cannot commit the cancelled request", async ({ page, guard }) => {
    await queuedRaw(page);
    await holdWorkerRequests(page, "processRawCsvBytes");
    await page.getByTestId("process-files-button").click();
    await held(page);
    await page.getByTestId("cancel-process-button").click();
    await expect(page.getByTestId("process-files-button")).toBeEnabled({ timeout: WAIT });
    await expect(page.getByText(/Cancelled\. Processed 0\/1 files/)).toBeVisible({ timeout: WAIT });
    await expect(page.getByTestId("result-row")).toHaveCount(0, { timeout: WAIT });
    await release(page);
    await tab(page, "Settings");
    await page.getByTestId("study-name-input").fill("after cancellation");
    await processFiles(page);
    await expect(page.getByTestId("result-row")).toHaveCount(1, { timeout: WAIT });
    const rows = parseCsv(await downloadCsv(page, "download-app-csv"));
    assertOneEpisode(rows);
    expect(rows.every((row) => row.study_name === "after cancellation")).toBe(true);
    await guard.clean();
  });

  test("@adversarial race: changing settings during a run preserves its original options", async ({ page, guard }) => {
    await queuedRaw(page);
    await holdWorkerRequests(page, "processRawCsvBytes");
    await page.getByTestId("process-files-button").click();
    await held(page);
    await tab(page, "Settings");
    await page.getByTestId("study-name-input").fill("edited while running");
    await expandSectionCard(page, "optional-cleaning");
    await page.getByTestId("minimum-usage-duration-input").fill("3600");
    await release(page);
    await tab(page, "Process");
    await expect(page.getByTestId("result-row")).toHaveCount(1, { timeout: WAIT });
    const rows = parseCsv(await downloadCsv(page, "download-app-csv"));
    expect(rows.every((row) => row.study_name === "before race")).toBe(true);
    assertOneEpisode(rows);
    await expect(page.getByTestId("results-stale-note")).toBeVisible({ timeout: WAIT });
    await tab(page, "Settings");
    await expect(page.getByTestId("study-name-input")).toHaveValue("edited while running", { timeout: WAIT });
    await guard.clean();
  });

  test("@adversarial race: deleting results during processing cannot resurrect deleted results", async ({ page, guard }) => {
    await queuedRaw(page);
    await processFiles(page);
    await expect.poll(() => savedStudy(page), { timeout: WAIT }).toBe("before race");
    await tab(page, "Settings");
    await page.getByTestId("study-name-input").fill("in flight replacement");
    await tab(page, "Process");
    await holdWorkerRequests(page, "processRawCsvBytes");
    await page.getByTestId("process-files-button").click();
    await held(page);
    const deletion = page.getByTestId("delete-results");
    if (await deletion.isEnabled()) {
      await deletion.click();
      // Delete asks first; the deletion under test is the confirmed one.
      await page.getByTestId("delete-results-dialog-confirm").click();
      await expect(page.getByTestId("result-row")).toHaveCount(0, { timeout: WAIT });
      await expect.poll(() => savedStudy(page), { timeout: WAIT }).toBeNull();
      await release(page);
      await expect(page.getByTestId("process-files-button")).toBeEnabled({ timeout: WAIT });
      // Delete is documented as removing "these results". The active run may
      // be cancelled or may publish its new output, but never the deleted run.
      if (await page.getByTestId("result-row").count()) {
        expect(parseCsv(await downloadCsv(page, "download-app-csv"))
          .every((row) => row.study_name === "in flight replacement")).toBe(true);
        await expect.poll(() => savedStudy(page), { timeout: WAIT }).toBe("in flight replacement");
      }
      const saved = await savedStudy(page);
      expect(saved === null || saved === "in flight replacement").toBe(true);
      await page.reload();
      await ready(page);
      await tab(page, "Process");
      if (saved !== null) {
        await expect(page.getByTestId("result-row")).toHaveCount(1, { timeout: WAIT });
        expect(parseCsv(await downloadCsv(page, "download-app-csv"))
          .every((row) => row.study_name === "in flight replacement")).toBe(true);
      } else await expect(page.getByTestId("result-row")).toHaveCount(0, { timeout: WAIT });
    } else {
      // Disabling deletion for the active run is also a valid product policy.
      await expect(deletion).toBeDisabled({ timeout: WAIT });
      await release(page);
      await expect(page.getByTestId("process-files-button")).toBeEnabled({ timeout: WAIT });
      await deletion.click();
      await page.getByTestId("delete-results-dialog-confirm").click();
      await expect(page.getByTestId("result-row")).toHaveCount(0, { timeout: WAIT });
      await expect.poll(() => savedStudy(page), { timeout: WAIT }).toBeNull();
    }
    await guard.clean();
  });

  test("@adversarial race: leaving mid-run asks first, and a reload leaves no stuck run", async ({ page, guard }) => {
    await queuedRaw(page);
    await holdWorkerRequests(page, "processRawCsvBytes");
    await page.getByTestId("process-files-button").click();
    await held(page);
    await expect(page.getByTestId("cancel-process-button")).toBeVisible({ timeout: WAIT });
    // The run lives only in this tab, so a reload or close must be confirmed.
    const asksBeforeLeaving = () => page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(await asksBeforeLeaving()).toBe(true);
    await page.reload();
    await ready(page);
    await tab(page, "Process");
    await expect(page.getByTestId("cancel-process-button")).toHaveCount(0, { timeout: WAIT });
    expect(await asksBeforeLeaving(), "no prompt once nothing is running").toBe(false);
    await guard.clean();
  });

  test("@adversarial race: rapid workflow switches during comparison retain Arm A and Arm B", async ({ page, guard }) => {
    await queuedRaw(page);
    await processFiles(page);
    const before = await downloadCsv(page, "download-app-csv");
    await tab(page, "View");
    await page.getByTestId("review-compare-toggle").click();
    const drawer = page.getByTestId("review-compare-drawer");
    await expect(drawer).toBeVisible({ timeout: WAIT });
    await drawer
      .locator('[data-section-id="optional-cleaning"] .section-card__header')
      .click();
    await drawer.getByTestId("minimum-usage-duration-input").fill("3600");
    await holdWorkerRequests(page, ["processReviewCsvBytes", "processPersistedReview"]);
    await page.getByTestId("review-run-comparison").click();
    await held(page);
    for (const name of ["Files", "Process", "Settings", "View", "Process", "View"] as const) await tab(page, name);
    await release(page);
    await expect(page.getByTestId("review-mcard-b")).toBeVisible({ timeout: WAIT });
    await expect(page.getByTestId("review-mcard-delta")).toBeVisible({ timeout: WAIT });
    await expect(page.getByTestId("review-day-table").locator("thead th")).toHaveText(["DAY", "A", "B", "Δ"], { timeout: WAIT });
    await expect(page.getByTestId("timeline-view-participant-title")).toHaveCount(1, { timeout: WAIT });
    await expect(page.getByTestId("review-compare-error")).toHaveCount(0, { timeout: WAIT });
    await tab(page, "Process");
    expect(await downloadCsv(page, "download-app-csv")).toBe(before);
    await guard.clean();
  });
  // Exact two-tab processing/storage case already lives in persona-multi-tab.spec.ts;
  // intentionally not registered again (no skipped test conceals a failure).
});

test.describe("7. File names", () => {
  for (const [name, pair] of [
    ["same name different bytes", ["same.csv", "same.csv"]],
    ["case only", ["Case.csv", "case.csv"]],
  ] as const) {
    test(`@adversarial filenames: ${name} is rejected without replacing the old queue`, async ({ page, guard }) => {
      await config(page, { selectedTimezone: "UTC" });
      await setInputFile(page, "raw-file-input", "original.csv", rawCsv(), "text/csv");
      await processFiles(page);
      const before = await downloadCsv(page, "download-app-csv");
      await setRawFiles(page, [
        { name: pair[0], content: rawCsv({ participant_id: "FIRST" }) },
        { name: pair[1], content: rawCsv({ participant_id: "SECOND" }) },
      ]);
      await tab(page, "Files");
      await expect(page.getByText(/Raw filenames must be unique; rename duplicates before inspection/).filter({ visible: true }).first())
        .toBeVisible({ timeout: WAIT });
      await expect(page.getByTestId("raw-file-row")).toHaveCount(1, { timeout: WAIT });
      await expect(page.getByTestId("raw-file-row")).toContainText("original.csv", { timeout: WAIT });
      await tab(page, "Process");
      expect(await downloadCsv(page, "download-app-csv")).toBe(before);
      const zip = await zipWithNames(page, "download-all-zip");
      expect(new Set(zip.names).size).toBe(zip.names.length);
      await guard.clean();
    });
  }

  for (const [attack, names] of [
    ["slash backslash dot dot", ["../escape.csv", "folder\\..\\escape.csv", "/absolute.csv"]],
    ["drive and colon", ["C:\\escape.csv", "report:alternate.csv", "..\\outside.csv"]],
    ["normalization collision", ["folder/item.csv", "folder\\item.csv"]],
    ["300 character names", [`${"L".repeat(296)}.csv`, `${"L".repeat(295)}M.csv`]],
  ] as const) {
    test(`@adversarial filenames: ${attack} downloads safe unique ZIP entries`, async ({ page, guard }) => {
      await config(page, { selectedTimezone: "UTC", processScreenUsage: false,
        enablePlotting: false, enableActivityHeatmap: false });
      await setRawFiles(page, names.map((name, index) => ({ name,
        content: rawCsv({ participant_id: `ZIP_${index}`, app_package_name: `com.zip.${index}` }) })));
      await processFiles(page);
      await expect(page.getByTestId("result-row")).toHaveCount(names.length, { timeout: WAIT });
      const { entries, names: archivedNames } = await zipWithNames(page, "download-all-zip");
      const portable = archivedNames.map((name) => name.normalize("NFC").toLowerCase());
      expect(new Set(portable).size, "no duplicate entries, including filesystem case collisions").toBe(portable.length);
      for (const name of archivedNames) {
        expect(name, "no absolute paths, drive names, ADS, or NUL").not.toMatch(/^(?:[/\\]|[a-z]:)|[\0:]/i);
        expect(name, "ZIP names use forward slashes").not.toContain("\\");
        expect(name.split("/"), "no traversal segment").not.toContain("..");
      }
      // A name that would collide on extraction is numbered: "… Preprocessed (2).csv".
      const appOutputs = [...entries].filter(([name]) => /Automatically Preprocessed(?: \(\d+\))?\.csv$/.test(name));
      expect(appOutputs).toHaveLength(names.length);
      for (let index = 0; index < names.length; index += 1) {
        expect(appOutputs.filter(([, text]) => parseCsv(text)
          .some((row) => row.participant_id === `ZIP_${index}` && row.app_package_name === `com.zip.${index}`)))
          .toHaveLength(1);
      }
      await ready(page);
      await guard.clean();
    });
  }
});
