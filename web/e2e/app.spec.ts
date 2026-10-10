import { readFile } from "node:fs/promises";
import { suppliedCommunicationCsv } from "./fixtures/ringer-state-interval";
import { pathToFileURL } from "node:url";

import { AxeBuilder } from "@axe-core/playwright";

// The @opfs tests in this file need a real origin-private filesystem, which
// WebKit only grants against an on-disk profile; the fixture is a no-op for
// every other project.
import { expect, test } from "./durabilityContext";

import {
  APP_AND_SCREEN_RAW_CSV,
  APP_ONLY_RAW_CSV,
  CODEBOOK_CSV,
  createFilterWorkbookBytes,
  FILTER_FILE_CSV,
  APPS_FORCING_SCREEN_OPEN_CSV,
  MALFORMED_RAW_CSV,
  MIXED_TIMEZONE_RAW_CSV,
  MULTI_FILE_RAW_CSV_B,
  FIXED_DATETIME,
} from "./fixtures";
import {
  assertNoExternalRequests,
  csvHeaders,
  downloadCsv,
  downloadZipEntries,
  expandSectionCard,
  gotoApp,
  expectDatetimeOfPreprocessing,
  installDeterministicRuntime,
  parseCsv,
  processFiles,
  setInputFile,
  trackExternalRequests,
  waitForServiceWorkerControl,
} from "./helpers";

let requestTracker: ReturnType<typeof trackExternalRequests>;

test.beforeEach(async ({ page }) => {
  requestTracker = trackExternalRequests(page);
  await installDeterministicRuntime(page);
  await gotoApp(page);
  assertNoExternalRequests(requestTracker);
});

test("@smoke @opfs boots locally and processes a raw file entirely on localhost", async ({
  page,
}) => {
  await expandSectionCard(page, "session-detection");
  await page
    .getByTestId("opener-set-select")
    .selectOption("activity_resumed_only");
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  const runStartedAtMs = Date.now();
  await processFiles(page);
  await expect(page.getByTestId("result-panel")).toHaveCount(1);
  await expect(page.getByTestId("result-file-table")).toBeVisible();
  const appCsv = await downloadCsv(page, "download-app-csv");
  const rows = parseCsv(appCsv);
  expect(rows.length).toBeGreaterThan(0);
  await expectDatetimeOfPreprocessing(page, rows[0]?.datetime_of_preprocessing, runStartedAtMs);

  const zipEntries = await downloadZipEntries(page, "download-all-zip");
  const manifest = JSON.parse(
    zipEntries.get("Raw P01 Runtime Manifest.json") ?? "{}",
  ) as {
    artifacts?: Array<{ kind?: string }>;
    processingSummary?: {
      openerSetReceipt?: {
        applicability?: {
          requested?: string;
          effective?: string | null;
          relation?: string;
          refusalReason?: string | null;
        };
      };
    };
  };
  expect(manifest.processingSummary?.openerSetReceipt?.applicability).toEqual({
    requested: "activity_resumed_only",
    effective: "activity_resumed_only",
    relation: "baseline_equivalent",
    refusalReason: null,
  });
  expect(manifest.artifacts?.map(({ kind }) => kind)).toContain(
    "opener-set-receipt-json",
  );

  const provenance = JSON.parse(
    zipEntries.get("Raw P01 Workflow Provenance.jsonld") ?? "{}",
  ) as {
    "@graph"?: Array<{
      "@type"?: string | string[];
      "chron:knob_key"?: string;
      "chron:knob_value"?: string;
    }>;
  };
  const openerBinding = provenance["@graph"]?.find(
    (node) =>
      node["@type"] === "chron:ParameterBinding" &&
      node["chron:knob_key"] === "opener_set",
  );
  expect(openerBinding?.["chron:knob_value"]).toBe(
    JSON.stringify("activity_resumed_only"),
  );
  assertNoExternalRequests(requestTracker);
});

test("@smoke @opfs processes a raw file on the sequential engine, the only engine the app offers", async ({
  page,
}) => {
  // The Salsa incremental engine is switched off in the app: the Performance
  // card has no toggle for it, and a fresh install sends sequential requests.
  // The injected test runtime pins the same flag the app now always sends.
  await expandSectionCard(page, "performance");
  await expect(page.getByTestId("toggle-incrementalEngine")).toHaveCount(0);
  // Registered before the reload so the reloaded document boots with it.
  await installDeterministicRuntime(page, {
    datetimeOfPreprocessing: FIXED_DATETIME,
    incrementalEngine: false,
  });
  await page.reload();

  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");
  await processFiles(page);
  await expect(page.getByTestId("result-panel")).toHaveCount(1);
  const appCsv = await downloadCsv(page, "download-app-csv");
  expect(parseCsv(appCsv).length).toBeGreaterThan(0);

  const zipEntries = await downloadZipEntries(page, "download-all-zip");
  const manifest = JSON.parse(
    zipEntries.get("Raw P01 Runtime Manifest.json") ?? "{}",
  ) as {
    artifacts?: Array<{ kind?: string }>;
    queryExecutions?: Array<{ query_id?: string; status?: string }>;
  };
  expect(
    manifest.queryExecutions?.filter(({ status }) => status === "cached"),
  ).toEqual([]);
  expect(manifest.queryExecutions?.some(({ status }) => status === "recomputed")).toBe(true);
  expect(manifest.artifacts?.map(({ kind }) => kind)).not.toContain(
    "review-base",
  );
  assertNoExternalRequests(requestTracker);
});

test("@smoke @opfs a plot past the browser canvas limit is left out of Download all ZIP with a warning", async ({
  page,
}) => {
  // One short session a day for 10,000 days: the timeline and heatmap PNGs
  // would be ~280,000 px tall at 28 px a day (~500 M px at 1,800 px wide).
  // Chromium and Firefox cap a canvas side at 32,767 px, but WebKit caps only
  // the area (~268 M px), so 3,000 days (~84,000 px) still drew in WebKit. The
  // longest real export spans 84 days; this is the failure path, not a shape.
  const rows = [APP_AND_SCREEN_RAW_CSV.split("\n")[0]];
  const firstDay = Date.UTC(2018, 0, 1, 15);
  for (let day = 0; day < 10_000; day += 1) {
    const at = (seconds: number) =>
      new Date(firstDay + day * 86_400_000 + seconds * 1_000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
    rows.push(
      `study,P01,Android,Target Child,Chat,Unknown importance: 1,com.example.chat,${at(0)},,,America/Chicago`,
      `study,P01,Android,Target Child,Chat,Unknown importance: 2,com.example.chat,${at(90)},,,America/Chicago`,
    );
  }
  await setInputFile(page, "raw-file-input", "Raw Long.csv", rows.join("\n"), "text/csv");
  await processFiles(page);

  const entries = [...(await downloadZipEntries(page, "download-all-zip")).keys()];
  expect(entries).toContain("Raw Long Automatically Preprocessed.csv");
  expect(entries.filter((name) => name.endsWith(".png"))).toEqual([]);
  const skipped = page.getByTestId("download-skipped");
  await expect(skipped).toContainText("Raw Long App Usage Plot.png");
  await expect(skipped).toContainText("Raw Long App Usage Heatmap.png");
  await expect(page.getByTestId("download-error")).toHaveCount(0);
  assertNoExternalRequests(requestTracker);
});

test("@smoke @opfs B02 persists its binding and refuses the incompatible EYES crossing before execution", async ({
  page,
}) => {
  await expandSectionCard(page, "session-detection");
  const openerSet = page.getByTestId("opener-set-select");
  const reconstruction = page.getByTestId(
    "episode-reconstruction-strategy-select",
  );
  await expect(openerSet).toHaveValue("strategy_defined");
  await openerSet.selectOption("gesis_app_scoped_starts");
  await reconstruction.selectOption("eyes_complement");

  await page.reload();
  await installDeterministicRuntime(page);
  await expandSectionCard(page, "session-detection");
  await expect(page.getByTestId("opener-set-select")).toHaveValue(
    "gesis_app_scoped_starts",
  );
  await expect(
    page.getByTestId("episode-reconstruction-strategy-select"),
  ).toHaveValue("eyes_complement");

  await setInputFile(
    page,
    "raw-file-input",
    "Raw P01.csv",
    APP_ONLY_RAW_CSV,
    "text/csv",
  );
  await page.getByRole("tab", { name: /Process/i }).click();
  await page.getByTestId("process-files-button").click();
  await expect(page.locator(".result-panel .error-text")).toContainText(
    "Opener set gesis_app_scoped_starts is incompatible with the selected reconstruction strategy (eyes_requires_lifecycle_triplets)",
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("result-file-table")).toHaveCount(0);
  assertNoExternalRequests(requestTracker);
});

test("@smoke @opfs B06 persists the maximum-duration vector, truncates strictly above the threshold, and refuses the adaptive source before execution", async ({
  page,
}) => {
  await expandSectionCard(page, "optional-cleaning");
  const policy = page.getByTestId("maximum-duration-policy-select");
  await expect(policy).toHaveValue("");
  await expect(
    page.getByTestId("maximum-duration-disposition-select"),
  ).toHaveCount(0);
  await policy.selectOption("post_reconstruction_strict_max_v1");
  await page
    .getByTestId("maximum-duration-disposition-select")
    .selectOption("truncate_to_threshold");
  await expect(
    page.getByTestId("maximum-duration-threshold-source-select"),
  ).toHaveValue("fixed_parameter");
  // The fixture's only session is exactly 60 s; a 59 s cap qualifies it
  // (strict >) and truncation moves its endpoint to start + 59 s.
  await page
    .getByTestId("maximum-duration-threshold-ns-input")
    .fill("59000000000");

  await page.reload();
  await installDeterministicRuntime(page);
  await expandSectionCard(page, "optional-cleaning");
  await expect(page.getByTestId("maximum-duration-policy-select")).toHaveValue(
    "post_reconstruction_strict_max_v1",
  );
  await expect(
    page.getByTestId("maximum-duration-disposition-select"),
  ).toHaveValue("truncate_to_threshold");
  await expect(
    page.getByTestId("maximum-duration-threshold-source-select"),
  ).toHaveValue("fixed_parameter");
  await expect(
    page.getByTestId("maximum-duration-threshold-ns-input"),
  ).toHaveValue("59000000000");

  await setInputFile(
    page,
    "raw-file-input",
    "Raw P01.csv",
    APP_ONLY_RAW_CSV,
    "text/csv",
  );
  await processFiles(page);
  await expect(page.getByTestId("result-file-table")).toBeVisible();
  const appCsv = await downloadCsv(page, "download-app-csv");
  const headers = csvHeaders(appCsv);
  expect(headers).toEqual(
    expect.arrayContaining([
      "raw_episode_duration_seconds",
      "maximum_duration_qualified",
      "maximum_duration_aggregate_eligible",
      "maximum_duration_trimmed_seconds",
      "effective_endpoint_reason",
    ]),
  );
  const rows = parseCsv(appCsv);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    raw_episode_duration_seconds: "60.0",
    duration_seconds: "59.0",
    maximum_duration_qualified: "true",
    maximum_duration_aggregate_eligible: "true",
    maximum_duration_trimmed_seconds: "1.0",
    effective_endpoint_reason: "maximum_duration_truncation_boundary",
  });

  const zipEntries = await downloadZipEntries(page, "download-all-zip");
  const manifest = JSON.parse(
    zipEntries.get("Raw P01 Runtime Manifest.json") ?? "{}",
  ) as {
    processingSummary?: {
      // The aggregate receipt only; the participant-level excluded lineage
      // lives in the maximum-duration-receipt-json artifact.
      maximumDurationReceipt?: {
        applicability?: Record<string, unknown>;
        boundedEpisodeCount?: number;
        qualifyingCount?: number;
        outcomeCounts?: Record<string, number>;
        trimmedTotalNs?: string;
        excludedLineageDigest?: string;
      };
    };
  };
  const receipt = manifest.processingSummary?.maximumDurationReceipt;
  expect(receipt?.applicability).toMatchObject({
    shape: "explicit_generic_fixed",
    requestedPolicy: "post_reconstruction_strict_max_v1",
    effectivePolicy: "post_reconstruction_strict_max_v1",
    disposition: "truncate_to_threshold",
    thresholdSource: "fixed_parameter",
    thresholdNs: "59000000000",
    relation: "controlled_derivative",
    refusalReason: null,
  });
  expect(receipt?.boundedEpisodeCount).toBe(1);
  expect(receipt?.qualifyingCount).toBe(1);
  expect(receipt?.outcomeCounts).toEqual({ truncated: 1 });
  expect(receipt?.trimmedTotalNs).toBe("1000000000");
  expect(receipt?.excludedLineageDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  // The manifest never carries the participant-level lineage.
  expect(JSON.stringify(receipt)).not.toContain("excludedEpisodes");

  const provenance = JSON.parse(
    zipEntries.get("Raw P01 Workflow Provenance.jsonld") ?? "{}",
  ) as {
    "@graph"?: Array<{
      "chron:knob_key"?: string;
      "chron:knob_value"?: string;
    }>;
  };
  const knobs = new Map(
    (provenance["@graph"] ?? [])
      .filter((node) => typeof node["chron:knob_key"] === "string")
      .map((node) => [node["chron:knob_key"], node["chron:knob_value"]]),
  );
  expect(knobs.get("maximum_duration_policy")).toBe(
    JSON.stringify("post_reconstruction_strict_max_v1"),
  );
  expect(knobs.get("maximum_duration_threshold_ns")).toBe(
    JSON.stringify("59000000000"),
  );

  // The adaptive threshold source is a legal shape with no provider in v1:
  // the request is refused before execution, never silently rebound.
  await page.getByRole("tab", { name: /Settings/i }).click();
  await expandSectionCard(page, "optional-cleaning");
  await page
    .getByTestId("maximum-duration-threshold-source-select")
    .selectOption("b12_adaptive_participant");
  await expect(
    page.getByTestId("maximum-duration-threshold-ns-input"),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: /Process/i }).click();
  await page.getByTestId("process-files-button").click();
  await expect(page.locator(".result-panel .error-text")).toContainText(
    "Maximum-duration policy post_reconstruction_strict_max_v1 cannot run with the selected settings (adaptive_maximum_threshold_provider_unavailable)",
    { timeout: 15_000 },
  );
  assertNoExternalRequests(requestTracker);
});

