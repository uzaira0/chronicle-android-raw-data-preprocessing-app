import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./durabilityContext";
import {
  APP_AND_SCREEN_RAW_CSV,
  DAY_BOUNDARY_RAW_CSV,
  NOTIFICATION_PROXY_RAW_CSV,
  POLLED_EMULATION_RAW_CSV,
  PACKAGE_EXCLUSION_FILTER_CSV,
  PACKAGE_EXCLUSION_RAW_CSV,
  SCREEN_GATING_RAW_CSV,
  MEDIAN_GROUPING_RAW_CSV,
  NESTED_EPISODE_RAW_CSV,
  SESSION_GROUPING_RAW_CSV,
} from "./fixtures";
import {
  assertNoExternalRequests,
  buildHonoursTestRuntime,
  downloadZipEntries,
  expandSectionCard,
  expectSameRunOutput,
  gotoApp,
  installDeterministicRuntime,
  parseCsv,
  processFiles,
  RUN_STAMP_COLUMN,
  setInputFile,
  trackExternalRequests,
} from "./helpers";

let requestTracker: ReturnType<typeof trackExternalRequests>;

// WebKit surfaces this as a pageerror when observed layout work spills past one
// frame; it is benign notification overflow, not an application fault.
const BENIGN_PAGE_ERRORS = [
  "ResizeObserver loop completed with undelivered notifications.",
];

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    const text = String(error);
    if (!BENIGN_PAGE_ERRORS.some((benign) => text.includes(benign))) {
      errors.push(text);
    }
  });
  return errors;
}

async function firstInteractableGraphNode(
  page: Page,
  category: string,
): Promise<Locator> {
  const nodes = page.locator(`.graph-node[data-node-category="${category}"]`);
  const index = await nodes.evaluateAll((elements) => {
    const canvas = document.querySelector<HTMLElement>("[data-testid=graph-canvas]");
    if (!canvas) return -1;
    const canvasRect = canvas.getBoundingClientRect();
    return elements.findIndex((element) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (
        x < canvasRect.left ||
        x > canvasRect.right ||
        y < canvasRect.top ||
        y > canvasRect.bottom ||
        x < 0 ||
        x > window.innerWidth ||
        y < 0 ||
        y > window.innerHeight
      ) {
        return false;
      }
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === element || element.contains(hit));
    });
  });
  expect(index, `expected an interactable ${category} graph node`).toBeGreaterThanOrEqual(0);
  return nodes.nth(index);
}

test.beforeEach(async ({ page }) => {
  requestTracker = trackExternalRequests(page);
  await installDeterministicRuntime(page);
  await gotoApp(page);
  assertNoExternalRequests(requestTracker);
});

