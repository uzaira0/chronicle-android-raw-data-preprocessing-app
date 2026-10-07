import { expect, test, type Page } from "@playwright/test";
import { PRIVATE_CORPUS_SKIP_REASON, privateCorpusAvailable, privateCorpusPath } from "../src/testSupport/privateCorpus";
import { gotoApp, reloadApp, trackExternalRequests, assertNoExternalRequests } from "./helpers";
import { LAST_RUN_DB_NAME, LAST_RUN_STORE_NAME } from "../src/lib/lastRunStore";
import { humanScreenomeExample, pulseScreenshotRangeExample } from "./fixtures/pulse-screenshot-ranges";
import { parseStudyMethodProfileLibrary } from "../src/lib/methodProfiles";
import { expectMethodProfileLoadAction } from "./methodProfileLoadAction";
import { nestedSessionFamilyExample } from "./fixtures/device-use-session";

const savedSelection = (page: Page) => page.evaluate(async ({ database, store }) => {
  if (!(await indexedDB.databases()).some((db) => db.name === database)) return null;
  return new Promise<Record<string, unknown> | null>((resolveSaved, reject) => {
    const request = indexedDB.open(database);
    request.onerror = () => reject(new Error(request.error?.message ?? "Selection database failed"));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(store, "readonly");
      const read = tx.objectStore(store).get("research-selection") as IDBRequest<{ selectionJson: string } | undefined>;
      tx.onerror = () => { db.close(); reject(new Error(tx.error?.message ?? "Selection read failed")); };
      tx.oncomplete = () => {
        db.close();
        try { resolveSaved(read.result ? JSON.parse(read.result.selectionJson) as Record<string, unknown> : null); }
        catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
      };
    };
  });
}, { database: LAST_RUN_DB_NAME, store: LAST_RUN_STORE_NAME });