// The researcher-facing loop is: choose a setting, see its effect on the data,
// then export. The CSV assertions above cover the export half. This covers the
// other half: a maximum-duration truncation has to reach the View tab, which
// reads the Rust-projected visualization-data-json artifact rather than the
// exported CSV, so agreement between the two is a real invariant.
test("@smoke @opfs B06 truncation reaches the View tab, not just the exported CSV", async ({
  page,
}) => {
  await expandSectionCard(page, "optional-cleaning");
  await page
    .getByTestId("maximum-duration-policy-select")
    .selectOption("post_reconstruction_strict_max_v1");
  await page
    .getByTestId("maximum-duration-disposition-select")
    .selectOption("truncate_to_threshold");
  // The fixture's only session is 60 s. A 30 s cap halves it, which the
  // metrics card renders at its one-decimal resolution as 0.5 against the
  // untruncated 1.0 — a 59 s cap would print "1.0" either way and prove
  // nothing about the view.
  await page
    .getByTestId("maximum-duration-threshold-ns-input")
    .fill("30000000000");
  // The waterfall geometry is opt-in; without it the View tab shows metrics
  // but no scene.
  await page.getByTestId("toggle-enableInteractiveTimeline").check();

  await setInputFile(
    page,
    "raw-file-input",
    "Raw P01.csv",
    APP_ONLY_RAW_CSV,
    "text/csv",
  );
  await processFiles(page);
  await expect(page.getByTestId("result-file-table")).toBeVisible();

  const appCsv = await downloadCsv(page, "download-app-csv");
  const rows = parseCsv(appCsv);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    raw_episode_duration_seconds: "60.0",
    duration_seconds: "30.0",
    effective_endpoint_reason: "maximum_duration_truncation_boundary",
  });

  await page.getByRole("tab", { name: /View/i }).click();
  await expect(page.getByTestId("timeline-view")).toBeVisible();
  // The plot draws each bar from stop_timestamp_ns - start_timestamp_ns, so a
  // truncation that only moved the CSV cell and left the endpoint alone would
  // still total 1.0 here.
  const metrics = page.getByTestId("review-metrics");
  await expect(metrics).toBeVisible();
  await expect(
    metrics.locator(".review-mrow", { hasText: "app usage min" }),
  ).toContainText("0.5");
  assertNoExternalRequests(requestTracker);
});

test("processes app and screen outputs with CSV support files and downloads both results", async ({
  page,
}) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");
  await page.getByTestId("toggle-processScreenUsage").check();
  await page.getByTestId("toggle-useAppsForcingScreenOpenFile").check();
  // App filtering is a cleaning step and off by default; this spec exercises it.
  await expandSectionCard(page, "optional-cleaning");
  await page.getByTestId("toggle-useFilterFile").check();
  await setInputFile(page, "filter-file-input", "filter.csv", FILTER_FILE_CSV, "text/csv");
  await setInputFile(page, "apps-forcing-screen-open-file-input", "apps_forcing_screen_open.csv", APPS_FORCING_SCREEN_OPEN_CSV, "text/csv");
  await setInputFile(page, "app-codebook-file-input", "codebook.csv", CODEBOOK_CSV, "text/csv");
  await processFiles(page);
  await expect(page.getByTestId("result-file-table")).toBeVisible();
  await expect(page.locator(".preview-table-wrap")).toHaveCount(0);

  const zipEntries = await downloadZipEntries(page, "download-all-zip");
  const zipNames = Array.from(zipEntries.keys());
  // The old TypeScript-built report remains retired. Provenance returned only
  // after Rust became the sole emitter: the browser transports the JSON-LD
  // bytes but does not reconstruct operations or executions.
  expect(zipNames).not.toContain("chronicle-processing-report.json");
  expect(zipNames).toEqual(
    expect.arrayContaining([
      "Raw P01 Automatically Preprocessed.csv",
      "Raw P01 Screen Usage Automatically Preprocessed.csv",
      "Raw P01 Runtime Manifest.json",
      "Raw P01 Execution Ledger.json",
      "Raw P01 Workflow Provenance.jsonld",
      "Raw P01 Artifact Closure.json",
      "Raw P01 Dependency Certificate.json",
      "Raw P01 Row Lineage.arrow",
    ]),
  );

  const manifest = JSON.parse(
    zipEntries.get("Raw P01 Runtime Manifest.json") ?? "{}",
  ) as Record<string, unknown>;
  expect(manifest.protocolVersion).toBe("chronicle-preprocessing-runtime/v2");
  expect(manifest.preprocessorVersion).toBe("1.0.0");
  // Plots are on by default, so the artifact set also includes plot/derived
  // entries; assert the CSV kinds are present rather than pinning the whole set.
  const artifactKinds = (manifest.artifacts as Array<{ kind: string }>).map(
    (artifact) => artifact.kind,
  );
  expect(artifactKinds).toContain("app-csv");
  expect(artifactKinds).toContain("screen-csv");
  expect(artifactKinds).toContain("workflow-provenance-jsonld");
  const provenance = JSON.parse(
    zipEntries.get("Raw P01 Workflow Provenance.jsonld") ?? "{}",
  ) as { "@graph"?: Array<{ "@type"?: string | string[] }> };
  expect(provenance["@graph"]?.some((node) => node["@type"] === "chron:WorkflowPlan")).toBe(true);
  expect(
    provenance["@graph"]?.some(
      (node) =>
        Array.isArray(node["@type"]) && node["@type"].includes("chron:OperationExecution"),
    ),
  ).toBe(true);
  expect(
    provenance["@graph"]?.some(
      (node) =>
        Array.isArray(node["@type"]) && node["@type"].includes("chron:QueryExecution"),
    ),
  ).toBe(true);
  // Physical query-group and query lineage rides in the manifest itself.
  const queryGroups = manifest.queryGroupExecutions as Array<
    Record<string, unknown>
  >;
  const queries = manifest.queryExecutions as Array<Record<string, unknown>>;
  expect(queryGroups.length).toBeGreaterThan(0);
  expect(new Set(queryGroups.map((group) => group.query_group_id)).size).toBe(
    queryGroups.length,
  );
  expect(queries.length).toBeGreaterThan(0);
  expect(new Set(queries.map((query) => query.query_id)).size).toBe(
    queries.length,
  );
  expect(
    queries.every(
      (query) =>
        query.query_id &&
        query.query_group_id &&
        query.status &&
        query.reason_id,
    ),
  ).toBe(true);

  // The execution ledger exposes the same grouping without pinning a registry
  // cardinality in UI tests.
  const ledger = JSON.parse(
    zipEntries.get("Raw P01 Execution Ledger.json") ?? "[]",
  ) as Array<{ queryGroupId: string; queries: unknown[] }>;
  expect(ledger.length).toBeGreaterThan(0);
  expect(ledger.every((group) => group.queryGroupId.length > 0)).toBe(true);
  expect(ledger.flatMap((group) => group.queries).length).toBe(queries.length);

  // The artifact closure pins each output to the exact inputs it derives from —
  // the derivation edges the PROV-O graph used to spell out.
  const closure = JSON.parse(
    zipEntries.get("Raw P01 Artifact Closure.json") ?? "{}",
  ) as { artifacts: Array<{ kind: string; derivedFrom: string[] }> };
  const closedAppCsv = closure.artifacts.find((artifact) => artifact.kind === "app-csv");
  expect(closedAppCsv?.derivedFrom.length).toBeGreaterThan(0);

  const appCsv = await downloadCsv(page, "download-app-csv");
  const screenCsv = await downloadCsv(page, "download-screen-csv");
  expect(csvHeaders(appCsv)).toContain("bcm_play_store_genreId");
  expect(appCsv).toContain("Filtered App Usage");
  expect(screenCsv).toContain("Screen Usage");
  assertNoExternalRequests(requestTracker);
});

