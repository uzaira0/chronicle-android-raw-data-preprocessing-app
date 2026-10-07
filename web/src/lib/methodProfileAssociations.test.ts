import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { lazyPrivateCorpusJson, privateCorpusPath } from "@/testSupport/privateCorpus";
import { loadResearchMethodSelection, saveResearchMethodSelection } from "@/lib/lastRunStore";
import { compileNativeMethodProfile, parseStudyMethodProfileLibrary, type SessionAssociationDatabaseRecord, type StudyMethodProfile, type TaskOccurrenceRecord } from "@/lib/methodProfiles";

const library = lazyPrivateCorpusJson<{ profiles: StudyMethodProfile[] }>("ontology-sublation-20260831/adjudicated-method-profile-library.json");
const baseline = () => {
  const records = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../e2e/fixtures/habitual-association-example.json.fixture"), "utf8")) as { session_association_databases: SessionAssociationDatabaseRecord[]; task_occurrences: TaskOccurrenceRecord[] };
  return { profiles: [library().profiles.find((p) => p.source_work_id === "doi:10.1145/3447991")!], ...records };
};
const input = () => structuredClone(baseline());

itWithPrivateCorpus("rejects malformed association collections at their exact supplied field", () => {
  const mutations: Array<[(source: ReturnType<typeof input>) => void, string]> = [
    [s => Reflect.set(s.session_association_databases[0]!, "record_origin", "unknown"), "session_association_databases[0].record_origin"],
    [s => Reflect.set(s.session_association_databases[1]!, "session_transactions", {}), "session_association_databases[1].session_transactions"],
    [s => Reflect.set(s.session_association_databases[1]!, "session_transactions", [null]), "session_association_databases[1].session_transactions[0]"],
    [s => Reflect.set(s.session_association_databases[0]!, "association_rules", {}), "session_association_databases[0].association_rules"],
    [s => Reflect.set(s.session_association_databases[0]!, "association_rules", [null]), "session_association_databases[0].association_rules[0]"],
    [s => Reflect.set(s.session_association_databases[0]!.association_rules![0]!, "rule_quality_values_json", 3), "association_rules[0].rule_quality_values_json"],
    [s => Reflect.set(s.session_association_databases[0]!.association_rules![0]!, "antecedent_app_items", {}), "association_rules[0].antecedent_app_items"],
    [s => Reflect.set(s.session_association_databases[0]!.association_rules![0]!, "antecedent_app_items", [" "]), "association_rules[0].antecedent_app_items[0]"],
    [s => Reflect.set(s.session_association_databases[0]!.association_rules![0]!, "antecedent_context_items", [null]), "association_rules[0].antecedent_context_items[0]"],
  ];
  for (const [mutate, path] of mutations) {
    const source = input(); mutate(source);
    expect(() => parseStudyMethodProfileLibrary(source), path).toThrow(path);
  }
});

async function roundTrip(source: ReturnType<typeof input>) {
  const parsed = parseStudyMethodProfileLibrary(source);
  expect(parsed.profiles).toEqual(source.profiles);
  expect(parsed.session_association_databases).toEqual(source.session_association_databases);
  expect(parsed.task_occurrences).toEqual(source.task_occurrences);
  await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], session_association_databases: parsed.session_association_databases, task_occurrences: parsed.task_occurrences }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
  const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], session_association_databases: saved.session_association_databases, task_occurrences: saved.task_occurrences });
  expect(restored.profiles).toEqual(source.profiles);
  expect(restored.session_association_databases).toEqual(source.session_association_databases);
  expect(restored.task_occurrences).toEqual(source.task_occurrences);
  return restored;
}

itWithPrivateCorpus("round-trips source-located rule/database ownership and explicit transaction values without mining", async () => {
  const source = input();
  const restored = await roundTrip(source);
  expect(compileNativeMethodProfile(restored.profiles[0]!).ok).toBe(false);
  const rule = restored.session_association_databases![0]!.association_rules![0]!;
  expect(rule.rule_quality_values_json).toBe('{"Lift":"1.31","Supp":"0.10","Conf":"0.38"}');
  expect(restored.session_association_databases![0]).not.toHaveProperty("session_transactions");
  expect(restored.session_association_databases![1]).not.toHaveProperty("association_group_label");
  expect(restored.session_association_databases![1]).not.toHaveProperty("association_rules");
  const reverse = input();
  const r = reverse.session_association_databases[0]!.association_rules![0]!;
  [r.antecedent_app_items, r.consequent_app_items] = [r.consequent_app_items, r.antecedent_app_items];
  expect([...r.antecedent_app_items!, ...r.consequent_app_items!].sort()).toEqual([...rule.antecedent_app_items!, ...rule.consequent_app_items!].sort());
  expect((await roundTrip(reverse)).session_association_databases![0]!.association_rules).not.toEqual(restored.session_association_databases![0]!.association_rules);
  const regroup = input();
  regroup.session_association_databases[0]!.grouping_setting_reference = "method-setting-06f7db776c62347d848272ff";
  expect((await roundTrip(regroup)).session_association_databases).not.toEqual(restored.session_association_databases);
});

