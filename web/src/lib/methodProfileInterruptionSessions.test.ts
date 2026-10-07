import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { privateCorpusPath } from "@/testSupport/privateCorpus";
import { loadResearchMethodSelection, saveResearchMethodSelection } from "@/lib/lastRunStore";
import { compileNativeMethodProfile, parseStudyMethodProfileLibrary, type StudyMethodProfile } from "@/lib/methodProfiles";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { appInterruptionSessionExample, appInterruptionQuestionnaireExample } from "../../e2e/fixtures/app-interruption-session";

describe("source-backed containing app session and individual interruptions", () => {
  it("imports and persists literal published intervals and labels without reconstructing the timeline", async () => {
    const input = appInterruptionSessionExample();
    expect(parseStudyMethodProfileLibrary({ profiles: input.profiles }).profiles).toHaveLength(1);
    const library = parseStudyMethodProfileLibrary(input);
    await saveResearchMethodSelection(JSON.stringify({ profile: library.profiles[0], app_interruption_sessions: library.app_interruption_sessions }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], app_interruption_sessions: saved.app_interruption_sessions });
    expect(restored.app_interruption_sessions).toEqual(input.app_interruption_sessions);
    const session = restored.app_interruption_sessions![0]!;
    expect(session.denotes_interval).toEqual({ start_instant: "05:48:56", end_instant: "05:50:43" });
    expect(session.interruptions![0]!.denotes_interval).toEqual({ start_instant: "05:49:03", end_instant: "05:50:43" });
    expect(session.interruptions![0]!.visited_app_labels).toEqual(["Google", "Google Play Store", "Google", "Activity Recognition"]);
    for (const field of ["app_name", "app_package_name", "device_id", "resumed_learning", "questionnaire_responses"]) expect(session).not.toHaveProperty(field);
    expect(session.interruptions![0]).not.toHaveProperty("cause");
    expect(session.interruptions![0]!.denotes_interval).not.toHaveProperty("duration_seconds");
    expect(compileNativeMethodProfile(restored.profiles[0]!, DEFAULT_BROWSER_OPTIONS).ok).toBe(false);
  });

  it("retains separately identified equal-time interruptions, source order and unknown/empty membership", async () => {
    const input = appInterruptionSessionExample();
    const second = structuredClone(input.app_interruption_sessions[0]!.interruptions[0]!);
    second.interruption_record_id = "second-at-same-times";
    input.app_interruption_sessions[0]!.interruptions.unshift(second);
    const library = parseStudyMethodProfileLibrary(input);
    expect(library.app_interruption_sessions).toEqual(input.app_interruption_sessions);
    expect(library.app_interruption_sessions![0]!.interruptions).toHaveLength(2);
    const firstOnly = structuredClone(library);
    firstOnly.app_interruption_sessions![0]!.interruptions!.splice(0, 1);
    expect(firstOnly.app_interruption_sessions).not.toEqual(library.app_interruption_sessions);
    const session = library.app_interruption_sessions![0]!;
    const roundtrip = async () => {
      const parsed = parseStudyMethodProfileLibrary(library);
      await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], app_interruption_sessions: parsed.app_interruption_sessions }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
      expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], app_interruption_sessions: saved.app_interruption_sessions }).app_interruption_sessions).toEqual(library.app_interruption_sessions);
    };
    await roundtrip();
    for (const membership of [undefined, null, []]) {
      session.interruptions = membership;
      if (membership === undefined) delete session.interruptions;
      expect(parseStudyMethodProfileLibrary(library).app_interruption_sessions).toEqual(library.app_interruption_sessions);
      await roundtrip();
    }
    expect(parseStudyMethodProfileLibrary({ profiles: input.profiles }).app_interruption_sessions).toBeUndefined();
    expect(parseStudyMethodProfileLibrary({ profiles: input.profiles, app_interruption_sessions: [] }).app_interruption_sessions).toEqual([]);
    session.interruptions = [{ interruption_record_id: "unknown", denotes_interval: { start_instant: null, end_status: "unobserved" }, source_locators: session.source_locators }];
    for (const labels of [undefined, null, [], ["", "same", "same"]]) {
      session.interruptions[0]!.visited_app_labels = labels;
      if (labels === undefined) delete session.interruptions[0]!.visited_app_labels;
      session.interruptions[0]!.interruption_type = null;
      expect(parseStudyMethodProfileLibrary(library).app_interruption_sessions).toEqual(library.app_interruption_sessions);
      await roundtrip();
    }
    session.interruptions[0]!.interruption_type = "source-specific open label";
    session.app_name = null;
    session.device_id = null;
    expect(parseStudyMethodProfileLibrary(library).app_interruption_sessions).toEqual(library.app_interruption_sessions);
    await roundtrip();
  });

  it("rejects malformed owners, duplicate local identities and invented fields before replacing stored data", async () => {
    const input = appInterruptionSessionExample();
    await saveResearchMethodSelection(JSON.stringify(input));
    const mutations: Array<(x: typeof input) => void> = [
      (x) => Reflect.set(x, "app_interruption_sessions", null),
      (x) => Reflect.set(x.app_interruption_sessions, "0", null),
      (x) => { x.app_interruption_sessions[0]!.method_profile_id = "foreign"; },
      (x) => { x.app_interruption_sessions[0]!.source_work_id = "foreign"; },
      (x) => { x.app_interruption_sessions[0]!.participant_id = " "; },
      (x) => { x.app_interruption_sessions[0]!.app_interruption_session_id = " "; },
      (x) => Reflect.set(x.app_interruption_sessions[0]!, "device_id", 0),
      (x) => Reflect.set(x.app_interruption_sessions[0]!, "app_name", 0),
      (x) => { x.app_interruption_sessions[0]!.session_record_origin = "raw_study_record"; },
      (x) => { x.app_interruption_sessions[0]!.source_locators = []; },
      (x) => Reflect.set(x.app_interruption_sessions[0]!, "denotes_interval", null),
      (x) => Reflect.set(x.app_interruption_sessions[0]!.denotes_interval, "duration_seconds", Infinity),
      (x) => Reflect.set(x.app_interruption_sessions[0]!, "interruptions", {}),
      (x) => Reflect.set(x.app_interruption_sessions[0]!.interruptions, "0", null),
      (x) => { x.app_interruption_sessions[0]!.interruptions[0]!.interruption_record_id = " "; },
      (x) => Reflect.set(x.app_interruption_sessions[0]!.interruptions[0]!, "interruption_type", false),
      (x) => Reflect.set(x.app_interruption_sessions[0]!.interruptions[0]!, "visited_app_labels", [3]),
      (x) => Reflect.set(x.app_interruption_sessions[0]!.interruptions[0]!, "visited_app_labels", "Google"),
      (x) => { x.app_interruption_sessions[0]!.interruptions[0]!.source_locators = [" "]; },
      (x) => Reflect.set(x.app_interruption_sessions[0]!.interruptions[0]!, "denotes_interval", null),
      (x) => { x.app_interruption_sessions[0]!.interruptions.push(structuredClone(x.app_interruption_sessions[0]!.interruptions[0]!)); },
      (x) => { x.app_interruption_sessions.push(structuredClone(x.app_interruption_sessions[0]!)); },
      (x) => Reflect.set(x.app_interruption_sessions[0]!.interruptions[0]!, "parent_session_reference", "foreign-session"),
      (x) => Reflect.set(x.app_interruption_sessions[0]!, "inferred_return", true),
    ];
    for (const [i, mutate] of mutations.entries()) {
      const invalid = structuredClone(input);
      mutate(invalid);
      expect(() => parseStudyMethodProfileLibrary(invalid), `interruption-session mutation ${i}`).toThrow();
    }
    expect(JSON.parse((await loadResearchMethodSelection())!)).toEqual(input);
  });

  it("keeps repeated local IDs in different sessions, participants, devices and profiles independent", () => {
    const input = appInterruptionSessionExample();
    for (const field of ["app_interruption_session_id", "participant_id", "device_id"] as const) {
      const copy = structuredClone(input.app_interruption_sessions[0]!);
      Reflect.set(copy, field, `another-${field}`);
      input.app_interruption_sessions.push(copy);
    }
    const profile = structuredClone(input.profiles[0]!);
    profile.method_profile_id = "example:other-interruption-owner";
    input.profiles.push(profile);
    const copy = structuredClone(input.app_interruption_sessions[0]!);
    copy.method_profile_id = profile.method_profile_id;
    input.app_interruption_sessions.push(copy);
    expect(parseStudyMethodProfileLibrary(input).app_interruption_sessions).toEqual(input.app_interruption_sessions);
  });
});

