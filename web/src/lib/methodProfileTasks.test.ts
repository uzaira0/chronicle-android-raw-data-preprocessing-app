import "fake-indexeddb/auto";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { lazyPrivateCorpusJson, privateCorpusPath } from "@/testSupport/privateCorpus";
import { loadResearchMethodSelection, saveResearchMethodSelection } from "@/lib/lastRunStore";
import { compileNativeMethodProfile, parseStudyMethodProfileLibrary, type StudyMethodProfile, type TaskOccurrenceRecord } from "@/lib/methodProfiles";
import { taskInstrumentExamples } from "../../e2e/fixtures/task-instrument-examples";
import { appInterruptionQuestionnaireExample } from "../../e2e/fixtures/app-interruption-session";
import { linkmlPython } from "../testSupport/linkmlPython";

itWithPrivateCorpus.each([
  ["survey.baseline", "response"], ["covariate.derived_and_instrument", "response"],
  ["covariate.derived_and_instrument", "criterion"], ["covariate.race_ethnicity", "criterion"],
] as const)("admits Direct Measurements' actual eVisit %s %s independently of its screen-time results", (key, kind) => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = structuredClone(library.profiles.find(p => p.source_work_id === "doi:10.1371/journal.pone.0165331")!);
  const records = taskInstrumentExamples(profile);
  const row = records.task_occurrences[0]!;
  records.task_occurrences = [row];
  const id = profile.method_settings.find(s => s.method_parameter_key === key)!.method_setting_id;
  if (kind === "response") { delete row.criterion_assessments; row.task_questionnaire_responses = row.task_questionnaire_responses!.filter(r => r.questionnaire_setting_reference === id); }
  else { delete row.task_questionnaire_responses; row.criterion_assessments = row.criterion_assessments!.filter(r => r.criterion_setting_reference === id); }
  expect(parseStudyMethodProfileLibrary({ profiles: [profile], ...records }).task_occurrences).toEqual(records.task_occurrences);
  const setting = profile.method_settings.find(s => s.method_setting_id === id)!;
  const content: unknown = JSON.parse(String(setting.method_value_json));
  const wrapper = { definition: content, source_facing_role: setting.method_setting_role, source_facing_target: setting.method_target_layer };
  setting.method_value_json = JSON.stringify(wrapper);
  expect(parseStudyMethodProfileLibrary({ profiles: [profile], ...records }).task_occurrences).toEqual(records.task_occurrences);
  for (const body of [{ ...wrapper, definition: null }, { ...wrapper, definition: {} }, { ...wrapper, source_facing_role: "provenance" }, { ...wrapper, source_facing_target: "study_window" }]) {
    setting.method_value_json = JSON.stringify(body);
    expect(() => parseStudyMethodProfileLibrary({ profiles: [profile], ...records })).toThrow(/compatible (response-scale|criterion) definition/);
  }
  setting.method_value_json = JSON.stringify(wrapper);
  setting.source_work_id = "doi:foreign";
  expect(() => parseStudyMethodProfileLibrary({ profiles: [profile], ...records })).toThrow(/compatible (response-scale|criterion) definition/);
});

itWithPrivateCorpus("preserves ScreenTK manual references through save/reload without fabricated questionnaires", async () => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = library.profiles.find(p => p.source_work_id === "doi:10.1145/3675094.3677547")!;
  const records = taskInstrumentExamples(profile), source = { profiles: [profile], ...records };
  expect(parseStudyMethodProfileLibrary({ profiles: [profile], task_occurrences: records.task_occurrences }).task_occurrences).toEqual(records.task_occurrences);
  const roundtrip = async (value: typeof source) => {
    const { profiles, ...parsedRecords } = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], ...parsedRecords }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile } & typeof records;
    const { profile: restored, ...restoredRecords } = saved;
    const reparsed = parseStudyMethodProfileLibrary({ profiles: [restored], ...restoredRecords });
    expect(reparsed.task_occurrences).toEqual(value.task_occurrences); expect(reparsed.screen_text_captures).toEqual(value.screen_text_captures);
  };
  await roundtrip(source);
  expect(new Set(records.task_occurrences.map(row => row.participant_id)).size).toBe(2);
  for (const row of records.task_occurrences) {
    expect(row).not.toHaveProperty("task_questionnaire_responses");
    expect(row.criterion_assessments![0]!.support_task_action_references).toEqual(row.task_actions!.map(action => action.task_action_id));
    expect(row.criterion_assessments![0]).not.toHaveProperty("assessment_value_json");
  }
  const setting = (value: typeof source) => value.profiles[0]!.method_settings.find(s => s.method_parameter_key === "ground_truth.url_click_to_reading_return_interval")!;
  const original = JSON.parse(String(setting(source).method_value_json)) as Record<string, unknown>;
  const bare = structuredClone(source); setting(bare).method_value_json = JSON.stringify(original.definition); await roundtrip(bare);
  for (const content of [{ ...original, definition: null }, { ...original, definition: {} },
    { ...original, source_facing_role: "diary_schema" }, { ...original, source_facing_target: "outcome" }]) {
    const invalid = structuredClone(source); setting(invalid).method_value_json = JSON.stringify(content);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("compatible criterion definition");
  }
  const responseMisuse = structuredClone(source);
  responseMisuse.task_occurrences[0]!.task_questionnaire_responses = [{ questionnaire_response_id: "invented-question", questionnaire_setting_reference: setting(source).method_setting_id, observed_property: "not a questionnaire", source_locators: ["invalid example"] }];
  expect(() => parseStudyMethodProfileLibrary(responseMisuse)).toThrow("compatible response-scale definition");
  await roundtrip(source); const retained = await loadResearchMethodSelection();
  const foreign = structuredClone(source);
  foreign.task_occurrences[0]!.criterion_assessments![0]!.support_task_action_references = [foreign.task_occurrences[1]!.task_actions![0]!.task_action_id];
  await expect(roundtrip(foreign)).rejects.toThrow("within task occurrence"); expect(await loadResearchMethodSelection()).toBe(retained);
});

