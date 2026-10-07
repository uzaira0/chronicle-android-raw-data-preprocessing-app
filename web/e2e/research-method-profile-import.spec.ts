import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PRIVATE_CORPUS_SKIP_REASON, privateCorpusAvailable, privateCorpusPath } from "../src/testSupport/privateCorpus";

import { gotoApp, reloadApp } from "./helpers";
import { odimInteractionTraceExample } from "./fixtures/odim-interaction-trace";
import { clearAllGroupingExample, clearAllSnapshotExample } from "./fixtures/clear-all-grouping";
import { jonesSequenceExample } from "./fixtures/jones-sequence";
import { ringerCommunicationExample } from "./fixtures/ringer-state-interval";
import { boehmerCallActionExample, multiDeviceQuestionnaireExample, notificationBoundaryExample, notificationContextExample, notificationHistoryExample, notificationOpeningExample, notificationParticipantDayExample, notificationTitleAnnotationExample } from "./fixtures/notification-history";
import { notificationResponseExample } from "./fixtures/notification-response";
import type { StudyMethodProfile } from "../src/lib/methodProfiles";
import { LAST_RUN_DB_NAME, LAST_RUN_STORE_NAME } from "../src/lib/lastRunStore";
import { expectMethodProfileLoadAction } from "./methodProfileLoadAction";

const libraryPath = privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json");

