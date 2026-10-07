import type { Page } from "@playwright/test";

import {
  LAST_RUN_ARCHIVE_ID,
  LAST_RUN_DB_NAME,
  LAST_RUN_DB_VERSION,
  LAST_RUN_RECORD_ID,
  LAST_RUN_SCHEMA_VERSION,
  LAST_RUN_STORE_NAME,
} from "../src/lib/lastRunStore";
import { expect, test } from "./durabilityContext";
import { gotoApp, installDeterministicRuntime } from "./helpers";

const STORE = {
  databaseName: LAST_RUN_DB_NAME,
  databaseVersion: LAST_RUN_DB_VERSION,
  storeName: LAST_RUN_STORE_NAME,
};

async function putRecord(page: Page, record: unknown): Promise<void> {
  await page.evaluate(
    ({ databaseName, databaseVersion, storeName, value }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(databaseName, databaseVersion);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains(storeName)) {
            open.result.createObjectStore(storeName, { keyPath: "id" });
          }
        };
        open.onerror = () => reject(new Error("open failed"));
        open.onsuccess = () => {
          const tx = open.result.transaction(storeName, "readwrite");
          tx.objectStore(storeName).put(value);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(new Error("put failed"));
        };
      }),
    { ...STORE, value: record },
  );
}

async function readRecord(page: Page, id: string): Promise<Record<string, unknown> | null> {
  return page.evaluate(
    ({ databaseName, storeName, recordId }) =>
      new Promise<Record<string, unknown> | null>((resolve) => {
        const open = indexedDB.open(databaseName);
        // Reading must not create the database: an empty one at the app's
        // version, with no store, is what the next boot would then find.
        open.onupgradeneeded = () => open.transaction?.abort();
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            resolve(null);
            return;
          }
          const get = db.transaction(storeName, "readonly").objectStore(storeName).get(recordId);
          get.onsuccess = () => {
            db.close();
            resolve((get.result as Record<string, unknown> | undefined) ?? null);
          };
          get.onerror = () => resolve(null);
        };
      }),
    { ...STORE, recordId: id },
  );
}

test("@smoke a saved run this version cannot reopen is kept, reported, and cleared only on request", async ({
  page,
}) => {
  await installDeterministicRuntime(page);
  await gotoApp(page);
  const saved = {
    id: LAST_RUN_RECORD_ID,
    schemaVersion: LAST_RUN_SCHEMA_VERSION + 1,
    savedAt: "2026-09-01T00:00:00.000Z",
    options: {},
    results: [{ inputFileName: "From a newer version.csv" }],
    discoveredTimezones: [],
  };
  await putRecord(page, saved);

  await page.reload();
  const notice = page.locator('[data-testid="background-notice"][data-notice-key="last-run"]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Your last saved run could not be reopened.");
  await expect(notice).toContainText(
    `This version cannot read it (it was saved in format ${LAST_RUN_SCHEMA_VERSION + 1}`,
  );
  await expect(notice).toContainText("set aside in this browser instead of being deleted. Clear it to free the space.");

  // Moved aside whole, not deleted.
  expect(await readRecord(page, LAST_RUN_RECORD_ID)).toBeNull();
  const archived = await readRecord(page, LAST_RUN_ARCHIVE_ID);
  expect(archived?.record).toEqual(saved);

  // It is recorded for the diagnostic report too.
  await page.getByTestId("copy-diagnostic-report").click();
  await expect(page.getByTestId("diagnostic-report-text")).toHaveValue(
    /\[background\] Error: saved run archived: .*\n {5}while: Your last saved run could not be reopened\./,
  );
  await page.getByTestId("diagnostic-report-dialog-cancel").click();

  // Only the explicit clear removes it.
  await notice.getByTestId("background-notice-clear-cached-run").click();
  await page.getByTestId("clear-cached-run-dialog-confirm").click();
  await expect(notice).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText("Cleared the cached last run.");
  expect(await readRecord(page, LAST_RUN_ARCHIVE_ID)).toBeNull();

  // The cleared run is not reported again. (Other background notices, such
  // as a spill-sweep failure, are not this test's claim.)
  await page.reload();
  await expect(page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" })).toBeVisible();
  await expect(page.locator('[data-testid="background-notice"][data-notice-key="last-run"]')).toHaveCount(0);
});
