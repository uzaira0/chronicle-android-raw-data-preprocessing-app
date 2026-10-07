import "fake-indexeddb/auto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { describeWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { privateCorpusPath } from "@/testSupport/privateCorpus";
import { parseStudyMethodProfileLibrary } from "@/lib/methodProfiles";
import { loadResearchMethodSelection, saveResearchMethodSelection } from "@/lib/lastRunStore";
import { dailyValidityDeviceSessionExample, appPeriodDeviceSessionExample, apnomsDeviceSessionExample, hammerDeviceSessionExample } from "../../e2e/fixtures/device-use-session";
import { falakiDeviceSessionExample } from "../../e2e/fixtures/device-use-session";
import { academicDeviceSessionExample, appMeasuresDeviceSessionExample, cognitiveDeviceSessionExample, deviceUseSessionExample, hushDeviceSessionExample, jonesDeviceSessionExample, lonelinessDeviceSessionExample, mommDeviceSessionExample, recordedBehaviorDeviceSessionExample, separateDeviceSessionExample, sessionQuantityExample, shinDeviceSessionExample, vanBerkelDeviceSessionExample, whatsappDeviceSessionExample } from "../../e2e/fixtures/device-use-session";

const libraryPath = privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json");
const example = () => {
  const profile = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles
    .find(p => p.source_work_id === "doi:10.1145/3604241");
  if (!profile) throw new Error("Admitted Rabbit primary is missing");
  return deviceUseSessionExample(profile);
};
const whatsappExample = () => {
  const profile = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles.find(p => p.source_work_id === "doi:10.1186/s13104-015-1280-z");
  if (!profile) throw new Error("Admitted WhatsApp primary is missing");
  return whatsappDeviceSessionExample(profile);
};
async function roundtrip(input: unknown) {
  const parsed = parseStudyMethodProfileLibrary(input);
  await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], device_use_sessions: parsed.device_use_sessions,
    ...(parsed.sampled_quantity_observations !== undefined ? { sampled_quantity_observations: parsed.sampled_quantity_observations } : {}),
    ...(parsed.task_occurrences !== undefined ? { task_occurrences: parsed.task_occurrences } : {}) }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
  return parseStudyMethodProfileLibrary({ profiles: [saved.profile],
    ...Object.fromEntries(["device_use_sessions", "sampled_quantity_observations", "task_occurrences"].filter(key => Object.hasOwn(saved, key)).map(key => [key, saved[key]])) });
}