test("imports and reloads repeated call actions with supplied order and selected-owner isolation", async ({ page }) => {
  const input = boehmerCallActionExample();
  const other = structuredClone(input);
  other.profiles[0]!.method_profile_id = "example:other-call-owner";
  for (const history of other.notification_histories) history.method_profile_id = other.profiles[0]!.method_profile_id;
  other.notification_histories[0]!.notification_evidence.reverse();
  other.notification_histories[0]!.notification_evidence[0]!.action_kind = "other-owner-action";
  input.profiles.push(...other.profiles);
  input.notification_histories.push(...other.notification_histories);
  await gotoApp(page);
  const picker = page.getByTestId("method-profile-file-input");
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const importAll = () => picker.setInputFiles({ name: "call-actions.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
  const assertOwner = async (id: string) => {
    const section = card.locator("details").filter({ has: page.getByText("Notification histories (2)", { exact: true }) });
    if (!await section.evaluate((el) => (el as HTMLDetailsElement).open)) await section.locator("summary").click();
    await expect(section.locator("li")).toHaveCount(2);
    for (const history of input.notification_histories.filter((h) => h.method_profile_id === id)) {
      const row = section.locator("li").filter({ has: page.getByText(history.notification_history_id, { exact: true }) });
      for (const [key, value] of Object.entries(history)) {
        const label = key.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
        await expect(row).toContainText(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
      }
      await expect(row).not.toContainText("Acceptance records:");
      await expect(row).not.toContainText("App package name:");
    }
    await expect(card.getByRole("button", { name: "Load supported preprocessing settings" })).toBeDisabled();
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
  for (const reason of ["order", "foreign-support"]) {
    const invalid = structuredClone(input);
    if (reason === "order") invalid.notification_histories[0]!.notification_evidence[1]!.occurrence_ordinal = 8;
    else invalid.notification_histories[1]!.notification_evidence[0]!.evidence_references = ["m1"];
    await picker.setInputFiles({ name: `${reason}.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText(reason === "order" ? "occurrence_ordinal is duplicated" : "references within history");
    await reloadApp(page);
    await assertOwner(retained);
  }
  await picker.setInputFiles({ name: "profile-only.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ profiles: input.profiles })) });
  await expect(card).not.toContainText("Notification histories");
  await reloadApp(page);
  await expect(card).not.toContainText("Notification histories");
});

test("imports and reloads response stages, observability, endpoints and objectives with selected-owner isolation", async ({ page }) => {
  const input = notificationResponseExample();
  const other = structuredClone(input);
  other.profiles[0]!.method_profile_id = "example:other-response-owner";
  for (const row of other.notification_histories) row.method_profile_id = other.profiles[0]!.method_profile_id;
  other.notification_histories[1]!.notification_evidence[0]!.response_stage_id = "merged-or-later-stage";
  other.notification_histories[1]!.notification_evidence[0]!.evidence_value_json = '"explicitly supplied inference, not a direct observation"';
  input.profiles.push(...other.profiles);
  input.notification_histories.push(...other.notification_histories);
  await gotoApp(page);
  const picker = page.getByTestId("method-profile-file-input");
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const importAll = () => picker.setInputFiles({ name: "response-records.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
  const assertOwner = async (id: string) => {
    await expect(card).toContainText("unobservable is not an observed negative");
    const section = card.locator("details").filter({ has: page.getByText("Notification histories (3)", { exact: true }) });
    if (!await section.evaluate((el) => (el as HTMLDetailsElement).open)) await section.locator("summary").click();
    await expect(section.locator("li")).toHaveCount(3);
    for (const history of input.notification_histories.filter((h) => h.method_profile_id === id)) {
      const row = section.locator("li").filter({ has: page.getByText(history.notification_history_id, { exact: true }) });
      for (const [key, value] of Object.entries(history)) {
        const label = key.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
        await expect(row).toContainText(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
      }
    }
    await expect(card.getByRole("button", { name: "Load supported preprocessing settings" })).toBeDisabled();
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
  const invalid = structuredClone(input);
  invalid.notification_histories[0]!.notification_evidence[4]!.evidence_references = ["D3"]; // Exists only in another item.
  await picker.setInputFiles({ name: "foreign-response-support.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("references within history");
  await reloadApp(page);
  await assertOwner(retained);
  await picker.setInputFiles({ name: "profile-only.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ profiles: input.profiles })) });
  await expect(card).not.toContainText("Notification histories");
  await reloadApp(page);
  await expect(card).not.toContainText("Notification histories");
});

type ConfigurationProfileLibrary = { profiles: Array<{
  source_work_id: string;
  method_configuration_space: { method_configuration_groups: Array<{
    method_configuration_group_kind: string;
    method_configuration_levels: Array<{ method_configuration_level_label: string; method_configuration_level_id: string }>;
  }> };
}> };

test("imports and reloads participant-day aggregates and answers with exact referenced-day and owner isolation", async ({ page }) => {
  const input = notificationParticipantDayExample();
  const other = structuredClone(input);
  other.profiles[0]!.method_profile_id = "example:other-participant-day-owner";
  for (const row of other.participant_day_observations) row.method_profile_id = other.profiles[0]!.method_profile_id;
  other.participant_day_observations[0]!.day_observation_value_json = "7";
  other.participant_day_observations[2]!.day_observation_value_json = '"other owner answer"';
  input.profiles.push(...other.profiles);
  input.participant_day_observations.push(...other.participant_day_observations);
  await gotoApp(page);
  const picker = page.getByTestId("method-profile-file-input");
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const importAll = () => picker.setInputFiles({ name: "participant-days.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
  const assertOwner = async (id: string) => {
    await expect(card).toContainText("No period reconstruction, aggregation, scheduling or correlation runs during import");
    const section = card.locator("details").filter({ has: page.getByText("Participant-period observations (9)", { exact: true }) });
    if (!await section.evaluate((el) => (el as HTMLDetailsElement).open)) await section.locator("summary").click();
    await expect(section.locator("li")).toHaveCount(9);
    for (const record of input.participant_day_observations.filter((r) => r.method_profile_id === id)) {
      const row = section.locator("li").filter({ has: page.getByText(record.day_observation_id, { exact: true }) })
        .filter({ hasText: `Participant id: ${record.participant_id}` }).filter({ hasText: `Referenced day token: ${record.referenced_day_token}` });
      for (const [key, value] of Object.entries(record)) {
        const label = key.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
        await expect(row).toContainText(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
      }
    }
    await expect(card.getByRole("button", { name: "Load supported preprocessing settings" })).toBeDisabled();
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
  const invalid = structuredClone(input);
  invalid.participant_day_observations[2]!.referenced_day_token = "example:prior-day-2-not-a-date";
  await picker.setInputFiles({ name: "foreign-day.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("within profile/participant/referenced period");
  await reloadApp(page);
  await assertOwner(retained);
  await picker.setInputFiles({ name: "profile-only.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ profiles: input.profiles })) });
  await expect(card).not.toContainText("Participant-period observations");
  await reloadApp(page);
  await expect(card).not.toContainText("Participant-period observations");
});

test("imports and reloads shared openings with exact membership, inferred views and selected-owner isolation", async ({ page }) => {
  const input = notificationOpeningExample();
  const other = structuredClone(input);
  other.profiles[0]!.method_profile_id = "example:other-opening-owner";
  for (const row of [...other.notification_histories, ...other.notification_opening_occurrences]) row.method_profile_id = other.profiles[0]!.method_profile_id;
  other.notification_opening_occurrences[0]!.occurrence_instant = "other-owner-opening-time";
  other.notification_histories[0]!.notification_evidence[0]!.evidence_instant = "other-owner-view-time";
  input.profiles.push(...other.profiles);
  input.notification_histories.push(...other.notification_histories);
  input.notification_opening_occurrences.push(...other.notification_opening_occurrences);
  await gotoApp(page);
  const picker = page.getByTestId("method-profile-file-input");
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const importAll = () => picker.setInputFiles({ name: "shared-opening.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
  const assertOwner = async (id: string) => {
    await expect(card).toContainText("No pending matching or view inference runs during import");
    const sections = [
      ["Notification opening occurrences (6)", input.notification_opening_occurrences.filter((o) => o.method_profile_id === id)],
      ["Notification histories (3)", input.notification_histories.filter((h) => h.method_profile_id === id)],
    ] as const;
    for (const [title, records] of sections) {
      const section = card.locator("details").filter({ has: page.getByText(title, { exact: true }) });
      if (!await section.evaluate((el) => (el as HTMLDetailsElement).open)) await section.locator("summary").click();
      await expect(section.locator("li")).toHaveCount(records.length);
      for (const record of records) {
        const recordId = "opening_occurrence_id" in record ? record.opening_occurrence_id : record.notification_history_id;
        const row = section.locator("li").filter({ has: page.getByText(String(recordId), { exact: true }) });
        for (const [key, value] of Object.entries(record)) {
          const label = key.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
          await expect(row).toContainText(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
        }
      }
    }
    await expect(card.getByRole("button", { name: "Load supported preprocessing settings" })).toBeDisabled();
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
  const invalid = structuredClone(input);
  invalid.notification_opening_occurrences[0]!.device_id = "foreign-device";
  await picker.setInputFiles({ name: "foreign-opening.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("matching history within profile/participant/known device");
  await reloadApp(page);
  await assertOwner(retained);
  await picker.setInputFiles({ name: "profile-only.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ profiles: input.profiles })) });
  await expect(card).not.toContainText("Notification opening occurrences");
  await reloadApp(page);
  await expect(card).not.toContainText("Notification opening occurrences");
});

for (const invalidOlder of [false, true]) {
  test(`keeps shared openings from the newest import when an older ${invalidOlder ? "invalid" : "valid"} read finishes last`, async ({ page }) => {
    const older = notificationOpeningExample();
    if (invalidOlder) older.notification_opening_occurrences[0]!.device_id = "foreign-device";
    const newer = notificationOpeningExample();
    newer.notification_opening_occurrences[0]!.occurrence_instant = "newest-opening-time";
    newer.notification_histories[0]!.notification_evidence[0]!.evidence_instant = "newest-view-time";
    await gotoApp(page);
    await page.evaluate(() => {
      const original = Reflect.get(File.prototype, "text");
      File.prototype.text = function () {
        if (this.name !== "older-opening-slow.json") return original.call(this);
        return new Promise<string>((resolve, reject) => {
          (window as unknown as { releaseOlderOpening: () => Promise<void> }).releaseOlderOpening = async () => {
            try { resolve(await original.call(this)); } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
          };
        });
      };
    });
    const picker = page.getByTestId("method-profile-file-input");
    const card = page.locator('[data-settings-anchor="research-method-profile"]');
    await picker.setInputFiles({ name: "older-opening-slow.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(older)) });
    await picker.setInputFiles({ name: "newest-opening.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(newer)) });
    await expect(card).toContainText("newest-opening-time");
    await page.evaluate(async () => { await (window as unknown as { releaseOlderOpening: () => Promise<void> }).releaseOlderOpening(); });
    for (const reload of [false, true]) {
      if (reload) await reloadApp(page);
      const openings = card.locator("details").filter({ has: page.getByText("Notification opening occurrences (6)", { exact: true }) });
      const histories = card.locator("details").filter({ has: page.getByText("Notification histories (3)", { exact: true }) });
      for (const section of [openings, histories]) if (!await section.evaluate((el) => (el as HTMLDetailsElement).open)) await section.locator("summary").click();
      await expect(openings).toContainText("newest-opening-time");
      await expect(histories).toContainText(`Notification evidence: ${JSON.stringify(newer.notification_histories[0]!.notification_evidence)}`);
      await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toHaveCount(0);
    }
  });
}

test("imports and reloads shared title annotations without replacing per-item categories or leaking owners", async ({ page }) => {
  const input = notificationTitleAnnotationExample();
  const other = structuredClone(input);
  other.profiles[0]!.method_profile_id = "example:other-title-annotation-profile";
  other.profiles[0]!.source_method_variant_id = "source-derived-other-title-annotation-example";
  for (const row of [...other.notification_histories, ...other.notification_title_annotations]) row.method_profile_id = other.profiles[0]!.method_profile_id;
  other.notification_title_annotations[0]!.sender_relationship_labels = ["social", "family"];
  input.profiles.push(...other.profiles);
  input.notification_histories.push(...other.notification_histories);
  input.notification_title_annotations.push(...other.notification_title_annotations);
  await gotoApp(page);
  const picker = page.getByTestId("method-profile-file-input");
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const importAll = () => picker.setInputFiles({ name: "shared-title-labels.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
  const assertOwner = async (id: string) => {
    await expect(card).toContainText("No title matching, location join or category resolution runs during import");
    const labels = card.locator("details").filter({ has: page.getByText("Notification title annotations (3)", { exact: true }) });
    const histories = card.locator("details").filter({ has: page.getByText("Notification histories (4)", { exact: true }) });
    for (const section of [labels, histories]) if (!await section.evaluate((el) => (el as HTMLDetailsElement).open)) await section.locator("summary").click();
    for (const annotation of input.notification_title_annotations.filter((a) => a.method_profile_id === id)) {
      const row = labels.locator("li").filter({ hasText: `Participant id: ${annotation.participant_id}` }).filter({ hasText: `Title annotation id: ${annotation.title_annotation_id}` });
      await expect(row).toContainText(`Sender relationship labels: ${JSON.stringify(annotation.sender_relationship_labels)}`);
      await expect(row).toContainText(`Notification title: ${annotation.notification_title ?? "null"}`);
      await expect(row).toContainText(`Source locators: ${JSON.stringify(annotation.source_locators)}`);
    }
    for (const history of input.notification_histories.filter((h) => h.method_profile_id === id)) {
      const row = histories.locator("li").filter({ has: page.getByText(history.notification_history_id, { exact: true }) });
      await expect(row).toContainText(`Title annotation reference: ${history.title_annotation_reference}`);
      await expect(row).toContainText(`Notification evidence: ${JSON.stringify(history.notification_evidence)}`);
    }
    await expect(card.getByRole("button", { name: "Load supported preprocessing settings" })).toBeDisabled();
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
  const invalid = structuredClone(input);
  invalid.notification_histories[2]!.title_annotation_reference = "example-unranked-label"; // Only exists for another participant.
  await picker.setInputFiles({ name: "foreign-labels.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("matching profile/participant annotation");
  await reloadApp(page);
  await assertOwner(retained);
  await picker.setInputFiles({ name: "no-title-labels.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ profiles: input.profiles })) });
  await expect(card).not.toContainText("Notification title annotations");
  await reloadApp(page);
  await expect(card).not.toContainText("Notification title annotations");
});

for (const exampleName of ["separate notification evidence", "MultiDevice eight rated-device answers", "doi:10.1145/3130956", "doi:10.3390/s24082612", "doi:10.1145/3229434.3229436"]) {
test(`imports and reloads ${exampleName}, subjective answers and supplied acceptance`, async ({ page }) => {
  test.skip(!privateCorpusAvailable && exampleName !== "separate notification evidence", PRIVATE_CORPUS_SKIP_REASON);
  const input = exampleName.startsWith("doi:")
    ? notificationBoundaryExample((JSON.parse(readFileSync(libraryPath, "utf8")) as {profiles: StudyMethodProfile[]}).profiles.find(p => p.source_work_id === exampleName)!)
    : exampleName.startsWith("MultiDevice")
    ? multiDeviceQuestionnaireExample((JSON.parse(readFileSync(libraryPath, "utf8")) as {profiles: StudyMethodProfile[]}).profiles.find(p => p.source_work_id === "doi:10.1145/2971648.2971732")!)
    : notificationHistoryExample();
  await gotoApp(page);
  const picker = page.getByTestId("method-profile-file-input");
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  await picker.setInputFiles({ name: "source-derived-notification-example.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
  const assertRecords = async () => {
    await expect(card).toContainText("No matching or acceptance recode runs during import");
    const section = card.locator("details").filter({ has: page.getByText(`Notification histories (${input.notification_histories.length})`, { exact: true }) });
    if (!await section.evaluate(el => (el as HTMLDetailsElement).open)) await section.locator("summary").click();
    await expect(section.locator("li")).toHaveCount(input.notification_histories.length);
    for (const history of input.notification_histories) {
      const row = section.locator("li").filter({ has: page.getByText(history.notification_history_id, { exact: true }) });
      for (const [key, value] of Object.entries(history)) {
        const label = key.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
        await expect(row).toContainText(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
      }
      await expect(row).toContainText(`Notification evidence: ${JSON.stringify(history.notification_evidence)}`);
      if (Object.hasOwn(history, "notification_title")) await expect(row).toContainText(`Notification title: ${JSON.stringify(history.notification_title)}`);
      await expect(row).toContainText(`Source locators: ${JSON.stringify(history.source_locators)}`);
      await expect(row).toContainText("History record origin: analyst_constructed_example");
      if (history.device_id) await expect(row).toContainText(`Device id: ${history.device_id}`);
      else await expect(row).not.toContainText("Device id:");
      if (Object.hasOwn(history, "questionnaire_responses")) await expect(row).toContainText(`Questionnaire responses: ${JSON.stringify(history.questionnaire_responses)}`);
      else await expect(row).not.toContainText("Questionnaire responses:");
      if (history.acceptance_records) {
        await expect(row).toContainText(`Acceptance records: ${JSON.stringify(history.acceptance_records)}`);
      } else {
        await expect(row).not.toContainText("Acceptance records:");
      }
    }
    await expectMethodProfileLoadAction(card, input.profiles[0] as StudyMethodProfile);
  };
  await assertRecords();
  await reloadApp(page); await assertRecords();
  const invalid = structuredClone(input);
  let expectedError = "references within history";
  if (exampleName.startsWith("MultiDevice")) invalid.notification_histories[0]!.questionnaire_responses!.push(structuredClone(invalid.notification_histories[0]!.questionnaire_responses![0]!));
  else if (exampleName.endsWith("3130956")) { Reflect.set(invalid.notification_histories[0]!.notification_evidence[1]!, "context_sampling_boundary", "seen"); expectedError = "context_sampling_boundary"; }
  else if (exampleName.endsWith("s24082612")) { delete invalid.notification_histories[0]!.notification_evidence[2]!.observed_property; expectedError = "observed_property"; }
  else if (exampleName.endsWith("3229436")) { invalid.notification_histories[0]!.original_notification_history_reference = "foreign-original"; expectedError = "original_notification_history_reference"; }
  else invalid.notification_histories[0]!.acceptance_records![0]!.evidence_references = ["foreign-evidence"];
  await picker.setInputFiles({ name: "invalid-history.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText(exampleName.startsWith("MultiDevice") ? "duplicated within history" : expectedError);
  await reloadApp(page);
  await assertRecords();
  await picker.setInputFiles({ name: "profile-only.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ profiles: input.profiles })) });
  await expect(card).not.toContainText("Notification histories");
  await reloadApp(page);
  await expect(card).toContainText(input.profiles[0]!.source_method_variant_id);
  await expect(card).not.toContainText("Notification histories");
});
}

test("imports and reloads notification context without replacing an unknown anchor with a preceding-minute window", async ({ page }) => {
  const input = notificationContextExample();
  await gotoApp(page);
  const picker = page.getByTestId("method-profile-file-input");
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  await picker.setInputFiles({ name: "notification-context.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
  // Both source profiles happen to use the same display count, so assert exact
  // payload after each selection and reload, not count alone.
  for (const profile of input.profiles) {
    await card.getByRole("combobox", { name: "Profile", exact: true }).selectOption(profile.method_profile_id);
    for (const reload of [false, true]) {
      if (reload) await reloadApp(page);
      const section = card.locator("details").filter({ has: page.getByText("Notification histories (2)", { exact: true }) });
      await section.locator("summary").click();
      for (const history of input.notification_histories.filter((h) => h.method_profile_id === profile.method_profile_id)) {
        const row = section.locator("li").filter({ has: page.getByText(history.notification_history_id, { exact: true }) });
        await expect(row).toContainText(`Notification evidence: ${JSON.stringify(history.notification_evidence)}`);
      }
      await expect(card.getByRole("button", { name: "Load supported preprocessing settings" })).toBeDisabled();
    }
    // Reload intentionally retains only the selected owner; reload the complete
    // import for the next source, without leaking another owner's records.
    await picker.setInputFiles({ name: "notification-context.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
  }
  const retainedProfileId = await card.getByRole("combobox", { name: "Profile", exact: true }).inputValue();
  const invalid = structuredClone(input);
  invalid.notification_histories[0]!.notification_evidence.find((e) => e.evidence_kind === "context")!.evidence_references = ["foreign-item-evidence"];
  await picker.setInputFiles({ name: "bad-context.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("references within history");
  await reloadApp(page);
  await expect(card).toContainText(input.profiles.find((p) => p.method_profile_id === retainedProfileId)!.source_method_variant_id);
  const retained = card.locator("details").filter({ has: page.getByText("Notification histories (2)", { exact: true }) });
  await retained.locator("summary").click();
  for (const history of input.notification_histories.filter((h) => h.method_profile_id === retainedProfileId)) {
    const row = retained.locator("li").filter({ has: page.getByText(history.notification_history_id, { exact: true }) });
    await expect(row).toContainText(`Notification evidence: ${JSON.stringify(history.notification_evidence)}`);
  }
  for (const history of input.notification_histories.filter((h) => h.method_profile_id !== retainedProfileId)) {
    await expect(retained).not.toContainText(history.notification_history_id);
  }
});

test("saves only the selected profile's notification histories without merging identical local IDs", async ({ page }) => {
  const input = notificationHistoryExample();
  const secondProfile = { ...structuredClone(input.profiles[0]!), method_profile_id: "example:second-notification-profile" };
  input.profiles.push(secondProfile);
  const secondHistory = { ...structuredClone(input.notification_histories[0]!),
    method_profile_id: secondProfile.method_profile_id, app_package_name: "example.second.app" };
  input.notification_histories.push(secondHistory);
  await gotoApp(page);
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  await page.getByTestId("method-profile-file-input").setInputFiles({ name: "two-profile-histories.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
  await expect(card).toContainText("Notification histories (2)");
  await expect(card).not.toContainText("example.second.app");
  await card.getByRole("combobox", { name: "Profile", exact: true }).selectOption(secondProfile.method_profile_id);
  await expect(card).toContainText("Notification histories (1)");
  await reloadApp(page);
  await expect(card).toContainText("Notification histories (1)");
  const section = card.locator("details").filter({ has: page.getByText("Notification histories (1)", { exact: true }) });
  await section.locator("summary").click();
  await expect(section).toContainText(`Notification evidence: ${JSON.stringify(secondHistory.notification_evidence)}`);
  await expect(section).toContainText("App package name: example.second.app");
  await expect(section).not.toContainText("example.notification.app");
  await expect(section).not.toContainText("example-history-2");
  await expect(card.getByRole("button", { name: "Load supported preprocessing settings" })).toBeDisabled();
});

for (const invalidOlder of [false, true]) {
  test(`keeps the latest notification history when an older ${invalidOlder ? "invalid" : "valid"} file finishes last`, async ({ page }) => {
    const older = notificationHistoryExample();
    if (invalidOlder) older.notification_histories[0]!.acceptance_records![0]!.evidence_references = ["foreign-evidence"];
    const newer = notificationHistoryExample();
    newer.notification_histories[0]!.notification_history_id = "example:newest-history";
    await gotoApp(page);
    await page.evaluate(() => {
      const original = Reflect.get(File.prototype, "text");
      File.prototype.text = function () {
        if (this.name !== "older-history-slow.json") return original.call(this);
        return new Promise<string>((resolve, reject) => {
          (window as unknown as { releaseOlderHistory: () => Promise<void> }).releaseOlderHistory = async () => {
            try { resolve(await original.call(this)); } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
          };
        });
      };
    });
    const picker = page.getByTestId("method-profile-file-input");
    const card = page.locator('[data-settings-anchor="research-method-profile"]');
    await picker.setInputFiles({ name: "older-history-slow.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(older)) });
    await picker.setInputFiles({ name: "newest-history.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(newer)) });
    await expect(card).toContainText("example:newest-history");
    await page.evaluate(async () => { await (window as unknown as { releaseOlderHistory: () => Promise<void> }).releaseOlderHistory(); });
    await expect(card).not.toContainText("example-history-1");
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toHaveCount(0);
    await reloadApp(page);
    await expect(card).toContainText("example:newest-history");
    await expect(card).not.toContainText("example-history-1");
  });
}

test("imports and reloads populated ringer-state intervals without turning them into phone use", async ({ page }) => {
  test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);
  const library = JSON.parse(readFileSync(libraryPath, "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = library.profiles.find((row) => row.source_work_id === "doi:10.1145/2785830.2785852")!;
  const input = ringerCommunicationExample(profile);
  await gotoApp(page);
  const picker = page.getByTestId("method-profile-file-input");
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  await picker.setInputFiles({ name: "normalized-ringer-state-intervals.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
  for (const reload of [false, true]) {
    if (reload) await reloadApp(page);
    await expect(card).toContainText("not continuous device use or an executed constructor");
    const section = card.locator("details").filter({ has: page.getByText("Ringer-state intervals (3)", { exact: true }) });
    await section.locator("summary").click();
    for (const record of input.ringer_state_intervals) {
      const row = section.locator("li").filter({ has: page.getByText(record.ringer_state_interval_id, { exact: true }) });
      await expect(row).toContainText(`Ringer mode: ${record.ringer_mode}`);
      await expect(row).toContainText(`Denotes interval: ${JSON.stringify(record.denotes_interval)}`);
      await expect(row).toContainText(`Session construction policy reference: ${record.session_construction_policy_reference}`);
      await expect(row).toContainText(`Source locators: ${JSON.stringify(record.source_locators)}`);
      await expect(row).toContainText("Interval record origin: analyst_constructed_example");
      await expect(row).not.toContainText("End status:");
    }

    for (const row of input.ringer_state_intervals) {
      const details = card.locator("li").filter({ has: page.getByText(row.ringer_state_interval_id, { exact: true }) });
      const text = (await details.allTextContents()).join("\n");
      for (const key of ["session_actions", "session_quantities"] as const) {
        const label = key.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
        expect(text).toContain(label + ": " + JSON.stringify(row[key]));
      }
    }
    for (const [label, rows, idField] of [
      ["Sampled quantities", input.sampled_quantity_observations, "sampled_observation_id"],
      ["Task occurrences", input.task_occurrences, "task_occurrence_id"],
    ] as const) {
      const section = card.locator("details").filter({ has: page.getByText(label + " (" + rows.length + ")", { exact: true }) });
      if (!await section.evaluate(el => (el as HTMLDetailsElement).open)) await section.locator("summary").click();
      for (const row of rows) {
        const record = row as unknown as Record<string, unknown>;
        const details = section.locator("li").filter({ has: page.getByText(String(record[idField]), { exact: true }) });
        const text = (await details.allTextContents()).join("\n");
        for (const [key, value] of Object.entries(record)) {
          const heading = key.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
          expect(text).toContain(heading + ": " + (typeof value === "string" ? value : JSON.stringify(value)));
        }
      }
    }
    await expectMethodProfileLoadAction(card, input.profiles[0]!);
  }
  const invalid = structuredClone(input);
  invalid.ringer_state_intervals[0]!.session_construction_policy_reference = "foreign-policy";
  await picker.setInputFiles({ name: "foreign-policy.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("setting-state policy");
  await reloadApp(page);
  await expect(card).toContainText("Ringer-state intervals (3)");
  await picker.setInputFiles({ name: "definition-only.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ profiles: [profile] })) });
  await expect(card).not.toContainText("Ringer-state intervals");
  await reloadApp(page);
  await expect(card).not.toContainText("Ringer-state intervals");
});

for (const sourceWorkId of ["doi:10.1145/3422821", "doi:10.2196/13209", "doi:10.4088/jcp.15m10310", "doi:10.1080/15213269.2024.2334025",
  "doi:10.1145/2371574.2371617", "doi:10.1145/2785830.2785852", "doi:10.1145/2971648.2971760",
  "doi:10.1145/2971648.2971712", "doi:10.1145/2971648.2971762", "doi:10.1145/2935334.2935383"]) {
  test(`imports and restores source-scoped session policies for ${sourceWorkId}`, async ({ page }) => {
    test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);
    const library = JSON.parse(readFileSync(libraryPath, "utf8")) as { profiles: Array<{
      source_work_id: string;
      session_construction_policies: Array<{ session_construction_policy_id: string; session_input_layer: string; session_output_layer: string; source_locators: string[] }>;
    }> };
    const profile = library.profiles.find((candidate) => candidate.source_work_id === sourceWorkId)!;
    expect(profile.session_construction_policies).toHaveLength(sourceWorkId.includes("2334025") ? 2 : 1);
    await gotoApp(page);
    await page.getByTestId("method-profile-file-input").setInputFiles({ name: "source-session-policies.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ profiles: [profile] })) });
    const card = page.locator('[data-settings-anchor="research-method-profile"]');
    for (const reload of [false, true]) {
      if (reload) await reloadApp(page);
      const section = card.locator("details").filter({ has: page.getByText(`Session construction policies (${profile.session_construction_policies.length})`, { exact: true }) });
      await section.locator("summary").click();
      await expect(section.locator("li")).toHaveCount(profile.session_construction_policies.length);
      await expect(section).not.toContainText("Reconstruction strategy:");
      for (const policy of profile.session_construction_policies) {
        const row = section.locator("li").filter({ has: page.getByText(policy.session_construction_policy_id, { exact: true }) });
        await expect(row).toBeVisible();
        await expect(row).toContainText(`Session input layer: ${policy.session_input_layer}`);
        await expect(row).toContainText(`Session output layer: ${policy.session_output_layer}`);
        await expect(row).toContainText(`Source locators: ${JSON.stringify(policy.source_locators)}`);
      }
      if (sourceWorkId.includes("2334025")) {
        await expect(card).toContainText('"merge_comparator":"<","merge_gap_ms":500');
        await expect(card).toContainText("number of phone sessions per hour");
        await expect(card).toContainText("undetermined");
      }
    }
  });
}

test("imports and restores normalized drawer observations without inventing missing samples or actions", async ({ page }) => {
  await gotoApp(page);
  const input = clearAllSnapshotExample();
  const picker = page.getByTestId("method-profile-file-input");
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  await picker.setInputFiles({ name: "normalized-drawer-observations.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
  for (const reload of [false, true]) {
    if (reload) await reloadApp(page);
    await expect(card).toContainText("An absent snapshot is not an observed empty drawer or a recorded user action");
    const observations = card.locator("details").filter({ has: page.getByText("Notification drawer snapshots (5)", { exact: true }) });
    await observations.locator("summary").click();
    await expect(observations).toContainText("Snapshot record origin: analyst_constructed_example");
    await expect(observations).toContainText("Snapshot instant: 2026-01-01T09:17:00Z");
    await expect(observations).not.toContainText("2026-01-01T09:15:00Z");
    await expect(observations).toContainText("Pending item appearances: []");
    await expect(observations).toContainText('"appearance_record_id":"a1","notification_item_id":"item-1","item_identity_basis":"paper_four_field_combination"');
    await expect(observations).toContainText('"appearance_record_id":"a2","notification_item_id":"item-1","item_identity_basis":"paper_four_field_combination"');
    await expect(observations).toContainText('"item_identity_basis":"linked_code_key_posttime"');
    await expect(observations).toContainText('"notification_tag_json":"null"');
    await expect(observations).toContainText('"post_time_identity_token":"12345"');
    await expect(observations).toContainText("Android version: 9.0");
    await expect(observations).toContainText("Android version: 10.0");
    await expect(observations).toContainText("Device model: Example Model");
    await expect(observations).toContainText("Device manufacturer: Example Manufacturer");
    await expect(observations).toContainText("Device product: example_product");
    await expect(observations).toContainText("Device product: null");
    await expect(observations).toContainText('Device model: ""');
    await expect(observations).toContainText("Snapshot transmission id token: 9007199254740993");
    await expect(observations).toContainText('"priority_value_json":"-2","clearability_value_json":"false","group_key_compat_absent":true');
    await expect(observations).toContainText('"priority_value_json":"2","clearability_value_json":"true"');
    await expect(observations).toContainText('"group_key_compat_value_json":"null"');
    await expect(observations).toContainText("Device id: D2");
    await expect(observations).toContainText("feb1ad9898385b4345dd5dcd8cf862aba4a7e330b847cab9c52d8d3cca3a493f");
    await expect(card.getByRole("button", { name: "Load supported preprocessing settings" })).toBeDisabled();
  }
  const invalid = structuredClone(input);
  Reflect.set(invalid.notification_snapshots[0]!, "pending_item_appearances", null);
  await picker.setInputFiles({ name: "invalid-null-membership.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("omission is not observed empty");
  const conflicting = structuredClone(input);
  Object.assign(conflicting.notification_snapshots[0]!.pending_item_appearances[0]!, { group_key_compat_value_json: "null" });
  await picker.setInputFiles({ name: "conflicting-group-key-presence.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(conflicting)) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("cannot assert absence and supply a group-key value");
  await reloadApp(page);
  await expect(card).toContainText("Notification drawer snapshots (5)");
  await picker.setInputFiles({ name: "profile-only.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ profiles: input.profiles })) });
  await expect(card).not.toContainText("Notification drawer snapshots");
  await reloadApp(page);
  await expect(card).toContainText("doi:10.1145/3340764.3340765");
  await expect(card).not.toContainText("Notification drawer snapshots");
});

test("preserves the Jones sequence definition through the existing picker and reload", async ({ page }) => {
  await gotoApp(page);
  const input = jonesSequenceExample();
  const picker = page.getByTestId("method-profile-file-input");
  await picker.setInputFiles({ name: "jones-sequence-definition-example.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  for (const reload of [false, true]) {
    if (reload) await reloadApp(page);
    const operations = card.locator("details").filter({ has: page.getByText("Method operations (2)", { exact: true }) });
    await operations.locator("summary").click();
    await expect(operations).toContainText("Sequence encoding rule: first_vs_previously_seen_in_partition");
    await expect(operations).toContainText('Sequence scope operation ids: ["jones.session_partition"]');
    await expect(operations).toContainText('Sequence identity setting ids: ["example:sequence:application"]');
    await expect(operations).toContainText("Sequence first symbol setting id: example:sequence:first");
    await expect(operations).toContainText("Sequence repeat symbol setting id: example:sequence:repeat");
    await expect(card).toContainText("7d55f75a6c99ac83983073a125b6bc2a4c7ca7f959ad2cce2b637f844ee61c15");
    await expect(card.getByRole("button", { name: "Load supported preprocessing settings" })).toBeDisabled();
  }
  const invalid = structuredClone(input);
  invalid.profiles[0]!.method_operations[1]!.sequence_scope_operation_ids = ["foreign"];
  await picker.setInputFiles({ name: "invalid-sequence-scope.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" }))
    .toContainText("invalid partition-local sequence references");
  await expect(card).toContainText("Sequence scope operation ids");
  await expect(card).not.toContainText('["foreign"]');
});

test("preserves the Clear All grouping definition through the existing picker and reload", async ({ page }) => {
  await gotoApp(page);
  const input = clearAllGroupingExample();
  const picker = page.getByTestId("method-profile-file-input");
  await picker.setInputFiles({ name: "clear-all-grouping-definition-example.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  for (const reload of [false, true]) {
    if (reload) await reloadApp(page);
    const operations = card.locator("details").filter({ has: page.getByText("Method operations (2)", { exact: true }) });
    await operations.locator("summary").click();
    await expect(operations).toContainText("Grouping basis: raw_string_concatenation");
    await expect(operations).toContainText('Concatenated key setting ids: ["example:field:packageName","example:field:groupKeyCompat"]');
    await expect(operations).toContainText('Empty if absent key setting ids: ["example:field:groupKeyCompat"]');
    await expect(operations).toContainText("Selection rule: RETAIN_SUMMARIES_IF_PRESENT_ELSE_ALL");
    await expect(card).toContainText("30c40282f57c3c57b5d906997426b23147b87277");
    await expect(card.getByRole("button", { name: "Load supported preprocessing settings" })).toBeDisabled();
  }
});

test("imports normalized ODIM trace relationships and restores them without pretending payload bytes were imported", async ({ page }) => {
  test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);
  const { profiles } = JSON.parse(readFileSync(libraryPath, "utf8")) as { profiles: Array<{ source_work_id: string }> };
  const input = odimInteractionTraceExample(profiles.find((profile) => profile.source_work_id === "doi:10.1145/3743726"));
  await gotoApp(page);
  const picker = page.getByTestId("method-profile-file-input");
  await picker.setInputFiles({ name: "normalized-trace-example.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  for (const reload of [false, true]) {
    if (reload) await reloadApp(page);
    await expect(card).toContainText("Referenced payload bytes are not imported or verified");
    const traces = card.locator("details").filter({ has: page.getByText("Supplied interaction traces (1)", { exact: true }) });
    await traces.locator("summary").click();
    await expect(traces).toContainText("analyst_constructed_example");
    await expect(traces).toContainText("Trace description: Illustrative supplied trace description: find a destination");
    await expect(traces).toContainText('"screen_description":"Illustrative supplied screen description: destination entry"');
    await expect(traces).toContainText('"screen_description":"Illustrative supplied screen description: destination results"');
    await expect(traces).toContainText('"interaction_event_id":"e1","event_sequence_position":0');
    await expect(traces).toContainText('"interaction_event_id":"e3","event_sequence_position":1');
    await expect(traces).not.toContainText('"interaction_event_id":"e2"');
    await expect(traces).toContainText('"gesture_artifact_id":null');
    await expect(traces).toContainText('"capture_incomplete":false,"human_detected_incorrect":true');
    await expect(traces).toContainText('"screenshot_redaction_effect":"selected_element_pixels_deleted","hierarchy_redaction_effect":"corresponding_text_content_tagged"');
    await expect(traces).toContainText('"screenshot_redaction_effect":"drawn_region_blackened","hierarchy_redaction_effect":"qualifying_element_metadata_removed"');
    await expect(traces).toContainText("dcf3c9cdf7d6fe9fb916774ee0cedfcae11ccdc2fe2c93cb922815faafd7e920");
    const artifacts = card.locator("details").filter({ has: page.getByText("Referenced payload identities (12)", { exact: true }) });
    await artifacts.locator("summary").click();
    await expect(artifacts).toContainText("image2"); // Catalog membership is not current event membership.
    await expectMethodProfileLoadAction(card, input.profiles[0] as StudyMethodProfile);
  }
  const invalid = structuredClone(input);
  invalid.referenced_artifacts = [];
  await picker.setInputFiles({ name: "dangling-payload.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("no referenced artifact");
  await reloadApp(page);
  await expect(card).toContainText("Supplied interaction traces (1)");
  await expect(card).toContainText("Referenced payload identities (12)");
  const badDescription = structuredClone(input);
  Reflect.set(badDescription.interaction_traces[0]!.interaction_events[0]!, "screen_description", { text: "invalid" });
  await picker.setInputFiles({ name: "invalid-description.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(badDescription)) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("screen_description must be a string or null");
  await reloadApp(page);
  await expect(card).toContainText("Illustrative supplied trace description: find a destination");
  const other = structuredClone(input);
  const profile = other.profiles[0] as StudyMethodProfile;
  profile.method_profile_id = "example:other-trace-owner";
  other.interaction_traces[0]!.method_profile_id = profile.method_profile_id;
  other.interaction_traces[0]!.interaction_trace_id = "example:other-owned-trace";
  other.interaction_traces[0]!.trace_description = "Other owner trace <script>window.odimInjected = true</script>";
  other.interaction_traces[0]!.interaction_events[0]!.screen_description = "Other owner screen";
  const both = { ...input, profiles: [...input.profiles, ...other.profiles], interaction_traces: [...input.interaction_traces, ...other.interaction_traces] };
  await picker.setInputFiles({ name: "two-trace-owners.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(both)) });
  await card.getByRole("combobox", { name: "Profile", exact: true }).selectOption(profile.method_profile_id);
  for (const reload of [false, true]) {
    if (reload) await reloadApp(page);
    const traces = card.locator("details").filter({ has: page.getByText("Supplied interaction traces (1)", { exact: true }) });
    if (!await traces.evaluate((el) => (el as HTMLDetailsElement).open)) await traces.locator("summary").click();
    await expect(traces).toContainText(other.interaction_traces[0]!.trace_description);
    await expect(traces).toContainText('"screen_description":"Other owner screen"');
    await expect(traces).not.toContainText('"screen_description":"Illustrative supplied screen description: destination entry"');
    expect(await page.evaluate(() => Reflect.get(window, "odimInjected") as unknown)).toBeUndefined();
    const saved = () => page.evaluate(async ({ database, store }) => new Promise<string>((resolveSaved, reject) => {
      const open = indexedDB.open(database);
      open.onerror = () => reject(new Error(open.error?.message ?? "database open failed"));
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(store, "readonly");
        const read = tx.objectStore(store).get("research-selection") as IDBRequest<{ selectionJson: string } | undefined>;
        tx.onerror = () => { db.close(); reject(new Error(tx.error?.message ?? "selection read failed")); };
        tx.oncomplete = () => {
          db.close();
          if (read.result) resolveSaved(read.result.selectionJson);
          else reject(new Error("saved research selection missing"));
        };
      };
    }), { database: LAST_RUN_DB_NAME, store: LAST_RUN_STORE_NAME });
    await expect.poll(async () => (JSON.parse(await saved()) as { interaction_traces: unknown }).interaction_traces).toEqual(other.interaction_traces);
  }
  await picker.setInputFiles({ name: "profile-only.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ profiles: input.profiles })) });
  await expect(card).not.toContainText("Supplied interaction traces");
  await expect(card).not.toContainText("Referenced payload identities");
  await reloadApp(page);
  await expect(card).toContainText("doi:10.1145/3743726");
  await expect(card).not.toContainText("Supplied interaction traces");
  await expect(card).not.toContainText("Referenced payload identities");
});

test("keeps the latest method-profile import when an older file read finishes last", async ({ page }) => {
  test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);
  const { profiles } = JSON.parse(readFileSync(libraryPath, "utf8")) as { profiles: Array<{ source_work_id: string }> };
  const older = odimInteractionTraceExample(profiles.find((profile) => profile.source_work_id === "doi:10.1145/3743726"));
  const newer = structuredClone(older);
  newer.interaction_traces[0]!.interaction_trace_id = "example:newer-trace";
  await gotoApp(page);
  await page.evaluate(() => {
    const original = Reflect.get(File.prototype, "text");
    File.prototype.text = function () {
      if (this.name !== "older-slow.json") return original.call(this);
      return new Promise<string>((resolve, reject) => {
        (window as unknown as { releaseOlderImport: () => Promise<void> }).releaseOlderImport = async () => {
          try { resolve(await original.call(this)); } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
        };
      });
    };
  });
  const picker = page.getByTestId("method-profile-file-input");
  await picker.setInputFiles({ name: "older-slow.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(older)) });
  await picker.setInputFiles({ name: "newer.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(newer)) });
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  await expect(card).toContainText("example:newer-trace");
  await page.evaluate(async () => { await (window as unknown as { releaseOlderImport: () => Promise<void> }).releaseOlderImport(); });
  await expect(card).toContainText("example:newer-trace");
  await expect(card).not.toContainText("example:edited-trace");
  await reloadApp(page);
  await expect(card).toContainText("example:newer-trace");
  await expect(card).not.toContainText("example:edited-trace");
});

test("preserves conditional ringer actuation definitions without enabling execution", async ({ page }) => {
  const file = resolve(import.meta.dirname, "fixtures/call-setting-actuation-example.json");
  const library = JSON.parse(readFileSync(file, "utf8")) as {
    profiles: Array<{ source_work_id: string; method_settings: Array<{
      method_parameter_key: string; method_value_json: string; source_locators: string[];
    }>; method_operations: Array<{ operation_id: string; depends_on: string[] }> }>;
  };
  const profile = library.profiles[0]!;
  await gotoApp(page);
  await page.getByTestId("method-profile-file-input").setInputFiles(file);
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  for (const reload of [false, true]) {
    if (reload) await reloadApp(page);
    await expect(card).toContainText(profile.source_work_id);
    const settingsSection = card.locator("details").filter({ has: page.getByText("Intervention (2)", { exact: true }) });
    await settingsSection.locator("summary").click();
    for (const setting of profile.method_settings) {
      const row = settingsSection.locator("li").filter({ has: page.getByText(setting.method_parameter_key, { exact: true }) });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("device_setting_actuation");
      await expect(row).toContainText(setting.method_value_json);
      await expect(row).toContainText(`Source: ${setting.source_locators.join(", ")}`);
    }
    await expect(card.getByRole("button", { name: "Load supported preprocessing settings" })).toBeDisabled();
    const section = card.locator("details").filter({ has: page.getByText("Method operations (2)", { exact: true }) });
    await section.locator("summary").click();
    for (const operation of profile.method_operations) {
      const row = section.locator("li").filter({ has: page.getByText(operation.operation_id, { exact: true }) });
      await expect(row).toContainText(`Depends on: ${JSON.stringify(operation.depends_on)}`);
    }
  }
});

for (const [name, sourceWorkId] of [
  ["Dismissed", "doi:10.1145/3229434.3229445"],
  ["Annotif", "doi:10.1145/3365610.3365611"],
  ["ODIM", "doi:10.1145/3743726"],
  ["Clear All", "doi:10.1145/3340764.3340765"],
  ["van Berkel", "doi:10.1145/2858036.2858348"],
  ["Jones", "doi:10.1145/2750858.2807542"],
  ["de Montjoye", "doi:10.1007/978-3-642-37210-0_6"],
  ["Ruegger", "doi:10.1002/per.2309"],
  ["Lepri", "doi:10.1145/2647868.2654933"],
  ["Back-to-App", "doi:10.1145/2371574.2371617"],
  ["Chang", "doi:10.1145/2785830.2785852"],
  ["Mathur", "doi:10.1145/2971648.2971760"],
  ["Abdullah", "doi:10.1145/2971648.2971712"],
  ["Hiniker", "doi:10.1145/2971648.2971762"],
  ["Attelia II", "doi:10.1145/2750858.2807517"],
  ["Murnane", "doi:10.1145/2935334.2935383"],
  ["PrefMiner", "doi:10.1145/2971648.2971747"],
  ["Okoshi 2017", "doi:10.1109/percom.2017.7917856"],
  ["My Phone and Me", "doi:10.1145/2858036.2858566"],
  ["Content-driven", "doi:10.1145/2750858.2807544"],
  ["In-Situ", "doi:10.1145/2628363.2628364"],
  ["Large-Scale", "doi:10.1145/2556288.2557189"],
  ["Reachable", "doi:10.1016/j.pmcj.2017.01.011"],
  ["Call-Availability", "doi:10.1145/2632048.2632060"],
  ["Falaki", "doi:10.1145/1814433.1814453"],
  ["Corona", "doi:10.1038/s41597-026-07015-7"],
  ["Rabbit Hole", "doi:10.1145/3604241"],
  ["Kim2015", "doi:10.1007/978-94-017-9618-7_14"],
  ["Mercati", "source-ref:22c0acbc687e7ae7f40e"],
  ["Rodrigues", "doi:10.1145/3491102.3501908"],
] as const) {
  test(`imports and displays ${name}'s operation dependencies after reload`, async ({ page }) => {
    test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);
    const library = JSON.parse(readFileSync(libraryPath, "utf8")) as {
      profiles: Array<{
        method_profile_id: string;
        source_work_id: string;
        method_settings: Array<{ method_parameter_key: string; method_value_json: string; source_locators: string[] }>;
        method_configuration_space: { method_configuration_groups: Array<{
          method_configuration_group_kind: string;
          method_configuration_levels: Array<{ branch_method_setting_ids: string[] }>;
        }> };
        method_operations: Array<{
          operation_id: string;
          verb: string;
          consumes?: string[];
          produces?: string[];
          data_effects?: string[];
          depends_on?: string[];
          configuration_dependencies: string[];
          group_scope_operation_ids?: string[];
          grouping_basis?: string;
          equality_key_setting_ids?: string[];
          concatenated_key_setting_ids?: string[];
          empty_if_absent_key_setting_ids?: string[];
          selection_rule?: string;
          required_event_payload_roles?: string[];
          optional_event_payload_roles?: string[];
          event_payload_association?: string;
          missing_gesture_marks_incomplete?: boolean;
          gesture_presence_implies_correctness?: boolean;
          sequence_encoding_rule?: string;
          sequence_scope_operation_ids?: string[];
          sequence_identity_setting_ids?: string[];
          sequence_first_symbol_setting_id?: string;
          sequence_repeat_symbol_setting_id?: string;
        }>;
      }>;
    };
    const profile = library.profiles.find((row) => row.source_work_id === sourceWorkId);
    if (!profile) throw new Error(`${name} source profile is missing from the canonical library`);
    expect(profile.method_operations.filter((operation) => operation.selection_rule))
      .toHaveLength(name === "Dismissed" ? 1 : name === "Annotif" ? 2 : name === "Clear All" ? 3 : 0);
    await gotoApp(page);
    await page.getByTestId("method-profile-file-input").setInputFiles({
      name: `${name.toLowerCase()}-method-profile.json`,
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ profiles: [profile] })),
    });
    const card = page.locator('[data-settings-anchor="research-method-profile"]');
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
    for (const reload of [false, true]) {
      if (reload) await reloadApp(page);
      await expect(card).toContainText(sourceWorkId);
      if (["Corona", "Rabbit Hole", "Kim2015", "Mercati", "Rodrigues"].includes(name)) {
        await expect.poll(savedSelection).toEqual({ profile, selectedLevels: {} });
        await expectMethodProfileLoadAction(card, profile as unknown as StudyMethodProfile);
      }
      if (["Abdullah", "Hiniker", "Attelia II", "Murnane", "PrefMiner", "Okoshi 2017", "My Phone and Me", "Content-driven", "In-Situ", "Large-Scale", "Reachable", "Call-Availability", "Falaki", "Kim2015", "Mercati", "Rodrigues"].includes(name)) {
        for (const setting of profile.method_settings) {
          const row = card.locator("li").filter({ has: page.getByText(setting.method_parameter_key, { exact: true }) });
          await expect(row).toHaveCount(1);
          await expect(row).toContainText(setting.method_value_json);
          await expect(row).toContainText(`Source: ${setting.source_locators.join(", ")}`);
        }
        await expectMethodProfileLoadAction(card, profile as unknown as StudyMethodProfile);
      }
      const section = card.locator("details").filter({
        has: page.getByText(`Method operations (${profile.method_operations.length})`, { exact: true }),
      });
      await expect(section).toHaveCount(1);
      await section.locator("summary").click();
      await expect(section.locator("li")).toHaveCount(profile.method_operations.length);
      for (const operation of profile.method_operations) {
        const row = section.locator("li").filter({
          has: page.getByText(operation.operation_id, { exact: true }),
        });
        await expect(row).toBeVisible();
        if (operation.depends_on === undefined) await expect(row).not.toContainText("Depends on:");
        else await expect(row).toContainText(`Depends on: ${JSON.stringify(operation.depends_on)}`);
        await expect(row).toContainText(`Configuration dependencies: ${JSON.stringify(operation.configuration_dependencies)}`);
        await expect(row).toContainText(operation.verb);
        for (const [field, label] of [["consumes", "Consumes"], ["produces", "Produces"], ["data_effects", "Data effects"]] as const) {
          if (operation[field] === undefined) await expect(row).not.toContainText(`${label}:`);
          else await expect(row).toContainText(`${label}: ${JSON.stringify(operation[field])}`);
        }
        if (operation.sequence_encoding_rule) {
          await expect(row).toContainText("Sequence encoding rule: first_vs_previously_seen_in_partition");
          await expect(row).toContainText(`Sequence scope operation ids: ${JSON.stringify(operation.sequence_scope_operation_ids)}`);
          await expect(row).toContainText(`Sequence identity setting ids: ${JSON.stringify(operation.sequence_identity_setting_ids)}`);
          await expect(row).toContainText(`Sequence first symbol setting id: ${operation.sequence_first_symbol_setting_id}`);
          await expect(row).toContainText(`Sequence repeat symbol setting id: ${operation.sequence_repeat_symbol_setting_id}`);
        }
        if (operation.selection_rule) {
          await expect(row).toContainText(`Group scope operation ids: ${JSON.stringify(operation.group_scope_operation_ids)}`);
          await expect(row).toContainText(`Grouping basis: ${operation.grouping_basis}`);
          await expect(row).toContainText(`Equality key setting ids: ${JSON.stringify(operation.equality_key_setting_ids)}`);
          await expect(row).toContainText(`Selection rule: ${operation.selection_rule}`);
          if (operation.grouping_basis === "raw_string_concatenation") {
            await expect(row).toContainText(`Concatenated key setting ids: ${JSON.stringify(operation.concatenated_key_setting_ids)}`);
            await expect(row).toContainText(`Empty if absent key setting ids: ${JSON.stringify(operation.empty_if_absent_key_setting_ids)}`);
          }
        }
        if (name === "ODIM" && ["odim.capture_snapshot", "odim.complete_event"].includes(operation.operation_id)) {
          await expect(row).toContainText('Required event payload roles: ["screenshot","view_hierarchy"]');
          if (operation.operation_id === "odim.capture_snapshot") {
            await expect(row).toContainText("Optional event payload roles: []");
            await expect(row).toContainText("Missing gesture marks incomplete: true");
            await expect(row).not.toContainText("Event payload association:");
            await expect(row).not.toContainText("Gesture presence implies correctness:");
          } else {
            await expect(row).toContainText('Optional event payload roles: ["gesture"]');
            await expect(row).toContainText("Event payload association: gesture_to_most_recent_paired_snapshot");
            await expect(row).toContainText("Gesture presence implies correctness: false");
          }
        }
      }
      if (name === "ODIM") {
        await card.getByText("Source configuration space", { exact: false }).click();
        const conditional = profile.method_configuration_space.method_configuration_groups.filter((group) =>
          group.method_configuration_group_kind === "conditional_joint_protocol");
        expect(conditional.map((group) => group.method_configuration_levels[0]!.branch_method_setting_ids.length))
          .toEqual([5, 5, 2, 3]);
        for (const group of conditional) {
          await expect(card).toContainText(`branch membership ${group.method_configuration_levels[0]!.branch_method_setting_ids.join(", ")}`);
        }
        // Only the two existing device/web axes have selectors; conditions do not.
        await expect(card.getByText("Select exact source level")).toHaveCount(2);
      }
      if (name === "van Berkel") {
        await card.getByText("Source configuration space", { exact: false }).click();
        const conditional = profile.method_configuration_space.method_configuration_groups.filter((group) =>
          group.method_configuration_group_kind === "conditional_joint_protocol");
        expect(conditional).toHaveLength(1);
        expect(conditional[0]!.method_configuration_levels[0]!.branch_method_setting_ids).toHaveLength(2);
        await expect(card).toContainText(`branch membership ${conditional[0]!.method_configuration_levels[0]!.branch_method_setting_ids.join(", ")}`);
        expect(profile.method_configuration_space.method_configuration_groups.filter((group) =>
          group.method_configuration_group_kind === "source_campaign_model_cell")).toHaveLength(3);
        await expect(card.getByText("Select exact source level")).toHaveCount(0);
      }
      if (name === "Kim2015") {
        await card.getByText("Source configuration space", { exact: false }).click();
        await expect(card.getByText("Select exact source level")).toHaveCount(0);
        await expect.poll(savedSelection).toEqual({ profile, selectedLevels: {} });
      }
      await expect(card).toContainText("completion blockers");
    }
    if (["Rabbit Hole", "Kim2015", "Mercati", "Rodrigues"].includes(name)) {
      const other = library.profiles.find(row => row.source_work_id === "doi:10.1038/s41597-026-07015-7");
      if (!other) throw new Error("Second canonical owner is missing");
      const picker = page.getByTestId("method-profile-file-input");
      const importBoth = () => picker.setInputFiles({ name: "source-and-corona.json", mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ profiles: [profile, other] })) });
      for (const owner of [other, profile]) {
        await importBoth();
        await card.getByRole("combobox", { name: "Profile", exact: true }).selectOption(owner.method_profile_id);
        await expect.poll(savedSelection).toEqual({ profile: owner, selectedLevels: {} });
        await reloadApp(page);
        await expect(card).toContainText(owner.source_work_id);
        await expect.poll(savedSelection).toEqual({ profile: owner, selectedLevels: {} });
      }
      const invalid = structuredClone(profile);
      invalid.method_operations[0]!.depends_on = ["missing.source.dependency"];
      await picker.setInputFiles({ name: "invalid-source-dependency.json", mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ profiles: [invalid] })) });
      await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" }))
        .toContainText("unknown dependency: missing.source.dependency");
      await expect.poll(savedSelection).toEqual({ profile, selectedLevels: {} });
      await reloadApp(page);
      await expect(card).toContainText(profile.source_work_id);
      await expect.poll(savedSelection).toEqual({ profile, selectedLevels: {} });
    }
  });
}

