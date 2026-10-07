import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { privateCorpusAvailable, privateCorpusPath } from "@/testSupport/privateCorpus";
import { loadResearchMethodSelection, saveResearchMethodSelection } from "./lastRunStore";
import { parseStudyMethodProfileLibrary, type StudyMethodProfile, type TaskOccurrenceRecord, type ParticipantDayObservationRecord, type SampledQuantityObservationRecord, type ScreenTextCaptureRecord } from "./methodProfiles";

const sources = ["doi:10.1145/3544793.3563411", "doi:10.3758/s13428-024-02474-5"];
const input = (work: string) => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const rows = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../e2e/fixtures/assessment-window-examples.json.fixture"), "utf8")) as { task_occurrences: TaskOccurrenceRecord[] };
  return { profiles: [library.profiles.find(p => p.source_work_id === work)!], task_occurrences: rows.task_occurrences.filter(r => r.source_work_id === work) };
};

const roundtripTasks = async (value: ReturnType<typeof input>) => {
  const parsed = parseStudyMethodProfileLibrary(value);
  await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], task_occurrences: parsed.task_occurrences }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile; task_occurrences: TaskOccurrenceRecord[] };
  const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], task_occurrences: saved.task_occurrences });
  expect(restored.profiles).toEqual(value.profiles);
  expect(restored.task_occurrences).toEqual(value.task_occurrences);
  return restored;
};

const cognitiveWork = "doi:10.1145/2971648.2971712";
itWithPrivateCorpus.each([
  ["assessment.ema_item_inventory", "answer"], ["pvt.session_median_paper", "criterion"],
  ["pvt.participant_mean_baseline_paper", "criterion"], ["pvt.rrt_formula_paper", "criterion"],
  ["assessment.probe_interval_censor", "window"],
])("admits Cognitive Rhythms %s independently with exact qualified ownership", (key, kind) => {
  const source = input(cognitiveWork), row = source.task_occurrences[0]!;
  const original = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  const ref = original.method_setting_id;
  const answer = row.task_questionnaire_responses?.find(r => r.questionnaire_setting_reference === ref);
  const criterion = row.criterion_assessments?.find(r => r.criterion_setting_reference === ref);
  const window = row.task_observation_windows?.find(r => r.window_setting_references.includes(ref));
  delete row.task_questionnaire_responses; delete row.criterion_assessments; delete row.task_observation_windows;
  if (kind === "answer") row.task_questionnaire_responses = [structuredClone(answer!)];
  else if (kind === "criterion") {
    row.criterion_assessments = [structuredClone(criterion!)];
    delete row.criterion_assessments[0]!.support_criterion_assessment_references;
  } else row.task_observation_windows = [structuredClone(window!)];
  source.task_occurrences = [row];
  const setting = (value: typeof source) => value.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!;
  expect(parseStudyMethodProfileLibrary(source).task_occurrences).toEqual(source.task_occurrences);
  const qualified = JSON.parse(String(original.method_value_json)) as Record<string, unknown>, body = qualified.definition;
  for (const content of [body, { definition: body, source_facing_role: original.method_setting_role, source_facing_target: original.method_target_layer }]) {
    const valid = structuredClone(source); setting(valid).method_value_json = JSON.stringify(content);
    expect(parseStudyMethodProfileLibrary(valid).task_occurrences).toEqual(source.task_occurrences);
  }
  for (const content of [
    { ...qualified, definition: null }, { ...qualified, definition: {} },
    { ...qualified, definition: { ...(body as Record<string, unknown>), invented_field: true } },
    { ...qualified, source_interpretation_limits: "" },
    { ...qualified, source_facing_role: null }, { ...qualified, source_facing_role: "provenance" },
    { ...qualified, source_facing_target: null }, { ...qualified, source_facing_target: "raw_record" },
  ]) {
    const invalid = structuredClone(source); setting(invalid).method_value_json = JSON.stringify(content);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/compatible .*definition/);
  }
  for (const [field, value] of [["method_setting_role", "provenance"], ["method_target_layer", "raw_record"]]) {
    const invalid = structuredClone(source); Reflect.set(setting(invalid), field!, value);
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/compatible .*definition/);
  }
  const foreign = structuredClone(source);
  foreign.profiles[0]!.source_work_id = "doi:10.1145/2935334.2935383";
  foreign.task_occurrences[0]!.source_work_id = foreign.profiles[0]!.source_work_id;
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow(/compatible .*definition/);
});

itWithPrivateCorpus("preserves Cognitive Rhythms complete/partial batteries and rejects PVT-only censoring without replacing storage", async () => {
  const source = input(cognitiveWork), expected = structuredClone(source.task_occurrences);
  const [complete, partial] = (await roundtripTasks(source)).task_occurrences!;
  expect(complete!.task_questionnaire_responses!.map(r => r.observed_property)).toEqual(["energy", "concentration", "tiredness", "past-hour caffeine", "past-hour exercise", "past-hour nicotine", "past-hour nap", "past-hour alcohol", "past-hour food", "past-hour loafing"]);
  expect(complete!.task_questionnaire_responses![1]!.response_value_json).toBeNull();
  expect(complete!.task_questionnaire_responses![2]!.response_value_json).toBe("null");
  expect(complete!.task_questionnaire_responses!.at(-1)).not.toHaveProperty("response_value_json");
  expect(complete!.task_actions!.map(a => a.assigned_role_labels)).toEqual([["EMA_BEGIN"], ["SUBJECTIVE_ASSESSMENTS"], ["PVT"], ["EMA_COMPLETED"]]);
  expect(complete!.task_actions![2]!.denotes_interval).toEqual({ duration_seconds: 180 });
  expect(complete!.denotes_interval!.duration_seconds).toBe(240);
  expect(complete!.task_observation_windows![0]!.denotes_interval).toEqual(complete!.denotes_interval);
  expect(complete!.task_observation_windows![0]).not.toHaveProperty("quantities");
  expect(complete!.criterion_assessments!.map(a => a.assessment_value_json)).toEqual(["310.00", "400.00", "17.50"]);
  expect(complete!.criterion_assessments![2]!.support_criterion_assessment_references).toEqual(["example:cr-a-mrt", "example:cr-a-baseline"]);
  expect(partial!.task_actions!.map(a => a.assigned_role_labels)).toEqual([["EMA_BEGIN"], ["SUBJECTIVE_ASSESSMENTS"], ["QUIT_BEFORE_PVT"]]);
  for (const field of ["criterion_assessments", "task_observation_windows", "denotes_interval"]) expect(partial).not.toHaveProperty(field);
  for (const change of [
    (v: typeof source) => { v.task_occurrences[0]!.criterion_assessments![0]!.assessment_value_json = "999.00"; },
    (v: typeof source) => { v.task_occurrences[0]!.denotes_interval!.duration_seconds = v.task_occurrences[0]!.task_observation_windows![0]!.denotes_interval!.duration_seconds = 241.5; },
    (v: typeof source) => { delete v.task_occurrences[0]!.task_actions![0]!.assigned_role_labels; },
  ]) {
    const changed = structuredClone(source); change(changed); const result = await roundtripTasks(changed);
    expect(result.task_occurrences![0]!.criterion_assessments!.slice(1)).toEqual(expected[0]!.criterion_assessments!.slice(1));
    expect(result.task_occurrences![1]).toEqual(expected[1]);
  }
  await roundtripTasks(source); const retained = await loadResearchMethodSelection();
  for (const mutate of [
    (v: typeof source) => { v.task_occurrences[0]!.task_observation_windows![0]!.anchor_task_action_reference = "example:cr-a-pvt"; },
    (v: typeof source) => { v.task_occurrences[0]!.task_observation_windows![0]!.anchor_task_action_reference = "example:cr-b-begin"; },
    (v: typeof source) => { v.task_occurrences[0]!.task_observation_windows![0]!.denotes_interval!.duration_seconds = 180; },
    (v: typeof source) => { v.task_occurrences[0]!.task_observation_windows![0]!.denotes_interval!.start_instant = "example:cr-a-pvt"; },
    (v: typeof source) => { v.task_occurrences[0]!.task_observation_windows![0]!.questionnaire_response_references = ["example:cr-b-energy"]; },
    (v: typeof source) => { v.task_occurrences[0]!.criterion_assessments![0]!.support_task_action_references = ["example:cr-b-subjective"]; },
    (v: typeof source) => { v.task_occurrences[0]!.source_work_id = "foreign"; },
  ]) {
    const invalid = structuredClone(source); mutate(invalid);
    await expect(roundtripTasks(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained);
  }
});

const onlineVigilanceWork = "doi:10.1080/15213269.2020.1768122";
const onlineVigilanceDefinitions = [
  ["measure.salience.mediated.scale", "answer"], ["measure.salience.face_to_face.scale", "answer"],
  ["measure.valence.scale", "answer"], ["reactibility.self_report.scale", "answer"],
  ["monitoring.self_report.scale", "answer"], ["wellbeing.state.items", "answer"],
  ["trait.online_vigilance.instrument", "answer"], ["trait.checking_habit.instrument", "answer"],
  ["trait.affective_wellbeing.instrument", "answer"], ["trait.life_satisfaction.instrument", "answer"],
  ["reactibility.final.definition", "criterion"], ["wellbeing.state.aggregation", "criterion"],
  ["monitoring.final.window", "window"], ["monitoring.final.definition", "window"],
] as const;

const isolatedOnlineVigilanceDefinition = (key: string, kind: "answer" | "criterion" | "window") => {
  const source = input(onlineVigilanceWork);
  const setting = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === key);
  if (!setting) throw new Error(`Missing Online Vigilance definition: ${key}`);
  const reference = setting.method_setting_id;
  const owner = source.task_occurrences.find(task => kind === "answer"
    ? task.task_questionnaire_responses?.some(r => r.questionnaire_setting_reference === reference)
    : kind === "criterion" ? task.criterion_assessments?.some(a => a.criterion_setting_reference === reference)
      : task.task_observation_windows?.some(w => w.window_setting_references.includes(reference)));
  if (!owner) throw new Error(`Missing populated Online Vigilance binding: ${key}`);
  const row = structuredClone(owner);
  delete row.task_questionnaire_responses;
  delete row.criterion_assessments;
  delete row.task_observation_windows;
  if (kind === "answer") row.task_questionnaire_responses = [structuredClone(owner.task_questionnaire_responses!.find(r => r.questionnaire_setting_reference === reference)!)];
  else if (kind === "criterion") row.criterion_assessments = [structuredClone(owner.criterion_assessments!.find(a => a.criterion_setting_reference === reference)!)];
  else {
    row.task_observation_windows = [structuredClone(owner.task_observation_windows!.find(w => w.window_setting_references.includes(reference))!)];
    delete row.task_observation_windows[0]!.questionnaire_response_references;
  }
  source.task_occurrences = [row];
  return source;
};

