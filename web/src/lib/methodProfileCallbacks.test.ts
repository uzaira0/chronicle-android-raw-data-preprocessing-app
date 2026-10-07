import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { lazyPrivateCorpusJson } from "@/testSupport/privateCorpus";
import { loadResearchMethodSelection, saveResearchMethodSelection } from "@/lib/lastRunStore";
import { compileNativeMethodProfile, parseStudyMethodProfileLibrary, type NotificationCallbackGroupRecord, type StudyMethodProfile } from "@/lib/methodProfiles";

const library = lazyPrivateCorpusJson<{ profiles: StudyMethodProfile[] }>("ontology-sublation-20260831/adjudicated-method-profile-library.json");
const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../e2e/fixtures/notification-callback-example.json.fixture"), "utf8")) as { notification_callback_groups: NotificationCallbackGroupRecord[] };
const profile = () => library().profiles.find((p) => p.source_work_id === fixture.notification_callback_groups[0]!.source_work_id)!;
const input = () => ({ profiles: [structuredClone(profile())], ...structuredClone(fixture) });

itWithPrivateCorpus("rejects malformed callback collections and values at their exact supplied field", () => {
  const mutations: Array<[(source: ReturnType<typeof input>) => void, string]> = [
    [s => Reflect.set(s, "notification_callback_groups", {}), "method_profile_library.notification_callback_groups"],
    [s => Reflect.set(s, "notification_callback_groups", [null]), "notification_callback_groups[0]"],
    [s => Reflect.set(s.notification_callback_groups[0]!, "history_record_origin", "unknown"), "notification_callback_groups[0].history_record_origin"],
    [s => Reflect.set(s.notification_callback_groups[0]!, "notification_evidence", {}), "notification_callback_groups[0].notification_evidence"],
    [s => Reflect.set(s.notification_callback_groups[0]!, "notification_evidence", [null]), "notification_evidence[0]"],
    [s => Reflect.set(s.notification_callback_groups[0]!.notification_evidence[0]!, "evidence_instant", 3), "notification_evidence[0].evidence_instant"],
    [s => Reflect.set(s.notification_callback_groups[0]!.notification_evidence[0]!, "evidence_references", {}), "notification_evidence[0].evidence_references"],
    [s => Reflect.set(s.notification_callback_groups[0]!.notification_evidence[0]!, "evidence_basis", 3), "notification_evidence[0].evidence_basis"],
  ];
  for (const [mutate, path] of mutations) {
    const source = input(); mutate(source);
    expect(() => parseStudyMethodProfileLibrary(source), path).toThrow(path);
  }
});

async function roundTrip(source: ReturnType<typeof input>) {
  const parsed = parseStudyMethodProfileLibrary(source);
  expect(parsed.profiles).toEqual(source.profiles);
  expect(parsed.notification_callback_groups).toEqual(source.notification_callback_groups);
  await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], notification_callback_groups: parsed.notification_callback_groups }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
  const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], notification_callback_groups: saved.notification_callback_groups });
  expect(restored.profiles).toEqual(source.profiles);
  expect(restored.notification_callback_groups).toEqual(source.notification_callback_groups);
  return restored;
}

itWithPrivateCorpus("preserves independent callbacks and supplied analytic designation without cleaning, item ownership or observed attention", async () => {
  const source = input();
  expect(profile()).toBeDefined();
  const restored = await roundTrip(source);
  const group = restored.notification_callback_groups![0]!;
  expect(group.notification_evidence).toHaveLength(2);
  expect(group.notification_evidence[0]!.evidence_instant).toBe(group.notification_evidence[1]!.evidence_instant);
  expect(group.notification_evidence[0]!.evidence_value_json).toBe(group.notification_evidence[1]!.evidence_value_json);
  expect(group).not.toHaveProperty("notification_item_id");
  expect(group).not.toHaveProperty("observed_perception");
  expect(group.analytic_alert_proxy_reference).toBe("callback-b");
  expect(compileNativeMethodProfile(restored.profiles[0]!).ok).toBe(false);
  const selectionOnly = input();
  selectionOnly.notification_callback_groups[0]!.analytic_alert_proxy_reference = "callback-a";
  const firstSelected = (await roundTrip(selectionOnly)).notification_callback_groups![0]!;
  expect(firstSelected.notification_evidence).toEqual(group.notification_evidence);
  expect(firstSelected.analytic_alert_proxy_reference).toBe("callback-a");
  const variant = input();
  variant.notification_callback_groups[0]!.notification_evidence.reverse();
  variant.notification_callback_groups[0]!.analytic_alert_proxy_reference = "callback-a";
  const changed = (await roundTrip(variant)).notification_callback_groups![0]!;
  expect(changed.notification_evidence).toEqual([...group.notification_evidence].reverse());
  expect(changed.analytic_alert_proxy_reference).toBe("callback-a");
  const noDesignation = input();
  delete noDesignation.notification_callback_groups[0]!.analytic_alert_proxy_reference;
  const unselected = (await roundTrip(noDesignation)).notification_callback_groups![0]!;
  expect(unselected.notification_evidence).toEqual(group.notification_evidence);
  expect(unselected).not.toHaveProperty("analytic_alert_proxy_reference");
  // Adversarial supplied values are not claimed as the paper's cleaned output.
  const titleFilter = input();
  titleFilter.notification_callback_groups[0]!.notification_evidence[0]!.evidence_value_json = '{"example_title":"two unread messages"}';
  await roundTrip(titleFilter);
});