const pairWorks = ["doi:10.1145/3191754", "doi:10.1145/3473856.3473881"] as const;

itWithPrivateCorpus("preserves independent pooled Meaningful app shares and exact motivation-question supports", () => {
  const input = pairInput(pairWorks[0]);
  expect(parseStudyMethodProfileLibrary(input).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  expect(input.sampled_quantity_observations!.map(row => [row.observed_entity_token, row.participant_id, row.quantities!.map(q => q.evidence_value_json)]))
    .toEqual([["Chrome", undefined, ["9", "50", "10", "20", "11", "50", "701"]], ["Gmail", undefined, ["12", "39", "31", "10", "8", "39", "459"]]]);
  const changed = structuredClone(input);
  changed.sampled_quantity_observations![0]!.quantities![5]!.evidence_value_json = "49.50";
  expect(parseStudyMethodProfileLibrary(changed).sampled_quantity_observations).toEqual(changed.sampled_quantity_observations);
  expect(changed.sampled_quantity_observations![0]!.quantities!.slice(0, 5)).toEqual(input.sampled_quantity_observations![0]!.quantities!.slice(0, 5));
  expect(changed.sampled_quantity_observations![1]).toEqual(input.sampled_quantity_observations![1]);
  for (const token of [undefined, null, "null", "0.00", '"49.50"']) {
    const variant = structuredClone(input), quantity = variant.sampled_quantity_observations![0]!.quantities![0]!;
    if (token === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = token;
    expect(parseStudyMethodProfileLibrary(variant).sampled_quantity_observations).toEqual(variant.sampled_quantity_observations);
  }
  for (const mutate of [
    (x: typeof input) => { x.sampled_quantity_observations![0]!.quantities![0]!.evidence_value_json = "101"; },
    (x: typeof input) => { x.sampled_quantity_observations![0]!.quantities![6]!.evidence_value_json = "1.5"; },
    (x: typeof input) => { x.sampled_quantity_observations![0]!.quantities![0]!.evidence_unit = "count"; },
    (x: typeof input) => { x.sampled_quantity_observations![0]!.observed_entity_kind = "participant"; x.sampled_quantity_observations![0]!.participant_id = "example:person"; },
    (x: typeof input) => { x.profiles[0]!.method_settings.find(s => s.method_parameter_key === "aggregation.minimum_samples_per_app")!.method_value_json = "21"; },
    (x: typeof input) => { x.profiles[0]!.method_settings.find(s => s.method_parameter_key === "aggregation.minimum_samples_per_app")!.source_work_id = "doi:foreign"; },
  ]) { const invalid = structuredClone(input); mutate(invalid); expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(); }
  for (const property of ["valence", "arousal", "meaningfulness"]) {
    const invalid = structuredClone(input), session = invalid.app_interruption_sessions[0]!;
    session.session_labels![0]!.questionnaire_response_references = [session.session_questionnaire_responses!.find(response => response.observed_property === property)!.questionnaire_response_id];
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/incompatible or nonlocal questionnaire supports/);
  }
});

itWithPrivateCorpus("preserves WhyStop independent final labels, notification metadata, session totals and participant-specific Day0", () => {
  const input = pairInput(pairWorks[1]), row = input.app_interruption_sessions[0]!;
  expect(parseStudyMethodProfileLibrary(input).notification_histories).toEqual(input.notification_histories);
  expect(parseStudyMethodProfileLibrary(input).participant_day_observations).toEqual(input.participant_day_observations);
  expect(row.session_quantities!.map(q => q.evidence_value_json)).toEqual(["17.500", "90.00", "2", "12.00"]);
  expect(input.participant_day_observations!.map(day => [day.participant_id, day.referenced_day_token, day.day_observation_value_json]))
    .toEqual([[row.participant_id, "example:first-learning-day", "2"], [row.participant_id, "example:later-learning-day", "0"], ["example:independent-learning-participant", "example:first-learning-day", "1"]]);
  expect(input.notification_histories![0]!.notification_evidence.map(e => e.evidence_value_json)).toEqual([undefined, '"example: supplied app label"', "null", "true", "false"]);
  expect(input.sampled_quantity_observations!.slice(3).map(event => [event.source_event_time_token, event.app_interruption_session_reference, event.observation_instant]))
    .toEqual([["example:unconverted-phone-event-time", row.app_interruption_session_id, undefined], [null, undefined, undefined]]);
  for (const token of [undefined, null, "example:another-unconverted-time"]) {
    const variant = structuredClone(input), event = variant.sampled_quantity_observations![3]!;
    if (token === undefined) delete event.source_event_time_token; else event.source_event_time_token = token;
    expect(parseStudyMethodProfileLibrary(variant).sampled_quantity_observations).toEqual(variant.sampled_quantity_observations);
  }
  const final = row.interruptions![0]!.interruption_classifications!.find(label => label.observed_property === "ESQ-confirmed termination class")!;
  expect(final.label_value_json).toBe('"EXTERNAL"');
  expect(row.interruptions![0]!.interruption_classifications![1]!.label_value_json).toBe('"internal"');
  for (const value of ['"Intentionally ended"', '"DEVICE-INTERNAL"', '"INTERNAL"', '"AMBIGUOUS"', "null", null, undefined]) {
    const changed = structuredClone(input), item = changed.app_interruption_sessions[0]!.interruptions![0]!.interruption_classifications!.find(label => label.observed_property === "ESQ-confirmed termination class")!;
    if (value === undefined) delete item.label_value_json; else item.label_value_json = value;
    expect(parseStudyMethodProfileLibrary(changed).app_interruption_sessions).toEqual(changed.app_interruption_sessions);
    expect(changed.app_interruption_sessions[0]!.session_questionnaire_responses).toEqual(row.session_questionnaire_responses);
    expect(changed.app_interruption_sessions[0]!.interruptions![0]!.interruption_classifications![1]).toEqual(row.interruptions![0]!.interruption_classifications![1]);
  }
  const changed = structuredClone(input);
  changed.app_interruption_sessions[0]!.session_quantities![1]!.evidence_value_json = "88.00";
  changed.app_interruption_sessions[0]!.session_quantities![3]!.evidence_value_json = "11.00";
  expect(parseStudyMethodProfileLibrary(changed).app_interruption_sessions).toEqual(changed.app_interruption_sessions);
  expect(changed.app_interruption_sessions[0]!.interruptions).toEqual(row.interruptions);
  for (const refs of [undefined, null, []]) {
    const variant = structuredClone(input), interruption = variant.app_interruption_sessions[0]!.interruptions![1]!;
    if (refs === undefined) delete interruption.notification_history_references; else interruption.notification_history_references = refs;
    expect(parseStudyMethodProfileLibrary(variant).app_interruption_sessions).toEqual(variant.app_interruption_sessions);
  }
  for (const mutate of [
    (x: typeof input) => { x.app_interruption_sessions[0]!.interruptions![1]!.notification_history_references = ["foreign-item"]; },
    (x: typeof input) => { x.app_interruption_sessions[0]!.session_quantities![2]!.evidence_value_json = "-1"; },
    (x: typeof input) => { x.app_interruption_sessions[0]!.session_quantities![2]!.evidence_value_json = "1.5"; },
    (x: typeof input) => { x.sampled_quantity_observations![3]!.app_interruption_session_reference = "foreign"; },
    (x: typeof input) => { Reflect.set(x.sampled_quantity_observations![3]!, "source_event_time_token", 0); },
    (x: typeof input) => { x.sampled_quantity_observations![3]!.quantities![0]!.evidence_value_json = '"OFFHOOK"'; },
    (x: typeof input) => { x.notification_histories![0]!.participant_id = "foreign-participant"; },
    (x: typeof input) => { x.notification_histories![0]!.device_id = "foreign-device"; },
    (x: typeof input) => { x.app_interruption_sessions[0]!.interruptions![1]!.notification_history_references!.push("example:why-stop-notification"); },
    (x: typeof input) => { const copy = structuredClone(x.notification_histories![0]!); copy.device_id = "another-device"; x.notification_histories!.push(copy); delete x.app_interruption_sessions[0]!.device_id; },
    (x: typeof input) => { x.app_interruption_sessions[0]!.interruptions![0]!.interruption_classifications!.find(label => label.observed_property === "ESQ-confirmed termination class")!.label_value_json = '"external"'; },
  ]) { const invalid = structuredClone(input); mutate(invalid); expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(); }
});
const pairInput = (work: string) => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  return appInterruptionQuestionnaireExample(structuredClone(library.profiles.find(p => p.source_work_id === work)!));
};

