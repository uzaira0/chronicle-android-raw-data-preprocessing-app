import { expect, test } from "./durabilityContext";
import { APP_ONLY_RAW_CSV } from "./fixtures";
import { gotoApp, installDeterministicRuntime, setInputFile } from "./helpers";

/**
 * The durable-workspace capability gate, per engine.
 *
 * The app must know whether it can write, read back and verify a file in
 * origin-private storage — from the main thread AND from the Rust worker that
 * performs every real workspace write. The two halves are denied by different
 * mechanisms, because they run in different global scopes:
 *
 *  - where the capability is genuinely missing (Playwright's ephemeral WebKit,
 *    which is Safari private-browsing behaviour), BOTH scopes are denied at
 *    once and the banner appears. WebKit rejects `getDirectory()` there with
 *    `UnknownError` ("The operation failed for an unknown transient reason")
 *    on every request. Until 2026-10-03 the classifier read that as
 *    indeterminate and REFUSED the run, locking private-browsing users out;
 *    it now asks twice, and two pre-open `UnknownError`s degrade to ephemeral.
 *    "a browser that never grants storage still completes a run" below is the
 *    real-engine proof;
 *  - where it is present, the banner NEVER appears and processing works;
 *  - the main-thread half is denied one capability at a time with
 *    `page.addInitScript`, which reaches documents and frames ONLY;
 *  - the worker half is denied by rewriting the worker's own module source in
 *    flight (the "only the worker is denied durable storage" test below), the
 *    only way to reach a `DedicatedWorkerGlobalScope` — `addInitScript` never
 *    runs there. That test leaves the main thread healthy, so the worker arm is
 *    the only thing that can produce the banner it asserts.
 *
 * WHAT CHANGED (2026-08-27, sweep-4 item 10, revised the same day). The gate
 * used to refuse to process at all; it now degrades ONLY where the context is
 * structurally unable to persist (the OPFS API absent, or a SecurityError /
 * NotSupportedError / TypeError — the private-browsing class). A failure that
 * may be transient — an exhausted quota, a worker that restarted, an error the
 * classifier does not recognise — keeps the original hard refusal, because
 * degrading there would silently drop persistence for a browser that has it.
 * The two arms are asserted separately below.
 *
 * The original note: the Rust runtime has a complete non-persisted branch — with
 * `persistRustWorkspace` false it skips root recovery and the root commit,
 * keeps every artifact in memory rather than serving it from an OPFS locator,
 * renders plots and the interactive timeline immediately instead of lazily from
 * a pinned root, and carries a workspace root digest forward in-process — so a
 * blanket refusal locked Safari private-browsing users out of a run the engine
 * can perform. The banner now states what ephemeral mode costs and how to
 * restore durability, and Process stays available. Persistence itself is
 * unchanged and still fail-closed wherever OPFS IS usable: the verified
 * round-trip probe, the digest-verified closure, and the atomic root commit all
 * still gate the persisted path.
 *
 * Every test tagged @no-storage carries the ONLY tag the ephemeral `webkit`
 * project runs. The worker-only denial test is deliberately NOT tagged
 * @no-storage: it requires a HEALTHY main thread, which the ephemeral WebKit
 * context cannot provide, so it runs on chromium, firefox and webkit-durable.
 */

const BANNER = "workspace-unavailable";

/** Is origin-private storage actually usable in this project's context? */
async function opfsAvailable(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle("chronicle-e2e-availability", {
        create: true,
      });
      const handle = await directory.getFileHandle("probe.bin", { create: true });
      const writable = await handle.createWritable();
      await writable.write(new Uint8Array([1]));
      await writable.close();
      return (await (await handle.getFile()).arrayBuffer()).byteLength === 1;
    } catch {
      return false;
    }
  });
}