test("searches individual settings and jumps to the matching section (#9)", async ({ page }) => {
  await expect(page.getByTestId("settings-search-input")).toBeVisible();
  await expect(page.getByText("Full Settings Search")).toBeVisible();
  await page.getByTestId("settings-search-input").fill("parallel");
  const results = page.locator(".settings-search-results");
  await expect(results).toContainText("2 settings found");
  // Labels are derived from the contract tooltips, so they match the real option
  // names ("Enable parallel file processing", not a hand-written paraphrase).
  await expect(results).toContainText("Enable parallel file processing");
  await expect(results).toContainText("Max parallel workers");

  // Placement fix: the results render as a dropdown anchored directly below the
  // search box (not pushing page layout, not floating away from the input).
  const searchBox = await page.getByTestId("settings-search-input").boundingBox();
  const resultBox = await results.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(resultBox).not.toBeNull();
  expect(resultBox!.y).toBeGreaterThanOrEqual(searchBox!.y + searchBox!.height - 2);
  // Horizontally overlaps the input (anchored to it), not off in a corner.
  expect(resultBox!.x).toBeLessThan(searchBox!.x + searchBox!.width);
  expect(resultBox!.x + resultBox!.width).toBeGreaterThan(searchBox!.x);

  // Jump fix: each result is an actionable button (not a dead #anchor link) that
  // scrolls to AND flashes the owning section card.
  const result = results.getByRole("button", { name: /Max parallel workers/i });
  await expect(result).toBeVisible();
  await result.click();
  const performanceCard = page.locator('[data-section-id="performance"]');
  await expect(performanceCard).toBeVisible();
  await expect(performanceCard).toHaveClass(/settings-flash/);
  // Clicking a result clears the live filter so the page isn't left filtered.
  await expect(page.getByTestId("settings-search-input")).toHaveValue("");
  await expect(results).toHaveCount(0);
  // The flash is transient and clears itself.
  await expect(performanceCard).not.toHaveClass(/settings-flash/, { timeout: 3_000 });
  assertNoExternalRequests(requestTracker);
});

test("switches workflow tabs as SPA views while preserving state", async ({ page }) => {
  await expect(page.getByRole("tabpanel", { name: /Settings/i })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: /Files/i })).toBeHidden();
  await expect(page.getByRole("tabpanel", { name: /Process/i })).toBeHidden();
  await expect(page.locator("html")).toHaveCSS("overflow-y", "scroll");
  await expect(page.locator("html")).toHaveCSS("scrollbar-gutter", "stable");
  const settingsTitleLeft = await page.locator("#settings-title").evaluate((el) => el.getBoundingClientRect().left);

  await page.getByRole("tab", { name: /Files/i }).click();
  await expect(page.getByRole("tabpanel", { name: /Files/i })).toBeVisible();
  const filesTitleLeft = await page.locator("#files-title").evaluate((el) => el.getBoundingClientRect().left);
  expect(Math.abs(filesTitleLeft - settingsTitleLeft)).toBeLessThan(2);
  await expect(page.getByTestId("settings-search-input")).toBeHidden();
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await expect(page.getByText("1 raw file ready")).toBeVisible();

  await page.getByRole("tab", { name: /Process/i }).click();
  const processPanel = page.getByRole("tabpanel", { name: /Process/i });
  await expect(processPanel).toBeVisible();
  const processTitleLeft = await page.locator("#process-title").evaluate((el) => el.getBoundingClientRect().left);
  expect(Math.abs(processTitleLeft - settingsTitleLeft)).toBeLessThan(2);
  await expect(processPanel.getByText("Raw P01.csv")).toBeVisible();
  await expect(processPanel.getByText("Ready")).toBeVisible();

  await page.getByRole("tab", { name: /Settings/i }).click();
  await expect(page.getByTestId("settings-search-input")).toBeVisible();
  await page.getByRole("tab", { name: /Process/i }).click();
  await expect(processPanel.getByText("Raw P01.csv")).toBeVisible();
  await expect(processPanel.getByText("Ready")).toBeVisible();
  assertNoExternalRequests(requestTracker);
});

test("the View tab is widescreen yet keeps the title/tabs aligned with other tabs", async ({
  page,
}) => {
  // The View tab is intentionally full-width (widescreen) so the timeline + review
  // explorer get room — but the shared chrome (title, tab bar) must stay at the
  // standard centered width and NOT shift right of where it sits on other tabs.
  // Use a wide viewport so the widescreen difference is unambiguous.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);

  const box = (selector: string): Promise<{ left: number; width: number }> =>
    page.locator(selector).first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), width: Math.round(r.width) };
    });

  // Baseline on a non-View tab.
  await page.getByRole("tab", { name: /Settings/i }).click();
  const baseHero = await box(".hero");
  const baseNav = await box(".workflow-nav");
  const basePanels = await box("#workflow-panels");

  await page.getByRole("tab", { name: /View/i }).click();
  await expect(page.getByTestId("timeline-view")).toBeVisible();
  const viewHero = await box(".hero");
  const viewNav = await box(".workflow-nav");
  const viewPanels = await box("#workflow-panels");

  // Title + tab bar keep the same left edge — no rightward shift.
  expect(Math.abs(viewHero.left - baseHero.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(viewNav.left - baseNav.left)).toBeLessThanOrEqual(1);
  // But the panel area goes meaningfully wider than on a normal tab (widescreen).
  expect(viewPanels.width).toBeGreaterThan(basePanels.width + 50);
  assertNoExternalRequests(requestTracker);
});

test("syncs process performance controls without a redundant mode dropdown", async ({ page }) => {
  await expandSectionCard(page, "performance");
  await page.getByTestId("toggle-parallelProcessing").check();
  await page.getByTestId("parallel-max-workers-input").fill("5");

  await page.getByRole("tab", { name: /Process/i }).click();
  await expect(page.locator("#process-mode-select")).toHaveCount(0);
  await expect(page.getByTestId("parallel-max-workers-process-input")).toHaveValue("5");
  await expect(page.getByTestId("parallel-max-workers-process-input")).toBeEnabled();

  await page.getByTestId("toggle-parallelProcessing-process").uncheck();
  await expect(page.getByTestId("parallel-max-workers-process-input")).toBeDisabled();

  await page.getByRole("tab", { name: /Settings/i }).click();
  await expect(page.getByTestId("toggle-parallelProcessing")).not.toBeChecked();
  await expect(page.getByTestId("parallel-max-workers-input")).toHaveValue("5");
  await expect(page.getByTestId("parallel-max-workers-input")).toBeDisabled();

  await page.getByRole("tab", { name: /Process/i }).click();
  await page.getByTestId("toggle-parallelProcessing-process").check();
  await page.getByTestId("parallel-max-workers-process-input").fill("3");

  await page.getByRole("tab", { name: /Settings/i }).click();
  await expect(page.getByTestId("toggle-parallelProcessing")).toBeChecked();
  await expect(page.getByTestId("parallel-max-workers-input")).toHaveValue("3");
  assertNoExternalRequests(requestTracker);
});

test("has no automated axe accessibility violations across workflow tabs", async ({ page }) => {
  for (const tabName of ["Settings", "Files", "Process"]) {
    await page.getByRole("tab", { name: new RegExp(tabName, "i") }).click();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  }
  assertNoExternalRequests(requestTracker);
});

test("supports keyboard-only skip and workflow tab navigation", async ({ page, browserName }) => {
  const settingsTab = page.getByRole("tab", { name: /Settings/i });
  const filesTab = page.getByRole("tab", { name: /Files/i });
  const guideTab = page.getByRole("tab", { name: /Guide/i });
  const graphTab = page.getByRole("tab", { name: /Graph/i });

  // Safari's Tab moves between form fields only; a keyboard user reaches
  // links and buttons with Option+Tab (measured: plain Tab lands on the
  // settings search box in WebKit, Option+Tab on the skip link).
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(page.getByRole("link", { name: /Skip to workflow tabs/i })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#workflow-panels")).toBeFocused();

  await settingsTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(filesTab).toBeFocused();
  await expect(filesTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(graphTab).toBeFocused();
  await expect(graphTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(guideTab).toBeFocused();
  await expect(guideTab).toHaveAttribute("aria-selected", "true");
  assertNoExternalRequests(requestTracker);
});

test("does not rely on color alone for file status", async ({ page }) => {
  // Screen events included: with screen usage on (the default) an app-only
  // export is flagged for review because its screen output would be empty.
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");
  await page.getByRole("tab", { name: /Files/i }).click();
  const filesPanel = page.getByRole("tabpanel", { name: /Files/i });
  await expect(filesPanel.getByText("Success: Ready")).toBeVisible();

  // Amber: a cosmetic warning. Every required column is present; only the
  // extension is unusual, so the file is still processable.
  await setInputFile(
    page,
    "raw-file-input",
    "Raw P01.txt",
    APP_AND_SCREEN_RAW_CSV,
    "text/plain",
  );
  await expect(filesPanel.getByText("Warning: Review")).toBeVisible();

  // Red: a blocking error. This one has none of the required columns, and the
  // three states must be told apart by their text, not only their colour.
  await setInputFile(page, "raw-file-input", "Raw Bad.txt", "not,a,raw,file", "text/plain");
  await expect(filesPanel.getByText("Error: Missing columns")).toBeVisible();
  await expect(filesPanel.getByText("Warning: Review")).toHaveCount(0);
  assertNoExternalRequests(requestTracker);
});

test("supports reduced motion, forced colors, and practical pointer targets", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await page.locator(".btn").first().evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      transitionDuration: style.transitionDuration,
      animationName: style.animationName,
    };
  });
  expect(reducedMotion).toEqual({ transitionDuration: "0s", animationName: "none" });

  await page.emulateMedia({ forcedColors: "active" });
  await page.getByRole("tab", { name: /Process/i }).click();
  const forcedColors = await page.getByRole("tab", { name: /Process/i }).evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderColor,
    };
  });
  expect(forcedColors.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(forcedColors.color).not.toBe(forcedColors.backgroundColor);
  expect(forcedColors.borderColor).not.toBe("rgba(0, 0, 0, 0)");

  const targetFailures = await page.evaluate(() => {
    const selectors = [".btn", ".input", ".select", "[role='tab']", "input[type='file']"];
    return selectors.flatMap((selector) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            element.getAttribute("aria-hidden") !== "true" &&
            !element.classList.contains("visually-hidden-file-input")
          );
        })
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width < 44 || rect.height < 44;
        })
        .map((element) => {
          const label = element.textContent?.trim() || element.getAttribute("data-testid") || element.tagName;
          return `${selector}: ${label}`;
        }),
    );
  });
  expect(targetFailures).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