itWithPrivateCorpus.each(onlineVigilanceDefinitions)("admits Online Vigilance %s independently and rejects malformed definitions", (key, kind) => {
  const source = isolatedOnlineVigilanceDefinition(key, kind);
  expect(parseStudyMethodProfileLibrary(source).task_occurrences).toEqual(source.task_occurrences);
  const index = source.profiles[0]!.method_settings.findIndex(s => s.method_parameter_key === key);
  const original = source.profiles[0]!.method_settings[index]!;
  const body: unknown = JSON.parse(String(original.method_value_json));
  const wrapper = { definition: body, source_facing_role: original.method_setting_role, source_facing_target: original.method_target_layer };
  const wrapped = structuredClone(source);
  wrapped.profiles[0]!.method_settings[index]!.method_value_json = JSON.stringify(wrapper);
  expect(parseStudyMethodProfileLibrary(wrapped).task_occurrences).toEqual(source.task_occurrences);
  for (const content of [
    { ...wrapper, definition: null }, { ...wrapper, definition: 0 }, { ...wrapper, definition: {} },
    { ...wrapper, source_facing_role: "provenance" }, { ...wrapper, source_facing_target: "raw_record" },
  ]) {
    const invalid = structuredClone(source);
    invalid.profiles[0]!.method_settings[index]!.method_value_json = JSON.stringify(content);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/compatible .*definition/);
  }
  for (const [field, value] of [["method_setting_role", "provenance"], ["method_target_layer", "raw_record"]] as const) {
    const invalid = structuredClone(source);
    Reflect.set(invalid.profiles[0]!.method_settings[index]!, field, value);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
});

itWithPrivateCorpus("preserves independent Online Vigilance occasions, behavioral values, seven-item mean and separate intake", async () => {
  const source = input(onlineVigilanceWork);
  const restored = await roundtripTasks(source);
  const [first, second, intake] = restored.task_occurrences!;
  expect(restored.task_occurrences!.map(row => row.task_occurrence_id)).toEqual(["example:ov-survey-a", "example:ov-survey-b", "example:ov-intake"]);
  expect(first!.referenced_day_token).toBe(second!.referenced_day_token);
  for (const [row, suffix] of [[first!, "a"], [second!, "b"]] as const) {
    expect(row.task_actions!.map(action => [action.task_action_id, action.assigned_role_labels])).toEqual([
      [`example:ov-${suffix}-received`, ["RECEIVED"]], [`example:ov-${suffix}-opened`, ["OPENED"]], [`example:ov-${suffix}-answered`, ["ANSWERED"]],
    ]);
    expect(row.task_actions!.every(action => !Object.hasOwn(action, "denotes_interval"))).toBe(true);
    expect(row.task_observation_windows![0]!.anchor_task_action_reference).toBe(`example:ov-${suffix}-opened`);
    expect(row.task_observation_windows![0]!.denotes_interval).toEqual({ duration_seconds: 1800 });
    expect(row.criterion_assessments![0]!.support_task_action_references).toEqual([`example:ov-${suffix}-received`, `example:ov-${suffix}-opened`]);
    expect(row.criterion_assessments![1]!.support_task_action_references).toEqual([`example:ov-${suffix}-answered`]);
  }
  expect(first!.criterion_assessments!.map(a => a.assessment_value_json)).toEqual(["37.50", "5.25"]);
  expect(second!.criterion_assessments!.map(a => a.assessment_value_json)).toEqual(["0.00", "3.75"]);
  expect(first!.task_observation_windows![0]!.quantities).toEqual([{ observed_property: "total social-app use", evidence_unit: "seconds", evidence_value_json: "120.00" }]);
  expect(second!.task_observation_windows![0]!.quantities![0]!.evidence_value_json).toBe("0.00");
  expect(first!.task_questionnaire_responses!.filter(r => r.questionnaire_setting_reference === "method-setting-8ea81613cc11f47fdf5d52fb").map(r => r.questionnaire_item_label)).toEqual(["tired-awake", "depressed-happy"]);
  expect(second!.task_questionnaire_responses!.some(r => r.questionnaire_response_id === "example:ov-b-valence-mediated")).toBe(false);
  expect(second!.task_questionnaire_responses!.find(r => r.questionnaire_response_id === "example:ov-b-salience-mediated")!.response_value_json).toBeNull();
  expect(second!.task_questionnaire_responses!.find(r => r.questionnaire_response_id === "example:ov-b-valence-face")!.response_value_json).toBe("null");
  expect(intake).not.toHaveProperty("task_observation_windows");
  expect(intake).not.toHaveProperty("criterion_assessments");
  const keys = new Map(source.profiles[0]!.method_settings.map(s => [s.method_setting_id, s.method_parameter_key]));
  expect(intake!.task_questionnaire_responses!.map(r => keys.get(r.questionnaire_setting_reference))).toEqual([
    "trait.online_vigilance.instrument", "trait.checking_habit.instrument", "trait.affective_wellbeing.instrument", "trait.life_satisfaction.instrument",
  ]);
  for (const change of [
    (v: typeof source) => { v.task_occurrences[0]!.task_questionnaire_responses!.find(r => r.questionnaire_response_id === "example:ov-a-monitoring")!.response_value_json = "1.00"; },
    (v: typeof source) => { v.task_occurrences[0]!.task_observation_windows![0]!.quantities![0]!.evidence_value_json = "7.00"; },
    (v: typeof source) => { v.task_occurrences[0]!.criterion_assessments![0]!.assessment_value_json = "13.00"; },
    (v: typeof source) => { v.task_occurrences[0]!.criterion_assessments![1]!.assessment_value_json = "4.00"; },
  ]) {
    const changed = structuredClone(source); change(changed);
    const result = await roundtripTasks(changed);
    expect(result.task_occurrences![0]).toEqual(changed.task_occurrences[0]);
    expect(result.task_occurrences!.slice(1)).toEqual(restored.task_occurrences!.slice(1));
  }
  const changedSalience = structuredClone(source);
  changedSalience.task_occurrences[1]!.task_questionnaire_responses!.find(r => r.questionnaire_response_id === "example:ov-b-salience-mediated")!.response_value_json = "7.00";
  const changedResult = await roundtripTasks(changedSalience);
  expect(changedResult.task_occurrences![1]!.task_questionnaire_responses!.some(r => r.questionnaire_response_id === "example:ov-b-valence-mediated")).toBe(false);
  expect(changedResult.task_occurrences![1]!.criterion_assessments).toEqual(second!.criterion_assessments);
  for (let i = 0; i < intake!.task_questionnaire_responses!.length; i++) {
    const changed = structuredClone(source);
    changed.task_occurrences[2]!.task_questionnaire_responses![i]!.response_value_json = ' "independently supplied intake value" ';
    const result = await roundtripTasks(changed);
    expect(result.task_occurrences!.slice(0, 2)).toEqual(restored.task_occurrences!.slice(0, 2));
    expect(result.task_occurrences![2]!.task_questionnaire_responses!.filter((_, j) => j !== i)).toEqual(intake!.task_questionnaire_responses!.filter((_, j) => j !== i));
  }
});