test("rejects malformed operation imports without replacing the saved source profile", async ({ page }) => {
  test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);
  const library = JSON.parse(readFileSync(libraryPath, "utf8")) as {
    profiles: Array<{ source_work_id: string; method_operations: Array<Record<string, unknown>> }>;
  };
  const profile = library.profiles.find((row) => row.source_work_id === "doi:10.1145/3743726");
  if (!profile) throw new Error("ODIM source profile is missing from the canonical library");
  await gotoApp(page);
  const input = page.getByTestId("method-profile-file-input");
  await input.setInputFiles({
    name: "odim-valid-method-profile.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ profiles: [profile] })),
  });
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  await expect(card).toContainText(profile.source_work_id);
  for (const invalidFields of [{ data_effects: 42 }, { untyped_join_policy: "invented" },
    { event_payload_association: null }, { optional_event_payload_roles: ["screenshot"] },
    { selection_rule: null }, { group_scope_operation_ids: ["foreign-partition"],
      grouping_basis: "declared_group_membership", selection_rule: "LAST" }]) {
    const invalid = structuredClone(profile);
    Object.assign(invalid.method_operations[0]!, invalidFields);
    await input.setInputFiles({
      name: "odim-invalid-method-profile.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ profiles: [invalid] })),
    });
    await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" }))
      .toContainText(Object.keys(invalidFields)[0]!);
    await expect(card).toContainText(profile.source_work_id);
  }
  await reloadApp(page);
  await expect(card).toContainText(profile.source_work_id);
  const operations = card.locator("details").filter({
    has: page.getByText("Method operations (10)", { exact: true }),
  });
  await operations.locator("summary").click();
  await expect(operations).toContainText(`Data effects: ${JSON.stringify(profile.method_operations[0]!.data_effects)}`);
  await expect(operations).not.toContainText("untyped_join_policy");
});