itWithPrivateCorpus("rejects malformed supplied interruption evidence at its exact field", () => {
  const source = pairInput(pairWorks[1]);
  const session = (v: typeof source) => v.app_interruption_sessions[0]!;
  const interruption = (v: typeof source) => session(v).interruptions![0]!;
  const response = (v: typeof source) => session(v).session_questionnaire_responses![0]!;
  const label = (v: typeof source) => interruption(v).interruption_classifications![0]!;
  const cases: Array<[string, (v: typeof source) => void]> = [
    ["interruption_classifications must be an array or null", v => Reflect.set(interruption(v), "interruption_classifications", {})],
    ["interruption_classifications[0] must be an object", v => Reflect.set(interruption(v), "interruption_classifications", [null])],
    ["observed_property is incompatible with the supplied classification", v => { label(v).observed_property = "foreign classification"; }],
    ["questionnaire_response_references must be an array or null", v => Reflect.set(label(v), "questionnaire_response_references", {})],
    ["label_value_json must be lexical JSON or null", v => Reflect.set(label(v), "label_value_json", false)],
    ["session_questionnaire_responses[0] must be an object", v => Reflect.set(session(v), "session_questionnaire_responses", [null])],
    ["questionnaire_item_label must be a string or null", v => Reflect.set(response(v), "questionnaire_item_label", false)],
    ["response_value_json must be lexical JSON or null", v => Reflect.set(response(v), "response_value_json", false)],
    ["session_quantities[0] must be an object", v => Reflect.set(session(v), "session_quantities", [null])],
    ["evidence_value_json must be lexical JSON or null", v => Reflect.set(session(v).session_quantities![0]!, "evidence_value_json", false)],
    ["notification_history_references must be an array or null", v => Reflect.set(interruption(v), "notification_history_references", {})],
    ["session_labels must be an array or null", v => Reflect.set(session(v), "session_labels", {})],
    ["session_labels[0] must be an object", v => Reflect.set(session(v), "session_labels", [null])],
  ];
  for (const [message, mutate] of cases) {
    const invalid = structuredClone(source); mutate(invalid);
    expect(() => parseStudyMethodProfileLibrary(invalid), message).toThrow(message);
  }
});