test("@smoke @no-storage the durable-workspace banner matches what this engine can actually do", async ({
  page,
}) => {
  await installDeterministicRuntime(page);
  await gotoApp(page);
  const available = await opfsAvailable(page);
  const banner = page.getByTestId(BANNER);

  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByRole("tab", { name: /Process/i }).click();

  if (available) {
    // A passing engine must never show the refusal. The queued file rules out
    // the unrelated "nothing to process" reason for a disabled button, and the
    // wait covers the boot probe's main-thread + worker round-trip.
    await expect(page.getByTestId("process-files-button")).toBeEnabled({
      timeout: 20_000,
    });
    await expect(banner).toBeHidden();
    return;
  }

  await expect(banner).toBeVisible({ timeout: 20_000 });
  // The message names a cause instead of failing silently.
  await expect(banner).toContainText(/Origin-private file storage|Web Locks API/);
  // Which arm applies depends on WHY this engine cannot persist, and only the
  // engine knows that: structural unsupport (the private-browsing shape)
  // degrades to ephemeral, while a failure that might be transient keeps the
  // hard refusal. Assert whichever arm the app chose, in full — never assert
  // "one of two states" loosely, and never let a missing banner pass.
  const ephemeral = await banner
    .getByText("Running without durable local storage")
    .count();
  if (ephemeral > 0) {
    // It states what is lost and how to get it back, not just that something is
    // wrong — the old banner said only "processing is disabled".
    await expect(banner).toContainText("gone when it is closed or reloaded");
    await expect(banner).toContainText(/leave private\/incognito browsing/);
    // The control state agrees with the message: the run is still available,
    // and is labelled ephemeral rather than silently behaving like a durable
    // one.
    await expect(page.getByTestId("process-files-button")).toBeEnabled();
    await expect(page.getByTestId("ephemeral-workspace-note")).toBeVisible();
  } else {
    await expect(banner).toContainText("Durable local processing is unavailable");
    await expect(banner).toContainText("This may be temporary");
    await expect(page.getByTestId("process-files-button")).toBeDisabled();
    await expect(page.getByTestId("durable-workspace-block")).toBeVisible();
  }
  // Nothing ran on its own.
  await expect(page.getByTestId("result-panel")).toHaveCount(0);
});

/**
 * Deny one capability at a time in a context that otherwise has all of them, so
 * every engine — not only the one that happens to lack OPFS — proves the gate.
 *
 * These denials are installed with `page.addInitScript`, which runs in every
 * document and frame and NOWHERE else. It does NOT reach the Rust worker: a
 * `DedicatedWorkerGlobalScope` gets no init scripts from Playwright, so the
 * worker below keeps a fully working `navigator.storage`. Each case therefore
 * proves the MAIN-THREAD arm of the gate — `probeDurableWorkspaceCapability`
 * in App.tsx short-circuits on an unavailable main thread, so the worker arm
 * never decides these assertions. The worker arm is proved separately by
 * the "only the worker is denied durable storage" test, which rewrites the
 * worker's module source instead.
 *
 * Storage denials patch `StorageManager.prototype`, never the
 * `navigator.storage` instance. WebKit garbage-collects the StorageManager and
 * LockManager JS wrappers and hands out fresh ones, so a property defined on the
 * instance silently disappears (measured in webkit-durable: an own
 * `getDirectory` defined by the init script was gone by the first
 * `page.evaluate` after load, while the same property on `navigator` itself or
 * on the prototype survived; holding a reference to the instance kept it). The
 * app's boot probe sometimes ran before the collection and sometimes after, so
 * the banner and the run's re-probe disagreed. A real private-browsing
 * `getDirectory` rejection lives in the engine and is unaffected by this.
 */
