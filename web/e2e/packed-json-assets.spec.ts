import { expect, test } from "./durabilityContext";
import { APP_ONLY_RAW_CSV } from "./fixtures";
import { assertNoExternalRequests, downloadCsv, gotoApp, installDeterministicRuntime,
  parseCsv, processFiles, setInputFile, trackExternalRequests, waitForServiceWorkerControl } from "./helpers";

test("@smoke packed registries and worker contracts stay available for a cold offline processing run", async ({ page, context }) => {
  const external = trackExternalRequests(page), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await installDeterministicRuntime(page);
  await gotoApp(page);
  await waitForServiceWorkerControl(page);
  const cachedPayloads = await page.evaluate(async () => {
    const extra = await fetch("./sw-precache-extra.json").then(response => response.json()) as string[];
    const payloads = extra.filter(url => url.endsWith(".json.pack") || url.endsWith(".wasm"));
    return Promise.all(payloads.map(async url => ({ url,
      cached: Boolean((await caches.match(new URL(url, location.href).href, { ignoreVary: true }))?.ok) })));
  });
  expect(cachedPayloads.filter(payload => payload.url.endsWith(".json.pack"))).toHaveLength(8);
  expect(cachedPayloads.filter(payload => payload.url.endsWith(".wasm"))).toHaveLength(2);
  expect(cachedPayloads.every(payload => payload.cached)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" })).toBeVisible();
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
  expect(parseCsv(await downloadCsv(page, "download-app-csv"))).toHaveLength(1);
  expect(errors).toEqual([]);
  assertNoExternalRequests(external);
});

test.describe("existing-WASM compatibility decoder", () => {
  test.use({ serviceWorkers: "block" });
  test("@smoke runs main and worker initialization when DecompressionStream is unavailable", async ({ page }) => {
    const external = trackExternalRequests(page), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => { Reflect.set(globalThis, "DecompressionStream", undefined); });
    // The durable WebKit fixture creates its own persistent context; prevent
    // registration in both fixture modes so worker interception is auditable.
    await page.addInitScript(() => {
      Object.defineProperty(navigator.serviceWorker, "register", {
        configurable: true, value: () => Promise.reject(new Error("SW blocked by compatibility decoder test")),
      });
    });
    let workersPatched = 0;
    await page.route("**/chronicle-worker-*.js", async route => {
      const response = await route.fetch();
      const headers = { ...response.headers() }; delete headers["content-length"];
      workersPatched++;
      // The production worker flattens the contract and loader into its own
      // module, so this prefix executes before the loader's top-level await.
      await route.fulfill({ response, headers, body: `globalThis.DecompressionStream = undefined;\n${await response.text()}` });
    });
    await installDeterministicRuntime(page);
    await gotoApp(page);
    await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
    await processFiles(page);
    expect(parseCsv(await downloadCsv(page, "download-app-csv"))).toHaveLength(1);
    expect(workersPatched).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    assertNoExternalRequests(external);
  });
});