test("imports a real paper profile and restores its nondefault source level after reload", async ({ page }) => {
  test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);
  const library = JSON.parse(readFileSync(libraryPath, "utf8")) as ConfigurationProfileLibrary;
  const profile = library.profiles.find((row: { source_work_id: string }) =>
    row.source_work_id === "doi:10.1007/s00779-012-0511-8");
  if (!profile) throw new Error("UbiqLog source profile is missing from the canonical library");
  const transferGroup = profile.method_configuration_space.method_configuration_groups.find((group: {
    method_configuration_group_kind: string;
    method_configuration_levels: Array<{ method_configuration_level_label: string }>;
  }) => group.method_configuration_group_kind === "source_configuration_alternative"
    && group.method_configuration_levels.some((level) => level.method_configuration_level_label
      === "Maximum-folder-size triggered reliable-storage-media transfer"));
  if (!transferGroup) throw new Error("UbiqLog transfer alternatives are missing");
  const chosenLevel = transferGroup.method_configuration_levels.find((level: {
    method_configuration_level_label: string;
  }) => level.method_configuration_level_label
    === "Maximum-folder-size triggered reliable-storage-media transfer")?.method_configuration_level_id;
  if (!chosenLevel) throw new Error("The reliable-storage transfer level has no identity");
  await gotoApp(page);
  await page.getByTestId("method-profile-file-input").setInputFiles({
    name: "ubiqlog-method-profile.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ profiles: [profile] })),
  });
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  await expect(card).toContainText("doi:10.1007/s00779-012-0511-8");
  await card.getByText("Source configuration space", { exact: false }).click();
  const selector = card.getByText("Select exact source level").first().locator("..").locator("select");
  await selector.selectOption(chosenLevel);
  await expect(selector).toHaveValue(chosenLevel);
  await expect(card).toContainText("selected inventory:");

  await reloadApp(page);
  await expect(card).toContainText("doi:10.1007/s00779-012-0511-8");
  await card.getByText("Source configuration space", { exact: false }).click();
  await expect(card.getByText("Select exact source level").first().locator("..").locator("select"))
    .toHaveValue(chosenLevel);
  await expect(card).toContainText("selected inventory:");
  await expect(card).toContainText("completion blockers");
});