const DENIALS = [
  {
    name: "origin-private storage cannot be opened",
    // A SecurityError from `getDirectory` is the private-browsing shape: the
    // context structurally cannot persist, and no amount of retrying changes
    // that, so the run degrades rather than being refused.
    mode: "ephemeral",
    expected: /could not be opened/,
    install: () => {
      Object.defineProperty(StorageManager.prototype, "getDirectory", {
        configurable: true,
        value: () =>
          Promise.reject(new DOMException("denied by test", "SecurityError")),
      });
    },
  },
  {
    name: "origin-private storage refuses with UnknownError every time",
    // WebKit's private-browsing rejection, reproduced on every engine. One
    // UnknownError could be transient; the same refusal on the retry is the
    // private-browsing verdict, so the run degrades instead of being refused.
    mode: "ephemeral",
    expected: /refused again when asked a second time/,
    install: () => {
      Object.defineProperty(StorageManager.prototype, "getDirectory", {
        configurable: true,
        value: () =>
          Promise.reject(
            new DOMException(
              "The operation failed for an unknown transient reason",
              "UnknownError",
            ),
          ),
      });
    },
  },
  {
    name: "origin-private storage is open but not writable",
    // A QuotaExceededError is NOT structural unsupport — it is a full disk or
    // a worker that restarted, and it can clear. Degrading to ephemeral here
    // would silently drop persistence for a durable browser, so the original
    // hard refusal stands and the notice says how to recover.
    mode: "refusal",
    expected: /not writable/,
    install: () => {
      // Reflect.get, not a property read: the method is re-bound per call below.
      const original = Reflect.get(StorageManager.prototype, "getDirectory");
      Object.defineProperty(StorageManager.prototype, "getDirectory", {
        configurable: true,
        value: async function (this: StorageManager) {
          const root = await original.call(this);
          return new Proxy(root, {
            get(target, property, receiver) {
              if (property === "getDirectoryHandle") {
                return async (name: string, options?: FileSystemGetDirectoryOptions) => {
                  const directory = await target.getDirectoryHandle(name, options);
                  return new Proxy(directory, {
                    get(inner, innerProperty, innerReceiver) {
                      if (innerProperty === "getFileHandle") {
                        return () =>
                          Promise.reject(
                            new DOMException("denied by test", "QuotaExceededError"),
                          );
                      }
                      const value: unknown = Reflect.get(inner, innerProperty, innerReceiver);
                      return typeof value === "function"
                        ? (value as (...args: unknown[]) => unknown).bind(inner)
                        : value;
                    },
                  });
                };
              }
              const value: unknown = Reflect.get(target, property, receiver);
              return typeof value === "function"
                ? (value as (...args: unknown[]) => unknown).bind(target)
                : value;
            },
          });
        },
      });
    },
  },
  {
    name: "the Web Locks API is missing",
    // No Web Locks means the workspace cannot be serialized at all in this
    // context; like a missing OPFS API this is structural, not transient.
    mode: "ephemeral",
    expected: /Web Locks API/,
    install: () => {
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: undefined,
      });
    },
  },
] as const;

for (const denial of DENIALS) {
  const outcome =
    denial.mode === "ephemeral"
      ? "degrades to ephemeral mode"
      : "is refused, not silently downgraded";
  test(`@no-storage processing ${outcome} when ${denial.name}`, async ({ page }) => {
    await installDeterministicRuntime(page);
    await gotoApp(page);
    // Measure the engine's real capability FIRST, before the denial exists.
    // Where a context already has no origin-private storage (Playwright's
    // ephemeral WebKit), the test above is the real evidence and a synthetic
    // denial could only assert a reason the engine has already overruled.
    test.skip(
      !(await opfsAvailable(page)),
      "this context has no origin-private storage to deny",
    );

    await page.addInitScript(denial.install);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
    ).toBeVisible();

    const banner = page.getByTestId(BANNER);
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText(denial.expected);

    await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
    await page.getByRole("tab", { name: /Process/i }).click();

    if (denial.mode === "ephemeral") {
      // Degraded, not refused, and visibly labelled as such.
      await expect(banner).toContainText(
        "Running without durable local storage",
      );
      await expect(page.getByTestId("process-files-button")).toBeEnabled();
      await expect(page.getByTestId("process-files-button")).toHaveText(
        /ephemeral/i,
      );
      await expect(page.getByTestId("durable-workspace-block")).toHaveCount(0);
    } else {
      // A failure that may be temporary keeps the ORIGINAL hard refusal: a
      // durable browser must not lose persistence because one write failed
      // once. The banner says it may be temporary and how to recover.
      await expect(banner).toContainText(
        "Durable local processing is unavailable",
      );
      await expect(banner).toContainText("This may be temporary");
      await expect(banner).toContainText("reload and try again");
      await expect(page.getByTestId("process-files-button")).toBeDisabled();
      await expect(page.getByTestId("durable-workspace-block")).toBeVisible();
      await expect(page.getByTestId("ephemeral-workspace-note")).toHaveCount(0);
    }
    // Nothing ran on its own: no half-run, no result claiming success.
    await expect(page.getByTestId("result-panel")).toHaveCount(0);
  });
}

/**
 * A string that can only have come from the worker's own global scope.
 *
 * It is injected into the worker module source and nowhere else, so seeing it in
 * the banner is proof that `probeWorkerWorkspaceCapability()` — not
 * `probeOpfsCapability()` on the main thread — produced the refusal. The reason
 * reaches the banner through `capabilityErrorText`, which returns
 * `error.message` verbatim.
 */
const WORKER_DENIAL_MARKER =
  "denied inside the Chronicle worker by the durability gate test";