test("@smoke @opfs screen-gated credit emits the side-by-side Credited App Usage CSV", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");

  await expandSectionCard(page, "study-analysis");
  await page.getByTestId("toggle-enableScreenGatedCrediting").check();

  await processFiles(page);
  const zipEntries = await downloadZipEntries(page, "download-all-zip");
  const names = Array.from(zipEntries.keys());
  // Side-by-side: the credited CSV appears AND the headline output is still there.
  expect(names.some((name) => name.includes("Credited App Usage"))).toBe(true);
  expect(names.some((name) => name.endsWith("Automatically Preprocessed.csv"))).toBe(true);

  expect(pageErrors).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

/** Total credited seconds in the side-by-side Credited App Usage CSV. */
function creditedSeconds(zipEntries: Map<string, string>): number {
  const entry = Array.from(zipEntries.entries()).find(([name]) =>
    name.includes("Credited App Usage"),
  );
  if (entry === undefined) {
    throw new Error("expected a Credited App Usage CSV in the export");
  }
  const [header = "", ...rows] = entry[1].trim().split(/\r?\n/);
  const column = header.split(",").indexOf("duration_seconds");
  expect(column, "expected a duration_seconds column").toBeGreaterThanOrEqual(0);
  return rows
    .filter((line) => line.trim().length > 0)
    .reduce((total, line) => total + (Number(line.split(",")[column]) || 0), 0);
}

// Each rule gets its own page load. Reusing one page would leave the previous
// run's result panel on screen, and `processFiles` would return against it
// while the new run was still going — the export then read one run behind.
// Settings live in localStorage, so the selected rule survives the reload; the
// file queue does not, so it is re-added each time.
async function creditedSecondsForRule(
  page: Page,
  rule: "screen_and_liveness_v1" | "screen_witness_only" | "device_liveness_only",
): Promise<number> {
  await gotoApp(page);
  // The app restores the last workflow tab from localStorage, so after the
  // first run a reload lands on Process, not Settings.
  await page.getByRole("tab", { name: /Settings/i }).click();
  await setInputFile(page, "raw-file-input", "Raw P01.csv", SCREEN_GATING_RAW_CSV, "text/csv");
  await expandSectionCard(page, "study-analysis");
  await page.getByTestId("toggle-enableScreenGatedCrediting").check();
  await page.getByTestId("screen-gating-rule-select").selectOption(rule);
  await processFiles(page);
  return creditedSeconds(await downloadZipEntries(page, "download-all-zip"));
}

// The whole point of the axis: a researcher who changes the rule sees the
// credited data change. Each rule keeps a different conjunct of the same
// evidence, so their credited totals are strictly ordered on this fixture.
test("@smoke @opfs the screen-gating rule changes how much of a session is credited", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  const both = await creditedSecondsForRule(page, "screen_and_liveness_v1");
  const screenOnly = await creditedSecondsForRule(page, "screen_witness_only");
  const livenessOnly = await creditedSecondsForRule(page, "device_liveness_only");

  // Screen-on and alive is the narrowest; dropping either conjunct widens it.
  expect(both).toBeGreaterThan(0);
  expect(screenOnly).toBeGreaterThan(both);
  expect(livenessOnly).toBeGreaterThan(screenOnly);

  expect(pageErrors).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

/** `date` and `duration_seconds` of every headline App Usage row, in file order. */
function appUsageDays(zipEntries: Map<string, string>): Array<[string, number]> {
  const entry = Array.from(zipEntries.entries()).find(([name]) =>
    name.endsWith("Automatically Preprocessed.csv"),
  );
  if (entry === undefined) {
    throw new Error("expected the headline App Usage CSV in the export");
  }
  const [header = "", ...rows] = entry[1].trim().split(/\r?\n/);
  const columns = header.split(",");
  const date = columns.indexOf("date");
  const seconds = columns.indexOf("duration_seconds");
  expect(date, "expected a date column").toBeGreaterThanOrEqual(0);
  expect(seconds, "expected a duration_seconds column").toBeGreaterThanOrEqual(0);
  return rows
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const cells = line.split(",");
      return [cells[date] ?? "", Number(cells[seconds])] as [string, number];
    });
}

// One page load per rule, for the same reason the screen-gating helper reloads:
// a reused page keeps the previous result panel on screen and the export then
// reads one run behind.
async function appUsageDaysForRule(
  page: Page,
  rule: "attribute_to_start_day" | "split_at_local_midnight",
): Promise<Array<[string, number]>> {
  await gotoApp(page);
  await page.getByRole("tab", { name: /Settings/i }).click();
  await setInputFile(page, "raw-file-input", "Raw P01.csv", DAY_BOUNDARY_RAW_CSV, "text/csv");
  await expandSectionCard(page, "timezone");
  await page.getByTestId("day-boundary-attribution-select").selectOption(rule);
  await processFiles(page);
  return appUsageDays(await downloadZipEntries(page, "download-all-zip"));
}

/**
 * Packages the run labelled `Filtered App Usage`, sorted.
 *
 * This must go through the quoting-aware parser rather than splitting on `,`.
 * The app codebook is on by default, so a package it knows -- here
 * `com.android.launcher3` -- picks up quoted cells that contain commas
 * ("Launcher, Quickstep"), and a bare split shifts that row's columns only.
 */
function excludedPackages(zipEntries: Map<string, string>): string[] {
  const entry = Array.from(zipEntries.entries()).find(([name]) =>
    name.endsWith("Automatically Preprocessed.csv"),
  );
  if (entry === undefined) {
    throw new Error("expected the headline App Usage CSV in the export");
  }
  const rows = parseCsv(entry[1]);
  expect(rows.length, "expected app usage rows in the export").toBeGreaterThan(0);
  return rows
    .filter((row) => row.interaction_type === "Filtered App Usage")
    .map((row) => row.app_package_name ?? "")
    .sort();
}