test("restores one Healthy Mind delivery arm without turning study-wide analyses into choices", async ({ page }) => {
  test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);
  const library = JSON.parse(readFileSync(libraryPath, "utf8")) as ConfigurationProfileLibrary;
  const profile = library.profiles.find((row: { source_work_id: string }) =>
    row.source_work_id === "doi:10.1371/journal.pone.0169162");
  if (!profile) throw new Error("Healthy Mind source profile is missing from the canonical library");
  const group = profile.method_configuration_space.method_configuration_groups.find((row: {
    method_configuration_group_kind: string;
  }) => row.method_configuration_group_kind === "source_configuration_alternative");
  const daily = group?.method_configuration_levels.find((row: { method_configuration_level_label: string }) =>
    row.method_configuration_level_label === "daily randomized notification delivery");
  if (!daily) throw new Error("The daily delivery arm is missing");
  await gotoApp(page);
  await page.getByTestId("method-profile-file-input").setInputFiles({
    name: "healthy-mind-method-profile.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ profiles: [profile] })),
  });
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  for (const reload of [false, true]) {
    if (reload) await reloadApp(page);
    await expect(card).toContainText(profile.source_work_id);
    await card.getByText("Source configuration space", { exact: false }).click();
    const selector = card.getByText("Select exact source level").locator("..").locator("select");
    await expect(selector).toHaveCount(1);
    if (!reload) await selector.selectOption(daily.method_configuration_level_id);
    await expect(selector).toHaveValue(daily.method_configuration_level_id);
    await expect(card).toContainText("first-two-weeks notification-response and intervention-usage measurement and quantitative analysis");
    await expect(card).toContainText("semi-structured interview collection and inductive thematic analysis");
    await card.locator("summary").filter({ hasText: "Intervention" }).click();
    await expect(card.locator("li").filter({ hasText: "daily.frequency" })).toContainText("Target: notification_delivery");
  }
});