/**
 * Prepended to the worker's module source. Module imports are hoisted above it,
 * but `openOpfsRoot()` reads `navigator.storage.getDirectory` at call time — long
 * after this runs — so replacing the method is enough. It is replaced on
 * `StorageManager.prototype` for the reason given above `DENIALS`: WebKit drops
 * properties defined on the collectable `navigator.storage` wrapper. This is the
 * same shape as the main-thread `DENIALS[0]`, applied in the scope
 * `addInitScript` cannot reach.
 */
const WORKER_STORAGE_DENIAL = `
Object.defineProperty(StorageManager.prototype, "getDirectory", {
  configurable: true,
  value: () =>
    Promise.reject(
      new DOMException(${JSON.stringify(WORKER_DENIAL_MARKER)}, "SecurityError"),
    ),
});
`;

/**
 * The worker half of the gate, with the main thread deliberately left HEALTHY.
 *
 * This is the arm the `addInitScript` denials above cannot reach and cannot
 * decide: App.tsx's `probeDurableWorkspaceCapability` returns the main-thread
 * result the moment it is `unavailable`, so as long as the main thread is denied
 * the worker's answer is discarded. Deleting the worker probe from that function
 * makes this test — and only this test — go red.
 *
 * Not tagged @no-storage: it needs an engine that DOES grant origin-private
 * storage on the main thread, which the ephemeral `webkit` project is not.
 */
test("processing degrades to ephemeral mode when only the worker is denied durable storage", async ({
  page,
}) => {
  // The service worker in public/sw.js is cache-first for every same-origin
  // subresource and precaches the worker chunk from sw-precache-extra.json. Once
  // it controls the page the worker module is served from the Cache API and
  // makes no network request at all, so there is nothing for `page.route` to
  // rewrite — measured: the interception fired on some runs and not others,
  // purely on whether the worker was constructed before the service worker
  // claimed the client. The offline cache is irrelevant to the durability gate,
  // so this test keeps it out of the way and the worker module always comes off
  // the network. `register()` rejects rather than being removed, because
  // main.tsx guards on `"serviceWorker" in navigator` and already catches a
  // failed registration.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: () =>
          Promise.reject(new Error("service worker disabled by the durability test")),
        addEventListener: () => {},
        controller: null,
        ready: new Promise(() => {}),
      },
    });
  });

  let patchedWorkerScripts = 0;
  // Playwright's `addInitScript` reaches documents and frames only — a dedicated
  // worker never receives it. Rewriting the module the worker is constructed
  // from is the interception point that does reach it.
  await page.route("**/chronicle-worker*", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const headers = { ...response.headers() };
    // The body grows; a stale Content-Length truncates the module.
    delete headers["content-length"];
    patchedWorkerScripts += 1;
    await route.fulfill({
      status: response.status(),
      headers,
      body: `${WORKER_STORAGE_DENIAL}${source}`,
    });
  });

  await installDeterministicRuntime(page);
  await gotoApp(page);

  // If nothing was rewritten, the worker ran unpatched and any pass below would
  // be vacuous. Fail loudly rather than assert against an unmodified worker.
  expect(
    patchedWorkerScripts,
    "the worker module request was never intercepted, so the worker was not denied",
  ).toBeGreaterThan(0);
  // The main thread must be genuinely healthy, or this proves nothing about the
  // worker: an unavailable main thread short-circuits the gate before the
  // worker's result is even consulted.
  expect(
    await opfsAvailable(page),
    "the main thread must keep working origin-private storage for this test to isolate the worker arm",
  ).toBe(true);

  const banner = page.getByTestId(BANNER);
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText("Running without durable local storage");
  // The reason names the worker's failure, not a main-thread one.
  await expect(banner).toContainText(WORKER_DENIAL_MARKER);

  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByRole("tab", { name: /Process/i }).click();
  await expect(page.getByTestId("process-files-button")).toBeEnabled();
  await expect(page.getByTestId("ephemeral-workspace-note")).toBeVisible();
  // Nothing ran on its own.
  await expect(page.getByTestId("result-panel")).toHaveCount(0);
});

/**
 * The real-engine half of the private-browsing fix. Where the browser itself
 * grants no origin-private storage at all — Playwright's ephemeral WebKit, the
 * Safari private-browsing shape, on the main thread AND in the worker — the app
 * must take the ephemeral arm and finish a real run. No synthetic denial: this
 * is WebKit's own `UnknownError`, twice. Engines that do grant storage skip;
 * the `DENIALS` UnknownError case covers them.
 */