itWithPrivateCorpus("preserves Online Vigilance lexical unknowns and partial support without inventing clocks, valence or roles", async () => {
  const source = input(onlineVigilanceWork);
  for (const token of [undefined, null, "null", "0.00", ' "unknown" ']) {
    const value = structuredClone(source);
    const row = value.task_occurrences[0]!;
    const mood = row.task_questionnaire_responses!.find(r => r.questionnaire_response_id === "example:ov-a-mood-tired")!;
    for (const [record, field] of [[mood, "response_value_json"], [row.criterion_assessments![0]!, "assessment_value_json"], [row.task_observation_windows![0]!.quantities![0]!, "evidence_value_json"]] as const) {
      if (token === undefined) Reflect.deleteProperty(record, field); else Reflect.set(record, field, token);
    }
    const result = await roundtripTasks(value);
    expect(result.task_occurrences![0]!.criterion_assessments![1]!.assessment_value_json).toBe("5.25");
    expect(result.task_occurrences!.slice(1)).toEqual(source.task_occurrences.slice(1));
  }
  for (const roles of [undefined, null, [], ["unclassified supplied role"]]) {
    const value = structuredClone(source);
    const opening = value.task_occurrences[0]!.task_actions!.find(a => a.task_action_id === "example:ov-a-opened")!;
    if (roles === undefined) delete opening.assigned_role_labels; else opening.assigned_role_labels = roles;
    await roundtripTasks(value);
  }
  for (const field of ["evidence_unit", "quantity_qualifier"] as const) for (const token of [undefined, null]) {
    const value = structuredClone(source);
    const quantity = value.task_occurrences[0]!.task_observation_windows![0]!.quantities![0]!;
    if (token === undefined) delete quantity[field]; else quantity[field] = token;
    await roundtripTasks(value);
  }
  for (const field of ["denotes_interval", "quantities", "questionnaire_response_references"] as const) {
    for (const member of [undefined, null, ...(field === "denotes_interval" ? [] : [[]])]) {
      const value = structuredClone(source);
      const window = value.task_occurrences[0]!.task_observation_windows![0]!;
      if (member === undefined) Reflect.deleteProperty(window, field); else Reflect.set(window, field, member);
      await roundtripTasks(value);
    }
  }
  for (const refs of [undefined, null, []]) {
    const value = structuredClone(source);
    for (const assessment of value.task_occurrences[0]!.criterion_assessments!) {
      if (refs === undefined) delete assessment.support_task_action_references; else assessment.support_task_action_references = refs;
    }
    await roundtripTasks(value);
  }
  const reordered = structuredClone(source);
  reordered.task_occurrences.reverse();
  for (const row of reordered.task_occurrences) {
    row.task_actions?.reverse(); row.task_questionnaire_responses?.reverse(); row.criterion_assessments?.reverse();
    for (const window of row.task_observation_windows ?? []) window.window_setting_references.reverse();
  }
  await roundtripTasks(reordered);
});

itWithPrivateCorpus.each(["RECEIVED", "ANSWERED"])("rejects Online Vigilance monitoring anchored to its own known %s action without replacing storage", async role => {
  const source = input(onlineVigilanceWork);
  await roundtripTasks(source);
  const before = await loadResearchMethodSelection();
  const invalid = structuredClone(source);
  const row = invalid.task_occurrences[0]!;
  const wrongLocalAction = row.task_actions!.find(action => action.assigned_role_labels?.includes(role))!;
  row.task_observation_windows![0]!.anchor_task_action_reference = wrongLocalAction.task_action_id;
  expect(row.task_actions!.some(action => action.task_action_id === row.task_observation_windows![0]!.anchor_task_action_reference)).toBe(true);
  await expect(roundtripTasks(invalid)).rejects.toThrow(/survey opening/);
  expect(await loadResearchMethodSelection()).toBe(before);
});

itWithPrivateCorpus("rejects Online Vigilance foreign ownership, support and incompatible window quantities without replacing storage", async () => {
  const source = input(onlineVigilanceWork);
  await roundtripTasks(source);
  const before = await loadResearchMethodSelection();
  const window = (v: typeof source) => v.task_occurrences[0]!.task_observation_windows![0]!;
  for (const change of [
    (v: typeof source) => { v.task_occurrences[0]!.source_work_id = "foreign"; },
    (v: typeof source) => { v.task_occurrences[0]!.method_profile_id = "foreign"; },
    (v: typeof source) => { window(v).anchor_task_action_reference = "example:ov-b-opened"; },
    (v: typeof source) => { window(v).questionnaire_response_references = ["example:ov-b-monitoring"]; },
    (v: typeof source) => { v.task_occurrences[0]!.criterion_assessments![0]!.support_task_action_references = ["example:ov-b-received"]; },
    (v: typeof source) => { v.task_occurrences[0]!.criterion_assessments![1]!.support_task_action_references = ["example:ov-intake-answered"]; },
    (v: typeof source) => { window(v).window_setting_references = ["foreign"]; },
    (v: typeof source) => { window(v).window_setting_references.pop(); },
    (v: typeof source) => { window(v).window_setting_references.push(window(v).window_setting_references[0]!); },
    (v: typeof source) => { window(v).denotes_interval!.duration_seconds = 3600; },
    (v: typeof source) => { window(v).quantities![0]!.evidence_unit = "minutes"; },
    (v: typeof source) => { window(v).quantities![0]!.observed_property = "screen-on duration"; },
    (v: typeof source) => { window(v).quantities![0]!.quantity_qualifier = "WhatsApp"; },
    (v: typeof source) => { v.task_occurrences[0]!.task_observation_windows!.push(structuredClone(window(v))); },
  ]) {
    const invalid = structuredClone(source); change(invalid);
    await expect(roundtripTasks(invalid)).rejects.toThrow();
    expect(await loadResearchMethodSelection()).toBe(before);
  }
});

itWithPrivateCorpus("rejects known Online Vigilance definitions disguised as unrelated participant instruments or criteria", () => {
  for (const [key, kind] of onlineVigilanceDefinitions) {
    const source = isolatedOnlineVigilanceDefinition(key, kind);
    const setting = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
    setting.method_setting_role = "participant_schema";
    setting.method_target_layer = "participant_measure";
    setting.method_value_json = JSON.stringify({ source_facing_role: "participant_schema", source_facing_target: "participant_measure",
      definition: { scale_endpoints: [{ value: 1, label: "decoy low" }, { value: 7, label: "decoy high" }] },
    });
    expect(() => parseStudyMethodProfileLibrary(source)).toThrow(/compatible .*definition/);
    setting.method_setting_role = "acquisition";
    setting.method_value_json = JSON.stringify({ source_facing_role: "task_evaluation", definition: { basis: "decoy", table6: { printed_layout_text: "decoy" } } });
    const row = source.task_occurrences[0]!;
    delete row.task_questionnaire_responses;
    delete row.task_observation_windows;
    row.criterion_assessments = [{ criterion_assessment_id: "decoy", criterion_setting_reference: setting.method_setting_id, criterion_label: "forged criterion", source_locators: ["constructed adversarial input"] }];
    expect(() => parseStudyMethodProfileLibrary(source)).toThrow(/compatible criterion definition/);
  }
  // Two full library parses per definition: ~2 s alone, past the 5 s default
  // under the pre-push coverage run with the suite in parallel.
}, 30_000);

itWithPrivateCorpus("preserves Online Vigilance source meanings without day, foreground, duplicate-prompt or valence-coding inventions", () => {
  const profile = input("doi:10.1080/15213269.2020.1768122").profiles[0]!;
  const setting = (key: string) => profile.method_settings.find(s => s.method_parameter_key === key)!;
  const body = (key: string): unknown => {
    const value: unknown = JSON.parse(String(setting(key).method_value_json));
    return value && typeof value === "object" && "definition" in value ? value.definition : value;
  };
  expect(body("schema.app.foreground_use")).toBe("when an app was used; foreground/background status is not specified");
  expect(body("schema.app.foreground_identity")).toBe("which app was used; foreground/background status is not specified");
  expect(body("measure.salience.mediated.item")).toMatchObject({ setup_explanation: {
    excludes: "face-to-face interactions", scope: "any form of contact with others via smartphone, tablet, laptop, etc.",
    not_limited_to: ["talking", "texting"], includes: ["receiving or providing a like", "receiving or providing a comment"],
  } });
  expect(body("measure.salience.face_to_face.scale")).toEqual({ minimum: 1, maximum: 7,
    same_question_as: "measure.salience.mediated.item",
    scale_basis: "same-question linkage to measure.salience.mediated.scale; endpoint labels are not repeated in the face-to-face passage",
  });
  expect(body("wellbeing.state.items")).toMatchObject({ prompt: "At this moment, I feel", original_mood_dichotomies: 6, added_dichotomy: "depressed-happy", example: "tired-awake" });
  expect(body("protocol.social_apps")).toMatchObject({ label_definitions: { "SMS/Messenger": "built-in Android apps that send and receive SMS (e.g., Messages)" } });
  expect(body("model.interaction.subset")).toEqual({ restriction: "only survey occasions with non-zero salience because thought valence occurred only then", nonzero_salience_numeric_rule: null, absent_valence_encoding: null });
  expect(setting("exploratory.correlation.data").method_target_layer).toBe("derived_feature");
  expect(body("exploratory.correlation.data")).toBe("aggregate every state-level measure per person and combine with trait measures");
  expect(body("cohort.duplicate_prompt_exclusion")).toBe("exclude the participant who received 69 non-duplicate surveys due to technical issues because those data could not be trusted; no reusable survey-count cutoff or duplicate-detection rule stated");
  expect(body("monitoring.original.preceding_condition")).toEqual({
    check_qualification: "unlock-to-lock sequence must not have been preceded by a notification from a social app",
    original_measure: "amount/count of checks before the survey was opened", survey_anchor: "survey opened", count_lookback: null,
    status: "abandoned in favor of final total social-app use time",
  });
});