for (const source of ["PULSE", "Human Screenome"]) {
test(`preserves ${source} screenshot ranges, partial labels and selected owner through import/reload/rejection/clearing`, async ({ page }) => {
  test.skip(!privateCorpusAvailable && source !== "PULSE", PRIVATE_CORPUS_SKIP_REASON);
  const canonical = source === "PULSE" ? null : parseStudyMethodProfileLibrary(JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")));
  const example = source === "PULSE" ? pulseScreenshotRangeExample()
    : humanScreenomeExample(canonical!.profiles.find(p => p.source_work_id === "doi:10.1016/j.chb.2020.106570")!);
  const input = { profiles: [...example.profiles], screenshot_sessions: [...example.screenshot_sessions] };
  const other = structuredClone(input);
  other.profiles[0]!.method_profile_id = "example:another-pulse-owner";
  other.screenshot_sessions[0]!.method_profile_id = other.profiles[0]!.method_profile_id;
  other.screenshot_sessions[0]!.screenshot_range_annotations[0]!.last_screenshot_reference = source === "PULSE" ? "screen-3" : "capture-B";
  if (source !== "PULSE") other.screenshot_sessions[0]!.screenshot_range_annotations[0]!.first_screenshot_reference = "capture-B";
  input.profiles.push(...other.profiles);
  input.screenshot_sessions.push(...other.screenshot_sessions);
  const external = trackExternalRequests(page);
  await gotoApp(page);
  const picker = page.getByTestId("method-profile-file-input");
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const importAll = () => picker.setInputFiles({ name: "screenshot-ranges.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
  const assertOwner = async (id: string) => {
    await expect(card).toContainText("Range endpoints do not imply inclusive membership or whole-session intent");
    const section = card.locator("details").filter({ has: page.getByText("Screenshot sessions (1)", { exact: true }) });
    if (!await section.evaluate((el) => (el as HTMLDetailsElement).open)) await section.locator("summary").click();
    await expect(section.locator("li")).toHaveCount(1);
    const session = input.screenshot_sessions.find((s) => s.method_profile_id === id)!;
    for (const [key, value] of Object.entries(session)) {
      const label = key.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
      await expect(section.locator("li")).toContainText(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
    }
    await expect.poll(async () => (await savedSelection(page))?.screenshot_sessions).toEqual([session]);
    await expect(card.getByRole("button", { name: "Load supported preprocessing settings" })).toBeEnabled({ enabled: source === "Human Screenome" });
  };
  await importAll();
  for (const profile of input.profiles) {
    await card.getByRole("combobox", { name: "Profile", exact: true }).selectOption(profile.method_profile_id);
    await assertOwner(profile.method_profile_id);
    await reloadApp(page);
    await assertOwner(profile.method_profile_id);
    await importAll();
  }
  const retained = await card.getByRole("combobox", { name: "Profile", exact: true }).inputValue();
  const before = await savedSelection(page);
  const invalid = structuredClone(input);
  const foreign = structuredClone(invalid.screenshot_sessions[0]!);
  foreign.screenshot_session_id = "foreign-session";
  foreign.screenshots[0]!.screenshot_record_id = "foreign-screenshot";
  foreign.screenshot_range_annotations[0]!.first_screenshot_reference = "foreign-screenshot";
  invalid.screenshot_sessions.push(foreign);
  invalid.screenshot_sessions[0]!.screenshot_range_annotations[0]!.first_screenshot_reference = "foreign-screenshot";
  await picker.setInputFiles({ name: "foreign-range.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("within session");
  expect(await savedSelection(page)).toEqual(before);
  await reloadApp(page);
  await assertOwner(retained);
  await picker.setInputFiles({ name: "profile-only.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ profiles: input.profiles })) });
  await expect(card).not.toContainText("Screenshot sessions");
  await expect.poll(async () => (await savedSelection(page))?.screenshot_sessions).toBeUndefined();
  await reloadApp(page);
  await expect(card).not.toContainText("Screenshot sessions");
  assertNoExternalRequests(external);
});
}

for (const invalidOlder of [false, true]) for (const clearNewer of [false, true]) {
  test(`keeps the newest screenshot ${clearNewer ? "clear" : "range"} when an older ${invalidOlder ? "invalid" : "valid"} file finishes last`, async ({ page }) => {
    const older = pulseScreenshotRangeExample();
    if (invalidOlder) older.screenshot_sessions[0]!.screenshot_range_annotations[0]!.first_screenshot_reference = "missing-old-image";
    const newer = pulseScreenshotRangeExample();
    newer.screenshot_sessions[0]!.screenshot_range_annotations[0]!.last_screenshot_reference = "screen-3";
    const external = trackExternalRequests(page);
    await gotoApp(page);
    await page.evaluate(() => {
      const original = Reflect.get(File.prototype, "text");
      File.prototype.text = function () {
        if (this.name !== "older-screenshot-slow.json") return original.call(this);
        return new Promise<string>((resolve, reject) => {
          (window as unknown as { releaseOlderScreenshot: () => Promise<void> }).releaseOlderScreenshot = async () => {
            try { resolve(await original.call(this)); } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
          };
        });
      };
    });
    const picker = page.getByTestId("method-profile-file-input");
    const card = page.locator('[data-settings-anchor="research-method-profile"]');
    await picker.setInputFiles({ name: "older-screenshot-slow.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(older)) });
    await picker.setInputFiles({ name: "newest-screenshot.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(clearNewer ? { profiles: newer.profiles } : newer)) });
    const expected = clearNewer ? undefined : newer.screenshot_sessions;
    await expect.poll(async () => (await savedSelection(page))?.screenshot_sessions).toEqual(expected);
    await expect(card).toContainText(newer.profiles[0]!.source_work_id);
    await page.evaluate(async () => {
      await (window as unknown as { releaseOlderScreenshot: () => Promise<void> }).releaseOlderScreenshot();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    for (const reload of [false, true]) {
      if (reload) await reloadApp(page);
      if (clearNewer) await expect(card).not.toContainText("Screenshot sessions");
      else {
        const section = card.locator("details").filter({ has: page.getByText("Screenshot sessions (1)", { exact: true }) });
        if (!await section.evaluate((el) => (el as HTMLDetailsElement).open)) await section.locator("summary").click();
        await expect(section).toContainText(`Screenshot range annotations: ${JSON.stringify(newer.screenshot_sessions[0]!.screenshot_range_annotations)}`);
      }
      await expect.poll(async () => (await savedSelection(page))?.screenshot_sessions).toEqual(expected);
      await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toHaveCount(0);
    }
    assertNoExternalRequests(external);
  });
}
import { readFileSync } from "node:fs";

for (const work of ["doi:10.2139/ssrn.4768783", "doi:10.1145/3706598.3713724", "doi:10.1145/2858036.2858267"]) {
  test("preserves supplied nested-session ownership and failed replacement for " + work, async ({ page }) => {
    test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);
    const canonical = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")));
    const profile = canonical.profiles.find(p => p.source_work_id === work)!;
    const example = nestedSessionFamilyExample(profile), input = structuredClone(example), other = structuredClone(example);
    const channels = ["device_use_sessions", "sampled_quantity_observations", "task_occurrences", "screenshot_sessions", "participant_day_observations"] as const;
    const names = ["Device-use sessions", "Sampled quantities", "Task occurrences", "Screenshot sessions", "Participant-period observations"];
    const alternate = "example:alternate-nested-owner";
    other.profiles[0]!.method_profile_id = alternate;
    for (const channel of channels) {
      for (const row of other[channel] ?? []) row.method_profile_id = alternate;
      Object.assign(input, { [channel]: [...(input[channel] ?? []), ...(other[channel] ?? [])] });
    }
    input.profiles.push(other.profiles[0]!);
    const external = trackExternalRequests(page);
    await gotoApp(page);
    const card = page.locator('[data-settings-anchor="research-method-profile"]'), picker = page.getByTestId("method-profile-file-input");
    const importValue = (value: unknown, name: string) => picker.setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
    const assertOwner = async (id: string) => {
      const expected = id === alternate ? other : example;
      for (const [i, channel] of channels.entries()) {
        const rows = expected[channel] ?? [];
        if (!rows.length) continue;
        const section = card.locator("details").filter({ has: page.getByText(names[i] + " (" + rows.length + ")", { exact: true }) });
        if (!await section.evaluate(el => (el as HTMLDetailsElement).open)) await section.locator("summary").click();
        await expect(section.locator("li")).toHaveCount(rows.length);
        const rendered = (await section.locator("li").allTextContents()).map(text => text.replace(/\s+/g, " "));
        rows.forEach((row, index) => {
          for (const [key, value] of Object.entries(row)) {
            const label = key.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
            const payload = typeof value === "string" ? value : JSON.stringify(value);
            expect(rendered[index]).toContain((label + ": " + payload).replace(/\s+/g, " "));
          }
        });
      }
      await expect.poll(async () => {
        const stored = await savedSelection(page);
        return Object.fromEntries(channels.map(channel => [channel, stored?.[channel]]));
      }).toEqual(Object.fromEntries(channels.map(channel => [channel, expected[channel]])));
      await expectMethodProfileLoadAction(card, expected.profiles[0]!);
    };
    await importValue(input, "supplied-nested-sessions.json");
    for (const owner of input.profiles) {
      await card.getByRole("combobox", { name: "Profile", exact: true }).selectOption(owner.method_profile_id);
      await assertOwner(owner.method_profile_id);
    }
    await reloadApp(page);
    await assertOwner(alternate);
    const before = await savedSelection(page), invalid = structuredClone(input);
    const child = work === "doi:10.2139/ssrn.4768783" ? invalid.sampled_quantity_observations![0]!
      : work === "doi:10.1145/3706598.3713724" ? invalid.screenshot_sessions![0]! : invalid.task_occurrences![0]!;
    child.session_action_reference = "not-in-supplied-parent";
    await importValue(invalid, "foreign-nested-action.json");
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("inside its supplied parent");
    expect(await savedSelection(page)).toEqual(before);
    await reloadApp(page);
    await assertOwner(alternate);
    await importValue({ profiles: example.profiles, ...Object.fromEntries(channels.map(channel => [channel, []])) }, "empty-nested-membership.json");
    await expect.poll(async () => {
      const stored = await savedSelection(page);
      return channels.map(channel => stored?.[channel]);
    }).toEqual(channels.map(() => []));
    await importValue({ profiles: example.profiles }, "omitted-nested-membership.json");
    await expect.poll(async () => {
      const stored = await savedSelection(page);
      return channels.map(channel => stored?.[channel]);
    }).toEqual(channels.map(() => undefined));
    assertNoExternalRequests(external);
  });
}
