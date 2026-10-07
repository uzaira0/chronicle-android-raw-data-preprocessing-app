import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { privateCorpusPath } from "@/testSupport/privateCorpus";
import { loadResearchMethodSelection, saveResearchMethodSelection } from "./lastRunStore";
import { parseStudyMethodProfileLibrary, type StudyMethodProfile } from "./methodProfiles";
import { taskReferenceExample } from "../../e2e/fixtures/task-reference-examples";

const sources = ["doi:10.1145/3743726", "source-ref:e2014b2268ac2833bb8e", "doi:10.1145/3422821"];
const input = (work: string) => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  return taskReferenceExample(library.profiles.find(p => p.source_work_id === work)!);
};

const persist = async (value: ReturnType<typeof input>) => {
    const parsed = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ ...parsed, profiles: undefined, profile: parsed.profiles[0] }));
    const { profile, ...saved } = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile };
    expect(parseStudyMethodProfileLibrary({ ...saved, profiles: [profile] })).toEqual(parsed);
    expect(parsed).toMatchObject(value);
};

itWithPrivateCorpus.each(sources)("preserves %s explicitly linked source assessments without computing scores or joins", async work => {
  const source = input(work);
  await persist(source);
  const changed = structuredClone(source);
  if (work === sources[0]) {
    changed.task_occurrences[0]!.task_questionnaire_responses![0]!.response_value_json = "3.00";
    expect(changed.interaction_traces).toEqual(source.interaction_traces);
    expect(changed.task_occurrences[1]).toEqual(source.task_occurrences[1]);
    await persist(changed);
    for (const value of [null, undefined]) {
      const partial = structuredClone(source);
      for (const row of partial.task_occurrences) {
        if (value === undefined) delete row.interaction_trace_reference;
        else row.interaction_trace_reference = value;
      }
      await persist(partial);
      const unknownParticipant = structuredClone(source);
      for (const trace of unknownParticipant.interaction_traces) {
        if (value === undefined) delete trace.participant_id;
        else trace.participant_id = value;
      }
      await persist(unknownParticipant); // Unknown trace participant does not assert identity equality.
    }
  } else {
    if (work === sources[2]) {
      const itemOnly = structuredClone(source);
      itemOnly.task_occurrences[0]!.task_questionnaire_responses![0]!.response_value_json = "3.00";
      expect(itemOnly.task_occurrences[0]!.criterion_assessments).toEqual(source.task_occurrences[0]!.criterion_assessments);
      await persist(itemOnly);
    }
    const row = changed.task_occurrences[0]!;
    row.criterion_assessments![0]!.assessment_value_json = "12.00";
    expect(row.criterion_assessments!.slice(1)).toEqual(source.task_occurrences[0]!.criterion_assessments!.slice(1));
    row.criterion_assessments!.reverse();
    await persist(changed); // Forward references, no array-order subtraction or automatic reclassification.
    for (const value of [undefined, null, []]) {
      const partial = structuredClone(source);
      const change = partial.task_occurrences[0]!.criterion_assessments![2]!;
      if (value === undefined) delete change.support_criterion_assessment_references;
      else change.support_criterion_assessment_references = value;
      await persist(partial);
    }
    for (const value of [undefined, null, "null", "0.00", '"unknown"']) {
      const variant = structuredClone(source);
      for (const assessment of variant.task_occurrences[0]!.criterion_assessments!) {
        if (value === undefined) delete assessment.assessment_value_json;
        else assessment.assessment_value_json = value;
      }
      await persist(variant);
    }
    const mutual = structuredClone(source);
    mutual.task_occurrences[0]!.criterion_assessments![0]!.support_criterion_assessment_references = ["change"];
    await persist(mutual); // Supplied support is not an executed DAG; this constructed cycle is not a paper claim.
    for (const index of [2, 3, 5]) {
      const variant = structuredClone(source);
      variant.task_occurrences[0]!.criterion_assessments![index]!.assessment_value_json = '"independently supplied"';
      await persist(variant);
      expect(variant.task_occurrences[0]!.criterion_assessments!.filter((_, i) => i !== index))
        .toEqual(source.task_occurrences[0]!.criterion_assessments!.filter((_, i) => i !== index));
    }
  }
  const mutations: Array<(v: typeof source) => void> = work === sources[0] ? [
    v => { v.task_occurrences[0]!.interaction_trace_reference = "missing"; },
    v => { v.task_occurrences[0]!.interaction_trace_reference = "example:second-trace"; },
    v => { v.interaction_traces[0]!.participant_id = "foreign participant"; },
    v => { v.task_occurrences[0]!.interaction_trace_reference = [] as never; },
    v => { v.interaction_traces[0]!.participant_id = " "; },
    v => { v.interaction_traces = []; },
  ] : [
    v => { v.task_occurrences[0]!.criterion_assessments![2]!.support_criterion_assessment_references = ["sibling-only"]; },
    v => { v.task_occurrences[0]!.criterion_assessments![2]!.support_criterion_assessment_references = ["change"]; },
    v => { v.task_occurrences[0]!.criterion_assessments![2]!.support_criterion_assessment_references = ["score:end", "score:end"]; },
    v => { v.task_occurrences[0]!.criterion_assessments![2]!.support_criterion_assessment_references = "score:end" as never; },
    v => { v.task_occurrences[0]!.criterion_assessments![2]!.support_criterion_assessment_references = [null] as never; },
    v => { v.task_occurrences[0]!.criterion_assessments![2]!.support_criterion_assessment_references = [" "]; },
    v => { v.task_occurrences[0]!.criterion_assessments![2]!.support_criterion_assessment_references = [v.task_occurrences[0]!.task_actions![0]!.task_action_id]; },
    ...(work === sources[1] ? [(v: typeof source) => { v.participant_day_observations[0]!.participant_id = "foreign"; }] : []),
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(source);
    mutate(invalid);
    const before = await loadResearchMethodSelection();
    await expect(persist(invalid)).rejects.toThrow();
    expect(await loadResearchMethodSelection()).toBe(before);
  }
});

