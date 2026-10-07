import { expect, test } from "@playwright/test";
import { gotoApp, reloadApp, trackExternalRequests, assertNoExternalRequests } from "./helpers";
import { typingCaseExample } from "./fixtures/typing-transactions";
import { derivedTypingTrialExample } from "./fixtures/derived-typing-trials";
import { parseStudyMethodProfileLibrary } from "../src/lib/methodProfiles";
import { LAST_RUN_DB_NAME, LAST_RUN_STORE_NAME } from "../src/lib/lastRunStore";

test("preserves independent keyboard actions and trial links across owner switching, reload and rejected import", async ({ page }) => {
  const original = structuredClone(typingCaseExample);
  const other = structuredClone(original);
  other.profiles[0]!.method_profile_id = "profile:other-typing-owner";
  for (const record of [...other.keyboard_transactions, ...other.typing_trials]) record.method_profile_id = other.profiles[0]!.method_profile_id;
  other.keyboard_transactions.reverse();
  other.typing_trials[0]!.keyboard_transaction_references.reverse();
  const derived = structuredClone(derivedTypingTrialExample);
  const input = { profiles: [...original.profiles, ...other.profiles, ...derived.profiles],
    keyboard_transactions: [...original.keyboard_transactions, ...other.keyboard_transactions],
    typing_trials: [...original.typing_trials, ...other.typing_trials, ...derived.typing_trials] };
  const parsed = parseStudyMethodProfileLibrary(input);
  const external = trackExternalRequests(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await gotoApp(page);
  await expect(page).toHaveTitle(/Chronicle/);
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  if (process.env.CHRONICLE_TYPING_QA_IMAGE) await page.screenshot({ path: process.env.CHRONICLE_TYPING_QA_IMAGE.replace(/\.png$/, "-entry.png"), fullPage: false });
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const picker = page.getByTestId("method-profile-file-input");
  const importValue = (value: unknown) => picker.setInputFiles({ name: "constructed-typing-example.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
  const savedSelection = () => page.evaluate(({ database, store }) => new Promise<Record<string, unknown>>((resolveSaved, reject) => {
    const request = indexedDB.open(database);
    request.onerror = () => reject(new Error("Saved database open failed"));
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(store, "readonly");
      const read = tx.objectStore(store).get("research-selection") as IDBRequest<{ selectionJson: string } | undefined>;
      tx.onerror = () => { db.close(); reject(new Error("Saved selection read failed")); };
      tx.oncomplete = () => { db.close(); if (!read.result) reject(new Error("Saved selection missing")); else resolveSaved(JSON.parse(read.result.selectionJson) as Record<string, unknown>); };
    };
  }), { database: LAST_RUN_DB_NAME, store: LAST_RUN_STORE_NAME });
  const assertOwner = async (id: string) => {
    const expected = { profile: parsed.profiles.find(profile => profile.method_profile_id === id), selectedLevels: {},
      keyboard_transactions: parsed.keyboard_transactions!.filter(record => record.method_profile_id === id),
      typing_trials: parsed.typing_trials!.filter(record => record.method_profile_id === id) };
    for (const [label, rows] of [["Keyboard transactions", expected.keyboard_transactions], ["Typing-trial membership", expected.typing_trials]] as const) {
      const section = card.locator("details").filter({ has: page.getByText(`${label} (${rows.length})`, { exact: true }) });
      if (!rows.length) { await expect(section).toHaveCount(0); continue; }
      await expect(section).toHaveCount(1);
      if (!await section.evaluate(el => (el as HTMLDetailsElement).open)) await section.locator("summary").click();
      await expect(section.locator("li")).toHaveCount(rows.length);
      for (const [index, row] of rows.entries()) for (const [key, value] of Object.entries(row)) {
        const title = key.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
        await expect(section.locator("li").nth(index)).toContainText(`${title}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
      }
    }
    await expect(card).toContainText("remain independent of supplied typing-trial membership");
    await expect(card.getByRole("button", { name: "Load supported preprocessing settings" })).toBeDisabled();
    await expect.poll(savedSelection).toEqual(expected);
  };
  for (const profile of parsed.profiles) {
    await importValue(input);
    await card.getByRole("combobox", { name: "Profile", exact: true }).selectOption(profile.method_profile_id);
    await assertOwner(profile.method_profile_id);
    await reloadApp(page);
    await assertOwner(profile.method_profile_id);
  }
  const prior = await savedSelection();
  const wrong = structuredClone(input);
  wrong.keyboard_transactions[0]!.keyboard_schema_setting_reference = "setting:sensor-inventory";
  await importValue(wrong);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("keyboard-transaction definition");
  expect(await savedSelection()).toEqual(prior);
  const wrongCase = structuredClone(input);
  const cases = Reflect.get(wrongCase.typing_trials[0]!, "text_change_cases") as Array<{ support_keyboard_transaction_references: string[] }>;
  cases[0]!.support_keyboard_transaction_references = ["missing-trial-action"];
  await importValue(wrongCase);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("within the owning trial");
  expect(await savedSelection()).toEqual(prior);
  const wrongDerived = structuredClone(input);
  const wrongWord = structuredClone(input);
  const words = Reflect.get(wrongWord.typing_trials[0]!, "token_evaluation_cases") as Array<{ system_verdicts: Array<{ questionnaire_response_references: string[] }> }>;
  words[0]!.system_verdicts[0]!.questionnaire_response_references = ["trial-location"];
  await importValue(wrongWord);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("within the owning case");
  expect(await savedSelection()).toEqual(prior);
  Reflect.set(wrongDerived.typing_trials.at(-1)!, "keyboard_transaction_references", []);
  await importValue(wrongDerived);
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("derived-only trials");
  expect(await savedSelection()).toEqual(prior);
  await reloadApp(page); await assertOwner(parsed.profiles.at(-1)!.method_profile_id);
  if (process.env.CHRONICLE_TYPING_QA_IMAGE) { await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: process.env.CHRONICLE_TYPING_QA_IMAGE, fullPage: false }); }
  await page.setViewportSize({ width: 390, height: 844 });
  await card.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CHRONICLE_TYPING_QA_IMAGE) await page.screenshot({ path: process.env.CHRONICLE_TYPING_QA_IMAGE.replace(/\.png$/, "-mobile.png"), fullPage: false });
  const rawOnly = parseStudyMethodProfileLibrary({ profiles: input.profiles.slice(0, 1), keyboard_transactions: input.keyboard_transactions.slice(0, 2) });
  await importValue(rawOnly);
  await expect.poll(savedSelection).toEqual({ profile: rawOnly.profiles[0], selectedLevels: {}, keyboard_transactions: rawOnly.keyboard_transactions });
  await reloadApp(page);
  await expect(card).toContainText("Keyboard transactions (2)");
  await expect(card).not.toContainText("Typing-trial membership");
  await importValue({ profiles: rawOnly.profiles, keyboard_transactions: [], typing_trials: [] });
  await expect.poll(savedSelection).toEqual({ profile: rawOnly.profiles[0], selectedLevels: {}, keyboard_transactions: [], typing_trials: [] });
  await reloadApp(page);
  await expect(card).not.toContainText("Keyboard transactions (");
  await expect(card).not.toContainText("Typing-trial membership");
  expect(errors).toEqual([]);
  assertNoExternalRequests(external);
});