// One page load per preset, for the same reason the day-boundary helper
// reloads: a reused page keeps the previous result panel on screen and the
// export then reads one run behind.
async function excludedPackagesForPreset(
  page: Page,
  preset: "all_supplied_rows" | "honor_filter_flag" | "system_scope_only",
): Promise<string[]> {
  await gotoApp(page);
  await page.getByRole("tab", { name: /Settings/i }).click();
  await setInputFile(page, "raw-file-input", "Raw P01.csv", PACKAGE_EXCLUSION_RAW_CSV, "text/csv");
  await expandSectionCard(page, "files");
  await setInputFile(
    page,
    "filter-file-input",
    "apps to filter.csv",
    PACKAGE_EXCLUSION_FILTER_CSV,
    "text/csv",
  );
  await page.getByTestId("toggle-useFilterFile").check();
  await page.getByTestId("package-exclusion-preset-select").selectOption(preset);
  await processFiles(page);
  return excludedPackages(await downloadZipEntries(page, "download-all-zip"));
}

/**
 * Run once under one notification-proxy rule and return the headline App Usage
 * CSV plus the side-by-side Notification Contact CSV, if the run emitted one.
 *
 * A fresh page load per rule, for the same reason the day-boundary helper
 * reloads: a reused page keeps the previous result panel on screen and the
 * export then reads one run behind.
 */
async function notificationRun(
  page: Page,
  rule: "none" | "seen_contact_v1" | "interruption_contact_v1" | "any_notification_contact_v1",
): Promise<{ app: string; contacts: Array<Record<string, string>> }> {
  await gotoApp(page);
  await page.getByRole("tab", { name: /Settings/i }).click();
  await setInputFile(
    page,
    "raw-file-input",
    "Raw P01.csv",
    NOTIFICATION_PROXY_RAW_CSV,
    "text/csv",
  );
  await expandSectionCard(page, "study-analysis");
  await page.getByTestId("notification-proxy-rule-select").selectOption(rule);
  await processFiles(page);
  const zipEntries = await downloadZipEntries(page, "download-all-zip");
  const appEntry = Array.from(zipEntries.entries()).find(([name]) =>
    name.endsWith("Automatically Preprocessed.csv"),
  );
  if (appEntry === undefined) {
    throw new Error("expected the headline App Usage CSV in the export");
  }
  const contactEntry = Array.from(zipEntries.entries()).find(([name]) =>
    name.endsWith("Notification Contact.csv"),
  );
  return {
    app: appEntry[1],
    contacts: contactEntry === undefined ? [] : parseCsv(contactEntry[1]),
  };
}

