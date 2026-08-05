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
} from "./helpers";

/**
 * Persona 8 — Multi-tab sleuth.
 *
 * The app open in two tabs at once. It uses localStorage (settings) and a single
 * keyed IndexedDB record (last run) — there is no BroadcastChannel/storage-event
 * live sync, so the contract is: concurrent writes are last-write-wins and
 * reconcile on reload, never corrupt; the shared cached run is a single record,
 * never duplicated or torn; each tab's in-memory run is independently correct.
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

test("concurrent settings edits in two tabs reconcile to a valid value, never corrupt", async ({
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

  await tab1.getByTestId("study-name-input").fill("TAB-A-STUDY");
  await tab2.getByTestId("study-name-input").fill("TAB-B-STUDY");
  // Let both persistence writes settle.
  await tab1.waitForTimeout(200);

  await tab1.reload();
  await installDeterministicRuntime(tab1);
  await gotoApp(tab1);
  const restored = await tab1.getByTestId("study-name-input").inputValue();
  // Last-write-wins: it's one of the two real values, not blank or garbled.
  expect(["TAB-A-STUDY", "TAB-B-STUDY"]).toContain(restored);
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

  await expect(tab1.getByTestId("result-panel").first()).toBeVisible({ timeout: 20_000 });
  await expect(tab2.getByTestId("result-panel").first()).toBeVisible({ timeout: 20_000 });
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
