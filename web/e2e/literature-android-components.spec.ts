import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { lazyPrivateCorpusJson, PRIVATE_CORPUS_SKIP_REASON, privateCorpusAvailable } from "../src/testSupport/privateCorpus";
import { gotoApp, trackExternalRequests, assertNoExternalRequests, RESULT_PANEL_TIMEOUT_MS } from "./helpers";
import type { StudyMethodProfileLibrary } from "../src/lib/methodProfiles";

const root = resolve(import.meta.dirname, "../..");
const library = lazyPrivateCorpusJson<StudyMethodProfileLibrary>("ontology-sublation-20260831/adjudicated-method-profile-library.json");
const contract = JSON.parse(readFileSync(resolve(root, "web/schema/literature-input-adapter-contract.json"), "utf8")) as {
  groups: Array<{ adapterId: string; methodSettingIds: string[]; componentExecution?: { componentId: string; sourceWorkId: string; derivedResultKind: string; adaptedResultKind?: string; tableFormat?: "csv" | "arrow-ipc-file"; requiredSupportRoles: string[] } }>;
};
const conformance = JSON.parse(readFileSync(resolve(root, "rust/chronicle_preprocessing_runtime_wasm/tests/fixtures/literature_input_adapter_conformance.json"), "utf8")) as {
  groups: Array<{ adapterId: string; cases: Array<{ fixtureId: string; methodSettingId: string; sourceWorkId: string; rawCsvLines: string[]; rawBinaryBytes?: number[]; supportCsvLines: Record<string, string[]>; expected: { outputContains: string[]; outputExcludes: string[]; emittedRowCount: number; derivedOutputContains?: string[]; derivedOutputExcludes?: string[]; outputSha256?: string; derivedOutputSha256?: string } }> }>;
};

