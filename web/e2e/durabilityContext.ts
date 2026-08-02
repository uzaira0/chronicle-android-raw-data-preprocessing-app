import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

import {
  chromium,
  firefox,
  test as base,
  webkit,
  type BrowserContext,
  type BrowserType,
  type Page,
} from "@playwright/test";

/**
 * Durability test context.
 *
 * Playwright's default contexts are ephemeral. Chromium and Firefox still grant
 * OPFS there, but WebKit rejects `navigator.storage.getDirectory()` with
 * `UnknownError: The operation failed for an unknown transient reason` in an
 * ephemeral context — measured on WebKit 26.4, main thread AND dedicated
 * worker. The same WebKit build grants OPFS (getDirectory + createWritable +
 * verified read-back) as soon as it runs against an on-disk profile, so the
 * denial is a property of the harness's context, not of the engine.
 *
 * `durableProfile` therefore swaps in a `launchPersistentContext`, which is the
 * only way to exercise the OPFS durability layer on WebKit under automation.
 *
 * Two measured WebKit facts shape the rest of this file:
 *  - A fresh `userDataDir` does NOT get a fresh OPFS. Playwright's WebKit keeps
 *    origin-private storage outside the profile directory, so state leaks
 *    between persistent contexts. Every durable context is therefore wiped
 *    explicitly on entry rather than trusting profile isolation.
 *  - `context.browser()` is non-null for a persistent context, but a context
 *    made from that browser is ephemeral again — so `browser.newContext()` is
 *    not a usable "fresh origin" on WebKit. `freshOriginPage` is.
 *
 * Traces, video and screenshots come from Playwright's own `context` fixture
 * and are not captured for the persistent branch.
 */

const BROWSER_TYPES: Record<string, BrowserType> = {
  chromium,
  firefox,
  webkit,
};

/** Profiles live inside the checkout (web/.tmp is gitignored), never in a temp dir. */
const PROFILE_ROOT = path.resolve(process.cwd(), ".tmp/durable-profiles");

/**
 * Reach the app's origin WITHOUT starting the app. Loading index.html boots the
 * runtime, which immediately probes durable storage; wiping OPFS underneath an
 * in-flight probe write makes WebKit reject `writable.close()` with "Cannot
 * close a writable stream that is closed or errored" and leaves the app showing
 * a false durable-storage failure. A static text document has the same origin
 * and no application code.
 */
async function gotoOriginWithoutBooting(page: Page): Promise<void> {
  await page.goto("/robots.txt");
}

/** Delete every origin-scoped store the app writes: OPFS, IndexedDB, Web Storage. */
export async function wipeOriginStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const names: string[] = [];
      for await (const name of (
        root as unknown as { keys(): AsyncIterableIterator<string> }
      ).keys()) {
        names.push(name);
      }
      for (const name of names) {
        await root.removeEntry(name, { recursive: true }).catch(() => undefined);
      }
    } catch {
      // An origin with no OPFS has nothing to wipe.
    }
    for (const name of ["chronicle-last-run", "chronicle-projects"]) {
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    }
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // Storage can be denied outright; the caller only needs a clean origin.
    }
  });
}

export type DurabilityFixtures = {
  /** Set by the project. False keeps Playwright's own ephemeral context. */
  durableProfile: boolean;
  /**
   * A page whose origin holds no prior Chronicle workspace — the "second
   * machine" case for closure import. Real context isolation where the engine
   * provides it, an explicit origin wipe on WebKit where it does not.
   */
  freshOriginPage: () => Promise<Page>;
};

export const test = base.extend<DurabilityFixtures>({
  durableProfile: [false, { option: true }],

  context: async ({ context, durableProfile, browserName }, use) => {
    if (!durableProfile) {
      await use(context);
      return;
    }
    const browserType = BROWSER_TYPES[browserName];
    if (!browserType) {
      throw new Error(`no persistent launcher for browser "${browserName}"`);
    }
    await mkdir(PROFILE_ROOT, { recursive: true });
    const profile = await mkdtemp(path.join(PROFILE_ROOT, `${browserName}-`));
    const persistent = await browserType.launchPersistentContext(profile, {});
    try {
      const page = persistent.pages()[0] ?? (await persistent.newPage());
      await gotoOriginWithoutBooting(page);
      await wipeOriginStorage(page);
      await use(persistent);
    } finally {
      await persistent.close();
      await rm(profile, { recursive: true, force: true });
    }
  },

  freshOriginPage: async ({ context, browser, durableProfile }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async () => {
      if (!durableProfile) {
        const fresh = await browser.newContext();
        contexts.push(fresh);
        return fresh.newPage();
      }
      const page = await context.newPage();
      await gotoOriginWithoutBooting(page);
      await wipeOriginStorage(page);
      return page;
    });
    for (const fresh of contexts) {
      await fresh.close();
    }
  },
});

export { expect } from "@playwright/test";
