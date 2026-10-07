import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PRIVATE_CORPUS_SKIP_REASON, privateCorpusAvailable, privateCorpusPath } from "../src/testSupport/privateCorpus";
import { gotoApp, reloadApp, trackExternalRequests, assertNoExternalRequests } from "./helpers";
import { LAST_RUN_DB_NAME, LAST_RUN_STORE_NAME } from "../src/lib/lastRunStore";
import type { StudyMethodProfile } from "../src/lib/methodProfiles";
import { taskReferenceExample } from "./fixtures/task-reference-examples";

// Every test in this file reads the private literature corpus.
test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);

for (const [work, label] of [["doi:10.1145/3743726", "ODIM linked ratings"], ["source-ref:e2014b2268ac2833bb8e", "Brain Disorders paired assessments"], ["doi:10.1145/3422821", "BDI-II severity assessments"], ["doi:10.1145/2371574.2371617", "Back to the App signed comparison"]]) {
  test(`preserves ${label} through real import, owner selection, rejection and reload`, async ({ page }) => {
    const { profiles } = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
    const profile = profiles.find(p => p.source_work_id === work)!;
    const input = taskReferenceExample(profile);
    const other = { ...structuredClone(profile), method_profile_id: "example:other-reference-owner" };
    const otherInput = taskReferenceExample(other);
    for (const trace of otherInput.interaction_traces) trace.interaction_trace_id += ":other";
    for (const task of otherInput.task_occurrences) {
      if (task.interaction_trace_reference) task.interaction_trace_reference += ":other";
      if (task.task_questionnaire_responses?.[0]) task.task_questionnaire_responses[0].response_value_json = "2.00";
      if (task.criterion_assessments?.[0]) task.criterion_assessments[0].assessment_value_json = "12.00";
    }
    input.profiles.push(other);
    input.task_occurrences.push(...otherInput.task_occurrences);
    input.interaction_traces.push(...otherInput.interaction_traces);
    input.participant_day_observations.push(...otherInput.participant_day_observations);
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
    const channels = [["task_occurrences", "Task occurrences"], ["interaction_traces", "Supplied interaction traces"], ["participant_day_observations", "Participant-period observations"]] as const;
    const importAll = () => picker.setInputFiles({ name: "constructed-reference-examples.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
    const assertOwner = async (owner: StudyMethodProfile) => {
      await expect.poll(async () => (await saved()).profile).toEqual(owner);
      for (const [key, heading] of channels) {
        const rows = input[key].filter(r => r.method_profile_id === owner.method_profile_id);
        await expect.poll(async () => (await saved())[key]).toEqual(rows);
        if (!rows.length) continue;
        const section = card.locator("details").filter({ has: page.getByText(`${heading} (${rows.length})`, { exact: true }) });
        if (!await section.evaluate(el => (el as HTMLDetailsElement).open)) await section.locator("summary").click();
        await expect(section.locator("li")).toHaveCount(rows.length);
        for (const [i, row] of rows.entries()) for (const [field, value] of Object.entries(row)) {
          const name = field.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
          await expect(section.locator("li").nth(i)).toContainText(`${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
        }
      }
      expect((await saved()).referenced_artifacts).toEqual(input.referenced_artifacts);
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
    if (work === "doi:10.1145/3743726") invalid.task_occurrences[0]!.interaction_trace_reference = otherInput.interaction_traces[0]!.interaction_trace_id;
    else invalid.task_occurrences[0]!.criterion_assessments![2]!.support_criterion_assessment_references = ["sibling-only"];
    await picker.setInputFiles({ name: "foreign-support.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText(work === "doi:10.1145/3743726" ? "same profile/source" : "within task occurrence");
    expect(await saved()).toEqual(before);
    if (work === "doi:10.1145/2371574.2371617") {
      const wrongApp = structuredClone(input);
      wrongApp.task_occurrences[0]!.task_actions![3]!.app_identifier = "example:foreign-normal-app";
      await picker.setInputFiles({ name: "wrong-comparison-app.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(wrongApp)) });
      await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("same app");
      expect(await saved()).toEqual(before);
    }
    await reloadApp(page);
    await assertOwner(profile);
    await picker.setInputFiles({ name: "profile-only.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ profiles: [profile] })) });
    for (const [key, heading] of channels) {
      await expect.poll(async () => (await saved())[key]).toBeUndefined();
      await expect(card).not.toContainText(heading);
    }
    await reloadApp(page);
    expect((await saved()).profile).toEqual(profile);
    for (const [key] of channels) expect((await saved())[key]).toBeUndefined();
    assertNoExternalRequests(external);
  });
}