test("imports and restores participant-level lab inputs without labeling them diary events", async ({ page }) => {
  test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);
  const library = JSON.parse(readFileSync(libraryPath, "utf8")) as ConfigurationProfileLibrary;
  const profile = library.profiles.find((row: { source_work_id: string }) =>
    row.source_work_id === "doi:10.1016/j.smhl.2018.07.005");
  if (!profile) throw new Error("DemonicSalmon source profile is missing from the canonical library");
  await gotoApp(page);
  await page.getByTestId("method-profile-file-input").setInputFiles({
    name: "demonicsalmon-method-profile.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ profiles: [profile] })),
  });
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  await expect(card).toContainText(profile.source_work_id);
  await card.locator("summary").filter({ hasText: "Participant schema" }).click();
  await expect(card).toContainText("input.lab_schema");
  await expect(card).toContainText("measure.sias");
  await expect(card).toContainText("Target: participant_measure");

  await reloadApp(page);
  await expect(card).toContainText(profile.source_work_id);
  await card.locator("summary").filter({ hasText: "Participant schema" }).click();
  await expect(card).toContainText("input.lab_schema");
  await expect(card).toContainText("Target: participant_record");
});

test("imports questionnaire schema and reported case observations without turning them into diary controls", async ({ page }) => {
  test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);
  const library = JSON.parse(readFileSync(libraryPath, "utf8")) as ConfigurationProfileLibrary;
  const profile = library.profiles.find((row: { source_work_id: string }) =>
    row.source_work_id === "doi:10.1109/percomw.2015.7134065");
  if (!profile) throw new Error("PerComW source profile is missing from the canonical library");
  await gotoApp(page);
  await page.getByTestId("method-profile-file-input").setInputFiles({
    name: "percomw-method-profile.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ profiles: [profile] })),
  });
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  await expect(card).toContainText(profile.source_work_id);
  await card.locator("summary").filter({ hasText: "Participant schema" }).click();
  await expect(card).toContainText("questionnaire.domains");
  await expect(card).toContainText("Target: participant_record");
  await card.locator("summary").filter({ hasText: "Reporting" }).click();
  await expect(card).toContainText("user1.survey_context");

  await reloadApp(page);
  await expect(card).toContainText(profile.source_work_id);
  await card.locator("summary").filter({ hasText: "Participant schema" }).click();
  await card.locator("summary").filter({ hasText: "Reporting" }).click();
  await expect(card).toContainText("questionnaire.formats");
  await expect(card).toContainText("user30.survey_context");
});

