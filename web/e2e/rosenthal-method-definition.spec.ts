import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PRIVATE_CORPUS_SKIP_REASON, privateCorpusAvailable, privateCorpusPath } from "../src/testSupport/privateCorpus";
import { gotoApp, reloadApp, trackExternalRequests, assertNoExternalRequests } from "./helpers";
import type { StudyMethodProfile } from "../src/lib/methodProfiles";
import { requiresConfigurationSelection } from "../src/lib/methodProfiles";
import { expectMethodProfileLoadAction } from "./methodProfileLoadAction";
import { LAST_RUN_DB_NAME, LAST_RUN_STORE_NAME } from "../src/lib/lastRunStore";
import { hardLockStateExample } from "./fixtures/hard-lock-state-example";

// Every test in this file reads the private literature corpus.
test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);

for (const [workId, label, operationCount, marker] of [
  ["doi:10.1007/978-3-642-21726-5_11", "Rosenthal", 19, "model.volume_probability_printed_equation"],
  ["doi:10.1145/2556288.2557066", "Böhmer", 19, "field.postpone_timer"],
  ["doi:10.1145/3479600", "Finesse", 28, "esm.illustrated_instagram_prompt"],
  ["doi:10.1145/3229434.3229436", "Snooze", 27, "configuration.point_in_time_options"],
  ["doi:10.1145/3130956", "Beyond", 33, "instrument.mood_questionnaire"],
  ["doi:10.1145/2493432.2493443", "Shin", 28, "app.use_within_session_collapse"],
  ["doi:10.1145/3714394.3754395", "PULSE", 23, "labeling.range_selection"],
  ["doi:10.3390/s24082612", "Call to Action", 33, "analysis.hourly_z_scores"],
  ["doi:10.1145/2037373.2037402", "Fischer", 19, "trigger.sms_open_from_inbox"],
  ["doi:10.1007/s00779-011-0412-2", "Oulasvirta", 14, "sirb.android_24_second_footnote"],
  ["doi:10.1145/2556288.2556973", "Message Monitor", 13, "label.binary_median_pivot"],
  ["doi:10.1145/2785830.2785840", "Dingler", 11, "analysis.predicted_state_summaries"],
  ["doi:10.1145/2971648.2971732", "MultiDevice", 15, "intervention.esm_expiry"],
  ["doi:10.1145/3675094.3677547", "ScreenTK", 12, "prompt.complete_figure2_contract"],
  ["doi:10.1145/3473856.3473881", "WhyStop", 19, "input.figure1_literal_session_subset"],
  ["doi:10.1145/3613904.3642583", "RWW", 24, "challenge.appendix_catalogue"],
  ["doi:10.1145/2750858.2804252", "Boredom", 26, "borapp.result.aucroc_comparison"],
  ["usenix:soups2014:harbach-hard-lock-life", "Hard Lock Life", 17, "state.figure1_seven_transitions"],
  ["doi:10.1145/2371574.2371619", "Alt Browser", 11, "prototype.content_shortening"],
  ["doi:10.1109/mprv.2014.15", "MoodDiary", 19, "acquisition.prealert_15s_context_gathering"],
  ["doi:10.1145/3613904.3642832", "S-ADL", 16, "protocol.phone_registration_chain"],
  ["doi:10.1145/3613904.3642347", "Screen Text", 27, "collector.ui_tree_extraction"],
  ["doi:10.1145/3447991", "Habitual", 32, "historical.session_implementation"],
  ["doi:10.1145/2684822.2685302", "Next App", 19, "features.action_context_sampling"],
  ["doi:10.1145/2462456.2464449", "MoodScope", 9, "api.mood_state_schema"],
  ["doi:10.1145/2493190.2493219", "Oh App", 24, "feature.navigation_duration"],
  ["doi:10.1145/2684103.2684156", "MoMM2014", 19, "session.call_aware_constructor"],
  ["doi:10.1145/3490100.3516456", "Touch Authentication", 0, "result.questionnaire_item_means"],
] as const) {
test(`preserves ${label}'s exact source definitions and selected owner across import, reload and rejected imports`, async ({ page }) => {
  const path = privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json");
  const library = JSON.parse(readFileSync(path, "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = library.profiles.find((p) => p.source_work_id === workId)!;
  const sourcePolicies = Array.isArray(profile.session_construction_policies)
    ? profile.session_construction_policies as Array<Record<string, unknown>> : [];
  const other = library.profiles.find((p) => p.source_work_id === "doi:10.1145/2632048.2632060")!;
  expect(profile, `canonical ${label} definition is required`).toBeDefined();
  expect(other).toBeDefined();
  const external = trackExternalRequests(page);
  await gotoApp(page);
  const savedProfile = () => page.evaluate(async ({ database, store }) => {
    if (!(await indexedDB.databases()).some((db) => db.name === database)) throw new Error("Saved selection database missing");
    return new Promise<StudyMethodProfile>((resolveSaved, reject) => {
      const request = indexedDB.open(database);
      request.onerror = () => reject(new Error(request.error?.message ?? "Saved selection database open failed"));
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(store, "readonly");
        const read = transaction.objectStore(store).get("research-selection") as IDBRequest<{ selectionJson: string } | undefined>;
        transaction.onerror = () => { db.close(); reject(new Error(transaction.error?.message ?? "Saved selection read failed")); };
        transaction.oncomplete = () => {
          db.close();
          if (!read.result) { reject(new Error("Saved selection missing")); return; }
          try { resolveSaved((JSON.parse(read.result.selectionJson) as { profile: StudyMethodProfile }).profile); }
          catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
        };
      };
    });
  }, { database: LAST_RUN_DB_NAME, store: LAST_RUN_STORE_NAME });
  const picker = page.getByTestId("method-profile-file-input");
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  await picker.setInputFiles({ name: `${label}-and-call-definitions.json`, mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ profiles: [profile, other] })) });
  await card.getByRole("combobox", { name: "Profile", exact: true }).selectOption(profile.method_profile_id);
  if (label === "Screen Text") {
    await expect.poll(savedProfile).toEqual(profile);
    await picker.setInputFiles({ name: "unsupported-text-capture.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ profiles: [profile], screen_text_captures: [{
        capture_id: "analyst-capture", screen_text: "Inbox", phrase_nodes: [
          { text: "Inbox", bounds_px: { top_left: [10, 20], bottom_right: [80, 40] } },
          { text: "Inbox", bounds_px: { top_left: [90, 20], bottom_right: [160, 40] } },
        ],
      }] })) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("screen_text_captures");
    expect(await savedProfile()).toEqual(profile);
  }
  if (label === "Hard Lock Life") {
    await expect.poll(savedProfile).toEqual(profile);
    const invalid = hardLockStateExample(profile.method_profile_id);
    invalid.device_state_intervals[0]!.end_observation_ref = "foreign-observation";
    await picker.setInputFiles({ name: "invalid-joint-state-reference.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ profiles: [profile], ...invalid })) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toBeVisible();
    expect(await savedProfile()).toEqual(profile);
  }
  // The exact source level left selected; the load action compiles against it.
  const selectedLevels: Record<string, string> = {};
  if (label === "Snooze" || label === "PULSE") {
    const space = profile.method_configuration_space as { method_configuration_groups: Array<Record<string, unknown>> };
    const group = space.method_configuration_groups.find(requiresConfigurationSelection)!;
    const levels = group.method_configuration_levels as Array<{ method_configuration_level_id: string }>;
    for (const level of levels) {
      const details = card.locator("details").filter({ has: page.getByText(/^Source configuration space \(/) });
      await details.locator("summary").click();
      const selector = details.getByRole("combobox", { name: "Select exact source level" });
      await expect(selector).toHaveCount(1);
      await selector.selectOption(level.method_configuration_level_id);
      await reloadApp(page);
      const restoredDetails = card.locator("details").filter({ has: page.getByText(/^Source configuration space \(/) });
      await restoredDetails.locator("summary").click();
      await expect(restoredDetails.getByRole("combobox", { name: "Select exact source level" })).toHaveValue(level.method_configuration_level_id);
      await restoredDetails.locator("summary").click();
      selectedLevels[String(group.method_configuration_group_id)] = level.method_configuration_level_id;
    }
  }
  for (const reload of [false, true]) {
    if (reload) await reloadApp(page);
    await expect(card).toContainText(profile.source_work_id);
    for (const setting of profile.method_settings) {
      const row = card.locator("li").filter({ has: page.getByText(String(setting.method_parameter_key), { exact: true }) });
      await expect(row).toHaveCount(1);
      const value: unknown = JSON.parse(String(setting.method_value_json));
      await expect(row).toContainText(typeof value === "string" ? value : JSON.stringify(value));
      await expect(row).toContainText(`Source: ${(setting.source_locators as string[]).join(", ")}`);
    }
    const operations = card.locator("details").filter({ has: page.getByText(`Method operations (${operationCount})`, { exact: true }) });
    if (operationCount) {
      await operations.locator("summary").click();
      await expect(operations.locator("li")).toHaveCount(operationCount);
    } else {
      await expect(operations).toHaveCount(0);
    }
    for (const op of (profile.method_operations ?? []) as Record<string, unknown>[]) {
      const row = operations.locator("li").filter({ has: page.getByText(String(op.operation_id), { exact: true }) });
      await expect(row).toContainText(`Depends on: ${JSON.stringify(op.depends_on)}`);
      await expect(row).toContainText(`Configuration dependencies: ${JSON.stringify(op.configuration_dependencies)}`);
      await expect(row).toContainText(`Data effects: ${JSON.stringify(op.data_effects)}`);
    }
    if (sourcePolicies.length) {
      const policies = card.locator("details").filter({ has: page.getByText("Session construction policies (1)", { exact: true }) });
      await policies.locator("summary").click();
      await expect(policies.locator("li")).toHaveCount(1);
      await expect(policies).toContainText(String(sourcePolicies[0]!.session_construction_policy_id));
      await expect(policies).toContainText(String(sourcePolicies[0]!.session_input_layer));
      await expect(policies).toContainText(String(sourcePolicies[0]!.session_output_layer));
      expect((await savedProfile()).session_construction_policies).toEqual(profile.session_construction_policies);
    }
    await expectMethodProfileLoadAction(card, profile, selectedLevels);
    expect(await savedProfile()).toEqual(profile);
  }
  // The app persists the selected profile, not the whole imported library.
  await picker.setInputFiles({ name: `${label}-and-call-definitions.json`, mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ profiles: [profile, other] })) });
  await card.getByRole("combobox", { name: "Profile", exact: true }).selectOption(other.method_profile_id);
  await reloadApp(page);
  await expect(card).toContainText(other.source_work_id);
  await expect(card.getByText(marker, { exact: true })).toHaveCount(0);
  expect(await savedProfile()).toEqual(other);
  if (sourcePolicies.length) {
    await expect(card.getByText(String(sourcePolicies[0]!.session_construction_policy_id), { exact: true })).toHaveCount(0);
    const saved = await savedProfile();
    expect(saved.source_work_id).toBe(other.source_work_id);
    expect(saved.session_construction_policies).toEqual(other.session_construction_policies);
  }
  await picker.setInputFiles({ name: `${label}-and-call-definitions.json`, mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ profiles: [profile, other] })) });
  await card.getByRole("combobox", { name: "Profile", exact: true }).selectOption(profile.method_profile_id);
  const invalid = structuredClone(profile);
  if (operationCount) {
    Reflect.set((invalid.method_operations as Record<string, unknown>[])[0]!, "configuration_dependencies", ["invented.parameter"]);
  } else {
    invalid.method_settings.push(structuredClone(invalid.method_settings[0]!));
  }
  await picker.setInputFiles({ name: `invalid-${label}.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ profiles: [invalid] })) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toBeVisible();
  await reloadApp(page);
  await expect(card).toContainText(profile.source_work_id);
  for (const setting of profile.method_settings) {
    const row = card.locator("li").filter({ has: page.getByText(String(setting.method_parameter_key), { exact: true }) });
    await expect(row).toHaveCount(1);
    const value: unknown = JSON.parse(String(setting.method_value_json));
    await expect(row).toContainText(typeof value === "string" ? value : JSON.stringify(value));
    await expect(row).toContainText(`Source: ${(setting.source_locators as string[]).join(", ")}`);
  }
  // Importing resets the source-level selection.
  await expectMethodProfileLoadAction(card, profile);
  expect(await savedProfile()).toEqual(profile);
  if (sourcePolicies.length) {
    const saved = await savedProfile();
    expect(saved.source_work_id).toBe(profile.source_work_id);
    expect(saved.session_construction_policies).toEqual(profile.session_construction_policies);
  }
  assertNoExternalRequests(external);
});
}