for (const workId of ["doi:10.1145/2406367.2406384", "doi:10.1145/2470654.2481345", "doi:10.1145/3613904.3642583", "doi:10.1016/j.smhl.2018.07.005", "doi:10.2196/55999", "doi:10.2196/13209", "doi:10.1016/j.smhl.2020.100118", "doi:10.1186/s13104-015-1280-z", "doi:10.3390/bs5040434", "doi:10.4088/jcp.15m10310", "doi:10.1371/journal.pone.0165331", "doi:10.1145/3191754", "doi:10.1145/3473856.3473881", "doi:10.1145/2750858.2804252", "doi:10.4000/questionsdecommunication.9851"]) {
  itWithPrivateCorpus(`preserves disclosed task instruments for ${workId} without supplied-answer coercion`, async () => {
    const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
    const profile = library.profiles.find(p => p.source_work_id === workId)!;
    const source = { profiles: [profile], ...taskInstrumentExamples(profile) };
    const roundtrip = async (value: typeof source) => {
      const { profiles, ...records } = parseStudyMethodProfileLibrary(value);
      await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], ...records }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile } & ReturnType<typeof taskInstrumentExamples>;
      const { profile: restored, ...restoredRecords } = saved;
      const reparsed = parseStudyMethodProfileLibrary({ profiles: [restored], ...restoredRecords });
      expect(reparsed.profiles).toEqual(value.profiles);
      for (const [key, expected] of Object.entries(value)) if (key !== "profiles") expect(Reflect.get(reparsed, key)).toEqual(expected);
      return saved;
    };
    if (workId === "doi:10.4088/jcp.15m10310") {
      const expected = structuredClone(source.task_occurrences);
      expect((await roundtrip(source)).task_occurrences).toEqual(expected);
      const clinicians = expected.slice(0, 3), inputs = expected[3]!;
      expect(clinicians.map(row => row.assessor_id)).toEqual(["example:clinician-0", "example:clinician-1", "example:clinician-2"]);
      expect(clinicians.map(row => row.task_actions![0]!.assigned_role_labels)).toEqual([["live interviewer"], ["video reviewer"], ["video reviewer"]]);
      expect(inputs).not.toHaveProperty("assessor_id");
      expect(inputs.task_questionnaire_responses![0]!.response_value_json).toBe("1.00");
      expect(inputs.criterion_assessments!.map(item => item.assessment_value_json)).toEqual(["3.00", "-2.00", "69.00", "12.50", "10.00", "0.10", "-0.25", "0.00"]);
      const definition = (key: string) => profile.method_settings.find(setting => setting.method_parameter_key === key)!.method_setting_id;
      const appInfo = JSON.parse(String(profile.method_settings.find(setting => setting.method_parameter_key === "protocol.app_information_for_interview")!.method_value_json)) as Array<Record<string, unknown>>;
      expect(appInfo[0]!.difference_direction).toBeNull(); expect(appInfo[0]).not.toHaveProperty("formula");
      const candidates = JSON.parse(String(profile.method_settings.find(setting => setting.method_parameter_key === "protocol.diagnostic_candidate_structure")!.method_value_json)) as { candidate_items: Array<{ id: string; meaning: string }> };
      expect(candidates.candidate_items.filter(item => ["A2", "A6", "A8", "A10", "A11", "A12"].includes(item.id))).toEqual([
        { id: "A2", meaning: "recurrent failure to resist the impulse to use the smartphone" },
        { id: "A6", meaning: "persistent desire and/or unsuccessful attempts to cut down or reduce smartphone use" },
        { id: "A8", meaning: "excessive effort spent on smartphone use as much as the person can do" },
        { id: "A10", meaning: "use of the smartphone to escape or relieve a dysphoric mood, such as helplessness, guilt, or anxiety" },
        { id: "A11", meaning: "loss of previous interests, hobbies, and entertainment as a result of smartphone use, except smartphone use itself" },
        { id: "A12", meaning: "has deceived family members, therapists, or others regarding time spent on smartphone use" },
      ]);
      for (const [index, row] of clinicians.entries()) {
        expect(row).not.toHaveProperty("task_questionnaire_responses");
        expect(row).not.toHaveProperty("denotes_interval"); expect(row).not.toHaveProperty("referenced_day_token");
        const assessments = row.criterion_assessments!;
        expect(assessments).toHaveLength(32);
        for (const [id, parameter] of [["A3", "M-trend"], ["A7", "frequency"]]) {
          const candidate = assessments.find(item => item.criterion_assessment_id === `example:clinician-${index}:app-incorporated:${id}`)!;
          expect(candidate.support_criterion_assessment_references).toEqual([`example:clinician-${index}:app-context:${parameter}`]);
          expect(candidate).not.toHaveProperty("support_task_action_references");
        }
        for (const mode of ["standard", "app-incorporated"] as const) {
          const diagnosis = assessments.find(item => item.criterion_setting_reference === definition(mode === "standard" ? "outcome.standard_diagnosis" : "outcome.app_incorporated_diagnosis"))!;
          const candidateIds = [...Array.from({ length: 12 }, (_, i) => `A${i + 1}`), "B1", "B2"].map(id => `example:clinician-${index}:${mode}:${id}`);
          expect(diagnosis.support_criterion_assessment_references).toEqual(candidateIds);
          expect(candidateIds.map(id => assessments.find(item => item.criterion_assessment_id === id)!.criterion_setting_reference)).toEqual(Array(14).fill(definition("protocol.diagnostic_candidate_structure")));
          expect(diagnosis.support_task_action_references).toEqual([row.task_actions![0]!.task_action_id]);
        }
      }
      for (const mutate of [
        (value: typeof source) => { value.task_occurrences[0]!.criterion_assessments![0]!.assessment_value_json = '"absent"'; },
        (value: typeof source) => { value.task_occurrences[0]!.criterion_assessments!.at(-1)!.assessment_value_json = '"positive"'; },
        (value: typeof source) => { value.task_occurrences[3]!.task_questionnaire_responses![0]!.response_value_json = "99.00"; },
        (value: typeof source) => { value.task_occurrences[3]!.criterion_assessments![1]!.assessment_value_json = "-3.75"; },
        (value: typeof source) => { value.task_occurrences[3]!.criterion_assessments![7]!.assessment_value_json = "8.70"; },
        (value: typeof source) => { value.task_occurrences[0]!.criterion_assessments![28]!.assessment_value_json = "8.70"; },
      ]) {
        const changed = structuredClone(source); mutate(changed); const changedExpected = structuredClone(changed.task_occurrences);
        const restored = await roundtrip(changed);
        expect(restored.task_occurrences).toEqual(changedExpected);
        expect(restored.task_occurrences.slice(1, 3)).toEqual(expected.slice(1, 3));
      }
      for (const token of [undefined, null, "null", "0.00"]) {
        const partial = structuredClone(source);
        if (token === undefined) delete partial.task_occurrences[3]!.task_questionnaire_responses![0]!.response_value_json;
        else partial.task_occurrences[3]!.task_questionnaire_responses![0]!.response_value_json = token;
        const partialExpected = structuredClone(partial.task_occurrences);
        expect((await roundtrip(partial)).task_occurrences).toEqual(partialExpected);
      }
      for (const assessor of [undefined, null]) {
        const partial = structuredClone(source);
        if (assessor === undefined) delete partial.task_occurrences[0]!.assessor_id; else partial.task_occurrences[0]!.assessor_id = assessor;
        const partialExpected = structuredClone(partial.task_occurrences);
        expect((await roundtrip(partial)).task_occurrences).toEqual(partialExpected);
      }
      await roundtrip(source); const retained = await loadResearchMethodSelection();
      for (const mutate of [
        (value: typeof source) => { value.task_occurrences[0]!.source_work_id = "foreign"; },
        (value: typeof source) => { value.task_occurrences[0]!.criterion_assessments!.at(-1)!.support_criterion_assessment_references = [value.task_occurrences[1]!.criterion_assessments![0]!.criterion_assessment_id]; },
        (value: typeof source) => { value.task_occurrences[0]!.criterion_assessments!.at(-1)!.support_task_action_references = [value.task_occurrences[1]!.task_actions![0]!.task_action_id]; },
        (value: typeof source) => { value.task_occurrences[0]!.criterion_assessments![16]!.support_criterion_assessment_references = [value.task_occurrences[1]!.criterion_assessments![28]!.criterion_assessment_id]; },
        (value: typeof source) => { value.task_occurrences[0]!.criterion_assessments![16]!.support_criterion_assessment_references = [value.task_occurrences[3]!.criterion_assessments![7]!.criterion_assessment_id]; },
        ...["", " ", 17, {}, []].map(assessor => (value: typeof source) => { Reflect.set(value.task_occurrences[0]!, "assessor_id", assessor); }),
      ]) {
        const invalid = structuredClone(source); mutate(invalid);
        await expect(roundtrip(invalid)).rejects.toThrow();
        expect(await loadResearchMethodSelection()).toBe(retained);
      }
      return;
    }
    if (source.task_occurrences.length === 1) {
      const second = structuredClone(source.task_occurrences[0]!);
      second.task_occurrence_id += ":second-completion";
      second.task_questionnaire_responses![0]!.response_value_json = '"constructed:second-completion-answer"';
      source.task_occurrences.push(second);
    }
    await roundtrip(source);
    const moved = structuredClone(source);
    [moved.task_occurrences[0]!.task_questionnaire_responses, moved.task_occurrences[1]!.task_questionnaire_responses]
      = [moved.task_occurrences[1]!.task_questionnaire_responses, moved.task_occurrences[0]!.task_questionnaire_responses];
    await roundtrip(moved);
    expect(moved.task_occurrences.map(t => t.task_actions)).toEqual(source.task_occurrences.map(t => t.task_actions));
    for (const value of [undefined, null, "null", "0.00", ' "no answer" ']) {
      const partial = structuredClone(source);
      const answer = partial.task_occurrences[0]!.task_questionnaire_responses![0]!;
      if (value === undefined) delete answer.response_value_json; else answer.response_value_json = value;
      await roundtrip(partial);
    }
    for (const value of [undefined, null, []]) {
      const partial = structuredClone(source);
      if (value === undefined) delete partial.task_occurrences[0]!.task_questionnaire_responses; else partial.task_occurrences[0]!.task_questionnaire_responses = value;
      await roundtrip(partial);
    }
    const saved = await roundtrip(source);
    if (workId === "doi:10.1371/journal.pone.0165331") {
      const criterion = (rows: TaskOccurrenceRecord[], id: string, index = 0) => rows[index]!.criterion_assessments!.find(a => a.criterion_assessment_id === `example:direct-screen:${id}`)!;
      for (const row of source.task_occurrences) {
        expect(row.task_questionnaire_responses).toHaveLength(21); expect(row.criterion_assessments).toHaveLength(10);
        for (const field of ["denotes_interval", "referenced_day_token", "task_observation_windows", "task_actions"]) expect(row).not.toHaveProperty(field);
      }
      expect(new Set(source.task_occurrences.map(r => r.participant_id)).size).toBe(2);
      expect(criterion(source.task_occurrences, "poor-sleep").support_criterion_assessment_references).toEqual(["example:direct-screen:psqi-total"]);
      for (const token of [undefined, null, "null", "0.00", "6.00"]) {
        const changed = structuredClone(source), total = criterion(changed.task_occurrences, "psqi-total");
        if (token === undefined) delete total.assessment_value_json; else total.assessment_value_json = token;
        const restored = await roundtrip(changed);
        expect(criterion(restored.task_occurrences, "poor-sleep")).toEqual(criterion(source.task_occurrences, "poor-sleep"));
        expect(restored.task_occurrences[1]).toEqual(source.task_occurrences[1]);
      }
      const height = structuredClone(source);
      height.task_occurrences[0]!.task_questionnaire_responses![2]!.response_value_json = "171.00";
      expect((await roundtrip(height)).task_occurrences[0]!.criterion_assessments).toEqual(source.task_occurrences[0]!.criterion_assessments);
      for (const key of ["analysis.sleep_measure_scaling", "covariate.ordinal_encoding", "feature.screen_time_30_day", "analysis.sleep_relative_windows"]) {
        const invalid = structuredClone(source);
        criterion(invalid.task_occurrences, "bmi").criterion_setting_reference = profile.method_settings.find(s => s.method_parameter_key === key)!.method_setting_id;
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("compatible criterion definition");
      }
      await roundtrip(source); const retained = await loadResearchMethodSelection();
      const foreign = structuredClone(source);
      criterion(foreign.task_occurrences, "psqi-total", 1).criterion_assessment_id = "example:other-only-total";
      criterion(foreign.task_occurrences, "poor-sleep", 1).support_criterion_assessment_references = ["example:other-only-total"];
      criterion(foreign.task_occurrences, "poor-sleep").support_criterion_assessment_references = ["example:other-only-total"];
      await expect(roundtrip(foreign)).rejects.toThrow("within task occurrence");
      expect(await loadResearchMethodSelection()).toBe(retained);
      await roundtrip(source);
    }
    if (workId === "doi:10.3390/bs5040434") {
      const expected = structuredClone(source.task_occurrences);
      const keys = ["phone_use", "incoming_calls", "outgoing_calls", "incoming_sms", "outgoing_sms"];
      const reference = (key: string) => profile.method_settings.find(setting => setting.method_parameter_key === key)!.method_setting_id;
      for (const row of expected) {
        expect(row.task_questionnaire_responses!.slice(0, 5).map(answer => answer.questionnaire_setting_reference)).toEqual(Array(5).fill(reference("collection.self_report_prompt_scope")));
        expect(row.task_questionnaire_responses!.slice(5).map(answer => answer.questionnaire_item_label)).toEqual(Array.from({ length: 27 }, (_, i) => `MPPUS item ${i + 1}`));
        expect(row.task_questionnaire_responses![17]!.questionnaire_setting_reference).toBe(reference("mppus.example_item"));
        expect(row.task_questionnaire_responses![17]!.observed_property).toContain("Printed English example: I find it difficult to switch off my mobile phone");
        expect(row.criterion_assessments!.map(item => item.criterion_setting_reference)).toEqual([reference("mppus.score_range"), ...keys.map(key => reference(`weekly.variable.${key}`))]);
        expect(row.criterion_assessments!.slice(1).every(item => item.criterion_label?.includes("retained-week denominator unknown"))).toBe(true);
        expect(row).not.toHaveProperty("denotes_interval"); expect(row).not.toHaveProperty("referenced_day_token");
      }
      expect(expected.map(row => row.criterion_assessments![0]!.assessment_value_json)).toEqual(["50.00", "70.00"]);
      expect(expected.map(row => row.task_questionnaire_responses![4]!.response_value_json)).toEqual([null, "null"]);
      for (const mutate of [
        (value: typeof source) => { value.task_occurrences[0]!.task_questionnaire_responses![0]!.response_value_json = "99.00"; },
        (value: typeof source) => { value.task_occurrences[0]!.task_questionnaire_responses![5]!.response_value_json = "5"; },
        (value: typeof source) => { value.task_occurrences[0]!.criterion_assessments![0]!.assessment_value_json = "27.00"; },
        (value: typeof source) => { value.task_occurrences[0]!.criterion_assessments![1]!.assessment_value_json = "0.00"; },
        (value: typeof source) => { value.task_occurrences[0]!.task_questionnaire_responses![4]!.response_value_json = "0.00"; },
        (value: typeof source) => { delete value.task_occurrences[0]!.task_questionnaire_responses![4]!.response_value_json; },
      ]) {
        const changed = structuredClone(source); mutate(changed); const changedExpected = structuredClone(changed.task_occurrences);
        const restored = await roundtrip(changed);
        expect(restored.task_occurrences).toEqual(changedExpected);
        expect(restored.task_occurrences[1]).toEqual(expected[1]);
      }
      await roundtrip(source);
    }
    if (workId === "doi:10.1186/s13104-015-1280-z") {
      const method = (key: string): unknown => JSON.parse(String(profile.method_settings.find(s => s.method_parameter_key === key)!.method_value_json));
      const dimensions = ["Extraversion", "Neuroticism", "Openness", "Agreeableness", "Conscientiousness"];
      expect(method("input.personality_instrument")).toBe("BFI-10");
      expect(method("input.personality_items")).toEqual({ items: 10, items_per_dimension: 2, likert_min: 1, likert_max: 5,
        likert_min_label: "disagree strongly", likert_max_label: "agree strongly", dimension_score_min: 2, dimension_score_max: 10 });
      expect(method("input.personality_dimensions")).toEqual(dimensions);
      expect(method("input.demographics")).toEqual(["age", "gender", "education"]);
      for (const row of source.task_occurrences) {
        expect(row.task_questionnaire_responses!.slice(0, 10).map(answer => answer.questionnaire_item_label)).toEqual(Array.from({ length: 10 }, (_, i) => `BFI-10 item ${i + 1}`));
        expect(row.task_questionnaire_responses!.slice(10).map(answer => [answer.observed_property, answer.response_value_json])).toEqual([
          ["age", row === source.task_occurrences[0] ? "29" : "30"], ["gender", null], ["education", "null"],
        ]);
        expect(row.criterion_assessments!.map(criterion => criterion.criterion_label)).toEqual(dimensions);
        expect(row.criterion_assessments!.every(criterion => !Object.hasOwn(criterion, "support_criterion_assessment_references") && !Object.hasOwn(criterion, "support_task_action_references"))).toBe(true);
        expect(row).not.toHaveProperty("denotes_interval"); expect(row).not.toHaveProperty("referenced_day_token");
      }
      expect(source.task_occurrences.map(row => row.criterion_assessments!.map(criterion => criterion.assessment_value_json))).toEqual([["2", "4", "6", "8", "10"], ["10", "8", "6", "4", "2"]]);
      // Published correlation columns use a different order from the methods' dimension listing.
      for (const [key, conscientiousness, openness] of [["result.whatsapp_personality", [-0.13, "<.001"], [-0.01, ".54"]], ["result.facebook_personality", [-0.08, "<.001"], [-0.05, ".03"]]] as const) {
        const table = method(key) as { trait_order: string[]; all: Array<Array<number | string>> };
        expect(table.trait_order).toEqual(["Extraversion", "Neuroticism", "Conscientiousness", "Agreeableness", "Openness"]);
        expect([table.trait_order[2], table.all[2]]).toEqual(["Conscientiousness", conscientiousness]);
        expect([table.trait_order[4], table.all[4]]).toEqual(["Openness", openness]);
      }
      expect(saved.app_feature_sessions![0]!.app_name).toBe("WhatsApp");
      expect(saved.app_feature_sessions![0]).not.toHaveProperty("app_package_name");
      expect(saved.app_feature_sessions![0]!.feature_occurrences).toEqual([]);
      expect(saved.participant_day_observations!.map(row => row.day_observation_value_json)).toEqual(["15.00", "5.00", "0.00"]);
      for (const mutate of [
        (value: typeof source) => { value.task_occurrences[0]!.task_questionnaire_responses![0]!.response_value_json = "5"; },
        (value: typeof source) => { value.task_occurrences[0]!.task_questionnaire_responses![10]!.response_value_json = "41"; },
        (value: typeof source) => { value.task_occurrences[0]!.criterion_assessments![0]!.assessment_value_json = "10"; },
      ]) {
        const changed = structuredClone(source); mutate(changed); const expected = structuredClone(changed.task_occurrences);
        const restored = await roundtrip(changed);
        expect(restored.task_occurrences).toEqual(expected);
        expect(restored.task_occurrences[1]).toEqual(source.task_occurrences[1]);
        expect(restored.app_feature_sessions).toEqual(source.app_feature_sessions);
        expect(restored.participant_day_observations).toEqual(source.participant_day_observations);
      }
      for (const token of [undefined, null, "null"]) {
        const partial = structuredClone(source);
        if (token === undefined) {
          delete partial.task_occurrences[0]!.criterion_assessments![0]!.assessment_value_json;
          delete partial.participant_day_observations![0]!.day_observation_value_json;
        } else {
          partial.task_occurrences[0]!.criterion_assessments![0]!.assessment_value_json = token;
          partial.participant_day_observations![0]!.day_observation_value_json = token;
        }
        const expected = structuredClone(partial);
        const restored = await roundtrip(partial);
        expect(restored.task_occurrences).toEqual(expected.task_occurrences);
        expect(restored.participant_day_observations).toEqual(expected.participant_day_observations);
      }
      await roundtrip(source);
    }
    if (workId === "doi:10.1016/j.smhl.2020.100118") {
      const [first, second, willingness] = source.task_occurrences;
      const method = (key: string): unknown => JSON.parse(String(profile.method_settings.find(s => s.method_parameter_key === key)!.method_value_json));
      expect(source.task_occurrences.map(row => row.task_occurrence_id)).toEqual(["example:moodable-phq-a", "example:moodable-phq-b", "example:moodable-study1-willingness"]);
      expect(method("ground_truth.PHQ9")).toEqual({ items: 9, item_scale: [0, 1, 2, 3], total_range: [0, 27], recall_window_days: 14 });
      expect(method("ground_truth.severity")).toEqual({ table4_bands: ["0-4 minimal", "5-9 mild", "10-14 moderate", "15-19 moderately severe", "20-27 severe"],
        prose_groups: ["0-9 generally healthy", "10-19 mild depression", "20 and above severely depressed"],
        source_conflict: "prose grouping differs from Table 4; neither is selected or reconciled here" });
      expect(method("ground_truth.Q9")).toBe("PHQ-9 question 9 score is the suicidal-ideation target, evaluated at cutoffs 1, 2, and 3");
      expect(method("ground_truth.total_cutoff")).toBe("score above selected cutoff is depressed and score below is not depressed; equality is unreported");
      expect(method("study1.response_scale")).toEqual(["Completely Unwilling", "Somewhat Unwilling", "Unsure", "Somewhat Willing", "Completely Willing"]);
      for (const row of [first!, second!]) {
        expect(row.task_questionnaire_responses!.map(answer => answer.questionnaire_item_label)).toEqual(Array.from({ length: 9 }, (_, i) => `PHQ-9 item ${i + 1}`));
        expect(row.task_questionnaire_responses![8]!.observed_property).toBe("PHQ-9 item 9; suicidal thoughts");
        expect(row).not.toHaveProperty("referenced_day_token"); expect(row).not.toHaveProperty("denotes_interval");
        expect(row.criterion_assessments!.slice(2).map(criterion => criterion.support_criterion_assessment_references)).toEqual([
          ["example:moodable-phq-total"], ["example:moodable-q9-score"], ["example:moodable-phq-total"], ["example:moodable-phq-total"],
        ]);
      }
      expect([first!, second!].map(row => row.criterion_assessments!.map(criterion => criterion.assessment_value_json))).toEqual([
        ["10.00", "2.00", "null", "null", '"moderate"', '"mild depression"'],
        ["20.00", "3.00", '"depressed"', '"above supplied cutoff"', '"severe"', '"severely depressed"'],
      ]);
      expect(first!.criterion_assessments![4]!.criterion_label).toContain("Table 4");
      expect(first!.criterion_assessments![5]!.criterion_label).toContain("prose grouping");
      expect(willingness!.participant_id).not.toBe(first!.participant_id);
      expect(willingness!.task_questionnaire_responses!.map(answer => [answer.observed_property, answer.response_value_json])).toEqual([["willingness to disclose call logs", '"Somewhat Unwilling"']]);
      expect(source).not.toHaveProperty("participant_day_observations");
      for (const change of [
        (value: typeof source) => { value.task_occurrences[0]!.task_questionnaire_responses![8]!.response_value_json = "0.00"; },
        (value: typeof source) => { value.task_occurrences[0]!.criterion_assessments![0]!.assessment_value_json = "17.00"; },
        (value: typeof source) => { value.task_occurrences[0]!.criterion_assessments![1]!.assessment_value_json = "1.00"; },
      ]) {
        const changed = structuredClone(source); change(changed); const expected = structuredClone(changed.task_occurrences);
        const independentlySaved = await roundtrip(changed);
        expect(independentlySaved.task_occurrences).toEqual(expected);
        expect(independentlySaved.task_occurrences.slice(1)).toEqual(source.task_occurrences.slice(1));
        expect(independentlySaved.task_occurrences[0]!.criterion_assessments!.slice(2)).toEqual(first!.criterion_assessments!.slice(2));
      }
      for (const value of [undefined, null, "null", "0.00"]) {
        const partial = structuredClone(source);
        if (value === undefined) delete partial.task_occurrences[0]!.criterion_assessments![2]!.assessment_value_json;
        else partial.task_occurrences[0]!.criterion_assessments![2]!.assessment_value_json = value;
        const expected = structuredClone(partial.task_occurrences); expect((await roundtrip(partial)).task_occurrences).toEqual(expected);
      }
      await roundtrip(source); const retained = await loadResearchMethodSelection();
      const foreign = structuredClone(source);
      foreign.task_occurrences[1]!.criterion_assessments![0]!.criterion_assessment_id = "example:other-task-only-total";
      for (const criterion of foreign.task_occurrences[1]!.criterion_assessments!) {
        criterion.support_criterion_assessment_references = criterion.support_criterion_assessment_references?.map(id => id === "example:moodable-phq-total" ? "example:other-task-only-total" : id);
      }
      foreign.task_occurrences[0]!.criterion_assessments![2]!.support_criterion_assessment_references = ["example:other-task-only-total"];
      expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow("missing assessments within task occurrence");
      for (const support of [["example:moodable-phq-total", "example:moodable-phq-total"], ["example:moodable-total-class"]]) {
        const invalid = structuredClone(source); invalid.task_occurrences[0]!.criterion_assessments![2]!.support_criterion_assessment_references = support;
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("assessments within task occurrence");
      }
      expect(await loadResearchMethodSelection()).toBe(retained);
    }
    if (workId === "doi:10.2196/13209") {
      const [pre, post, comparison] = source.task_occurrences;
      const primary = readFileSync(privateCorpusPath("strict-screen-native-ranks37-73-20260831T0415Z/text/59-loneliness.txt"), "utf8");
      const method = (key: string): unknown => JSON.parse(String(profile.method_settings.find(s => s.method_parameter_key === key)!.method_value_json));
      const instrument = method("survey.instrument") as { items: string[] };
      expect(source.task_occurrences.map(row => row.task_occurrence_id)).toEqual(["example:loneliness-presemester", "example:loneliness-postsemester", "example:loneliness-comparison"]);
      for (const row of [pre!, post!]) {
        expect(row.task_questionnaire_responses!.map(r => r.questionnaire_item_label)).toEqual(instrument.items);
        expect(row.task_questionnaire_responses).toHaveLength(20);
        for (const response of row.task_questionnaire_responses!) expect(primary).toContain(response.questionnaire_item_label!);
        expect(row).not.toHaveProperty("denotes_interval"); expect(row).not.toHaveProperty("referenced_day_token");
      }
      expect(method("survey.response_scale")).toEqual({ minimum: 1, label_min: "never", maximum: 4,
        label_max_in_methods_sentence: "always", labels_in_cutoff_rationale: ["never", "rarely", "sometimes", "often"],
        unresolved_source_difference: "The methods sentence calls response 4 'always'; the later cutoff rationale calls response 4 'often'." });
      expect(method("survey.reverse_scoring")).toEqual({ reverse_scored_one_based_item_numbers: [1, 5, 6, 9, 10, 15, 16, 19, 20], rule: "reverse-score these 9 items before summing all 20" });
      expect(method("outcome.level_change")).toEqual({ decreased: "high pre to low post", increased: "low pre to high post", unchanged: "same binary class" });
      expect(pre!.criterion_assessments!.map(r => r.assessment_value_json)).toEqual(["40.00", '"low"']);
      expect(post!.criterion_assessments!.map(r => r.assessment_value_json)).toEqual(["41.00", '"high"']);
      expect(comparison!.criterion_assessments!.map(r => r.assessment_value_json)).toEqual(['"low"', '"high"', '"increased"']);
      expect(comparison!.criterion_assessments![2]!.support_criterion_assessment_references).toEqual(["example:loneliness-class-presemester", "example:loneliness-class-postsemester"]);
      expect(pre!.task_questionnaire_responses![17]!.response_value_json).toBeNull();
      expect(pre!.task_questionnaire_responses![18]).not.toHaveProperty("response_value_json");
      expect(pre!.task_questionnaire_responses![19]!.response_value_json).toBe("null");
      for (const mutate of [
        (x: typeof source) => { x.task_occurrences[0]!.task_questionnaire_responses![0]!.response_value_json = "4.00"; },
        (x: typeof source) => { x.task_occurrences[0]!.criterion_assessments![0]!.assessment_value_json = "80.00"; },
        (x: typeof source) => { x.task_occurrences[0]!.criterion_assessments![1]!.assessment_value_json = '"high"'; },
        (x: typeof source) => { x.task_occurrences[2]!.criterion_assessments![2]!.assessment_value_json = '"unchanged"'; },
        (x: typeof source) => { x.task_occurrences[2]!.criterion_assessments![0]!.assessment_value_json = '"high"'; },
      ]) {
        const changed = structuredClone(source); mutate(changed);
        const expected = structuredClone(changed.task_occurrences);
        expect((await roundtrip(changed)).task_occurrences).toEqual(expected);
      }
      for (const [rowIndex, assessmentIndex] of [[0, 0], [0, 1], [2, 2]]) for (const token of [undefined, null, "null", "0.00", ' "unknown" ']) {
        const partial = structuredClone(source); const assessment = partial.task_occurrences[rowIndex!]!.criterion_assessments![assessmentIndex!]!;
        if (token === undefined) delete assessment.assessment_value_json; else assessment.assessment_value_json = token;
        await roundtrip(partial);
      }
      for (const supports of [undefined, null, []]) {
        const partial = structuredClone(source); const assessment = partial.task_occurrences[2]!.criterion_assessments![2]!;
        if (supports === undefined) delete assessment.support_criterion_assessment_references; else assessment.support_criterion_assessment_references = supports;
        await roundtrip(partial);
      }
      for (const support of ["foreign", "example:loneliness-total"]) {
        const invalid = structuredClone(source);
        invalid.task_occurrences[2]!.criterion_assessments![2]!.support_criterion_assessment_references = [support];
        await expect(roundtrip(invalid)).rejects.toThrow();
      }
      await roundtrip(source);
    }
    if (workId === "doi:10.2196/55999") {
      const changed = structuredClone(source);
      changed.task_occurrences[1]!.criterion_assessments![1]!.assessment_value_json = "0.00";
      const independentlySaved = await roundtrip(changed);
      expect(independentlySaved.task_occurrences[0]).toEqual(source.task_occurrences[0]);
      expect(independentlySaved.screen_text_captures).toEqual(source.screen_text_captures);
      expect(independentlySaved.participant_day_observations).toEqual(source.participant_day_observations);
      await roundtrip(source);
    }
    if (workId === "doi:10.1016/j.smhl.2018.07.005") {
      const codebook = readFileSync(privateCorpusPath("corrective-packet-04-ranks-074-123-20260831/text/107-codebook.txt"), "utf8");
      expect(createHash("sha256").update(codebook).digest("hex")).toBe("fb56fea1caf226b8d3a9f5a9ef593854bd2793f196c6c4e4d231eb336840137b");
      type Item = { item_label: string; question: string; response_type: string; minimum?: number; maximum?: number; minimum_label?: string; maximum_label?: string; choices?: string[]; locator: string; optional_input_for_choice?: string };
      const allItems: Item[] = [];
      for (const key of ["ema.rt_schema", "ema.eod_schema", "ema.after_call_schema"]) {
        const definition = profile.method_settings.find(s => s.method_parameter_key === key)!;
        const body = JSON.parse(String(definition.method_value_json)) as { items: number; item_definitions: Item[]; multi_select?: string[] };
        allItems.push(...body.item_definitions);
        for (const item of body.item_definitions) {
          const [start, end] = item.locator.split(":")[1]!.split("-").map(Number);
          const passage = codebook.split("\n").slice(start! - 1, end).join(" ").replace(/\b(?:RT|EOD|AC)\d+\b/g, "").replace(/\[0,100\]/g, "").replace(/\s+/g, " ");
          for (const wording of [item.question, item.minimum_label, item.maximum_label, ...(item.choices ?? [])].filter((s): s is string => s !== undefined)) expect(passage, item.item_label).toContain(wording);
          if (item.response_type === "slider") expect([item.minimum, item.maximum]).toEqual([0, 100]);
          expect(item).not.toHaveProperty("step");
          expect(item).not.toHaveProperty("scale_points");
        }
        const wrapped = structuredClone(source);
        wrapped.profiles[0]!.method_settings.find(s => s.method_setting_id === definition.method_setting_id)!.method_value_json = JSON.stringify({ definition: body, source_facing_role: "diary_schema", source_facing_target: "diary_item" });
        await roundtrip(wrapped);
        const invalidBodies: unknown[] = [
          { instrument: "decoy", dimensions: ["decoy"], scale_points: 5 },
          { ...body, items: 0 }, { ...body, item_definitions: body.item_definitions.slice(1) },
          { ...body, item_definitions: [body.item_definitions[1], ...body.item_definitions.slice(1)] },
          ...["question", "locator", "response_type"].map(field => ({ ...body, item_definitions: [{ ...body.item_definitions[0], [field]: "" }, ...body.item_definitions.slice(1)] })),
          ...["minimum", "maximum", "minimum_label", "maximum_label", "choices", "optional_input_for_choice"].map(field => ({ ...body, item_definitions: body.item_definitions.map(item => ({ ...item, [field]: null })) })),
        ];
        // EOD has no choice/input fields; extra documentary fields do not change its slider shape.
        for (const bad of invalidBodies.slice(0, key === "ema.eod_schema" ? -2 : undefined)) {
          const invalid = structuredClone(source);
          invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === definition.method_setting_id)!.method_value_json = JSON.stringify(bad);
          expect(() => parseStudyMethodProfileLibrary(invalid), key).toThrow("compatible response-scale definition");
        }
        for (const extra of key === "ema.eod_schema" ? [{ all: "integer-coded 101-point scale" }] : [
          { multi_select: ["RT9"] }, { single_select: [] }, { numeric_0_100: ["RT9", "foreign"] },
          { multi_select: [...body.multi_select!, key === "ema.rt_schema" ? "RT9" : "AC1"] },
          { multi_select: [...body.multi_select!, body.multi_select![0]!] },
          ...(key === "ema.rt_schema" ? [{ other_optional: ["RT4"] }] : []),
        ]) {
          const invalid = structuredClone(source);
          invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === definition.method_setting_id)!.method_value_json = JSON.stringify({ ...body, ...extra });
          expect(() => parseStudyMethodProfileLibrary(invalid), key).toThrow("compatible response-scale definition");
        }
      }
      expect(allItems).toHaveLength(38);
      // Independently compared with every printed item/choice in the pinned codebook;
      // this pin also catches shortened text and omitted choices that substring checks cannot.
      expect(createHash("sha256").update(JSON.stringify(allItems)).digest("hex")).toBe("23c8469ecd27bd2db136cedcd1f794dda7740708e43772e1d2108f9e4ca6eac8");
      expect(allItems.filter(i => i.response_type === "slider")).toHaveLength(32);
      expect(allItems.filter(i => i.response_type === "multi_select")).toHaveLength(4);
      expect(allItems.filter(i => i.response_type === "single_select")).toHaveLength(2);
      expect(allItems.filter(i => i.optional_input_for_choice).map(i => i.item_label)).toEqual(["RT10"]);
      expect(source.task_occurrences.slice(0, 3).flatMap(t => t.task_questionnaire_responses)).toHaveLength(38);
      const changed = structuredClone(source);
      changed.task_occurrences[3]!.task_questionnaire_responses![1]!.response_value_json = "100.0";
      const independentlySaved = await roundtrip(changed);
      expect(independentlySaved.task_occurrences.slice(0, 3)).toEqual(source.task_occurrences.slice(0, 3));
      expect(independentlySaved.task_occurrences[3]!.task_actions).toEqual(source.task_occurrences[3]!.task_actions);
      await roundtrip(source);
    }
    const responseOnlyInput = () => {
      const value = structuredClone(source);
      value.task_occurrences.forEach(t => { delete t.criterion_assessments; });
      return value;
    };
    const refs = new Set(source.task_occurrences.flatMap(t => t.task_questionnaire_responses?.map(a => a.questionnaire_setting_reference) ?? []));
    for (const ref of refs) {
      const original = profile.method_settings.find(s => s.method_setting_id === ref)!;
      const value = JSON.parse(String(original.method_value_json)) as Record<string, unknown>;
      const body = Object.hasOwn(value, "definition") ? value.definition : value;
      const wrapper = Object.hasOwn(value, "definition") ? value
        : { definition: body, source_facing_role: original.method_setting_role, source_facing_target: original.method_target_layer };
      for (const bad of [undefined, null, "foreign"]) for (const field of ["source_facing_role", "source_facing_target"]) {
        const invalid = responseOnlyInput();
        invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!.method_value_json = JSON.stringify({ ...wrapper, [field]: bad });
        expect(() => parseStudyMethodProfileLibrary(invalid), `${String(original.method_parameter_key)} ${field}`).toThrow("compatible response-scale definition");
        if (!Object.hasOwn(value, "definition") && bad !== undefined) {
          invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!.method_value_json = JSON.stringify({ ...(body as object), [field]: bad });
          expect(() => parseStudyMethodProfileLibrary(invalid), `flat ${field}`).toThrow("compatible response-scale definition");
        }
      }
      for (const bad of [null, "instrument invitation", [], {}, { instrument: "" }, { rows: [["Q1", "label"]], points: "5" }]) {
        const invalid = responseOnlyInput();
        invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!.method_value_json = JSON.stringify({ ...(body as object), ...wrapper, definition: bad });
        expect(() => parseStudyMethodProfileLibrary(invalid), String(original.method_parameter_key)).toThrow("compatible response-scale definition");
      }
      for (const field of ["method_setting_role", "method_target_layer"]) {
        const invalid = responseOnlyInput();
        Reflect.set(invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!, field, field === "method_setting_role" ? "reporting" : "outcome");
        expect(() => parseStudyMethodProfileLibrary(invalid), String(original.method_parameter_key)).toThrow();
      }
      const rowBody = body as Record<string, unknown>;
      const malformedColumns = Object.hasOwn(rowBody, "row_fields") ? [
        { row_fields: ["printed_item"] }, { row_fields: ["id", "label", "wording", "extra"] }, { row_fields: ["id", "id", "wording"] },
      ] : [];
      const malformedEndpoints = Object.hasOwn(rowBody, "endpoints") ? [{ endpoints: ["only one"] }] : [];
      const malformedRows = Array.isArray(rowBody.rows) ? [
        { rows: [rowBody.rows[0], rowBody.rows[0]] }, { rows: [["Q1"]] }, { points: "5" },
      ] : [];
      for (const fields of [...malformedColumns, ...malformedEndpoints, ...malformedRows]) {
        const invalid = responseOnlyInput();
        invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!.method_value_json = JSON.stringify({ ...wrapper, definition: { ...rowBody, ...fields } });
        expect(() => parseStudyMethodProfileLibrary(invalid), String(original.method_parameter_key)).toThrow("compatible response-scale definition");
      }
    }
    for (const bad of ["unknown-definition", profile.method_settings.find(s => !refs.has(s.method_setting_id))!.method_setting_id]) {
      const invalid = responseOnlyInput();
      invalid.task_occurrences[0]!.task_questionnaire_responses![0]!.questionnaire_setting_reference = bad;
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("compatible response-scale definition");
    }
    expect(JSON.parse((await loadResearchMethodSelection())!)).toEqual(saved);
    expect(saved.profile).toEqual(profile);
    if (source.participant_day_observations) {
      const changed = structuredClone(source);
      changed.participant_day_observations![0]!.day_observation_value_json = "0.00";
      expect((await roundtrip(changed)).participant_day_observations![1]).toEqual(source.participant_day_observations[1]);
      expect(changed.task_occurrences).toEqual(source.task_occurrences);
      changed.participant_day_observations!.push(...structuredClone(source.participant_day_observations).map(row => ({ ...row,
        ...(Object.hasOwn(row, "referenced_hour_token") ? { referenced_hour_token: "example:another-hour" } : { referenced_day_token: "example:another-day" }),
      })));
      await roundtrip(changed); // IDs are local to the explicitly supplied day, never inferred from night actions.
      for (const value of [undefined, null, "null", "0.00"]) {
        const partial = structuredClone(source);
        partial.participant_day_observations![0]!.day_observation_value_json = value;
        if (value === undefined) delete partial.participant_day_observations![0]!.day_observation_value_json;
        await roundtrip(partial);
      }
      const invalid = structuredClone(source);
      invalid.participant_day_observations!.push(structuredClone(invalid.participant_day_observations![0]!));
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("duplicated within profile/participant/referenced period");
      invalid.participant_day_observations!.pop();
      invalid.participant_day_observations![0]!.source_work_id = "foreign";
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("no matching profile/source owner");
    }
    if (workId === "doi:10.1145/2470654.2481345") {
      const night = source.task_occurrences.at(-1)!;
      expect(night.task_actions!.filter(a => a.action_label === "App-emitted tone")).toHaveLength(2);
      expect(night.task_actions!.filter(a => a.action_label === "Touch screen")).toHaveLength(1);
      expect(night.task_actions!.every(a => !Object.hasOwn(a, "denotes_interval"))).toBe(true);
      const duplicateAction = structuredClone(source);
      duplicateAction.task_occurrences.at(-1)!.task_actions!.push(structuredClone(night.task_actions![0]!));
      expect(() => parseStudyMethodProfileLibrary(duplicateAction)).toThrow("duplicated within its owner");
    }
    if (source.device_use_sessions) {
      const session = source.device_use_sessions[0]!;
      const changed = structuredClone(source);
      changed.device_use_sessions![0]!.session_actions!.reverse();
      changed.task_occurrences.at(-1)!.denotes_interval = { duration_seconds: 0 };
      changed.device_use_sessions!.push({ ...structuredClone(session), device_use_session_id: "example:second-session", denotes_interval: { duration_seconds: 45 },
        session_actions: [structuredClone(session.session_actions![0]!)] });
      await roundtrip(changed);
      expect(changed.notification_histories).toEqual(source.notification_histories);
      expect(changed.task_occurrences.slice(0, -1)).toEqual(source.task_occurrences.slice(0, -1));
      const invalids: Array<(value: typeof source) => void> = [
        v => { v.device_use_sessions![0]!.start_condition = "unlock"; },
        v => { v.device_use_sessions![0]!.end_condition = "lock"; },
        v => { v.device_use_sessions![0]!.source_work_id = "foreign"; },
        v => { v.device_use_sessions![0]!.session_actions!.push(structuredClone(session.session_actions![0]!)); },
        v => { v.notification_histories![0]!.notification_evidence[0]!.evidence_references = [v.task_occurrences[0]!.task_occurrence_id]; },
      ];
      const definition = profile.method_settings.find(s => s.method_setting_id === session.method_setting_reference)!;
      const wrapper = JSON.parse(String(definition.method_value_json)) as Record<string, unknown>;
      for (const field of ["definition", "source_facing_role", "source_facing_target"]) for (const bad of [undefined, null, "foreign", {}]) {
        invalids.push(v => { v.profiles[0]!.method_settings.find(s => s.method_setting_id === definition.method_setting_id)!.method_value_json = JSON.stringify({ ...wrapper, [field]: bad }); });
      }
      for (const mutate of invalids) {
        const invalid = structuredClone(source); mutate(invalid);
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
      }
      await roundtrip(source);
    }
    if (workId.endsWith("2406384")) {
      const unknownInstrument = structuredClone(source);
      unknownInstrument.profiles[0]!.method_settings.find(setting => setting.method_parameter_key === "usability.pssuq")!.method_parameter_key = "usability.undeclared_instrument";
      expect(() => parseStudyMethodProfileLibrary({ profiles: unknownInstrument.profiles })).not.toThrow();
      expect(() => parseStudyMethodProfileLibrary(unknownInstrument)).toThrow("compatible response-scale definition");
      const attempt = source.task_occurrences[2]!;
      expect(attempt.criterion_assessments![0]!.support_task_action_references).toEqual([attempt.task_actions![1]!.task_action_id, attempt.task_actions![4]!.task_action_id]);
      expect(attempt.criterion_assessments![0]!.support_task_action_references).not.toContain(attempt.task_actions![5]!.task_action_id);
      expect(source.task_occurrences[0]!.task_questionnaire_responses!.slice(1).map(a => a.questionnaire_item_label)).toEqual(["PSSUQ item 2", "PSSUQ item 2"]);
      for (const [index, task] of source.task_occurrences.entries()) for (const [assessmentIndex, assessment] of (task.criterion_assessments ?? []).entries()) {
        for (const support of [["foreign"], [source.task_occurrences[0]!.task_occurrence_id], [task.task_actions![0]!.task_action_id, task.task_actions![0]!.task_action_id]]) {
          const invalid = structuredClone(source);
          invalid.task_occurrences[index]!.criterion_assessments![assessmentIndex]!.support_task_action_references = support;
          expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("duplicate or missing actions within task occurrence");
        }
        for (const body of ["wrong metric", { invitation: "measurement" }, null]) {
          const invalid = structuredClone(source);
          invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === assessment.criterion_setting_reference)!.method_value_json = JSON.stringify(body);
          expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("compatible criterion definition");
        }
        for (const field of ["source_facing_role", "source_facing_target"]) for (const bad of [undefined, null, "foreign"]) {
          const invalid = structuredClone(source);
          const setting = invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === assessment.criterion_setting_reference)!;
          setting.method_value_json = JSON.stringify({ definition: JSON.parse(String(setting.method_value_json)) as unknown,
            source_facing_role: setting.method_setting_role, source_facing_target: setting.method_target_layer, [field]: bad });
          expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("compatible criterion definition");
        }
      }
    }
  });
}

