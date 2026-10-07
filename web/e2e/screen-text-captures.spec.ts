import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PRIVATE_CORPUS_SKIP_REASON, privateCorpusAvailable, privateCorpusPath } from "../src/testSupport/privateCorpus";
import { gotoApp, reloadApp, trackExternalRequests, assertNoExternalRequests } from "./helpers";
import { LAST_RUN_DB_NAME, LAST_RUN_STORE_NAME } from "../src/lib/lastRunStore";
import { parseStudyMethodProfileLibrary, type StudyMethodProfileLibrary } from "../src/lib/methodProfiles";
import { expectMethodProfileLoadAction } from "./methodProfileLoadAction";

// Every test in this file reads the private literature corpus.
test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);

for (const ownerMode of ["same-source", "different-sources"] as const) {
test(`preserves text and independent controls across ${ownerMode} import, owner switching and reload`, async ({ page }) => {
  const root = resolve(import.meta.dirname, "../..");
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as StudyMethodProfileLibrary;
  const profile = library.profiles.find((p) => p.source_work_id === "doi:10.1145/3613904.3642347")!;
  expect(profile).toBeDefined();
  const records = JSON.parse(readFileSync(resolve(root, "web/e2e/fixtures/screen-text-example.json.fixture"), "utf8")) as Required<Pick<StudyMethodProfileLibrary, "screen_text_captures" | "sensor_control_occurrences">>;
  const second = structuredClone(ownerMode === "same-source" ? profile
    : library.profiles.find((p) => p.source_work_id === "doi:10.1145/2493190.2493219")!);
  expect(second).toBeDefined();
  if (ownerMode === "same-source") second.method_profile_id = "example:second-text-owner";
  const secondRecords = structuredClone(records);
  for (const rows of Object.values(secondRecords)) for (const row of rows) row.method_profile_id = second.method_profile_id;
  secondRecords.screen_text_captures.reverse();
  secondRecords.sensor_control_occurrences.reverse();
  secondRecords.screen_text_captures.at(-1)!.screen_phrases!.reverse();
  secondRecords.screen_text_captures.at(-1)!.screen_text = null;
  if (ownerMode === "different-sources") {
    secondRecords.screen_text_captures = [];
    secondRecords.sensor_control_occurrences = [];
  }
  const tasks = JSON.parse(readFileSync(resolve(root, "web/e2e/fixtures/oh-app-task-example.json.fixture"), "utf8")) as Required<Pick<StudyMethodProfileLibrary, "task_occurrences">>;
  const input = { profiles: [profile, second],
    screen_text_captures: [...records.screen_text_captures, ...secondRecords.screen_text_captures],
    sensor_control_occurrences: [...records.sensor_control_occurrences, ...secondRecords.sensor_control_occurrences],
    ...(ownerMode === "different-sources" ? tasks : {}) };
  const parsed = parseStudyMethodProfileLibrary(input);
  const external = trackExternalRequests(page);
  await gotoApp(page);
  const picker = page.getByTestId("method-profile-file-input");
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const importValue = (value: unknown) => picker.setInputFiles({ name: "normalized-text-captures.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
  const savedSelection = () => page.evaluate(async ({ database, store }) => {
    if (!(await indexedDB.databases()).some((db) => db.name === database)) throw new Error("Saved database missing");
    return new Promise<Record<string, unknown>>((resolveSaved, reject) => {
      const request = indexedDB.open(database);
      request.onerror = () => reject(new Error(request.error?.message ?? "Saved database open failed"));
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(store, "readonly");
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
      screen_text_captures: parsed.screen_text_captures!.filter((r) => r.method_profile_id === id),
      sensor_control_occurrences: parsed.sensor_control_occurrences!.filter((r) => r.method_profile_id === id),
      ...(parsed.task_occurrences === undefined ? {} : { task_occurrences: parsed.task_occurrences.filter((r) => r.method_profile_id === id) }) };
    for (const [label, rows] of [["Screen-text captures", expected.screen_text_captures], ["Sensor-control occurrences", expected.sensor_control_occurrences], ["Task occurrences", expected.task_occurrences ?? []]] as const) {
      const details = card.locator("details").filter({ has: page.getByText(`${label} (${rows.length})`, { exact: true }) });
      if (rows.length === 0) {
        await expect(card.locator("summary").filter({ hasText: new RegExp(`^${label} \\(`) })).toHaveCount(0);
        continue;
      }
      await expect(details).toHaveCount(1);
      if (!await details.evaluate((el) => (el as HTMLDetailsElement).open)) await details.locator("summary").click();
      await expect(details.locator("li")).toHaveCount(rows.length);
      for (const [index, row] of rows.entries()) for (const [key, value] of Object.entries(row)) {
        const title = key.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
        await expect(details.locator("li").nth(index)).toContainText(`${title}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
      }
    }
    await expect(card).toContainText(expected.screen_text_captures.length ? "No text parsing" : "No script matching");
    await expectMethodProfileLoadAction(card, expected.profile!);
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
  const mutations: Array<[(x: typeof input) => void, string]> = [
    [(x) => { x.screen_text_captures[0]!.source_work_id = "foreign"; }, "profile/source owner"],
    [(x) => { x.screen_text_captures[0]!.method_setting_reference = "method-setting-e05cbf981cdb52c2f8a1eb94"; }, "text-capture definition"],
    [(x) => { x.screen_text_captures[0]!.screen_phrases!.push(structuredClone(x.screen_text_captures[0]!.screen_phrases![0]!)); }, "duplicated within capture"],
    [(x) => { x.screen_text_captures.push(structuredClone(x.screen_text_captures[0]!)); }, "duplicated within profile/participant/device"],
    [(x) => { Reflect.set(x.screen_text_captures[0]!.screen_phrases![0]!, "phrase_left_px", "0"); }, "finite or null"],
    [(x) => { Reflect.set(x.sensor_control_occurrences[0]!, "sensor_control_action", ["enable"]); }, "sensor_control_action is unknown"],
    [(x) => { x.sensor_control_occurrences[0]!.method_setting_reference = "method-setting-7388f44a069bb47d12f0ba37"; }, "logged sensor-control definition"],
  ];
  if (ownerMode === "different-sources") mutations.push([
    (x) => { x.task_occurrences![2]!.task_questionnaire_responses![0]!.questionnaire_setting_reference = "method-setting-3ad1a39a9e28fd195ba7b4a3"; },
    "compatible response-scale definition",
  ]);
  for (const [mutate, message] of mutations) {
    const x = structuredClone(input); mutate(x);
    await importValue(x);
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText(message);
    expect(await savedSelection()).toEqual(prior);
  }
  await reloadApp(page); await assertOwner(second.method_profile_id);
  await importValue({ profiles: [profile], screen_text_captures: [], sensor_control_occurrences: [] });
  await expect.poll(savedSelection).toEqual({ profile: parsed.profiles[0], selectedLevels: {}, screen_text_captures: [], sensor_control_occurrences: [] });
  await reloadApp(page);
  await expect(card).toContainText(profile.source_work_id);
  await expect(card).not.toContainText("Screen-text captures");
  await expect(card).not.toContainText("Sensor-control occurrences");
  expect(await savedSelection()).toEqual({ profile: parsed.profiles[0], selectedLevels: {}, screen_text_captures: [], sensor_control_occurrences: [] });
  await importValue({ profiles: [profile] });
  await expect.poll(savedSelection).toEqual({ profile: parsed.profiles[0], selectedLevels: {} });
  await reloadApp(page);
  await expect(card).toContainText(profile.source_work_id);
  expect(await savedSelection()).toEqual({ profile: parsed.profiles[0], selectedLevels: {} });
  if (ownerMode === "different-sources") {
    await importValue({ profiles: [second], ...tasks });
    const taskOnly = { profile: parsed.profiles[1], selectedLevels: {}, ...tasks };
    await expect.poll(savedSelection).toEqual(taskOnly);
    await reloadApp(page);
    await expect(card).toContainText(`Variant: ${second.source_work_id}`);
    await expect(card).not.toContainText("Screen-text captures");
    await expect(card).not.toContainText("Sensor-control occurrences");
    await expect.poll(savedSelection).toEqual(taskOnly);
  }
  assertNoExternalRequests(external);
});
}
