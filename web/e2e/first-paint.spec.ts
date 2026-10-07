import { expect, test } from "@playwright/test";

/**
 * First load. The page paints a static skeleton before any JavaScript runs,
 * and the app's first screen does not wait for the method-profile registries
 * (the largest packed asset, about 1 MB on the wire and 10 MB decoded): the
 * cards that need them load after it.
 */

const APP_HEADING = { name: "Chronicle Android Raw Data Preprocessor" } as const;

// The service worker installs at the load event and then serves the page's
// fetches itself, out of page.route's reach; holding a response needs it off.
test.use({ serviceWorkers: "block" });

test("@smoke the static skeleton shows until the app's first render replaces it", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    await held;
    await route.continue();
  });

  await page.goto("./", { waitUntil: "commit" });
  const skeleton = page.getByTestId("boot-skeleton");
  await expect(skeleton).toBeVisible();
  await expect(skeleton.getByRole("status")).toHaveText("Loading the preprocessor…");
  // The skeleton's title is not a heading, so nothing waiting for the app's
  // h1 can mistake the skeleton for the booted app.
  await expect(page.getByRole("heading", APP_HEADING)).toHaveCount(0);

  release();
  await expect(page.getByRole("heading", APP_HEADING)).toBeVisible();
  await expect(skeleton).toHaveCount(0);
});

test("@smoke the first screen does not wait for the method-profile registries", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let registryRequested = false;
  await page.route(/android-method-profile-runtime-registry-[0-9a-f]+\.json\.pack$/, async (route) => {
    registryRequested = true;
    await held;
    await route.continue();
  });

  await page.goto("./", { waitUntil: "commit" });
  await expect(page.getByRole("heading", APP_HEADING)).toBeVisible();
  await expect(page.getByTestId("study-name-input")).toBeEditable();
  // The method-profile card holds its place while its registry is in flight.
  const methodCard = page.locator('[data-settings-anchor="research-method-profile"]');
  await expect(methodCard).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => registryRequested).toBe(true);

  release();
  await expect(methodCard).not.toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("method-profile-file-input")).toBeAttached();
});

// The two cards sit above Saved projects and the rest of the settings. A
// placeholder that is much shorter than the card moves everything below it
// when the card arrives, so a click aimed at "Load" in that moment landed on
// whatever had moved under the pointer (measured: 524 px at 1280 wide, 860 px at 320).
for (const width of [1280, 768, 375, 320]) {
  test(`@smoke the method-profile cards barely move the settings below them when they load (${width} px)`, async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/android-method-profile-runtime-registry-[0-9a-f]+\.json\.pack$/, async (route) => {
      await held;
      await route.continue();
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("./", { waitUntil: "commit" });
    const projects = page.getByRole("region", { name: "Saved projects" });
    await expect(projects).toBeVisible();
    const busyCards = page.locator('[data-settings-anchor][aria-busy="true"]');
    await expect(busyCards).toHaveCount(2);
    const top = async () => (await projects.boundingBox())?.y ?? Number.NaN;
    const before = await top();

    release();
    await expect(busyCards).toHaveCount(0);
    const moved = (await top()) - before;
    // The placeholders reserve no more than the cards take (to within the
    // sub-pixel rounding of the measured heights), so the content below only
    // ever moves down, and by less than one line of controls.
    expect(moved).toBeGreaterThanOrEqual(-1);
    expect(moved).toBeLessThanOrEqual(48);
  });
}

// The skeleton paints before the app's JavaScript, which is what used to set
// the theme: a dark-mode user saw a light page until the app booted. The theme
// must already be the one the app ends with while the entry script is held.
for (const { name, colorScheme, saved, expected } of [
  { name: "a dark system theme", colorScheme: "dark", saved: null, expected: "dark" },
  { name: "a saved light choice over a dark system", colorScheme: "dark", saved: "light", expected: "light" },
  { name: "a saved dark choice over a light system", colorScheme: "light", saved: "dark", expected: "dark" },
] as const) {
  test(`the skeleton paints in the final theme under ${name}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    if (saved) {
      await page.addInitScript((theme) => localStorage.setItem("chronicle.theme.v1", theme), saved);
    }
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
      await held;
      await route.continue();
    });

    await page.goto("./", { waitUntil: "commit" });
    await expect(page.getByTestId("boot-skeleton")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", expected);
    const skeletonBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    release();
    await expect(page.getByRole("heading", APP_HEADING)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", expected);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(skeletonBackground);
  });
}