itWithPrivateCorpus("preserves supplied assessor identity separately from the assessed participant and unknown identity", async () => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = library.profiles.find(p => p.source_work_id === "doi:10.4088/jcp.15m10310")!;
  const source = { profiles: [profile], task_occurrences: [0, 1, 2].map(index => ({
    task_occurrence_id: `example:clinician-task-${index}`, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "example:assessed-participant", assessor_id: `example:clinician-${index}`,
    record_origin: "analyst_constructed_example", task_label: "Independent supplied clinician assessment",
    source_locators: ["App Measures primary153–158,240–248; three supplied clinician identities, not recovered rater IDs"],
  })) };
  const roundtrip = async (value: unknown) => {
    const parsed = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], task_occurrences: parsed.task_occurrences }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile; task_occurrences: TaskOccurrenceRecord[] };
    return parseStudyMethodProfileLibrary({ profiles: [saved.profile], task_occurrences: saved.task_occurrences }).task_occurrences;
  };
  const expected = structuredClone(source.task_occurrences);
  expect(await roundtrip(source)).toEqual(expected);
  for (const token of [undefined, null, "example:other-clinician"]) {
    const changed = structuredClone(source);
    if (token === undefined) Reflect.deleteProperty(changed.task_occurrences[0]!, "assessor_id");
    else Reflect.set(changed.task_occurrences[0]!, "assessor_id", token);
    expect(await roundtrip(changed)).toEqual(changed.task_occurrences);
    expect(changed.task_occurrences.map(row => row.participant_id)).toEqual(expected.map(row => row.participant_id));
  }
  await roundtrip(source); const retained = await loadResearchMethodSelection();
  for (const token of ["", " ", 0, false, {}, []]) {
    const invalid = structuredClone(source); Reflect.set(invalid.task_occurrences[0]!, "assessor_id", token);
    await expect(roundtrip(invalid)).rejects.toThrow("assessor_id");
    expect(await loadResearchMethodSelection()).toBe(retained);
  }
});