test("imports source campaign cells without inventing selectable app-usage presets", async ({ page }) => {
  test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);
  const library = JSON.parse(readFileSync(libraryPath, "utf8")) as ConfigurationProfileLibrary;
  const profile = library.profiles.find((row: { source_work_id: string }) =>
    row.source_work_id === "doi:10.1007/s42486-020-00045-z");
  if (!profile) throw new Error("Next-app source profile is missing from the canonical library");
  await gotoApp(page);
  await page.getByTestId("method-profile-file-input").setInputFiles({
    name: "next-app-method-profile.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ profiles: [profile] })),
  });
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  await card.getByText("Source configuration space", { exact: false }).click();
  await expect(card).toContainText("Used-application histogram and CDF");
  await expect(card).toContainText("Three-user temporal-correlation analysis");
  await expect(card).toContainText("Three-user spatial-correlation analysis");
  await expect(card).toContainText("Delta-T baseline: Binary Relevance");
  await expect(card).toContainText("LSTM plus time and location");
  await expect(card).toContainText("Delta-T LSTM timestep sweep from 30 to 190");
  await expect(card).toContainText("Top-K recommendation with K=5");
  await expect(card.getByText("Select exact source level")).toHaveCount(0);

  await reloadApp(page);
  await card.getByText("Source configuration space", { exact: false }).click();
  await expect(card).toContainText("Used-application histogram and CDF");
  await expect(card).toContainText("Three-user temporal-correlation analysis");
  await expect(card).toContainText("Three-user spatial-correlation analysis");
  await expect(card).toContainText("Delta-T baseline: Binary Relevance");
  await expect(card).toContainText("LSTM plus time and location");
  await expect(card).toContainText("Delta-T LSTM timestep sweep from 30 to 190");
  await expect(card).toContainText("Top-K recommendation with K=5");
});