describeWithPrivateCorpus("supplied device sessions, repeated answers and independently supplied labels", () => {

  it("rejects malformed device-session collections at their exact supplied field", () => {
    const baseline = example();
    const mutations: Array<[(source: ReturnType<typeof example>) => void, string]> = [
      [s => Reflect.set(s, "device_use_sessions", {}), "method_profile_library.device_use_sessions"],
      [s => Reflect.set(s, "device_use_sessions", [null]), "device_use_sessions[0]"],
      [s => Reflect.set(s.device_use_sessions[0]!, "session_quantities", {}), "device_use_sessions[0].session_quantities"],
      [s => Reflect.set(s.device_use_sessions[0]!, "session_quantities", [null]), "device_use_sessions[0].session_quantities[0]"],
      [s => { s.device_use_sessions[0]!.device_use_session_id = " "; }, "device_use_session_id must be nonblank"],
      [s => Reflect.set(s.device_use_sessions[0]!, "session_questionnaire_responses", {}), "session_questionnaire_responses must be an array or null"],
      [s => Reflect.set(s.device_use_sessions[0]!, "session_questionnaire_responses", [null]), "session_questionnaire_responses[0] must be an object"],
      [s => Reflect.set(s.device_use_sessions[0]!.session_questionnaire_responses[0]!, "support_task_action_references", []), "has no disclosed action-supported device-session response"],
      [s => Reflect.set(s.device_use_sessions[0]!.session_questionnaire_responses[0]!, "questionnaire_item_label", 1), "questionnaire_item_label must be a string or null"],
      [s => Reflect.set(s.device_use_sessions[0]!.session_questionnaire_responses[0]!, "response_value_json", true), "response_value_json must be lexical JSON or null"],
      [s => Reflect.set(s.device_use_sessions[0]!, "session_labels", {}), "session_labels must be an array or null"],
      [s => Reflect.set(s.device_use_sessions[0]!, "session_labels", [null]), "session_labels[0] must be an object"],
      [s => Reflect.set(s.device_use_sessions[0]!.session_labels[0]!, "label_value_json", false), "label_value_json must be lexical JSON or null"],
      [s => Reflect.set(s.device_use_sessions[0]!.session_labels[0]!, "questionnaire_response_references", {}), "questionnaire_response_references must be an array or null"],
    ];
    for (const [mutate, path] of mutations) {
      const source = structuredClone(baseline); mutate(source);
      expect(() => parseStudyMethodProfileLibrary(source), path).toThrow(path);
    }
  });

  const dailyValidityExample = () => dailyValidityDeviceSessionExample(structuredClone(parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles.find(profile => profile.source_work_id === "doi:10.1016/j.chb.2024.108281")!));
  it("rejects phone-check labels with fabricated certainty, subjective support or missing provenance", () => {
    const source = dailyValidityExample(), label = (v: typeof source) => v.device_use_sessions[0]!.session_labels![0]!;
    for (const [mutate, error] of [
      [(v: typeof source) => { label(v).source_locators = []; }, /source_locators must retain nonblank provenance/],
      [(v: typeof source) => Reflect.set(label(v), "label_value_json", true), /lexical supplied phone-check label/],
      [(v: typeof source) => { label(v).questionnaire_response_references = ["supplied subjective answer"]; }, /phone-check classification is not a subjective report/],
    ] as const) { const invalid = structuredClone(source); mutate(invalid); expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(error); }
  });
  it.each(["reconstruction.screen_on_session", "feature.phone_check_definition"])("admits exact CHB screen-session/phone-check source %s without invented unlock boundaries", key => {
    const source = dailyValidityExample(), local = (value: typeof source) => value.profiles[0]!.method_settings.find(setting => setting.method_parameter_key === key)!;
    expect(parseStudyMethodProfileLibrary(source).device_use_sessions).toEqual(source.device_use_sessions);
    const content: unknown = JSON.parse(String(local(source).method_value_json));
    const body = content !== null && typeof content === "object" && Object.hasOwn(content, "definition") ? (content as { definition: unknown }).definition : content;
    const wrapper = { definition: body, source_facing_role: key.startsWith("reconstruction.") ? "reconstruction" : "feature_engineering", source_facing_target: key.startsWith("reconstruction.") ? "device_session" : "derived_feature" };
    for (const value of [body, wrapper]) { const good = structuredClone(source); local(good).method_value_json = JSON.stringify(value); expect(() => parseStudyMethodProfileLibrary(good)).not.toThrow(); }
    for (const value of [null, {}, { ...wrapper, definition: null }, { ...wrapper, source_facing_role: "invented" }, { ...wrapper, source_facing_target: "invented" }]) {
      const bad = structuredClone(source); local(bad).method_value_json = JSON.stringify(value);
      expect(() => parseStudyMethodProfileLibrary({ profiles: bad.profiles })).not.toThrow();
      expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/compatible daily-validity|source-facing|constructor definition/);
    }
  });
  it("preserves supplied CHB processed sessions and phone-check boundary labels through existing IDB without duration reconstruction", async () => {
    const source = dailyValidityExample();
    expect((await roundtrip(source)).device_use_sessions).toEqual(source.device_use_sessions);
    expect(source.device_use_sessions.map(row => row.denotes_interval?.duration_seconds)).toEqual([15, 15.25, null]);
    expect(source.device_use_sessions.map(row => row.session_labels![0]!.label_value_json)).toEqual(["true", "false", "null"]);
    const partial = structuredClone(source);
    partial.device_use_sessions[0]!.denotes_interval = {}; partial.device_use_sessions[0]!.start_condition = null; delete partial.device_use_sessions[0]!.end_condition;
    expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
    const retained = await loadResearchMethodSelection();
    for (const [mutate, error] of [
      [(value: typeof source) => { value.device_use_sessions[0]!.start_condition = "unlock"; }, /start_condition/],
      [(value: typeof source) => { value.device_use_sessions[0]!.session_labels![0]!.label_value_json = "false"; }, /at-most-15-second/],
      [(value: typeof source) => { value.device_use_sessions[0]!.session_labels![0]!.label_value_json = "1"; }, /boolean phone-check/],
      [(value: typeof source) => { value.device_use_sessions[0]!.denotes_interval!.duration_seconds = -1; }, /negative supplied/],
    ] as const) {
      const bad = structuredClone(source); mutate(bad);
      await expect(roundtrip(bad)).rejects.toThrow(error); expect(await loadResearchMethodSelection()).toBe(retained);
    }
  });

  const appPeriodWorks = ["doi:10.1145/2971648.2971760", "doi:10.1145/2971648.2971762", "doi:10.1145/2037373.2037383"];
  let periodProfiles: ReturnType<typeof parseStudyMethodProfileLibrary>["profiles"] | undefined;
  const periodExample = (work: string) => {
    periodProfiles ??= parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles;
    return appPeriodDeviceSessionExample(structuredClone(periodProfiles.find(p => p.source_work_id === work)!));
  };
  it("rejects ambiguous complete app-period policies and independently duplicated QuantApp definitions", () => {
    const source = periodExample(appPeriodWorks[0]!);
    const ambiguousPolicy = structuredClone(source), policies = ambiguousPolicy.profiles[0]!.session_construction_policies as Array<Record<string, unknown>>;
    const policy = policies.find(p => (p.method_settings as Array<{ method_setting_id: string }>).some(s => s.method_setting_id === ambiguousPolicy.device_use_sessions[0]!.method_setting_reference))!;
    policies.push({ ...structuredClone(policy), session_construction_policy_id: "independent-ambiguous-sessionlogger-policy" });
    expect(() => parseStudyMethodProfileLibrary({ profiles: ambiguousPolicy.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(ambiguousPolicy)).toThrow("requires one unambiguous complete app-period session policy");
    const ambiguousDefinition = structuredClone(source), owner = ambiguousDefinition.profiles[0]!;
    const duplicate = structuredClone(owner.method_settings.find(s => s.method_parameter_key === "quantapp.sensor_schedule")!);
    duplicate.method_setting_id += ":independent-duplicate"; owner.method_settings.push(duplicate);
    owner.method_setting_count = owner.method_settings.length;
    if (Array.isArray(owner.method_setting_ids)) owner.method_setting_ids.push(duplicate.method_setting_id);
    expect(() => parseStudyMethodProfileLibrary({ profiles: ambiguousDefinition.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(ambiguousDefinition)).toThrow("requires one compatible local app-period definition: quantapp.sensor_schedule");
  });
  it("rejects invented Hiniker phone-use wording and unoffered response values", () => {
    const source = periodExample(appPeriodWorks[1]!);
    for (const [field, value, error] of [["questionnaire_item_label", "invented question", /contradicts the disclosed phone-use question/], ["response_value_json", 1, /response_value_json must be lexical JSON or null/], ["response_value_json", '"unoffered answer"', /no disclosed phone-use response option/]] as const) {
      const invalid = structuredClone(source); Reflect.set(invalid.device_use_sessions[0]!.session_questionnaire_responses![0]!, field, value);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(error);
    }
  });
  it.each(appPeriodWorks)("rejects %s contradictory supplied app-period quantities", work => {
    const source = periodExample(work);
    const quantity = (v: typeof source) => v.device_use_sessions[0]!.session_quantities![0]!;
    for (const [mutate, message] of [
      [(v: typeof source) => { quantity(v).observed_property = "invented property"; }, "quantity scope/property/unit"],
      [(v: typeof source) => { quantity(v).evidence_unit = "invented unit"; }, "quantity scope/property/unit"],
      [(v: typeof source) => { quantity(v).evidence_value_json = "{}"; }, "independent supplied scalar value"],
      [(v: typeof source) => { quantity(v).evidence_value_json = "1e400"; }, "invalid supplied number"],
      [(v: typeof source) => { quantity(v).evidence_value_json = "true"; }, "no disclosed boolean feature"],
    ] as const) {
      const invalid = structuredClone(source); mutate(invalid);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(message);
    }
    if (!work.endsWith("2037383")) {
      for (const [value, message] of [[true, "label_value_json must be lexical JSON"], ['"unknown class"', "no disclosed engagement/usage class"]] as const) {
        const invalid = structuredClone(source); Reflect.set(invalid.device_use_sessions[0]!.session_labels![0]!, "label_value_json", value);
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(message);
      }
    }
    if (work.endsWith("2971762")) {
      const invalid = structuredClone(source);
      invalid.device_use_sessions[0]!.session_quantities!.find(q => q.quantity_scope === "app_category")!.observation_category = "invented category";
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("unknown source category");
    }
    const invalidScalar = structuredClone(source);
    invalidScalar.sampled_quantity_observations[0]!.quantities![0]!.evidence_value_json = "{}";
    expect(() => parseStudyMethodProfileLibrary(invalidScalar)).toThrow("finite supplied scalar or JSON null");
    if (work.endsWith("2037383")) {
      const invalidEvent = structuredClone(source);
      invalidEvent.sampled_quantity_observations.find(row => row.quantities?.some(q => q.observed_property === "screen event"))!.quantities!.find(q => q.observed_property === "screen event")!.evidence_value_json = '"screen locked"';
      expect(() => parseStudyMethodProfileLibrary(invalidEvent)).toThrow("unknown disclosed event/state descriptor");
    }
  });
  for (const work of appPeriodWorks) {
    it("preserves source-owned app periods, independent quantities/labels and raw observations: " + work, async () => {
      const input = periodExample(work), restored = await roundtrip(input);
      expect(restored.device_use_sessions).toEqual(input.device_use_sessions);
      expect(restored.sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
      expect(restored.task_occurrences).toEqual(input.task_occurrences);
      expect(input.device_use_sessions[0]!.session_actions!.map(action => action.app_identifier)).toEqual(["app-A", "app-B", "app-A"]);
      expect(new Set(input.device_use_sessions[0]!.session_actions!.map(action => action.task_action_id)).size).toBe(3);
      if (work.endsWith("2971760")) {
        expect(input.device_use_sessions[0]!.method_setting_reference).not.toBe(input.device_use_sessions[1]!.method_setting_reference);
        expect(input.device_use_sessions[0]!.session_quantities!.filter(q => q.observed_property === "BES").map(q => q.evidence_value_json)).toEqual(["0.50", "0.20", "0.50"]);
        expect(input.device_use_sessions[1]!.session_quantities!.filter(q => q.quantity_scope === "session")).toHaveLength(26);
        expect(input.device_use_sessions[1]!.end_condition).toBeNull();
        expect(input.task_occurrences[0]!.task_questionnaire_responses).toHaveLength(7);
        expect(input.device_use_sessions[1]!.session_labels!.at(-1)!.observed_property).toBe("duration-weighted session engagement class");
      } else if (work.endsWith("2971762")) {
        expect(input.device_use_sessions[0]!.session_quantities).toHaveLength(40);
        expect(input.device_use_sessions[1]!.session_quantities).toHaveLength(40);
        expect(input.device_use_sessions[0]!.session_quantities!.filter(q => q.quantity_scope === "app_category")).toHaveLength(20);
        expect(input.device_use_sessions[2]).not.toHaveProperty("session_labels");
        expect(input.device_use_sessions[3]!.session_labels).toBeNull();
        const visits = input.device_use_sessions[0]!.session_quantities!.filter(q => q.quantity_record_id === "feature.recent_window_app" || q.quantity_record_id === "feature.next_window_app");
        expect(visits.map(q => q.evidence_value_json)).toEqual(['"app-A"', '"app-A"']);
        expect(visits[0]!.support_task_action_references).not.toEqual(visits[1]!.support_task_action_references);
      } else {
        expect(input.sampled_quantity_observations.slice(0, 4).map(row => row.quantities![0]!.evidence_value_json)).toEqual(['"epsilon"', '"app-A"', '"app-A"', "null"]);
        expect(input.device_use_sessions[0]!.session_quantities!.map(q => q.evidence_value_json)).toEqual(["3", "2", "25.50", '"Communication"']);
      }
      for (const values of [undefined, null, []]) {
        const partial = structuredClone(input), row = partial.device_use_sessions[0]!, quantity = row.session_quantities![0]!;
        for (const field of ["support_task_action_references", "questionnaire_response_references"]) {
          if (values === undefined) Reflect.deleteProperty(quantity, field); else Reflect.set(quantity, field, values);
        }
        expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
      }
      for (const value of [undefined, null, "null", "0", '"0"', "17.000"]) {
        const partial = structuredClone(input), quantity = partial.device_use_sessions[0]!.session_quantities![0]!;
        if (value === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = value;
        expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
      }
    });
    it("rejects foreign or duplicate supports without replacing saved app-period records: " + work, async () => {
      const input = periodExample(work); await roundtrip(input); const prior = await loadResearchMethodSelection();
      for (const mutate of [
        (v: typeof input) => { v.device_use_sessions[0]!.session_quantities![0]!.support_task_action_references = ["foreign-session-period"]; },
        (v: typeof input) => { const q = v.device_use_sessions[0]!.session_quantities![0]!, id = v.device_use_sessions[0]!.session_actions![0]!.task_action_id; q.support_task_action_references = [id, id]; },
        (v: typeof input) => { const action = { ...structuredClone(v.device_use_sessions[0]!.session_actions![0]!), task_action_id: "example:only-in-another-session" }; v.device_use_sessions[1]!.session_actions = [action]; v.device_use_sessions[0]!.session_quantities![0]!.support_task_action_references = [action.task_action_id]; },
        (v: typeof input) => { v.device_use_sessions[0]!.session_quantities![0]!.questionnaire_response_references = ["foreign-session-response"]; },
        (v: typeof input) => { Reflect.set(v.device_use_sessions[0]!.session_quantities![0]!, "support_task_action_references", "period-id"); },
        (v: typeof input) => { v.device_use_sessions[0]!.session_actions!.push(structuredClone(v.device_use_sessions[0]!.session_actions![0]!)); },
      ]) {
        const invalid = structuredClone(input); mutate(invalid);
        await expect(roundtrip(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(prior);
      }
      if (work.endsWith("2971762")) {
        const wrongAnswer = structuredClone(input);
        wrongAnswer.device_use_sessions[0]!.session_quantities![0]!.questionnaire_response_references = [wrongAnswer.device_use_sessions[1]!.session_questionnaire_responses![0]!.questionnaire_response_id];
        expect(() => parseStudyMethodProfileLibrary(wrongAnswer)).toThrow("containing session");
      }
      if (!work.endsWith("2037383")) {
        const wrongApp = structuredClone(input), q = wrongApp.device_use_sessions[0]!.session_quantities!.find(q => q.quantity_scope === "app")!;
        q.support_task_action_references = [wrongApp.device_use_sessions[0]!.session_actions![1]!.task_action_id];
        expect(() => parseStudyMethodProfileLibrary(wrongApp)).toThrow("known supported app-period identity");
        const unknownApp = structuredClone(wrongApp); unknownApp.device_use_sessions[0]!.session_actions![1]!.app_identifier = null;
        expect(parseStudyMethodProfileLibrary(unknownApp).device_use_sessions).toEqual(unknownApp.device_use_sessions);
        const wrongLabel = structuredClone(input); wrongLabel.device_use_sessions[0]!.session_labels![0]!.support_task_action_references = ["foreign"];
        expect(() => parseStudyMethodProfileLibrary(wrongLabel)).toThrow("containing session");
      }
    });
    it("keeps source policies and definition wrappers terminal rather than generic constructor fallbacks: " + work, () => {
      const input = periodExample(work), key = work.endsWith("2971760") ? "sessionlogger.screen_session_bounds"
        : work.endsWith("2971762") ? "session.partition" : "session.application_chain_constructor";
      const select = (v: typeof input) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
      const original: unknown = JSON.parse(String(select(input).method_value_json));
      const body = typeof original === "object" && original !== null && Object.hasOwn(original, "definition") ? (original as { definition: unknown }).definition : original;
      for (const definition of [null, "not a constructor", 0, { start: "unlock", end: "lock" }]) {
        const invalid = structuredClone(input);
        select(invalid).method_value_json = JSON.stringify({ definition, source_facing_role: "reconstruction", source_facing_target: "device_session" });
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
      }
      for (const field of ["source_facing_role", "source_facing_target"]) {
        const invalid = structuredClone(input);
        select(invalid).method_value_json = JSON.stringify({ definition: body, source_facing_role: "reconstruction", source_facing_target: "device_session", [field]: "foreign" });
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
      }
      if (!work.endsWith("2037383")) {
        const policy = structuredClone(input);
        const policies = policy.profiles[0]!.session_construction_policies as Array<{ method_settings: Array<Record<string, unknown>> }>;
        policies[0]!.method_settings.pop();
        expect(() => parseStudyMethodProfileLibrary(policy)).toThrow();
      }
      const foreign = structuredClone(input); foreign.profiles[0]!.source_work_id = "doi:10.1145/1879141.1879176";
      for (const setting of foreign.profiles[0]!.method_settings) setting.source_work_id = foreign.profiles[0]!.source_work_id;
      foreign.device_use_sessions.forEach(row => { row.source_work_id = foreign.profiles[0]!.source_work_id; });
      expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles, device_use_sessions: foreign.device_use_sessions })).toThrow();
    });
  }
  it("does not transplant SessionLogger EEG/policies into the distinct QuantApp session route", () => {
    const input = periodExample("doi:10.1145/2971648.2971760");
    const wrong = structuredClone(input);
    wrong.device_use_sessions[1]!.session_labels![0]!.label_setting_reference = wrong.device_use_sessions[0]!.session_labels![0]!.label_setting_reference;
    wrong.device_use_sessions[1]!.session_labels![0]!.observed_property = "EEG-derived app-period engagement class";
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow("study-stage");
    const wrongBES = structuredClone(input);
    wrongBES.device_use_sessions[1]!.session_quantities!.push(structuredClone(wrongBES.device_use_sessions[0]!.session_quantities!.find(q => q.observed_property === "BES")!));
    expect(() => parseStudyMethodProfileLibrary(wrongBES)).toThrow("study-stage");
    const wrongEnd = structuredClone(input); wrongEnd.device_use_sessions[1]!.end_condition = "screen-off";
    expect(() => parseStudyMethodProfileLibrary(wrongEnd)).toThrow("end_condition");
    for (const [field, value] of [["DayOfWeek", "7"], ["HourOfDay", "24"], ["BatteryLevel", "101"]]) {
      const invalid = structuredClone(input); invalid.device_use_sessions[1]!.session_quantities!.find(q => q.observed_property === field)!.evidence_value_json = value;
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("numeric feature range");
    }
  });
  it("requires each consumed source body, including UES printed items and raw nominal-state definitions", () => {
    const choices: Array<[string, string]> = [
      ["doi:10.1145/2971648.2971760", "sessionlogger.screen_session_merge"],
      ["doi:10.1145/2971648.2971760", "sessionlogger.merge_parameter_provenance"],
      ["doi:10.1145/2971648.2971760", "quantapp.sensor_schedule"],
      ["doi:10.1145/2971648.2971760", "quantapp.context_feature_inventory"],
      ["doi:10.1145/2971648.2971760", "benchmark.ues_measure"],
      ["doi:10.1145/2971648.2971762", "session.delimiter.system_launcher_idle"],
      ["doi:10.1145/2971648.2971762", "diary.response_options"],
      ["doi:10.1145/2971648.2971762", "window.esm_partition"],
      ["doi:10.1145/2971648.2971762", "feature.next_window_app"],
      ["doi:10.1145/2037373.2037383", "schema.appsensor_state_domain"],
    ];
    for (const [work, key] of choices) for (const body of [null, 0, "foreign"]) {
      const invalid = periodExample(work), setting = invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
      const content: unknown = JSON.parse(String(setting.method_value_json));
      setting.method_value_json = JSON.stringify({ ...(typeof content === "object" && content !== null && !Array.isArray(content) ? content : {}),
        definition: body, source_facing_role: setting.method_setting_role, source_facing_target: setting.method_target_layer });
      expect(() => parseStudyMethodProfileLibrary(invalid), key).toThrow();
    }
    const ues = periodExample("doi:10.1145/2971648.2971760"), setting = ues.profiles[0]!.method_settings.find(s => s.method_parameter_key === "benchmark.ues_measure")!;
    const instrument = JSON.parse(String(setting.method_value_json)) as { printed_items: Record<string, string[]> };
    instrument.printed_items.Overall = ["invented substitute item"]; setting.method_value_json = JSON.stringify(instrument);
    expect(() => parseStudyMethodProfileLibrary(ues)).toThrow();
  });

  const falakiExample = () => falakiDeviceSessionExample(parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles.find(p => p.source_work_id === "doi:10.1145/1814433.1814453")!);
  it("preserves Falaki OR-active continuity and independent unknown boundaries, never precise Android app sessions", async () => {
    const source = falakiExample();
    expect(source.profiles[0]!.session_construction_policies).toEqual([]);
    expect((await roundtrip(source)).device_use_sessions).toEqual(source.device_use_sessions);
    expect(source.device_use_sessions[0]!.session_actions![0]!.assigned_role_labels).toEqual(["voice call active"]);
    expect(source.device_use_sessions[0]!.denotes_interval!.duration_seconds).toBe(40);
    expect(source.device_use_sessions[0]!.session_actions![0]!.denotes_interval!.duration_seconds).toBe(40);
    expect(source.device_use_sessions[0]!.start_condition).toBeNull(); expect(source.device_use_sessions[0]!.end_condition).toBeNull();
    expect(source.device_use_sessions[1]!.denotes_interval!.duration_seconds).toBe(0);
    expect(source.device_use_sessions[1]!.session_actions).toEqual([]);
    expect(source.device_use_sessions[2]!.session_actions).toBeNull();
    expect(source.device_use_sessions[3]).not.toHaveProperty("session_actions");
    await roundtrip(source); const retained = await loadResearchMethodSelection();
    for (const mutate of [
      (v: typeof source) => { v.device_use_sessions[0]!.start_condition = "unlock"; },
      (v: typeof source) => { v.device_use_sessions[0]!.end_condition = "screen off"; },
      (v: typeof source) => { v.device_use_sessions[1]!.device_use_session_id = v.device_use_sessions[0]!.device_use_session_id; },
      (v: typeof source) => { v.device_use_sessions[0]!.session_actions!.push(structuredClone(v.device_use_sessions[0]!.session_actions![0]!)); },
      (v: typeof source) => { v.device_use_sessions[0]!.following_device_use_session_reference = v.device_use_sessions[1]!.device_use_session_id; },
    ]) {
      const invalid = structuredClone(source); mutate(invalid);
      await expect(roundtrip(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained);
    }
  });
  it("admits the exact Falaki OR constructor without generic or foreign-source fallback", () => {
    const input = falakiExample();
    const setting = (v: typeof input) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === "reconstruction.android_interaction_predicate")!;
    const expected = { entity: "interaction interval, also called session", active_when: { operator: "OR", states: ["screen on", "voice call active"] } };
    const wrapper = { definition: expected, source_facing_role: "reconstruction", source_facing_target: "device_session" };
    for (const value of [expected, wrapper]) {
      const positive = structuredClone(input); setting(positive).method_value_json = JSON.stringify(value);
      expect(parseStudyMethodProfileLibrary(positive).device_use_sessions).toEqual(input.device_use_sessions);
    }
    for (const value of [{ ...wrapper, definition: { ...expected, active_when: { operator: "AND", states: ["screen on", "voice call active"] } } },
      { ...wrapper, definition: { start: "unlock", end: "lock" } }, { ...wrapper, source_facing_role: "provenance" },
      { ...wrapper, source_facing_target: "app_episode" }]) {
      const negative = structuredClone(input); setting(negative).method_value_json = JSON.stringify(value);
      expect(() => parseStudyMethodProfileLibrary({ profiles: negative.profiles })).not.toThrow();
      expect(() => parseStudyMethodProfileLibrary(negative)).toThrow(/OR-active|source-facing/);
    }
    const foreign = structuredClone(input), work = "doi:10.1145/1879141.1879176";
    foreign.profiles[0]!.source_work_id = work;
    for (const setting of foreign.profiles[0]!.method_settings) setting.source_work_id = work;
    foreign.device_use_sessions.forEach(row => { row.source_work_id = work; });
    expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow("OR-active");
  });
  const apnomsExample = () => apnomsDeviceSessionExample(parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles.find(p => p.source_work_id === "doi:10.1109/apnoms.2011.6077030")!);
  it("preserves separate APNOMS network, charging and change intervals with independent battery endpoints", async () => {
    const input = apnomsExample();
    expect((await roundtrip(input)).device_use_sessions).toEqual(input.device_use_sessions);
    expect(input.device_use_sessions).toHaveLength(6);
    const changed = structuredClone(input); changed.device_use_sessions[3]!.session_quantities![0]!.evidence_value_json = "99.0";
    expect((await roundtrip(changed)).device_use_sessions).toEqual(changed.device_use_sessions);
    expect(changed.device_use_sessions[3]!.denotes_interval).toEqual(input.device_use_sessions[3]!.denotes_interval);
    for (const value of [undefined, null, "null"]) {
      const partial = structuredClone(input);
      if (value === undefined) delete partial.device_use_sessions[3]!.session_quantities![0]!.evidence_value_json;
      else partial.device_use_sessions[3]!.session_quantities![0]!.evidence_value_json = value;
      expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
    }
    await roundtrip(input); const retained = await loadResearchMethodSelection();
    for (const mutate of [
      (v: typeof input) => { v.device_use_sessions[0]!.end_condition = "screen-off"; },
      (v: typeof input) => { v.device_use_sessions[0]!.session_labels![0]!.label_value_json = '"LTE"'; },
      (v: typeof input) => { v.device_use_sessions[3]!.session_labels![0]!.label_value_json = '"Battery"'; },
      (v: typeof input) => { v.device_use_sessions[3]!.session_labels![0]!.questionnaire_response_references = ["guessed-answer"]; },
      (v: typeof input) => { v.device_use_sessions[0]!.session_quantities = v.device_use_sessions[3]!.session_quantities; },
      (v: typeof input) => { v.device_use_sessions[3]!.session_quantities![0]!.evidence_unit = "seconds"; },
      (v: typeof input) => { v.device_use_sessions[3]!.session_quantities![0]!.quantity_scope = "app"; },
      (v: typeof input) => { v.device_use_sessions[3]!.session_quantities![0]!.observed_property = "battery consumption"; },
      ...["{}", "[]", "true", "-1", "101", "1e400"].map(value => (v: typeof input) => { v.device_use_sessions[3]!.session_quantities![0]!.evidence_value_json = value; }),
    ]) {
      const invalid = structuredClone(input); mutate(invalid);
      await expect(roundtrip(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained);
    }
  });
  it.each(["reconstruction.network_session_scope", "reconstruction.battery_interval_definition", "reconstruction.battery_change_interval", "reconstruction.start_battery_level", "reconstruction.end_battery_level", "schema.battery_plugged_vocabulary"])("requires APNOMS interval definition %s without fallback", key => {
    const input = apnomsExample(), setting = (v: typeof input) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
    const original: unknown = JSON.parse(String(setting(input).method_value_json));
    const body = original && typeof original === "object" && "definition" in original ? original.definition : original;
    const wrapper = { definition: body, source_facing_role: setting(input).method_setting_role, source_facing_target: setting(input).method_target_layer };
    for (const value of [body, wrapper]) {
      const valid = structuredClone(input); setting(valid).method_value_json = JSON.stringify(value);
      expect(parseStudyMethodProfileLibrary(valid).device_use_sessions).toEqual(input.device_use_sessions);
    }
    for (const value of [{ ...wrapper, definition: null }, { ...wrapper, definition: { start: "unlock", end: "lock" } }, { ...wrapper, source_facing_role: "provenance" }, { ...wrapper, source_facing_target: "raw_occurrence" }]) {
      const invalid = structuredClone(input); setting(invalid).method_value_json = JSON.stringify(value);
      expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
    }
    for (const [field, value] of [["method_setting_role", "provenance"], ["method_target_layer", "study_window"], ["source_work_id", "doi:foreign"]]) {
      const invalid = structuredClone(input); Reflect.set(setting(invalid), field!, value);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
    }
  });
  const mommExample = () => mommDeviceSessionExample(parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles.find(p => p.source_work_id === "doi:10.1145/2684103.2684156")!);
  it("preserves MOMM call-aware membership, authentication interval and independent kind/context labels", async () => {
    const source = mommExample();
    expect((await roundtrip(source)).device_use_sessions).toEqual(source.device_use_sessions);
    expect(source.device_use_sessions).toHaveLength(4);
    expect(source.device_use_sessions[1]!.session_actions).toHaveLength(4);
    expect(source.device_use_sessions[0]!.session_actions!.at(-1)!.denotes_interval).toEqual({ duration_seconds: 2.5 });
    const changed = structuredClone(source);
    changed.device_use_sessions[0]!.session_labels![0]!.label_value_json = '"unlocked"';
    changed.device_use_sessions[1]!.session_labels![1]!.label_value_json = '"home"';
    changed.device_use_sessions[0]!.denotes_interval!.duration_seconds = 99;
    expect((await roundtrip(changed)).device_use_sessions).toEqual(changed.device_use_sessions);
    expect(changed.device_use_sessions.map(row => row.session_actions)).toEqual(source.device_use_sessions.map(row => row.session_actions));
    for (const value of [undefined, null, "null"]) {
      const partial = structuredClone(source);
      for (const label of partial.device_use_sessions[0]!.session_labels!) {
        if (value === undefined) delete label.label_value_json; else label.label_value_json = value;
      }
      expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
    }
    await roundtrip(source); const retained = await loadResearchMethodSelection();
    for (const mutate of [
      (v: typeof source) => Reflect.set(v.device_use_sessions[0]!.session_labels![0]!, "label_value_json", true),
      (v: typeof source) => { v.device_use_sessions[0]!.start_condition = "screen|power (on)"; },
      (v: typeof source) => { v.device_use_sessions[0]!.start_condition = "phone|ringing"; },
      (v: typeof source) => { v.device_use_sessions[0]!.end_condition = "screen|power (off)"; },
      (v: typeof source) => { v.device_use_sessions[0]!.session_labels![0]!.label_value_json = '"screen-on"'; },
      (v: typeof source) => { v.device_use_sessions[0]!.session_labels![1]!.label_value_json = '"abroad"'; },
      (v: typeof source) => { v.device_use_sessions[0]!.session_labels![1]!.questionnaire_response_references = ["invented-answer"]; },
      (v: typeof source) => { v.device_use_sessions.push(structuredClone(v.device_use_sessions[0]!)); },
    ]) {
      const invalid = structuredClone(source); mutate(invalid);
      await expect(roundtrip(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained);
    }
  });
  for (const key of ["session.call_aware_constructor", "session.locked_unlocked_meaning", "context.session_assignment"]) {
    it(`requires exact MOMM source semantics for ${key}`, async () => {
      const source = mommExample(), setting = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
      const wrapped = JSON.parse(String(setting(source).method_value_json)) as Record<string, unknown>;
      for (const value of [wrapped, wrapped.definition]) {
        const valid = structuredClone(source); setting(valid).method_value_json = JSON.stringify(value);
        expect((await roundtrip(valid)).device_use_sessions).toEqual(source.device_use_sessions);
      }
      for (const value of [{ ...wrapped, definition: null }, { ...wrapped, definition: { ...(wrapped.definition as Record<string, unknown>), invented: true } }, { ...wrapped, source_facing_role: "analysis" }, { ...wrapped, source_facing_target: null }, { ...wrapped, definition: { start: "screen-on", end: "screen-off", target_item: "decoy", yes: "yes", no: "no" } }]) {
        const invalid = structuredClone(source); setting(invalid).method_value_json = JSON.stringify(value);
        expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
      }
      for (const [field, value] of [["source_work_id", "doi:foreign"], ["method_setting_role", "acquisition"], ["method_target_layer", "app_session"]]) {
        const invalid = structuredClone(source); Reflect.set(setting(invalid), field!, value);
        expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
      }
    });
  }
  const vanExample = () => vanBerkelDeviceSessionExample(parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles.find(p => p.source_work_id === "doi:10.1145/2858036.2858348")!);
  it("preserves Van Berkel T0 sessions, onset answers, independent labels and five session features", async () => {
    const source = vanExample(), expected = structuredClone(source.device_use_sessions);
    expect((await roundtrip(source)).device_use_sessions).toEqual(expected);
    expect(expected[1]!.session_quantities![4]!.evidence_value_json).toBe("45000");
    expect(expected[1]!.session_labels![0]!.label_value_json).toBe("0"); // Not the constant-classifier prediction.
    expect(expected[4]!.session_actions![0]!.action_label).toBe("ignore");
    expect(expected[4]!.session_labels).toBeNull();
    expect(expected[5]!.session_actions![0]!.action_label).toBe("dismiss");
    expect(expected[5]).not.toHaveProperty("session_labels");
    const changed = structuredClone(source);
    changed.device_use_sessions[0]!.session_actions!.reverse();
    changed.device_use_sessions[0]!.session_questionnaire_responses![0]!.response_value_json = '"Continue previous objective"';
    changed.device_use_sessions[0]!.session_quantities![4]!.evidence_value_json = "120000";
    changed.device_use_sessions.reverse();
    expect((await roundtrip(changed)).device_use_sessions).toEqual(changed.device_use_sessions);
    expect(changed.device_use_sessions.at(-1)!.session_labels).toEqual(expected[0]!.session_labels);
    for (const value of [undefined, null, "null"]) {
      const partial = structuredClone(source), first = partial.device_use_sessions[0]!;
      for (const [row, field] of [[first.session_questionnaire_responses![0]!, "response_value_json"], [first.session_labels![0]!, "label_value_json"], [first.session_quantities![4]!, "evidence_value_json"]] as const) {
        if (value === undefined) Reflect.deleteProperty(row, field); else Reflect.set(row, field, value);
      }
      expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
    }
    await roundtrip(source); const retained = await loadResearchMethodSelection();
    for (const mutate of [
      (v: typeof source) => { v.device_use_sessions[0]!.start_condition = "unlock"; },
      (v: typeof source) => { v.device_use_sessions[0]!.end_condition = "lock"; },
      (v: typeof source) => Reflect.set(v.device_use_sessions[0]!.session_questionnaire_responses![0]!, "response_value_json", 1),
      (v: typeof source) => { v.device_use_sessions[0]!.session_questionnaire_responses![0]!.response_value_json = '"Other"'; },
      (v: typeof source) => { v.device_use_sessions[0]!.session_questionnaire_responses![0]!.questionnaire_item_label = "Why did you stop?"; },
      (v: typeof source) => { v.device_use_sessions[0]!.session_labels![0]!.label_value_json = '"0"'; },
      (v: typeof source) => { v.device_use_sessions[0]!.session_labels![0]!.label_value_json = "true"; },
      (v: typeof source) => { v.device_use_sessions[0]!.session_labels![0]!.questionnaire_response_references = ["onset-answer-1"]; },
      (v: typeof source) => { v.device_use_sessions[0]!.session_quantities![4]!.evidence_unit = "seconds"; },
      (v: typeof source) => { v.device_use_sessions[0]!.session_quantities![4]!.quantity_scope = "app"; },
      (v: typeof source) => { v.device_use_sessions[0]!.session_quantities![0]!.quantity_qualifier = "ordered chain"; },
      (v: typeof source) => { v.device_use_sessions[0]!.following_device_use_session_reference = "constructed:T0-0"; },
      (v: typeof source) => { v.device_use_sessions[0]!.following_device_use_session_reference = "missing"; },
      (v: typeof source) => { v.device_use_sessions[3]!.following_device_use_session_reference = "constructed:T0-0"; },
      (v: typeof source) => { v.device_use_sessions[2]!.following_device_use_session_reference = "constructed:T0-1"; },
      (v: typeof source) => { v.device_use_sessions[1]!.participant_id = "foreign"; },
      (v: typeof source) => { v.device_use_sessions[1]!.device_id = "foreign"; },
    ]) {
      const invalid = structuredClone(source); mutate(invalid);
      await expect(roundtrip(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained);
    }
  });
  for (const key of ["session.base_T0", "diary.item_and_options", "diary.session_outcome_encoding", "feature.application_set", "feature.category_set", "feature.weekday", "feature.hour", "feature.intersession_gap"]) {
    it(`enforces exact Van Berkel source semantics for ${key}`, async () => {
      const source = vanExample(); source.profiles[0]!.session_construction_policies = [];
      const setting = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
      const original = setting(source), body = JSON.parse(String(original.method_value_json)) as Record<string, unknown>;
      const wrapped = { definition: body, source_facing_role: original.method_setting_role, source_facing_target: original.method_target_layer };
      for (const value of [body, wrapped]) {
        const valid = structuredClone(source); setting(valid).method_value_json = JSON.stringify(value);
        expect((await roundtrip(valid)).device_use_sessions).toEqual(source.device_use_sessions);
      }
      for (const value of [{ ...wrapped, definition: null }, { ...wrapped, definition: { ...body, invented: true } }, { ...wrapped, source_facing_target: "participant_day" }, { ...wrapped, source_facing_role: "quality_rule" }, { ...body, start: "unlock", end: "lock", figure_question: "generic fallback", target_item: "generic", yes: "yes", no: "no" }]) {
        const invalid = structuredClone(source); setting(invalid).method_value_json = JSON.stringify(value);
        expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
      }
      for (const field of ["method_setting_role", "method_target_layer", "source_work_id"]) {
        const invalid = structuredClone(source); Reflect.set(setting(invalid), field, field === "source_work_id" ? "doi:10.1145/3604241" : field === "method_setting_role" ? "analysis" : "participant_day");
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
      }
    });
  }
  it("preserves Cognitive unlock sessions without inventing PVT ownership or a closer", async () => {
    const profile = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles.find(p => p.source_work_id === "doi:10.1145/2971648.2971712")!;
    const source = cognitiveDeviceSessionExample(profile);
    expect((await roundtrip(source)).device_use_sessions).toEqual(source.device_use_sessions);
    expect(source.device_use_sessions.map(row => row.denotes_interval!.duration_seconds)).toEqual([29, 30]);
    expect(source.device_use_sessions[0]!.end_condition).toBeNull(); expect(source.device_use_sessions[1]).not.toHaveProperty("end_condition");
    source.profiles[0]!.session_construction_policies = [];
    const setting = (value: typeof source) => value.profiles[0]!.method_settings.find(s => s.method_parameter_key === "session.unlock_marked_device_use")!;
    const original = JSON.parse(String(setting(source).method_value_json)) as Record<string, unknown>;
    for (const body of [original.definition, { definition: original.definition, source_facing_role: "reconstruction", source_facing_target: "device_session" }]) {
      const valid = structuredClone(source); setting(valid).method_value_json = JSON.stringify(body);
      expect((await roundtrip(valid)).device_use_sessions).toEqual(source.device_use_sessions);
    }
    for (const body of [{ ...original, definition: null }, { ...original, definition: { start: "unlocking the phone", end: "lock" } },
      { ...original, source_facing_role: null }, { ...original, source_facing_target: "app_session" }, { ...original, source_interpretation_limits: "" }]) {
      const invalid = structuredClone(source); setting(invalid).method_value_json = JSON.stringify(body);
      expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("compatible unlock-marked session definition");
    }
    await roundtrip(source); const retained = await loadResearchMethodSelection();
    for (const mutate of [
      (v: typeof source) => { v.device_use_sessions[0]!.start_condition = "screen-on"; },
      (v: typeof source) => { v.device_use_sessions[0]!.end_condition = "screen-off"; },
      (v: typeof source) => { v.device_use_sessions[0]!.end_condition = "lock"; },
      (v: typeof source) => { v.device_use_sessions.push(structuredClone(v.device_use_sessions[0]!)); },
      (v: typeof source) => { v.profiles[0]!.source_work_id = "doi:10.1145/2935334.2935383"; v.device_use_sessions.forEach(row => { row.source_work_id = v.profiles[0]!.source_work_id; }); },
    ]) {
      const invalid = structuredClone(source); mutate(invalid); await expect(roundtrip(invalid)).rejects.toThrow();
      expect(await loadResearchMethodSelection()).toBe(retained);
    }
  });
  for (const [workId, fixture, key, target] of [
    ["doi:10.3390/bs5040434", recordedBehaviorDeviceSessionExample, "reconstruction.session_definition", "device_session"],
    ["doi:10.4088/jcp.15m10310", appMeasuresDeviceSessionExample, "reconstruction.epoch_boundary", "screen_bout"],
  ] as const) {
    const sourceExample = () => {
      const profile = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles.find(p => p.source_work_id === workId)!;
      return fixture(profile);
    };
    it(`preserves independent supplied sessions and unknown boundaries for ${workId}`, async () => {
      const input = sourceExample(), expected = structuredClone(input.device_use_sessions);
      expect((await roundtrip(input)).device_use_sessions).toEqual(expected);
      if (target === "device_session") expect(expected.every(row => !Object.hasOwn(row, "start_condition") && !Object.hasOwn(row, "end_condition"))).toBe(true);
      else expect(expected.map(row => [row.start_condition, row.end_condition])).toEqual([["screen-on", "screen-off"], ["screen-on", "screen-off"]]);
      const changed = structuredClone(input); changed.device_use_sessions[0]!.denotes_interval!.duration_seconds = 123.5;
      const changedExpected = structuredClone(changed.device_use_sessions);
      expect((await roundtrip(changed)).device_use_sessions).toEqual(changedExpected);
      expect(changedExpected[1]).toEqual(expected[1]);
      for (const value of [undefined, null]) {
        const partial = structuredClone(input);
        for (const field of ["start_condition", "end_condition", "denotes_interval"] as const) {
          if (value === undefined) delete partial.device_use_sessions[0]![field]; else Reflect.set(partial.device_use_sessions[0]!, field, value);
        }
        const partialExpected = structuredClone(partial.device_use_sessions);
        expect((await roundtrip(partial)).device_use_sessions).toEqual(partialExpected);
      }
      await roundtrip(input); const retained = await loadResearchMethodSelection();
      for (const mutate of [
        (value: typeof input) => { value.device_use_sessions[0]!.start_condition = "unlock"; },
        (value: typeof input) => { value.device_use_sessions[0]!.end_condition = "lock"; },
        (value: typeof input) => { value.device_use_sessions[0]!.source_work_id = "foreign"; },
        (value: typeof input) => { value.device_use_sessions.push(structuredClone(value.device_use_sessions[0]!)); },
      ]) {
        const invalid = structuredClone(input); mutate(invalid);
        await expect(roundtrip(invalid)).rejects.toThrow();
        expect(await loadResearchMethodSelection()).toBe(retained);
      }
    });
    it(`admits only the exact source constructor and tuple for ${workId}`, () => {
      const input = sourceExample();
      const setting = (value: typeof input) => value.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
      const syncMembers = (value: typeof input) => {
        for (const policy of value.profiles[0]!.session_construction_policies as Array<{ method_settings: Array<{ method_setting_id: string }> }>) {
          policy.method_settings = policy.method_settings.map(member => structuredClone(value.profiles[0]!.method_settings.find(s => s.method_setting_id === member.method_setting_id)!));
        }
      };
      const expected = structuredClone(input.device_use_sessions);
      expect(parseStudyMethodProfileLibrary(input).device_use_sessions).toEqual(expected);
      const body: unknown = JSON.parse(String(setting(input).method_value_json));
      const wrapper = { definition: body, source_facing_role: "reconstruction", source_facing_target: target };
      const wrapped = structuredClone(input); setting(wrapped).method_value_json = JSON.stringify(wrapper); syncMembers(wrapped);
      expect(parseStudyMethodProfileLibrary(wrapped).device_use_sessions).toEqual(expected);
      for (const content of [
        { ...wrapper, definition: null }, { ...wrapper, definition: {} },
        { ...wrapper, definition: { start: "unlock", end: "lock" } },
        { ...wrapper, definition: target === "screen_bout" ? { opener: "screen-on", closer: "lock" } : "uninterrupted interaction with one app" },
        ...(["source_facing_role", "source_facing_target"] as const).flatMap(field => [undefined, null, "foreign"].map(value => ({ ...wrapper, [field]: value }))),
      ]) {
        const invalid = structuredClone(input); setting(invalid).method_value_json = JSON.stringify(content); syncMembers(invalid);
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
      }
      for (const [field, value] of [["method_setting_role", "event_schema"], ["method_target_layer", "app_session"]] as const) {
        const invalid = structuredClone(input); Reflect.set(setting(invalid), field, value); syncMembers(invalid);
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(workId === "doi:10.4088/jcp.15m10310" && field === "method_target_layer"
          ? "constructor/output target mismatch" : "local definition role/target");
      }
      const isolated = structuredClone(input); isolated.profiles[0]!.session_construction_policies = [];
      expect(parseStudyMethodProfileLibrary(isolated).device_use_sessions).toEqual(expected);
      for (const [field, value] of [["method_setting_role", "event_schema"], ["method_target_layer", "app_session"]] as const) {
        const invalid = structuredClone(isolated); Reflect.set(setting(invalid), field, value);
        expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("local definition role/target");
      }
      const transplanted = structuredClone(input); transplanted.profiles[0]!.source_work_id = "doi:10.1186/s13104-015-1280-z";
      transplanted.device_use_sessions.forEach(row => { row.source_work_id = transplanted.profiles[0]!.source_work_id; });
      expect(() => parseStudyMethodProfileLibrary({ profiles: transplanted.profiles })).not.toThrow();
      expect(() => parseStudyMethodProfileLibrary(transplanted)).toThrow(/compatible .*definition/);
    });
  }

  it("preserves supplied WhatsApp visual-phone sessions and independent durations without invented lock boundaries", async () => {
    const input = whatsappExample();
    const expected = structuredClone(input.device_use_sessions);
    const restored = await roundtrip(input);
    expect(restored.device_use_sessions).toEqual(expected);
    expect(restored.device_use_sessions!.map(row => [row.device_use_session_id, row.denotes_interval])).toEqual([
      ["example:visual-phone-session-0", { duration_seconds: 17.5, start_instant: null, end_instant: null }],
      ["example:visual-phone-session-1", { duration_seconds: 0 }],
    ]);
    expect(restored.device_use_sessions!.every(row => !Object.hasOwn(row, "start_condition") && !Object.hasOwn(row, "end_condition"))).toBe(true);
    const changed = structuredClone(input); changed.device_use_sessions[0]!.denotes_interval!.duration_seconds = 123.5;
    const changedExpected = structuredClone(changed.device_use_sessions);
    expect((await roundtrip(changed)).device_use_sessions).toEqual(changedExpected);
    expect(changedExpected[1]).toEqual(expected[1]);
    for (const interval of [undefined, null, {}, { start_instant: null, end_instant: null }, { start_instant: "opaque-start", end_instant: "opaque-end", duration_seconds: 7.25 }]) {
      const partial = structuredClone(input);
      if (interval === undefined) delete partial.device_use_sessions[0]!.denotes_interval;
      else partial.device_use_sessions[0]!.denotes_interval = interval;
      partial.device_use_sessions[0]!.start_condition = null; partial.device_use_sessions[0]!.end_condition = null;
      const partialExpected = structuredClone(partial.device_use_sessions);
      expect((await roundtrip(partial)).device_use_sessions).toEqual(partialExpected);
    }
    await roundtrip(input); const retained = await loadResearchMethodSelection();
    for (const [field, value] of [["start_condition", "unlock"], ["end_condition", "lock"]] as const) {
      const invalid = structuredClone(input); invalid.device_use_sessions[0]![field] = value;
      await expect(roundtrip(invalid)).rejects.toThrow(field);
      expect(await loadResearchMethodSelection()).toBe(retained);
    }
  });

  it("admits only the actual WhatsApp phone-session source tuple and uninterrupted visual-phone definition", () => {
    const input = whatsappExample();
    const setting = (value: typeof input) => value.profiles[0]!.method_settings.find(s => s.method_parameter_key === "session.phone_definition")!;
    expect(parseStudyMethodProfileLibrary(input).device_use_sessions).toEqual(input.device_use_sessions);
    const wrapper = { definition: "period of uninterrupted phone interaction", source_facing_role: "reconstruction", source_facing_target: "phone_session" };
    const wrapped = structuredClone(input); setting(wrapped).method_value_json = JSON.stringify(wrapper);
    expect(parseStudyMethodProfileLibrary(wrapped).device_use_sessions).toEqual(input.device_use_sessions);
    for (const content of [
      { ...wrapper, definition: null }, { ...wrapper, definition: "continuous interaction with one app" },
      { ...wrapper, definition: { start: "unlock", end: "lock" } },
      { ...wrapper, source_facing_role: "event_schema" }, { ...wrapper, source_facing_target: "device_session" },
    ]) {
      const invalid = structuredClone(input); setting(invalid).method_value_json = JSON.stringify(content);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
    }
    for (const [field, value] of [["method_setting_role", "event_schema"], ["method_target_layer", "app_session"]] as const) {
      const invalid = structuredClone(input); Reflect.set(setting(invalid), field, value);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("local definition role/target");
    }
    const otherDefinition = structuredClone(input);
    otherDefinition.device_use_sessions[0]!.method_setting_reference = otherDefinition.profiles[0]!.method_settings.find(s => s.method_parameter_key === "session.phone_call")!.method_setting_id;
    expect(() => parseStudyMethodProfileLibrary(otherDefinition)).toThrow("compatible device-session constructor definition");
    // The transplanted definition has matching record/profile ownership: this tests actual source identity.
    const transplanted = structuredClone(input);
    transplanted.profiles[0]!.source_work_id = "doi:10.2196/13209";
    transplanted.device_use_sessions.forEach(row => { row.source_work_id = transplanted.profiles[0]!.source_work_id; });
    expect(() => parseStudyMethodProfileLibrary({ profiles: transplanted.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(transplanted)).toThrow("compatible visual-phone session definition");
  });

  it("preserves independent loneliness unlock-to-off and unlock-to-lock intervals without HardLock reconstruction", async () => {
    const profile = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles.find(p => p.source_work_id === "doi:10.2196/13209")!;
    const input = lonelinessDeviceSessionExample(profile);
    expect((await roundtrip(input)).device_use_sessions).toEqual(input.device_use_sessions);
    expect(input.device_use_sessions.map(row => [row.start_condition, row.end_condition])).toEqual([["unlock", "off"], ["unlock", "lock"]]);
    expect(input.device_use_sessions.every(row => !Object.hasOwn(row.denotes_interval!, "start_instant") && !Object.hasOwn(row.denotes_interval!, "end_instant"))).toBe(true);
    const changed = structuredClone(input); changed.device_use_sessions[0]!.denotes_interval!.duration_seconds = 123.5;
    const restored = await roundtrip(changed);
    expect(restored.device_use_sessions![0]).toEqual(changed.device_use_sessions[0]);
    expect(restored.device_use_sessions![1]).toEqual(input.device_use_sessions[1]);
    for (const field of ["start_condition", "end_condition", "denotes_interval"] as const) for (const value of [undefined, null]) {
      const partial = structuredClone(input);
      if (value === undefined) delete partial.device_use_sessions[0]![field]; else Reflect.set(partial.device_use_sessions[0]!, field, value);
      expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
    }
    const before = await loadResearchMethodSelection();
    for (const change of [
      (x: typeof input) => { x.device_use_sessions[0]!.source_work_id = "foreign"; },
      (x: typeof input) => { x.device_use_sessions[0]!.method_profile_id = "foreign"; },
      (x: typeof input) => { x.device_use_sessions[0]!.method_setting_reference = "foreign"; },
      (x: typeof input) => { x.device_use_sessions[0]!.start_condition = "on"; },
      (x: typeof input) => { x.device_use_sessions[0]!.start_condition = "ON_USERPRESENT"; },
      (x: typeof input) => { x.device_use_sessions[0]!.end_condition = "unlock"; },
      (x: typeof input) => { x.device_use_sessions[0]!.end_condition = "OFF_LOCKED"; },
      (x: typeof input) => { x.device_use_sessions.push(structuredClone(x.device_use_sessions[0]!)); },
    ]) {
      const invalid = structuredClone(input); change(invalid);
      await expect(roundtrip(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(before);
    }
  });

  it("admits only the source loneliness screen-bout tuple and exact unlock-to-off-or-lock definition", () => {
    const profile = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles.find(p => p.source_work_id === "doi:10.2196/13209")!;
    const input = lonelinessDeviceSessionExample(profile);
    const setting = (x: typeof input) => x.profiles[0]!.method_settings.find(s => s.method_parameter_key === "phone.interaction_interval")!;
    const syncMembers = (x: typeof input) => {
      for (const policy of x.profiles[0]!.session_construction_policies as Array<{ method_settings: Array<{ method_setting_id: string }> }>) {
        policy.method_settings = policy.method_settings.map(member => structuredClone(x.profiles[0]!.method_settings.find(s => s.method_setting_id === member.method_setting_id)!));
      }
    };
    const body: unknown = JSON.parse(String(setting(input).method_value_json));
    const wrapper = { definition: body, source_facing_role: "reconstruction", source_facing_target: "screen_bout" };
    const wrapped = structuredClone(input); setting(wrapped).method_value_json = JSON.stringify(wrapper); syncMembers(wrapped);
    expect(parseStudyMethodProfileLibrary(wrapped).device_use_sessions).toEqual(input.device_use_sessions);
    for (const content of [
      { ...wrapper, definition: null }, { ...wrapper, definition: {} },
      { ...wrapper, definition: "interaction is between screen status on and screen status off or lock" },
      { ...wrapper, definition: "interaction is between screen status unlock and screen status lock" },
      { ...wrapper, source_facing_role: "event_schema" }, { ...wrapper, source_facing_target: "device_session" },
    ]) {
      const invalid = structuredClone(input); setting(invalid).method_value_json = JSON.stringify(content); syncMembers(invalid);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
    }
    for (const [field, value] of [["method_setting_role", "event_schema"], ["method_target_layer", "device_session"]] as const) {
      const invalid = structuredClone(input); Reflect.set(setting(invalid), field, value); syncMembers(invalid);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
    }
  });

  it("preserves Shin screen-bounded sessions, session-local app/event members and explicit no-app membership", async () => {
    const profile = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles
      .find(p => p.source_work_id === "doi:10.1145/2493432.2493443")!;
    const input = shinDeviceSessionExample(profile);
    expect((await roundtrip(input)).device_use_sessions).toEqual(input.device_use_sessions);
    expect(input.device_use_sessions.map(row => row.session_actions!.filter(action => action.app_identifier).map(action => action.app_identifier)))
      .toEqual([["app-A", "app-B"], ["app-A"], []]);
    const moved = structuredClone(input);
    moved.device_use_sessions[1]!.session_actions!.push(moved.device_use_sessions[0]!.session_actions!.pop()!);
    expect((await roundtrip(moved)).device_use_sessions).toEqual(moved.device_use_sessions);
    for (const membership of [undefined, null, []]) {
      const partial = structuredClone(input);
      if (membership === undefined) Reflect.deleteProperty(partial.device_use_sessions[2]!, "session_actions");
      else partial.device_use_sessions[2]!.session_actions = membership;
      expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
    }
    const prior = await loadResearchMethodSelection();
    const mutations: Array<(x: typeof input) => void> = [
      x => { x.device_use_sessions[0]!.source_work_id = "foreign"; },
      x => { x.device_use_sessions[0]!.method_profile_id = "foreign"; },
      x => { x.device_use_sessions[0]!.method_setting_reference = "foreign"; },
      x => { x.device_use_sessions[0]!.start_condition = "unlock"; },
      x => { x.device_use_sessions[0]!.end_condition = "lock"; },
      x => { x.device_use_sessions.push(structuredClone(x.device_use_sessions[0]!)); },
      x => { x.device_use_sessions[0]!.session_actions!.push(structuredClone(x.device_use_sessions[0]!.session_actions![0]!)); },
    ];
    for (const mutate of mutations) {
      const invalid = structuredClone(input); mutate(invalid);
      await expect(roundtrip(invalid)).rejects.toThrow();
      expect(await loadResearchMethodSelection()).toBe(prior);
    }
  });

  it("requires the complete Shin policy with exact local roles, tuples and screen semantics", () => {
    const profile = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles
      .find(p => p.source_work_id === "doi:10.1145/2493432.2493443")!;
    const input = shinDeviceSessionExample(profile);
    const policies = (value: typeof input) => value.profiles[0]!.session_construction_policies as Array<{
      session_input_layer: string; session_output_layer: string; method_settings: Array<{ method_setting_id: string }>;
    }>;
    const syncMembers = (value: typeof input) => {
      for (const policy of policies(value)) policy.method_settings = policy.method_settings.map(member =>
        structuredClone(value.profiles[0]!.method_settings.find(s => s.method_setting_id === member.method_setting_id)!));
    };
    const mutations: Array<(x: typeof input) => void> = [
      x => { policies(x)[0]!.session_input_layer = "acquired_snapshot"; },
      x => { policies(x)[0]!.session_output_layer = "app_session"; },
      x => { policies(x).push(structuredClone(policies(x)[0]!)); },
      x => { policies(x)[0]!.method_settings.pop(); },
      x => { policies(x)[0]!.method_settings[3] = policies(x)[0]!.method_settings[0]!; },
      x => { policies(x)[0]!.method_settings[3] = { method_setting_id: "foreign" }; },
    ];
    for (const mutate of mutations) { const invalid = structuredClone(input); mutate(invalid); expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(); }
    for (const [key, field, wrong] of [
      ["session.opener", "trigger", "unlock"], ["session.opener", "lock_required", true],
      ["session.closer", "trigger", "lock"], ["session.closer", "app_episode_closure_claim", true],
      ["session.interval_definition", "entity", "app session"], ["session.no_app_membership", "app_execution_not_required", false],
    ] as const) {
      const original = JSON.parse(String(profile.method_settings.find(s => s.method_parameter_key === key)!.method_value_json)) as { definition: Record<string, unknown>; source_facing_role: string; source_facing_target: string };
      for (const wrapped of [false, true]) {
        const valid = structuredClone(input);
        valid.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!.method_value_json = JSON.stringify(wrapped ? original : original.definition);
        syncMembers(valid);
        expect(parseStudyMethodProfileLibrary(valid).device_use_sessions).toEqual(input.device_use_sessions);
        for (const change of ["body", "role", "target"] as const) {
          const invalid = structuredClone(valid);
          const body = structuredClone(original.definition); if (change === "body") body[field] = wrong;
          invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!.method_value_json = JSON.stringify(wrapped
            ? { ...original, definition: body, ...(change === "role" ? { source_facing_role: "analysis" } : change === "target" ? { source_facing_target: "app_session" } : {}) }
            : { ...body, ...(change === "role" ? { source_facing_role: "analysis" } : change === "target" ? { source_facing_target: "app_session" } : {}) });
          syncMembers(invalid);
          expect(() => parseStudyMethodProfileLibrary(invalid), `${key}: ${change}, wrapped ${wrapped}`).toThrow();
        }
      }
      for (const field of ["method_setting_role", "method_target_layer"]) {
        const invalid = structuredClone(input);
        Reflect.set(invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!, field, field === "method_setting_role" ? "analysis" : "app_session");
        syncMembers(invalid);
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
      }
    }
  });

  it("preserves academic multi-app groups and independent duration-band labels without lock boundaries or reclassification", async () => {
    const profile = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles
      .find(p => p.source_work_id === "doi:10.1145/3429360.3468192")!;
    const input = academicDeviceSessionExample(profile);
    expect(await roundtrip(input)).toMatchObject(input);
    const moved = structuredClone(input);
    moved.device_use_sessions[1]!.session_actions!.push(moved.device_use_sessions[0]!.session_actions!.pop()!);
    moved.device_use_sessions[0]!.session_labels![0]!.label_value_json = "false";
    expect((await roundtrip(moved)).device_use_sessions).toEqual(moved.device_use_sessions);
    expect(moved.device_use_sessions[0]!.session_labels!.slice(1)).toEqual(input.device_use_sessions[0]!.session_labels!.slice(1));
    for (const field of ["start_condition", "end_condition", "session_labels", "session_actions"] as const) {
      for (const value of field.startsWith("session_") ? [undefined, null, []] : [undefined, null]) {
        const partial = structuredClone(input);
        if (value === undefined) Reflect.deleteProperty(partial.device_use_sessions[0]!, field);
        else Reflect.set(partial.device_use_sessions[0]!, field, value);
        expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
      }
    }
    for (const value of [undefined, null, "null", "0.00", '"unknown"']) {
      const partial = structuredClone(input);
      if (value === undefined) Reflect.deleteProperty(partial.device_use_sessions[0]!.session_labels![0]!, "label_value_json");
      else partial.device_use_sessions[0]!.session_labels![0]!.label_value_json = value;
      expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
    }
    const prior = await loadResearchMethodSelection();
    const mutations: Array<(x: typeof input) => void> = [
      x => { x.device_use_sessions[0]!.source_work_id = "foreign"; },
      x => { x.device_use_sessions[0]!.method_profile_id = "foreign"; },
      x => { x.device_use_sessions[0]!.method_setting_reference = "foreign"; },
      x => { x.device_use_sessions[0]!.session_labels![0]!.label_setting_reference = "foreign"; },
      x => { x.device_use_sessions[0]!.start_condition = "unlock"; },
      x => { x.device_use_sessions[0]!.end_condition = "lock"; },
      x => { x.device_use_sessions.push(structuredClone(x.device_use_sessions[0]!)); },
      x => { x.device_use_sessions[0]!.session_actions!.push(structuredClone(x.device_use_sessions[0]!.session_actions![0]!)); },
      x => { x.device_use_sessions[0]!.session_labels!.push(structuredClone(x.device_use_sessions[0]!.session_labels![0]!)); },
    ];
    for (const mutate of mutations) {
      const invalid = structuredClone(input); mutate(invalid);
      await expect(roundtrip(invalid)).rejects.toThrow();
      expect(await loadResearchMethodSelection()).toBe(prior);
    }
  });

  it("requires exact academic gap and band definitions with matching flat or wrapped tuples", () => {
    const profile = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles
      .find(p => p.source_work_id === "doi:10.1145/3429360.3468192")!;
    const input = academicDeviceSessionExample(profile);
    for (const [key, body, role, target] of [
      ["sessions.gap", "Start a new session when break between consecutive use of two apps is >45 seconds", "reconstruction", "app_session"],
      ["sessions.micro", "duration <=15 seconds", "feature_engineering", "derived_feature"],
      ["sessions.review", "16-60 seconds", "feature_engineering", "derived_feature"],
      ["sessions.engage", "duration >60 seconds", "feature_engineering", "derived_feature"],
    ]) {
      for (const wrapped of [false, true]) {
        const valid = structuredClone(input);
        const setting = valid.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
        expect(JSON.parse(String(setting.method_value_json))).toBe(body);
        setting.method_value_json = JSON.stringify(wrapped ? { definition: body, source_facing_role: role, source_facing_target: target } : body);
        expect(parseStudyMethodProfileLibrary(valid).device_use_sessions).toEqual(input.device_use_sessions);
      }
      for (const inner of [null, {}, 0, "duration >60 seconds", "Start a new session when break between consecutive use of two apps is >=45 seconds"].filter(x => x !== body)) {
        const invalid = structuredClone(input);
        invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!.method_value_json = JSON.stringify({ definition: inner, source_facing_role: role, source_facing_target: target });
        expect(() => parseStudyMethodProfileLibrary(invalid), `${key}: ${JSON.stringify(inner)}`).toThrow();
      }
      for (const field of ["method_setting_role", "method_target_layer"]) {
        const invalid = structuredClone(input);
        Reflect.set(invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!, field, field === "method_setting_role" ? "analysis" : "device_session");
        expect(() => parseStudyMethodProfileLibrary(invalid), `${key}: ${field}`).toThrow();
      }
      for (const field of ["source_facing_role", "source_facing_target"]) for (const value of [undefined, null, "wrong"]) {
        const invalid = structuredClone(input);
        const wrapped: Record<string, unknown> = { definition: body, source_facing_role: role, source_facing_target: target };
        if (value === undefined) Reflect.deleteProperty(wrapped, field); else wrapped[field] = value;
        invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!.method_value_json = JSON.stringify(wrapped);
        expect(() => parseStudyMethodProfileLibrary(invalid), `${key}: ${field}`).toThrow();
      }
    }
  });

  it("preserves session quantities and whole-session strategies without deriving or relabeling values", async () => {
    const profiles = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles;
    for (const work of ["doi:10.1145/2750858.2807542", "doi:10.1145/3604241"]) {
      const input = sessionQuantityExample(profiles.find(p => p.source_work_id === work)!);
      expect((await roundtrip(input)).device_use_sessions).toEqual(input.device_use_sessions);
      const moved = structuredClone(input);
      moved.device_use_sessions[1]!.session_quantities![0] = moved.device_use_sessions[0]!.session_quantities!.shift()!;
      moved.device_use_sessions[0]!.session_actions?.reverse();
      const restored = await roundtrip(moved);
      expect(restored.device_use_sessions).toEqual(moved.device_use_sessions);
      expect(restored.device_use_sessions![0]!.session_labels).toEqual(input.device_use_sessions[0]!.session_labels);
      for (const member of [undefined, null, []]) {
        const partial = structuredClone(input);
        if (member === undefined) Reflect.deleteProperty(partial.device_use_sessions[0]!, "session_quantities");
        else partial.device_use_sessions[0]!.session_quantities = member;
        expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
      }
      for (const value of [undefined, null, "null", "0.00", '"NA"']) {
        const partial = structuredClone(input);
        if (value === undefined) Reflect.deleteProperty(partial.device_use_sessions[0]!.session_quantities![0]!, "evidence_value_json");
        else partial.device_use_sessions[0]!.session_quantities![0]!.evidence_value_json = value;
        expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
      }
      const badFields: Array<[string, unknown]> = [
        ["quantity_record_id", ""], ["quantity_setting_reference", "foreign"], ["observed_property", "foreign"],
        ["quantity_scope", ["session"]], ["quantity_scope", "unknown"], ["source_locators", []],
        ["evidence_value_json", "invalid JSON"], ["evidence_unit", 3], ["quantity_qualifier", false],
        ["invented_raw_join", true], ["observation_category", "foreign-category"],
      ];
      for (const [key, value] of badFields) {
        const invalid = structuredClone(input);
        Reflect.set(invalid.device_use_sessions[0]!.session_quantities![0]!, key, value);
        expect(() => parseStudyMethodProfileLibrary(invalid), key).toThrow();
      }
      const foreignSetting = structuredClone(input);
      foreignSetting.device_use_sessions[0]!.session_quantities![0]!.quantity_setting_reference = "foreign";
      expect(() => parseStudyMethodProfileLibrary(foreignSetting)).toThrow(
        "method_profile_library.device_use_sessions[0].session_quantities[0].quantity_setting_reference has no method setting within its profile");
      const duplicated = structuredClone(input);
      duplicated.device_use_sessions[0]!.session_quantities!.push(structuredClone(duplicated.device_use_sessions[0]!.session_quantities![0]!));
      expect(() => parseStudyMethodProfileLibrary(duplicated)).toThrow("duplicated within session");
      const wrongBody = structuredClone(input);
      wrongBody.profiles[0]!.method_settings.find(s => s.method_setting_id === wrongBody.device_use_sessions[0]!.session_quantities![0]!.quantity_setting_reference)!.method_value_json = '{"features":["unrelated"]}';
      expect(() => parseStudyMethodProfileLibrary(wrongBody)).toThrow("compatible session-quantity");
      for (const inner of [null, "not an object", 0]) {
        const invalid = structuredClone(input);
        const setting = invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === invalid.device_use_sessions[0]!.session_quantities![0]!.quantity_setting_reference)!;
        const original = JSON.parse(setting.method_value_json as string) as Record<string, unknown>;
        const body = (original.definition ?? original) as Record<string, unknown>;
        setting.method_value_json = JSON.stringify({ ...body, definition: inner, source_facing_role: "feature_engineering", source_facing_target: "derived_feature" });
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("compatible session-quantity");
      }
      for (const field of ["source_facing_role", "source_facing_target"]) for (const value of [undefined, null, "wrong"]) {
        const invalid = structuredClone(input);
        const setting = invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === invalid.device_use_sessions[0]!.session_quantities![0]!.quantity_setting_reference)!;
        const original = JSON.parse(setting.method_value_json as string) as Record<string, unknown>;
        const wrapped: Record<string, unknown> = { definition: original.definition ?? original, source_facing_role: "feature_engineering", source_facing_target: "derived_feature" };
        if (value === undefined) Reflect.deleteProperty(wrapped, field); else wrapped[field] = value;
        setting.method_value_json = JSON.stringify(wrapped);
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("source-facing definition disagrees");
      }
      if (work.endsWith("3604241")) {
        for (const property of ["app_identifier", "observation_category"] as const) for (const absent of [undefined, null]) {
          const partial = structuredClone(input);
          const quantity = partial.device_use_sessions[0]!.session_quantities!.find(q => q[property] != null)!;
          if (absent === undefined) Reflect.deleteProperty(quantity, property); else quantity[property] = absent;
          expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
        }
        expect(input.device_use_sessions[0]!.session_quantities!.find(q => q.quantity_record_id === "normalized-category")!.evidence_value_json).toBe("2.00");
        const wrongTuple = structuredClone(input);
        const setting = wrongTuple.profiles[0]!.method_settings.find(s => s.method_parameter_key === "features.apps_and_categories")!;
        const body = JSON.parse(setting.method_value_json as string) as Record<string, unknown>;
        body.source_facing_target = "participant_day"; setting.method_value_json = JSON.stringify(body);
        expect(() => parseStudyMethodProfileLibrary(wrongTuple)).toThrow("source-facing definition disagrees");
      } else {
        for (const inner of [null, "not an object", 0]) {
          const invalid = structuredClone(input);
          const setting = invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === "analysis.regex_classes")!;
          const original = JSON.parse(setting.method_value_json as string) as Record<string, unknown>;
          setting.method_value_json = JSON.stringify({ ...original, definition: inner, source_facing_role: "analysis", source_facing_target: "derived_feature" });
          expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("session-label definition");
        }
        for (const strategy of ["Initiate", "Initiate-Revisit", "Initiate-Revisit-Conclude", "Other"]) {
          const variant = structuredClone(input);
          variant.device_use_sessions[0]!.session_labels![0]!.label_value_json = JSON.stringify(strategy);
          const saved = await roundtrip(variant);
          expect(saved.device_use_sessions).toEqual(variant.device_use_sessions);
          expect(saved.device_use_sessions![0]!.session_actions).toEqual(input.device_use_sessions[0]!.session_actions);
        }
        for (const field of ["source_facing_role", "source_facing_target"]) for (const value of [undefined, null, "wrong"]) {
          const invalid = structuredClone(input);
          const setting = invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === "analysis.regex_classes")!;
          const wrapped: Record<string, unknown> = { definition: JSON.parse(setting.method_value_json as string) as unknown, source_facing_role: "analysis", source_facing_target: "derived_feature" };
          if (value === undefined) Reflect.deleteProperty(wrapped, field); else wrapped[field] = value;
          setting.method_value_json = JSON.stringify(wrapped);
          expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("source-facing definition disagrees");
        }
        for (const body of [{ patterns: [] }, { patterns: [{ expression: "^[F]+$", strategy: "" }], unmatched: "Other", matching: "anchored complete string" }]) {
          const invalid = structuredClone(input);
          invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === "analysis.regex_classes")!.method_value_json = JSON.stringify(body);
          expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("session-label definition");
        }
      }
    }
  });
  it("preserves session actions and successors in generated JSON Schema and Pydantic", () => {
    const profiles = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles;
    const rows = [
      ...appPeriodWorks.flatMap(work => appPeriodDeviceSessionExample(profiles.find(p => p.source_work_id === work)!).device_use_sessions),
      ...apnomsExample().device_use_sessions,
      ...dailyValidityExample().device_use_sessions,
      ...hammerDeviceSessionExample(profiles.find(p => p.source_work_id === "doi:10.1145/2634317.2634325")!).device_use_sessions,
      ...mommDeviceSessionExample(profiles.find(p => p.source_work_id === "doi:10.1145/2684103.2684156")!).device_use_sessions,
      ...vanBerkelDeviceSessionExample(profiles.find(p => p.source_work_id === "doi:10.1145/2858036.2858348")!).device_use_sessions,
      ...recordedBehaviorDeviceSessionExample(profiles.find(p => p.source_work_id === "doi:10.3390/bs5040434")!).device_use_sessions,
      ...appMeasuresDeviceSessionExample(profiles.find(p => p.source_work_id === "doi:10.4088/jcp.15m10310")!).device_use_sessions,
      ...falakiExample().device_use_sessions,
      ...cognitiveDeviceSessionExample(profiles.find(p => p.source_work_id === "doi:10.1145/2971648.2971712")!).device_use_sessions,
      ...whatsappDeviceSessionExample(profiles.find(p => p.source_work_id === "doi:10.1186/s13104-015-1280-z")!).device_use_sessions,
      ...shinDeviceSessionExample(profiles.find(p => p.source_work_id === "doi:10.1145/2493432.2493443")!).device_use_sessions,
      ...lonelinessDeviceSessionExample(profiles.find(p => p.source_work_id === "doi:10.2196/13209")!).device_use_sessions,
      ...academicDeviceSessionExample(profiles.find(p => p.source_work_id === "doi:10.1145/3429360.3468192")!).device_use_sessions,
      ...separateDeviceSessionExample(profiles.find(p => p.source_work_id === "doi:10.1007/s00779-011-0412-2")!).device_use_sessions,
      ...hushDeviceSessionExample(profiles.find(p => p.source_work_id === "doi:10.1145/2789168.2790107")!).device_use_sessions,
      ...jonesDeviceSessionExample(profiles.find(p => p.source_work_id === "doi:10.1145/2750858.2807542")!).device_use_sessions,
      ...sessionQuantityExample(profiles.find(p => p.source_work_id === "doi:10.1145/2750858.2807542")!).device_use_sessions,
      ...sessionQuantityExample(profiles.find(p => p.source_work_id === "doi:10.1145/3604241")!).device_use_sessions,
    ];
    const result = execFileSync("uvx", ["--from", "linkml==1.10.0", "--with", "jsonschema", "python", "-c", [
      "import json,sys", "from jsonschema import Draft202012Validator", "sys.path.insert(0,sys.argv[2])",
      "from chronicle_research_ontology import DeviceUseSessionRecord", "schema=json.load(open(sys.argv[1]))",
      "validator=Draft202012Validator({'$ref':'#/$defs/DeviceUseSessionRecord','$defs':schema['$defs']})",
      "for row in json.load(sys.stdin):", " validator.validate(row)",
      " assert DeviceUseSessionRecord(**row).model_dump(exclude_unset=True)==row",
      " assert not validator.is_valid(dict(row,invented_field=True))",
      " for quantity in row.get('session_quantities') or []:",
      "  for key,value in [('quantity_record_id',None),('quantity_setting_reference',None),('quantity_scope','foreign'),('support_task_action_references',[1]),('questionnaire_response_references','foreign'),('invented_field',True)]:",
      "   assert not validator.is_valid(dict(row,session_quantities=[dict(quantity,**{key:value})]))",
      "print('session-projections-preserve-records')",
    ].join("\n"), resolve(import.meta.dirname, "../../schema/generated/json-schema/chronicle-research-ontology.schema.json"),
    resolve(import.meta.dirname, "../../schema/generated/pydantic")], { input: JSON.stringify(rows), encoding: "utf8", timeout: 180_000 });
    expect(result.trim()).toBe("session-projections-preserve-records");
  });

  it("preserves Jones scalar lock boundary, repeated launches and supplied session-local F/B labels", async () => {
    const profile = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles
      .find(p => p.source_work_id === "doi:10.1145/2750858.2807542")!;
    const input = jonesDeviceSessionExample(profile);
    const restored = await roundtrip(input);
    expect(restored.profiles[0]).toEqual(profile);
    expect(restored.device_use_sessions).toEqual(input.device_use_sessions);
    expect(restored.device_use_sessions!.map(row => row.session_actions!.map(action => action.assigned_role_labels![0]).join(""))).toEqual(["FFFBB", "F"]);
    expect(restored.device_use_sessions![0]!.session_actions!.map(action => action.app_identifier)).toEqual(["Email", "Chrome", "Facebook", "Chrome", "Facebook"]);
    const moved = structuredClone(input);
    moved.device_use_sessions[1]!.session_actions!.push(moved.device_use_sessions[0]!.session_actions!.pop()!);
    expect((await roundtrip(moved)).device_use_sessions).toEqual(moved.device_use_sessions); // No hidden encoder changes supplied labels.
    for (const boundary of [undefined, null]) {
      const partial = structuredClone(input);
      if (boundary === undefined) Reflect.deleteProperty(partial.device_use_sessions[0]!, "end_condition");
      else partial.device_use_sessions[0]!.end_condition = boundary;
      expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
    }
    for (const definition of [
      { start: "unlock", end: " " }, { start: "unlock", end: 1 }, { start: "unlock", end: null },
      { start: "unlock", end: "lock", end_any: ["screen-off"] }, { start: "unlock", end_any: [] },
      { start: "unlock" }, { start: "", end: "lock" }, { start: null, end: "lock" },
    ]) {
      const invalid = structuredClone(input);
      invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === "session.unlock_lock")!.method_value_json = JSON.stringify(definition);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("compatible device-session constructor definition");
    }
    for (const mutate of [
      (value: typeof input) => { value.device_use_sessions[0]!.end_condition = "screen-off"; },
      (value: typeof input) => { value.device_use_sessions[0]!.source_work_id = "foreign"; },
      (value: typeof input) => { value.device_use_sessions[0]!.session_actions!.push(structuredClone(value.device_use_sessions[0]!.session_actions![0]!)); },
    ]) { const invalid = structuredClone(input); mutate(invalid); expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(); }
  });

  it("preserves session-owned actions, order and supplied immediate successors without inferred app or time joins", async () => {
    const profiles = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles;
    const g1 = separateDeviceSessionExample(profiles.find(p => p.source_work_id === "doi:10.1007/s00779-011-0412-2")!);
    expect((await roundtrip(g1)).device_use_sessions).toEqual(g1.device_use_sessions);
    const swapped = structuredClone(g1);
    const moved = swapped.device_use_sessions[0]!.session_actions.splice(1, 1)[0]!;
    swapped.device_use_sessions[1]!.session_actions.push(moved);
    swapped.device_use_sessions[0]!.session_actions.reverse();
    expect((await roundtrip(swapped)).device_use_sessions).toEqual(swapped.device_use_sessions);
    expect(swapped.device_use_sessions).not.toEqual(g1.device_use_sessions);
    for (const membership of [undefined, null, []]) {
      const partial = structuredClone(g1);
      if (membership === undefined) Reflect.deleteProperty(partial.device_use_sessions[0]!, "session_actions"); else Reflect.set(partial.device_use_sessions[0]!, "session_actions", membership);
      expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
    }
    const hush = hushDeviceSessionExample(profiles.find(p => p.source_work_id === "doi:10.1145/2789168.2790107")!);
    expect((await roundtrip(hush)).device_use_sessions).toEqual(hush.device_use_sessions);
    const relinked = structuredClone(hush);
    relinked.device_use_sessions[0]!.following_device_use_session_reference = "on-s2";
    expect((await roundtrip(relinked)).device_use_sessions).toEqual(relinked.device_use_sessions);
    expect(relinked.device_use_sessions[0]!.session_actions).toEqual(hush.device_use_sessions[0]!.session_actions);
    for (const reference of [undefined, null]) {
      const partial = structuredClone(hush);
      if (reference === undefined) Reflect.deleteProperty(partial.device_use_sessions[0]!, "following_device_use_session_reference"); else partial.device_use_sessions[0]!.following_device_use_session_reference = reference;
      expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
    }
    const mutations: Array<(x: typeof hush) => void> = [
      x => { x.device_use_sessions[0]!.following_device_use_session_reference = "off-b1"; },
      x => { x.device_use_sessions[0]!.following_device_use_session_reference = "foreign"; },
      x => { x.device_use_sessions[1]!.participant_id = "other"; },
      x => { x.device_use_sessions[1]!.device_id = null; },
      x => { x.device_use_sessions[1]!.start_condition = "screen-off"; x.device_use_sessions[1]!.end_condition = "screen-on"; },
      x => { x.device_use_sessions[1]!.following_device_use_session_reference = "off-b1"; },
      x => { x.device_use_sessions[0]!.end_condition = "screen-off"; },
      x => { x.device_use_sessions[0]!.session_actions!.push(structuredClone(x.device_use_sessions[0]!.session_actions![0]!)); },
      x => { Reflect.set(x.device_use_sessions[0]!.session_actions![0]!, "app_identifier", 5); },
      x => { Reflect.set(x.device_use_sessions[0]!.session_actions![0]!, "invented_join", true); },
      x => { x.profiles[0]!.method_settings.find(s => s.method_setting_id === x.device_use_sessions[0]!.method_setting_reference)!.method_value_json = '"partition into intervals"'; },
    ];
    for (const mutate of mutations) { const bad = structuredClone(hush); mutate(bad); expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(); }
  });

  it("uses the existing separate opener/closer/membership policy without manufacturing a combined source rule", async () => {
    const profile = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(libraryPath, "utf8"))).profiles
      .find(p => p.source_work_id === "doi:10.1007/s00779-011-0412-2")!;
    expect(profile).toBeDefined();
    const input = separateDeviceSessionExample(profile);
    expect((await roundtrip(input)).device_use_sessions).toEqual(input.device_use_sessions);
    const wrongEnd = structuredClone(input); wrongEnd.device_use_sessions[0]!.end_condition = "OFF_LOCKED";
    expect(() => parseStudyMethodProfileLibrary(wrongEnd)).toThrow();
    const wrongReference = structuredClone(input); wrongReference.device_use_sessions[0]!.method_setting_reference = "method-setting-46f28d61d7c4baceca627aae";
    expect(() => parseStudyMethodProfileLibrary(wrongReference)).toThrow();
    for (const mutation of ["missing-member", "ambiguous-policy", "wrong-source-target", "combined-roles"]) {
      const invalid = structuredClone(input);
      const policies = invalid.profiles[0]!.session_construction_policies as Array<{session_construction_policy_id: string; method_settings: Array<{method_setting_id: string; method_value_json: string}>}>;
      const policy = policies.find(p => p.method_settings.some(s => s.method_setting_id === input.device_use_sessions[0]!.method_setting_reference))!;
      if (mutation === "missing-member") policy.method_settings = policy.method_settings.filter(s => s.method_setting_id !== "method-setting-1799b2f72059de39381422ed");
      else if (mutation === "ambiguous-policy") policies.push({ ...structuredClone(policy), session_construction_policy_id: "ambiguous-duplicate" });
      else if (mutation === "combined-roles") {
        const combined = Object.assign({}, ...policy.method_settings.map(s => (JSON.parse(s.method_value_json) as {definition: Record<string, unknown>}).definition)) as Record<string, unknown>;
        for (const [i, s] of policy.method_settings.entries()) {
          const value = JSON.parse(s.method_value_json) as {definition: Record<string, unknown>}; value.definition = i === 0 ? combined : {}; s.method_value_json = JSON.stringify(value);
          invalid.profiles[0]!.method_settings.find(x => x.method_setting_id === s.method_setting_id)!.method_value_json = s.method_value_json;
        }
      }
      else { const s = policy.method_settings[0]!; const v = JSON.parse(s.method_value_json) as {source_facing_target: string}; v.source_facing_target = "device_session"; s.method_value_json = JSON.stringify(v); invalid.profiles[0]!.method_settings.find(x => x.method_setting_id === s.method_setting_id)!.method_value_json = s.method_value_json; }
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
    }
  });

  it("round-trips the relationship without computing sessions, scheduling answers or deriving labels", async () => {
    const input = example();
    for (const terminal of ["OFF_LOCKED", "OFF_UNLOCKED", "SHUTDOWN"]) {
      input.device_use_sessions[0]!.end_condition = terminal;
      const restored = await roundtrip(input);
      expect(restored.device_use_sessions).toEqual(input.device_use_sessions);
      expect(restored.device_use_sessions![0]!.session_questionnaire_responses).toHaveLength(2);
      expect(restored.device_use_sessions![0]!.session_labels![0]!.questionnaire_response_references).toEqual(["answer-two"]);
    }
    for (const value of [undefined, null, "null", '""', '"No"', "false"]) {
      Reflect.set(input.device_use_sessions[0]!.session_questionnaire_responses[0]!, "response_value_json", value);
      if (value === undefined) Reflect.deleteProperty(input.device_use_sessions[0]!.session_questionnaire_responses[0]!, "response_value_json");
      expect((await roundtrip(input)).device_use_sessions).toEqual(input.device_use_sessions);
    }
    for (const field of ["denotes_interval", "session_questionnaire_responses", "session_labels", "start_condition", "end_condition"]) {
      const partial = structuredClone(input);
      if (field === "session_questionnaire_responses") partial.device_use_sessions[0]!.session_labels[0]!.questionnaire_response_references = [];
      Reflect.set(partial.device_use_sessions[0]!, field, null);
      expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
      Reflect.deleteProperty(partial.device_use_sessions[0]!, field);
      expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
    }
    for (const field of ["label_value_json", "questionnaire_response_references"]) for (const supplied of [false, true]) {
      const partial = structuredClone(input);
      if (supplied) Reflect.set(partial.device_use_sessions[0]!.session_labels[0]!, field, null);
      else Reflect.deleteProperty(partial.device_use_sessions[0]!.session_labels[0]!, field);
      expect((await roundtrip(partial)).device_use_sessions).toEqual(partial.device_use_sessions);
    }
    expect((await roundtrip({ profiles: input.profiles })).device_use_sessions).toBeUndefined();
    expect((await roundtrip({ profiles: input.profiles, device_use_sessions: [] })).device_use_sessions).toEqual([]);
  });

  it("preserves repeated local IDs across sessions, all disclosed instruments and independent classifications", async () => {
    const input = example(), first = input.device_use_sessions[0]!;
    const labelOnly = structuredClone(input);
    labelOnly.device_use_sessions[0]!.session_labels[1]!.label_value_json = '"rabbit hole"';
    const restoredLabelOnly = (await roundtrip(labelOnly)).device_use_sessions![0]!;
    expect(restoredLabelOnly.session_questionnaire_responses).toEqual(first.session_questionnaire_responses);
    expect(restoredLabelOnly.session_labels![0]).toEqual(first.session_labels[0]);
    expect(restoredLabelOnly.session_labels![1]!.label_value_json).toBe('"rabbit hole"');
    const second = structuredClone(first);
    second.device_use_session_id = "second-session";
    second.session_labels[1]!.label_value_json = '"rabbit hole"';
    const definition = (key: string) => input.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
    for (const [key, property] of [["diary.unlock_instrument", "intention"], ["diary.lock_long_instrument", "sense of agency"]]) {
      const setting = definition(key!);
      second.session_questionnaire_responses.push({ ...structuredClone(first.session_questionnaire_responses[0]!),
        questionnaire_response_id: key!, questionnaire_setting_reference: setting.method_setting_id,
        observed_property: property!, source_locators: setting.source_locators as string[] });
    }
    const regret = definition("labels.original_regret");
    second.session_labels.push({ ...structuredClone(first.session_labels[1]!), label_record_id: "regret",
      label_setting_reference: regret.method_setting_id, observed_property: "original regret classification",
      label_value_json: null, source_locators: regret.source_locators as string[] });
    input.device_use_sessions.push(second);
    expect((await roundtrip(input)).device_use_sessions).toEqual(input.device_use_sessions);
    const foreign = structuredClone(input);
    foreign.device_use_sessions[0]!.session_labels[0]!.questionnaire_response_references = ["diary.unlock_instrument"];
    expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow("within the owning session");
    // Changing local definition content must reject even when role/target still agree.
    for (const [key, message] of [["labels.original", "compatible session-label definition"], ["session.constructor", "compatible device-session constructor definition"]]) {
      const invalid = structuredClone(input), setting = invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
      const value = JSON.parse(setting.method_value_json as string) as Record<string, unknown>;
      value.definition = { reported_count: 1738 };
      setting.method_value_json = JSON.stringify(value);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(message);
    }
    const mismatch = structuredClone(input), setting = mismatch.profiles[0]!.method_settings.find(s => s.method_parameter_key === "diary.lock_short_instrument")!;
    const value = JSON.parse(setting.method_value_json as string) as Record<string, unknown>;
    value.source_facing_target = "participant_measure";
    setting.method_value_json = JSON.stringify(value);
    expect(() => parseStudyMethodProfileLibrary(mismatch)).toThrow("source-facing definition disagrees");
  });

  it("rejects foreign membership, incompatible same-role definitions and malformed normalized data", () => {
    const input = example();
    const setting = (key: string) => input.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!.method_setting_id;
    const mutations: Array<(x: typeof input) => void> = [
      x => { x.device_use_sessions[0]!.source_work_id = "foreign-source"; },
      x => { x.device_use_sessions[0]!.method_profile_id = "foreign-profile"; },
      x => { x.device_use_sessions[0]!.participant_id = " "; },
      x => { x.device_use_sessions.push(structuredClone(x.device_use_sessions[0]!)); },
      x => { x.device_use_sessions[0]!.session_questionnaire_responses.push(structuredClone(x.device_use_sessions[0]!.session_questionnaire_responses[0]!)); },
      x => { x.device_use_sessions[0]!.session_labels.push(structuredClone(x.device_use_sessions[0]!.session_labels[0]!)); },
      x => { x.device_use_sessions[0]!.session_labels[0]!.questionnaire_response_references = ["foreign-session-answer"]; },
      x => { x.device_use_sessions[0]!.session_labels[0]!.questionnaire_response_references = ["answer-one", "answer-one"]; },
      x => { Reflect.set(x.device_use_sessions[0]!, "session_questionnaire_responses", null); },
      x => { x.device_use_sessions[0]!.session_questionnaire_responses[0]!.questionnaire_setting_reference = setting("diary.no_intention_conditional"); },
      x => { x.device_use_sessions[0]!.session_labels[0]!.label_setting_reference = setting("session.constructor"); },
      x => { x.device_use_sessions[0]!.end_condition = "invented-terminal"; },
      x => { x.device_use_sessions[0]!.session_questionnaire_responses[0]!.response_value_json = "invalid JSON"; },
      x => Reflect.set(x.device_use_sessions[0]!, "recovered_raw_join", true),
    ];
    for (const mutate of mutations) {
      const invalid = structuredClone(input); mutate(invalid);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
    }
  });
});
