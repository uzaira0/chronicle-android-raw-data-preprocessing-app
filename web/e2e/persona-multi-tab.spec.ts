import type { Page } from "@playwright/test";

import {
  LAST_RUN_DB_NAME,
  LAST_RUN_DB_VERSION,
  LAST_RUN_RECORD_ID,
  LAST_RUN_STORE_NAME,
} from "../src/lib/lastRunStore";
import { expect, test } from "./durabilityContext";
import { APP_ONLY_RAW_CSV } from "./fixtures";
import {
  gotoApp,
  installDeterministicRuntime,
  setInputFile,
  RESULT_PANEL_TIMEOUT_MS,
} from "./helpers";

/**
 * Persona 8 — Multi-tab sleuth.
 *
 * The app open in two tabs at once. Settings and presets live in localStorage
 * and each tab listens for the other's `storage` events: a settings write
 * merges into the other tab only the options it changed, and a preset save
 * reads the stored library first, so neither tab silently undoes the other's
 * edit. The last run is a single keyed IndexedDB record, never duplicated or
 * torn; each tab's in-memory run is independently correct.
 */
test.describe.configure({ mode: "serial" });

async function readLastRun(page: Page): Promise<{ results?: unknown[] } | null> {
  return page.evaluate(
    ({ databaseName, databaseVersion, recordId, storeName }) =>
      new Promise<{ results?: unknown[] } | null>((resolve) => {
        const open = indexedDB.open(databaseName, databaseVersion);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains(storeName)) {
            open.result.createObjectStore(storeName, { keyPath: "id" });
          }
        };
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          try {
            const tx = open.result.transaction(storeName, "readonly");
            const get = tx.objectStore(storeName).get(recordId);
            get.onsuccess = () => resolve(get.result as { results?: unknown[] } | null);
            get.onerror = () => resolve(null);
          } catch {
            resolve(null);
          }
        };
      }),
    {
      databaseName: LAST_RUN_DB_NAME,
      databaseVersion: LAST_RUN_DB_VERSION,
      recordId: LAST_RUN_RECORD_ID,
      storeName: LAST_RUN_STORE_NAME,
    },
  );
}

test("a settings edit in one tab reaches the other tab and neither tab undoes the other's", async ({
  context,
}) => {
  const tab1 = await context.newPage();
  await installDeterministicRuntime(tab1);
  await gotoApp(tab1);
  const tab2 = await context.newPage();
  await installDeterministicRuntime(tab2);
  await gotoApp(tab2);

  const errors: string[] = [];
  for (const tab of [tab1, tab2]) tab.on("pageerror", (e) => errors.push(String(e)));

  await expect(tab2.getByTestId("toggle-enableAggregates")).not.toBeChecked();
  await tab1.getByTestId("study-name-input").fill("TAB-A-STUDY");
  // Tab 2 sees tab 1's edit without a reload.
  await expect(tab2.getByTestId("study-name-input")).toHaveValue("TAB-A-STUDY");

  // Tab 2 changes a different option; its write carries tab 1's study name
  // instead of the stale copy it booted with, and tab 1 picks the change up.
  await tab2.getByTestId("toggle-enableAggregates").check();
  await expect(tab1.getByTestId("toggle-enableAggregates")).toBeChecked();
  await expect(tab1.getByTestId("study-name-input")).toHaveValue("TAB-A-STUDY");

  // gotoApp navigates, so it is the reload: a reload followed by a second
  // navigation aborts the first boot's bundled-asset fetches mid-flight.
  for (const tab of [tab1, tab2]) {
    await gotoApp(tab);
    await expect(tab.getByTestId("study-name-input")).toHaveValue("TAB-A-STUDY");
    await expect(tab.getByTestId("toggle-enableAggregates")).toBeChecked();
  }
  expect(errors).toEqual([]);

  await tab1.close();
  await tab2.close();
});

test("presets saved in two tabs both survive", async ({ context }) => {
  const tab1 = await context.newPage();
  await installDeterministicRuntime(tab1);
  await gotoApp(tab1);
  const tab2 = await context.newPage();
  await installDeterministicRuntime(tab2);
  await gotoApp(tab2);

  const errors: string[] = [];
  for (const tab of [tab1, tab2]) tab.on("pageerror", (e) => errors.push(String(e)));

  await tab1.getByTestId("preset-name-input").fill("Preset from tab A");
  await tab1.getByTestId("save-preset-button").click();
  await expect(tab1.getByTestId("preset-list")).toContainText("Preset from tab A");
  // Tab 2 booted with an empty library; its save must not replace tab 1's.
  await tab2.getByTestId("preset-name-input").fill("Preset from tab B");
  await tab2.getByTestId("save-preset-button").click();

  for (const tab of [tab1, tab2]) {
    await expect(tab.getByTestId("preset-list")).toContainText("Preset from tab A");
    await expect(tab.getByTestId("preset-list")).toContainText("Preset from tab B");
  }
  await gotoApp(tab1);
  await expect(tab1.getByTestId("preset-list")).toContainText("Preset from tab A");
  await expect(tab1.getByTestId("preset-list")).toContainText("Preset from tab B");
  expect(errors).toEqual([]);

  await tab1.close();
  await tab2.close();
});

test("@durability two tabs processing at once leave a single, valid cached run", async ({
  context,
}) => {
  const tab1 = await context.newPage();
  const tab2 = await context.newPage();
  const errors: string[] = [];
  const responses5xx: string[] = [];
  for (const tab of [tab1, tab2]) {
    tab.on("pageerror", (e) => errors.push(String(e)));
    tab.on("response", (r) => {
      if (Math.floor(r.status() / 100) === 5) responses5xx.push(`${r.status()} ${r.url()}`);
    });
    await installDeterministicRuntime(tab);
    await gotoApp(tab);
    await setInputFile(tab, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  }

  // Kick both runs off as close to simultaneously as possible.
  await Promise.all([
    (async () => {
      await tab1.getByRole("tab", { name: /Process/i }).click();
      await tab1.getByTestId("process-files-button").click();
    })(),
    (async () => {
      await tab2.getByRole("tab", { name: /Process/i }).click();
      await tab2.getByTestId("process-files-button").click();
    })(),
  ]);

  await expect(tab1.getByTestId("result-panel").first()).toBeVisible({ timeout: RESULT_PANEL_TIMEOUT_MS });
  await expect(tab2.getByTestId("result-panel").first()).toBeVisible({ timeout: RESULT_PANEL_TIMEOUT_MS });
  await expect(tab1.getByTestId("result-panel")).toContainText("1 file processed");
  await expect(tab2.getByTestId("result-panel")).toContainText("1 file processed");

  // The shared cache is a single keyed record — never duplicated or torn.
  await expect
    .poll(async () => {
      const record: { results?: unknown[] } | null = await readLastRun(tab1);
      return record?.results?.length ?? 0;
    })
    .toBe(1);

  expect(errors).toEqual([]);
  expect(responses5xx).toEqual([]);

  await tab1.close();
  await tab2.close();
});