itWithPrivateCorpus.each(sources.flatMap(work => ["answers", "windows", "summaries"].map(kind => [work, kind])))("accepts %s disclosed %s through the existing task owner", (work, kind) => {
  const source = input(work);
  const row = source.task_occurrences[0]!;
  if (kind === "answers") {
    delete row.task_observation_windows;
    delete row.criterion_assessments;
  } else if (kind === "windows") {
    delete row.criterion_assessments;
    delete row.task_questionnaire_responses;
    for (const window of row.task_observation_windows!) delete window.questionnaire_response_references;
  } else {
    delete row.task_questionnaire_responses;
    delete row.task_observation_windows;
  }
  expect(parseStudyMethodProfileLibrary(source)).toMatchObject(source);
});

itWithPrivateCorpus("preserves Digital Nightlife response-owned windows, app-scope hours and separate calendar absence without inferring timing or scores", async () => {
  const work = "doi:10.1177/00936502241276793";
  const source = { ...input(work), participant_day_observations: (JSON.parse(readFileSync(resolve(import.meta.dirname,
    "../../e2e/fixtures/assessment-window-examples.json.fixture"), "utf8")) as { participant_day_observations: ParticipantDayObservationRecord[] }).participant_day_observations };
  const roundtrip = async (value: typeof source) => {
    const parsed = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], task_occurrences: parsed.task_occurrences, participant_day_observations: parsed.participant_day_observations }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile; task_occurrences: TaskOccurrenceRecord[]; participant_day_observations: ParticipantDayObservationRecord[] };
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], task_occurrences: saved.task_occurrences, participant_day_observations: saved.participant_day_observations });
    expect(restored.profiles).toEqual(value.profiles);
    expect(restored.task_occurrences).toEqual(value.task_occurrences);
    expect(restored.participant_day_observations).toEqual(value.participant_day_observations);
  };
  await roundtrip(source);
  const first = (value: typeof source) => value.task_occurrences[0]!;
  const window = (value: typeof source) => first(value).task_observation_windows![0]!;
  expect(first(source).task_observation_windows).toHaveLength(3);
  expect(source.task_occurrences).toHaveLength(2);
  expect(source.participant_day_observations.map(row => row.day_observation_value_json)).toEqual(["-999", "-999", "-999", "-999"]);
  expect(new Set(source.participant_day_observations.map(row => row.referenced_day_token)).size).toBe(1);
  expect(source.participant_day_observations.every(row => row.day_observation_kind === "objective_aggregate")).toBe(true);
  expect(source.task_occurrences.some(task => task.referenced_day_token === source.participant_day_observations[0]!.referenced_day_token)).toBe(false);
  expect(first(source).task_observation_windows![1]!.quantities![0]!.evidence_value_json).toBe("0.00");
  for (const token of [undefined, null, "null", "0.00", '"unknown"']) {
    const variant = structuredClone(source);
    if (token === undefined) Reflect.deleteProperty(window(variant).quantities![0]!, "evidence_value_json");
    else window(variant).quantities![0]!.evidence_value_json = token;
    await roundtrip(variant);
    expect(first(variant).task_questionnaire_responses).toEqual(first(source).task_questionnaire_responses);
    expect(first(variant).task_observation_windows!.slice(1)).toEqual(first(source).task_observation_windows!.slice(1));
  }
  const changedAnswer = structuredClone(source);
  first(changedAnswer).task_questionnaire_responses![0]!.response_value_json = "7";
  await roundtrip(changedAnswer);
  expect(first(changedAnswer).task_observation_windows).toEqual(first(source).task_observation_windows);
  for (const day of [undefined, null, "example:different-response-day", first(source).referenced_day_token]) {
    const variant = structuredClone(source);
    if (day === undefined) delete first(variant).referenced_day_token;
    else first(variant).referenced_day_token = day;
    // A shared day does not merge separate completions; it is not an interval endpoint.
    variant.task_occurrences[1]!.referenced_day_token = day;
    if (day === undefined) delete variant.task_occurrences[1]!.referenced_day_token;
    await roundtrip(variant);
    expect(first(variant).task_observation_windows).toEqual(first(source).task_observation_windows);
    expect(first(variant).task_actions).toEqual(first(source).task_actions);
  }
  const changedCompletion = structuredClone(source);
  first(changedCompletion).task_actions![0]!.denotes_interval!.start_instant = "different-response-instant";
  await roundtrip(changedCompletion);
  expect(first(changedCompletion).referenced_day_token).toEqual(first(source).referenced_day_token);
  expect(first(changedCompletion).task_observation_windows).toEqual(first(source).task_observation_windows);
  for (const index of [0, 2]) for (const seconds of [0, 30600, 46800]) {
    const variable = structuredClone(source);
    first(variable).task_observation_windows![index]!.denotes_interval!.duration_seconds = seconds;
    await roundtrip(variable); // Supplied variable lengths, never forced to one hour/day.
  }
  for (const field of ["denotes_interval", "quantities", "questionnaire_response_references"] as const) for (const value of [undefined, null, ...(field === "denotes_interval" ? [] : [[]])]) {
    const partial = structuredClone(source);
    if (value === undefined) Reflect.deleteProperty(window(partial), field); else Reflect.set(window(partial), field, value);
    await roundtrip(partial);
  }
  const mutations: Array<(value: typeof source) => void> = [
    v => { first(v).source_work_id = "foreign"; },
    v => { window(v).anchor_task_action_reference = v.task_occurrences[1]!.task_actions![0]!.task_action_id; },
    v => { window(v).questionnaire_response_references = [v.task_occurrences[1]!.task_questionnaire_responses![0]!.questionnaire_response_id]; },
    v => { window(v).window_setting_references = ["foreign"]; },
    v => { window(v).window_setting_references.push(first(v).task_observation_windows![1]!.window_setting_references[0]!); },
    v => { first(v).task_observation_windows![1]!.denotes_interval!.duration_seconds = 86400; },
    v => { window(v).denotes_interval!.duration_seconds = -1; },
    v => { window(v).quantities![0]!.evidence_unit = "seconds"; },
    v => { window(v).quantities![0]!.observed_property = "completion duration"; },
    v => { window(v).quantities![0]!.quantity_qualifier = "foreign app scope"; },
    v => { first(v).task_observation_windows!.push(structuredClone(window(v))); },
    v => { v.participant_day_observations[0]!.source_work_id = "foreign"; },
  ];
  const refs = new Set([...first(source).task_observation_windows!.flatMap(w => w.window_setting_references),
    ...first(source).task_questionnaire_responses!.map(r => r.questionnaire_setting_reference)]);
  for (const day of ["", " ", 0, false, [], {}]) mutations.push(v => { Reflect.set(first(v), "referenced_day_token", day); });
  for (const ref of refs) {
    const setting = source.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!;
    const body: unknown = JSON.parse(String(setting.method_value_json));
    const wrapper = { definition: body, source_facing_role: setting.method_setting_role, source_facing_target: setting.method_target_layer };
    const valid = structuredClone(source);
    valid.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!.method_value_json = JSON.stringify(wrapper);
    await roundtrip(valid);
    for (const field of ["method_setting_role", "method_target_layer"]) mutations.push(v => { Reflect.set(v.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!, field, "foreign"); });
    for (const inner of [null, {}, 0, "invalid definition"]) mutations.push(v => { v.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!.method_value_json = JSON.stringify({ ...wrapper, definition: inner }); });
    for (const field of ["source_facing_role", "source_facing_target"]) mutations.push(v => { v.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!.method_value_json = JSON.stringify({ ...wrapper, [field]: "foreign" }); });
    const disclosed = body as Record<string, unknown>;
    const bodyChanges: Array<(value: Record<string, unknown>) => void> = setting.method_parameter_key === "diary.sleep_quality_item"
      ? [b => { b.instrument = "full PSQI score"; }, ...["min", "midpoint", "max", "min_label", "midpoint_label", "max_label"].flatMap(field => [
        (b: Record<string, unknown>) => { Reflect.deleteProperty(b.scale as object, field); },
        (b: Record<string, unknown>) => { Reflect.set(b.scale as object, field, "wrong"); },
      ])]
      : String(setting.method_parameter_key).startsWith("diary.") ? [b => { b.prompt = "wrong"; }, b => { b.response = "seconds since midnight"; }]
        : [b => { b.start = "response completion"; }, b => { b.end = "response completion"; }];
    for (const change of bodyChanges) mutations.push(v => {
      const invalidBody = structuredClone(disclosed); change(invalidBody);
      v.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!.method_value_json = JSON.stringify(invalidBody);
    });
  }
  await roundtrip(source);
  const retained = await loadResearchMethodSelection();
  for (const mutate of mutations) {
    const invalid = structuredClone(source); mutate(invalid);
    await expect(roundtrip(invalid)).rejects.toThrow();
    expect(await loadResearchMethodSelection()).toEqual(retained);
  }
});