itWithPrivateCorpus.each([
  ["doi:10.3390/bs5040434", "collection.self_report_prompt_scope", "response"],
  ["doi:10.3390/bs5040434", "mppus.instrument", "response"], ["doi:10.3390/bs5040434", "mppus.example_item", "response"],
  ["doi:10.3390/bs5040434", "mppus.score_range", "criterion"], ["doi:10.3390/bs5040434", "weekly.variable.phone_use", "criterion"],
  ["doi:10.3390/bs5040434", "weekly.variable.incoming_calls", "criterion"], ["doi:10.3390/bs5040434", "weekly.variable.outgoing_calls", "criterion"],
  ["doi:10.3390/bs5040434", "weekly.variable.incoming_sms", "criterion"], ["doi:10.3390/bs5040434", "weekly.variable.outgoing_sms", "criterion"],
  ["doi:10.4088/jcp.15m10310", "outcome.standard_diagnosis", "criterion"], ["doi:10.4088/jcp.15m10310", "outcome.app_incorporated_diagnosis", "criterion"],
  ["doi:10.4088/jcp.15m10310", "protocol.diagnostic_candidate_structure", "criterion"],
  ["doi:10.4088/jcp.15m10310", "protocol.app_information_for_interview", "response"], ["doi:10.4088/jcp.15m10310", "protocol.app_information_for_interview", "criterion"],
  ["doi:10.4088/jcp.15m10310", "aggregation.monthly_mean_features", "criterion"], ["doi:10.4088/jcp.15m10310", "analysis.emd_trend_outputs", "criterion"],
] as const)("admits %s %s on its isolated %s owner", (workId, key, kind) => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = library.profiles.find(p => p.source_work_id === workId)!;
  const source = { profiles: [profile], task_occurrences: taskInstrumentExamples(profile).task_occurrences };
  const setting = profile.method_settings.find(s => s.method_parameter_key === key)!;
  const owner = source.task_occurrences.find(row => kind === "response"
    ? row.task_questionnaire_responses?.some(item => item.questionnaire_setting_reference === setting.method_setting_id)
    : row.criterion_assessments?.some(item => item.criterion_setting_reference === setting.method_setting_id))!;
  const row = structuredClone(owner); delete row.task_questionnaire_responses; delete row.criterion_assessments;
  if (kind === "response") row.task_questionnaire_responses = [structuredClone(owner.task_questionnaire_responses!.find(item => item.questionnaire_setting_reference === setting.method_setting_id)!)];
  else {
    const criterion = structuredClone(owner.criterion_assessments!.find(item => item.criterion_setting_reference === setting.method_setting_id)!);
    delete criterion.support_criterion_assessment_references; row.criterion_assessments = [criterion];
  }
  source.task_occurrences = [row]; const expected = structuredClone(source.task_occurrences);
  expect(parseStudyMethodProfileLibrary(source).task_occurrences).toEqual(expected);
  const body: unknown = JSON.parse(String(setting.method_value_json));
  const clinical = key === "protocol.diagnostic_candidate_structure" || key.startsWith("outcome.");
  const wrapper = { definition: body, source_facing_role: clinical ? "input_schema" : setting.method_setting_role, source_facing_target: setting.method_target_layer };
  const wrapped = structuredClone(source); wrapped.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!.method_value_json = JSON.stringify(wrapper);
  expect(parseStudyMethodProfileLibrary(wrapped).task_occurrences).toEqual(expected);
  const drift = Array.isArray(body) ? body.slice(1) : typeof body === "string" ? `${body} changed` : { ...(body as Record<string, unknown>), invented_definition_member: true };
  for (const content of [
    { ...wrapper, definition: null }, { ...wrapper, definition: {} }, { ...wrapper, definition: drift },
    ...(["source_facing_role", "source_facing_target"] as const).flatMap(field => [undefined, null, "foreign"].map(value => ({ ...wrapper, [field]: value }))),
    ...(clinical ? [{ ...wrapper, source_facing_role: "participant_schema" }] : []),
  ]) {
    const invalid = structuredClone(source); invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!.method_value_json = JSON.stringify(content);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/compatible .*definition/);
  }
  if (key !== "protocol.app_information_for_interview") {
    const wrongKind = structuredClone(source); delete wrongKind.task_occurrences[0]!.task_questionnaire_responses; delete wrongKind.task_occurrences[0]!.criterion_assessments;
    if (kind === "response") wrongKind.task_occurrences[0]!.criterion_assessments = [{ criterion_assessment_id: "example:wrong-kind", criterion_setting_reference: setting.method_setting_id,
      criterion_label: "Constructed invalid criterion", assessment_value_json: "1", source_locators: row.source_locators }];
    else wrongKind.task_occurrences[0]!.task_questionnaire_responses = [{ questionnaire_response_id: "example:wrong-kind", questionnaire_setting_reference: setting.method_setting_id,
      observed_property: "Constructed invalid response", response_value_json: "1", source_locators: row.source_locators }];
    expect(() => parseStudyMethodProfileLibrary(wrongKind)).toThrow(/compatible .*definition/);
  }
  const transplanted = structuredClone(source); transplanted.profiles[0]!.source_work_id = "doi:10.1186/s13104-015-1280-z";
  transplanted.task_occurrences[0]!.source_work_id = transplanted.profiles[0]!.source_work_id;
  expect(() => parseStudyMethodProfileLibrary({ profiles: transplanted.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(transplanted)).toThrow(/compatible .*definition/);
});

itWithPrivateCorpus.each([
  ["input.personality_instrument", "response"], ["input.personality_items", "response"],
  ["input.personality_dimensions", "criterion"], ["input.demographics", "response"],
] as const)("admits WhatsApp %s on its isolated %s owner with exact source tuple", (key, kind) => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = library.profiles.find(p => p.source_work_id === "doi:10.1186/s13104-015-1280-z")!;
  const source = { profiles: [profile], task_occurrences: taskInstrumentExamples(profile).task_occurrences };
  const setting = profile.method_settings.find(s => s.method_parameter_key === key)!;
  const owner = source.task_occurrences.find(row => kind === "response"
    ? row.task_questionnaire_responses?.some(item => item.questionnaire_setting_reference === setting.method_setting_id)
    : row.criterion_assessments?.some(item => item.criterion_setting_reference === setting.method_setting_id))!;
  const row = structuredClone(owner); delete row.task_questionnaire_responses; delete row.criterion_assessments;
  if (kind === "response") row.task_questionnaire_responses = [structuredClone(owner.task_questionnaire_responses!.find(item => item.questionnaire_setting_reference === setting.method_setting_id)!)];
  else row.criterion_assessments = [structuredClone(owner.criterion_assessments!.find(item => item.criterion_setting_reference === setting.method_setting_id)!)];
  source.task_occurrences = [row];
  const expected = structuredClone(source.task_occurrences);
  expect(parseStudyMethodProfileLibrary(source).task_occurrences).toEqual(expected);
  const body: unknown = JSON.parse(String(setting.method_value_json));
  const wrapper = { definition: body, source_facing_role: "input_schema", source_facing_target: "participant" };
  const wrapped = structuredClone(source);
  wrapped.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!.method_value_json = JSON.stringify(wrapper);
  expect(parseStudyMethodProfileLibrary(wrapped).task_occurrences).toEqual(expected);
  const drift = key === "input.personality_instrument" ? "BFI-44"
    : key === "input.personality_items" ? { ...(body as Record<string, unknown>), likert_min_label: "agree strongly" }
    : (body as string[]).slice(0, -1);
  for (const content of [
    ...(["source_facing_role", "source_facing_target"] as const).flatMap(field =>
      [undefined, null].map(value => ({ ...wrapper, [field]: value }))),
    { ...wrapper, definition: null }, { ...wrapper, definition: {} }, { ...wrapper, definition: drift },
    { ...wrapper, source_facing_role: "provenance" }, { ...wrapper, source_facing_target: "raw_record" },
    { ...wrapper, source_facing_role: setting.method_setting_role, source_facing_target: setting.method_target_layer },
  ]) {
    const invalid = structuredClone(source);
    invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!.method_value_json = JSON.stringify(content);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/compatible .*definition/);
  }
  for (const [field, value] of [["method_setting_role", "provenance"], ["method_target_layer", "raw_record"]] as const) {
    const invalid = structuredClone(source);
    Reflect.set(invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!, field, value);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/compatible .*definition/);
  }
  // Profile and occurrence agree; rejection must be actual source compatibility.
  const transplanted = structuredClone(source);
  transplanted.profiles[0]!.source_work_id = "doi:10.1016/j.smhl.2020.100118";
  transplanted.task_occurrences[0]!.source_work_id = transplanted.profiles[0]!.source_work_id;
  expect(parseStudyMethodProfileLibrary({ profiles: transplanted.profiles }).profiles).toHaveLength(1);
  expect(() => parseStudyMethodProfileLibrary(transplanted)).toThrow(/compatible .*definition/);
});

itWithPrivateCorpus.each([
  ["ground_truth.PHQ9", "response"], ["ground_truth.PHQ9", "criterion"], ["study1.response_scale", "response"],
  ["ground_truth.Q9", "criterion"], ["ground_truth.total_cutoff", "criterion"], ["ground_truth.severity", "criterion"],
] as const)("admits Moodable %s on its isolated %s owner with exact source tuple", (key, kind) => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = library.profiles.find(p => p.source_work_id === "doi:10.1016/j.smhl.2020.100118")!;
  const source = { profiles: [profile], ...taskInstrumentExamples(profile) };
  const setting = profile.method_settings.find(s => s.method_parameter_key === key)!;
  const owner = source.task_occurrences.find(row => kind === "response"
    ? row.task_questionnaire_responses?.some(item => item.questionnaire_setting_reference === setting.method_setting_id)
    : row.criterion_assessments?.some(item => item.criterion_setting_reference === setting.method_setting_id))!;
  const row = structuredClone(owner); delete row.task_questionnaire_responses; delete row.criterion_assessments;
  if (kind === "response") row.task_questionnaire_responses = [structuredClone(owner.task_questionnaire_responses!.find(item => item.questionnaire_setting_reference === setting.method_setting_id)!)];
  else {
    const criterion = structuredClone(owner.criterion_assessments!.find(item => item.criterion_setting_reference === setting.method_setting_id)!);
    delete criterion.support_criterion_assessment_references; row.criterion_assessments = [criterion];
  }
  source.task_occurrences = [row];
  expect(parseStudyMethodProfileLibrary(source).task_occurrences).toEqual(source.task_occurrences);
  const body: unknown = JSON.parse(String(setting.method_value_json));
  const wrapper = { definition: body,
    source_facing_role: key === "ground_truth.PHQ9" || key === "study1.response_scale" ? "input_schema" : "classification",
    source_facing_target: key === "study1.response_scale" ? "survey_response" : key === "ground_truth.severity" ? "PHQ9_total" : "participant_label" };
  const wrapped = structuredClone(source);
  wrapped.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!.method_value_json = JSON.stringify(wrapper);
  expect(parseStudyMethodProfileLibrary(wrapped).task_occurrences).toEqual(source.task_occurrences);
  const drift = key === "ground_truth.PHQ9" ? { ...(body as Record<string, unknown>), items: 8 }
    : key === "study1.response_scale" ? (body as string[]).slice(0, 4)
    : key === "ground_truth.Q9" ? "PHQ-9 question 9 score evaluated at cutoffs 0, 1, and 2"
    : key === "ground_truth.total_cutoff" ? "score at or above selected cutoff is depressed"
    : { ...(body as Record<string, unknown>), source_conflict: "prose and Table 4 are equivalent" };
  for (const content of [
    { ...wrapper, definition: null }, { ...wrapper, definition: {} }, { ...wrapper, definition: drift },
    { ...wrapper, source_facing_role: "provenance" }, { ...wrapper, source_facing_target: "raw_record" },
    { ...wrapper, source_facing_role: setting.method_setting_role, source_facing_target: setting.method_target_layer },
  ]) {
    const invalid = structuredClone(source);
    invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!.method_value_json = JSON.stringify(content);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/compatible .*definition/);
  }
  for (const [field, value] of [["method_setting_role", "provenance"], ["method_target_layer", "raw_record"]] as const) {
    const invalid = structuredClone(source); Reflect.set(invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!, field, value);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
});