itWithPrivateCorpus.each(pairWorks)("validates shared session evidence fields on the interruption caller: %s", work => {
  const input = pairInput(work);
  expect(parseStudyMethodProfileLibrary(input).app_interruption_sessions).toEqual(input.app_interruption_sessions);
  for (const field of ["support_task_action_references", "questionnaire_response_references"]) {
    for (const value of [null, []]) {
      const supplied = structuredClone(input);
      Reflect.set(supplied.app_interruption_sessions[0]!.session_quantities![0]!, field, value);
      expect(parseStudyMethodProfileLibrary(supplied).app_interruption_sessions).toEqual(supplied.app_interruption_sessions);
    }
    for (const value of [["not-in-this-session"], "not-an-array", [false]]) {
      const invalid = structuredClone(input);
      Reflect.set(invalid.app_interruption_sessions[0]!.session_quantities![0]!, field, value);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
    }
  }
  const invalidLabel = structuredClone(input);
  invalidLabel.app_interruption_sessions[0]!.session_labels![0]!.support_task_action_references = ["not-in-this-session"];
  expect(() => parseStudyMethodProfileLibrary(invalidLabel)).toThrow("containing session");
});

itWithPrivateCorpus.each([
  ...["instrument.motivation_analysis_labels", "lme.time_bins", "aggregation.statistic"].map(key => [pairWorks[0], key] as const),
  ...["app_switch.internal_label", "app_switch.device_label", "screen_lock.observation_and_ambiguity", "termination.classification_flow",
    "interruptions.suspending_vs_terminating", "movement.source_and_filter", "analysis.time_of_day_bins", "collector.recorded_identifiers",
    "analysis.GAMLSS_targets", "notification.collector", "communication.collector"].map(key => [pairWorks[1], key] as const),
])("admits only the actual %s %s definition and its original tuple", (work, key) => {
    const input = pairInput(work), profile = input.profiles[0]!;
    const setting = profile.method_settings.find(s => s.method_parameter_key === key)!;
    let count = 0;
    for (const row of input.app_interruption_sessions) {
      row.session_labels = (row.session_labels ?? []).filter(label => label.label_setting_reference === setting.method_setting_id);
      row.session_quantities = (row.session_quantities ?? []).filter(quantity => quantity.quantity_setting_reference === setting.method_setting_id);
      count += row.session_labels.length + row.session_quantities.length;
      if (key === "communication.collector") count += (row.session_actions ?? []).length; else delete row.session_actions;
      for (const interruption of row.interruptions ?? []) {
        interruption.interruption_classifications = (interruption.interruption_classifications ?? []).filter(label => label.label_setting_reference === setting.method_setting_id);
        count += interruption.interruption_classifications.length;
        if (key === "notification.collector") count += (interruption.notification_history_references ?? []).length;
        else delete interruption.notification_history_references;
      }
    }
    input.sampled_quantity_observations = (input.sampled_quantity_observations ?? []).filter(row => row.method_setting_reference === setting.method_setting_id);
    count += input.sampled_quantity_observations.length;
    if (key !== "notification.collector") delete input.notification_histories;
    delete input.participant_day_observations;
    expect(count).toBeGreaterThan(0);
    expect(parseStudyMethodProfileLibrary(input).app_interruption_sessions).toEqual(input.app_interruption_sessions);
    expect(parseStudyMethodProfileLibrary(input).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
    const original: unknown = JSON.parse(String(setting.method_value_json));
    const wrapped = typeof original === "object" && original !== null && !Array.isArray(original) && Object.hasOwn(original, "definition")
      ? original as Record<string, unknown> : { definition: original, source_facing_role: setting.method_setting_role, source_facing_target: setting.method_target_layer };
    for (const content of [{ ...wrapped, definition: null }, { ...wrapped, definition: {} },
      { ...wrapped, source_facing_role: "provenance", source_facing_target: "study_window" },
      { ...wrapped, source_facing_role: null }]) {
      setting.method_value_json = JSON.stringify(content);
      expect(() => parseStudyMethodProfileLibrary(input)).toThrow();
    }
    setting.method_value_json = JSON.stringify(wrapped.definition);
    expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow(); // Flat canonical body is also supported.
    setting.method_value_json = JSON.stringify(original);
    for (const [field, value] of [["method_setting_role", "provenance"], ["method_target_layer", "study_window"]] as const) {
      const previous = setting[field]; setting[field] = value;
      expect(() => parseStudyMethodProfileLibrary(input)).toThrow(); setting[field] = previous;
    }
    const foreign = structuredClone(input);
    foreign.profiles[0]!.source_work_id = "doi:foreign";
    foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = "doi:foreign"; });
    foreign.app_interruption_sessions.forEach(row => {
      row.source_work_id = "doi:foreign"; delete row.session_questionnaire_responses;
      row.session_labels?.forEach(label => { delete label.questionnaire_response_references; });
    });
    foreign.sampled_quantity_observations?.forEach(row => { row.source_work_id = "doi:foreign"; });
    foreign.sampled_quantity_observations?.forEach(row => { row.participant_id ??= "example:foreign-owner"; });
    foreign.notification_histories?.forEach(row => { row.source_work_id = "doi:foreign"; });
    expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow();
  });