itWithPrivateCorpus("rejects foreign ODIM trace owners even when participant identity is unknown", () => {
  const value = input(sources[0]!);
  const other = { ...structuredClone(value.profiles[0]!), method_profile_id: "example:other-profile" };
  value.profiles.push(other);
  for (const trace of value.interaction_traces) {
    trace.method_profile_id = other.method_profile_id;
    trace.participant_id = null;
  }
  expect(() => parseStudyMethodProfileLibrary(value)).toThrow("same profile/source");
});

itWithPrivateCorpus.each([[sources[1]!, 5], [sources[2]!, 3], ["doi:10.1145/2371574.2371617", 3]] as const)("validates %s assessment definitions, not merely their keys or wrapper labels", (source, definitionCount) => {
  const value = input(source);
  const used = new Set(value.task_occurrences[0]!.criterion_assessments!.map(a => a.criterion_setting_reference));
  expect(used.size).toBe(definitionCount);
  for (const id of used) {
    const index = value.profiles[0]!.method_settings.findIndex(s => s.method_setting_id === id);
    const original = value.profiles[0]!.method_settings[index]!;
    const body: unknown = JSON.parse(String(original.method_value_json));
    const wrapper = { source_facing_role: original.method_setting_role, source_facing_target: original.method_target_layer, definition: body };
    const qualified = structuredClone(value);
    qualified.profiles[0]!.method_settings[index]!.method_value_json = JSON.stringify(wrapper);
    expect(parseStudyMethodProfileLibrary(qualified)).toMatchObject(qualified);
    for (const malformed of [
      { ...wrapper, source_facing_role: "acquisition" },
      { ...wrapper, source_facing_target: "raw_record" },
      { ...wrapper, definition: null }, { ...wrapper, definition: 0 },
      { ...wrapper, definition: {} },
    ]) {
      const invalid = structuredClone(value);
      invalid.profiles[0]!.method_settings[index]!.method_value_json = JSON.stringify(malformed);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("compatible criterion");
      if (original.method_parameter_key === "ground_truth.bdi_ii") {
        for (const task of invalid.task_occurrences) task.criterion_assessments = [];
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("compatible response-scale definition");
      }
    }
    for (const field of ["method_setting_role", "method_target_layer"] as const) {
      const invalid = structuredClone(value);
      invalid.profiles[0]!.method_settings[index]![field] = field === "method_setting_role" ? "acquisition" : "raw_record";
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
    }
  }
});