itWithPrivateCorpus.each(sources)("preserves %s independent answers and window variants without inferred totals, periods or units", async work => {
  const source = input(work);
  const roundtrip = roundtripTasks;
  await roundtrip(source);
  for (const token of [undefined, null, "null", "0.00", ' "unknown" ']) {
    const changed = structuredClone(source);
    const row = changed.task_occurrences[0]!;
    row.task_questionnaire_responses![0]!.response_value_json = token;
    row.task_observation_windows![0]!.quantities![0]!.evidence_value_json = token;
    if (token === undefined) {
      delete row.task_questionnaire_responses![0]!.response_value_json;
      delete row.task_observation_windows![0]!.quantities![0]!.evidence_value_json;
    }
    await roundtrip(changed);
    expect(row.criterion_assessments).toEqual(source.task_occurrences[0]!.criterion_assessments);
  }
  const differentMean = structuredClone(source);
  differentMean.task_occurrences[0]!.criterion_assessments![0]!.assessment_value_json = "3.00";
  await roundtrip(differentMean);
  expect(differentMean.task_occurrences[0]!.task_questionnaire_responses).toEqual(source.task_occurrences[0]!.task_questionnaire_responses);
  expect(differentMean.task_occurrences[0]!.task_observation_windows).toEqual(source.task_occurrences[0]!.task_observation_windows);
  const row = (v: typeof source) => v.task_occurrences[0]!;
  const window = (v: typeof source) => row(v).task_observation_windows![0]!;
  const mutations: Array<(v: typeof source) => void> = [
    v => { row(v).source_work_id = "foreign"; },
    v => { window(v).anchor_task_action_reference = "foreign"; },
    v => { window(v).questionnaire_response_references = ["foreign"]; },
    v => { window(v).window_setting_references.push(window(v).window_setting_references[0]!); },
    v => { window(v).window_setting_references = []; },
    v => { window(v).denotes_interval = { duration_seconds: work === sources[0] ? 604800 : 7200 }; },
    v => { row(v).task_questionnaire_responses![0]!.questionnaire_setting_reference = window(v).window_setting_references[0]!; },
    v => { window(v).quantities![0]!.observed_property = "foreign quantity"; },
    v => { window(v).quantities![0]!.quantity_qualifier = "foreign app or direction"; },
    v => { row(v).criterion_assessments![0]!.support_task_action_references = ["foreign"]; },
    v => { window(v).questionnaire_response_references = [row(v).criterion_assessments![0]!.criterion_assessment_id]; },
  ];
  if (work === sources[0]) mutations.push(
    v => { window(v).window_setting_references.pop(); },
    v => { window(v).quantities![0]!.evidence_unit = "seconds"; },
    v => { window(v).quantities![2]!.quantity_qualifier = "Facebook"; },
  );
  else mutations.push(v => { window(v).quantities!.push({ ...window(v).quantities![0]!, quantity_qualifier: "after ESM assessment" }); });
  const refs = new Set([...window(source).window_setting_references, row(source).task_questionnaire_responses![0]!.questionnaire_setting_reference,
    ...row(source).criterion_assessments!.map(a => a.criterion_setting_reference)]);
  for (const ref of refs) for (const field of ["method_setting_role", "method_target_layer", "method_value_json"]) mutations.push(v => {
    Reflect.set(v.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!, field, field === "method_value_json" ? "null" : "foreign");
  });
  for (const ref of refs) {
    const setting = source.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!;
    const body: unknown = JSON.parse(String(setting.method_value_json));
    const wrapper = { definition: body, source_facing_role: setting.method_setting_role, source_facing_target: setting.method_target_layer };
    const wrapped = structuredClone(source);
    wrapped.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!.method_value_json = JSON.stringify(wrapper);
    await roundtrip(wrapped);
    for (const field of ["definition", "source_facing_role", "source_facing_target"]) mutations.push(v => {
      v.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!.method_value_json = JSON.stringify({ ...(typeof body === "object" ? body : {}), ...wrapper, [field]: null });
    });
  }
  await roundtrip(source);
  const retained = await loadResearchMethodSelection();
  for (const mutate of mutations) {
    const changed = structuredClone(source); mutate(changed);
    expect(() => parseStudyMethodProfileLibrary(changed)).toThrow();
  }
  expect(await loadResearchMethodSelection()).toEqual(retained);
});