itWithPrivateCorpus("admits independent WhyStop communication occurrences without manufacturing a containing session", () => {
  const example = pairInput(pairWorks[1]), setting = example.profiles[0]!.method_settings.find(s => s.method_parameter_key === "communication.collector")!;
  const source = { profiles: example.profiles, sampled_quantity_observations: example.sampled_quantity_observations!.filter(row => row.method_setting_reference === setting.method_setting_id) };
  source.sampled_quantity_observations.forEach(row => { delete row.app_interruption_session_reference; });
  expect(source.sampled_quantity_observations).toHaveLength(2);
  expect(parseStudyMethodProfileLibrary(source).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  expect(source.sampled_quantity_observations[0]!.source_event_time_token).toBe("example:unconverted-phone-event-time");
  const original: unknown = JSON.parse(String(setting.method_value_json));
  const wrapped = original as Record<string, unknown>;
  expect(wrapped.source_facing_role).toBe("acquisition"); expect(wrapped.source_facing_target).toBe("raw_record");
  for (const invalid of [{ ...wrapped, definition: {} }, { ...wrapped, source_facing_target: "collector" }]) {
    setting.method_value_json = JSON.stringify(invalid);
    expect(() => parseStudyMethodProfileLibrary(source)).toThrow(/sampled-quantity definition/);
  }
  setting.method_value_json = JSON.stringify(original); setting.source_work_id = "doi:foreign";
  expect(() => parseStudyMethodProfileLibrary(source)).toThrow(/sampled-quantity definition/);
});

itWithPrivateCorpus("retains passive movement membership and automatic classes independently of subjective ESQ answers", async () => {
  const input = pairInput(pairWorks[1]);
  const roundtrip = async (value: typeof input) => {
    const { profiles, ...records } = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], ...records }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile } & Record<string, unknown>;
    const { profile, ...restored } = saved;
    const parsed = parseStudyMethodProfileLibrary({ profiles: [profile], ...restored });
    expect(parsed.app_interruption_sessions).toEqual(value.app_interruption_sessions);
    expect(parsed.sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
    return parsed;
  };
  await roundtrip(input);
  const movements = input.sampled_quantity_observations!.slice(0, 3);
  expect(movements.map(row => row.app_interruption_session_reference)).toEqual([
    input.app_interruption_sessions[0]!.app_interruption_session_id, input.app_interruption_sessions[0]!.app_interruption_session_id,
    input.app_interruption_sessions[1]!.app_interruption_session_id,
  ]);
  expect(movements.map(row => row.quantities![0]!.evidence_value_json)).toEqual(['"STILL"', '"WALKING"', '"UNKNOWN"']);
  expect(movements.slice(0, 2).map(row => row.observation_instant)).toEqual(Array(2).fill("example:opaque-movement-instant"));
  const changed = structuredClone(input);
  changed.sampled_quantity_observations![0]!.quantities![1]!.evidence_value_json = "89";
  changed.app_interruption_sessions[0]!.interruptions![0]!.interruption_classifications![1]!.label_value_json = '"ambiguous"';
  await roundtrip(changed); // Import does not filter at 90 or recompute any classifier.
  expect(changed.sampled_quantity_observations!.slice(1)).toEqual(input.sampled_quantity_observations!.slice(1));
  expect(changed.app_interruption_sessions[0]!.session_questionnaire_responses).toEqual(input.app_interruption_sessions[0]!.session_questionnaire_responses);
  expect(changed.app_interruption_sessions[0]!.interruptions![0]!.interruption_type).toBe("APP_SWITCH");
  for (const missing of [undefined, null, "null"]) {
    const variant = structuredClone(input), reading = variant.sampled_quantity_observations![0]!, label = variant.app_interruption_sessions[0]!.interruptions![0]!.interruption_classifications![0]!;
    if (missing === undefined) { delete reading.quantities![0]!.evidence_value_json; delete label.label_value_json; }
    else { reading.quantities![0]!.evidence_value_json = missing; label.label_value_json = missing; }
    await roundtrip(variant);
  }
  for (const missing of [undefined, null]) {
    const variant = structuredClone(input), reading = variant.sampled_quantity_observations![0]!;
    if (missing === undefined) { delete reading.app_interruption_session_reference; delete reading.observation_instant; }
    else { reading.app_interruption_session_reference = missing; reading.observation_instant = missing; }
    await roundtrip(variant);
  }
  for (const labels of [undefined, null, []]) {
    const variant = structuredClone(input), interruption = variant.app_interruption_sessions[0]!.interruptions![0]!;
    if (labels === undefined) delete interruption.interruption_classifications; else interruption.interruption_classifications = labels;
    await roundtrip(variant);
  }
  await roundtrip(input); const saved = await loadResearchMethodSelection();
  for (const mutate of [
    (x: typeof input) => { x.sampled_quantity_observations![0]!.app_interruption_session_reference = "foreign"; },
    (x: typeof input) => { x.sampled_quantity_observations![0]!.app_interruption_session_reference = x.sampled_quantity_observations![0]!.sampled_observation_id; },
    (x: typeof input) => { x.sampled_quantity_observations![0]!.participant_id = "foreign-participant"; },
    (x: typeof input) => { x.sampled_quantity_observations![0]!.device_id = "foreign-device"; },
    (x: typeof input) => { x.sampled_quantity_observations![0]!.quantities![0]!.evidence_value_json = '"walking"'; },
    (x: typeof input) => { x.sampled_quantity_observations![0]!.quantities![0]!.evidence_value_json = "0"; },
    (x: typeof input) => { x.sampled_quantity_observations![0]!.quantities![1]!.evidence_value_json = "101"; },
    (x: typeof input) => { x.sampled_quantity_observations![0]!.quantities![1]!.evidence_value_json = "1e400"; },
    (x: typeof input) => { x.sampled_quantity_observations![0]!.quantities![1]!.evidence_value_json = "{}"; },
    (x: typeof input) => { x.sampled_quantity_observations![0]!.quantities![1]!.evidence_unit = "seconds"; },
    (x: typeof input) => { x.app_interruption_sessions[0]!.interruptions![0]!.interruption_classifications![0]!.label_value_json = '"External"'; },
    (x: typeof input) => { x.app_interruption_sessions[0]!.interruptions![0]!.interruption_classifications![0]!.questionnaire_response_references = [x.app_interruption_sessions[0]!.session_questionnaire_responses![0]!.questionnaire_response_id]; },
    (x: typeof input) => { const labels = x.app_interruption_sessions[0]!.interruptions![0]!.interruption_classifications!; labels.push(structuredClone(labels[0]!)); },
    (x: typeof input) => {
      const copy = structuredClone(x.app_interruption_sessions[0]!); copy.device_id = "example:second-device";
      copy.interruptions?.forEach(item => { delete item.notification_history_references; }); x.app_interruption_sessions.push(copy);
      delete x.sampled_quantity_observations![0]!.device_id; // Two otherwise-matching sessions cannot be guessed.
    },
  ]) {
    const invalid = structuredClone(input); mutate(invalid);
    await expect(roundtrip(invalid)).rejects.toThrow();
    expect(await loadResearchMethodSelection()).toBe(saved);
  }
});