const historicalComponentIds = [
  "chronicle.clear-all-active-notification-grouping/v1",
  "chronicle.notification-payload-cleaning/v1",
  "chronicle.on-bounded-short-off-bridge/v1",
  "chronicle.ethica-foreground-interval-preparation/v1",
  "chronicle.touchstroke-sensor-magnitude/v1",
  "chronicle.touchstroke-four-stroke-timing/v1",
  "chronicle.pvt-relative-response-time/v1",
  "chronicle.rabbit-hole-prepared-features/v1",
  "chronicle.clear-all-unique-notification-items/v1",
  "chronicle.clear-all-notification-appearance-age/v1",
  "chronicle.clear-all-empty-snapshot-fractions/v1",
  "chronicle.hmog-sensor-magnitude/v1",
  "chronicle.hmog-supplied-window-reductions/v1",
  "chronicle.hmog-supplied-stability-search/v1",
  "chronicle.hmog-paired-key-hold/v1",
  "chronicle.hmog-consecutive-press-digraph/v1",
  "chronicle.keyboard-stress-axis-statistics/v1",
  "chronicle.class-ringer-fractions/v1",
  "chronicle.app-postpone-fraction/v1",
  "chronicle.twenty-trial-time-mean/v1",
  "chronicle.non-country-unicity-mean/v1",
  "chronicle.country-unicity-mean/v1",
  "chronicle.frame-unique-app-count/v1",
  "chronicle.session-unique-app-count/v1",
  "chronicle.idle-compressed-clock/v1",
  "chronicle.screenlife-capture-gap-partition/v1",
  "chronicle.resolved-unlock-upper-bound/v1",
  "chronicle.smartphone-usage-reductions/v1",
  "chronicle.prosit-unlock-reductions/v1",
  "chronicle.batterylogger-weighted-estimate/v1",
  "chronicle.attelia-activity-transition-lookup/v1",
  "chronicle.backapp-runtime-arithmetic/v1",
  "chronicle.healthymind-notification-rates/v1",
  "chronicle.healthymind-response-delay/v1",
  "chronicle.fischer-notification-phase-times/v1",
  "chronicle.s3-prepared-sensor-window/v1",
  "chronicle.autosen-prepared-normalization/v1",
  "chronicle.s-adl-literal-selection/v1",
  "chronicle.affectpro-ordered-touch-features/v1",
  "chronicle.supplied-app-fingerprint-unicity/v1",
  "chronicle.s-adl-pair-differences/v1",
  "chronicle.okoshi-notification-latencies/v1",
  "chronicle.large-scale-notification-click-time/v1",
  "chronicle.content-notification-removal-time/v1",
  "chronicle.screen-missing-second-repair/v1",
  "chronicle.fukazawa-supplied-acceleration-magnitude/v1",
  "chronicle.accessibility-phrase-set-difference/v1",
  "chronicle.bod-shape-direction-run-collapse/v1",
  "chronicle.uniform-five-minute-byte-allocation/v1",
  "chronicle.capped-closed-screen-packet-gate/v1",
  "chronicle.ohapp-matched-navigation-time/v1",
  "chronicle.jones-ordered-interlaunch-time/v1",
  "chronicle.touch-box-displacement/v1",
  "chronicle.screenomics-text-image-statistics/v1",
  "chronicle.dismissed-supplied-burst-last/v1",
  "chronicle.annotif-supplied-summary-hash-filter/v1",
  "chronicle.dingler-supplied-foreground-exclusion/v1",
  "chronicle.myphoneme-supplied-response-times/v1",
  "chronicle.monarca-prepared-rms/v1",
  "chronicle.moa2-prepared-calendar/v1",
  "chronicle.rapids-supplied-foreground-reductions/v1",
  "chronicle.rapids-supplied-data-yield/v1",
  "chronicle.nextapp-supplied-opening-counts/v1",
  "chronicle.van-berkel-resolved-session-gap/v1",
  "chronicle.corrected-password-entry-time/v1",
  "chronicle.ordered-app-presence-vector/v1",
  "chronicle.supplied-pre-sample-longest-window/v1",
  "chronicle.habitual-android-duration-bag/v1",
  "chronicle.finesse-later-feature-time/v1",
  "chronicle.supplied-last-syn-rtt/v1",
  "chronicle.supplied-app-session-tap-rate/v1",
  "chronicle.carat-normalized-entropy/v1",
  "chronicle.carat-pair-regularity/v1",
  "chronicle.carat-day-regularity-mean/v1",
  "chronicle.stdd-prepared-axis/v1",
  "chronicle.touchstroke-prepared-mean/v1",
];
const runtimeRegistry = JSON.parse(readFileSync(resolve(root, "web/src/generated/android-method-profile-runtime-registry.json"), "utf8")) as {
  profiles: Array<{ registered_components: Array<{ component_id: string }> }>;
};
const registeredComponentIds = runtimeRegistry.profiles.flatMap((profile) =>
  profile.registered_components.map((component) => component.component_id));
const componentIds = [...historicalComponentIds, ...registeredComponentIds.filter((id) =>
  !historicalComponentIds.includes(id))];
const supportInputByRole: Readonly<Record<string, string>> = {
  study_dates_file: "study-dates-file-input",
  anchor_events_file: "anchor-events-file-input",
  phonestudy_ps_communication_file: "phonestudy-ps-communication-file-input",
  analysis_feature_matrix_file: "analysis-feature-matrix-file-input",
  phonestudy_es_file: "phonestudy-es-file-input",
  input_capability_evidence_file: "input-capability-evidence-file-input",
};
const componentFixtureCases = (componentId: string) => {
  const group = contract.groups.find((group) => group.componentExecution?.componentId === componentId)!;
  return conformance.groups.filter((fixtureGroup) => fixtureGroup.adapterId === componentId)
    .flatMap((fixtureGroup) => fixtureGroup.cases)
    .filter((fixture) => fixture.sourceWorkId === group.componentExecution!.sourceWorkId
      && group.methodSettingIds.includes(fixture.methodSettingId));
};
const derivedOnlyLegacyComponentIds = new Set([
  "chronicle.phonestudy-phone-features/v1",
  "chronicle.keyguard-transition-fsm/v1",
  "chronicle.source-event-schema/v1",
]);
// The registered run executes the complete component, not a single-setting adapter probe.
const representativeFixtureIds: Readonly<Record<string, string>> = {
  "chronicle.bjerre-supplied-long-session-class-exposure/v1": "bjerre-supplied-long-session-class-exposure-aggregation-average_long_session_in_class_percent",
  "chronicle.caught-supplied-window-usage/v1": "caught-supplied-window-usage-main-preprocess-supplied_duration_notification_per_hour",
};