test("prefers-contrast: more does not break layout or hide content", async ({ page }) => {
  // Emulate the media feature itself rather than injecting a stylesheet that
  // simulates it: the app ships `style-src 'self'` (no 'unsafe-inline'), so
  // page.addStyleTag is blocked by CSP — correctly, and the CSP must not be
  // loosened for a test. emulateMedia drives the real `prefers-contrast: more`
  // state, so any rule the app adds for it is genuinely exercised.
  await page.emulateMedia({ colorScheme: "light", forcedColors: "none", contrast: "more" });
  await gotoApp(page);
  await expect(page.getByRole("tab", { name: /Settings/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Files/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Process/i })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  assertNoExternalRequests(requestTracker);
});

test("reflows at narrow widths without page-level horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  for (const tabName of ["Settings", "Files", "Process"]) {
    await page.getByRole("tab", { name: new RegExp(tabName, "i") }).click();
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth + 1);
    expect(overflow.bodyWidth).toBeLessThanOrEqual(overflow.viewportWidth + 1);
  }
  assertNoExternalRequests(requestTracker);
});

test("validates selected raw files before processing", async ({ page }) => {
  const badRawCsv = [
    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone,timezone",
    "Study,P01,Target Child,Chat,Unknown importance: 1,com.example.chat,not-a-date,Not/AZone,Not/AZone",
    "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,,America/Chicago,America/Chicago",
    "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:00:00,,",
    "Study,P01,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:00:00,America/Chicago,America/Chicago",
  ].join("\n");

  await setInputFile(page, "raw-file-input", "Raw P01.txt", badRawCsv, "text/plain");

  await page.getByRole("tab", { name: /Files/i }).click();
  const filesPanel = page.getByRole("tabpanel", { name: /Files/i });
  await expect(filesPanel.getByText("File extension is not .csv.")).toBeVisible();
  await expect(filesPanel.getByText("Duplicate column headers found.")).toBeVisible();
  await expect(filesPanel.getByText(/rows have invalid event_timestamp values/)).toBeVisible();
  await expect(filesPanel.getByText(/Invalid timezone values/)).toBeVisible();
  assertNoExternalRequests(requestTracker);
});

test("accepts an XLSX filter file and still produces filtered app usage locally", async ({
  page,
}) => {
  const xlsxBytes = await createFilterWorkbookBytes();
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");
  // App filtering is a cleaning step and off by default; this spec exercises it.
  await expandSectionCard(page, "optional-cleaning");
  await page.getByTestId("toggle-useFilterFile").check();
  await setInputFile(
    page,
    "filter-file-input",
    "filter.xlsx",
    xlsxBytes,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  await processFiles(page);

  const appCsv = await downloadCsv(page, "download-app-csv");
  expect(appCsv).toContain("Filtered App Usage");
  assertNoExternalRequests(requestTracker);
});

test("discovers timezones and honors selected-filter output behavior", async ({ page }) => {
  await setInputFile(
    page,
    "raw-file-input",
    "Raw Mixed.csv",
    MIXED_TIMEZONE_RAW_CSV,
    "text/csv",
  );
  await page.getByTestId("discover-timezones-button").click();
  await page.getByTestId("selected-timezone-input").fill("America/Chicago");
  await page.getByTestId("timezone-handling-select").selectOption("selected-filter");
  await processFiles(page);

  const appCsv = await downloadCsv(page, "download-app-csv");
  const rows = parseCsv(appCsv);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.timezone).toBe("America/Chicago");
  expect(appCsv).not.toContain("America/New_York");
  assertNoExternalRequests(requestTracker);
});

test("does not silently bind a multi-timezone input to the first discovered candidate", async ({
  page,
}) => {
  await setInputFile(
    page,
    "raw-file-input",
    "Raw Mixed.csv",
    MIXED_TIMEZONE_RAW_CSV,
    "text/csv",
  );
  await page.getByTestId("discover-timezones-button").click();
  await expect(page.getByTestId("selected-timezone-input")).toHaveValue("");

  await page.getByRole("tab", { name: /Process/i }).click();
  await page.getByTestId("process-files-button").click();
  await expect(page.locator(".error-text")).toContainText(
    /found multiple candidates.*Choose one explicitly/i,
  );
  await expect(page.getByTestId("result-panel")).toHaveCount(0);
  assertNoExternalRequests(requestTracker);
});

test("converts mixed-timezone data into the selected timezone", async ({ page }) => {
  await setInputFile(
    page,
    "raw-file-input",
    "Raw Mixed.csv",
    MIXED_TIMEZONE_RAW_CSV,
    "text/csv",
  );
  await page.getByTestId("selected-timezone-input").fill("America/Chicago");
  await page.getByTestId("timezone-handling-select").selectOption("selected-convert");
  await processFiles(page);

  const appCsv = await downloadCsv(page, "download-app-csv");
  const rows = parseCsv(appCsv);
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((row) => row.timezone))).toEqual(new Set(["America/Chicago"]));
  assertNoExternalRequests(requestTracker);
});

test("drops codebook-enriched columns when app codebook use is disabled", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByTestId("toggle-useAppCodebook").uncheck();
  await processFiles(page);

  const appCsv = await downloadCsv(page, "download-app-csv");
  const headers = csvHeaders(appCsv);
  expect(headers).not.toContain("genreId_scraped");
  expect(headers).not.toContain("bcm_play_store_genreId");
  assertNoExternalRequests(requestTracker);
});

test("emits aggregate summary outputs when aggregates are enabled (#8/#13/#15)", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByTestId("toggle-enableAggregates").check();
  await processFiles(page);

  // The opt-in aggregate outputs produced a dedicated download and result chips.
  await expect(page.getByTestId("download-aggregates-zip")).toBeVisible();
  await expect(page.getByTestId("result-panel")).toContainText("Aggregate CSV");
  assertNoExternalRequests(requestTracker);
});

test("emits the participant amount summary only when its own toggle is on", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByTestId("toggle-enableParticipantAmountSummary").check();
  await processFiles(page);

  // The summary rides the aggregate download group on its own toggle, with
  // the sibling aggregate summaries still off.
  await expect(page.getByTestId("download-aggregates-zip")).toBeVisible();
  const entries = await downloadZipEntries(page, "download-aggregates-zip");
  const names = Array.from(entries.keys());
  const summaryName = names.find((name) => name.endsWith(" Participant Amount Summary.csv"));
  expect(summaryName, `expected the amount summary among ${names.join(", ")}`).toBeDefined();
  expect(names.some((name) => name.endsWith(" Daily Summary.csv"))).toBe(false);
  const rows = parseCsv(entries.get(summaryName ?? "") ?? "");
  expect(Object.keys(rows[0] ?? {})).toEqual([
    "participant_id",
    "days_tracked",
    "total_app_usage_minutes",
    "daily_average_minutes",
    "daily_average_minutes_winsorized",
    "huber_m_daily_minutes",
    "sample_p1_minutes",
    "sample_p99_minutes",
  ]);
  expect(rows.length).toBeGreaterThan(0);
  assertNoExternalRequests(requestTracker);
});

test("emits Parquet outputs when Parquet export is enabled (#7)", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByTestId("toggle-enableParquetExport").check();
  await processFiles(page);

  await expect(page.getByTestId("download-parquet-zip")).toBeVisible();
  await expect(page.getByTestId("result-panel")).toContainText("Parquet");
  assertNoExternalRequests(requestTracker);
});

test("emits SPSS .sav outputs when SPSS export is enabled (#9)", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByTestId("toggle-enableSpssExport").check();
  await processFiles(page);

  await expect(page.getByTestId("download-spss-zip")).toBeVisible();
  await expect(page.getByTestId("result-panel")).toContainText("SPSS .sav");
  assertNoExternalRequests(requestTracker);
});

test("exports an HTML timeline viewer when the option is enabled (#18)", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByTestId("toggle-enableInteractiveTimeline").check();
  await page.getByTestId("toggle-includeFilteredAppUsageInPlots").check();
  await processFiles(page);

  await expect(page.getByTestId("download-timeline-viewer")).toBeVisible();
  assertNoExternalRequests(requestTracker);
});

