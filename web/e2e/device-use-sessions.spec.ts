import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PRIVATE_CORPUS_SKIP_REASON, privateCorpusAvailable, privateCorpusPath } from "../src/testSupport/privateCorpus";
import { gotoApp, reloadApp, trackExternalRequests, assertNoExternalRequests } from "./helpers";
import { LAST_RUN_DB_NAME, LAST_RUN_STORE_NAME } from "../src/lib/lastRunStore";
import { parseStudyMethodProfileLibrary, type StudyMethodProfileLibrary } from "../src/lib/methodProfiles";
import { expectMethodProfileLoadAction } from "./methodProfileLoadAction";
import { dailyValidityDeviceSessionExample, appPeriodDeviceSessionExample, apnomsDeviceSessionExample, hammerDeviceSessionExample } from "./fixtures/device-use-session";
import { falakiDeviceSessionExample } from "./fixtures/device-use-session";
import { academicDeviceSessionExample, appMeasuresDeviceSessionExample, cognitiveDeviceSessionExample, deviceUseSessionExample, hushDeviceSessionExample, lonelinessDeviceSessionExample, mommDeviceSessionExample, recordedBehaviorDeviceSessionExample, separateDeviceSessionExample, sessionQuantityExample, shinDeviceSessionExample, vanBerkelDeviceSessionExample, whatsappDeviceSessionExample } from "./fixtures/device-use-session";

// Every test in this file reads the private literature corpus.
test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);