itWithPrivateCorpus("preserves null/omitted/empty, lexical values, item dimensions and repeated IDs across owners/runs", async () => {
  for (const field of ["session_transactions", "association_rules"] as const) {
    for (const value of [undefined, null, []]) {
      const source = input();
      Reflect.set(source.session_association_databases[0]!, field, value);
      if (value === undefined) Reflect.deleteProperty(source.session_association_databases[0]!, field);
      await roundTrip(source);
    }
  }
  for (const field of ["association_group_label", "grouping_setting_reference", "transaction_definition_setting_reference", "device_id"] as const) {
    for (const value of [undefined, null]) {
      const source = input();
      Reflect.set(source.session_association_databases[0]!, field, value);
      if (value === undefined) Reflect.deleteProperty(source.session_association_databases[0]!, field);
      await roundTrip(source);
    }
  }
  for (const field of ["antecedent_app_items", "consequent_app_items", "antecedent_context_items", "consequent_context_items"] as const) {
    for (const value of [undefined, null, []]) {
      const source = input();
      Reflect.set(source.session_association_databases[0]!.association_rules![0]!, field, value);
      if (value === undefined) Reflect.deleteProperty(source.session_association_databases[0]!.association_rules![0]!, field);
      await roundTrip(source);
    }
  }
  for (const field of ["present_app_items", "absent_app_items", "present_context_items", "absent_context_items"] as const) {
    for (const value of [undefined, null, []]) {
      const source = input();
      Reflect.set(source.session_association_databases[1]!.session_transactions![0]!, field, value);
      if (value === undefined) Reflect.deleteProperty(source.session_association_databases[1]!.session_transactions![0]!, field);
      await roundTrip(source);
    }
  }
  for (const value of [undefined, null, "null", " 0.00 ", '{"support":false,"denominator":null}']) {
    const source = input();
    const rule = source.session_association_databases[0]!.association_rules![0]!;
    for (const field of ["rule_quality_values_json", "rule_annotation_json"]) {
      Reflect.set(rule, field, value);
      if (value === undefined) Reflect.deleteProperty(rule, field);
    }
    await roundTrip(source);
  }
  const source = input();
  const transaction = source.session_association_databases[1]!.session_transactions![0]!;
  transaction.denotes_interval = { start_instant: "opaque", end_instant: "opaque", duration_seconds: 0, start_status: null };
  transaction.present_app_items!.reverse();
  transaction.present_context_items!.reverse();
  transaction.present_context_items!.push({ context_item_label: "Home", context_dimension: "Other supplied dimension" });
  transaction.present_app_items!.push("Home"); // App item is not the location item.
  source.session_association_databases[1]!.transaction_definition_setting_reference = "method-setting-9805a724d4a05eb86dbcfa88";
  const again = structuredClone(source.session_association_databases[0]!);
  again.analysis_run_id = "example:other-run";
  source.session_association_databases.push(again);
  await roundTrip(source);
  for (const value of [undefined, null]) {
    const variant = input();
    const context = variant.session_association_databases[1]!.session_transactions![0]!.present_context_items![0]!;
    context.context_dimension = value;
    if (value === undefined) delete context.context_dimension;
    delete variant.session_association_databases[1]!.session_transactions![0]!.denotes_interval;
    await roundTrip(variant);
  }
});