itWithPrivateCorpus("preserves nulls, omissions, empty membership and lexical tokens without substituting defaults", async () => {
  for (const field of ["analytic_alert_proxy_reference", "device_id"] as const) {
    for (const value of [undefined, null]) {
      const source = input();
      Reflect.set(source.notification_callback_groups[0]!, field, value);
      if (value === undefined) Reflect.deleteProperty(source.notification_callback_groups[0]!, field);
      await roundTrip(source);
    }
  }
  for (const field of ["evidence_instant", "evidence_value_json", "evidence_unit", "evidence_basis", "evidence_references"] as const) {
    for (const value of [undefined, null]) {
      const source = input();
      Reflect.set(source.notification_callback_groups[0]!.notification_evidence[0]!, field, value);
      if (value === undefined) Reflect.deleteProperty(source.notification_callback_groups[0]!.notification_evidence[0]!, field);
      await roundTrip(source);
    }
  }
  for (const value of ["false", "0", "null", '"false"', "{}", "[]"]) {
    const source = input();
    source.notification_callback_groups[0]!.notification_evidence[0]!.evidence_value_json = value;
    await roundTrip(source);
  }
  const empty = input();
  empty.notification_callback_groups[0]!.notification_evidence = [];
  delete empty.notification_callback_groups[0]!.analytic_alert_proxy_reference;
  await roundTrip(empty);
  expect(parseStudyMethodProfileLibrary({ profiles: [profile()], notification_callback_groups: [] }).notification_callback_groups).toEqual([]);
  expect(parseStudyMethodProfileLibrary({ profiles: [profile()] })).not.toHaveProperty("notification_callback_groups");
});

itWithPrivateCorpus("rejects fabricated owners, unrelated evidence, duplicate identities and non-local references", async () => {
  const before = await roundTrip(input());
  const prior = await loadResearchMethodSelection();
  const mutations: Array<[(source: ReturnType<typeof input>) => void, string]> = [
    [(s) => { s.notification_callback_groups[0]!.source_work_id = "foreign"; }, "profile/source owner"],
    [(s) => { Reflect.deleteProperty(s.notification_callback_groups[0]!, "callback_group_id"); }, "callback_group_id"],
    [(s) => { s.notification_callback_groups.push(structuredClone(s.notification_callback_groups[0]!)); }, "duplicated within profile/participant/device"],
    [(s) => { s.notification_callback_groups[0]!.notification_evidence.push(structuredClone(s.notification_callback_groups[0]!.notification_evidence[0]!)); }, "duplicated within callback group"],
    [(s) => { s.notification_callback_groups[0]!.analytic_alert_proxy_reference = "foreign-member"; }, "matching posted member"],
    [(s) => { Reflect.set(s.notification_callback_groups[0]!, "analytic_alert_proxy_reference", []); }, "matching posted member"],
    [(s) => { s.notification_callback_groups[0]!.notification_evidence[0]!.evidence_references = ["foreign-member"]; }, "references within callback group"],
    [(s) => { s.notification_callback_groups[0]!.notification_evidence[0]!.evidence_references = ["callback-a"]; }, "references within callback group"],
    [(s) => { s.notification_callback_groups[0]!.notification_evidence[0]!.evidence_references = ["callback-b", "callback-b"]; }, "references within callback group"],
    [(s) => { s.notification_callback_groups[0]!.notification_evidence[0]!.evidence_kind = "removal"; }, "recorded posted_callback"],
    [(s) => { s.notification_callback_groups[0]!.notification_evidence[0]!.evidence_role = "inferred"; }, "recorded posted_callback"],
    [(s) => { Reflect.set(s.notification_callback_groups[0]!.notification_evidence[0]!, "opening_occurrence_reference", null); }, "unknown field"],
    [(s) => { s.notification_callback_groups[0]!.notification_evidence[0]!.evidence_value_json = "invalid"; }, "valid JSON"],
    [(s) => { s.notification_callback_groups[0]!.source_locators = []; }, "source_locators"],
    [(s) => { Reflect.set(s.notification_callback_groups[0]!, "notification_item_id", "fabricated-item"); }, "unknown field"],
    [(s) => { s.notification_callback_groups[0]!.device_id = " "; }, "non-empty string"],
  ];
  for (const [mutate, message] of mutations) {
    const source = input(); mutate(source);
    expect(() => parseStudyMethodProfileLibrary(source)).toThrow(message);
    expect(await loadResearchMethodSelection()).toBe(prior);
  }
  const group = before.notification_callback_groups![0]!;
  const itemHistory = { ...group, notification_history_id: "item", notification_item_id: "item" };
  Reflect.deleteProperty(itemHistory, "callback_group_id");
  delete itemHistory.analytic_alert_proxy_reference;
  expect(() => parseStudyMethodProfileLibrary({ profiles: [profile()], notification_histories: [itemHistory] })).toThrow("requires a callback-group owner");
  Reflect.deleteProperty(itemHistory, "notification_item_id");
  expect(() => parseStudyMethodProfileLibrary({ profiles: [profile()], notification_histories: [itemHistory] })).toThrow("notification_item_id");
});