for (const ownerMode of ["same-source", "different-sources"] as const) {
test(`preserves device session answers and independent labels across ${ownerMode} owners and reload`, async ({ page }) => {
  const library = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")));
  const profile = library.profiles.find(p => p.source_work_id === "doi:10.1145/3604241")!;
  const second = structuredClone(ownerMode === "same-source" ? profile
    : library.profiles.find(p => p.source_work_id === "doi:10.1038/s41597-026-07015-7")!);
  expect(profile).toBeDefined(); expect(second).toBeDefined();
  if (ownerMode === "same-source") second.method_profile_id = "constructed:second-device-session-owner";
  const input = deviceUseSessionExample(profile), secondInput = deviceUseSessionExample(profile);
  secondInput.device_use_sessions[0]!.method_profile_id = second.method_profile_id;
  secondInput.device_use_sessions[0]!.session_questionnaire_responses.reverse();
  secondInput.device_use_sessions[0]!.session_labels[1]!.label_value_json = '"rabbit hole"';
  input.profiles.push(second);
  if (ownerMode === "same-source") input.device_use_sessions.push(...secondInput.device_use_sessions);
  const parsed = parseStudyMethodProfileLibrary(input);
  const external = trackExternalRequests(page);
  await gotoApp(page);
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const importValue = (value: unknown) => page.getByTestId("method-profile-file-input").setInputFiles({
    name: "normalized-device-sessions.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)),
  });
  const savedSelection = () => page.evaluate(async ({ database, store }) => {
    if (!(await indexedDB.databases()).some(db => db.name === database)) throw new Error("Saved database missing");
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
  const expected = (id: string) => ({ profile: parsed.profiles.find(p => p.method_profile_id === id), selectedLevels: {},
    device_use_sessions: parsed.device_use_sessions!.filter(row => row.method_profile_id === id) });
  const assertOwner = async (id: string) => {
    const value = expected(id);
    await expect(card).toContainText(`Variant: ${value.profile!.source_work_id}`);
    if (value.profile!.source_work_id === profile.source_work_id) {
      const space = value.profile!.method_configuration_space as {
        method_configuration_groups: Array<{ method_selection_semantics: string;
          method_configuration_levels: Array<{ common_method_setting_ids: string[] }> }>;
      };
      const fixed = space.method_configuration_groups.find(g => g.method_selection_semantics === "fixed_source_inventory_no_user_selection")!;
      const configuration = card.locator("details").filter({ has: page.getByText(`Source configuration space (${space.method_configuration_groups.length} groups)`, { exact: true }) });
      if (!await configuration.evaluate(el => (el as HTMLDetailsElement).open)) await configuration.locator("summary").click();
      await expect(configuration).toContainText(`common membership ${fixed.method_configuration_levels[0]!.common_method_setting_ids.join(", ")}`);
      await expect(card).toContainText("Configuration Ready");
    }
    const details = card.locator("details").filter({ has: page.getByText(`Device-use sessions (${value.device_use_sessions.length})`, { exact: true }) });
    if (value.device_use_sessions.length) {
      await expect(details).toHaveCount(1);
      if (!await details.evaluate(el => (el as HTMLDetailsElement).open)) await details.locator("summary").click();
      await expect(details.locator("li")).toHaveCount(value.device_use_sessions.length);
      for (const [i, row] of value.device_use_sessions.entries()) for (const [key, field] of Object.entries(row)) {
        const label = key.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
        await expect(details.locator("li").nth(i)).toContainText(`${label}: ${typeof field === "string" ? field : JSON.stringify(field)}`);
      }
      await expect(card).toContainText("No session reconstruction");
    } else await expect(card.locator("summary").filter({ hasText: /^Device-use sessions \(/ })).toHaveCount(0);
    await expect.poll(savedSelection).toEqual(value);
    await expectMethodProfileLoadAction(card, value.profile!);
  };
  const labelOnly = structuredClone(input);
  labelOnly.device_use_sessions[0]!.session_labels[1]!.label_value_json = '"rabbit hole"';
  await importValue(labelOnly);
  const labelOnlyExpected = { profile: parsed.profiles[0], selectedLevels: {},
    device_use_sessions: labelOnly.device_use_sessions.filter(row => row.method_profile_id === profile.method_profile_id) };
  await expect.poll(savedSelection).toEqual(labelOnlyExpected);
  await reloadApp(page);
  await expect(card).toContainText(`Variant: ${profile.source_work_id}`);
  await expect.poll(savedSelection).toEqual(labelOnlyExpected);
  expect(labelOnlyExpected.device_use_sessions[0]!.session_questionnaire_responses).toEqual(input.device_use_sessions[0]!.session_questionnaire_responses);
  for (const owner of parsed.profiles) {
    await importValue(input);
    await card.getByRole("combobox", { name: "Profile", exact: true }).selectOption(owner.method_profile_id);
    await assertOwner(owner.method_profile_id);
    await reloadApp(page); await assertOwner(owner.method_profile_id);
  }
  const prior = await savedSelection();
  const mutations: Array<[(x: typeof input) => void, string]> = [
    [x => { x.device_use_sessions[0]!.source_work_id = "foreign"; }, "profile/source owner"],
    [x => { x.device_use_sessions[0]!.session_labels[0]!.questionnaire_response_references = ["foreign-answer"]; }, "within the owning session"],
    [x => { x.device_use_sessions[0]!.session_questionnaire_responses[0]!.questionnaire_setting_reference = profile.method_settings.find(s => s.method_parameter_key === "diary.no_intention_conditional")!.method_setting_id; }, "compatible questionnaire instrument definition"],
  ];
  for (const [mutate, message] of mutations) {
    const invalid = structuredClone(input); mutate(invalid);
    await importValue(invalid);
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText(message);
    expect(await savedSelection()).toEqual(prior);
  }
  await reloadApp(page); await assertOwner(second.method_profile_id);
  for (const records of [{ device_use_sessions: [] }, {}]) {
    await importValue({ profiles: [profile], ...records });
    const cleared = { profile: parsed.profiles[0], selectedLevels: {}, ...records };
    await expect.poll(savedSelection).toEqual(cleared);
    await reloadApp(page);
    await expect(card).toContainText(`Variant: ${profile.source_work_id}`);
    await expect.poll(savedSelection).toEqual(cleared);
    await expect(card.locator("summary").filter({ hasText: /^Device-use sessions \(/ })).toHaveCount(0);
  }
  assertNoExternalRequests(external);
});
}

for (const source of ["doi:10.1016/j.chb.2024.108281", "doi:10.1007/s00779-011-0412-2", "doi:10.1145/2789168.2790107", "doi:10.1145/2750858.2807542", "doi:10.1145/3604241", "doi:10.1145/3429360.3468192", "doi:10.1145/2493432.2493443", "doi:10.2196/13209", "doi:10.1186/s13104-015-1280-z", "doi:10.3390/bs5040434", "doi:10.4088/jcp.15m10310", "doi:10.1145/2971648.2971712", "doi:10.1145/2858036.2858348", "doi:10.1145/2684103.2684156", "doi:10.1109/apnoms.2011.6077030", "doi:10.1145/1814433.1814453", "doi:10.1145/2634317.2634325", "doi:10.1145/2971648.2971760", "doi:10.1145/2971648.2971762", "doi:10.1145/2037373.2037383"]) {
test(`imports and reloads supplied session actions and relations: ${source}`, async ({ page }) => {
  const library = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")));
  const profile = library.profiles.find(p => p.source_work_id === source)!;
  expect(profile).toBeDefined();
  const periodFamily = ["doi:10.1145/2971648.2971760", "doi:10.1145/2971648.2971762", "doi:10.1145/2037373.2037383"].includes(source);
  const input: ReturnType<typeof sessionQuantityExample> & Pick<StudyMethodProfileLibrary, "sampled_quantity_observations" | "task_occurrences"> = periodFamily ? appPeriodDeviceSessionExample(profile)
    : ["doi:10.1145/2750858.2807542", "doi:10.1145/3604241"].includes(source) ? sessionQuantityExample(profile)
    : source === "doi:10.1145/1814433.1814453" ? falakiDeviceSessionExample(profile)
    : source === "doi:10.1145/2634317.2634325" ? hammerDeviceSessionExample(profile)
    : source === "doi:10.1016/j.chb.2024.108281" ? dailyValidityDeviceSessionExample(profile)
    : source === "doi:10.1109/apnoms.2011.6077030" ? apnomsDeviceSessionExample(profile)
    : source === "doi:10.1145/2684103.2684156" ? mommDeviceSessionExample(profile)
    : source === "doi:10.1145/2858036.2858348" ? vanBerkelDeviceSessionExample(profile)
    : source === "doi:10.1186/s13104-015-1280-z" ? whatsappDeviceSessionExample(profile)
    : source === "doi:10.3390/bs5040434" ? recordedBehaviorDeviceSessionExample(profile)
    : source === "doi:10.4088/jcp.15m10310" ? appMeasuresDeviceSessionExample(profile)
    : source === "doi:10.1145/2971648.2971712" ? cognitiveDeviceSessionExample(profile)
    : source === "doi:10.2196/13209" ? lonelinessDeviceSessionExample(profile)
    : source === "doi:10.1145/2493432.2493443" ? shinDeviceSessionExample(profile)
    : source === "doi:10.1145/3429360.3468192" ? academicDeviceSessionExample(profile)
      : source === "doi:10.1145/2789168.2790107" ? hushDeviceSessionExample(profile) : separateDeviceSessionExample(profile);
  const external = trackExternalRequests(page);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await gotoApp(page);
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const upload = (value: unknown) => page.getByTestId("method-profile-file-input").setInputFiles({ name: "supplied-separate-policy.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
  const savedPeriodSelection = () => page.evaluate(async ({ database, store }) => new Promise<unknown>((resolveSaved, reject) => {
    const request = indexedDB.open(database);
    request.onerror = () => reject(new Error(request.error?.message ?? "Database open failed"));
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(store, "readonly"), read = tx.objectStore(store).get("research-selection") as IDBRequest<{ selectionJson: string } | undefined>;
      tx.onerror = () => { db.close(); reject(new Error(tx.error?.message ?? "Selection read failed")); };
      tx.oncomplete = () => { db.close(); resolveSaved(read.result ? JSON.parse(read.result.selectionJson) as unknown : null); };
    };
  }), { database: LAST_RUN_DB_NAME, store: LAST_RUN_STORE_NAME });
  const periodExpected = { profile, selectedLevels: {}, device_use_sessions: input.device_use_sessions,
    ...(input.sampled_quantity_observations !== undefined ? { sampled_quantity_observations: input.sampled_quantity_observations } : {}),
    ...(input.task_occurrences !== undefined ? { task_occurrences: input.task_occurrences } : {}) };
  const assertRecord = async () => {
    if (periodFamily) {
      for (const [label, records] of [["Sampled quantities", input.sampled_quantity_observations!], ["Task occurrences", input.task_occurrences!]] as const) {
        if (!records.length) continue;
        const section = card.locator("details").filter({ has: page.getByText(label + " (" + records.length + ")", { exact: true }) });
        if (!await section.evaluate(el => (el as HTMLDetailsElement).open)) await section.locator("summary").click();
        const texts = await section.locator("li").allTextContents();
        for (const [i, row] of records.entries()) for (const [key, value] of Object.entries(row)) {
          const field = key.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
          expect(texts[i]!.replace(/\s+/g, " ")).toContain((field + ": " + (typeof value === "string" ? value : JSON.stringify(value))).replace(/\s+/g, " "));
        }
      }
      await expect.poll(savedPeriodSelection).toEqual(periodExpected);
    }
    const details = card.locator("details").filter({ has: page.getByText(`Device-use sessions (${input.device_use_sessions.length})`, { exact: true }) });
    if (!await details.evaluate(el => (el as HTMLDetailsElement).open)) await details.locator("summary").click();
    await expect(details.locator("li")).toHaveCount(input.device_use_sessions.length);
    const texts = await details.locator("li").allTextContents();
    for (const [index, row] of input.device_use_sessions.entries()) for (const [key, value] of Object.entries(row)) {
      const label = key.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
      const expected = `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
      expect(texts[index]!.replace(/\s+/g, " ").trim()).toContain(expected.replace(/\s+/g, " ").trim());
    }
  };
  await upload(input); await assertRecord();
  await reloadApp(page); await assertRecord();
  const invalid = structuredClone(input); invalid.device_use_sessions[0]!.end_condition = "invented-terminal";
  await upload(invalid);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("end_condition");
  await reloadApp(page); await assertRecord();
  if (input.device_use_sessions[0]!.session_quantities) {
    const invalidQuantity = structuredClone(input);
    Reflect.set(invalidQuantity.device_use_sessions[0]!.session_quantities![0]!, "quantity_scope", "foreign");
    await upload(invalidQuantity);
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("quantity_scope");
    await reloadApp(page); await assertRecord();
  }
  if (periodFamily) {
    const foreignSupport = structuredClone(input);
    foreignSupport.device_use_sessions[0]!.session_quantities![0]!.support_task_action_references = ["foreign-session-period"];
    await upload(foreignSupport);
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("containing session");
    await expect.poll(savedPeriodSelection).toEqual(periodExpected);
    await reloadApp(page); await assertRecord();
    const empty = { profiles: [profile], device_use_sessions: [], sampled_quantity_observations: [], task_occurrences: [] };
    await upload(empty);
    await expect.poll(savedPeriodSelection).toEqual({ profile, selectedLevels: {}, device_use_sessions: [], sampled_quantity_observations: [], task_occurrences: [] });
    await expect(card.locator("summary").filter({ hasText: /^Device-use sessions \(/ })).toHaveCount(0);
    await upload({ profiles: [profile] });
    await expect.poll(savedPeriodSelection).toEqual({ profile, selectedLevels: {} });
  }
  expect(errors).toEqual([]); assertNoExternalRequests(external);
});
}