itWithPrivateCorpus("rejects contradictory memberships, duplicates, wrong definitions and unknown fields without storage mutation", async () => {
  const source = input();
  await roundTrip(source);
  const before = await loadResearchMethodSelection();
  const mutants: Array<(x: ReturnType<typeof input>) => void> = [
    (x) => Reflect.set(x, "session_association_databases", null),
    (x) => { x.session_association_databases[0]!.source_work_id = "foreign"; },
    (x) => { x.session_association_databases[0]!.participant_id = " "; },
    (x) => { x.session_association_databases[0]!.analysis_run_id = ""; },
    (x) => { x.session_association_databases.push(structuredClone(x.session_association_databases[0]!)); },
    (x) => { x.session_association_databases[0]!.grouping_setting_reference = "method-setting-e0707126b5cfee91026ef560"; },
    (x) => { x.session_association_databases[1]!.transaction_definition_setting_reference = "method-setting-cdcf68eedc87d23a6e4198d7"; },
    (x) => { x.session_association_databases[0]!.association_rules![0]!.rule_quality_values_json = "NaN"; },
    (x) => { x.session_association_databases[0]!.association_rules!.push(structuredClone(x.session_association_databases[0]!.association_rules![0]!)); },
    (x) => { x.session_association_databases[0]!.association_rules![0]!.antecedent_app_items = ["WhatsApp", "WhatsApp"]; },
    (x) => Reflect.set(x.session_association_databases[0]!.association_rules![0]!, "ordered_app_chain", ["WhatsApp", "Instagram"]),
    (x) => { x.session_association_databases[1]!.session_transactions![0]!.absent_app_items!.push("Facebook"); },
    (x) => { x.session_association_databases[1]!.session_transactions![0]!.absent_context_items!.push({ context_dimension: "Location", context_item_label: "Home" }); },
    (x) => { x.session_association_databases[1]!.session_transactions![0]!.present_context_items!.push({ context_dimension: "Location", context_item_label: "Home" }); },
    (x) => { x.session_association_databases[1]!.session_transactions![0]!.source_session_id = " "; },
    (x) => { x.session_association_databases[1]!.session_transactions!.push(structuredClone(x.session_association_databases[1]!.session_transactions![0]!)); },
    (x) => Reflect.set(x.session_association_databases[1]!.session_transactions![0]!.present_context_items![0]!, "inferred_sensor_code", 1),
    (x) => { x.session_association_databases[1]!.source_locators = []; },
    (x) => { const s = x.profiles[0]!.method_settings.find((s) => s.method_setting_id === "method-setting-cdcf68eedc87d23a6e4198d7")!; s.method_value_json = JSON.stringify({ definition: "unrelated statistical analysis" }); },
  ];
  for (const [i, mutate] of mutants.entries()) {
    const invalid = input();
    mutate(invalid);
    expect(() => parseStudyMethodProfileLibrary(invalid), `association mutation ${i}`).toThrow();
  }
  expect(await loadResearchMethodSelection()).toBe(before);
});

itWithPrivateCorpus("keeps two habit workflows, repeated reminders, nonactivation, per-habit ratings and final feedback distinct", async () => {
  const source = input();
  const restored = await roundTrip(source);
  const tasks = restored.task_occurrences!;
  expect(tasks).toHaveLength(8);
  const [first, second, cancelled, closed, historicalA, historicalB, debrief, feedback] = tasks;
  expect(first!.task_actions!.map(a => a.task_action_id)).toEqual(["notice", "avoid", "motivation", "intention", "reminder-1", "reminder-2"]);
  expect(second!.task_actions!.map(a => a.task_action_id)).toEqual(["notice", "avoid", "motivation", "intention", "disable"]);
  expect(first!.task_actions![3]!.action_content_json).toEqual(second!.task_actions![3]!.action_content_json);
  expect(first!.task_actions![2]!.action_content_json).not.toEqual(second!.task_actions![2]!.action_content_json);
  expect(cancelled!.task_actions!.map(a => a.action_label)).toEqual(["Socialize outbound habit notice", "Cancel"]);
  expect(closed!.task_actions!.map(a => a.action_label)).toEqual(["Socialize outbound habit notice", "Close app"]);
  expect(historicalA!.participant_id).toEqual(historicalB!.participant_id);
  expect(historicalA!.participant_id).not.toEqual(first!.participant_id);
  expect(historicalA!.task_questionnaire_responses).toHaveLength(4);
  expect(historicalB!.task_questionnaire_responses).toHaveLength(4);
  expect(debrief!.task_questionnaire_responses).toHaveLength(1);
  expect(feedback!.task_questionnaire_responses).toHaveLength(3);
  expect(feedback!.participant_id).toEqual(first!.participant_id);
  expect(feedback).not.toHaveProperty("task_actions");
  expect(restored.session_association_databases![1]!.session_transactions![0]!.present_context_items![0]).toEqual({ context_dimension: "Notification", context_item_label: "Received" });
  for (const index of [2, 3, 4]) {
    const variant = input();
    variant.task_occurrences[0]!.task_actions![index]!.action_content_json = '"Independent supplied edit"';
    const result = await roundTrip(variant);
    expect(result.task_occurrences![1]).toEqual(second);
    expect(result.task_occurrences![0]).not.toEqual(first);
    expect(result.session_association_databases).toEqual(source.session_association_databases);
  }
  for (const field of ["task_actions", "task_questionnaire_responses"] as const) {
    for (const value of [undefined, null, []]) {
      const variant = input();
      const task = variant.task_occurrences[field === "task_actions" ? 0 : 4]!;
      Reflect.set(task, field, value);
      if (value === undefined) Reflect.deleteProperty(task, field);
      await roundTrip(variant);
    }
  }
  for (const value of [undefined, null, "null", " 0.00 ", '""']) {
    const variant = input();
    const response = variant.task_occurrences[4]!.task_questionnaire_responses![0]!;
    response.response_value_json = value;
    if (value === undefined) delete response.response_value_json;
    await roundTrip(variant);
  }
});