const sharedWindowWorks = ["doi:10.3390/s20051396", "doi:10.1016/j.jbi.2019.103151", "doi:10.1145/3613904.3642347"] as const;
const sharedWindowInput = (work: string) => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../e2e/fixtures/assessment-window-examples.json.fixture"), "utf8")) as {
    task_occurrences: TaskOccurrenceRecord[]; sampled_quantity_observations: SampledQuantityObservationRecord[]; screen_text_captures: ScreenTextCaptureRecord[];
  };
  return { profiles: [library.profiles.find(p => p.source_work_id === work)!], task_occurrences: fixture.task_occurrences.filter(r => r.source_work_id === work),
    sampled_quantity_observations: fixture.sampled_quantity_observations.filter(r => r.source_work_id === work), screen_text_captures: fixture.screen_text_captures.filter(r => r.source_work_id === work) };
};
const persistSharedWindowInput = async (value: ReturnType<typeof sharedWindowInput>) => {
  const { profiles, ...records } = parseStudyMethodProfileLibrary(value);
  await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], ...records }));
  const { profile, ...saved } = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile } & Omit<typeof value, "profiles">;
  expect(profile).toEqual(value.profiles[0]);
  const restored = parseStudyMethodProfileLibrary({ profiles: [profile], ...saved });
  for (const field of ["task_occurrences", "sampled_quantity_observations", "screen_text_captures"] as const) expect(restored[field]).toEqual(value[field]);
  return restored;
};
const sharedWindowTaskRoutes = !privateCorpusAvailable ? [] : sharedWindowWorks.flatMap(work => {
  const source = sharedWindowInput(work), settings = source.profiles[0]!.method_settings;
  const routes = source.task_occurrences.flatMap(task => [
    ...(task.task_questionnaire_responses ?? []).map(r => [r.questionnaire_setting_reference, "response"] as const),
    ...(task.criterion_assessments ?? []).map(r => [r.criterion_setting_reference, "criterion"] as const),
  ]);
  return [...new Map(routes.map(([ref, kind]) => [ref + kind, { work, ref, kind, key: settings.find(s => s.method_setting_id === ref)!.method_parameter_key }])).values()];
});
itWithPrivateCorpus.each(sharedWindowTaskRoutes)("admits source-exact shared-window $work $key $kind without unrelated populated routes", ({ work, ref, kind }) => {
  const source = sharedWindowInput(work), task = source.task_occurrences.find(t => kind === "response"
    ? t.task_questionnaire_responses?.some(r => r.questionnaire_setting_reference === ref) : t.criterion_assessments?.some(r => r.criterion_setting_reference === ref))!;
  const responses = task.task_questionnaire_responses?.filter(r => r.questionnaire_setting_reference === ref);
  const criteria = task.criterion_assessments?.filter(r => r.criterion_setting_reference === ref);
  delete task.task_observation_windows; delete task.task_questionnaire_responses; delete task.criterion_assessments;
  if (kind === "response") task.task_questionnaire_responses = responses;
  else task.criterion_assessments = criteria;
  source.task_occurrences = [task]; source.sampled_quantity_observations = []; source.screen_text_captures = [];
  const local = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!;
  expect(parseStudyMethodProfileLibrary(source).task_occurrences).toEqual(source.task_occurrences);
  const key = String(local(source).method_parameter_key);
  const invalidValues: Array<[string, unknown, RegExp]> = [];
  if (work === sharedWindowWorks[0] && key === "ema.response_scale") invalidValues.push(["observed_property", "undeclared symptom cluster", /STDD symptom cluster/]);
  if (work === sharedWindowWorks[0] && key === "depression.outcome") invalidValues.push(["assessment_value_json", '"undeclared category"', /STDD depression category/]);
  if (work === sharedWindowWorks[2] && key === "study.esm_schedule_and_window") invalidValues.push(["observed_property", "undeclared ESM question", /Screen Text ESM question/], ["response_value_json", "true", /Screen Text location choice or free-text answer/]);
  if (work === sharedWindowWorks[2] && key === "analysis.esm_five_minute_lookback" && kind === "criterion") invalidValues.push(["criterion_label", "invented activity label", /posthoc Screen Text activity category/], ["assessment_value_json", '"unlisted activity"', /posthoc Screen Text activity category/]);
  for (const [field, value, error] of invalidValues) {
    const bad = structuredClone(source);
    const child = kind === "response" ? bad.task_occurrences[0]!.task_questionnaire_responses![0]! : bad.task_occurrences[0]!.criterion_assessments![0]!;
    Reflect.set(child, field, value);
    expect(() => parseStudyMethodProfileLibrary(bad), `${key}.${field}`).toThrow(error);
  }
  const original = JSON.parse(String(local(source).method_value_json)) as unknown;
  const wrapped = typeof original === "object" && original !== null && Object.hasOwn(original, "definition");
  const body = wrapped ? (original as { definition: unknown }).definition : original;
  const sourceRole = wrapped ? (original as { source_facing_role: string }).source_facing_role
    : local(source).method_setting_role === "participant_schema" ? "input_schema" : local(source).method_setting_role;
  const sourceTarget = wrapped ? (original as { source_facing_target: string }).source_facing_target : local(source).method_target_layer;
  for (const content of [body, { definition: body, source_facing_role: sourceRole, source_facing_target: sourceTarget }]) {
    const valid = structuredClone(source); local(valid).method_value_json = JSON.stringify(content);
    expect(parseStudyMethodProfileLibrary(valid).task_occurrences).toEqual(source.task_occurrences);
  }
  for (const content of [null, {}, { definition: body, source_facing_role: "invented", source_facing_target: sourceTarget }, { definition: body, source_facing_role: sourceRole, source_facing_target: "invented" }, { definition: null, source_facing_role: sourceRole, source_facing_target: sourceTarget }]) {
    const bad = structuredClone(source); local(bad).method_value_json = JSON.stringify(content);
    expect(() => parseStudyMethodProfileLibrary({ profiles: bad.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/compatible .*definition/);
  }
  for (const [field, value] of [["method_setting_role", "provenance"], ["method_target_layer", "raw_record"], ["source_work_id", "doi:foreign"]] as const) {
    const bad = structuredClone(source); local(bad)[field] = value;
    expect(() => parseStudyMethodProfileLibrary({ profiles: bad.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/compatible .*definition/);
  }
});
itWithPrivateCorpus.each(sharedWindowWorks)("roundtrips all supplied task/window/sample/capture families for %s", async work => {
  const source = sharedWindowInput(work);
  expect(source.task_occurrences.length).toBeGreaterThan(0);
  await persistSharedWindowInput(source);
  const expected = structuredClone(source), changed = structuredClone(source);
  changed.task_occurrences[0]!.task_questionnaire_responses![0]!.response_value_json = ' "independent supplied answer" ';
  const result = await persistSharedWindowInput(changed);
  expect(result.task_occurrences!.slice(1)).toEqual(expected.task_occurrences.slice(1));
  expect(result.sampled_quantity_observations).toEqual(expected.sampled_quantity_observations);
  expect(result.screen_text_captures).toEqual(expected.screen_text_captures);
});
itWithPrivateCorpus("preserves STDD answer fan-out and grouped axis features without inventing an EMA anchor or alignment execution", async () => {
  const source = sharedWindowInput(sharedWindowWorks[0]), a = source.task_occurrences[1]!, b = source.task_occurrences[2]!;
  const wrongAnchor = structuredClone(source); wrongAnchor.task_occurrences[1]!.task_observation_windows![0]!.anchor_task_action_reference = "example:missing-stdd-action";
  expect(() => parseStudyMethodProfileLibrary(wrongAnchor)).toThrow(/anchor_task_action_reference has no matching action within task occurrence/);
  expect(a.task_actions).toBeUndefined();
  expect(a.task_observation_windows!.map(w => w.questionnaire_response_references)).toEqual([["example:stdd-a-answer-0"], ["example:stdd-a-answer-0", "example:stdd-a-answer-1"]]);
  expect(a.task_observation_windows![1]!.quantities!.slice(-2).map(q => q.evidence_value_json)).toEqual(["71.25", "2.75"]);
  expect(a.task_observation_windows!.map(w => w.quantities![0]!.quantity_qualifier)).toEqual(["phone:x", "watch:x"]);
  expect(a.task_observation_windows!.every(w => !Object.hasOwn(w, "anchor_task_action_reference"))).toBe(true);
  expect(b.task_observation_windows![0]!.anchor_task_action_reference).toBeNull();
  await persistSharedWindowInput(source);
  for (const value of [undefined, null]) {
    const unknown = structuredClone(source), w = unknown.task_occurrences[1]!.task_observation_windows![0]!;
    if (value === undefined) delete w.anchor_task_action_reference; else w.anchor_task_action_reference = value;
    expect(() => parseStudyMethodProfileLibrary(unknown)).not.toThrow();
    const old = input("doi:10.1145/3544793.3563411");
    if (value === undefined) delete old.task_occurrences[0]!.task_observation_windows![0]!.anchor_task_action_reference;
    else old.task_occurrences[0]!.task_observation_windows![0]!.anchor_task_action_reference = value;
    expect(() => parseStudyMethodProfileLibrary(old)).toThrow();
  }
  const changed = structuredClone(source);
  changed.task_occurrences[1]!.task_observation_windows![0]!.quantities![0]!.evidence_value_json = JSON.stringify(Array(17).fill(99.25));
  const result = await persistSharedWindowInput(changed);
  expect(result.task_occurrences![1]!.task_questionnaire_responses).toEqual(a.task_questionnaire_responses);
  expect(result.task_occurrences![1]!.task_observation_windows![1]).toEqual(a.task_observation_windows![1]);
  await persistSharedWindowInput(source); const retained = await loadResearchMethodSelection();
  for (const mutate of [
    (v: typeof source) => Reflect.set(v.task_occurrences[1]!.task_observation_windows![0]!, "quantities", false),
    (v: typeof source) => Reflect.set(v.task_occurrences[1]!.task_observation_windows![0]!.quantities!, 0, null),
    (v: typeof source) => Reflect.set(v.task_occurrences[1]!.task_observation_windows![0]!, "window_setting_references", [null]),
    (v: typeof source) => { v.task_occurrences[1]!.task_observation_windows![0]!.questionnaire_response_references = ["example:stdd-a-answer-1"]; },
    (v: typeof source) => { v.task_occurrences[1]!.task_observation_windows![0]!.questionnaire_response_references = ["example:stdd-b-answer-0"]; },
    (v: typeof source) => { v.task_occurrences[1]!.task_observation_windows![0]!.denotes_interval!.duration_seconds = 1800; },
    (v: typeof source) => { v.task_occurrences[1]!.task_observation_windows![0]!.quantities![0]!.evidence_value_json = JSON.stringify(Array(16).fill(1)); },
    (v: typeof source) => { v.task_occurrences[1]!.task_observation_windows![0]!.quantities![0]!.quantity_qualifier = "tablet:x"; },
    (v: typeof source) => { v.task_occurrences[1]!.task_observation_windows![0]!.screen_text_capture_references = null; },
    (v: typeof source) => { v.task_occurrences[1]!.task_questionnaire_responses![0]!.response_value_json = "{}"; },
    (v: typeof source) => { v.task_occurrences[1]!.task_questionnaire_responses![0]!.response_value_json = "true"; },
    (v: typeof source) => { v.task_occurrences[1]!.task_questionnaire_responses![0]!.response_value_json = "0"; },
  ]) {
    const bad = structuredClone(source); mutate(bad);
    await expect(persistSharedWindowInput(bad)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained);
  }
});
itWithPrivateCorpus("requires exact STDD window members/companions independently of anchor optionality", () => {
  const source = sharedWindowInput(sharedWindowWorks[0]);
  source.task_occurrences = [source.task_occurrences[1]!]; source.sampled_quantity_observations = []; source.screen_text_captures = [];
  const keys = ["physical.window.samples", "physical.window.duration", "physical.window.overlap", "physical.ema_alignment.lookback", "physical.ema_alignment.window_count", "physical.label_expansion", "physical.features.per_axis", "physical.features.step_count", "physical.features.significant_motion_count", "physical.features.accelerometer_count_per_device", "physical.features.accelerometer_total", "physical.features.total_count", "cluster.names", "ema.item_mapping", "mood.features.heart_rate", "mood.features.physical", "mood.feature_count", "mood.ground_truth"];
  expect(() => parseStudyMethodProfileLibrary(source)).not.toThrow();
  for (const key of keys) {
    const bad = structuredClone(source), setting = bad.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
    setting.method_value_json = "null";
    expect(() => parseStudyMethodProfileLibrary({ profiles: bad.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow("compatible window definition");
  }
});
itWithPrivateCorpus("preserves Screen Text receipt-anchored membership, equal-time identities and unknown versus empty captures", async () => {
  const source = sharedWindowInput(sharedWindowWorks[2]), first = source.task_occurrences[0]!;
  expect(first.task_observation_windows![0]!.screen_text_capture_references).toEqual(["example-capture-a", "example-capture-b"]);
  expect(source.screen_text_captures[0]!.capture_instant).toBe(source.screen_text_captures[1]!.capture_instant);
  expect(source.screen_text_captures[0]!.text_capture_id).not.toBe(source.screen_text_captures[1]!.text_capture_id);
  for (const refs of [undefined, null, []]) {
    const changed = structuredClone(source), window = changed.task_occurrences[0]!.task_observation_windows![0]!;
    if (refs === undefined) delete window.screen_text_capture_references; else window.screen_text_capture_references = refs;
    await persistSharedWindowInput(changed);
  }
  const unknownDevice = structuredClone(source); unknownDevice.screen_text_captures[0]!.device_id = null;
  expect(() => parseStudyMethodProfileLibrary(unknownDevice)).not.toThrow();
  const changed = structuredClone(source); changed.task_occurrences[0]!.criterion_assessments![0]!.assessment_value_json = '"Resting"';
  const parsed = await persistSharedWindowInput(changed);
  expect(parsed.task_occurrences![0]!.task_questionnaire_responses).toEqual(first.task_questionnaire_responses);
  expect(parsed.task_occurrences![0]!.task_observation_windows).toEqual(first.task_observation_windows);
  expect(parsed.screen_text_captures).toEqual(source.screen_text_captures);
  await persistSharedWindowInput(source); const retained = await loadResearchMethodSelection();
  for (const mutate of [
    (v: typeof source) => Reflect.set(v.task_occurrences[0]!.task_observation_windows![0]!, "screen_text_capture_references", false),
    (v: typeof source) => { v.task_occurrences[0]!.task_observation_windows![0]!.anchor_task_action_reference = "example:screen-text-a-answered"; },
    (v: typeof source) => { v.task_occurrences[0]!.task_observation_windows![0]!.anchor_task_action_reference = "example:screen-text-a-opened"; },
    (v: typeof source) => { v.task_occurrences[0]!.task_observation_windows![0]!.questionnaire_response_references = ["example:screen-text-a-location"]; },
    (v: typeof source) => { v.task_occurrences[0]!.task_observation_windows![0]!.screen_text_capture_references = ["example-capture-a", "example-capture-a"]; },
    (v: typeof source) => { v.task_occurrences[0]!.task_observation_windows![0]!.screen_text_capture_references = [""]; },
    (v: typeof source) => { v.screen_text_captures[0]!.participant_id = "example:other-participant"; },
    (v: typeof source) => { v.screen_text_captures[0]!.device_id = "example:other-device"; },
    (v: typeof source) => { v.task_occurrences[0]!.task_observation_windows![0]!.denotes_interval!.duration_seconds = 900; },
  ]) {
    const bad = structuredClone(source); mutate(bad);
    await expect(persistSharedWindowInput(bad)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained);
  }
  for (const key of ["study.esm_schedule_and_window", "analysis.esm_five_minute_lookback"]) {
    const bad = structuredClone(source); bad.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!.method_value_json = "{}";
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/compatible .*definition/);
  }
  const old = input("doi:10.1145/3544793.3563411"); old.task_occurrences[0]!.task_observation_windows![0]!.screen_text_capture_references = null;
  expect(() => parseStudyMethodProfileLibrary(old)).toThrow("screen_text_capture_references is incompatible");
});

const screenTextSampleRoutes = !privateCorpusAvailable ? [] : (() => {
  const source = sharedWindowInput(sharedWindowWorks[2]);
  return [...new Map(source.sampled_quantity_observations.map(row => {
    const key = source.profiles[0]!.method_settings.find(s => s.method_setting_id === row.method_setting_reference)!.method_parameter_key;
    return [String(key) + String(row.observed_entity_kind), { key, kind: row.observed_entity_kind, id: row.sampled_observation_id }];
  })).values()];
})();
itWithPrivateCorpus.each(screenTextSampleRoutes)("admits Screen Text $key $kind with exact source/body/tuple rather than generic metadata", ({ id }) => {
  const source = sharedWindowInput(sharedWindowWorks[2]);
  const row = source.sampled_quantity_observations.find(r => r.sampled_observation_id === id)!;
  delete row.screen_text_capture_references;
  source.sampled_quantity_observations = [row]; source.task_occurrences = []; source.screen_text_captures = [];
  expect(parseStudyMethodProfileLibrary(source).sampled_quantity_observations).toEqual([row]);
  // A valid named-person alternative isolates foreign-source rejection from
  // the separate pooled-context participant requirement.
  const scoped = structuredClone(source), named = scoped.sampled_quantity_observations[0]!;
  if (named.participant_id == null) {
    named.participant_id = "example-participant";
    if (named.observed_entity_kind === "participant_group") Object.assign(named, { observed_entity_kind: "participant" });
    named.quantities!.find(q => q.observed_property === "population scope")!.evidence_value_json = '"specific participant"';
  }
  expect(() => parseStudyMethodProfileLibrary(scoped)).not.toThrow();
  const local = (value: typeof source) => value.profiles[0]!.method_settings.find(s => s.method_setting_id === row.method_setting_reference)!;
  const original = JSON.parse(String(local(scoped).method_value_json)) as { definition: unknown; source_facing_role: string; source_facing_target: string };
  for (const content of [original.definition, original]) {
    const valid = structuredClone(scoped); local(valid).method_value_json = JSON.stringify(content);
    expect(() => parseStudyMethodProfileLibrary(valid)).not.toThrow();
  }
  for (const content of [null, {}, { conceptual_observation_roles: ["process/application identity", "bytes sent", "bytes received"] },
    { ...original, definition: null }, { ...original, source_facing_role: "invented" }, { ...original, source_facing_target: "invented" }]) {
    const bad = structuredClone(scoped); local(bad).method_value_json = JSON.stringify(content);
    expect(() => parseStudyMethodProfileLibrary({ profiles: bad.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  const foreign = structuredClone(scoped);
  foreign.profiles[0]!.source_work_id = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = foreign.profiles[0]!.source_work_id; });
  foreign.sampled_quantity_observations.forEach(r => { r.source_work_id = foreign.profiles[0]!.source_work_id; });
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow(/(?:compatible|matching) sampled-quantity definition/);
});
itWithPrivateCorpus("retains all Screen Text debrief groups as actual independent answers, not sensor-control events or a computed score", async () => {
  const source = sharedWindowInput(sharedWindowWorks[2]);
  const task = source.task_occurrences.find(t => t.task_occurrence_id === "example:screen-text-debrief")!;
  expect(task.task_questionnaire_responses).toHaveLength(20);
  expect(task.task_questionnaire_responses![0]!.response_value_json).toBe("1");
  expect(task.task_questionnaire_responses![1]!.response_value_json).toBeNull();
  expect(Object.hasOwn(task.task_questionnaire_responses![2]!, "response_value_json")).toBe(false);
  expect(task.task_questionnaire_responses![3]!.response_value_json).toBe("null");
  expect(task.criterion_assessments).toBeUndefined();
  await persistSharedWindowInput(source);
  for (const value of [undefined, null, "null", "7.00", ' "unreported intermediate wording" ']) {
    const changed = structuredClone(source), answer = changed.task_occurrences.at(-1)!.task_questionnaire_responses![0]!;
    if (value === undefined) delete answer.response_value_json; else answer.response_value_json = value;
    expect(() => parseStudyMethodProfileLibrary(changed)).not.toThrow();
  }
  for (const mutate of [
    (v: typeof source) => { v.task_occurrences.at(-1)!.task_questionnaire_responses![0]!.response_value_json = "8"; },
    (v: typeof source) => { v.task_occurrences.at(-1)!.task_questionnaire_responses![5]!.response_value_json = "0"; },
    (v: typeof source) => { v.task_occurrences.at(-1)!.task_questionnaire_responses![17]!.response_value_json = "true"; },
    (v: typeof source) => { v.task_occurrences.at(-1)!.task_questionnaire_responses![18]!.response_value_json = "{}"; },
    (v: typeof source) => { v.task_occurrences.at(-1)!.task_questionnaire_responses![0]!.observed_property = "invented SUS question"; },
  ]) { const bad = structuredClone(source); mutate(bad); expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/debrief/); }
});
itWithPrivateCorpus("preserves ordered Screen Text metric capture identity and independent values without set arithmetic or chronology", async () => {
  const source = sharedWindowInput(sharedWindowWorks[2]);
  source.task_occurrences = [];
  const row = (v: typeof source, suffix: string) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === "example:screen-text-" + suffix)!;
  const before = structuredClone(source.screen_text_captures);
  expect(before[0]!.capture_instant).toBe(before[1]!.capture_instant);
  const changed = structuredClone(source);
  row(changed, "difference").screen_text_capture_references!.reverse();
  row(changed, "difference").quantities![0]!.evidence_value_json = "17.00";
  const parsed = await persistSharedWindowInput(changed);
  expect(parsed.screen_text_captures).toEqual(before);
  expect(row(changed, "selected-count")).toEqual(row(source, "selected-count"));
  for (const refs of [undefined, null, [], ["example-capture-a"]]) {
    const unknown = structuredClone(source), metric = row(unknown, "difference");
    if (refs === undefined) delete metric.screen_text_capture_references; else metric.screen_text_capture_references = refs;
    expect(() => parseStudyMethodProfileLibrary(unknown)).not.toThrow();
  }
  const unknownDevice = structuredClone(source); unknownDevice.screen_text_captures[0]!.device_id = null;
  expect(() => parseStudyMethodProfileLibrary(unknownDevice)).not.toThrow();
  for (const mutate of [
    (v: typeof source) => { row(v, "density").screen_text_capture_references = ["example-capture-a", "example-capture-b"]; },
    (v: typeof source) => { row(v, "difference").screen_text_capture_references!.push(v.screen_text_captures[2]!.text_capture_id); },
    (v: typeof source) => { row(v, "difference").screen_text_capture_references = ["example-capture-a", "example-capture-a"]; },
    (v: typeof source) => { row(v, "difference").screen_text_capture_references = [""]; },
    (v: typeof source) => { v.screen_text_captures[0]!.participant_id = "example:foreign-participant"; },
    (v: typeof source) => { v.screen_text_captures[0]!.device_id = "example:foreign-device"; },
    (v: typeof source) => { row(v, "hour-pool").screen_text_capture_references = null; },
  ]) { const bad = structuredClone(source); mutate(bad); expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/captures|capture_references/); }
  const invalidOld = sharedWindowInput(sharedWindowWorks[0]); invalidOld.sampled_quantity_observations[0]!.screen_text_capture_references = [];
  expect(() => parseStudyMethodProfileLibrary(invalidOld)).toThrow("screen_text_capture_references is incompatible");
});
itWithPrivateCorpus("keeps participant groups, named people, apps, categories, places and sensor bins distinct through persistence", async () => {
  const source = sharedWindowInput(sharedWindowWorks[2]);
  const row = (v: typeof source, suffix: string) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === "example:screen-text-" + suffix)!;
  expect(row(source, "hour-pool").observed_entity_kind).toBe("participant_group");
  expect(row(source, "hour-pool").participant_id).toBeNull();
  expect(row(source, "hour-person").observed_entity_kind).toBe("participant");
  expect(row(source, "word-app-person-a").observed_entity_token).toBe(row(source, "word-app-person-b").observed_entity_token);
  expect(row(source, "word-app-person-a").participant_id).not.toBe(row(source, "word-app-person-b").participant_id);
  expect(row(source, "app-summary").observed_entity_kind).not.toBe(row(source, "category-summary").observed_entity_kind);
  expect(row(source, "category-average-boundary").quantities!.at(-1)!.evidence_value_json).toBe("null");
  const changed = structuredClone(source); row(changed, "sentiment").quantities![0]!.evidence_value_json = "-0.75";
  row(changed, "input-battery").quantities![0]!.evidence_value_json = "100.00";
  const parsed = await persistSharedWindowInput(changed);
  for (const suffix of ["app-average-class", "category-average-boundary", "bin-battery", "activity-Working", "word-app-person-b"]) {
    expect(parsed.sampled_quantity_observations!.find(r => r.sampled_observation_id === row(source, suffix).sampled_observation_id)).toEqual(row(source, suffix));
  }
  await persistSharedWindowInput(source); const retained = await loadResearchMethodSelection();
  for (const mutate of [
    (v: typeof source) => { row(v, "hour-pool").participant_id = "example-participant"; },
    (v: typeof source) => { row(v, "hour-pool").observed_entity_kind = "participant"; },
    (v: typeof source) => { row(v, "hour-person").participant_id = undefined; },
    (v: typeof source) => { row(v, "hour-person").observed_entity_kind = "participant_group"; },
    (v: typeof source) => { row(v, "density").observed_entity_kind = "participant_group"; },
    (v: typeof source) => { row(v, "hour-pool").method_setting_reference = row(v, "density").method_setting_reference; },
    (v: typeof source) => { row(v, "density").quantities![0]!.evidence_value_json = "1.25"; },
    (v: typeof source) => { row(v, "sentiment").quantities![0]!.evidence_value_json = "1.25"; },
    (v: typeof source) => { row(v, "activity-Working").quantities![1]!.evidence_value_json = '"offered option inferred from text"'; },
    (v: typeof source) => { row(v, "bin-battery").quantities![1]!.evidence_value_json = '"Bluetooth connected state"'; },
    (v: typeof source) => { row(v, "input-battery").quantities![0]!.evidence_value_json = "-1"; },
  ]) { const bad = structuredClone(source); mutate(bad); await expect(persistSharedWindowInput(bad)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained); }
});

itWithPrivateCorpus("preserves independently supplied Screen Text standard errors without computing or extending them to ESM summaries", async () => {
  const source = sharedWindowInput(sharedWindowWorks[2]);
  const bin = (v: typeof source) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === "example:screen-text-bin-bluetooth")!;
  const properties = ["standard error of average number of screens", "standard error of mean phrases per screen", "standard error of mean phrase difference", "standard error of mean sentiment"];
  expect(properties.map(p => bin(source).quantities!.find(q => q.observed_property === p)!.evidence_value_json)).toEqual(["0.125", "0.2500", "0.50", "0.0625"]);
  const changed = structuredClone(source);
  bin(changed).quantities!.find(q => q.observed_property === properties[0])!.evidence_value_json = "2.7500";
  const parsed = await persistSharedWindowInput(changed);
  expect(parsed.sampled_quantity_observations!.find(r => r.sampled_observation_id === bin(changed).sampled_observation_id)).toEqual(bin(changed));
  expect(bin(changed).quantities!.filter(q => !properties.includes(q.observed_property))).toEqual(bin(source).quantities!.filter(q => !properties.includes(q.observed_property)));
  for (const value of [undefined, null, "null", "0.000", ' "unreported" ']) {
    const unknown = structuredClone(source), quantity = bin(unknown).quantities!.find(q => q.observed_property === properties[0])!;
    if (value === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = value;
    await persistSharedWindowInput(unknown);
  }
  for (const property of properties) for (const value of ["-0.01", "1e999", "{}", "[]", "true"]) {
    const bad = structuredClone(source); bin(bad).quantities!.find(q => q.observed_property === property)!.evidence_value_json = value;
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/Screen Text (?:scalar|value)/);
  }
  const wrongRoot = structuredClone(source);
  wrongRoot.sampled_quantity_observations.find(r => r.sampled_observation_id === "example:screen-text-activity-Working")!.quantities!.push({ observed_property: properties[0]!, evidence_value_json: "0.125" });
  expect(() => parseStudyMethodProfileLibrary(wrongRoot)).toThrow(/property/);
});
itWithPrivateCorpus("keeps Screen Text pooled geographic observations as a place, not a participant or a claim of universal participation", async () => {
  const source = sharedWindowInput(sharedWindowWorks[2]);
  const place = (v: typeof source) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === "example:screen-text-location-summary")!;
  expect(place(source).observed_entity_kind).toBe("place");
  expect(place(source).participant_id).toBeNull();
  expect(place(source).quantities![0]).toEqual({ observed_property: "population scope", evidence_value_json: '"pooled study observations"' });
  await persistSharedWindowInput(source); const retained = await loadResearchMethodSelection();
  for (const mutate of [
    (v: typeof source) => { place(v).participant_id = "example-participant"; },
    (v: typeof source) => { place(v).device_id = "example-device"; },
    (v: typeof source) => { place(v).quantities![0]!.evidence_value_json = '"all participants"'; },
    (v: typeof source) => { place(v).observed_entity_kind = "participant_group"; },
  ]) { const bad = structuredClone(source); mutate(bad); await expect(persistSharedWindowInput(bad)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained); }
  const omitted = structuredClone(source); delete place(omitted).participant_id; delete place(omitted).device_id;
  await persistSharedWindowInput(omitted);
  const named = structuredClone(source); place(named).participant_id = "example-participant"; place(named).quantities![0]!.evidence_value_json = '"specific participant"';
  named.sampled_quantity_observations = [place(named)]; named.task_occurrences = []; named.screen_text_captures = [];
  expect(() => parseStudyMethodProfileLibrary(named)).not.toThrow();
  const foreign = structuredClone(named); foreign.profiles[0]!.source_work_id = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = foreign.profiles[0]!.source_work_id; });
  place(foreign).source_work_id = foreign.profiles[0]!.source_work_id;
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow(/(?:compatible|matching) sampled-quantity definition/);
});