itWithPrivateCorpus.each(["survey.instrument", "survey.total_score", "outcome.binary_loneliness", "outcome.level_change"])("admits loneliness %s independently with exact original source tuple", key => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = library.profiles.find(p => p.source_work_id === "doi:10.2196/13209")!;
  const source = { profiles: [profile], ...taskInstrumentExamples(profile) };
  const setting = profile.method_settings.find(s => s.method_parameter_key === key)!;
  const instrument = key === "survey.instrument";
  const owner = source.task_occurrences.find(row => instrument
    ? row.task_questionnaire_responses?.some(r => r.questionnaire_setting_reference === setting.method_setting_id)
    : row.criterion_assessments?.some(r => r.criterion_setting_reference === setting.method_setting_id))!;
  const row = structuredClone(owner);
  delete row.task_questionnaire_responses; delete row.criterion_assessments;
  if (instrument) row.task_questionnaire_responses = [structuredClone(owner.task_questionnaire_responses![0]!)];
  else {
    const assessment = structuredClone(owner.criterion_assessments!.find(r => r.criterion_setting_reference === setting.method_setting_id)!);
    delete assessment.support_criterion_assessment_references;
    row.criterion_assessments = [assessment];
  }
  source.task_occurrences = [row];
  expect(parseStudyMethodProfileLibrary(source).task_occurrences).toEqual(source.task_occurrences);
  const body = JSON.parse(String(setting.method_value_json)) as Record<string, unknown>;
  const wrapper = { definition: body, source_facing_role: instrument ? "input_schema" : "feature_engineering", source_facing_target: instrument ? "diary_response" : "outcome" };
  const wrapped = structuredClone(source);
  wrapped.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!.method_value_json = JSON.stringify(wrapper);
  expect(parseStudyMethodProfileLibrary(wrapped).task_occurrences).toEqual(source.task_occurrences);
  const drift = key === "survey.instrument" ? { ...body, items: (body.items as string[]).slice(1) }
    : key === "survey.total_score" ? { ...body, range: [0, 80] }
    : key === "outcome.binary_loneliness" ? { ...body, low: "score < 40" }
    : { ...body, increased: "high pre to low post" };
  for (const content of [
    { ...wrapper, definition: null }, { ...wrapper, definition: {} }, { ...wrapper, definition: drift },
    { ...wrapper, source_facing_role: "provenance" }, { ...wrapper, source_facing_target: "raw_record" },
    ...(instrument ? [{ ...wrapper, source_facing_role: "participant_schema", source_facing_target: "participant_measure" }] : []),
  ]) {
    const invalid = structuredClone(source);
    invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!.method_value_json = JSON.stringify(content);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/compatible .*definition/);
  }
  for (const [field, value] of [["method_setting_role", "provenance"], ["method_target_layer", "raw_record"]] as const) {
    const invalid = structuredClone(source);
    Reflect.set(invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!, field, value);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
});

itWithPrivateCorpus("preserves JMIR55999 distinct item groups and independent sums without calculating or inferring response codes", () => {
  const base = privateCorpusPath("ontology-sublation-20260831");
  const library = JSON.parse(readFileSync(resolve(base, "adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = library.profiles.find(p => p.source_work_id === "doi:10.2196/55999")!;
  const input = { profiles: [profile], task_occurrences: taskInstrumentExamples(profile).task_occurrences };
  expect(parseStudyMethodProfileLibrary(input).task_occurrences).toEqual(input.task_occurrences);
  const setting = profile.method_settings.find(s => s.method_parameter_key === "ema.suicide")!;
  const body = JSON.parse(String(setting.method_value_json)) as { scale_points: number; groups: Array<{ construct: string; temporal_context: string; items: Array<{ question: string; kind?: string }>; aggregation: string; factor_count?: number }> };
  expect(body.scale_points).toBe(5);
  expect(body.groups.map(g => [g.construct, g.temporal_context, g.items.length, g.aggregation])).toEqual([
    ["suicidal ideation", "In this moment…", 4, "sum"], ["suicidal planning", "since the last prompt", 3, "sum"], ["suicidal desire", "momentary", 2, "sum"],
  ]);
  expect(body.groups[0]!.factor_count).toBe(1);
  expect(body.groups[0]!.items.map(i => i.kind)).toEqual(["passive", "passive", "active", "active"]);
  expect(input.task_occurrences[0]!.task_questionnaire_responses!.filter(a => a.questionnaire_setting_reference === setting.method_setting_id).map(a => a.questionnaire_item_label))
    .toEqual(body.groups.flatMap(g => g.items.map(i => i.question)));
  const supplementary = ["ema.affect", "ema.theoretical", "ema.empirical", "ema.daily"].map(key => profile.method_settings.find(s => s.method_parameter_key === key)!);
  expect(supplementary.map(s => input.task_occurrences.flatMap(t => t.task_questionnaire_responses ?? []).filter(a => a.questionnaire_setting_reference === s.method_setting_id).length)).toEqual([40, 10, 6, 7]);
  expect(input.task_occurrences.slice(2).map(t => [t.task_actions![0]!.action_label, t.task_questionnaire_responses!.length])).toEqual([
    ["First EMA prompt of supplied day", 4], ["Last EMA prompt of supplied day", 3],
  ]);
  for (const definition of supplementary) {
    const disclosed = JSON.parse(String(definition.method_value_json)) as Record<string, unknown>;
    for (const field of Object.keys(disclosed).filter(key => disclosed[key] !== null)) {
      const invalid = structuredClone(input);
      invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === definition.method_setting_id)!.method_value_json = JSON.stringify({ ...disclosed, [field]: null });
      expect(() => parseStudyMethodProfileLibrary(invalid), `${String(definition.method_parameter_key)}.${field}`).toThrow("compatible response-scale definition");
    }
  }
  const affect = JSON.parse(String(supplementary[0]!.method_value_json)) as Record<string, unknown>;
  expect(affect).toMatchObject({ instrument: "Positive and Negative Affect Schedule", positive_items: 10, negative_items: 10, item_wording_and_numeric_codes: null });
  const dailyItems = JSON.parse(String(supplementary[3]!.method_value_json)) as { first_prompt: Record<string, unknown>; last_prompt: Record<string, unknown> };
  expect(dailyItems.first_prompt).toEqual({ sleep_time: "format and clock undisclosed", wake_time: "format and clock undisclosed", nightmares: "binary presence", subjective_sleep_quality: "5-point Likert" });
  expect(dailyItems.last_prompt.physical_pain).toEqual({ temporal_context: "across the day", supplement_scale: "100-point VAS", primary_scale: "0-100", step_and_numeric_codes: null });
  const changed = structuredClone(input);
  changed.task_occurrences[0]!.task_questionnaire_responses![0]!.response_value_json = "null";
  changed.task_occurrences[1]!.criterion_assessments![1]!.assessment_value_json = "0.00";
  const parsed = parseStudyMethodProfileLibrary(changed);
  expect(parsed.task_occurrences).toEqual(changed.task_occurrences);
  expect(parsed.task_occurrences![0]!.criterion_assessments).toEqual(input.task_occurrences[0]!.criterion_assessments);
  for (const wrapped of [false, true]) {
    const valid = structuredClone(input);
    valid.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!.method_value_json = JSON.stringify(wrapped
      ? { definition: body, source_facing_role: "diary_schema", source_facing_target: "diary_item" } : body);
    expect(parseStudyMethodProfileLibrary(valid).task_occurrences).toEqual(input.task_occurrences);
  }
  for (const bad of [
    { instrument: "decoy", dimensions: ["decoy"], scale_points: 5 }, { ...body, scale_points: 4 },
    { ...body, groups: body.groups.slice(1) },
    ...["aggregation", "temporal_context", "construct"].map(field => ({ ...body, groups: body.groups.map(g => ({ ...g, [field]: "wrong" })) })),
    { ...body, groups: body.groups.map(g => ({ ...g, items: g.items.slice(1) })) },
    { ...body, groups: body.groups.map(g => ({ ...g, items: g.items.map(i => ({ ...i, question: "" })) })) },
    { ...body, groups: body.groups.map(g => ({ ...g, factor_count: 2 })) },
  ]) {
    const invalid = structuredClone(input);
    invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!.method_value_json = JSON.stringify(bad);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
    invalid.task_occurrences.forEach(t => { delete t.task_questionnaire_responses; });
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("compatible criterion definition"); // Sum-only imports use the same instrument validation.
  }
  const daily = JSON.parse(String(profile.method_settings.find(s => s.method_parameter_key === "text.daily_scores")!.method_value_json)) as Record<string, unknown>;
  expect(daily.LIWC_daily_display_ratio).toEqual({ numerator: "daily component score", denominator: "sum of all timepoints for the component", scope: "per participant, across days in the study" });
  const percentile = profile.method_settings.find(s => s.method_parameter_key === "ema.percentile")!;
  expect(input.task_occurrences[0]!.criterion_assessments![3]).toMatchObject({ criterion_setting_reference: percentile.method_setting_id, support_criterion_assessment_references: ["example:sum-0"], assessment_value_json: "true" });
  const independent = structuredClone(input);
  independent.task_occurrences[0]!.criterion_assessments![0]!.assessment_value_json = "12.00";
  expect(parseStudyMethodProfileLibrary(independent).task_occurrences![0]!.criterion_assessments![3]).toEqual(input.task_occurrences[0]!.criterion_assessments![3]);
  const observations = taskInstrumentExamples(profile).participant_day_observations!;
  expect(observations.filter(row => Object.hasOwn(row, "referenced_hour_token")).map(row => [row.observed_property, row.day_observation_value_json])).toEqual([["five-second screenshot interval count", "360"], ["percentage of hour used", "50.00"]]);
  const changedHour = structuredClone(observations);
  changedHour.find(row => row.observed_property === "five-second screenshot interval count")!.day_observation_value_json = "180";
  expect(parseStudyMethodProfileLibrary({ profiles: [profile], participant_day_observations: changedHour }).participant_day_observations!.find(row => row.observed_property === "percentage of hour used")!.day_observation_value_json).toBe("50.00");
  for (const body of ["mark above person-specific empirical 90th percentile", "mark at/above cohort 90th percentile", null]) {
    const invalid = structuredClone(input);
    invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === percentile.method_setting_id)!.method_value_json = JSON.stringify(body);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("compatible criterion definition");
  }
  const custom = JSON.parse(String(profile.method_settings.find(s => s.method_parameter_key === "text.custom_dictionaries")!.method_value_json)) as Record<string, string[]>;
  const dictionaryLines = readFileSync(resolve(base, "work/e55999-app3.txt"), "utf8").split("\n").slice(5, 56);
  const printed = [dictionaryLines.map(line => line.slice(2, 28).trim()).filter(Boolean), dictionaryLines.map(line => line.slice(28, 53).trim()).filter(Boolean), dictionaryLines.map(line => line.slice(53).trim()).filter(Boolean)];
  expect([custom.suicide, custom.risk, custom.substance]).toEqual(printed);
  expect(printed.map(terms => terms.length)).toEqual([13, 26, 16]);
  const liwc = JSON.parse(String(profile.method_settings.find(s => s.method_parameter_key === "text.liwc_components")!.method_value_json)) as { scope: string; rows: Array<[string, string | null, string[]]> };
  expect(liwc.rows).toHaveLength(20);
  expect(liwc.rows.filter(row => row[1] !== null).map(row => row[1])).toEqual(["mental", "emo_pos", "emo_neg", "conflict", "socrefs", "i"]);
  expect(liwc.scope).toContain("not complete proprietary dictionaries");
  const exemplars = readFileSync(resolve(base, "work/e55999-app2.txt"), "utf8").replace(/\s+/g, " ");
  for (const [label, alias, terms] of liwc.rows) {
    expect(exemplars).toContain(alias ? `${label} (${alias})` : label);
    expect(terms).toHaveLength(4);
    expect(exemplars).toContain(terms.join(", "));
  }
  const method = (key: string) => JSON.parse(String(profile.method_settings.find(s => s.method_parameter_key === key)!.method_value_json)) as unknown;
  expect(method("ema.schedule")).toMatchObject({ prompts_per_day: 6, days: 28, platform: "LifeData", timing: "randomly within 2-hour windows across a 12-hour participant-selected block", completion_window_minutes: 30, reminder_count: 1, reminder_after_minutes: 15, example_block_not_default: "9 AM to 9 PM" });
  expect(method("ema.compliance")).toMatchObject({ conditional_denominator: "prompts on days with at least one completed response, not all 28 days", response_active_days: { person_A: 25, person_B: 23 } });
  expect(method("collection.transfer")).toEqual(expect.arrayContaining(["screenshot data coded with layered IDs", "process screenshots to remove potentially identifying names and addresses", "screenshot access restricted to core study team members"]));
  expect(method("comparison.qualitative")).toContain("descriptive LOESS curves");
  expect(method("text.liwt_source")).toEqual({ dictionary: "LIWC", entries: 6400, entry_types: ["words", "word stems", "emoticons"], components: 90 });
  expect(method("ema.missing")).toContain("realized prompt draws/random seed");
  expect(method("collection.gate")).toBe("capture continuously during smartphone use; exact screen-off, lock and keyguard lifecycle rules are not specified");
  expect(method("collection.raw_schema")).toEqual({ disclosed_content: "smartphone screenshots; layered identifiers and encrypted storage/upload", original_field_names: null, timestamp_format: null, participant_linkage_schema: null, capture_upload_lineage_schema: null });
});

itWithPrivateCorpus("preserves supplied instrument and performance records through generated JSON Schema and Pydantic", () => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const examples = ["doi:10.1145/2406367.2406384", "doi:10.1145/2470654.2481345", "doi:10.1145/3613904.3642583", "doi:10.1016/j.smhl.2018.07.005", "doi:10.2196/55999", "doi:10.2196/13209", "doi:10.1016/j.smhl.2020.100118", "doi:10.1186/s13104-015-1280-z", "doi:10.3390/bs5040434", "doi:10.4088/jcp.15m10310", "doi:10.1145/3675094.3677547", "doi:10.1371/journal.pone.0165331", "doi:10.1145/3191754", "doi:10.1145/3473856.3473881", "doi:10.1145/2750858.2804252"]
    .map(id => taskInstrumentExamples(library.profiles.find(p => p.source_work_id === id)!));
  const rows = Object.fromEntries(([ ["TaskOccurrenceRecord", "task_occurrences"], ["ParticipantDayObservationRecord", "participant_day_observations"],
    ["DeviceUseSessionRecord", "device_use_sessions"], ["NotificationHistoryRecord", "notification_histories"], ["ScreenTextCaptureRecord", "screen_text_captures"], ["AppFeatureSessionRecord", "app_feature_sessions"], ["SampledQuantityObservationRecord", "sampled_quantity_observations"] ] as const)
    .map(([type, key]) => [type, examples.flatMap<Record<string, unknown>>(e => e[key] ?? [])]));
  rows.AppInterruptionSessionRecord = ["doi:10.1145/3191754", "doi:10.1145/3473856.3473881"]
    .flatMap(id => appInterruptionQuestionnaireExample(library.profiles.find(p => p.source_work_id === id)!).app_interruption_sessions);
  for (const id of ["doi:10.1145/3191754", "doi:10.1145/3473856.3473881"]) {
    const pair = appInterruptionQuestionnaireExample(library.profiles.find(p => p.source_work_id === id)!);
    rows.SampledQuantityObservationRecord!.push(...pair.sampled_quantity_observations ?? []);
    rows.NotificationHistoryRecord!.push(...pair.notification_histories ?? []);
    rows.ParticipantDayObservationRecord!.push(...pair.participant_day_observations ?? []);
  }
  const result = execFileSync(linkmlPython(), ["-c", [
    "import json,sys", "from jsonschema import Draft202012Validator", "sys.path.insert(0,sys.argv[2])",
    "import chronicle_research_ontology as models", "schema=json.load(open(sys.argv[1]))",
    "for name, rows in json.load(sys.stdin).items():",
    " validator=Draft202012Validator({'$ref':'#/$defs/'+name,'$defs':schema['$defs']})",
    " for row in rows:", "  validator.validate(row)",
    "  assert getattr(models,name)(**row).model_dump(exclude_unset=True)==row",
    "  assert not validator.is_valid(dict(row,invented_field=True))",
    "  for assessment in row.get('criterion_assessments') or []:",
    "   assert not validator.is_valid(dict(row,criterion_assessments=[dict(assessment,criterion_setting_reference=None)]))",
    "print('task-instrument-projections-preserve-records')",
  ].join("\n"), resolve(import.meta.dirname, "../../schema/generated/json-schema/chronicle-research-ontology.schema.json"),
  resolve(import.meta.dirname, "../../schema/generated/pydantic")], { input: JSON.stringify(rows), encoding: "utf8", timeout: 180_000 });
  expect(result.trim()).toBe("task-instrument-projections-preserve-records");
});

