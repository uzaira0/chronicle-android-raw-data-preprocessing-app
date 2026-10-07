import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PRIVATE_CORPUS_SKIP_REASON, privateCorpusAvailable, privateCorpusPath } from "../src/testSupport/privateCorpus";
import { gotoApp, reloadApp, trackExternalRequests, assertNoExternalRequests } from "./helpers";
import { hardLockStateExample } from "./fixtures/hard-lock-state-example";
import { LAST_RUN_DB_NAME, LAST_RUN_STORE_NAME } from "../src/lib/lastRunStore";
import { parseStudyMethodProfileLibrary, type StudyMethodProfile } from "../src/lib/methodProfiles";

// Every test in this file reads the private literature corpus.
test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);

test("preserves joint state identities and distinct interval endpoints through picker, selected-owner storage and reload", async ({ page }) => {
  const path = privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json");
  const library = JSON.parse(readFileSync(path, "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = library.profiles.find((p) => p.source_work_id === "usenix:soups2014:harbach-hard-lock-life")!;
  expect(profile).toBeDefined();
  const second = structuredClone(profile);
  second.method_profile_id = "example:second-joint-state-owner";
  const firstRecords = hardLockStateExample(profile.method_profile_id);
  const secondRecords = hardLockStateExample(second.method_profile_id);
  secondRecords.device_state_observations.reverse();
  secondRecords.device_state_intervals.reverse();
  Reflect.set(secondRecords.device_state_observations[0]!, "observation_instant", null);
  Reflect.deleteProperty(secondRecords.device_state_observations[0]!, "screen_state");
  Reflect.set(secondRecords.device_state_intervals[0]!, "start_observation_ref", null);
  Reflect.deleteProperty(secondRecords.device_state_intervals[1]!, "end_observation_ref");
  Reflect.set(secondRecords.device_state_intervals[1]!.denotes_interval, "start_status", null);
  Reflect.set(secondRecords.device_state_intervals[1]!.denotes_interval, "end_status", null);
  const input = { profiles: [profile, second],
    device_state_observations: [...firstRecords.device_state_observations, ...secondRecords.device_state_observations],
    device_state_intervals: [...firstRecords.device_state_intervals, ...secondRecords.device_state_intervals] };
  const parsed = parseStudyMethodProfileLibrary(input);
  expect(parsed.device_state_observations).toEqual(input.device_state_observations);
  expect(parsed.device_state_intervals).toEqual(input.device_state_intervals);
  const external = trackExternalRequests(page);
  await gotoApp(page);
  const picker = page.getByTestId("method-profile-file-input");
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const importValue = (value: unknown) => picker.setInputFiles({ name: "normalized-joint-state-example.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
  const savedSelection = () => page.evaluate(async ({ database, store }) => {
    if (!(await indexedDB.databases()).some((db) => db.name === database)) throw new Error("Saved database missing");
    return new Promise<Record<string, unknown>>((resolveSaved, reject) => {
      const request = indexedDB.open(database);
      request.onerror = () => reject(new Error(request.error?.message ?? "Saved database open failed"));
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(store, "readonly");
        const read = tx.objectStore(store).get("research-selection") as IDBRequest<{ selectionJson: string } | undefined>;
        tx.onerror = () => { db.close(); reject(new Error(tx.error?.message ?? "Saved selection read failed")); };
        tx.oncomplete = () => {
          db.close();
          if (!read.result) { reject(new Error("Saved selection missing")); return; }
          try { resolveSaved(JSON.parse(read.result.selectionJson) as Record<string, unknown>); }
          catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
        };
      };
    });
  }, { database: LAST_RUN_DB_NAME, store: LAST_RUN_STORE_NAME });
  const assertOwner = async (id: string) => {
    const expected = { profile: parsed.profiles.find((p) => p.method_profile_id === id), selectedLevels: {},
      device_state_observations: parsed.device_state_observations!.filter((r) => r.method_profile_id === id),
      device_state_intervals: parsed.device_state_intervals!.filter((r) => r.method_profile_id === id) };
    for (const [label, rows] of [["Device-state observations", expected.device_state_observations], ["Device-state intervals", expected.device_state_intervals]] as const) {
      const details = card.locator("details").filter({ has: page.getByText(`${label} (${rows.length})`, { exact: true }) });
      await expect(details).toHaveCount(1);
      if (!await details.evaluate((el) => (el as HTMLDetailsElement).open)) await details.locator("summary").click();
      await expect(details.locator("li")).toHaveCount(rows.length);
      for (const [index, row] of rows.entries()) for (const [key, value] of Object.entries(row)) {
        const title = key.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
        await expect(details.locator("li").nth(index)).toContainText(`${title}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
      }
    }
    await expect(card).toContainText("No state reconstruction");
    await expect(card.getByRole("button", { name: "Load supported preprocessing settings" })).toBeDisabled();
    await expect.poll(savedSelection).toEqual(expected);
  };
  for (const owner of parsed.profiles) {
    await importValue(input);
    await card.getByRole("combobox", { name: "Profile", exact: true }).selectOption(owner.method_profile_id);
    await assertOwner(owner.method_profile_id);
    await reloadApp(page);
    await assertOwner(owner.method_profile_id);
  }
  const prior = await savedSelection();
  const mutants: Array<[(x: typeof input) => void, string]> = [
    [(x) => { x.device_state_intervals[0]!.end_observation_ref = "missing"; }, "end_observation_ref has no matching observation"],
    [(x) => { x.device_state_intervals[0]!.device_id = "foreign-device"; }, "start_observation_ref has no matching observation"],
    [(x) => { x.device_state_intervals[0]!.method_setting_reference = x.device_state_intervals[1]!.method_setting_reference; }, "no matching local definition role/target"],
    [(x) => { x.device_state_intervals[1]!.end_observation_ref = "off-unlocked"; }, "end_observation_ref contradicts the known endpoint state"],
    [(x) => { x.device_state_observations[0]!.source_work_id = "foreign-source"; }, "no matching profile/source owner"],
    [(x) => { x.device_state_observations.push(structuredClone(x.device_state_observations[0]!)); }, "state_observation_id is blank or duplicated"],
    [(x) => { x.device_state_intervals[1]!.method_setting_reference = "method-setting-b54f90dba8eb1c15e9d0bfc4"; }, "no matching interval endpoint definition"],
  ];
  for (const [mutate, message] of mutants) {
    const mutant = structuredClone(input);
    mutate(mutant);
    await importValue(mutant);
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText(message);
    expect(await savedSelection()).toEqual(prior);
  }
  await reloadApp(page);
  await assertOwner(second.method_profile_id);
  await importValue({ profiles: [profile], device_state_observations: [], device_state_intervals: [] });
  await expect.poll(savedSelection).toEqual({ profile: parsed.profiles[0], selectedLevels: {}, device_state_observations: [], device_state_intervals: [] });
  await reloadApp(page);
  await expect(card).toContainText(profile.source_work_id);
  await expect(card).not.toContainText("Device-state observations");
  await expect(card).not.toContainText("Device-state intervals");
  expect(await savedSelection()).toEqual({ profile: parsed.profiles[0], selectedLevels: {}, device_state_observations: [], device_state_intervals: [] });
  await importValue({ profiles: [profile] });
  await expect.poll(savedSelection).toEqual({ profile: parsed.profiles[0], selectedLevels: {} });
  await reloadApp(page);
  await expect(card).toContainText(profile.source_work_id);
  await expect(card).not.toContainText("Device-state observations");
  await expect(card).not.toContainText("Device-state intervals");
  expect(await savedSelection()).toEqual({ profile: parsed.profiles[0], selectedLevels: {} });
  assertNoExternalRequests(external);
});