test("@smoke @no-storage a browser that never grants storage still completes a run", async ({
  page,
}) => {
  await installDeterministicRuntime(page);
  await gotoApp(page);
  test.skip(
    await opfsAvailable(page),
    "this engine grants origin-private storage; the synthetic denial covers it",
  );

  const banner = page.getByTestId(BANNER);
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText("Running without durable local storage");
  await expect(banner).toContainText("gone when it is closed or reloaded");

  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByRole("tab", { name: /Process/i }).click();
  await expect(page.getByTestId("ephemeral-workspace-note")).toBeVisible();
  await expect(page.getByTestId("process-files-button")).toBeEnabled();
  await page.getByTestId("process-files-button").click();

  await expect(page.getByTestId("result-panel").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId("result-file-table").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId("error-detail")).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText(
    /not saved for reload|Download them before closing/,
  );
  // Backups read and write the storage this browser withholds: no export for
  // the unsaved run, and import is disabled with the reason shown.
  await expect(page.getByTestId("export-workspace-closure")).toHaveCount(0);
  await expect(page.getByTestId("import-workspace-closure")).toBeDisabled();
  await expect(page.getByTestId("workspace-backup-unavailable")).toBeVisible();
});

/**
 * The whole point of the 2026-08-27 change: a run the engine can perform is
 * performed. Origin-private storage is denied on the main thread only (the
 * shape of `DENIALS[0]`), which short-circuits `probeDurableWorkspaceCapability`
 * exactly as Safari private browsing does, and the batch still produces real,
 * downloadable outputs on the runtime's non-persisted branch.
 *
 * Deleting the ephemeral fallback makes this test — and only this test — go red
 * with a disabled Process button.
 */
test("@smoke a denied durable workspace still produces a complete run in ephemeral mode", async ({
  page,
}) => {
  await installDeterministicRuntime(page);
  await gotoApp(page);
  test.skip(
    !(await opfsAvailable(page)),
    "this context has no origin-private storage to deny",
  );

  // On the prototype, not the instance: see the note above `DENIALS`.
  await page.addInitScript(() => {
    Object.defineProperty(StorageManager.prototype, "getDirectory", {
      configurable: true,
      value: () =>
        Promise.reject(new DOMException("denied by test", "SecurityError")),
    });
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
  ).toBeVisible();
  await expect(page.getByTestId(BANNER)).toBeVisible({ timeout: 20_000 });

  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByRole("tab", { name: /Process/i }).click();
  await expect(page.getByTestId("process-files-button")).toBeEnabled();
  await page.getByTestId("process-files-button").click();

  // A real result, not merely an enabled button.
  await expect(page.getByTestId("result-panel").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId("result-file-table").first()).toBeVisible({
    timeout: 60_000,
  });
  // And no failure row hiding behind the panel.
  await expect(page.getByTestId("error-detail")).toHaveCount(0);

  // The run is honest about what it is NOT: an ephemeral batch's outputs are
  // in-tab blobs, so it must not be written as the restorable "last run". The
  // record used to be saved unconditionally and restored after a reload as a
  // complete-looking run whose every download was dead.
  await expect(page.locator(".toast")).toContainText(
    /not saved for reload|Download them before closing/,
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
  ).toBeVisible();
  await expect(page.getByTestId(BANNER)).toBeVisible({ timeout: 20_000 });
  // Nothing was restored. The UI negations below are racy on their own (the
  // restore effect is async post-boot, so an absent toast proves nothing), so
  // the deterministic assertion reads the last-run store directly: a wrongly
  // reintroduced save would have committed at run completion, long before this
  // reload, so an empty store here is conclusive.
  const lastRunRecord = await page.evaluate(async () => {
    const open = indexedDB.open("chronicle-workflow-last-run-v1");
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(null);
      open.onupgradeneeded = () => {
        // A fresh DB means nothing was ever saved; let it settle and resolve.
      };
    });
    if (db === null) return null;
    if (!db.objectStoreNames.contains("lastRun")) {
      db.close();
      return null;
    }
    const request = db.transaction("lastRun", "readonly").objectStore("lastRun").get("last");
    const record = await new Promise<unknown>((resolve) => {
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    });
    db.close();
    return record;
  });
  expect(lastRunRecord).toBeNull();
  await expect(page.getByTestId("result-panel")).toHaveCount(0);
  await expect(page.locator(".toast")).not.toContainText(
    /Last processed results restored/,
  );
});