test("@smoke @opfs the exported HTML timeline viewer runs its inlined interactivity offline (#18)", async ({
  page,
}, testInfo) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByTestId("toggle-enableInteractiveTimeline").check();
  await processFiles(page);

  // Capture the exported .html artifact the user would double-click.
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-timeline-viewer").click();
  const download = await downloadPromise;
  const htmlPath = testInfo.outputPath("timeline-viewer.html");
  await download.saveAs(htmlPath);

  // Open it as a standalone file (file://), fully offline — the inlined script
  // is the only thing that makes it interactive, and nothing else in this repo
  // executes that script, so this is the test that proves it actually works.
  const viewer = await page.context().newPage();
  const scriptErrors: string[] = [];
  viewer.on("pageerror", (error) => scriptErrors.push(String(error)));
  viewer.on("console", (msg) => {
    if (msg.type() === "error" && !/favicon|Failed to load resource/i.test(msg.text())) {
      scriptErrors.push(msg.text());
    }
  });
  // The offline runtime has a 320 CSS-pixel minimum canvas. A narrow viewport
  // therefore turns its one-scene-unit minimum session bar into a true
  // sub-pixel target (about 0.3 CSS px), exercising the expanded hover seam.
  await viewer.setViewportSize({ width: 360, height: 900 });
  await viewer.goto(pathToFileURL(htmlPath).href);

  // (1) The inlined runtime parsed and ran with no errors.
  expect(scriptErrors).toEqual([]);

  // ...and it sized + drew the canvas (a real backing store, not the 300px default).
  const canvas = viewer.locator('[data-tv-type="app"][data-tv-index="0"] .tv-canvas');
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () => canvas.evaluate((c) => (c as HTMLCanvasElement).width))
    .toBeGreaterThan(320);

  // (2) Switching tabs toggles the active panel.
  await viewer.locator('[data-tv-tab="screen"]').click();
  await expect(viewer.locator('[data-tv-panel="screen"]')).toHaveClass(/is-active/);
  await viewer.locator('[data-tv-tab="app"]').click();
  await expect(viewer.locator('[data-tv-panel="app"]')).toHaveClass(/is-active/);

  // (3) Hovering a session bar shows the per-session detail tooltip. The bar's
  // screen position is derived from the embedded scene at the auto-fit transform
  // (scale = width / sceneWidth, tx = ty = 0).
  const target: { x: number; nearX: number; y: number; title: string; cssWidth: number } = await viewer.evaluate(() => {
    const data = JSON.parse(document.getElementById("tv-data")!.textContent) as unknown;
    const view = (data as Record<string, unknown>).app as Array<Record<string, unknown>>;
    const regions = view[0]?.regions as Array<Record<string, unknown>>;
    const region = regions.reduce((smallest, candidate) =>
      (candidate.w as number) < (smallest.w as number) ? candidate : smallest,
    );
    const el = document.querySelector(
      '[data-tv-type="app"][data-tv-index="0"] .tv-canvas',
    ) as HTMLCanvasElement;
    const rect = el.getBoundingClientRect();
    const scale = rect.width / ((view[0]?.scene as Record<string, unknown>)?.width as number);
    const left = rect.left + ((region.x as number) ?? 0) * scale;
    const cssWidth = ((region.w as number) ?? 0) * scale;
    return {
      x: left + cssWidth / 2,
      // Firefox integerizes mouse coordinates. Choose the nearest integer that
      // is still strictly outside the real bar so both engines exercise the
      // expanded hover seam rather than an exact hit.
      nearX: Math.ceil(left) - 1,
      y: rect.top + (((region.y as number) ?? 0) + (((region.h as number) ?? 0) / 2)) * scale,
      title: region.title as string,
      cssWidth,
    };
  });
  const tooltip = viewer.locator('[data-tv-type="app"][data-tv-index="0"] .tv-tooltip');
  expect(target.cssWidth).toBeLessThan(1);
  await viewer.mouse.move(target.nearX, target.y);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(target.title);

  const beforeZoom = await canvas.evaluate((c) => ({
    bitmap: (c as HTMLCanvasElement).toDataURL(),
    height: (c as HTMLCanvasElement).getBoundingClientRect().height,
  }));
  await viewer.mouse.move(target.x, target.y);
  await viewer.keyboard.down("Shift");
  await viewer.mouse.wheel(-240, 0);
  await viewer.keyboard.up("Shift");
  await expect
    .poll(async () => canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL()))
    .not.toBe(beforeZoom.bitmap);
  const afterZoomHeight = await canvas.evaluate((c) => (c as HTMLCanvasElement).getBoundingClientRect().height);
  expect(afterZoomHeight).toBe(beforeZoom.height);

  await viewer.mouse.move(target.x, target.y);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(target.title);
  // ...including the exact start → stop usage time.
  await expect(tooltip).toContainText("→");

  await viewer.close();
  assertNoExternalRequests(requestTracker);
});

test("View tab renders the review surface (rail, metrics, timeline) with file and type dropdowns (#18)", async ({
  page,
}, testInfo) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");
  // App filtering is a cleaning step and off by default; this spec asserts
  // filtered events appear in the review rail, so turn it on.
  await expandSectionCard(page, "optional-cleaning");
  await page.getByTestId("toggle-useFilterFile").check();
  await setInputFile(page, "filter-file-input", "filter.csv", FILTER_FILE_CSV, "text/csv");
  await page.getByTestId("toggle-enableInteractiveTimeline").check();
  await page.getByTestId("toggle-includeFilteredAppUsageInPlots").check();
  await expect(page.getByTestId("toggle-includeFilteredAppUsageInPlots")).toBeChecked();
  await processFiles(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-timeline-viewer").click();
  const download = await downloadPromise;
  const htmlPath = testInfo.outputPath("timeline-viewer-view-tab-reference.html");
  await download.saveAs(htmlPath);
  const html = await readFile(htmlPath, "utf-8");
  const dataMatch = html.match(/<script type="application\/json" id="tv-data">([^<]*)<\/script>/);
  expect(dataMatch).not.toBeNull();
  const dataJson = dataMatch?.[1];
  if (dataJson === undefined) throw new Error("interactive HTML is missing its tv-data payload");
  const data = JSON.parse(dataJson) as unknown;
  const view = (data as Record<string, unknown>).app as Array<Record<string, unknown>>;
  const includedView = ((data as Record<string, unknown>).appFilteredIncluded as Array<Record<string, unknown>> | undefined)?.[0] ?? view[0];
  const excludedView = ((data as Record<string, unknown>).appFilteredExcluded as Array<Record<string, unknown>> | undefined)?.[0];
  expect(
    ((includedView?.regions as Array<{ lines: string[] }>) ?? []).some((r) =>
      r.lines.some((line) => line.includes("Filtered App Usage event")),
    ),
  ).toBe(true);
  expect(
    ((excludedView?.regions as Array<{ lines: string[] }>) ?? []).some((r) =>
      r.lines.some((line) => line.includes("Filtered App Usage event")),
    ) ?? false,
  ).toBe(false);

  await page.getByRole("tab", { name: /View/i }).click();
  await expect(page.getByTestId("timeline-view")).toBeVisible();
  const fileSearch = page.getByTestId("timeline-view-file");
  await expect(fileSearch).toBeVisible();
  await expect(fileSearch).toHaveAttribute("role", "combobox");
  await fileSearch.fill("P01");
  await page.getByRole("option", { name: "Raw P01.csv" }).click();
  await expect(fileSearch).toHaveValue("Raw P01.csv");
  await expect(page.getByTestId("timeline-view-type")).toBeVisible();
  await expect(page.locator(".timeline-view__hint")).toHaveText("Shift scroll a row to zoom · drag zoomed rows · double click to reset");
  const controlsBox = await page.locator(".timeline-view__controls").boundingBox();
  const panelBox = await page.getByTestId("timeline-view").boundingBox();
  expect(controlsBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect(Math.abs((controlsBox!.x + controlsBox!.width / 2) - (panelBox!.x + panelBox!.width / 2))).toBeLessThan(3);
  await expect(page.getByTestId("timeline-view-participant-title").first()).toContainText(
    "P01 · App usage · Filtered usage included · America/Chicago",
  );
  const filteredToggle = page.getByTestId("timeline-view-filtered-toggle");
  await expect(filteredToggle).toBeChecked();
  const canvas = page.locator(".timeline-view__canvas").first();
  await expect(canvas).toBeVisible();
  await expect(page.locator(".timeline-view__scene").first()).toHaveCSS("overflow", "visible");
  const includedBitmap = await canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  await filteredToggle.uncheck();
  await expect(page.getByTestId("timeline-view-participant-title").first()).toContainText(
    "P01 · App usage · Filtered usage excluded · America/Chicago",
  );
  await expect(filteredToggle).not.toBeChecked();
  await expect
    .poll(async () => canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL()))
    .not.toBe(includedBitmap);
  await filteredToggle.check();
  await expect(page.getByTestId("timeline-view-participant-title").first()).toContainText(
    "P01 · App usage · Filtered usage included · America/Chicago",
  );
  await expect
    .poll(async () => canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL()))
    .toBe(includedBitmap);
  await filteredToggle.uncheck();
  await expect(page.getByTestId("timeline-view-participant-title").first()).toContainText(
    "P01 · App usage · Filtered usage excluded · America/Chicago",
  );
  await expect
    .poll(async () => canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL()))
    .not.toBe(includedBitmap);

  const zoomView = excludedView ?? view[0];
  const region = (zoomView?.regions as Array<{ lines: string[] }>)?.find((r) => r.lines.some((line) => line.includes("→")));
  expect(region).toBeDefined();

  const target: { x: number; y: number; title: string } = await canvas.evaluate(
    (el, payload: { region: Record<string, unknown>; scene: Record<string, unknown> }) => {
      const rect = el.getBoundingClientRect();
      const scale = rect.width / (payload.scene.width as number);
      return {
        x: rect.left + (((payload.region.x as number) ?? 0) + (((payload.region.w as number) ?? 0) / 2)) * scale,
        y: rect.top + (((payload.region.y as number) ?? 0) + (((payload.region.h as number) ?? 0) / 2)) * scale,
        title: payload.region.title as string,
      };
    },
    { region: region as Record<string, unknown>, scene: zoomView?.scene as Record<string, unknown> },
  );
  const beforeZoom = await canvas.evaluate((c) => ({
    bitmap: (c as HTMLCanvasElement).toDataURL(),
    height: (c as HTMLCanvasElement).getBoundingClientRect().height,
  }));
  await page.mouse.move(target.x, target.y);
  await page.keyboard.down("Shift");
  await page.mouse.wheel(-240, 0);
  await page.keyboard.up("Shift");
  await expect
    .poll(async () => canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL()))
    .not.toBe(beforeZoom.bitmap);
  const afterZoomBitmap = await canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  await page.mouse.down();
  await page.mouse.move(target.x + 48, target.y);
  await page.mouse.up();
  const afterPan = await canvas.evaluate((c) => ({
    bitmap: (c as HTMLCanvasElement).toDataURL(),
    height: (c as HTMLCanvasElement).getBoundingClientRect().height,
  }));
  expect(afterPan.bitmap).not.toBe(afterZoomBitmap);
  expect(afterPan.height).toBe(beforeZoom.height);
  await page.mouse.dblclick(target.x, target.y);
  await expect
    .poll(async () => canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL()))
    .toBe(beforeZoom.bitmap);

  await page.mouse.move(target.x, target.y);
  const tooltip = page.locator(".timeline-view__tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(target.title);
  await expect(tooltip).toContainText("→");

  // New review panes render alongside the timeline (network-free).
  await expect(page.getByTestId("review-rail")).toBeVisible();
  await expect(page.getByTestId("review-rail-row").first()).toContainText("P01");
  await expect(page.getByTestId("review-metrics")).toBeVisible();
  const dayRows = page.getByTestId("review-day-table").locator("tbody tr");
  await expect(dayRows.first()).toBeVisible();
  await dayRows.first().click();
  await expect(page.getByTestId("review-day-detail")).toBeVisible();

  assertNoExternalRequests(requestTracker);
});

