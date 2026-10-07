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

test("preserves callback identities and supplied analytic designation through import, owner switching, reload and rejected replacement", async ({ page }) => {
  const root = resolve(import.meta.dirname, "../..");
  const canonical = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as StudyMethodProfileLibrary;
  const records = JSON.parse(readFileSync(resolve(root, "web/e2e/fixtures/notification-callback-example.json.fixture"), "utf8")) as Required<Pick<StudyMethodProfileLibrary, "notification_callback_groups">>;
  const profile = canonical.profiles.find((p) => p.source_work_id === "doi:10.1145/3229434.3229445")!;
  const second = structuredClone(profile);
  second.method_profile_id = "example:second-callback-owner";
  const secondGroups = structuredClone(records.notification_callback_groups);
  secondGroups[0]!.method_profile_id = second.method_profile_id;
  secondGroups[0]!.notification_evidence.reverse();
  secondGroups[0]!.analytic_alert_proxy_reference = "callback-a";
  const input = { profiles: [profile, second], notification_callback_groups: [...records.notification_callback_groups, ...secondGroups] };
  const parsed = parseStudyMethodProfileLibrary(input);
  const external = trackExternalRequests(page);
  await gotoApp(page);
  const picker = page.getByTestId("method-profile-file-input");
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const importValue = (value: unknown) => picker.setInputFiles({ name: "constructed-callbacks.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
  const savedSelection = () => page.evaluate(async ({ database, store }) => new Promise<Record<string, unknown>>((resolveSaved, reject) => {
    const request = indexedDB.open(database);
    request.onerror = () => reject(new Error(request.error?.message ?? "Database open failed"));
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(store, "readonly");
      const read = tx.objectStore(store).get("research-selection") as IDBRequest<{ selectionJson: string } | undefined>;
      tx.onerror = () => { db.close(); reject(new Error(tx.error?.message ?? "Selection read failed")); };
      tx.oncomplete = () => {
        db.close();
        if (!read.result) { reject(new Error("Saved selection missing")); return; }
        try { resolveSaved(JSON.parse(read.result.selectionJson) as Record<string, unknown>); }
        catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
      };
    };
  }), { database: LAST_RUN_DB_NAME, store: LAST_RUN_STORE_NAME });
  const assertOwner = async (id: string, groups = parsed.notification_callback_groups!.filter((g) => g.method_profile_id === id)) => {
    const expected = { profile: parsed.profiles.find((p) => p.method_profile_id === id), selectedLevels: {},
      notification_callback_groups: groups };
    const details = card.locator("details").filter({ has: page.getByText("Notification callback groups (1)", { exact: true }) });
    await expect(details).toHaveCount(1);
    if (!await details.evaluate((el) => (el as HTMLDetailsElement).open)) await details.locator("summary").click();
    await expect(details.locator("li")).toHaveCount(1);
    for (const [key, value] of Object.entries(expected.notification_callback_groups[0]!)) {
      const title = key.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
      await expect(details.locator("li")).toContainText(`${title}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
    }
    await expect(card).toContainText("not logical notification items or observed perception");
    await expect(card).toContainText("No burst reconstruction, title filtering, LAST selection");
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
  const mutations: Array<[(value: typeof input) => void, string]> = [
    [(x) => { x.notification_callback_groups[0]!.source_work_id = "foreign"; }, "profile/source owner"],
    [(x) => { x.notification_callback_groups[0]!.analytic_alert_proxy_reference = "foreign-member"; }, "matching posted member"],
    [(x) => { x.notification_callback_groups[0]!.notification_evidence.push(structuredClone(x.notification_callback_groups[0]!.notification_evidence[0]!)); }, "duplicated within callback group"],
    [(x) => { x.notification_callback_groups[0]!.notification_evidence[0]!.evidence_kind = "removal"; }, "recorded posted_callback"],
    [(x) => { Reflect.set(x.notification_callback_groups[0]!, "observed_perception", true); }, "unknown field"],
  ];
  for (const [mutate, message] of mutations) {
    const value = structuredClone(input); mutate(value);
    await importValue(value);
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText(message);
    expect(await savedSelection()).toEqual(prior);
  }
  await reloadApp(page); await assertOwner(second.method_profile_id);
  const selectionOnly = structuredClone(records);
  selectionOnly.notification_callback_groups[0]!.analytic_alert_proxy_reference = "callback-a";
  await importValue({ profiles: [profile], ...selectionOnly });
  await assertOwner(profile.method_profile_id, selectionOnly.notification_callback_groups);
  await reloadApp(page);
  await assertOwner(profile.method_profile_id, selectionOnly.notification_callback_groups);
  const other = canonical.profiles.find((p) => p.source_work_id === "doi:10.1145/2493190.2493219")!;
  await importValue({ profiles: [profile, other], ...records });
  await card.getByRole("combobox", { name: "Profile", exact: true }).selectOption(other.method_profile_id);
  await expect.poll(savedSelection).toEqual({ profile: other, selectedLevels: {}, notification_callback_groups: [] });
  await reloadApp(page);
  await expect(card).toContainText(`Variant: ${other.source_work_id}`);
  await expect(card).not.toContainText("Notification callback groups");
  await expect.poll(savedSelection).toEqual({ profile: other, selectedLevels: {}, notification_callback_groups: [] });
  for (const replacement of [{ profiles: [profile], notification_callback_groups: [] }, { profiles: [profile] }]) {
    await importValue(input); await assertOwner(profile.method_profile_id);
    await importValue(replacement);
    const expected = { profile, selectedLevels: {}, ...(Object.hasOwn(replacement, "notification_callback_groups") ? { notification_callback_groups: [] } : {}) };
    await expect.poll(savedSelection).toEqual(expected);
    await reloadApp(page);
    await expect(card).toContainText(`Variant: ${profile.source_work_id}`);
    await expect(card).not.toContainText("Notification callback groups");
    await expect.poll(savedSelection).toEqual(expected);
  }
  assertNoExternalRequests(external);
});
