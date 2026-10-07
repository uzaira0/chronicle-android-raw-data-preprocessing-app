import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PRIVATE_CORPUS_SKIP_REASON, privateCorpusAvailable, privateCorpusPath } from "../src/testSupport/privateCorpus";
import { gotoApp, reloadApp, trackExternalRequests, assertNoExternalRequests } from "./helpers";
import { LAST_RUN_DB_NAME, LAST_RUN_STORE_NAME } from "../src/lib/lastRunStore";
import type { StudyMethodProfile } from "../src/lib/methodProfiles";
import { expectMethodProfileLoadAction } from "./methodProfileLoadAction";
import { taskInstrumentExamples } from "./fixtures/task-instrument-examples";

// Every test in this file reads the private literature corpus.
test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);

for (const [workId, label, fixture, answerTaskIndex, wrongDefinition] of [
  ["doi:10.1145/2750858.2804252", "Boredom supplied ESM predictors and pilot outcomes", "constructed-instruments", 0, "method-setting-54ccd4c5be01cf30e8b4a61f"],
  ["doi:10.1145/3191754", "Meaningful exit frequency", "constructed-instruments", 0, "method-setting-a9083fcc4d0cec8fb7155301"],
  ["doi:10.1145/3473856.3473881", "WhyStop independent surveys", "constructed-instruments", 0, "method-setting-8212b7717f3d8401939701eb"],
  ["doi:10.1145/3613904.3642832", "S-ADL", "s-adl-task-example.json.fixture", 0, ""],
  ["doi:10.1145/2493190.2493219", "Oh App", "oh-app-task-example.json.fixture", 2, "method-setting-3ad1a39a9e28fd195ba7b4a3"],
  ["doi:10.1109/acii.2019.8925518", "ACII categorical", "task-questionnaire-examples.json.fixture", 0, "method-setting-af82c9963f573bdf7c519e21"],
  ["doi:10.1145/3536221.3556603", "AffectPro categorical", "task-questionnaire-examples.json.fixture", 0, "method-setting-ea29d42cbb5d4cd017941948"],
  ["doi:10.1145/2371574.2371619", "Alt condition SUS", "task-questionnaire-examples.json.fixture", 0, "method-setting-4a4a71e6aa4ec387a43574ba"],
  ["doi:10.1145/2556288.2557066", "Böhmer condition TLX", "task-questionnaire-examples.json.fixture", 0, "method-setting-4615b1b0e4a7e91ee8ed365a"],
  ["doi:10.30773/pi.2020.0197", "PI self-report", "task-questionnaire-examples.json.fixture", 0, "method-setting-4e1d4241243661769c5eb786"],
  ["doi:10.3390/j2020008", "TSDI", "task-questionnaire-examples.json.fixture", 0, "method-setting-4690fa27fa21ee7a97c7fbea"],
  ["doi:10.7717/peerj.2197", "IAS and UCLA-LS", "task-questionnaire-examples.json.fixture", 0, "method-setting-5e1b446330bc73d8414c668e"],
  ["usenix:soups2014:harbach-hard-lock-life", "HardLock C1 and C2", "task-questionnaire-examples.json.fixture", 0, "method-setting-4e10b8ec2fe77672ad24cf29"],
  ["doi:10.1002/per.2309", "PAM response-window", "response-window-examples.json.fixture", 0, "method-setting-e36f8db35beae75e7dba31dd"],
  ["doi:10.1145/3313831.3376163", "Emotion response-window", "response-window-examples.json.fixture", 0, "method-setting-074d4c0b00c275de9fc42ff3"],
  ["doi:10.1007/s41347-024-00443-5", "Screenomics baseline and exit", "task-questionnaire-examples.json.fixture", 0, "method-setting-626de5906a2be1e95d588519"],
  ["doi:10.1145/2406367.2406384", "PasswordEntry instruments", "constructed-instruments", 0, "method-setting-309312902eaa52c924a78528"],
  ["doi:10.1145/2470654.2481345", "Sleepful instruments", "constructed-instruments", 0, "method-setting-e91b7eda4dfe8e691bffde28"],
  ["doi:10.1145/3613904.3642583", "Real-World Winds instruments", "constructed-instruments", 0, "method-setting-ebdaa4933e57860fac22155c"],
  ["doi:10.1016/j.smhl.2018.07.005", "DemonicSalmon instruments", "constructed-instruments", 0, "method-setting-11e9327dbd64d054241cd610"],
  ["doi:10.2196/55999", "JMIR55999 text and EMA", "constructed-instruments", 0, "method-setting-107c0dce753c9ea91a9a0381"],
  ["doi:10.2196/13209", "Loneliness UCLA instruments", "constructed-instruments", 0, "method-setting-13c1d2b9fb2edc4335e146e9"],
  ["doi:10.1016/j.smhl.2020.100118", "Moodable PHQ and willingness", "constructed-instruments", 0, "method-setting-fd247f1e496508a700555090"],
  ["doi:10.1186/s13104-015-1280-z", "WhatsApp BFI and demographics", "constructed-instruments", 0, "method-setting-200aba0960cd74de9c073974"],
  ["doi:10.3390/bs5040434", "Recorded Behavior weekly recall and MPPUS", "constructed-instruments", 0, "method-setting-4c66bb5ce22f7dc473172925"],
  ["doi:10.4088/jcp.15m10310", "App Measures clinician assessments", "constructed-instruments", 0, "method-setting-3b7105416a621bede70ac00a"],
  ["doi:10.1145/3675094.3677547", "ScreenTK manual references and text", "constructed-instruments", 0, "method-setting-5010c957e2b32a8d2a73be31"],
  ["doi:10.1371/journal.pone.0165331", "Direct Measurements initial eVisit", "constructed-instruments", 0, "method-setting-e446fda52d96418bff224c5f"],
  ["doi:10.1145/2971648.2971712", "Cognitive Rhythms EMA response-window", "assessment-window-examples.json.fixture", 0, "method-setting-8a0faf042a111540f939bad0"],
  ["doi:10.1145/2935334.2935383", "Murnane PVT and diary", "pvt-window-example.json.fixture", 0, "method-setting-1faf79744042dcbcdbc41d26"],
  ["doi:10.1145/3544793.3563411", "PHQ seven-day window", "assessment-window-examples.json.fixture", 0, "method-setting-6b20901c1d7688218292dc28"],
  ["doi:10.3758/s13428-024-02474-5", "Tutorial before-after windows", "assessment-window-examples.json.fixture", 0, "method-setting-c0575081d9ecdcfb8dce732b"],
  ["doi:10.1177/00936502241276793", "Digital Nightlife response-window", "assessment-window-examples.json.fixture", 0, "method-setting-245b9882717a9ffd3c15f030"],
  ["doi:10.1080/15213269.2020.1768122", "Online Vigilance response-window", "assessment-window-examples.json.fixture", 0, "method-setting-11b603c8aabae9e64f7d2155"],
  ["doi:10.3390/s20051396", "STDD supplied EMA feature-window fan-out", "assessment-window-examples.json.fixture", 0, "method-setting-e8ca658c0500b62a1c0573bd"],
  ["doi:10.1016/j.jbi.2019.103151", "Anxiety daily STAI and feature-label broadcast", "assessment-window-examples.json.fixture", 0, "method-setting-f3d4f4467818855ce2cb4c97"],
  ["doi:10.1145/3613904.3642347", "Screen Text receipt window and capture membership", "assessment-window-examples.json.fixture", 0, "method-setting-9fa81d55ad3f21e0633a8f3e"],
] as const) {
test(`preserves ${label} task actions and content through picker, selected-owner storage and reload`, async ({ page }) => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = library.profiles.find((p) => p.source_work_id === workId)!;
  const records = fixture === "constructed-instruments" ? taskInstrumentExamples(profile)
    : JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures", fixture), "utf8")) as ReturnType<typeof taskInstrumentExamples>;
  records.task_occurrences = records.task_occurrences.filter(t => t.source_work_id === workId);
  const other = { ...structuredClone(profile), method_profile_id: "example:other-task-owner" };
  const otherTasks = records.task_occurrences.map((t) => ({ ...structuredClone(t), method_profile_id: other.method_profile_id }));
  const criterionOnly = workId === "doi:10.4088/jcp.15m10310" || workId === "doi:10.1145/3675094.3677547";
  if (label === "S-ADL") {
    otherTasks[0]!.criterion_assessments![0]!.support_task_action_references = ["example:call"];
    otherTasks[0]!.criterion_assessments![1]!.support_task_action_references = ["example:registration"];
  } else if (workId === "doi:10.4088/jcp.15m10310") {
    otherTasks[0]!.criterion_assessments!.at(-1)!.assessment_value_json = '"positive"';
    expect(otherTasks[0]!.criterion_assessments).not.toEqual(records.task_occurrences[0]!.criterion_assessments);
    expect(otherTasks.slice(1)).toEqual(records.task_occurrences.slice(1).map(row => ({ ...structuredClone(row), method_profile_id: other.method_profile_id })));
  } else if (workId === "doi:10.1145/3675094.3677547") {
    otherTasks[0]!.criterion_assessments![0]!.criterion_label += "; independent second-owner annotation";
    expect(otherTasks[0]!.criterion_assessments).not.toEqual(records.task_occurrences[0]!.criterion_assessments);
  } else {
    otherTasks[answerTaskIndex]!.task_questionnaire_responses![0]!.response_value_json = label.includes("categorical") ? ' "relaxed" ' : ' "hypothetical alternative" ';
    expect(otherTasks.map(t => t.task_actions)).toEqual(records.task_occurrences.map(t => t.task_actions));
    expect(otherTasks[answerTaskIndex]!.task_questionnaire_responses).not.toEqual(records.task_occurrences[answerTaskIndex]!.task_questionnaire_responses);
  }
  const firstQuantity = otherTasks[0]?.task_observation_windows?.[0]?.quantities?.[0];
  if (fixture === "assessment-window-examples.json.fixture" && firstQuantity) firstQuantity.evidence_value_json = "7.00";
  const input = { profiles: [profile, other], task_occurrences: [...records.task_occurrences, ...otherTasks] };
  const extraChannels = [
    ["sampled_quantity_observations", "Sampled quantities"],
    ["app_feature_sessions", "App feature sessions"],
    ["participant_day_observations", "Participant-period observations"],
    ["screen_text_captures", "Screen-text captures"],
    ["device_use_sessions", "Device-use sessions"], ["notification_histories", "Notification histories"],
  ] as const;
  for (const [key] of extraChannels) {
    const rows = records[key]?.filter(row => row.source_work_id === workId);
    if (rows?.length) Reflect.set(input, key, [...rows, ...rows.map((row, i) => ({ ...structuredClone(row), method_profile_id: other.method_profile_id,
      ...(key === "participant_day_observations" && i === 0 ? { day_observation_value_json: "0.00" } : {}),
    }))]);
  }
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
  const importAll = () => picker.setInputFiles({ name: "constructed-tasks.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
  const assertOwner = async (owner: StudyMethodProfile) => {
    await expect(card).toContainText("No script matching, role assignment, timing reconstruction or scoring runs during import");
    const expected = input.task_occurrences.filter((t) => t.method_profile_id === owner.method_profile_id);
    const section = card.locator("details").filter({ has: page.getByText(`Task occurrences (${expected.length})`, { exact: true }) });
    if (!await section.evaluate((el) => (el as HTMLDetailsElement).open)) await section.locator("summary").click();
    await expect(section.locator("li")).toHaveCount(expected.length);
    for (const [i, task] of expected.entries()) {
      for (const [key, value] of Object.entries(task)) {
        const label = key.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
        await expect(section.locator("li").nth(i)).toContainText(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
      }
    }
    await expect.poll(async () => (await saved()).task_occurrences).toEqual(expected);
    for (const [key, heading] of extraChannels) {
      const allRows = Reflect.get(input, key) as Array<Record<string, unknown>> | undefined;
      const rows = allRows?.filter(row => row.method_profile_id === owner.method_profile_id);
      if (!rows) continue;
      const details = card.locator("details").filter({ has: page.getByText(`${heading} (${rows.length})`, { exact: true }) });
      if (!await details.evaluate(el => (el as HTMLDetailsElement).open)) await details.locator("summary").click();
      await expect(details.locator("li")).toHaveCount(rows.length);
      const texts = await details.locator("li").allTextContents();
      for (const [i, row] of rows.entries()) for (const [field, value] of Object.entries(row)) {
        const label = field.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
        const expected = `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
        expect(texts[i]!.replace(/\s+/g, " ").trim()).toContain(expected.replace(/\s+/g, " ").trim());
      }
      await expect.poll(async () => (await saved())[key]).toEqual(rows);
    }
    expect((await saved()).profile).toEqual(owner);
    await expectMethodProfileLoadAction(card, owner);
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
  const retained = (await saved()).profile as StudyMethodProfile;
  const before = await saved();
  const invalid = structuredClone(input);
  if (label === "S-ADL") invalid.task_occurrences[0]!.criterion_assessments![0]!.support_task_action_references = ["example:foreign-task-member"];
  else if (criterionOnly) invalid.task_occurrences[0]!.criterion_assessments!.at(-1)!.criterion_setting_reference = wrongDefinition;
  else invalid.task_occurrences[answerTaskIndex]!.task_questionnaire_responses![0]!.questionnaire_setting_reference = wrongDefinition;
  await picker.setInputFiles({ name: "foreign-task-support.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText(label === "S-ADL" ? "within task occurrence" : criterionOnly ? "compatible criterion definition" : "compatible response-scale definition");
  expect(await saved()).toEqual(before);
  if (workId === "doi:10.1145/2750858.2804252") {
    const foreign = structuredClone(input);
    const samples = Reflect.get(foreign, "sampled_quantity_observations") as Array<Record<string, unknown>>;
    samples[0]!.task_occurrence_reference = "foreign supplied ESM";
    await picker.setInputFiles({ name: "foreign-boredom-feature-task.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(foreign)) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("matching task within profile/source/participant/device");
    expect(await saved()).toEqual(before);
    const rawTime = structuredClone(input);
    const timeSamples = Reflect.get(rawTime, "sampled_quantity_observations") as Array<Record<string, unknown>>;
    timeSamples.find(row => row.sampled_observation_id === "example:boredom-raw:event:3")!.source_event_time_token = 0;
    await picker.setInputFiles({ name: "invalid-boredom-raw-time.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(rawTime)) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("source_event_time_token must be a string or null");
    expect(await saved()).toEqual(before);
    const wrongRawReference = structuredClone(input);
    const referenceSamples = Reflect.get(wrongRawReference, "sampled_quantity_observations") as Array<Record<string, unknown>>;
    referenceSamples.find(row => row.sampled_observation_id === "example:boredom-raw:event:3")!.method_setting_reference = "foreign raw occurrence definition";
    await picker.setInputFiles({ name: "foreign-boredom-raw-definition.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(wrongRawReference)) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("local definition role/target");
    expect(await saved()).toEqual(before);
    const wrongRawUnit = structuredClone(input);
    const rawSamples = Reflect.get(wrongRawUnit, "sampled_quantity_observations") as Array<Record<string, unknown>>;
    const rawBattery = rawSamples.find(row => row.sampled_observation_id === "example:boredom-raw:battery_status")!;
    const quantities = rawBattery.quantities as Array<Record<string, unknown>>;
    quantities[0]!.evidence_unit = "dB";
    await picker.setInputFiles({ name: "wrong-boredom-raw-unit.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(wrongRawUnit)) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("evidence_unit must be percent");
    expect(await saved()).toEqual(before);
  }
  if (workId === "doi:10.4088/jcp.15m10310") {
    const foreign = structuredClone(input);
    foreign.task_occurrences[0]!.criterion_assessments!.at(-1)!.support_criterion_assessment_references = [foreign.task_occurrences[1]!.criterion_assessments![0]!.criterion_assessment_id];
    await picker.setInputFiles({ name: "foreign-clinician-support.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(foreign)) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("duplicate, self or missing assessments within task occurrence");
    expect(await saved()).toEqual(before);
  }
  if (workId === "doi:10.1145/3675094.3677547") {
    const foreign = structuredClone(input);
    foreign.task_occurrences[0]!.criterion_assessments![0]!.support_task_action_references = [foreign.task_occurrences[1]!.task_actions![0]!.task_action_id];
    await picker.setInputFiles({ name: "foreign-reference-action.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(foreign)) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("within task occurrence");
    expect(await saved()).toEqual(before);
    const invalidTime = structuredClone(input);
    (Reflect.get(invalidTime, "screen_text_captures") as Array<Record<string, unknown>>)[0]!.source_event_time_token = 0;
    await picker.setInputFiles({ name: "invalid-source-event-token.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalidTime)) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("source_event_time_token must be a string or null");
    expect(await saved()).toEqual(before);
  }
  if (workId === "doi:10.1145/2971648.2971712") {
    const invalid = structuredClone(input), row = invalid.task_occurrences[0]!;
    row.task_observation_windows![0]!.anchor_task_action_reference = row.task_actions!.find(action => action.assigned_role_labels?.includes("PVT"))!.task_action_id;
    await picker.setInputFiles({ name: "pvt-is-not-whole-ema-begin.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("whole EMA beginning");
    expect(await saved()).toEqual(before);
  }
  for (const [key] of extraChannels) {
    const rows = records[key]?.filter(row => row.source_work_id === workId);
    if (!rows?.length) continue;
    const foreign = structuredClone(input);
    Reflect.set(foreign, key, [{ ...structuredClone(rows[0]!), source_work_id: "foreign" }]);
    await picker.setInputFiles({ name: "foreign-record-owner.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(foreign)) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("owner");
    expect(await saved()).toEqual(before);
  }
  if (label.includes("response-window")) {
    const foreignAnchor = structuredClone(input);
    foreignAnchor.task_occurrences[0]!.task_observation_windows![0]!.anchor_task_action_reference = foreignAnchor.task_occurrences[1]!.task_actions![0]!.task_action_id;
    await picker.setInputFiles({ name: "foreign-window-anchor.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(foreignAnchor)) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("anchor_task_action_reference has no matching action within task occurrence");
    expect(await saved()).toEqual(before);
  }
  if (workId === "doi:10.1080/15213269.2020.1768122") {
    const wrongLocalAnchor = structuredClone(input);
    const row = wrongLocalAnchor.task_occurrences[0]!;
    const answered = row.task_actions!.find(action => action.assigned_role_labels?.includes("ANSWERED"))!;
    row.task_observation_windows![0]!.anchor_task_action_reference = answered.task_action_id;
    expect(row.task_actions!.some(action => action.task_action_id === row.task_observation_windows![0]!.anchor_task_action_reference)).toBe(true);
    await picker.setInputFiles({ name: "wrong-local-monitoring-anchor.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(wrongLocalAnchor)) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("survey opening");
    expect(await saved()).toEqual(before);
  }
  if (label === "PasswordEntry instruments") {
    const foreignSupport = structuredClone(input);
    foreignSupport.task_occurrences[2]!.criterion_assessments![0]!.support_task_action_references = ["foreign-key"];
    await picker.setInputFiles({ name: "foreign-performance-support.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(foreignSupport)) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("duplicate or missing actions within task occurrence");
    expect(await saved()).toEqual(before);
  }
  if (label === "Murnane PVT and diary") {
    const foreign = structuredClone(input);
    const rows = Reflect.get(foreign, "participant_day_observations") as Array<Record<string, unknown>>;
    rows[0]!.cross_period_aggregate_references = [{ day_observation_id: "foreign", referenced_day_token: "example:following-day-B", relationship_label: "supplied comparison", source_locators: ["constructed invalid target"] }];
    await picker.setInputFiles({ name: "foreign-period-target.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(foreign)) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("distinct objective targets");
    expect(await saved()).toEqual(before);
  }
  await reloadApp(page);
  await assertOwner(retained);
  await picker.setInputFiles({ name: "profile-only.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ profiles: [profile] })) });
  await expect.poll(async () => (await saved()).task_occurrences).toBeUndefined();
  await expect(card).not.toContainText("Task occurrences");
  for (const [key, heading] of extraChannels) {
    expect((await saved())[key]).toBeUndefined();
    await expect(card).not.toContainText(heading);
  }
  await reloadApp(page);
  await expect(card).toContainText(`Variant: ${profile.source_work_id}`);
  await expect(card).not.toContainText("Task occurrences");
  expect((await saved()).profile).toEqual(profile);
  assertNoExternalRequests(external);
});
}