test("View tab compares the run against a second config (Arm B) in-browser", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");
  // Per-session timeline geometry is opt-in (it is the heavy part of a result),
  // so Arm A only has a scene to draw when this is on. The closing assertion —
  // exactly ONE scene after the comparison — is only meaningful with a scene.
  await page.getByTestId("toggle-enableInteractiveTimeline").check();
  await processFiles(page);

  await page.getByRole("tab", { name: /View/i }).click();
  await expect(page.getByTestId("timeline-view")).toBeVisible();
  await expect(page.getByTestId("timeline-view-participant-title")).toHaveCount(1);

  // Open the Arm-B drawer and re-run the same file under it.
  await page.getByTestId("review-compare-toggle").click();
  const drawer = page.getByTestId("review-compare-drawer");
  await expect(drawer).toBeVisible();
  // Change a high-impact option within the drawer (scoped so it does not collide
  // with the Settings-tab control of the same testid). The fixture's sessions
  // are 10 s and 60 s, so the maximum in-range minimum-usage duration (3600 s,
  // per OPTION_NUMERIC_RANGES.minimumUsageDuration) blanks every one of them and
  // Arm B differs from Arm A. It must stay in range: the drawer now runs the
  // same bounds gate the Process button runs, so the old 999999 renders the
  // `review-range-block` refusal and DISABLES the Run button — the comparison
  // never dispatches and there are no Arm-B metrics to assert. The disabled
  // path is covered directly in CompareConfigDrawer.test.tsx.
  await drawer
    .locator('[data-section-id="optional-cleaning"] .section-card__header')
    .click();
  await drawer.getByTestId("minimum-usage-duration-input").fill("3600");
  await page.getByTestId("review-run-comparison").click();

  // B and Δ metric cards appear; the day table gains A/B/Δ columns.
  await expect(page.getByTestId("review-mcard-b")).toBeVisible();
  await expect(page.getByTestId("review-mcard-delta")).toBeVisible();
  await expect(page.getByTestId("review-day-table").locator("thead th")).toHaveText([
    "DAY",
    "A",
    "B",
    "Δ",
  ]);

  // The fast comparison deliberately returns compact Rust metrics rather than
  // rebuilding Arm-B timeline geometry: Arm A's single scene stays on screen,
  // and no second scene is materialized for B.
  await expect(page.getByTestId("review-compare-no-overlap")).toContainText(
    "fast comparison updated the Δ metrics",
  );
  await expect(page.getByTestId("timeline-view-participant-title")).toHaveCount(1);

  assertNoExternalRequests(requestTracker);
});

test("restores last processed results after refresh and collapses process details", async ({
  page,
}) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);

  await expect(page.getByTestId("result-panel")).toBeVisible();
  await expect(page.locator("#process-details")).toBeHidden();
  await expect(page.getByRole("button", { name: "Show processing details" })).toBeVisible();
  const resultsToggle = page.getByTestId("results-collapse-toggle");
  await expect(resultsToggle).toHaveText("▾ Hide results details");
  await resultsToggle.click();
  await expect(resultsToggle).toHaveText("▸ Show results details");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" })).toBeVisible();
  await expect(page.getByTestId("result-panel")).toBeVisible();
  await expect(page.getByTestId("result-panel")).toContainText("1 file processed");
  await expect(page.getByTestId("result-file-table")).toContainText(
    "No cleaning applied",
  );
  await expect(page.locator("#process-details")).toBeHidden();
  await expect(page.getByRole("button", { name: "Show processing details" })).toBeVisible();
  // The restore is lightweight: the browser-only blobs and per-session timeline
  // geometry are dropped before persisting (so a big batch can't exhaust
  // memory/quota on the next boot), but `toLightweightResults` keeps every
  // receipt-pinned Rust output, so those stay downloadable — the note says so,
  // and the ZIP must really rebuild from verified OPFS, not just look clickable.
  await expect(page.getByTestId("restored-lightweight-note")).toContainText(
    "Rust outputs and static plots remain downloadable",
  );
  await expect(page.getByTestId("download-all-zip")).toBeEnabled();
  const restoredZip = await downloadZipEntries(page, "download-all-zip");
  expect(Array.from(restoredZip.keys())).toContain(
    "Raw P01 Automatically Preprocessed.csv",
  );
  expect(JSON.parse(restoredZip.get("Build Info.json") ?? "{}")).toMatchObject({
    contract_version: 6,
    settings_schema_version: 16,
  });
  expect(JSON.parse(restoredZip.get("Cleaning Summary.json") ?? "{}")).toEqual({
    files: [{ input_file_name: "Raw P01.csv", steps: [] }],
  });
  expect(parseCsv(restoredZip.get("Raw P01 Automatically Preprocessed.csv") ?? "").length)
    .toBeGreaterThan(0);

  // Delete results: the panel empties AND the persisted copy is gone, so a
  // further refresh starts clean instead of restoring the run again.
  await page.getByTestId("delete-results").click();
  await page.getByTestId("delete-results-dialog-confirm").click();
  await expect(page.getByTestId("result-panel")).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
  ).toBeVisible();
  await expect(page.getByTestId("result-panel")).toBeHidden();
  assertNoExternalRequests(requestTracker);
});

test("shows result warnings for suspicious successful outputs", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await page.getByTestId("toggle-processScreenUsage").check();
  await processFiles(page);

  const row = page.getByTestId("result-row").first();
  await expect(row).toContainText("Zero screen usage rows");
  await expect(row).toContainText("contains zero data rows");
  assertNoExternalRequests(requestTracker);
});

test("classifies keep-awake screen sessions through the local screen pipeline", async ({
  page,
}) => {
  const appsForcingScreenOpenRawCsv = [
    "study_id,participant_id,possible_device_model,username,application_label,interaction_type,app_package_name,event_timestamp,start_timestamp,stop_timestamp,timezone",
    "study,P01,Android,Target Child,System,Unknown importance: 15,android,2026-03-07 10:00:00,,,America/Chicago",
    "study,P01,Android,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:05,,,America/Chicago",
    "study,P01,Android,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:00:10,,,America/Chicago",
    "study,P01,Android,Target Child,System,Unknown importance: 16,android,2026-03-07 10:02:30,,,America/Chicago",
  ].join("\n");

  await setInputFile(page, "raw-file-input", "Raw P01.csv", appsForcingScreenOpenRawCsv, "text/csv");
  await page.getByTestId("toggle-processScreenUsage").check();
  await page.getByTestId("toggle-useAppsForcingScreenOpenFile").check();
  await setInputFile(page, "apps-forcing-screen-open-file-input", "apps_forcing_screen_open.csv", APPS_FORCING_SCREEN_OPEN_CSV, "text/csv");
  await processFiles(page);

  const screenCsv = await downloadCsv(page, "download-screen-csv");
  expect(screenCsv).toContain("app_kept_awake_or_extended");
  expect(screenCsv).toContain("Chat");
  assertNoExternalRequests(requestTracker);
});

test("changes output semantics when Activity Stopped fallback is disabled", async ({ page }) => {
  const fallbackRawCsv = [
    "study_id,participant_id,possible_device_model,username,application_label,interaction_type,app_package_name,event_timestamp,start_timestamp,stop_timestamp,timezone",
    "study,P01,Android,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,,,America/Chicago",
    "study,P01,Android,Target Child,Chat,Unknown importance: 23,com.example.chat,2026-03-07 10:05:00,,,America/Chicago",
    "study,P01,Android,Target Child,System,Unknown importance: 10,android,2026-03-07 10:10:00,,,America/Chicago",
  ].join("\n");

  await setInputFile(page, "raw-file-input", "Raw P01.csv", fallbackRawCsv, "text/csv");
  await processFiles(page);
  const fallbackOnCsv = await downloadCsv(page, "download-app-csv");
  const fallbackOnRows = parseCsv(fallbackOnCsv);
  expect(fallbackOnRows[0]?.interaction_type).toBe("App Usage");
  expect(fallbackOnRows[0]?.duration_seconds).toBe("300.0");

  // One navigation reboots the app (the init script from the first load still
  // applies). A reload followed at once by a goto aborted the reload's boot
  // fetches, which surfaced as an uncaught "Failed to fetch".
  await gotoApp(page);
  await setInputFile(page, "raw-file-input", "Raw P01.csv", fallbackRawCsv, "text/csv");
  await page.getByRole("tab", { name: /Settings/i }).click();
  await expandSectionCard(page, "session-detection");
  await page.getByTestId("toggle-useActivityStoppedAsFallback").uncheck();
  await processFiles(page);
  const fallbackOffCsv = await downloadCsv(page, "download-app-csv");
  const fallbackOffRows = parseCsv(fallbackOffCsv);
  expect(fallbackOffRows[0]?.interaction_type).toBe("App Usage");
  expect(fallbackOffRows[0]?.duration_seconds).toBe("600.0");
  assertNoExternalRequests(requestTracker);
});

test("handles malformed raw CSV input with a visible local error", async ({ page }) => {
  await setInputFile(page, "raw-file-input", "Raw Broken.csv", MALFORMED_RAW_CSV, "text/csv");
  await page.getByRole("tab", { name: /Process/i }).click();
  await page.getByTestId("process-files-button").click();
  await expect(page.locator(".error-text")).toContainText("Invalid event_timestamp");
  assertNoExternalRequests(requestTracker);
});

test("processes multiple uploaded files with parallel workers enabled", async ({ page }) => {
  await page.getByTestId("raw-file-input").setInputFiles([
    {
      name: "Raw P01.csv",
      mimeType: "text/csv",
      // File A of the multi-file upload is the standard P01 fixture; only
      // file B differs, so the two files carry different participants.
      buffer: Buffer.from(APP_ONLY_RAW_CSV, "utf-8"),
    },
    {
      name: "Raw P02.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(MULTI_FILE_RAW_CSV_B, "utf-8"),
    },
  ]);
  await expandSectionCard(page, "performance");
  await page.getByTestId("toggle-parallelProcessing").check();
  await page.getByTestId("parallel-max-workers-input").fill("2");
  await processFiles(page);
  await expect(page.getByTestId("result-panel")).toContainText("2 files processed");
  assertNoExternalRequests(requestTracker);
});