itWithPrivateCorpus.each(pairWorks)("keeps %s durations scalar while preserving supplied sentinel and lexical unknown distinctions", work => {
  const input = pairInput(work);
  delete input.sampled_quantity_observations; delete input.notification_histories; delete input.participant_day_observations;
  for (const row of input.app_interruption_sessions) {
    delete row.session_labels; delete row.session_actions;
    row.session_quantities = row.session_quantities!.filter(quantity => {
      const key = input.profiles[0]!.method_settings.find(setting => setting.method_setting_id === quantity.quantity_setting_reference)!.method_parameter_key;
      return key === "event.duration_fields" || key === "analysis.net_duration";
    });
    for (const item of row.interruptions ?? []) { delete item.interruption_classifications; delete item.notification_history_references; }
  }
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  for (const token of [undefined, null, "null", "0.00", "17.500", '"17.500"', '"NA"']) {
    const copy = structuredClone(input), quantity = copy.app_interruption_sessions[0]!.session_quantities![0]!;
    if (token === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = token;
    expect(parseStudyMethodProfileLibrary(copy).app_interruption_sessions).toEqual(copy.app_interruption_sessions);
  }
  for (const token of ["{}", "[]", "true", "false", "1e400"]) {
    const copy = structuredClone(input); copy.app_interruption_sessions[0]!.session_quantities![0]!.evidence_value_json = token;
    expect(() => parseStudyMethodProfileLibrary(copy)).toThrow(/finite supplied scalar/);
  }
});

itWithPrivateCorpus.each(pairWorks)("preserves %s app-session answers and independent supplied quantities", async work => {
  const input = pairInput(work);
  const roundtrip = async (value: typeof input) => {
    const { profiles, ...records } = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], ...records }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile } & Record<string, unknown>;
    const { profile, ...savedRecords } = saved;
    const restored = parseStudyMethodProfileLibrary({ profiles: [profile], ...savedRecords });
    expect(restored.app_interruption_sessions).toEqual(value.app_interruption_sessions);
    for (const field of ["sampled_quantity_observations", "notification_histories", "participant_day_observations"] as const) expect(restored[field]).toEqual(value[field]);
    return restored;
  };
  await roundtrip(input);
  if (work === pairWorks[0]) {
    expect(input.app_interruption_sessions.map(row => [...new Set(row.session_questionnaire_responses!.map(r => r.response_role_label))])).toEqual([["before"], ["during"], ["after"]]);
    expect(Object.fromEntries(input.app_interruption_sessions[1]!.session_questionnaire_responses!.map(r => [r.observed_property, r.response_value_json]))).toEqual({
      valence: "4", arousal: "5", affect_text: '"example: earlier supplied affect text"', ugPurpose: '"NO_RESPONSE"',
      purpose: '"NA"', meaningfulness: '"NA"', meaningfulness_text: '"NA"',
    });
    expect(input.app_interruption_sessions.map(row => row.session_quantities!.map(q => q.observed_property))).toEqual(
      Array(3).fill(["duration_before", "sample_duration", "duration_after", "duration_total"]));
    const changed = structuredClone(input);
    changed.app_interruption_sessions[1]!.session_quantities![1]!.evidence_value_json = "9000";
    await roundtrip(changed);
    expect(changed.app_interruption_sessions[1]!.session_quantities![3]!.evidence_value_json).toBe("30000");
    expect(changed.app_interruption_sessions[0]).toEqual(input.app_interruption_sessions[0]);
    expect(changed.app_interruption_sessions[2]).toEqual(input.app_interruption_sessions[2]);
  } else {
    expect(input.app_interruption_sessions.map(row => row.session_quantities![0]!.evidence_value_json)).toEqual(["17.500", "0.00"]);
    expect(input.app_interruption_sessions[0]!.session_questionnaire_responses!.at(-1)!.interruption_record_reference).toBe("example:interruption-A");
    expect(input.app_interruption_sessions[1]!.session_questionnaire_responses!.some(r => Object.hasOwn(r, "interruption_record_reference"))).toBe(false);
    expect(input.app_interruption_sessions[0]!.interruptions).toHaveLength(3);
    expect(input.app_interruption_sessions[0]!.interruptions![0]!.visited_app_labels).toEqual(["example: other app", "example: other app"]);
  }
  for (const row of input.app_interruption_sessions) expect(row.denotes_interval).toEqual({});
  for (const token of [undefined, null, "null", "0", ' "NA" ', '"NO_RESPONSE"']) {
    const changed = structuredClone(input);
    const response = changed.app_interruption_sessions[0]!.session_questionnaire_responses![0]!;
    if (token === undefined) delete response.response_value_json; else response.response_value_json = token;
    await roundtrip(changed);
  }
  for (const field of ["session_questionnaire_responses", "session_quantities"] as const) for (const value of [undefined, null, []]) {
    const changed = structuredClone(input);
    if (value === undefined) Reflect.deleteProperty(changed.app_interruption_sessions[0]!, field); else Reflect.set(changed.app_interruption_sessions[0]!, field, value);
    if (field === "session_questionnaire_responses") changed.app_interruption_sessions[0]!.session_labels?.forEach(label => { delete label.questionnaire_response_references; });
    await roundtrip(changed);
  }
  for (const field of ["app_package_name", "response_role_label", "interruption_record_reference", "evidence_unit"] as const) for (const token of [undefined, null]) {
    const changed = structuredClone(input), row = changed.app_interruption_sessions[0]!;
    const target = field === "app_package_name" ? row : field === "evidence_unit" ? row.session_quantities![0]! : row.session_questionnaire_responses![0]!;
    if (token === undefined) Reflect.deleteProperty(target, field); else Reflect.set(target, field, token);
    await roundtrip(changed);
  }
  const repeated = structuredClone(input);
  const copy = structuredClone(repeated.app_interruption_sessions[0]!);
  copy.app_interruption_session_id += ":another-instance";
  repeated.app_interruption_sessions.push(copy);
  await roundtrip(repeated); // Equal local IDs/values in distinct sessions must not merge.
});