test("restores the reanalysis's typed outcome rule, clinical labels, and distinct model arms", async ({ page }) => {
  test.skip(!privateCorpusAvailable, PRIVATE_CORPUS_SKIP_REASON);
  const library = JSON.parse(readFileSync(libraryPath, "utf8")) as ConfigurationProfileLibrary;
  const profile = library.profiles.find((row: { source_work_id: string }) =>
    row.source_work_id === "source-ref:e2014b2268ac2833bb8e");
  if (!profile) throw new Error("2020 phone-sensing reanalysis profile is missing from the canonical library");
  await gotoApp(page);
  await page.getByTestId("method-profile-file-input").setInputFiles({
    name: "brain-reanalysis-method-profile.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ profiles: [profile] })),
  });
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  for (const reload of [false, true]) {
    if (reload) await reloadApp(page);
    await expect(card).toContainText(profile.source_work_id);
    await card.getByText("Source configuration space", { exact: false }).click();
    await expect(card).toContainText("Turkish Parkinson cohort: participant feature-averaging variant");
    await expect(card).toContainText("Turkish Parkinson cohort: recording-probability averaging variant");
    await card.locator("summary").filter({ hasText: "Analysis" }).click();
    const phqRule = card.locator("li").filter({ hasText: "outcome.depression.phq9_threshold" });
    await expect(phqRule).toContainText('"depressed":{"comparator":">=","threshold":10}');
    await card.locator("summary").filter({ hasText: "Participant schema" }).click();
    await expect(card.locator("li").filter({ hasText: "pd.us.labels" })).toContainText("Target: participant_measure");
    await card.locator("summary").filter({ hasText: "Provenance" }).click();
    await expect(card.locator("li").filter({ hasText: "studentlife.cohort.analyzed_students" }))
      .toContainText("Target: participant_record");
  }
});