itWithPrivateCorpus.each(["measure.interrupted_runtime_components", "measure.normal_runtime_reference", "measure.signed_overhead"])("admits Back to the App %s independently", key => {
  const value = input("doi:10.1145/2371574.2371617");
  const reference = value.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!.method_setting_id;
  const row = value.task_occurrences[0]!;
  const assessment = row.criterion_assessments!.find(a => a.criterion_setting_reference === reference)!;
  delete assessment.support_task_action_references;
  delete assessment.support_criterion_assessment_references;
  row.criterion_assessments = [assessment];
  value.task_occurrences = [row];
  expect(parseStudyMethodProfileLibrary(value)).toMatchObject(value);
});

itWithPrivateCorpus("preserves Back to the App supplied signed comparison and independent normal/interruption values", async () => {
  const value = input("doi:10.1145/2371574.2371617");
  await persist(value);
  const row = value.task_occurrences[0]!;
  expect(row.criterion_assessments!.map(a => a.assessment_value_json)).toEqual(["3.00", "4.00", "5.00", "8.00", "10.00", "-2.00"]);
  expect(value.task_occurrences[2]!.criterion_assessments!.map(a => a.criterion_assessment_id)).toEqual(["T_b", "T_i", "T_a", "T_r"]);
  for (const index of [1, 3, 4, 5]) {
    const variant = structuredClone(value);
    variant.task_occurrences[0]!.criterion_assessments![index]!.assessment_value_json = "0.00";
    await persist(variant);
    expect(variant.task_occurrences[0]!.criterion_assessments!.filter((_, i) => i !== index)).toEqual(row.criterion_assessments!.filter((_, i) => i !== index));
  }
  for (const field of ["app_identifier", "assigned_role_labels"] as const) {
    for (const unknown of [null, undefined]) {
      const variant = structuredClone(value);
      for (const action of variant.task_occurrences[0]!.task_actions!) {
        if (unknown === undefined) delete action[field]; else action[field] = null;
      }
      await persist(variant);
    }
  }
  for (const field of ["support_task_action_references", "support_criterion_assessment_references"] as const) {
    for (const references of [null, undefined, []]) {
      const variant = structuredClone(value);
      for (const assessment of variant.task_occurrences[0]!.criterion_assessments!) {
        if (references === undefined) delete assessment[field]; else assessment[field] = references;
      }
      await persist(variant);
    }
  }
  const reverse = structuredClone(value);
  reverse.task_occurrences[0]!.criterion_assessments!.reverse();
  for (const assessment of reverse.task_occurrences[0]!.criterion_assessments!) {
    assessment.support_task_action_references?.reverse();
    assessment.support_criterion_assessment_references?.reverse();
  }
  await persist(reverse);
  const cyclic = structuredClone(value);
  cyclic.task_occurrences[0]!.criterion_assessments![0]!.support_criterion_assessment_references = ["T_r"];
  await persist(cyclic); // Supplied support is not an executed derivation DAG.
  for (const token of [undefined, null, "null", "0.00", " -2.00 "]) {
    const variant = structuredClone(value);
    const assessment = variant.task_occurrences[0]!.criterion_assessments![5]!;
    if (token === undefined) delete assessment.assessment_value_json;
    else assessment.assessment_value_json = token;
    await persist(variant);
  }
});