const mutationLibrary = lazyPrivateCorpusJson<{ profiles: StudyMethodProfile[] }>("ontology-sublation-20260831/adjudicated-method-profile-library.json");
const mutationProfiles = () => mutationLibrary()
  .profiles.filter(p => ["doi:10.1145/3613904.3642832", "doi:10.1145/2493190.2493219"].includes(p.source_work_id));
const input = () => {
  const records = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../e2e/fixtures/s-adl-task-example.json.fixture"), "utf8")) as { task_occurrences: TaskOccurrenceRecord[] };
  return { profiles: [structuredClone(mutationProfiles().find(p => p.source_work_id === "doi:10.1145/3613904.3642832")!)], ...records };
};

const ohInput = () => {
  const records = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../e2e/fixtures/oh-app-task-example.json.fixture"), "utf8")) as { task_occurrences: TaskOccurrenceRecord[] };
  return { profiles: [structuredClone(mutationProfiles().find(p => p.source_work_id === "doi:10.1145/2493190.2493219")!)], ...records };
};

for (const workId of ["doi:10.1002/per.2309", "doi:10.1145/3313831.3376163"]) {
  itWithPrivateCorpus(`preserves ${workId} response-linked windows through actual import and selected-owner persistence`, async () => {
    const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
    const records = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../e2e/fixtures/response-window-examples.json.fixture"), "utf8")) as { task_occurrences: TaskOccurrenceRecord[] };
    const source = { profiles: [library.profiles.find(p => p.source_work_id === workId)!], task_occurrences: records.task_occurrences.filter(t => t.source_work_id === workId) };
    const roundTrip = async (value: typeof source) => {
      const parsed = parseStudyMethodProfileLibrary(value);
      await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], task_occurrences: parsed.task_occurrences }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; task_occurrences: unknown };
      expect(saved.profile).toEqual(value.profiles[0]);
      expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], task_occurrences: saved.task_occurrences }).task_occurrences).toEqual(value.task_occurrences);
      return saved;
    };
    await roundTrip(source);
    const window = (value: typeof source) => value.task_occurrences[0]!.task_observation_windows![0]!;
    const moved = structuredClone(source);
    window(moved).anchor_task_action_reference = moved.task_occurrences[0]!.task_actions![1]!.task_action_id;
    await roundTrip(moved);
    expect(moved.task_occurrences[0]!.task_actions).toEqual(source.task_occurrences[0]!.task_actions);
    expect(window(moved).quantities).toEqual(window(source).quantities);
    expect(window(moved)).not.toEqual(window(source)); // Removing anchor identity would collapse these cases.
    for (const field of ["task_observation_windows", "task_questionnaire_responses"] as const) {
      for (const value of [undefined, null, []]) {
        const changed = structuredClone(source);
        Reflect.set(changed.task_occurrences[0]!, field, value);
        if (value === undefined) Reflect.deleteProperty(changed.task_occurrences[0]!, field);
        if (field === "task_questionnaire_responses") changed.task_occurrences[0]!.task_observation_windows!.forEach(w => { w.questionnaire_response_references = null; });
        await roundTrip(changed);
      }
    }
    for (const field of ["denotes_interval", "questionnaire_response_references", "quantities"] as const) {
      for (const value of [undefined, null, ...(field === "denotes_interval" ? [{ duration_seconds: null }, {}] : [[]])]) {
        const changed = structuredClone(source);
        Reflect.set(window(changed), field, value);
        if (value === undefined) Reflect.deleteProperty(window(changed), field);
        await roundTrip(changed);
      }
    }
    for (const value of [undefined, null, "null", "0.00", ' "NA" ', "-0.5"]) {
      const changed = structuredClone(source);
      window(changed).quantities![0]!.evidence_value_json = value;
      if (value === undefined) delete window(changed).quantities![0]!.evidence_value_json;
      await roundTrip(changed); // No raw emotion-confidence bounds apply to mean valence.
    }
    const retained = await roundTrip(source);
    const mutants: Array<(value: typeof source) => void> = [
      v => Reflect.set(v.task_occurrences[0]!, "task_observation_windows", false),
      v => Reflect.set(v.task_occurrences[0]!.task_observation_windows!, 0, null),
      v => Reflect.set(window(v), "questionnaire_response_references", "example:valence"),
      v => Reflect.set(window(v), "window_setting_references", false),
      v => Reflect.set(window(v), "quantities", false),
      v => Reflect.set(window(v).quantities!, 0, null),
      v => Reflect.set(window(v).quantities![0]!, "evidence_unit", false),
      v => Reflect.set(window(v).quantities![0]!, "quantity_qualifier", false),
      v => Reflect.set(window(v).quantities![0]!, "evidence_value_json", false),
      v => { window(v).anchor_task_action_reference = v.task_occurrences[1]!.task_actions![0]!.task_action_id; },
      v => { window(v).questionnaire_response_references = [v.task_occurrences[1]!.task_questionnaire_responses![0]!.questionnaire_response_id]; },
      v => { window(v).anchor_task_action_reference = " "; },
      v => { v.task_occurrences[0]!.task_actions = []; },
      v => { window(v).window_setting_references = []; },
      v => { window(v).window_setting_references.push(window(v).window_setting_references[0]!); },
      v => { window(v).window_setting_references = [v.task_occurrences[0]!.task_questionnaire_responses![0]!.questionnaire_setting_reference]; },
      v => { window(v).window_setting_references = ["foreign-definition"]; },
      v => { window(v).window_setting_references.pop(); },
      v => { window(v).observation_window_id = " "; },
      v => { v.task_occurrences[0]!.task_observation_windows!.push(structuredClone(window(v))); },
      v => { window(v).questionnaire_response_references = ["example:valence", "example:valence"]; },
      v => { window(v).source_locators = []; },
      v => { window(v).denotes_interval = { duration_seconds: -1 }; },
      v => { window(v).denotes_interval = { duration_seconds: Infinity }; },
      v => { window(v).denotes_interval = { duration_seconds: 300 }; },
      v => { window(v).quantities![0]!.evidence_value_json = "NaN"; },
      v => { window(v).quantities![0]!.observed_property = " "; },
      v => Reflect.set(window(v).quantities![0]!, "inferred_value", 1),
      v => Reflect.set(window(v), "computed_timestamp", "inferred"),
      v => { v.task_occurrences[0]!.source_work_id = "foreign-source"; },
      v => { const ref = window(v).window_setting_references[0]; v.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!.method_setting_role = "reporting"; },
      v => { const ref = window(v).window_setting_references[0]; v.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!.method_value_json = '"wrong definition"'; },
    ];
    for (const [index, mutate] of mutants.entries()) {
      const invalid = structuredClone(source);
      mutate(invalid);
      expect(() => parseStudyMethodProfileLibrary(invalid), `window mutation ${index}`).toThrow();
    }
    const badInstruments = workId.includes("3313831")
      ? [{ model: "Russell circumplex", questions: [], response_type: "Likert scale" }, { model: "Russell circumplex", questions: ["valence"], response_type: "invitation" }]
      : [{ type: "slider", minimum: 100, maximum: 0 }, { type: "slider", minimum: "0", maximum: 100 }];
    for (const body of badInstruments) {
      const invalid = structuredClone(source);
      const reference = invalid.task_occurrences[0]!.task_questionnaire_responses![0]!.questionnaire_setting_reference;
      invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === reference)!.method_value_json = JSON.stringify(body);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("compatible response-scale definition");
    }
    for (const field of ["source_facing_role", "source_facing_target"]) {
      const invalid = structuredClone(source);
      const reference = invalid.task_occurrences[0]!.task_questionnaire_responses![0]!.questionnaire_setting_reference;
      const setting = invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === reference)!;
      setting.method_value_json = JSON.stringify({ definition: JSON.parse(String(setting.method_value_json)) as unknown, source_facing_role: setting.method_setting_role, source_facing_target: setting.method_target_layer, [field]: "wrong" });
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("compatible response-scale definition");
    }
    expect(JSON.parse((await loadResearchMethodSelection())!)).toEqual(retained);
    if (workId.includes("3313831")) {
      for (const interval of [undefined, null, { duration_seconds: 60 }]) {
        const invalid = structuredClone(source);
        invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === "esm_validation.windows")!.method_value_json = "[5,60]";
        window(invalid).denotes_interval = interval;
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("one-minute anchor outside its declared alternatives");
      }
      expect(source.task_occurrences[0]!.task_observation_windows!.map(w => w.denotes_interval)).toEqual([{ duration_seconds: 60 }, { duration_seconds: 300 }, { duration_seconds: 3600 }]);
      for (const w of source.task_occurrences[0]!.task_observation_windows!.slice(1)) expect(w.window_setting_references).not.toContain("method-setting-fbe5edadc00d6e27310b7b34");
      const movedMembership = structuredClone(source);
      [movedMembership.task_occurrences[2]!.task_actions, movedMembership.task_occurrences[3]!.task_actions] = [movedMembership.task_occurrences[3]!.task_actions, movedMembership.task_occurrences[2]!.task_actions];
      await roundTrip(movedMembership);
      expect(movedMembership.task_occurrences.slice(0, 2)).toEqual(source.task_occurrences.slice(0, 2));
    }
  });
}

for (const [workId, wrongDefinition] of [
  ["doi:10.1109/acii.2019.8925518", "method-setting-af82c9963f573bdf7c519e21"],
  ["doi:10.1145/3536221.3556603", "method-setting-ea29d42cbb5d4cd017941948"],
  ["doi:10.1145/2371574.2371619", "method-setting-4a4a71e6aa4ec387a43574ba"],
  ["doi:10.1145/2556288.2557066", "method-setting-4615b1b0e4a7e91ee8ed365a"],
  ["doi:10.30773/pi.2020.0197", "method-setting-4e1d4241243661769c5eb786"],
  ["doi:10.3390/j2020008", "method-setting-4690fa27fa21ee7a97c7fbea"],
  ["doi:10.7717/peerj.2197", "method-setting-5e1b446330bc73d8414c668e"],
  ["usenix:soups2014:harbach-hard-lock-life", "method-setting-4e10b8ec2fe77672ad24cf29"],
  ["doi:10.1007/s41347-024-00443-5", "method-setting-626de5906a2be1e95d588519"],
] as const) {
  itWithPrivateCorpus(`preserves actual ${workId} questionnaire ownership without invented scale endpoints`, async () => {
    const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
    const records = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../e2e/fixtures/task-questionnaire-examples.json.fixture"), "utf8")) as { task_occurrences: TaskOccurrenceRecord[] };
    const source = { profiles: [library.profiles.find(p => p.source_work_id === workId)!], task_occurrences: records.task_occurrences.filter(t => t.source_work_id === workId) };
    const roundTrip = async () => {
      const parsed = parseStudyMethodProfileLibrary(source);
      await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], task_occurrences: parsed.task_occurrences }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; task_occurrences: unknown };
      const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], task_occurrences: saved.task_occurrences });
      expect(restored.profiles).toEqual(source.profiles);
      expect(restored.task_occurrences).toEqual(source.task_occurrences);
      return saved;
    };
    await roundTrip();
    const actions = source.task_occurrences.map(t => t.task_actions);
    const first = source.task_occurrences[0]!, second = source.task_occurrences[1]!;
    [first.task_questionnaire_responses, second.task_questionnaire_responses] = [second.task_questionnaire_responses, first.task_questionnaire_responses];
    const saved = await roundTrip();
    expect(source.task_occurrences.map(t => t.task_actions)).toEqual(actions);
    const invalid = structuredClone(source);
    invalid.task_occurrences[0]!.task_questionnaire_responses![0]!.questionnaire_setting_reference = wrongDefinition;
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("compatible response-scale definition");
    expect(JSON.parse((await loadResearchMethodSelection())!)).toEqual(saved);
    const duplicate = structuredClone(source);
    duplicate.task_occurrences[0]!.task_questionnaire_responses!.push(structuredClone(duplicate.task_occurrences[0]!.task_questionnaire_responses![0]!));
    expect(() => parseStudyMethodProfileLibrary(duplicate)).toThrow("duplicated within task occurrence");
    const malformedBodies = workId.includes("acii") || workId.includes("3536221") || workId.includes("pi.2020") ? [[], ["happy", ""], ["happy", false], "happy"]
      : workId.includes("s41347") ? [{ format: "exit", scale: { minimum: 1, maximum: 4, labels: ["one"] }, rated_items: ["privacy"], open_ended_feedback: true }, { format: "exit", scale: { minimum: 1, maximum: 4, labels: ["one", "two", "three", "four"] }, rated_items: [], open_ended_feedback: true }]
      : workId.includes("j2020008") ? ["", {}, ["TSDI"]]
      : workId.includes("peerj") ? [{ construct: "anxiety", items: 0, scale_points: 5, direction: "higher" }, { construct: "anxiety", items: 15, scale_points: 1, direction: "higher" }, { construct: "anxiety", items: 15, scale_points: 5, direction: "" }]
      : workId.includes("hard-lock") ? [{ title: "C1", scope: "current", items: [] }, { title: "C1", scope: "current", items: [[1, "", { choices: ["Yes"] }]] }, { title: "C1", scope: "current", items: [[1, "Question?", {}]] }]
      : workId.includes("2371574") ? [{ SUS: "" }, { invitation: "SUS questionnaire" }]
      : [{ instrument: "NASA-TLX", dimensions: [], scale_points: 20 }, { instrument: "NASA-TLX", dimensions: ["mental demand"], scale_points: 0 }, { instrument: "NASA-TLX", dimensions: ["mental demand"], scale_points: "20" }];
    for (const body of malformedBodies) {
      const malformed = structuredClone(source);
      const reference = malformed.task_occurrences[0]!.task_questionnaire_responses![0]!.questionnaire_setting_reference;
      const setting = malformed.profiles[0]!.method_settings.find(s => s.method_setting_id === reference)!;
      const content = JSON.parse(String(setting.method_value_json)) as Record<string, unknown>;
      setting.method_value_json = JSON.stringify(Object.hasOwn(content, "definition") ? { ...content, definition: body } : body);
      expect(() => parseStudyMethodProfileLibrary(malformed)).toThrow();
    }
    for (const field of ["method_setting_role", "method_target_layer"] as const) {
      const foreign = structuredClone(source);
      const reference = foreign.task_occurrences[0]!.task_questionnaire_responses![0]!.questionnaire_setting_reference;
      Reflect.set(foreign.profiles[0]!.method_settings.find(s => s.method_setting_id === reference)!, field, field === "method_setting_role" ? "reporting" : "outcome");
      expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow();
    }
    for (const field of ["source_facing_role", "source_facing_target"]) {
      for (const value of [undefined, "unrelated"]) {
        const foreign = structuredClone(source);
        const reference = foreign.task_occurrences[0]!.task_questionnaire_responses![0]!.questionnaire_setting_reference;
        const setting = foreign.profiles[0]!.method_settings.find(s => s.method_setting_id === reference)!;
        const content = JSON.parse(String(setting.method_value_json)) as unknown;
        const wrapped = content !== null && typeof content === "object" && Object.hasOwn(content, "definition")
          ? content as Record<string, unknown>
          : { definition: content, source_facing_role: setting.method_setting_role, source_facing_target: setting.method_target_layer };
        Reflect.set(wrapped, field, value);
        setting.method_value_json = JSON.stringify(wrapped);
        expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow("compatible response-scale definition");
      }
    }
    if (workId.includes("hard-lock")) {
      const duplicateItem = structuredClone(source);
      const reference = duplicateItem.task_occurrences[0]!.task_questionnaire_responses![0]!.questionnaire_setting_reference;
      const setting = duplicateItem.profiles[0]!.method_settings.find(s => s.method_setting_id === reference)!;
      const content = JSON.parse(String(setting.method_value_json)) as { definition: { items: unknown[][] } };
      content.definition.items[1]![0] = content.definition.items[0]![0];
      setting.method_value_json = JSON.stringify(content);
      expect(() => parseStudyMethodProfileLibrary(duplicateItem)).toThrow("compatible response-scale definition");
    }
  });
}