test("large result batches defer per-output controls and reset that choice for the next run", async ({
  page,
}) => {
  const files = (prefix: string) =>
    Array.from({ length: 21 }, (_, index) => ({
      name: `${prefix} P${String(index + 1).padStart(2, "0")}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(APP_ONLY_RAW_CSV, "utf-8"),
    }));
  const run = async (): Promise<void> => {
    await page.getByRole("tab", { name: /Process/i }).click();
    await page.getByTestId("process-files-button").click();
    await expect(page.getByTestId("result-panel")).toContainText(
      "21 files processed",
      { timeout: 15_000 },
    );
  };

  // ResultPanel was already mounted with zero results before this first run;
  // the large-batch default must still be collapsed when results arrive.
  await page.getByTestId("raw-file-input").setInputFiles(files("First"));
  await run();
  const toggle = page.getByTestId("results-collapse-toggle");
  await expect(toggle).toHaveText("▸ Show results details");
  await expect(page.getByTestId("result-file-table")).toHaveCount(0);
  await expect(page.getByTestId("download-single-output")).toHaveCount(0);

  await toggle.click();
  await expect(page.getByTestId("result-file-table")).toBeVisible();
  await expect(page.getByTestId("result-row")).toHaveCount(21);

  // Selecting a genuinely new batch clears the explicit open override. The
  // next large run must not eagerly rebuild the thousands-of-controls DOM.
  await page.getByRole("tab", { name: /Files/i }).click();
  await page.getByTestId("raw-file-input").setInputFiles(files("Second"));
  await run();
  await expect(toggle).toHaveText("▸ Show results details");
  await expect(page.getByTestId("result-file-table")).toHaveCount(0);
  assertNoExternalRequests(requestTracker);
});

test("saves a project with files to IndexedDB and restores it after reload (#22)", async ({ page }) => {
  await expandSectionCard(page, "session-detection");
  await page
    .getByTestId("opener-set-select")
    .selectOption("activity_resumed_only");
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await expect(page.getByTestId("raw-file-row")).toHaveCount(1);

  await page.getByTestId("project-include-files").check();
  await page.getByTestId("project-name-input").fill("Resume me");
  await page.getByTestId("save-project-button").click();
  await expect(page.getByTestId("project-list")).toContainText("Resume me");

  await page.reload();
  await installDeterministicRuntime(page);

  // Uploaded files live only in memory, so the reload clears them...
  await expect(page.getByTestId("raw-file-row")).toHaveCount(0);
  // ...but the project persisted in IndexedDB and restores the file on load.
  await expect(page.getByTestId("project-list")).toContainText("Resume me");
  await page.getByTestId("project-list").getByRole("button", { name: "Load" }).first().click();
  await expect(page.getByTestId("raw-file-row")).toHaveCount(1);
  await expect(page.getByTestId("raw-file-row")).toContainText("Raw P01.csv");
  await expandSectionCard(page, "session-detection");
  await expect(page.getByTestId("opener-set-select")).toHaveValue(
    "activity_resumed_only",
  );
  assertNoExternalRequests(requestTracker);
});


test("reopens and validates supplied communication relationships in the retained input artifact", async ({ page }) => {
  await expandSectionCard(page, "session-detection");
  await page.getByTestId("opener-set-select").selectOption("activity_resumed_only");
  await setInputFile(page, "raw-file-input", "Supplied communication.csv", suppliedCommunicationCsv, "text/csv");
  await page.getByTestId("project-include-files").check();
  await page.getByTestId("project-name-input").fill("Supplied SMS and conversations");
  await page.getByTestId("save-project-button").click();
  // Saving is an asynchronous IndexedDB write; reloading before it commits
  // leaves "No saved projects yet." (seen in the full chromium suite).
  await expect(page.getByTestId("project-list")).toContainText("Supplied SMS and conversations");
  await page.reload();
  await installDeterministicRuntime(page);
  await page.getByTestId("project-list").getByRole("button", { name: "Load" }).first().click();
  await expect(page.getByTestId("raw-file-row")).toContainText("Supplied communication.csv");
  const retained = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("chronicle-projects");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error(request.error?.message ?? "IndexedDB request failed"));
    });
    try {
      const projects = await new Promise<Array<{ name: string; rawFiles: Array<{ blob: Blob }> }>>((resolve, reject) => {
        const request = db.transaction("projects", "readonly").objectStore("projects").getAll();
        request.onsuccess = () => resolve(request.result as Array<{ name: string; rawFiles: Array<{ blob: Blob }> }>);
        request.onerror = () => reject(new Error(request.error?.message ?? "IndexedDB request failed"));
      });
      return projects.find(p => p.name === "Supplied SMS and conversations")!.rawFiles[0]!.blob.text();
    } finally { db.close(); }
  });
  expect(retained).toBe(suppliedCommunicationCsv);
  await processFiles(page); // Relationship validation is execution-side, not byte equality alone.
  await expect(page.getByTestId("result-file-table")).toBeVisible();
  const invalid = suppliedCommunicationCsv.replace("peer-one,1,conversation-one", "peer-one,2,conversation-one");
  await setInputFile(page, "raw-file-input", "Bad supplied communication.csv", invalid, "text/csv");
  await page.getByRole("tab", { name: /Process/i }).click();
  await page.getByTestId("process-files-button").click();
  await expect(page.locator(".result-panel .error-text")).toContainText("supplied SMS");
  assertNoExternalRequests(requestTracker);
});

test("persists all edited settings across reload and supports settings import", async ({ page }) => {
  await page.getByTestId("study-name-input").fill("TECH pilot");
  await page.getByTestId("toggle-processScreenUsage").check();
  await expandSectionCard(page, "timezone");
  await page.getByTestId("timezone-handling-select").selectOption("selected-convert");
  await page.getByTestId("selected-timezone-input").fill("America/Chicago");
  await expandSectionCard(page, "session-detection");
  await page.getByTestId("long-duration-threshold-input").fill("6");
  await page.getByTestId("custom-engagement-duration-input").fill("45");
  await page.getByTestId("long-usage-thresholds-input").fill("2, 4, 8");
  await page.getByTestId("toggle-allowStopEventReuse").check();
  await page
    .getByTestId("opener-set-select")
    .selectOption("activity_resumed_only");
  await expandSectionCard(page, "performance");
  await page.getByTestId("toggle-parallelProcessing").check();
  await page.getByTestId("parallel-max-workers-input").fill("3");

  await page.reload();
  await installDeterministicRuntime(page);
  await expect(page.getByTestId("study-name-input")).toHaveValue("TECH pilot");
  await expect(page.getByTestId("toggle-processScreenUsage")).toBeChecked();
  await expect(page.getByTestId("toggle-processAppUsage")).toBeChecked();
  await expandSectionCard(page, "timezone");
  await expect(page.getByTestId("timezone-handling-select")).toHaveValue("selected-convert");
  await expect(page.getByTestId("selected-timezone-input")).toHaveValue("America/Chicago");
  await expandSectionCard(page, "session-detection");
  await expect(page.getByTestId("long-duration-threshold-input")).toHaveValue("6");
  await expect(page.getByTestId("custom-engagement-duration-input")).toHaveValue("45");
  await expect(page.getByTestId("long-usage-thresholds-input")).toHaveValue("2, 4, 8");
  await expect(page.getByTestId("toggle-allowStopEventReuse")).toBeChecked();
  await expect(page.getByTestId("opener-set-select")).toHaveValue(
    "activity_resumed_only",
  );
  await expandSectionCard(page, "performance");
  await expect(page.getByTestId("toggle-parallelProcessing")).toBeChecked();
  await expect(page.getByTestId("parallel-max-workers-input")).toHaveValue("3");

  await page.getByTestId("import-config-input").setInputFiles({
    name: "config.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        exportedAt: "2026-04-27T00:00:00.000Z",
        currentSettings: {
          studyName: "Imported study",
          processAppUsage: false,
          processScreenUsage: true,
          useAppCodebook: false,
          openerSet: "gesis_app_scoped_starts",
          longDataTimeGapThresholds: [1.5, 2.5],
        },
        presets: [],
      }),
      "utf-8",
    ),
  });

  await expect(page.getByTestId("study-name-input")).toHaveValue("Imported study");
  await expect(page.getByTestId("toggle-processAppUsage")).not.toBeChecked();
  await expect(page.getByTestId("toggle-processScreenUsage")).toBeChecked();
  await expect(page.getByTestId("toggle-useAppCodebook")).not.toBeChecked();
  await expandSectionCard(page, "session-detection");
  await expect(page.getByTestId("long-gap-thresholds-input")).toHaveValue("1.5, 2.5");
  await expect(page.getByTestId("opener-set-select")).toHaveValue(
    "gesis_app_scoped_starts",
  );
  assertNoExternalRequests(requestTracker);
});

test("@privacy exposes a restrictive same-origin CSP policy", async ({ page }) => {
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("worker-src 'self' blob:");
  expect(csp).not.toContain("https://");
  assertNoExternalRequests(requestTracker);
});

test("@offline warms the cache, reloads offline, and still processes locally", async ({
  page,
  context,
}) => {
  await waitForServiceWorkerControl(page);
  await expect(
    page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
  ).toBeVisible();
  await expect(page.getByText(/your data never leaves your device/i)).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
  ).toBeVisible();
  await expect(page.getByText(/your data never leaves your device/i)).toBeVisible();

  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
  const appCsv = await downloadCsv(page, "download-app-csv");
  const rows = parseCsv(appCsv);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.interaction_type).toBe("App Usage");
  assertNoExternalRequests(requestTracker);
});

test("@install keeps the simplified hero stable when beforeinstallprompt fires", async ({
  page,
}) => {
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted"; platform: string }>;
      preventDefault: () => void;
    };
    event.prompt = async () => {};
    event.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
    window.dispatchEvent(event);
  });

  await expect(
    page.getByRole("heading", { name: "Chronicle Android Raw Data Preprocessor" }),
  ).toBeVisible();
  await expect(page.getByText(/your data never leaves your device/i)).toBeVisible();
  await expect(page.getByRole("tab", { name: /Settings/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Files/i })).toBeVisible();
  await page.getByRole("tab", { name: /Process/i }).click();
  await expect(page.getByTestId("process-files-button")).toBeVisible();
  assertNoExternalRequests(requestTracker);
});

test("workflow tabs are labels only without subtitles", async ({ page }) => {
  for (const tabName of ["Settings", "Files", "Process"]) {
    const tab = page.getByRole("tab", { name: new RegExp(`^${tabName}$`, "i") });
    await expect(tab).toBeVisible();
    expect(await tab.locator(".workflow-nav__meta").count()).toBe(0);
  }
  assertNoExternalRequests(requestTracker);
});

test("settings management lives in Settings and footer has only About info", async ({ page }) => {
  const card = page.getByTestId("settings-management");
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { level: 4, name: /Config/i })).toBeVisible();
  await expect(card.getByRole("heading", { level: 4, name: /Preset library/i })).toBeVisible();
  await expect(card.getByTestId("export-config-button")).toBeVisible();
  await expect(card.getByTestId("import-config-input")).toBeAttached();
  await expect(card.getByTestId("save-preset-button")).toBeVisible();

  // Single config import/export — no separate preset file IO surface.
  expect(await card.getByTestId("import-presets-input").count()).toBe(0);
  expect(await card.getByText(/Export preset library/i).count()).toBe(0);
  expect(await card.getByText(/Import preset library/i).count()).toBe(0);

  const footer = page.getByTestId("app-footer");
  await expect(footer).toBeVisible();
  expect(await footer.getByTestId("export-config-button").count()).toBe(0);
  expect(await footer.getByRole("button", { name: /reset all to defaults/i }).count()).toBe(0);
  // Build identity is injected at build time (git short sha + date), so it must
  // carry the sha — these regexes FAIL on the old hardcoded "Version 1.0.0" /
  // "Build 2026-04-26" literals and on a "dev" fallback, proving the injection.
  await expect(footer.getByText(/^Version \d+\.\d+\.\d+\+[0-9a-f]{7,}$/)).toBeVisible();
  await expect(footer.getByText(/^Build \d{4}-\d{2}-\d{2}$/)).toBeVisible();
  assertNoExternalRequests(requestTracker);
});

test("files tab lists every timezone instead of summarizing as N timezones", async ({ page }) => {
  await page.getByRole("tab", { name: /Files/i }).click();
  await setInputFile(page, "raw-file-input", "Mixed.csv", MIXED_TIMEZONE_RAW_CSV, "text/csv");
  const row = page.getByTestId("raw-file-row").first();
  await expect(row).toBeVisible();
  await expect(row).not.toContainText(/\d+ timezones/);
  await expect(row.locator(".raw-file-row__timezones li")).toHaveCount(2);
  assertNoExternalRequests(requestTracker);
});

test("duplicate timestamps stop blocking readiness when correction is enabled", async ({ page }) => {
  // This export has no screen events; screen output off keeps that separate
  // warning out of the readiness pill this test is about.
  await page.getByTestId("toggle-processScreenUsage").uncheck();
  await expandSectionCard(page, "session-detection");
  await expect(page.getByTestId("toggle-correctDuplicateEventTimestamps")).toBeChecked();

  await page.getByRole("tab", { name: /Files/i }).click();
  const dupCsv = [
    "study_id,participant_id,application_label,interaction_type,app_package_name,event_timestamp,timezone",
    "S,P,Foo,Activity Resumed,com.foo,2024-01-01 10:00:00,America/Chicago",
    "S,P,Foo,Activity Resumed,com.foo,2024-01-01 10:00:00,America/Chicago",
  ].join("\n");
  await setInputFile(page, "raw-file-input", "dup.csv", dupCsv, "text/csv");
  const row = page.getByTestId("raw-file-row").first();
  await expect(row).toBeVisible();
  await expect(row.locator(".status-pill")).toContainText(/Success/i);
  await expect(row).toContainText(/will be corrected/);

  await page.getByRole("tab", { name: /Settings/i }).click();
  await page.getByTestId("toggle-correctDuplicateEventTimestamps").uncheck();
  await page.getByRole("tab", { name: /Files/i }).click();
  await expect(row.locator(".status-pill")).toContainText(/Warning|Review/i);
  await expect(row).toContainText(/not corrected/);
  assertNoExternalRequests(requestTracker);
});

test("results panel is the primary post-processing surface and preview is gone", async ({ page }) => {
  // Disable screen output so the Screen stat is hidden for this case.
  await page.getByTestId("toggle-processScreenUsage").uncheck();
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await processFiles(page);
  const panel = page.getByTestId("result-file-table");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("result-row")).toHaveCount(1);
  await expect(panel.locator("thead th")).toContainText([
    "File",
    "Status",
    "Input",
    "Processed",
    "App",
  ]);
  await expect(panel.locator("thead th", { hasText: /^Screen$/ })).toHaveCount(0);
  await expect(panel.locator("thead th", { hasText: /^Timezone$/ })).toHaveCount(1);
  await expect(panel.locator("thead th", { hasText: /^Outputs$/ })).toHaveCount(1);
  expect(await page.locator(".result-preview").count()).toBe(0);
  expect(await page.locator(".preview-table").count()).toBe(0);
  expect(await page.locator(".result-details").count()).toBe(0);
  assertNoExternalRequests(requestTracker);
});

test("results panel shows both app and screen stats when output mode is both", async ({ page }) => {
  await page.getByTestId("toggle-processScreenUsage").check();
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_AND_SCREEN_RAW_CSV, "text/csv");
  await processFiles(page);
  const panel = page.getByTestId("result-file-table");
  await expect(panel).toBeVisible();
  await expect(panel.locator("thead th", { hasText: /^App$/ })).toHaveCount(1);
  await expect(panel.locator("thead th", { hasText: /^Screen$/ })).toHaveCount(1);
  assertNoExternalRequests(requestTracker);
});

test("legacy useKeepAwakeAppsFile imports are dropped, not silently mapped", async ({ page }) => {
  await page.getByTestId("import-config-input").setInputFiles({
    name: "legacy-config.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        exportedAt: "2026-04-27T00:00:00.000Z",
        currentSettings: { useKeepAwakeAppsFile: true, studyName: "Legacy" },
        presets: [],
      }),
      "utf-8",
    ),
  });
  await expect(page.getByTestId("study-name-input")).toHaveValue("Legacy");
  await expect(page.getByTestId("toggle-useAppsForcingScreenOpenFile")).not.toBeChecked();
  assertNoExternalRequests(requestTracker);
});

test("config export round-trips both active settings and the preset library", async ({ page }) => {
  await page.getByTestId("study-name-input").fill("RoundTrip");
  await page.getByTestId("preset-name-input").fill("Snapshot A");
  await page.getByTestId("save-preset-button").click();
  await expect(page.getByTestId("preset-list")).toContainText("Snapshot A");

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-config-button").click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  if (!stream) throw new Error("download stream missing");
  const chunks: Array<Buffer | Uint8Array> = [];
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk as ArrayLike<number>));
  }
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as { currentSettings: { studyName: string }; presets: Array<{ name: string }> };
  expect(exported.currentSettings.studyName).toBe("RoundTrip");
  expect(exported.presets.map((p) => p.name)).toContain("Snapshot A");
  assertNoExternalRequests(requestTracker);
});

/**
 * `RuntimeSupportFiles::resolve` has a dedicated fail-closed arm for `.xls`
 * ("Convert legacy .xls workbooks to .xlsx or CSV") because only calamine's
 * `Xlsx` reader is linked. The picker used to advertise `.xls`, so the file was
 * accepted, the widget showed "Enabled with uploaded file", and the whole batch
 * failed at run time. The refusal now happens at pick time.
 */
test("@smoke a legacy .xls support file is refused at the picker, not at run time", async ({
  page,
}) => {
  await setInputFile(page, "raw-file-input", "Raw P01.csv", APP_ONLY_RAW_CSV, "text/csv");
  await expandSectionCard(page, "optional-cleaning");
  await page.getByTestId("toggle-useFilterFile").check();
  const picker = page.getByTestId("filter-file-input");
  // The dialog filter no longer offers it either.
  await expect(picker).toHaveAttribute("accept", ".csv,.xlsx");
  await setInputFile(
    page,
    "filter-file-input",
    "filter.xls",
    "app_package_name\ncom.example.app\n",
    "application/vnd.ms-excel",
  );

  const error = page.getByTestId("filter-file-input-format-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("filter.xls");
  await expect(error).toContainText(".csv or .xlsx");
  // And the widget does not claim the file was taken — neither with the
  // rejected file's name nor with the bundled default, which would put a green
  // "Success: Enabled with …" line directly beside the red refusal.
  await expect(
    page.getByText(/Enabled with uploaded file: filter\.xls/),
  ).toHaveCount(0);
  const filterRow = page
    .locator(".support-file-row")
    .filter({ hasText: "Filter file" });
  await expect(filterRow.getByText(/^Success:/)).toHaveCount(0);

  // The correctly-shaped CSV still loads through the same picker.
  await setInputFile(page, "filter-file-input", "filter.csv", FILTER_FILE_CSV, "text/csv");
  await expect(error).toHaveCount(0);
  await expect(
    page.getByText(/Enabled with uploaded file: filter\.csv/),
  ).toBeVisible();
});

/**
 * The kernel's row reader resolves raw columns by name and substitutes an empty
 * string for one it cannot find, so a file whose header is missing
 * `app_package_name` used to process to blank packages and report success. The
 * inspection already computed `hasRequiredColumns` and nothing read it, so the
 * file showed the same amber "Warning: Review" pill as a cosmetic warning.
 */
test("@smoke a raw file missing a required column is an error, and blocks the run", async ({
  page,
}) => {
  const missingPackageColumn = [
    "study_id,participant_id,username,application_label,interaction_type,event_timestamp,timezone",
    "study,P01,Target Child,Chat,Activity Resumed,2026-03-07 10:00:00,America/Chicago",
    "study,P01,Target Child,Chat,Activity Paused,2026-03-07 10:05:00,America/Chicago",
  ].join("\n");
  await setInputFile(
    page,
    "raw-file-input",
    "Raw Missing.csv",
    missingPackageColumn,
    "text/csv",
  );

  await page.getByRole("tab", { name: /Files/i }).click();
  const filesPanel = page.getByRole("tabpanel", { name: /Files/i });
  await expect(filesPanel.getByTestId("raw-file-row-error")).toBeVisible();
  await expect(filesPanel.getByTestId("raw-file-row-error")).toContainText(
    "app_package_name",
  );
  await expect(filesPanel.getByText("Error: Missing columns")).toBeVisible();
  await expect(filesPanel.getByText("Warning: Review")).toHaveCount(0);

  await page.getByRole("tab", { name: /Process/i }).click();
  const block = page.getByTestId("raw-columns-block");
  await expect(block).toBeVisible();
  await expect(block).toContainText("Raw Missing.csv");
  await expect(block).toContainText("app_package_name");
  await expect(page.getByTestId("process-files-button")).toBeDisabled();
  await expect(page.getByTestId("result-panel")).toHaveCount(0);
});