itWithPrivateCorpus("rejects incompatible Habitual questionnaire definitions and foreign or duplicated ownership without overwriting storage", async () => {
  await roundTrip(input());
  const before = await loadResearchMethodSelection();
  for (const key of ["historical.interview_measures", "socialize.feedback"]) {
    const mutations: Array<(body: Record<string, unknown>) => void> = [
      body => { body.source_facing_role = "participant_schema"; (body.definition as Record<string, unknown>).scale_endpoints = [{ value: 1, label: "x" }, { value: 5, label: "y" }]; },
      body => { body.definition = null; },
      body => { body.source_facing_role = "reported_result"; },
      body => { body.source_facing_target = "outcome"; },
      body => { delete body.definition; },
      body => { body.definition = { points: 7, mean: 4 }; },
      body => { const definition = body.definition as Record<string, unknown>; if (key === "historical.interview_measures") definition.endpoint_values = [0, 6]; else definition.not_repeated_diary = false; },
      body => { const definition = body.definition as Record<string, unknown>; if (key === "historical.interview_measures") (definition.questions as string[][])[2]!.splice(2, 2, "very positive", "very negative at all"); else (definition.appropriateness as Record<string, unknown>).endpoints = ["very appropriate", "not appropriate at all"]; },
      body => { const definition = body.definition as Record<string, unknown>; if (key === "historical.interview_measures") (definition.questions as string[][])[0]![1] = "A different question"; else definition.constructs = ["unrelated construct"]; },
    ];
    for (const mutate of mutations) {
      const invalid = input();
      const setting = invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
      const body = JSON.parse(String(setting.method_value_json)) as Record<string, unknown>;
      mutate(body);
      setting.method_value_json = JSON.stringify(body);
      expect(() => parseStudyMethodProfileLibrary(invalid), key).toThrow(/compatible response-scale/);
    }
    for (const field of ["method_setting_role", "method_target_layer"]) {
      const invalid = input();
      Reflect.set(invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!, field, field === "method_setting_role" ? "reporting" : "outcome");
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
    }
  }
  for (const mutate of [
    (x: ReturnType<typeof input>) => { x.task_occurrences[0]!.source_work_id = "foreign"; },
    (x: ReturnType<typeof input>) => { x.task_occurrences[0]!.task_actions!.push(structuredClone(x.task_occurrences[0]!.task_actions![0]!)); },
    (x: ReturnType<typeof input>) => { x.task_occurrences[4]!.task_questionnaire_responses![0]!.questionnaire_setting_reference = "method-setting-0df9d9d63d833d118ea93fff"; },
    (x: ReturnType<typeof input>) => { x.task_occurrences[4]!.task_questionnaire_responses!.push(structuredClone(x.task_occurrences[4]!.task_questionnaire_responses![0]!)); },
  ]) {
    const invalid = input();
    mutate(invalid);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
  expect(await loadResearchMethodSelection()).toBe(before);
});

itWithPrivateCorpus("composes all canonical definitions with task and association records without changing either family", () => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const tasks = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../e2e/fixtures/s-adl-task-example.json.fixture"), "utf8")) as Record<string, unknown>;
  const source = { ...library, ...input(), profiles: library.profiles, task_occurrences: [...tasks.task_occurrences as TaskOccurrenceRecord[], ...input().task_occurrences] };
  const parsed = parseStudyMethodProfileLibrary(source);
  expect(parsed.profiles).toEqual(library.profiles);
  expect(parsed.task_occurrences).toEqual(source.task_occurrences);
  expect(parsed.session_association_databases).toEqual(source.session_association_databases);
});