itWithPrivateCorpus("preserves task/script/roles and independent content assessments through real import and persistence", async () => {
  const source = input();
  const parsed = parseStudyMethodProfileLibrary(source);
  expect(parsed.task_occurrences).toEqual(source.task_occurrences);
  expect(parsed.profiles).toEqual(source.profiles);
  await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], task_occurrences: parsed.task_occurrences }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
  const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], task_occurrences: saved.task_occurrences });
  expect(restored.task_occurrences).toEqual(source.task_occurrences);
  expect(compileNativeMethodProfile(restored.profiles[0]!).ok).toBe(false);
  const first = restored.task_occurrences![0]!;
  expect(first.criterion_assessments!.map((a) => a.assessment_value_json)).toEqual(["0.00", "null"]);
  expect(first.task_actions![0]).not.toHaveProperty("denotes_interval");
  expect(first.task_actions![1]!.denotes_interval).toBeNull();
  const swapped = structuredClone(source);
  swapped.task_occurrences[0]!.criterion_assessments![0]!.support_task_action_references = ["example:call"];
  swapped.task_occurrences[0]!.criterion_assessments![1]!.support_task_action_references = ["example:registration"];
  const changed = parseStudyMethodProfileLibrary(swapped);
  expect(changed.task_occurrences![0]!.task_actions).toEqual(first.task_actions);
  expect(changed.task_occurrences![0]!.criterion_assessments).not.toEqual(first.criterion_assessments);
  await saveResearchMethodSelection(JSON.stringify({ profile: changed.profiles[0], task_occurrences: changed.task_occurrences }));
  const again = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
  expect(parseStudyMethodProfileLibrary({ profiles: [again.profile], task_occurrences: again.task_occurrences }).task_occurrences).toEqual(swapped.task_occurrences);
  // Dropping the new relationship collapses two genuinely different cases.
  expect(source.task_occurrences[0]!.task_actions).toEqual(swapped.task_occurrences[0]!.task_actions);
});

itWithPrivateCorpus("preserves independent Oh App navigation and typed questionnaire responses without constructing durations or trial joins", async () => {
  const source = ohInput();
  const profile = source.profiles[0]!;
  const records = source;
  expect(profile).toBeDefined();
  expect(records.task_occurrences[0]!.denotes_interval).toEqual(records.task_occurrences[1]!.denotes_interval);
  expect(records.task_occurrences[0]!.task_actions![0]!.action_content_json).not.toEqual(records.task_occurrences[1]!.task_actions![0]!.action_content_json);
  const imported = parseStudyMethodProfileLibrary(source);
  expect(imported.task_occurrences).toEqual(records.task_occurrences);
  await saveResearchMethodSelection(JSON.stringify({ profile, task_occurrences: imported.task_occurrences }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; task_occurrences: unknown };
  const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], task_occurrences: saved.task_occurrences });
  expect(restored.profiles[0]).toEqual(profile);
  expect(restored.task_occurrences).toEqual(records.task_occurrences);
  expect(restored.task_occurrences![0]).not.toHaveProperty("expected_script_setting_reference");
  expect(restored.task_occurrences![1]!.expected_script_setting_reference).toBeNull();
  expect(compileNativeMethodProfile(restored.profiles[0]!).ok).toBe(false);
  const invalid = structuredClone(source);
  invalid.task_occurrences[0]!.source_work_id = "foreign-work";
  expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("matching profile/source owner");
  expect(JSON.parse((await loadResearchMethodSelection())!)).toEqual(saved);
  const changed = structuredClone(source);
  const response = changed.task_occurrences[2]!;
  expect(response).not.toHaveProperty("denotes_interval");
  expect(response).not.toHaveProperty("expected_script_setting_reference");
  expect(response).not.toHaveProperty("criterion_assessments");
  response.task_questionnaire_responses![0]!.response_value_json = ' "average" ';
  const alternative = parseStudyMethodProfileLibrary(changed);
  expect(alternative.task_occurrences!.slice(0, 2)).toEqual(restored.task_occurrences!.slice(0, 2));
  expect(alternative.task_occurrences![2]).not.toEqual(restored.task_occurrences![2]);
  await saveResearchMethodSelection(JSON.stringify({ profile, task_occurrences: alternative.task_occurrences }));
  const changedSaved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; task_occurrences: unknown };
  expect(parseStudyMethodProfileLibrary({ profiles: [changedSaved.profile], task_occurrences: changedSaved.task_occurrences }).task_occurrences).toEqual(changed.task_occurrences);
});

itWithPrivateCorpus("validates task questionnaire definitions and preserves unknown, lexical and repeated answers without recoding", async () => {
  const roundTrip = async (source: ReturnType<typeof ohInput>) => {
    const parsed = parseStudyMethodProfileLibrary(source);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], task_occurrences: parsed.task_occurrences }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; task_occurrences: unknown };
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], task_occurrences: saved.task_occurrences });
    expect(restored.profiles).toEqual(source.profiles);
    expect(restored.task_occurrences).toEqual(source.task_occurrences);
  };
  for (const state of [undefined, null, []]) {
    const source = ohInput();
    const task = source.task_occurrences[2]!;
    if (state === undefined) delete task.task_questionnaire_responses;
    else task.task_questionnaire_responses = state;
    await roundTrip(source);
  }
  for (const state of [undefined, null, "null", "0", "false", ' "" ', ' ["fast","fast"] ']) {
    const source = ohInput();
    const response = source.task_occurrences[2]!.task_questionnaire_responses![0]!;
    if (state === undefined) delete response.response_value_json;
    else response.response_value_json = state;
    await roundTrip(source);
  }
  for (const state of [undefined, null, "", "supplied exact wording"]) {
    const source = ohInput();
    const response = source.task_occurrences[2]!.task_questionnaire_responses![0]!;
    if (state === undefined) delete response.questionnaire_item_label;
    else response.questionnaire_item_label = state;
    await roundTrip(source);
  }
  const repeated = ohInput();
  const task = repeated.task_occurrences[2]!;
  const same = structuredClone(task.task_questionnaire_responses![0]!);
  same.questionnaire_response_id = "example:second-answer";
  task.task_questionnaire_responses!.push(same);
  task.task_questionnaire_responses!.reverse();
  const secondCompletion = structuredClone(task);
  secondCompletion.task_occurrence_id = "example:separate-completion";
  repeated.task_occurrences.push(secondCompletion);
  await roundTrip(repeated);
  const before = JSON.parse((await loadResearchMethodSelection())!) as unknown;
  const response = (x: ReturnType<typeof ohInput>) => x.task_occurrences[2]!.task_questionnaire_responses![0]!;
  const mutants: Array<(x: ReturnType<typeof ohInput>) => void> = [
    (x) => Reflect.set(x.task_occurrences[2]!.task_questionnaire_responses!, 0, null),
    (x) => Reflect.set(response(x), "response_value_json", false),
    (x) => { response(x).source_locators = [" "]; },
    (x) => Reflect.set(response(x), "assessment_case_token", "invented-case"),
    (x) => { response(x).support_task_action_references = [x.task_occurrences[0]!.task_actions![0]!.task_action_id]; },
    (x) => { response(x).questionnaire_setting_reference = "method-setting-3ad1a39a9e28fd195ba7b4a3"; },
    (x) => { response(x).questionnaire_setting_reference = "method-setting-02bd3693bbb610243f7e6b64"; },
    (x) => { response(x).questionnaire_setting_reference = "foreign-instrument"; },
    (x) => Reflect.deleteProperty(response(x), "questionnaire_setting_reference"),
    (x) => { response(x).questionnaire_response_id = " "; },
    (x) => { response(x).observed_property = " "; },
    (x) => Reflect.set(response(x), "questionnaire_item_label", false),
    (x) => { response(x).response_value_json = "NaN"; },
    (x) => { response(x).source_locators = []; },
    (x) => { x.task_occurrences[2]!.task_questionnaire_responses!.push(structuredClone(response(x))); },
    (x) => Reflect.set(x.task_occurrences[2]!, "task_questionnaire_responses", false),
    (x) => Reflect.set(response(x), "navigation_trial_reference", "example:dock-navigation"),
    (x) => { const setting = x.profiles[0]!.method_settings.find(s => s.method_setting_id === response(x).questionnaire_setting_reference)!; setting.method_value_json = JSON.stringify({ definition: { invitation: "online questionnaire" }, source_facing_role: "participant_schema", source_facing_target: "participant_measure" }); },
    (x) => { const setting = x.profiles[0]!.method_settings.find(s => s.method_setting_id === response(x).questionnaire_setting_reference)!; const value = JSON.parse(String(setting.method_value_json)) as { definition: { scale_endpoints: unknown[] } }; value.definition.scale_endpoints = [{ value: 1, label: false }, { value: 5, label: "very fast" }]; setting.method_value_json = JSON.stringify(value); },
  ];
  for (const [i, mutate] of mutants.entries()) {
    const invalid = ohInput();
    mutate(invalid);
    expect(() => parseStudyMethodProfileLibrary(invalid), `questionnaire mutation ${i}`).toThrow();
  }
  expect(JSON.parse((await loadResearchMethodSelection())!)).toEqual(before);
});

itWithPrivateCorpus("preserves omission/null/empty, repeated roles, opaque times and supplied order without matching or scoring", async () => {
  const source = input();
  const roundTrip = async (value: ReturnType<typeof input>) => {
    const parsed = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], task_occurrences: parsed.task_occurrences }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], task_occurrences: saved.task_occurrences }).task_occurrences).toEqual(value.task_occurrences);
  };
  const task = source.task_occurrences[0]!;
  task.task_actions!.reverse();
  task.criterion_assessments!.reverse();
  task.task_actions![0]!.assigned_role_labels = ["Phone call", "Phone call"];
  task.task_actions![1]!.denotes_interval = { start_instant: "opaque", end_instant: "opaque", duration_seconds: 0 };
  for (const state of [undefined, null, []]) {
    task.criterion_assessments![0]!.support_task_action_references = state;
    if (state === undefined) delete task.criterion_assessments![0]!.support_task_action_references;
    task.criterion_assessments![1]!.assessment_value_json = state === undefined ? undefined : state === null ? null : "0";
    if (state === undefined) delete task.criterion_assessments![1]!.assessment_value_json;
    expect(parseStudyMethodProfileLibrary(source).task_occurrences).toEqual(source.task_occurrences);
    await roundTrip(source);
  }
  for (const field of ["task_actions", "criterion_assessments"] as const) {
    for (const state of [undefined, null, []]) {
      const variant = input();
      Reflect.set(variant.task_occurrences[0]!, field, state);
      if (state === undefined) Reflect.deleteProperty(variant.task_occurrences[0]!, field);
      if (field === "task_actions") variant.task_occurrences[0]!.criterion_assessments = null;
      expect(parseStudyMethodProfileLibrary(variant).task_occurrences).toEqual(variant.task_occurrences);
      await roundTrip(variant);
    }
  }
  expect(parseStudyMethodProfileLibrary({ profiles: source.profiles }).task_occurrences).toBeUndefined();
  expect(parseStudyMethodProfileLibrary({ profiles: source.profiles, task_occurrences: [] }).task_occurrences).toEqual([]);
  const other = structuredClone(task);
  other.participant_id = "example:other-participant";
  source.task_occurrences.push(other);
  expect(parseStudyMethodProfileLibrary(source).task_occurrences).toEqual(source.task_occurrences);
  await roundTrip(source);
  for (const field of ["expected_script_setting_reference", "denotes_interval"] as const) {
    for (const state of [undefined, null]) {
      const variant = input();
      Reflect.set(variant.task_occurrences[0]!, field, state);
      if (state === undefined) Reflect.deleteProperty(variant.task_occurrences[0]!, field);
      await roundTrip(variant);
    }
  }
  for (const state of [undefined, null, []]) {
    const variant = input();
    Reflect.set(variant.task_occurrences[0]!.task_actions![0]!, "assigned_role_labels", state);
    if (state === undefined) Reflect.deleteProperty(variant.task_occurrences[0]!.task_actions![0]!, "assigned_role_labels");
    await roundTrip(variant);
  }
  for (const state of [undefined, null, "null", ' {"example":false} ']) {
    const variant = input();
    Reflect.set(variant.task_occurrences[0]!.task_actions![0]!, "action_content_json", state);
    Reflect.set(variant.task_occurrences[0]!.criterion_assessments![0]!, "assessment_content_json", state);
    if (state === undefined) {
      Reflect.deleteProperty(variant.task_occurrences[0]!.task_actions![0]!, "action_content_json");
      Reflect.deleteProperty(variant.task_occurrences[0]!.criterion_assessments![0]!, "assessment_content_json");
    }
    await roundTrip(variant);
  }
});

itWithPrivateCorpus("rejects foreign supports, unrelated definitions, malformed records and invented fields without replacing saved data", async () => {
  const source = input();
  await saveResearchMethodSelection(JSON.stringify(source));
  const mutants: Array<(x: ReturnType<typeof input>) => void> = [
    (x) => Reflect.set(x.task_occurrences[0]!, "task_actions", false),
    (x) => Reflect.set(x.task_occurrences[0]!.task_actions!, 0, null),
    (x) => Reflect.set(x.task_occurrences[0]!.task_actions![0]!, "action_label", false),
    (x) => Reflect.set(x.task_occurrences[0]!.task_actions![0]!, "action_content_json", false),
    (x) => { x.task_occurrences[0]!.task_actions![0]!.assigned_role_labels = [" "]; },
    (x) => Reflect.set(x.task_occurrences[0]!, "criterion_assessments", false),
    (x) => Reflect.set(x.task_occurrences[0]!.criterion_assessments!, 0, null),
    (x) => Reflect.set(x.task_occurrences[0]!.criterion_assessments![0]!, "support_task_action_references", "example:call"),
    (x) => Reflect.set(x.task_occurrences[0]!.criterion_assessments![0]!, "assessment_content_json", false),
    (x) => Reflect.set(x.task_occurrences[0]!.criterion_assessments![0]!, "computed_score", 1),
    (x) => Reflect.set(x.task_occurrences, 0, null),
    (x) => { x.task_occurrences[0]!.source_locators = [" "]; },
    (x) => { x.task_occurrences[0]!.task_actions![0]!.source_locators = [" "]; },
    (x) => { x.task_occurrences[0]!.criterion_assessments![0]!.source_locators = [" "]; },
    (x) => Reflect.set(x.task_occurrences[0]!, "device_id", false),
    (x) => { x.task_occurrences[0]!.referenced_day_token = " "; },
    (x) => { x.task_occurrences[0]!.history_subject_participant_id = "example:foreign-history-subject"; },
    (x) => Reflect.set(x, "task_occurrences", null),
    (x) => { x.task_occurrences[0]!.source_work_id = "foreign-work"; },
    (x) => { x.task_occurrences[0]!.participant_id = " "; },
    (x) => { x.task_occurrences[0]!.record_origin = "authenticated-original" as never; },
    (x) => { x.task_occurrences.push(structuredClone(x.task_occurrences[0]!)); },
    (x) => { x.task_occurrences[0]!.expected_script_setting_reference = "method-setting-541738e74e14251b91662104"; },
    (x) => { x.task_occurrences[0]!.task_actions!.push(structuredClone(x.task_occurrences[0]!.task_actions![0]!)); },
    (x) => { x.task_occurrences[0]!.task_actions![0]!.action_content_json = "NaN"; },
    (x) => Reflect.set(x.task_occurrences[0]!.task_actions![0]!, "assigned_role_labels", [false]),
    (x) => { x.task_occurrences[0]!.task_actions![0]!.source_locators = []; },
    (x) => { x.task_occurrences[0]!.criterion_assessments![0]!.criterion_label = " "; },
    (x) => { x.task_occurrences[0]!.criterion_assessments![0]!.criterion_setting_reference = "method-setting-282bc5a0e32ddcf182d7dd63"; },
    (x) => { x.task_occurrences[0]!.criterion_assessments![0]!.support_task_action_references = ["example:foreign-task-member"]; },
    (x) => { x.task_occurrences[0]!.criterion_assessments![0]!.support_task_action_references = ["example:call", "example:call"]; },
    (x) => { x.task_occurrences[0]!.criterion_assessments![0]!.assessment_value_json = "undefined"; },
    (x) => { x.task_occurrences[0]!.criterion_assessments!.push(structuredClone(x.task_occurrences[0]!.criterion_assessments![0]!)); },
    (x) => Reflect.set(x.task_occurrences[0]!, "automatically_computed_score", 1),
    (x) => { const s = x.profiles[0]!.method_settings.find((s) => s.method_setting_id === x.task_occurrences[0]!.expected_script_setting_reference)!; s.method_value_json = JSON.stringify({ definition: {}, source_facing_role: "task_sequence" }); },
    (x) => { const s = x.profiles[0]!.method_settings.find((s) => s.method_setting_id === x.task_occurrences[0]!.criterion_assessments![0]!.criterion_setting_reference)!; s.method_value_json = JSON.stringify({ definition: { basis: "unrelated" }, source_facing_role: "task_evaluation" }); },
  ];
  for (const [i, mutate] of mutants.entries()) {
    const invalid = input();
    mutate(invalid);
    expect(() => parseStudyMethodProfileLibrary(invalid), `task mutation ${i}`).toThrow();
  }
  expect(JSON.parse((await loadResearchMethodSelection())!)).toEqual(source);
});