itWithPrivateCorpus.each(pairWorks)("rejects malformed %s session evidence before replacing saved state", async work => {
  // The shared base suite also exercises all new populated channels through persistence.
  const input = pairInput(work);
  await saveResearchMethodSelection(JSON.stringify(input));
  const bad = (mutate: (value: typeof input) => void) => {
    const invalid = structuredClone(input); mutate(invalid);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  };
  const first = (value: typeof input) => value.app_interruption_sessions[0]!;
  for (const mutate of [
    (x: typeof input) => { first(x).source_work_id = "foreign"; },
    (x: typeof input) => { first(x).session_questionnaire_responses![0]!.questionnaire_setting_reference = "foreign"; },
    (x: typeof input) => { first(x).session_questionnaire_responses!.push(structuredClone(first(x).session_questionnaire_responses![0]!)); },
    (x: typeof input) => { first(x).session_quantities!.push(structuredClone(first(x).session_quantities![0]!)); },
    (x: typeof input) => { first(x).session_quantities![0]!.quantity_scope = "app"; },
    (x: typeof input) => { first(x).session_quantities![0]!.app_identifier = "example:foreign-scope"; },
    (x: typeof input) => { first(x).session_quantities![0]!.observation_category = "example:foreign-category"; },
    (x: typeof input) => { first(x).session_quantities![0]!.evidence_unit = work === pairWorks[0] ? "seconds" : "milliseconds"; },
    (x: typeof input) => { first(x).session_quantities![0]!.observed_property = "unrelated measure"; },
    (x: typeof input) => { first(x).session_questionnaire_responses![0]!.response_value_json = "not JSON"; },
    (x: typeof input) => { first(x).session_quantities![0]!.evidence_value_json = "not JSON"; },
    (x: typeof input) => { first(x).session_questionnaire_responses![0]!.interruption_record_reference = "unknown"; },
    (x: typeof input) => Reflect.set(first(x), "app_package_name", 0),
    (x: typeof input) => Reflect.set(first(x), "app_package_name", " "),
    (x: typeof input) => Reflect.set(first(x), "session_questionnaire_responses", {}),
    (x: typeof input) => Reflect.set(first(x), "session_quantities", {}),
    (x: typeof input) => Reflect.set(first(x).session_questionnaire_responses![0]!, "response_role_label", " "),
    (x: typeof input) => Reflect.set(first(x).session_questionnaire_responses![0]!, "inferred_completion", true),
  ]) bad(mutate);
  if (work === pairWorks[0]) bad(x => {
    const raw = first(x).session_questionnaire_responses!.find(r => r.observed_property === "affect_text")!;
    raw.observed_property = "not a source response field";
  });
  else bad(x => {
    const later = x.app_interruption_sessions[1]!;
    later.interruptions = [{ interruption_record_id: "example:other-session-only", denotes_interval: {}, source_locators: later.source_locators }];
    first(x).session_questionnaire_responses!.at(-1)!.interruption_record_reference = "example:other-session-only";
  });
  const references = new Set(input.app_interruption_sessions.flatMap(row => [
    ...(row.session_questionnaire_responses ?? []).map(r => r.questionnaire_setting_reference),
    ...(row.session_quantities ?? []).map(q => q.quantity_setting_reference),
  ]));
  for (const reference of references) for (const mode of ["inner-null", "inner-scalar", "role", "target", "source"] as const) bad(x => {
    const setting = x.profiles[0]!.method_settings.find(s => s.method_setting_id === reference)!;
    const content: unknown = JSON.parse(String(setting.method_value_json));
    const wrapped = typeof content === "object" && content !== null && !Array.isArray(content) && Object.hasOwn(content, "definition")
      ? content as Record<string, unknown> : { definition: content, source_facing_role: setting.method_setting_role, source_facing_target: setting.method_target_layer };
    if (mode === "source") setting.source_work_id = "doi:foreign";
    else {
      if (mode === "inner-null") wrapped.definition = null;
      else if (mode === "inner-scalar") wrapped.definition = "invalid inner-body decoy";
      else if (mode === "role") wrapped.source_facing_role = "provenance";
      else wrapped.source_facing_target = "study_window";
      setting.method_value_json = JSON.stringify(wrapped);
    }
  });
  bad(x => {
    x.profiles[0]!.source_work_id = "doi:foreign";
    x.profiles[0]!.method_settings.forEach(s => { s.source_work_id = "doi:foreign"; });
    x.app_interruption_sessions.forEach(row => { row.source_work_id = "doi:foreign"; });
  });
  expect(JSON.parse((await loadResearchMethodSelection())!)).toEqual(input);
});
