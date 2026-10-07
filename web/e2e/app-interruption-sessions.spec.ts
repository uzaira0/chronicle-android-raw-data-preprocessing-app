import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PRIVATE_CORPUS_SKIP_REASON, privateCorpusAvailable, privateCorpusPath } from "../src/testSupport/privateCorpus";
import { gotoApp, reloadApp, trackExternalRequests, assertNoExternalRequests } from "./helpers";
import { appInterruptionSessionExample, appInterruptionQuestionnaireExample } from "./fixtures/app-interruption-session";
import { LAST_RUN_DB_NAME, LAST_RUN_STORE_NAME } from "../src/lib/lastRunStore";
import { parseStudyMethodProfileLibrary, type StudyMethodProfile } from "../src/lib/methodProfiles";
import { expectMethodProfileLoadAction } from "./methodProfileLoadAction";

// Every test in this file reads the private literature corpus.
test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);

for (const [work, label] of [
  ["illustration", "published individual interruptions"],
  ["doi:10.1145/3191754", "Meaningful per-instance answers and four durations"],
  ["doi:10.1145/3473856.3473881", "WhyStop partial ESQ and independent net seconds"],
] as const) {
test(`preserves ${label} through picker, owner selection and reload`, async ({ page }) => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const seed = work === "illustration" ? appInterruptionSessionExample()
    : appInterruptionQuestionnaireExample(library.profiles.find(p => p.source_work_id === work)!);
  const parsed = parseStudyMethodProfileLibrary(seed);
  const input = { profiles: parsed.profiles, app_interruption_sessions: parsed.app_interruption_sessions!,
    ...(parsed.sampled_quantity_observations === undefined ? {} : { sampled_quantity_observations: parsed.sampled_quantity_observations }),
    ...(parsed.notification_histories === undefined ? {} : { notification_histories: parsed.notification_histories }),
    ...(parsed.participant_day_observations === undefined ? {} : { participant_day_observations: parsed.participant_day_observations }) };
  if (work === "illustration") {
    const second = structuredClone(input.app_interruption_sessions[0]!.interruptions![0]!);
    second.interruption_record_id = "constructed-second-at-identical-times";
    input.app_interruption_sessions[0]!.interruptions!.push(second);
  }
  const other = structuredClone(input);
  other.profiles[0]!.method_profile_id = "example:other-interruption-owner";
  other.app_interruption_sessions.forEach(row => { row.method_profile_id = other.profiles[0]!.method_profile_id; });
  for (const field of ["sampled_quantity_observations", "notification_histories", "participant_day_observations"] as const)
    other[field]?.forEach(row => { row.method_profile_id = other.profiles[0]!.method_profile_id; });
  other.app_interruption_sessions.reverse();
  if (work === "illustration") other.app_interruption_sessions[0]!.interruptions!.reverse();
  input.profiles.push(...other.profiles);
  input.app_interruption_sessions.push(...other.app_interruption_sessions);
  if (other.sampled_quantity_observations) input.sampled_quantity_observations!.push(...other.sampled_quantity_observations);
  if (other.notification_histories) input.notification_histories!.push(...other.notification_histories);
  if (other.participant_day_observations) input.participant_day_observations!.push(...other.participant_day_observations);
  const expectedProfiles = parseStudyMethodProfileLibrary(input).profiles;
  const external = trackExternalRequests(page);
  await gotoApp(page);
  const picker = page.getByTestId("method-profile-file-input");
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const importAll = () => picker.setInputFiles({ name: "interruption-session-examples.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
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
    const expected = input.app_interruption_sessions.filter((session) => session.method_profile_id === id);
    const section = card.locator("details").filter({ has: page.getByText(`App interruption sessions (${expected.length})`, { exact: true }) });
    await expect(section).toHaveCount(1);
    if (!await section.evaluate((el) => (el as HTMLDetailsElement).open)) await section.locator("summary").click();
    await expect(section.locator("li")).toHaveCount(expected.length);
    const sessionTexts = await section.locator("li").allTextContents();
    for (const [i, row] of expected.entries()) for (const [key, value] of Object.entries(row)) {
      const label = key.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
      const text = `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
      expect(sessionTexts[i]!.replace(/\s+/g, " ").trim()).toContain(text.replace(/\s+/g, " ").trim());
    }
    const owner = expectedProfiles.find(profile => profile.method_profile_id === id)!;
    await expectMethodProfileLoadAction(card, owner);
    await expect.poll(async () => (await savedSelection()).app_interruption_sessions).toEqual(expected);
    expect((await savedSelection()).profile).toEqual(expectedProfiles.find((profile) => profile.method_profile_id === id));
    for (const [field, title] of [["sampled_quantity_observations", "Sampled quantities"], ["notification_histories", "Notification histories"], ["participant_day_observations", "Participant-period observations"]] as const) {
      if (!input[field]) continue;
      const readings = input[field].filter(row => row.method_profile_id === id);
      const sampled = card.locator("details").filter({ has: page.getByText(title + " (" + readings.length + ")", { exact: true }) });
      await expect(sampled).toHaveCount(1);
      if (!await sampled.evaluate(el => (el as HTMLDetailsElement).open)) await sampled.locator("summary").click();
      await expect(sampled.locator("li")).toHaveCount(readings.length);
      const texts = await sampled.locator("li").allTextContents();
      for (const [index, reading] of readings.entries()) for (const [key, value] of Object.entries(reading)) {
        const field = key.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
        const text = field + ": " + (typeof value === "string" ? value : JSON.stringify(value));
        expect(texts[index]!.replace(/\s+/g, " ").trim()).toContain(text.replace(/\s+/g, " ").trim());
      }
      await expect.poll(async () => (await savedSelection())[field]).toEqual(readings);
    }
  };
  for (const profile of input.profiles) {
    await importAll();
    await card.getByRole("combobox", { name: "Profile", exact: true }).selectOption(profile.method_profile_id);
    await assertOwner(profile.method_profile_id);
    await reloadApp(page);
    await assertOwner(profile.method_profile_id);
  }
  // Reload restores only the saved owner, so the multi-profile selector is absent.
  const retainedId = input.profiles.at(-1)!.method_profile_id;
  const prior = await savedSelection();
  const invalid = structuredClone(input);
  invalid.app_interruption_sessions[0]!.source_work_id = "foreign-work";
  await picker.setInputFiles({ name: "foreign-owner.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("matching profile/source owner");
  await reloadApp(page);
  await assertOwner(retainedId);
  expect(await savedSelection()).toEqual(prior);
  if (work === "doi:10.1145/3473856.3473881") {
    const wrongMovementOwner = structuredClone(input);
    wrongMovementOwner.sampled_quantity_observations![0]!.device_id = "example:foreign-known-device";
    await picker.setInputFiles({ name: "foreign-movement-owner.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(wrongMovementOwner)) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("compatible known device");
    expect(await savedSelection()).toEqual(prior);
    const wrongNotificationOwner = structuredClone(input);
    wrongNotificationOwner.notification_histories![0]!.participant_id = "example:foreign-participant";
    await picker.setInputFiles({ name: "foreign-notification-owner.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(wrongNotificationOwner)) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("notification_history_references");
    expect(await savedSelection()).toEqual(prior);
    const foreign = structuredClone(input);
    foreign.app_interruption_sessions[1]!.interruptions = [{ interruption_record_id: "example:other-session-only", denotes_interval: {}, source_locators: foreign.app_interruption_sessions[1]!.source_locators }];
    foreign.app_interruption_sessions[0]!.session_questionnaire_responses!.at(-1)!.interruption_record_reference = "example:other-session-only";
    await picker.setInputFiles({ name: "foreign-interruption-answer.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(foreign)) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("within the containing session");
    expect(await savedSelection()).toEqual(prior);
  }
  const fields = work === "illustration" ? ["interruptions"] : ["session_questionnaire_responses", "session_quantities"];
  for (const field of fields) for (const membership of [null, [], undefined]) {
    Reflect.set(input.app_interruption_sessions[0]!, field, membership);
    if (membership === undefined) Reflect.deleteProperty(input.app_interruption_sessions[0]!, field);
    if (field === "session_questionnaire_responses") input.app_interruption_sessions[0]!.session_labels?.forEach(label => { delete label.questionnaire_response_references; });
    await importAll();
    await assertOwner(input.profiles[0]!.method_profile_id);
    await reloadApp(page);
    await assertOwner(input.profiles[0]!.method_profile_id);
  }
  await picker.setInputFiles({ name: "profile-only.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ profiles: input.profiles })) });
  await expect(card).not.toContainText("App interruption sessions");
  await expect.poll(async () => (await savedSelection()).app_interruption_sessions).toBeUndefined();
  for (const field of ["sampled_quantity_observations", "notification_histories", "participant_day_observations"] as const)
    await expect.poll(async () => (await savedSelection())[field]).toBeUndefined();
  await reloadApp(page);
  await expect(card).not.toContainText("App interruption sessions");
  assertNoExternalRequests(external);
});

}