itWithPrivateCorpus.each([
  ["doi:10.1145/3191754", "exit_survey.frequency_scale"],
  ["doi:10.1145/3191754", "exit_survey.technical_difficulty_item"],
  ["doi:10.1145/3191754", "validity.task"],
  ["doi:10.1145/3191754", "reliability.case_sample"],
  ["doi:10.1145/3191754", "interview.part_one_topics"],
  ["doi:10.1145/3191754", "interview.part_two_method"],
  ["doi:10.1145/3473856.3473881", "survey.initial_instruments"],
  ["doi:10.1145/3473856.3473881", "survey.final_instruments"],
] as const)("admits independent %s %s responses with exact source definitions", (work, key) => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = structuredClone(library.profiles.find(p => p.source_work_id === work)!);
  const records = taskInstrumentExamples(profile);
  const setting = profile.method_settings.find(s => s.method_parameter_key === key)!;
  records.task_occurrences = records.task_occurrences.filter(row =>
    row.task_questionnaire_responses?.some(r => r.questionnaire_setting_reference === setting.method_setting_id));
  for (const row of records.task_occurrences) row.task_questionnaire_responses = row.task_questionnaire_responses!.filter(r => r.questionnaire_setting_reference === setting.method_setting_id);
  expect(records.task_occurrences.length).toBeGreaterThan(0);
  const input = { profiles: [profile], ...records };
  expect(parseStudyMethodProfileLibrary(input).task_occurrences).toEqual(records.task_occurrences);
  const content: unknown = JSON.parse(String(setting.method_value_json));
  const wrapper = typeof content === "object" && content !== null && !Array.isArray(content) && Object.hasOwn(content, "definition")
    ? content as Record<string, unknown> : { definition: content, source_facing_role: setting.method_setting_role, source_facing_target: setting.method_target_layer };
  for (const body of [{ ...wrapper, definition: null }, { ...wrapper, definition: "invalid inner-body decoy" },
    { ...wrapper, source_facing_role: null }, { ...wrapper, source_facing_target: "study_window" }]) {
    setting.method_value_json = JSON.stringify(body);
    expect(() => parseStudyMethodProfileLibrary(input)).toThrow(/compatible response-scale definition/);
  }
  setting.method_value_json = JSON.stringify(wrapper);
  setting.source_work_id = "doi:foreign";
  expect(() => parseStudyMethodProfileLibrary(input)).toThrow(/compatible response-scale definition/);
});

itWithPrivateCorpus("retains Meaningful shared case identity independently from rater and repeated display labels", () => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = library.profiles.find(p => p.source_work_id === "doi:10.1145/3191754")!;
  const source = { profiles: [profile], ...taskInstrumentExamples(profile) };
  const ratings = source.task_occurrences.filter(row => row.assessor_id != null);
  expect(ratings.map(row => row.assessor_id)).toEqual(["example:rater-A", "example:rater-B", "example:rater-C"]);
  expect(ratings.map(row => row.task_questionnaire_responses!.map(response => response.assessment_case_token)))
    .toEqual(Array(3).fill(["example:validity-case-A", "example:validity-case-B"]));
  expect(ratings.flatMap(row => row.task_questionnaire_responses!.map(response => response.questionnaire_item_label)))
    .toEqual(Array(6).fill("example: same display label"));
  expect(parseStudyMethodProfileLibrary(source).task_occurrences).toEqual(source.task_occurrences);
  for (const token of [undefined, null, "example:another-case"]) {
    const variant = structuredClone(source), rating = variant.task_occurrences.find(row => row.assessor_id != null)!;
    if (token === undefined) delete rating.task_questionnaire_responses![0]!.assessment_case_token;
    else rating.task_questionnaire_responses![0]!.assessment_case_token = token;
    expect(parseStudyMethodProfileLibrary(variant).task_occurrences).toEqual(variant.task_occurrences);
    expect(variant.task_occurrences.filter(row => row.assessor_id != null).slice(1)).toEqual(ratings.slice(1));
  }
  for (const token of ["", " ", 0, false, {}, []]) {
    const invalid = structuredClone(source);
    Reflect.set(invalid.task_occurrences.find(row => row.assessor_id != null)!.task_questionnaire_responses![0]!, "assessment_case_token", token);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/assessment_case_token/);
  }
  const wrongInstrument = structuredClone(source);
  wrongInstrument.task_occurrences[0]!.task_questionnaire_responses![0]!.assessment_case_token = "example:validity-case-A";
  expect(() => parseStudyMethodProfileLibrary(wrongInstrument)).toThrow(/incompatible with this source instrument/);
});

itWithPrivateCorpus("preserves Boredom's independent raw answers, absolute/normalized labels, optional BPS and pilot outcomes without scoring", () => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = library.profiles.find(p => p.source_work_id === "doi:10.1145/2750858.2804252")!;
  const records = taskInstrumentExamples(profile);
  const parsed = parseStudyMethodProfileLibrary({ profiles: [profile], ...records });
  expect(parsed.task_occurrences).toEqual(records.task_occurrences); expect(records.task_occurrences).toHaveLength(5);
  const [a, b, setup, bps, pilot] = records.task_occurrences;
  expect([a!, b!].map(t => t.task_questionnaire_responses![0]!.response_value_json)).toEqual(["3", "3"]);
  expect([a!, b!].map(t => t.criterion_assessments!.slice(0, 3).map(c => c.assessment_value_json))).toEqual([
    ['"bored"', "0.25", '"baseline"'], ['"bored"', "0.26", '"bored"'],
  ]);
  expect(a!.criterion_assessments![2]!.support_criterion_assessment_references).toEqual(["example:boredom-z-A"]);
  expect(b!.criterion_assessments![2]!.support_criterion_assessment_references).toEqual(["example:boredom-z-B"]);
  expect(a!.criterion_assessments).toHaveLength(4); expect(b!.criterion_assessments).toHaveLength(3);
  expect(bps!.task_questionnaire_responses).toHaveLength(28);
  expect(bps!.task_questionnaire_responses!.every(answer => answer.response_value_json === null)).toBe(true);
  expect(bps!.criterion_assessments![0]!.assessment_value_json).toBe("12.00");
  expect(setup!.task_questionnaire_responses!.map(r => r.response_value_json)).toEqual(["29", null, "null"]);
  expect(pilot!.participant_id).not.toBe(a!.participant_id);
  expect(pilot).not.toHaveProperty("task_questionnaire_responses");
  for (const row of [a!, b!]) for (const field of ["task_actions", "task_observation_windows", "denotes_interval"]) expect(row).not.toHaveProperty(field);
  expect(records.notification_histories).toHaveLength(5);
  expect(records.notification_histories!.slice(3).every(h => h.notification_evidence.every(e => e.evidence_kind === "arrival"))).toBe(true);
  expect(records.notification_histories!.slice(0, 2).map(h => h.notification_evidence.find(e => e.evidence_record_id === "duration")!.evidence_value_json)).toEqual(["30.00", "29.99"]);
  expect(records.notification_histories!.slice(0, 3).map(h => h.notification_evidence.find(e => e.evidence_record_id === "engagement")!.evidence_value_json)).toEqual(["true", "false", null]);
  const changed = structuredClone(records);
  changed.task_occurrences[0]!.criterion_assessments![0]!.assessment_value_json = '"baseline"';
  changed.task_occurrences[0]!.criterion_assessments![1]!.assessment_value_json = " -0.0000 ";
  expect(parseStudyMethodProfileLibrary({ profiles: [profile], ...changed }).task_occurrences).toEqual(changed.task_occurrences);
  const foreign = structuredClone(records);
  foreign.task_occurrences[0]!.criterion_assessments![2]!.support_criterion_assessment_references = ["example:boredom-z-B"];
  expect(() => parseStudyMethodProfileLibrary({ profiles: [profile], ...foreign })).toThrow("within task occurrence");
});
itWithPrivateCorpus.each([["borapp.diary.boredom_item","response"],["borapp.diary.additional_items_not_analyzed","response"],["borapp.participant.optional_demographics","response"],["borapp.participant.boredom_proneness_instrument","response"],["borapp.participant.boredom_proneness_instrument","criterion"],["borapp.outcome.absolute_label","criterion"],["borapp.outcome.normalized_label","criterion"]] as const)("admits Boredom %s only for its declared %s owner", (key, kind) => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = structuredClone(library.profiles.find(p => p.source_work_id === "doi:10.1145/2750858.2804252")!);
  const rows = taskInstrumentExamples(profile).task_occurrences, setting = profile.method_settings.find(s => s.method_parameter_key === key)!;
  const original = rows.find(row => kind === "response" ? row.task_questionnaire_responses?.some(r => r.questionnaire_setting_reference === setting.method_setting_id)
    : row.criterion_assessments?.some(r => r.criterion_setting_reference === setting.method_setting_id))!;
  const task = structuredClone(original);
  delete task.task_actions; delete task.task_observation_windows;
  if (kind === "response") { delete task.criterion_assessments; task.task_questionnaire_responses = task.task_questionnaire_responses!.filter(r => r.questionnaire_setting_reference === setting.method_setting_id); }
  else { delete task.task_questionnaire_responses; task.criterion_assessments = task.criterion_assessments!.filter(c => c.criterion_setting_reference === setting.method_setting_id);
    task.criterion_assessments.forEach(c => { delete c.support_criterion_assessment_references; }); }
  const source = { profiles: [profile], task_occurrences: [task] };
  expect(parseStudyMethodProfileLibrary(source).task_occurrences).toEqual(source.task_occurrences);
  const local = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!;
  const content = JSON.parse(String(setting.method_value_json)) as Record<string, unknown>;
  for (const body of [null, "scalar decoy", {}, { ...content, definition: null }, { ...content, definition: "bad body" },
    { ...content, source_facing_role: null }, { ...content, source_facing_target: null },
    { ...content, definition: { points: 5, anchors: ["bad", "good"], categories: ["a", "b"], constructs: ["a", "b"] } }]) {
    const bad = structuredClone(source); local(bad).method_value_json = JSON.stringify(body);
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/compatible (response-scale|criterion) definition/);
  }
  for (const [field, value] of [["source_work_id", "doi:foreign"], ["method_setting_role", "provenance"], ["method_target_layer", "model"]]) {
    const bad = structuredClone(source); Reflect.set(local(bad), field!, value);
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/compatible (response-scale|criterion) definition/);
  }
});

itWithPrivateCorpus("checks disclosed numeric Boredom slider bounds without recoding lexical answers or BPS", () => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = library.profiles.find(p => p.source_work_id === "doi:10.1145/2750858.2804252")!;
  const source = { profiles: [profile], task_occurrences: taskInstrumentExamples(profile).task_occurrences };
  source.task_occurrences = [source.task_occurrences[0]!]; delete source.task_occurrences[0]!.criterion_assessments;
  for (const value of ["-1", "5", "0.5", "1e309", "{}", "[]", "true"]) {
    const invalid = structuredClone(source); invalid.task_occurrences[0]!.task_questionnaire_responses![0]!.response_value_json = value;
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
  for (const value of [undefined, null, "null", "0", "4", " 3.0000 ", '"5"', '"unknown"']) {
    const valid = structuredClone(source), answer = valid.task_occurrences[0]!.task_questionnaire_responses![0]!;
    if (value === undefined) delete answer.response_value_json; else answer.response_value_json = value;
    expect(parseStudyMethodProfileLibrary(valid).task_occurrences).toEqual(valid.task_occurrences);
  }
});

itWithPrivateCorpus("admits only the exact Ouakrat topic-level survey definition without inventing questionnaire wording or coding", () => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = structuredClone(library.profiles.find(p => p.source_work_id === "doi:10.4000/questionsdecommunication.9851")!);
  const source = { profiles: [profile], ...taskInstrumentExamples(profile) };
  const setting = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === "survey.schema")!;
  expect(parseStudyMethodProfileLibrary(source).task_occurrences).toEqual(source.task_occurrences);
  expect(source.task_occurrences).toHaveLength(3);
  const body: unknown = JSON.parse(String(setting(source).method_value_json));
  const wrapper = { definition: body, source_facing_role: "event_schema", source_facing_target: "diary_response" };
  const valid = structuredClone(source); setting(valid).method_value_json = JSON.stringify(wrapper);
  expect(parseStudyMethodProfileLibrary(valid).task_occurrences).toEqual(source.task_occurrences);
  for (const content of [null, "survey", [], (body as string[]).slice(1), { ...wrapper, definition: null },
    { ...wrapper, definition: "borrow outer topic list" }, { ...wrapper, source_facing_role: "participant_schema" },
    { ...wrapper, source_facing_target: "participant_day" }, { definition: body },
    { ...wrapper, source_facing_role: null }, { ...wrapper, source_facing_target: null },
  ]) {
    const invalid = structuredClone(source); setting(invalid).method_value_json = JSON.stringify(content);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("compatible response-scale definition");
  }
  const inventedTopic = structuredClone(source);
  inventedTopic.task_occurrences[0]!.task_questionnaire_responses![0]!.observed_property = "invented interview question";
  expect(() => parseStudyMethodProfileLibrary(inventedTopic)).toThrow("disclosed survey topic");
  for (const field of ["source_work_id", "method_setting_role", "method_target_layer"] as const) {
    const invalid = structuredClone(source); Reflect.set(setting(invalid), field, "foreign");
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
});

itWithPrivateCorpus("retains source-bound Ouakrat interviews and comparison actions without fabricated task-to-raw-event or trace-quote joins", () => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const profile = structuredClone(library.profiles.find(p => p.source_work_id === "doi:10.4000/questionsdecommunication.9851")!);
  const records = taskInstrumentExamples(profile);
  const source = { profiles: [profile], task_occurrences: records.task_occurrences.filter(t => t.task_occurrence_id === "example:installed-app-interview") };
  expect(parseStudyMethodProfileLibrary(source).task_occurrences).toEqual(source.task_occurrences);
  expect(source.task_occurrences).toHaveLength(1);
  expect(source.task_occurrences[0]).not.toHaveProperty("interaction_trace_reference");
  const setting = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === "qualitative.interviews")!;
  const body: unknown = JSON.parse(String(setting(source).method_value_json));
  const wrapper = { definition: body, source_facing_role: "acquisition", source_facing_target: "diary_response" };
  const valid = structuredClone(source); setting(valid).method_value_json = JSON.stringify(wrapper);
  expect(parseStudyMethodProfileLibrary(valid).task_occurrences).toEqual(source.task_occurrences);
  for (const value of [null, [], "invented interview instrument", { ...wrapper, definition: null }, { ...wrapper, source_facing_target: "model" },
    { ...wrapper, source_facing_role: null }, { ...wrapper, source_facing_target: null }, { definition: body }]) {
    const invalid = structuredClone(source); setting(invalid).method_value_json = JSON.stringify(value);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("compatible response-scale definition");
  }
  const invented = structuredClone(source); invented.task_occurrences[0]!.task_questionnaire_responses![0]!.observed_property = "invented guide item";
  expect(() => parseStudyMethodProfileLibrary(invented)).toThrow("disclosed interview topic");
});