itWithPrivateCorpus("keeps Back to the App app identity local to each explicitly linked comparison", async () => {
  const value = input("doi:10.1145/2371574.2371617");
  const row = value.task_occurrences[0]!;
  const other = structuredClone(row);
  for (const action of other.task_actions!) {
    action.task_action_id += ":second";
    if (action.app_identifier === "example:app-A") action.app_identifier = "example:app-D";
  }
  for (const assessment of other.criterion_assessments!) {
    assessment.criterion_assessment_id += ":second";
    if (assessment.support_task_action_references) assessment.support_task_action_references = assessment.support_task_action_references.map(ref => `${ref}:second`);
    if (assessment.support_criterion_assessment_references) assessment.support_criterion_assessment_references = assessment.support_criterion_assessment_references.map(ref => `${ref}:second`);
  }
  row.task_actions!.push(...other.task_actions!);
  row.criterion_assessments!.push(...other.criterion_assessments!);
  await persist(value);
  const independent = structuredClone(value);
  independent.task_occurrences[0]!.criterion_assessments!.find(a => a.criterion_assessment_id === "T_o")!.support_criterion_assessment_references!.push("T_o:second");
  expect(parseStudyMethodProfileLibrary(independent).task_occurrences).toEqual(independent.task_occurrences);
  const before = await loadResearchMethodSelection();
  row.criterion_assessments![5]!.support_criterion_assessment_references = ["T_r", "T_n:second"];
  await expect(persist(value)).rejects.toThrow(/same app/);
  expect(await loadResearchMethodSelection()).toBe(before);
});

itWithPrivateCorpus.each(["direct", "transitive"])("checks Back to the App %s runtime supports without an overhead result", async route => {
  const value = input("doi:10.1145/2371574.2371617");
  const task = value.task_occurrences[0]!;
  const runtime = task.criterion_assessments!.find(a => a.criterion_assessment_id === "T_r")!;
  if (route === "direct") delete runtime.support_criterion_assessment_references;
  else delete runtime.support_task_action_references;
  task.criterion_assessments = task.criterion_assessments!.filter(a => a.criterion_assessment_id !== "T_o");
  await persist(value);
  const before = await loadResearchMethodSelection();
  task.task_actions![2]!.app_identifier = "example:wrong-resumed-app";
  await expect(persist(value)).rejects.toThrow(/same app/);
  expect(await loadResearchMethodSelection()).toBe(before);
});

itWithPrivateCorpus("rejects Back to the App known app contradictions and foreign comparison supports without replacing saved data", async () => {
  const value = input("doi:10.1145/2371574.2371617");
  await persist(value);
  const before = await loadResearchMethodSelection();
  for (const [index, change] of [
    (v: typeof value) => { v.task_occurrences[0]!.task_actions![3]!.app_identifier = "example:wrong-normal-app"; },
    (v: typeof value) => { v.task_occurrences[0]!.task_actions![2]!.app_identifier = "example:wrong-resumed-app"; },
    (v: typeof value) => {
      const task = v.task_occurrences[0]!;
      task.task_actions!.push({ ...structuredClone(task.task_actions![3]!), task_action_id: "other-normal", app_identifier: "example:wrong-normal-app" });
      task.criterion_assessments![4]!.support_task_action_references = ["normal", "other-normal"];
      task.criterion_assessments = task.criterion_assessments!.filter(a => a.criterion_assessment_id !== "T_o");
    },
    (v: typeof value) => { v.task_occurrences[0]!.criterion_assessments![5]!.support_criterion_assessment_references = ["foreign"]; },
    (v: typeof value) => { v.task_occurrences[0]!.criterion_assessments![5]!.support_criterion_assessment_references = ["T_o"]; },
    (v: typeof value) => { v.task_occurrences[0]!.criterion_assessments![5]!.support_criterion_assessment_references = ["T_n", "T_n"]; },
    (v: typeof value) => { v.task_occurrences[0]!.source_work_id = "foreign"; },
  ].entries()) {
    const invalid = structuredClone(value);
    change(invalid);
    await expect(persist(invalid)).rejects.toThrow(index < 3 ? /same app/ : /./);
    expect(await loadResearchMethodSelection()).toBe(before);
  }
});