// The whole point of the axis: Chronicle logs a notification against a package
// and the app-usage algorithm reads none of those rows, so today they produce
// no output at all. This drives the real browser -> Rust path, so it also
// proves the option reaches the kernel rather than stopping at the UI.
//
// Split across two tests because each `notificationRun` is a full page load
// and a full processing run; four of them in one test exhausts Firefox's
// 30 s per-test budget, and the neighbouring two-run axis tests here take
// around twenty seconds in that browser.
test("@smoke @opfs the notification proxy rule emits labelled contacts and never touches app usage", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  // The default emits no channel at all.
  const off = await notificationRun(page, "none");
  expect(off.contacts).toEqual([]);

  const any = await notificationRun(page, "any_notification_contact_v1");
  expect(any.contacts).toHaveLength(3);

  // Provenance is on the row: the rule that emitted it, and whether the moment
  // is time an app-usage session already accounts for.
  const flagsAt = (timestamp: string): string => {
    const row = any.contacts.find((candidate) =>
      (candidate.event_timestamp ?? "").includes(timestamp),
    );
    if (row === undefined) {
      throw new Error(`no contact row at ${timestamp}`);
    }
    return row.any_app_usage_flags ?? "";
  };
  expect(flagsAt("10:01:00")).toContain("NOTIFICATION PROXY any_notification_contact_v1");
  expect(flagsAt("10:01:00")).toContain("WITHIN OBSERVED USAGE");
  expect(flagsAt("10:30:00")).toContain("OUTSIDE OBSERVED USAGE");
  expect(flagsAt("11:00:00")).toContain("OUTSIDE OBSERVED USAGE");

  // A notification is an instant. The channel refuses to invent an interval.
  for (const row of any.contacts) {
    expect(row.start_timestamp).toBe("");
    expect(row.stop_timestamp).toBe("");
    expect(row.duration_seconds).toBe("");
    expect(row.duration_minutes).toBe("");
  }

  // The headline output is untouched by the channel. That is the whole promise
  // of a side-by-side output.
  await expectSameRunOutput(page, any.app, off.app);

  expect(pageErrors).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

// The other half of the axis: the rule chooses WHICH raw types become
// contacts, not merely whether any do. Type 10 and type 12 are distinct
// signals -- seen versus interrupted -- and a study that wants one should not
// silently receive the other.
test("@smoke @opfs each notification proxy rule admits only its own raw type", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  const seen = await notificationRun(page, "seen_contact_v1");
  expect(seen.contacts.map((row) => row.interaction_type)).toEqual([
    "Notification Seen",
    "Notification Seen",
  ]);

  const interruption = await notificationRun(page, "interruption_contact_v1");
  expect(interruption.contacts.map((row) => row.interaction_type)).toEqual([
    "Notification Interruption",
  ]);
  expect(interruption.contacts.map((row) => row.app_package_name)).toEqual(["com.example.news"]);

  // Two different channels over the same raw file still leave one identical
  // headline output.
  await expectSameRunOutput(page, interruption.app, seen.app);

  expect(pageErrors).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

/**
 * B09. One full browser -> Rust run at a chosen emulation method, returning the
 * headline CSV and the emulated channel.
 *
 * A fresh page load per method, for the same reason `notificationRun` reloads:
 * a reused page keeps the previous result panel on screen and the export then
 * reads one run behind.
 */
async function polledEmulationRun(
  page: Page,
  method: "none" | "ross_2025_sampled_gap_v1" | "cerit_2025_sample_count_v1",
): Promise<{ app: string; emulated: Array<Record<string, string>> }> {
  await gotoApp(page);
  await page.getByRole("tab", { name: /Settings/i }).click();
  await setInputFile(page, "raw-file-input", "Raw P01.csv", POLLED_EMULATION_RAW_CSV, "text/csv");
  await expandSectionCard(page, "study-analysis");
  await page.getByTestId("polled-emulation-method-select").selectOption(method);
  await processFiles(page);
  const zipEntries = await downloadZipEntries(page, "download-all-zip");
  const appEntry = Array.from(zipEntries.entries()).find(([name]) =>
    name.endsWith("Automatically Preprocessed.csv"),
  );
  if (appEntry === undefined) {
    throw new Error("expected the headline App Usage CSV in the export");
  }
  const emulatedEntry = Array.from(zipEntries.entries()).find(([name]) =>
    name.endsWith("Polled Emulation.csv"),
  );
  return {
    app: appEntry[1],
    emulated: emulatedEntry === undefined ? [] : parseCsv(emulatedEntry[1]),
  };
}

// The whole point of the axis: Chronicle records every foreground transition
// while much of the published literature samples the screen every few seconds,
// so the two instruments do not produce comparable totals. The two published
// conversions miss in OPPOSITE directions on the same 66 s of observed usage --
// 50 s under Ross, 70 s under Cerit -- and that spread is the measurement.
// Driving the real browser -> Rust path also proves the option reaches the
// kernel rather than stopping at the UI.
test("@smoke @opfs polled-method emulation publishes each conversion beside an untouched headline", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  const total = (rows: Array<Record<string, string>>): number =>
    rows.reduce((sum, row) => sum + Number(row.duration_seconds ?? "0"), 0);

  // The default emits no channel at all.
  const off = await polledEmulationRun(page, "none");
  expect(off.emulated).toEqual([]);

  const ross = await polledEmulationRun(page, "ross_2025_sampled_gap_v1");
  // One run per package. The 6 s episode falls between two grid instants and
  // is never sampled, which is the loss this axis exists to make visible.
  expect(ross.emulated.map((row) => Number(row.duration_seconds))).toEqual([30, 20]);
  expect(total(ross.emulated)).toBeLessThan(66);

  // Provenance rides on every row, in the existing flag column.
  for (const row of ross.emulated) {
    expect(row.any_app_usage_flags ?? "").toContain(
      "POLLED EMULATION ross_2025_sampled_gap_v1 @10s",
    );
    expect(row.any_app_usage_flags ?? "").toContain("EMULATED NOT OBSERVED");
  }
  // Ross force-closes the trailing run so that it counts; the run closed by a
  // package change is not forced.
  const rossFlags = ross.emulated.map((row) => row.any_app_usage_flags ?? "");
  expect(rossFlags[0]).not.toContain("FORCED TERMINAL SAMPLE");
  expect(rossFlags[1]).toContain("FORCED TERMINAL SAMPLE");

  // The headline output is untouched. That is the whole promise of a
  // side-by-side channel.
  await expectSameRunOutput(page, ross.app, off.app);

  expect(pageErrors).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

// The other half of the axis: WHICH published conversion, not merely whether
// one runs. Counting samples and subtracting endpoints are different
// measurements of the same samples, and they disagree by 20 s here.
test("@smoke @opfs the sample-count conversion overstates where endpoint subtraction understates", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  const cerit = await polledEmulationRun(page, "cerit_2025_sample_count_v1");
  // Four retained samples are four whole cadences (40 s) for an app that was
  // foreground 35 s, and three are 30 s for one that was foreground 25 s.
  expect(cerit.emulated.map((row) => Number(row.duration_seconds))).toEqual([40, 30]);
  const total = cerit.emulated.reduce(
    (sum, row) => sum + Number(row.duration_seconds ?? "0"),
    0,
  );
  expect(total).toBeGreaterThan(66);

  for (const row of cerit.emulated) {
    expect(row.any_app_usage_flags ?? "").toContain(
      "POLLED EMULATION cerit_2025_sample_count_v1 @10s",
    );
    expect(row.any_app_usage_flags ?? "").toContain("EMULATED NOT OBSERVED");
  }
  // This rule never needed an end, so it forces nothing.
  for (const row of cerit.emulated) {
    expect(row.any_app_usage_flags ?? "").not.toContain("FORCED TERMINAL SAMPLE");
  }

  expect(pageErrors).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

// The whole point of the axis: the shipped filter file classifies each package
// and carries a per-row enable flag, and until B10 the engine read neither --
// every supplied row excluded whatever its category, and a row set to 0 was
// excluded anyway. This runs the real browser -> Rust path, so it also proves
// the option reaches the kernel rather than stopping at the UI.
test("@smoke @opfs the package-exclusion preset decides which filter rows exclude", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  // The select is inert until the filter file it scopes is switched on.
  await gotoApp(page);
  await page.getByRole("tab", { name: /Settings/i }).click();
  await expandSectionCard(page, "files");
  await expect(page.getByTestId("package-exclusion-preset-select")).toBeDisabled();

  expect(await excludedPackagesForPreset(page, "all_supplied_rows")).toEqual([
    "com.android.launcher3",
    "com.carrier.app",
    "com.disabled.row",
  ]);
  // The disabled row stops excluding; the other two are untouched.
  expect(await excludedPackagesForPreset(page, "honor_filter_flag")).toEqual([
    "com.android.launcher3",
    "com.carrier.app",
  ]);
  // Only the system family. com.disabled.row is category `system` too, so this
  // preset ignores its flag -- the two narrowing rules are independent.
  expect(await excludedPackagesForPreset(page, "system_scope_only")).toEqual([
    "com.android.launcher3",
    "com.disabled.row",
  ]);

  expect(pageErrors).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

// The whole point of the axis: a session that runs past midnight can be made to
// give each calendar day the part that actually fell inside it, and the total
// is conserved either way.
test("@smoke @opfs the day-boundary rule decides which day a midnight-crossing session counts on", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  const whole = await appUsageDaysForRule(page, "attribute_to_start_day");
  const divided = await appUsageDaysForRule(page, "split_at_local_midnight");

  expect(whole).toEqual([["2026-03-06", 2_400]]);
  expect(divided).toEqual([
    ["2026-03-06", 1_200],
    ["2026-03-07", 1_200],
  ]);

  expect(pageErrors).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

/** `usage_session_id` of every headline App Usage row, in file order. */
function usageSessionIds(zipEntries: Map<string, string>): string[] {
  const entry = Array.from(zipEntries.entries()).find(([name]) =>
    name.endsWith("Automatically Preprocessed.csv"),
  );
  if (entry === undefined) {
    throw new Error("expected the headline App Usage CSV in the export");
  }
  const [header = "", ...rows] = entry[1].trim().split(/\r?\n/);
  const column = header.split(",").indexOf("usage_session_id");
  expect(column, "expected a usage_session_id column").toBeGreaterThanOrEqual(0);
  return rows
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(",")[column] ?? "");
}

async function usageSessionIdsForPolicy(page: Page, policy: string): Promise<string[]> {
  await gotoApp(page);
  await page.getByRole("tab", { name: /Settings/i }).click();
  await setInputFile(page, "raw-file-input", "Raw P01.csv", SESSION_GROUPING_RAW_CSV, "text/csv");
  await expandSectionCard(page, "session-detection");
  await page.getByTestId("session-grouping-policy-select").selectOption(policy);
  await processFiles(page);
  return usageSessionIds(await downloadZipEntries(page, "download-all-zip"));
}

// The grouping policy names the published gap definition. It has to reach the
// exported table: a column of empty cells is a label, not a measurement choice.
test("@smoke @opfs the session-grouping policy numbers sessions in the exported app table", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  expect(await usageSessionIdsForPolicy(page, "van_berkel_45s")).toEqual(["0", "0", "1"]);
  expect(await usageSessionIdsForPolicy(page, "zerrer_60s")).toEqual(["0", "0", "0"]);

  expect(pageErrors).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

/// One run over the nested-episode fixture. The other-stop set is edited so
/// the matcher actually produces the overlap; without that edit a foreground
/// switch closes the first app and there is nothing for the basis to disagree
/// about.
async function nestedEpisodeRun(
  page: Page,
  basis: "previous_episode_stop_v1" | "session_running_maximum_stop_v1",
  lineage: boolean,
): Promise<Array<Record<string, string>>> {
  await gotoApp(page);
  await page.getByRole("tab", { name: /Settings/i }).click();
  await setInputFile(page, "raw-file-input", "Raw P01.csv", NESTED_EPISODE_RAW_CSV, "text/csv");
  await expandSectionCard(page, "interaction-semantics");
  // Only the different-app variant matters: it is the one that would close A
  // when B resumes. The same-app and filtered-app variants stay as shipped.
  await page
    .getByRole("group", { name: "Other interaction types that end a session" })
    .getByRole("checkbox", { name: "Activity Resumed for a Different App", exact: true })
    .uncheck();
  await expandSectionCard(page, "session-detection");
  await page.getByTestId("session-grouping-policy-select").selectOption("zerrer_60s");
  await page.getByTestId("session-gap-basis-select").selectOption(basis);
  if (lineage) {
    await page.getByTestId("toggle-emitSessionBreakLineage").check();
  }
  await processFiles(page);
  const entries = await downloadZipEntries(page, "download-all-zip");
  const entry = Array.from(entries.entries()).find(([name]) =>
    name.endsWith("Automatically Preprocessed.csv"),
  );
  if (entry === undefined) {
    throw new Error("expected the headline App Usage CSV in the export");
  }
  // Quoting-aware: the default-on codebook puts commas inside quoted cells.
  return parseCsv(entry[1]);
}

// The three grouping extensions only make sense once a policy is selected, and
// none of them may appear before one is. A control the run cannot act on is a
// label.
test("@smoke the session-grouping extensions appear only once a policy is selected", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await gotoApp(page);
  await page.getByRole("tab", { name: /Settings/i }).click();
  await expandSectionCard(page, "session-detection");

  await expect(page.getByTestId("session-gap-basis-select")).toHaveCount(0);
  await expect(page.getByTestId("session-boundary-scope-select")).toHaveCount(0);
  await expect(page.getByTestId("toggle-emitSessionBreakLineage")).toHaveCount(0);

  await page.getByTestId("session-grouping-policy-select").selectOption("zerrer_60s");
  await expect(page.getByTestId("session-gap-basis-select")).toBeVisible();
  await expect(page.getByTestId("session-boundary-scope-select")).toBeVisible();
  await expect(page.getByTestId("toggle-emitSessionBreakLineage")).toBeVisible();

  // Both are at their published defaults, so selecting a policy alone still
  // reproduces exactly the numbering the paper describes.
  await expect(page.getByTestId("session-gap-basis-select")).toHaveValue(
    "previous_episode_stop_v1",
  );
  await expect(page.getByTestId("session-boundary-scope-select")).toHaveValue("participant_v1");

  await page.getByTestId("session-grouping-policy-select").selectOption("none");
  await expect(page.getByTestId("session-gap-basis-select")).toHaveCount(0);

  expect(pageErrors).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

// The defect the gap-basis axis exists for, driven through the real browser ->
// Rust path: a 30 min episode with a 1 min episode nested inside it, then a
// third episode 20 s after the long one ends. Nothing here is 60 s of silence,
// yet the published reading splits.
test("@smoke @opfs a nested episode splits a session only under the published gap basis", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  const published = await nestedEpisodeRun(page, "previous_episode_stop_v1", false);
  expect(published.map((row) => row.usage_session_id)).toEqual(["0", "0", "1"]);

  const runningMax = await nestedEpisodeRun(page, "session_running_maximum_stop_v1", false);
  expect(runningMax.map((row) => row.usage_session_id)).toEqual(["0", "0", "0"]);

  expect(pageErrors).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

// Lineage rides in the existing flag column and states the number each verdict
// rested on, so two runs of the same data can be told apart from the export
// alone.
test("@smoke @opfs session-break lineage records the verdict and the gap it measured", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  const withLineage = await nestedEpisodeRun(page, "session_running_maximum_stop_v1", true);
  expect(withLineage.map((row) => row.any_app_usage_flags)).toEqual([
    "['SESSION 0 OPEN']",
    // B opens INSIDE A, so the gap from the running maximum is negative.
    "['SESSION 0 JOIN GAP -1740 S']",
    "['SESSION 0 JOIN GAP 20 S']",
  ]);

  // Additive: no new column, and nothing outside the flag column moved.
  const withoutLineage = await nestedEpisodeRun(page, "session_running_maximum_stop_v1", false);
  expect(Object.keys(withLineage[0] ?? {}).sort()).toEqual(
    Object.keys(withoutLineage[0] ?? {}).sort(),
  );
  // A deployed build stamps each run with its own clock; a test build pins
  // one stamp, so there the stamp column is compared like every other.
  const stampsPinned = await buildHonoursTestRuntime(page);
  for (const [index, row] of withoutLineage.entries()) {
    for (const [column, value] of Object.entries(row)) {
      if (column === "any_app_usage_flags") continue;
      if (column === RUN_STAMP_COLUMN && !stampsPinned) continue;
      expect(withLineage[index]?.[column], `row ${index} column ${column}`).toBe(value);
    }
  }

  expect(pageErrors).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

// Peng & Zhu (2020) verbatim: "the median score of a user's inter-app
// intervals is adopted for each user". One file, two participants, two
// different thresholds — and with lineage on, each partition's OPEN flag
// names the median it derived and how many intervals it was computed over,
// so the individualized threshold is reconstructible from the export alone.
test("@smoke @opfs the Peng & Zhu policy derives each participant's own median threshold", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await gotoApp(page);
  await page.getByRole("tab", { name: /Settings/i }).click();
  await setInputFile(page, "raw-file-input", "Raw P01.csv", MEDIAN_GROUPING_RAW_CSV, "text/csv");
  await expandSectionCard(page, "session-detection");
  await page
    .getByTestId("session-grouping-policy-select")
    .selectOption("peng_zhu_2020_participant_median");
  await page.getByTestId("toggle-emitSessionBreakLineage").check();
  await processFiles(page);
  const entries = await downloadZipEntries(page, "download-all-zip");
  const entry = Array.from(entries.entries()).find(([name]) =>
    name.endsWith("Automatically Preprocessed.csv"),
  );
  if (entry === undefined) {
    throw new Error("expected the headline App Usage CSV in the export");
  }
  // Quoting-aware: the default-on codebook puts commas inside quoted cells.
  const rows = parseCsv(entry[1]);

  const p01 = rows.filter((row) => row.participant_id === "P01");
  const p02 = rows.filter((row) => row.participant_id === "P02");
  // P01's gaps are 5, 10 and 100 s; the median is 10 s, so 5 joins and the
  // exact-median 10 s gap splits ("smaller than ... joins" leaves equality on
  // the splitting side).
  expect(p01.map((row) => row.usage_session_id)).toEqual(["0", "0", "1", "2"]);
  expect(p01[0]?.any_app_usage_flags).toBe("['SESSION 0 OPEN MEDIAN 10 S N 3']");
  // P02's gaps are 200, 300 and 400 s; the median is 300 s, so the 200 s gap
  // that would break P01 joins here.
  expect(p02.map((row) => row.usage_session_id)).toEqual(["0", "0", "1", "2"]);
  expect(p02[0]?.any_app_usage_flags).toBe("['SESSION 0 OPEN MEDIAN 300 S N 3']");

  expect(pageErrors).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

test("@smoke Pipeline Explorer separates workflow, impact, lineage, execution, and audit evidence", async ({
  page,
}) => {
  const pageErrors = trackPageErrors(page);

  await page.getByRole("tab", { name: /Graph/i }).click();
  await expect(page.getByTestId("graph-canvas")).toBeVisible();
  await expect(page.getByTestId("graph-sentence")).toContainText("Select an item");

  const nodes = page.locator(".graph-node");
  await expect(page.getByTestId("graph-mode-overview")).toHaveAttribute("aria-pressed", "true");
  await expect(nodes.first()).toBeVisible();
  expect(await nodes.count()).toBeGreaterThan(0);
  await expect(page.locator('.graph-node[data-node-category="phase"]'))
    .toHaveCount(await nodes.count());
  await nodes.first().click();
  await expect(page.getByTestId("graph-sentence")).not.toContainText("Select an item");

  // Decisions keeps physical cache readers separate from semantic and artifact impact.
  await page.getByTestId("graph-mode-decisions").click();
  await expect(page.locator('.graph-node[data-node-category="decision"]').first()).toBeVisible();
  await expect(page.locator('.graph-node[data-node-category="execution"]').first()).toBeVisible();
  await expect(page.locator('.graph-node[data-node-category="operation"]').first()).toBeVisible();
  await expect(page.locator('.graph-node[data-node-category="artifact"]').first()).toBeVisible();
  await (await firstInteractableGraphNode(page, "decision")).click();
  await expect(page.getByTestId("graph-impact-details")).toContainText("Direct physical readers");
  await expect(page.getByTestId("graph-impact-details")).toContainText("Operations that may change");
  await expect(page.getByTestId("graph-impact-details")).toContainText("Artifacts that may change");
  await expect(nodes.locator(".graph-node__availability").first()).toBeVisible();

  // Lineage does not mislabel every terminal artifact as a user deliverable.
  await page.getByTestId("graph-mode-lineage").click();
  await expect(page.locator('.graph-node[data-node-category="source"]').first()).toBeVisible();
  await expect(page.locator('.graph-node[data-node-category="artifact"]').first()).toBeVisible();
  await expect(page.getByTestId("graph-deliverables")).toContainText("Not observed");

  // Before a run, execution evidence says exactly what has not been observed.
  await page.getByTestId("graph-mode-execution").click();
  await expect(page.getByTestId("graph-node-metrics").first()).toContainText("timing unavailable");

  // Audit can find and focus registry operations, and detailed phases collapse dynamically.
  await page.getByTestId("graph-mode-audit").click();
  const firstAuditLabel = await nodes.locator(".graph-node__label").first().innerText();
  await page.getByTestId("graph-audit-search").fill(firstAuditLabel);
  await expect(page.getByTestId("graph-audit-results").getByRole("button").first()).toBeVisible();
  await page.getByTestId("graph-audit-results").getByRole("button").first().click();
  await expect(page.getByTestId("graph-sentence")).toContainText(firstAuditLabel);
  await page.getByTestId("graph-collapse-all-phases").click();
  await expect(page.getByTestId("graph-collapse-all-phases")).toHaveText("Expand all");
  await expect(page.locator('.graph-node[data-node-category="phase"]').first()).toBeVisible();

  // Orientation changes the same declared graph; neither mode invents bridge edges.
  await expect(page.getByTestId("graph-direction-tb")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("graph-direction-lr").click();
  await expect(page.getByTestId("graph-direction-lr")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("graph-direction-tb")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".react-flow__edge path[marker-end]").first()).toBeAttached();

  // A real run contributes observed timings and the exact emitted deliverable list.
  await page.getByRole("tab", { name: /^Files$/i }).click();
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");
  await processFiles(page);
  await page.getByRole("tab", { name: /Graph/i }).click();
  await page.getByTestId("graph-mode-execution").click();
  await expect(page.getByTestId("graph-node-metrics").filter({ hasText: "ms" }).first())
    .toBeVisible();
  await expect(page.getByTestId("graph-deliverables")).not.toContainText("Not observed");
  await expect(page.getByTestId("graph-deliverables").getByRole("listitem").first())
    .toBeVisible();

  expect(pageErrors).toEqual([]);
  assertNoExternalRequests(requestTracker);
});
