import { expect, test, type Page } from "@playwright/test";

import { SETTINGS_SCHEMA_VERSION } from "../src/lib/settingsPersistence";
import { installDeterministicRuntime } from "./helpers";

/**
 * Another tab stores settings together with a method-profile receipt that is
 * bound to them. This tab applies the options and the receipt as one change,
 * after its receipt validation has loaded; applying the options first would
 * let this tab's own save write them back without the receipt and erase it.
 */
const SETTINGS_KEY = "chronicle.processingOptions.v1";
const RECEIPT = {
  methodProfileId: "profile:paper:primary",
  sourceWorkId: "doi:paper",
  sourceMethodVariantId: "primary",
  sourceMethodVariantIds: ["primary"],
  methodProfileVersion: "v1",
  settingIds: ["setting:duration"],
  bindings: [{
    settingId: "setting:duration",
    slot: "minimum_usage_duration",
    value: 15,
    conformanceFixtureId: "fixture:paper:duration",
    conformanceResultDigest: `sha256:${"a".repeat(64)}`,
  }],
};

// The service worker would serve the validation chunk out of page.route's reach.
test.use({ serviceWorkers: "block" });

async function storedSettings(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY);
}

test("a receipt another tab stores survives while this tab loads its validator", async ({ context }) => {
  const tabA = await context.newPage();
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await tabA.route(/\/assets\/methodReceiptValidation-[^/]+\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  await installDeterministicRuntime(tabA);
  await tabA.goto("./", { waitUntil: "commit" });
  await expect(tabA.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" })).toBeVisible();

  const tabB = await context.newPage();
  await installDeterministicRuntime(tabB);
  await tabB.goto("./");
  await expect(tabB.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" })).toBeVisible();

  // Tab B's write: the options and the receipt bound to them.
  await tabB.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: SETTINGS_KEY,
    value: JSON.stringify({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      options: { minimumUsageDuration: 15 },
      methodProfileReceipts: { android: RECEIPT },
    }),
  });

  // While tab A cannot validate the receipt it applies nothing, so it writes
  // nothing that could drop the receipt.
  await tabA.waitForTimeout(1_000);
  expect(await storedSettings(tabB)).toContain(RECEIPT.methodProfileId);

  release();
  await expect(tabA.getByTestId("minimum-usage-duration-input")).toHaveValue("15");
  // Tab A's own save now carries both.
  await expect.poll(async () => storedSettings(tabB)).toContain(RECEIPT.methodProfileId);
  expect(JSON.parse((await storedSettings(tabB))!)).toMatchObject({ options: { minimumUsageDuration: 15 } });
});