itWithPrivateCorpus("composes with existing item histories while keeping references local to each owner and supplied group", async () => {
  const source = input();
  const second = structuredClone(source.notification_callback_groups[0]!);
  second.participant_id = "other-participant";
  second.device_id = "other-device";
  second.notification_evidence[0]!.evidence_record_id = "second-only";
  second.analytic_alert_proxy_reference = "second-only";
  source.notification_callback_groups.push(second);
  await roundTrip(source);
  source.notification_callback_groups[0]!.analytic_alert_proxy_reference = "second-only";
  expect(() => parseStudyMethodProfileLibrary(source)).toThrow("matching posted member within callback group");
  const sameScope = input();
  const otherGroup = structuredClone(second);
  otherGroup.callback_group_id = "other-group";
  otherGroup.participant_id = sameScope.notification_callback_groups[0]!.participant_id;
  otherGroup.device_id = sameScope.notification_callback_groups[0]!.device_id;
  sameScope.notification_callback_groups.push(otherGroup);
  await roundTrip(sameScope);
  sameScope.notification_callback_groups[0]!.analytic_alert_proxy_reference = "second-only";
  expect(() => parseStudyMethodProfileLibrary(sameScope)).toThrow("matching posted member within callback group");
  sameScope.notification_callback_groups[0]!.analytic_alert_proxy_reference = "callback-b";
  sameScope.notification_callback_groups[0]!.notification_evidence[0]!.evidence_references = ["second-only"];
  expect(() => parseStudyMethodProfileLibrary(sameScope)).toThrow("references within callback group");
  const base = input();
  base.notification_callback_groups[0]!.notification_evidence[0]!.evidence_references = ["callback-b"];
  const history = { notification_history_id: "item-history", notification_item_id: "item", method_profile_id: profile().method_profile_id,
    source_work_id: profile().source_work_id, participant_id: "example:participant", history_record_origin: "analyst_constructed_example",
    notification_evidence: [{ evidence_record_id: "callback-b", evidence_kind: "arrival", evidence_role: "recorded", source_locators: base.notification_callback_groups[0]!.source_locators }],
    source_locators: base.notification_callback_groups[0]!.source_locators };
  const combined = { ...base, notification_histories: [history] };
  const parsed = parseStudyMethodProfileLibrary(combined);
  expect(parsed.notification_histories).toEqual(combined.notification_histories);
  expect(parsed.notification_callback_groups).toEqual(combined.notification_callback_groups);
  await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], notification_callback_groups: parsed.notification_callback_groups, notification_histories: parsed.notification_histories }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
  expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], notification_histories: saved.notification_histories, notification_callback_groups: saved.notification_callback_groups })).toEqual(parsed);
  history.notification_evidence[0]!.evidence_record_id = "item-history-only";
  base.notification_callback_groups[0]!.notification_evidence[0]!.evidence_references = ["item-history-only"];
  expect(() => parseStudyMethodProfileLibrary({ ...base, notification_histories: [history] })).toThrow("references within callback group");
});