test("ordinary Android GUI inventory covers every current registered bounded component", () => {
  expect(registeredComponentIds).toHaveLength(355);
  expect(new Set(registeredComponentIds).size).toBe(355);
  expect(componentIds.slice().sort()).toEqual(registeredComponentIds.slice().sort());
  for (const id of componentIds) {
    expect(contract.groups.filter((group) => group.componentExecution?.componentId === id)).toHaveLength(1);
    const group = contract.groups.find((group) => group.componentExecution?.componentId === id)!;
    expect(componentFixtureCases(id).map((fixture) => fixture.methodSettingId).sort())
      .toEqual(group.methodSettingIds.slice().sort());
    if (derivedOnlyLegacyComponentIds.has(id)) {
      expect(group.componentExecution!.adaptedResultKind).toBeUndefined();
      expect(componentFixtureCases(id)[0]!.expected.derivedOutputContains!.length).toBeGreaterThan(0);
    }
  }
});

for (const componentId of componentIds) {
  test(`runs and reopens ordinary Android component ${componentId}`, async ({ page }) => {
    test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);
    const external = trackExternalRequests(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const group = contract.groups.find((group) => group.componentExecution?.componentId === componentId)!;
    expect(group).toBeDefined();
    const registration = group.componentExecution!;
    const profile = library().profiles.find((profile) => profile.source_work_id === registration.sourceWorkId)!;
    const fixtures = componentFixtureCases(componentId);
    const namedFixtureId = representativeFixtureIds[componentId];
    const selectedFixtures = namedFixtureId
      ? fixtures.filter((fixture) => fixture.fixtureId === namedFixtureId)
      : fixtures.slice(0, 1);
    expect(selectedFixtures).toHaveLength(1);
    const fixture = selectedFixtures[0]!;
    // Exact full-binding hand input from categorical_response_rate_component_execution.rs.
    const rawCsvLines = componentId === "chronicle.categorical-response-rate/v1" ? [
      "source_row_id,label,response_to_user_label,response_of_user_label",
      "1,responded,responded,responded",
      "2,no-response,other,no-response",
      "3,responded,NA,other",
    ] : fixture.rawCsvLines;
    const rawBytes = fixture.rawBinaryBytes ? Buffer.from(fixture.rawBinaryBytes)
      : Buffer.from(rawCsvLines.join("\n") + "\n");
    const rawInputDigest = `sha256:${createHash("sha256").update(rawBytes).digest("hex")}`;
    // The released left join's explicit empty-right probe is already covered by
    // phonestudy_join_oracle.json and the compiled integration owner. This is a
    // supplied header-only table, never an omitted required support file.
    const suppliedSupportCsvLines = componentId === "chronicle.phonestudy-phone-features/v1"
      ? { ...fixture.supportCsvLines, phonestudy_ps_communication_file: ["id"] }
      : fixture.supportCsvLines;
    // Only materialize the source fixture's existing test token, bound to the uploaded bytes.
    const supportCsvLines = Object.fromEntries(Object.entries(suppliedSupportCsvLines).map(([role, lines]) =>
      [role, lines.map((line) => line.replaceAll("{{RAW_INPUT_SHA256}}", rawInputDigest))]));
    console.info("GUI_COMPONENT_FIXTURE_IDENTITY", JSON.stringify({
      componentId, fixtureId: fixture.fixtureId, methodSettingId: fixture.methodSettingId,
      sourceWorkId: fixture.sourceWorkId,
      rawInputDigest,
      ...(componentId === "chronicle.categorical-response-rate/v1" ? {
        fullBindingHandOracle: "categorical_response_rate_component_execution.rs::one_component_executes_three_distinct_selected_label_outputs",
      } : {}),
      outputExpectationTarget: derivedOnlyLegacyComponentIds.has(componentId)
        ? registration.derivedResultKind : registration.adaptedResultKind ?? registration.derivedResultKind,
      supportInputDigests: Object.fromEntries(registration.requiredSupportRoles.map((role) =>
        [role, `sha256:${createHash("sha256").update(supportCsvLines[role]!.join("\n") + "\n").digest("hex")}`])),
    }));
    await gotoApp(page);
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await page.getByTestId("method-profile-file-input").setInputFiles({ name: "source-profile.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ profiles: [profile] })) });
    const run = page.locator(`[data-testid="run-literature-component"][data-component-id="${componentId}"]`);
    await expect(run).toBeEnabled();
    // The first click selects the existing source-input workflow before any file.
    await run.click();
    await expect(page.getByTestId("raw-file-input")).toBeAttached();
    await expect(page.getByText(registration.tableFormat === "arrow-ipc-file"
      ? "Drop an Arrow analysis table here" : "Drop the component source CSV here", { exact: true })).toBeVisible();
    await page.getByTestId("raw-file-input").setInputFiles(fixture.rawBinaryBytes ? {
      name: "typed_analysis.arrow", mimeType: "application/vnd.apache.arrow.file", buffer: rawBytes,
    } : { name: "source-rows.csv", mimeType: "text/csv", buffer: rawBytes });
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    for (const role of registration.requiredSupportRoles) {
      expect(supportInputByRole[role]).toBeDefined();
      await page.getByTestId(supportInputByRole[role]!).setInputFiles({ name: "component-configuration.csv", mimeType: "text/csv", buffer: Buffer.from(supportCsvLines[role]!.join("\n") + "\n") });
    }
    await run.click();
    const panel = page.getByRole("region", { name: "Literature component result", exact: true });
    // The run executes the component in the Rust/WASM worker, like a processing
    // run, so it gets the shared result-panel stall guard. The 5 s default
    // failed 11 Firefox cases in the full suite whose result panel had in fact
    // rendered moments later (failure screenshots show "Executed …").
    await expect(panel).toContainText(`Executed ${componentId}`, { timeout: RESULT_PANEL_TIMEOUT_MS });
    await expect(panel).toContainText("The parent paper profile remains blocked.");
    const downloadOutput = async (kind = registration.derivedResultKind) => {
      const row = panel.locator("li").filter({ has: page.getByText(kind, { exact: true }) });
      const event = page.waitForEvent("download");
      await row.getByRole("button", { name: "Download", exact: true }).click();
      const download = await event;
      return readFile(await download.path());
    };
    const before = await downloadOutput();
    const adapted = registration.adaptedResultKind ? await downloadOutput(registration.adaptedResultKind) : before;
    if (derivedOnlyLegacyComponentIds.has(componentId)) {
      for (const value of fixture.expected.derivedOutputContains!) expect(before.toString("utf8")).toContain(value);
      for (const value of fixture.expected.derivedOutputExcludes ?? []) expect(before.toString("utf8")).not.toContain(value);
    } else {
      for (const value of fixture.expected.outputContains) expect(adapted.toString("utf8")).toContain(value);
      for (const value of fixture.expected.outputExcludes) expect(adapted.toString("utf8")).not.toContain(value);
    }
    for (const value of fixture.expected.derivedOutputContains ?? []) expect(before.toString("utf8")).toContain(value);
    for (const value of fixture.expected.derivedOutputExcludes ?? []) expect(before.toString("utf8")).not.toContain(value);
    if (fixture.expected.outputSha256) expect(`sha256:${createHash("sha256").update(adapted).digest("hex")}`).toBe(fixture.expected.outputSha256);
    if (fixture.expected.derivedOutputSha256) expect(`sha256:${createHash("sha256").update(before).digest("hex")}`).toBe(fixture.expected.derivedOutputSha256);
    if (componentId === "chronicle.categorical-response-rate/v1") {
      expect(before.toString("utf8")).toBe("response_rate,Stachl_responserate_calls_others,Stachl_responserate_calls_user\n0.6666666666666666,1,0.5\n");
    }
    await page.reload();
    await page.getByRole("tab", { name: "Process", exact: true }).click();
    await expect(panel).toContainText(`Executed ${componentId}`, { timeout: RESULT_PANEL_TIMEOUT_MS });
    expect(await downloadOutput()).toEqual(before);
    expect(errors).toEqual([]);
    assertNoExternalRequests(external);
  });
}
