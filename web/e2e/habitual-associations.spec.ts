import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PRIVATE_CORPUS_SKIP_REASON, privateCorpusAvailable, privateCorpusPath } from "../src/testSupport/privateCorpus";
import { gotoApp, reloadApp, trackExternalRequests, assertNoExternalRequests } from "./helpers";
import { LAST_RUN_DB_NAME, LAST_RUN_STORE_NAME } from "../src/lib/lastRunStore";
import type { SessionAssociationDatabaseRecord, StudyMethodProfile, TaskOccurrenceRecord } from "../src/lib/methodProfiles";

// Every test in this file reads the private literature corpus.
test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);

test("preserves Habitual rules, distinct habit workflows and questionnaires through picker, selected-owner storage and reload", async ({ page }) => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = library.profiles.find((p) => p.source_work_id === "doi:10.1145/3447991")!;
  const records = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/habitual-association-example.json.fixture"), "utf8")) as { session_association_databases: SessionAssociationDatabaseRecord[]; task_occurrences: TaskOccurrenceRecord[] };
  const other = { ...structuredClone(profile), method_profile_id: "example:other-association-owner" };
  const otherDatabases = records.session_association_databases.map((d) => ({ ...structuredClone(d), method_profile_id: other.method_profile_id }));
  const reverse = otherDatabases[0]!.association_rules![0]!;
  [reverse.antecedent_app_items, reverse.consequent_app_items] = [reverse.consequent_app_items, reverse.antecedent_app_items];
  const otherTasks = records.task_occurrences.map(task => ({ ...structuredClone(task), method_profile_id: other.method_profile_id }));
  otherTasks[0]!.task_actions![3]!.action_content_json = '"Independent intention for the second profile"';
  const input = { profiles: [profile, other], session_association_databases: [...records.session_association_databases, ...otherDatabases], task_occurrences: [...records.task_occurrences, ...otherTasks] };
  const external = trackExternalRequests(page);
  await gotoApp(page);
  const picker = page.getByTestId("method-profile-file-input");
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const saved = () => page.evaluate(async ({ database, store }) => new Promise<Record<string, unknown>>((resolveSaved, reject) => {
    const open = indexedDB.open(database);
    open.onerror = () => reject(new Error(open.error?.message ?? "selection database open failed"));
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(store, "readonly");
      const read = tx.objectStore(store).get("research-selection") as IDBRequest<{ selectionJson: string } | undefined>;
      tx.onerror = () => { db.close(); reject(new Error(tx.error?.message ?? "selection read failed")); };
      tx.oncomplete = () => { db.close(); if (!read.result) reject(new Error("selection missing")); else resolveSaved(JSON.parse(read.result.selectionJson) as Record<string, unknown>); };
    };
  }), { database: LAST_RUN_DB_NAME, store: LAST_RUN_STORE_NAME });
  const importAll = () => picker.setInputFiles({ name: "supplied-associations.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
  const assertOwner = async (owner: StudyMethodProfile) => {
    await expect(card).toContainText("No session reconstruction, clustering, mining or metric calculation runs during import");
    const section = card.locator("details").filter({ has: page.getByText("Session association databases (3)", { exact: true }) });
    if (!await section.evaluate((el) => (el as HTMLDetailsElement).open)) await section.locator("summary").click();
    const expected = input.session_association_databases.filter((d) => d.method_profile_id === owner.method_profile_id);
    await expect(section.locator("li")).toHaveCount(3);
    for (const [i, database] of expected.entries()) {
      for (const [key, value] of Object.entries(database)) {
        const label = key.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
        await expect(section.locator("li").nth(i)).toContainText(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
      }
    }
    await expect.poll(async () => (await saved()).session_association_databases).toEqual(expected);
    const tasks = input.task_occurrences.filter(task => task.method_profile_id === owner.method_profile_id);
    const taskSection = card.locator("details").filter({ has: page.getByText("Task occurrences (8)", { exact: true }) });
    if (!await taskSection.evaluate(el => (el as HTMLDetailsElement).open)) await taskSection.locator("summary").click();
    await expect(taskSection.locator("li")).toHaveCount(8);
    for (const [i, task] of tasks.entries()) {
      for (const [key, value] of Object.entries(task)) {
        const label = key.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
        await expect(taskSection.locator("li").nth(i)).toContainText(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
      }
    }
    await expect.poll(async () => (await saved()).task_occurrences).toEqual(tasks);
    expect((await saved()).profile).toEqual(owner);
    await expect(card.getByRole("button", { name: "Load supported preprocessing settings" })).toBeDisabled();
  };
  await importAll();
  for (const owner of input.profiles) {
    await card.getByRole("combobox", { name: "Profile", exact: true }).selectOption(owner.method_profile_id);
    await assertOwner(owner);
    await reloadApp(page);
    await assertOwner(owner);
    await importAll();
  }
  await assertOwner(profile);
  const before = await saved();
  const invalid = structuredClone(input);
  invalid.session_association_databases[1]!.session_transactions![0]!.absent_app_items!.push("Facebook");
  await picker.setInputFiles({ name: "contradictory-items.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("both present and absent");
  expect(await saved()).toEqual(before);
  const invalidInstrument = structuredClone(input);
  invalidInstrument.task_occurrences[4]!.task_questionnaire_responses![0]!.questionnaire_setting_reference = "method-setting-0df9d9d63d833d118ea93fff";
  await picker.setInputFiles({ name: "reported-result-not-instrument.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalidInstrument)) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("compatible response-scale");
  expect(await saved()).toEqual(before);
  await reloadApp(page);
  await assertOwner(profile);
  await picker.setInputFiles({ name: "profile-only.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ profiles: [profile] })) });
  await expect.poll(async () => (await saved()).session_association_databases).toBeUndefined();
  await expect.poll(async () => (await saved()).task_occurrences).toBeUndefined();
  await reloadApp(page);
  await expect(card).toContainText(`Variant: ${profile.source_work_id}`);
  await expect(card).not.toContainText("Session association databases");
  await expect(card).not.toContainText("Task occurrences");
  expect((await saved()).profile).toEqual(profile);
  assertNoExternalRequests(external);
});
