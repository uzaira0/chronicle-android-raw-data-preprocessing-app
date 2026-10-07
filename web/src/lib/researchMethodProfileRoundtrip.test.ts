import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { lazyPrivateCorpusJson, privateCorpusAvailable, privateCorpusPath } from "@/testSupport/privateCorpus";

import { loadResearchMethodSelection, saveResearchMethodSelection } from "@/lib/lastRunStore";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { compileNativeMethodProfile, enumerateMethodConfigurations, parseStudyMethodProfileLibrary, requiresConfigurationSelection, selectMethodConfiguration } from "@/lib/methodProfiles";
import { odimInteractionTraceExample } from "../../e2e/fixtures/odim-interaction-trace";
import { clearAllGroupingExample, clearAllSnapshotExample } from "../../e2e/fixtures/clear-all-grouping";
import { jonesSequenceExample } from "../../e2e/fixtures/jones-sequence";
import { communicationFeatureExample, communicationQuestionnaireExample, ringerCommunicationExample, ringerStateIntervalExample } from "../../e2e/fixtures/ringer-state-interval";
import { multiDeviceQuestionnaireExample, notificationBoundaryExample, notificationContextExample, notificationHistoryExample, notificationOpeningExample, notificationParticipantDayExample, notificationTitleAnnotationExample } from "../../e2e/fixtures/notification-history";
import { notificationResponseExample } from "../../e2e/fixtures/notification-response";

const rawLibrary = lazyPrivateCorpusJson<{ profiles: Array<Record<string, unknown>> }>("ontology-sublation-20260831/adjudicated-method-profile-library.json");
const rawProfiles = () => rawLibrary().profiles;
const aliasTombstones = lazyPrivateCorpusJson<{ aliases: Array<{ alias_source_work_id: string; replacement_method_setting_id?: string }> }>(
  "ontology-sublation-20260831/method-setting-alias-tombstones.json");
const aliases = () => aliasTombstones().aliases;

import { admittedAndroidCalculationReceipts, expectAdmittedAndroidCalculationReceipt } from "@/testSupport/admittedAndroidCalculationReceipts";

itWithPrivateCorpus("rejects malformed ODIM trace, event and redaction carriers before retaining them", () => {
  const source = odimInteractionTraceExample(rawProfiles().find(p => p.source_work_id === "doi:10.1145/3743726"));
  const trace = (v: typeof source) => v.interaction_traces[0]!;
  const event = (v: typeof source) => trace(v).interaction_events[0]!;
  const redaction = (v: typeof source) => event(v).interaction_redactions![0]!;
  const cases: Array<[string, (v: typeof source) => void]> = [
    ["referenced_artifacts must be an array", v => Reflect.set(v, "referenced_artifacts", {})],
    ["referenced_artifacts contains duplicate IDs", v => { v.referenced_artifacts.push(structuredClone(v.referenced_artifacts[0]!)); }],
    ["interaction_traces must be an array", v => { Reflect.set(v, "interaction_traces", {}); }],
    ["must be an object", v => { Reflect.set(v.interaction_traces, "0", null); }],
    ["interaction_trace_id is duplicated", v => { v.interaction_traces.push(structuredClone(trace(v))); }],
    ["source_locators must be a non-empty string array", v => { trace(v).source_locators = []; }],
    ["interaction_events must be an array", v => { Reflect.set(trace(v), "interaction_events", {}); }],
    ["must be an object", v => { Reflect.set(trace(v).interaction_events, "0", null); }],
    ["capture_incomplete must be a boolean or null", v => { Reflect.set(event(v), "capture_incomplete", "true"); }],
    ["human_detected_incorrect must be a boolean or null", v => { Reflect.set(event(v), "human_detected_incorrect", 1); }],
    ["interaction_redactions must be an array or null", v => { Reflect.set(event(v), "interaction_redactions", {}); }],
    ["must be an object", v => { Reflect.set(event(v).interaction_redactions!, "0", null); }],
    ["redaction_record_id is duplicated", v => { trace(v).interaction_events[1]!.interaction_redactions![0]!.redaction_record_id = redaction(v).redaction_record_id; }],
    ["selected_element_ids must be a string array", v => { Reflect.set(redaction(v), "selected_element_ids", "element1"); }],
    ["selected_element_ids must be a string array", v => { redaction(v).selected_element_ids = [""]; }],
    ["selected_element_ids is duplicated", v => { redaction(v).selected_element_ids = ["element1", "element1"]; }],
    ["redaction_justification must be a string or null", v => { redaction(v).redaction_justification = false; }],
    ["source_locators must be a non-empty string array", v => { redaction(v).source_locators = []; }],
    ["unknown field", v => { Reflect.set(event(v), "inferred_capture_time", "made up"); }],
  ];
  expect(parseStudyMethodProfileLibrary(source).interaction_traces).toEqual(source.interaction_traces);
  for (const [message, mutate] of cases) {
    const invalid = structuredClone(source); mutate(invalid);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(message);
  }
});

const communicationFeatureWorks = ["doi:10.1007/978-3-642-37210-0_6", "doi:10.1145/2785830.2785852"] as const;
const communicationFeatureInput = (work: string) => communicationFeatureExample(parseStudyMethodProfileLibrary({
  profiles: [rawProfiles().find(p => p.source_work_id === work)],
}).profiles[0]!);
itWithPrivateCorpus.each(["schema.gps_points","feature.place_center","feature.ar_disclosed_coefficients","feature.metric.avg_iet_call","feature.metric.avg_iet_text","feature.metric.avg_iet_combined","feature.metric.var_iet_call","feature.metric.var_iet_text","feature.metric.var_iet_combined","feature.metric.home_regularity","feature.metric.ar_phi1","feature.metric.ar_phi4","feature.metric.ar_phi8","feature.metric.ar_phi12","feature.metric.ar_phi24","feature.metric.call_count_regularity","feature.metric.entropy_contacts_call","feature.metric.entropy_contacts_text","feature.metric.entropy_contacts_combined","feature.metric.contact_interaction_ratio_call","feature.metric.contact_interaction_ratio_text","feature.metric.contact_interaction_ratio_combined","feature.metric.contacts_call","feature.metric.contacts_text","feature.metric.contacts_combined","feature.metric.daily_radius","feature.metric.daily_distance","feature.metric.places_count","feature.metric.places_entropy","feature.metric.response_rate_call","feature.metric.response_rate_text","feature.metric.response_latency_text","feature.metric.night_call_percent","feature.metric.initiated_text_percent","feature.metric.initiated_call_percent","feature.metric.initiated_combined_percent","feature.metric.interactions_text","feature.metric.interactions_call","feature.metric.interactions_combined"])("retains source-bound SMS supplied GPS/place/per-user feature: %s", key => {
  const source = communicationFeatureInput(communicationFeatureWorks[0]);
  source.sampled_quantity_observations = source.sampled_quantity_observations.filter(row =>
    source.profiles[0]!.method_settings.find(s => s.method_setting_id === row.method_setting_reference)!.method_parameter_key === key);
  for (const row of source.sampled_quantity_observations) delete row.sampled_observation_references;
  expect(source.sampled_quantity_observations.length).toBeGreaterThan(0);
  expect(parseStudyMethodProfileLibrary(source).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  const setting = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  const content: unknown = JSON.parse(String(setting.method_value_json));
  const body = typeof content === "object" && content !== null && "definition" in content ? (content).definition : content;
  for (const bad of [null, {}, {definition:body,source_facing_role:"quality_control",source_facing_target:setting.method_target_layer}]) {
    const wrong = structuredClone(source);
    wrong.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!.method_value_json = JSON.stringify(bad);
    expect(() => parseStudyMethodProfileLibrary({profiles:wrong.profiles})).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
  }
  const wrapped = structuredClone(source);
  wrapped.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!.method_value_json =
    JSON.stringify({definition:body,source_facing_role:setting.method_setting_role,source_facing_target:setting.method_target_layer});
  expect(() => parseStudyMethodProfileLibrary(wrapped)).not.toThrow();
});
itWithPrivateCorpus.each(communicationFeatureWorks)("persists communication place/member/contact/feature ownership without inferred joins: %s", async work => {
  const source = communicationFeatureInput(work);
  const parsed = parseStudyMethodProfileLibrary(source);
  await saveResearchMethodSelection(JSON.stringify({profile:parsed.profiles[0],selectedLevels:{},
    sampled_quantity_observations:parsed.sampled_quantity_observations,participant_day_observations:parsed.participant_day_observations,task_occurrences:parsed.task_occurrences}));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string,unknown>;
  expect(parseStudyMethodProfileLibrary({profiles:[saved.profile],sampled_quantity_observations:saved.sampled_quantity_observations,
    participant_day_observations:saved.participant_day_observations,task_occurrences:saved.task_occurrences})).toEqual(parsed);
  const reversed = structuredClone(source); reversed.sampled_quantity_observations.reverse();
  reversed.sampled_quantity_observations.forEach(row => row.quantities?.reverse());
  expect(parseStudyMethodProfileLibrary(reversed).sampled_quantity_observations).toEqual(reversed.sampled_quantity_observations);
  const before = await loadResearchMethodSelection();
  const linked = source.sampled_quantity_observations.find(row => row.sampled_observation_references?.length)!;
  for (const field of ["participant_id","device_id"] as const) {
    const wrong = structuredClone(source);
    wrong.sampled_quantity_observations.find(row => row.sampled_observation_id === linked.sampled_observation_id)![field] = "known foreign owner";
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(/resolve unambiguously/);
    expect(await loadResearchMethodSelection()).toBe(before);
  }
  for (const ref of ["missing", linked.sampled_observation_id]) {
    const wrong = structuredClone(source);
    wrong.sampled_quantity_observations.find(row => row.sampled_observation_id === linked.sampled_observation_id)!.sampled_observation_references![0]!.sampled_observation_reference = ref;
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(/resolve unambiguously/);
  }
  const malformed = structuredClone(source);
  malformed.sampled_quantity_observations.find(row => row.sampled_observation_id === linked.sampled_observation_id)!.quantities![0]!.evidence_value_json = "{}";
  expect(() => parseStudyMethodProfileLibrary(malformed)).toThrow(work === communicationFeatureWorks[0] ? /scalar/ : /contact annotation string/);
  const unit = structuredClone(source); unit.sampled_quantity_observations[0]!.quantities![0]!.evidence_unit = "inferred units";
  expect(() => parseStudyMethodProfileLibrary(unit)).toThrow(/unit/);
  const unsupported = structuredClone(source); unsupported.sampled_quantity_observations[0]!.sampled_observation_references = [];
  expect(() => parseStudyMethodProfileLibrary(unsupported)).toThrow(/incompatible with this observation definition/);
  if (work === communicationFeatureWorks[0]) {
    expect(parsed.sampled_quantity_observations!.filter(row => row.sampled_observation_id.startsWith("constructed:metric-"))).toHaveLength(36);
    expect(parsed.sampled_quantity_observations!.find(row => row.sampled_observation_id === "constructed:AR-coefficients")!.quantities!.find(q => q.observed_property === "phi18")!.evidence_value_json).toBe("-0.25");
    expect(parsed.sampled_quantity_observations![0]!.source_event_time_token).not.toBe(parsed.sampled_quantity_observations![0]!.observation_instant);
    expect(parsed.participant_day_observations?.map(row => row.referenced_day_token)).toEqual(["opaque-supplied-day","opaque-supplied-day"]);
  } else {
    const wrong = structuredClone(source);
    wrong.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:contact-annotation")!.quantities![0]!.evidence_value_json = '"known different contact"';
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(/known recorded contact/);
    const unknown = structuredClone(source); unknown.sampled_quantity_observations[0]!.quantities![1]!.evidence_value_json = "null";
    expect(() => parseStudyMethodProfileLibrary(unknown)).not.toThrow();
  }
});

describe("real Android method-profile import and persistence", () => {

  itWithPrivateCorpus("preserves Chang occupancy action endpoints, independent means and source-known proxy/diary links", async () => {
    const profile = parseStudyMethodProfileLibrary({ profiles: [rawProfiles().find(p => p.source_work_id === "doi:10.1145/2785830.2785852")] }).profiles[0]!;
    const input = ringerCommunicationExample(profile);
    const parsed = parseStudyMethodProfileLibrary(input);
    const unknownSupport = structuredClone(input);
    unknownSupport.task_occurrences[0]!.task_questionnaire_responses![0]!.support_task_action_references = null;
    expect(parseStudyMethodProfileLibrary(unknownSupport).task_occurrences).toEqual(unknownSupport.task_occurrences);
    const wrongSupportShape = structuredClone(input);
    Reflect.set(wrongSupportShape.task_occurrences[0]!.task_questionnaire_responses![0]!, "support_task_action_references", "diary-event-0");
    expect(() => parseStudyMethodProfileLibrary(wrongSupportShape)).toThrow("support_task_action_references must be an array or null");
    const unknownQuantities = structuredClone(input);
    Reflect.set(unknownQuantities.ringer_state_intervals[0]!, "session_quantities", null);
    expect(parseStudyMethodProfileLibrary(unknownQuantities).ringer_state_intervals).toEqual(unknownQuantities.ringer_state_intervals);
    const persist = async (value: typeof input) => {
      const library = parseStudyMethodProfileLibrary(value);
      await saveResearchMethodSelection(JSON.stringify({ profile: library.profiles[0], selectedLevels: {},
        ringer_state_intervals: library.ringer_state_intervals, sampled_quantity_observations: library.sampled_quantity_observations, task_occurrences: library.task_occurrences }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
      return parseStudyMethodProfileLibrary({ profiles: [saved.profile], ringer_state_intervals: saved.ringer_state_intervals,
        sampled_quantity_observations: saved.sampled_quantity_observations, task_occurrences: saved.task_occurrences });
    };
    expect(await persist(input)).toEqual(parsed);
    expect(parsed.ringer_state_intervals![0]!.session_quantities!.map(q => q.evidence_value_json)).toEqual(["0", "17.500", "6.250", "3"]);
    expect(parsed.ringer_state_intervals![1]!.session_quantities![0]).toHaveProperty("start_action_reference", null);
    expect(parsed.ringer_state_intervals![1]!.session_quantities![1]).not.toHaveProperty("evidence_value_json");
    expect(parsed.ringer_state_intervals![2]!.session_actions).toEqual([]);
    expect(parsed.sampled_quantity_observations!.find(row => row.sampled_observation_id === "snapshot")!.observation_instant)
      .not.toBe(parsed.sampled_quantity_observations!.find(row => row.sampled_observation_id === "snapshot")!.source_event_time_token);
    expect(parsed.task_occurrences![0]!.task_questionnaire_responses!.map(r => r.support_task_action_references)).toEqual([["diary-event-0"], ["diary-event-1"], ["diary-event-2"]]);
    expect(parsed.task_occurrences![0]).not.toHaveProperty("task_observation_windows");
    const reversed = structuredClone(input);
    reversed.ringer_state_intervals[0]!.session_actions.reverse();
    reversed.sampled_quantity_observations.reverse();
    expect((await persist(reversed)).ringer_state_intervals![0]!.session_actions).toEqual(reversed.ringer_state_intervals[0]!.session_actions);
    const mutations: Array<[string, (x: typeof input) => void, RegExp]> = [
      ["unknown attending action", x => { x.ringer_state_intervals[0]!.session_actions[0]!.action_label = "reading SMS"; }, /unknown attending-action designation/],
      ["nonarray occupancy quantities", x => Reflect.set(x.ringer_state_intervals[0]!, "session_quantities", {}), /session_quantities must be an array or null/],
      ["nonobject occupancy quantity", x => Reflect.set(x.ringer_state_intervals[0]!.session_quantities, "0", null), /session_quantities\[0\] must be an object/],
      ["duplicate occupancy quantity", x => { const interval = x.ringer_state_intervals[0]!; Reflect.set(interval, "session_quantities", [...interval.session_quantities, structuredClone(interval.session_quantities[0]!)]); }, /blank or duplicate quantity identity/],
      ["nonlexical occupancy quantity", x => Reflect.set(x.ringer_state_intervals[0]!.session_quantities[0]!, "evidence_value_json", 0), /requires a lexical JSON quantity or null/],
      ["object occupancy quantity", x => { x.ringer_state_intervals[0]!.session_quantities[0]!.evidence_value_json = "{}"; }, /requires a scalar quantity/],
      ["occupancy quantity missing provenance", x => { x.ringer_state_intervals[0]!.session_quantities[0]!.source_locators = []; }, /requires source locators/],
      ["occupancy interval missing provenance", x => { x.ringer_state_intervals[0]!.source_locators = []; }, /source_locators must be a non-empty string array/],
      ["proxy nonlexical interval", x => Reflect.set(x.sampled_quantity_observations.find(r => r.sampled_observation_id === "proxy")!.quantities[0]!, "evidence_value_json", 7), /requires a lexical JSON quantity or null/],
      ["proxy malformed JSON", x => { x.sampled_quantity_observations.find(r => r.sampled_observation_id === "proxy")!.quantities[0]!.evidence_value_json = "not JSON"; }, /requires valid JSON/],
      ["foreign endpoint", x => { Reflect.set(x.ringer_state_intervals[0]!.session_quantities[0]!, "end_action_reference", "normal-wake"); }, /own occupancy actions/],
      ["self endpoint", x => { Reflect.set(x.ringer_state_intervals[0]!.session_quantities[0]!, "end_action_reference", "silent-wake"); }, /distinct gap endpoints/],
      ["numeric endpoint", x => { Reflect.set(x.ringer_state_intervals[0]!.session_quantities[0]!, "start_action_reference", 0); }, /own occupancy actions/],
      ["mean endpoint", x => { Reflect.set(x.ringer_state_intervals[0]!.session_quantities[2]!, "start_action_reference", null); }, /not a mean/],
      ["duplicate action", x => { x.ringer_state_intervals[0]!.session_actions.push(structuredClone(x.ringer_state_intervals[0]!.session_actions[0]!)); }, /duplicated/],
      ["negative gap", x => { x.ringer_state_intervals[0]!.session_quantities[0]!.evidence_value_json = "-1"; }, /invalid supplied quantity/],
      ["bad code", x => { x.ringer_state_intervals[0]!.session_quantities[3]!.evidence_value_json = "0"; }, /invalid supplied quantity/],
      ["changed gap definition", x => { const s = x.profiles[0]!.method_settings.find(s => s.method_parameter_key === "feature.general_attentiveness_gap")!; s.method_value_json = JSON.stringify({ definition: "different gap", source_interpretation_limits: "not original" }); }, /compatible occupancy quantity/],
      ["mean role spoof", x => { const s = x.profiles[0]!.method_settings.find(s => s.method_parameter_key === "feature.within_ringer_interval_attendance")!; s.method_setting_role = "analysis"; }, /compatible occupancy quantity/],
      ["bad quantity JSON", x => { x.ringer_state_intervals[0]!.session_quantities[0]!.evidence_value_json = "not JSON"; }, /valid JSON/],
      ["proxy negative interval", x => { x.sampled_quantity_observations.find(r => r.sampled_observation_id === "proxy")!.quantities[0]!.evidence_value_json = "-1"; }, /negative supplied attending/],
      ["proxy wrong unit", x => { x.sampled_quantity_observations.find(r => r.sampled_observation_id === "proxy")!.quantities[0]!.evidence_unit = "seconds"; }, /Chang quantity unit/],
      ["foreign proxy", x => { x.sampled_quantity_observations.find(r => r.sampled_observation_id === "proxy")!.sampled_observation_references![0]!.sampled_observation_reference = "missing"; }, /resolve unambiguously/],
      ["known peer", x => { x.sampled_quantity_observations.find(r => r.sampled_observation_id === "outgoing")!.quantities[1]!.evidence_value_json = JSON.stringify("other-peer"); }, /known same-contact/],
      ["known direction", x => { x.sampled_quantity_observations.find(r => r.sampled_observation_id === "incoming")!.quantities[0]!.evidence_value_json = JSON.stringify("outgoing SMS"); }, /known SMS event direction/],
      ["known app", x => { x.sampled_quantity_observations.find(r => r.sampled_observation_id === "attending")!.quantities[1]!.evidence_value_json = JSON.stringify("other-app"); }, /known same-app/],
      ["snapshot state", x => { x.sampled_quantity_observations.find(r => r.sampled_observation_id === "snapshot")!.quantities[1]!.evidence_value_json = JSON.stringify("walking"); }, /disclosed categorical/],
      ["wrong diary anchor", x => { x.task_occurrences[0]!.task_actions![0]!.action_label = "answer submission"; }, /retrospective source event/],
      ["cross diary action", x => { x.task_occurrences[0]!.task_questionnaire_responses![0]!.support_task_action_references = ["foreign-event"]; }, /missing retrospective actions within task/],
      ["duplicate diary supports", x => { x.task_occurrences[0]!.task_questionnaire_responses![0]!.support_task_action_references = ["diary-event-0", "diary-event-0"]; }, /duplicate or missing retrospective/],
      ["non-diary supports", x => { x.task_occurrences[1]!.task_questionnaire_responses![0]!.support_task_action_references = null; }, /no compatible retrospective event supports/],
      ["unsupported raw links", x => { Reflect.set(x.sampled_quantity_observations.find(r => r.sampled_observation_id === "incoming")!, "sampled_observation_references", []); }, /incompatible with this observation definition/],
    ];
    for (const [, mutate, error] of mutations) {
      const invalid = structuredClone(input); mutate(invalid);
      const before = await loadResearchMethodSelection();
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(error);
      expect(await loadResearchMethodSelection()).toBe(before);
    }
    // The legacy qualified envelope remains valid, but an explicit false source tuple does not.
    for (const key of ["feature.within_ringer_interval_attendance", "feature.attending_action_set", "diary.retrospective_event_index",
      "collector.communication_and_ringer_events", "acquisition.target_event_snapshot", "feature.sms_notification_first_action"]) {
      const invalid = structuredClone(input), setting = invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
      const content = JSON.parse(String(setting.method_value_json)) as Record<string, unknown>;
      setting.method_value_json = JSON.stringify({ ...content, source_facing_role: "analysis", source_facing_target: "outcome" });
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
    }
    const unknown = structuredClone(input);
    unknown.sampled_quantity_observations.find(r => r.sampled_observation_id === "outgoing")!.quantities[1]!.evidence_value_json = "null";
    unknown.sampled_quantity_observations.find(r => r.sampled_observation_id === "attending")!.quantities[1]!.evidence_value_json = null;
    expect(() => parseStudyMethodProfileLibrary(unknown)).not.toThrow(); // Unknowns never become agreement or mismatch.
  });

  itWithPrivateCorpus("preserves independent BFI44 answers, supplied trait values and unreconciled class cutpoints", async () => {
    const profile = parseStudyMethodProfileLibrary({ profiles: [rawProfiles().find(p => p.source_work_id === "doi:10.1007/978-3-642-37210-0_6")] }).profiles[0]!;
    const input = communicationQuestionnaireExample(profile);
    const parsed = parseStudyMethodProfileLibrary(input);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], task_occurrences: parsed.task_occurrences }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], task_occurrences: saved.task_occurrences })).toEqual(parsed);
    expect(parsed.task_occurrences?.map(t => t.task_questionnaire_responses!.length)).toEqual([44, 44]);
    expect(parsed.task_occurrences?.map(t => t.criterion_assessments!.at(-1)!.assessment_value_json)).toEqual(['"low"', '"high"']);
    for (const key of ["outcome.bfi44_instrument", "outcome.five_traits", "outcome.three_class_labels"]) {
      const invalid = structuredClone(input), setting = invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
      const definition: unknown = JSON.parse(String(setting.method_value_json));
      setting.method_value_json = JSON.stringify({ definition,
        source_facing_role: "participant_schema", source_facing_target: "participant_measure" });
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/compatible/);
    }
    const wrongClass = structuredClone(input);
    const wrongTrait = structuredClone(input);
    wrongTrait.task_occurrences[0]!.criterion_assessments![0]!.criterion_label = "undeclared BFI trait";
    expect(() => parseStudyMethodProfileLibrary(wrongTrait)).toThrow("BFI trait designation");
    wrongClass.task_occurrences[0]!.criterion_assessments!.at(-1)!.assessment_value_json = "0";
    expect(() => parseStudyMethodProfileLibrary(wrongClass)).toThrow(/low\/average\/high/);
    const unknown = structuredClone(input);
    Reflect.deleteProperty(unknown.task_occurrences[0]!.task_questionnaire_responses![0]!, "response_value_json");
    Reflect.set(unknown.task_occurrences[0]!.task_questionnaire_responses![1]!, "response_value_json", null);
    Reflect.set(unknown.task_occurrences[0]!.task_questionnaire_responses![2]!, "response_value_json", "null");
    expect(parseStudyMethodProfileLibrary(unknown).task_occurrences![0]!.task_questionnaire_responses!.slice(0, 3)).toEqual(unknown.task_occurrences[0]!.task_questionnaire_responses!.slice(0, 3));
  });
  itWithPrivateCorpus.each(["doi:10.1145/3130956", "doi:10.3390/s24082612", "doi:10.1145/3229434.3229436"])("preserves %s source-shaped notification boundaries and local relationships", async source => {
    const profile = parseStudyMethodProfileLibrary({ profiles: [rawProfiles().find(p => p.source_work_id === source)] }).profiles[0]!;
    const input = notificationBoundaryExample(profile);
    const persist = async (value: typeof input) => {
      const parsed = parseStudyMethodProfileLibrary(value);
      await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], notification_histories: parsed.notification_histories }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
      const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], notification_histories: saved.notification_histories });
      expect(restored.notification_histories).toEqual(value.notification_histories);
      return restored;
    };
    await persist(input);
    const reversed = structuredClone(input);
    reversed.notification_histories.reverse();
    reversed.notification_histories.forEach(row => row.notification_evidence.reverse());
    await persist(reversed);
    const mutations: Array<(value: typeof input) => void> = [
      x => { x.notification_histories.push(structuredClone(x.notification_histories[0]!)); },
      x => { x.notification_histories[1]!.notification_item_id = x.notification_histories[0]!.notification_item_id; },
      x => { x.notification_histories[0]!.notification_evidence[0]!.evidence_references = ["foreign-evidence"]; },
      x => { x.notification_histories[0]!.notification_evidence[0]!.evidence_references = [x.notification_histories[0]!.notification_evidence[0]!.evidence_record_id]; },
    ];
    if (source.endsWith("3130956")) {
      expect(input.notification_histories.map(h => h.notification_evidence.find(e => e.evidence_kind === "response_objective_label")!.evidence_value_json)).toEqual(["1", "0"]);
      expect(input.notification_histories[0]!.questionnaire_responses).toHaveLength(5);
      expect(input.notification_histories[1]!.questionnaire_responses).toBeNull();
      for (const row of input.notification_histories) {
        const contexts = row.notification_evidence.filter(e => e.evidence_kind === "context");
        expect(contexts.map(e => e.lookback)).toEqual(["last 5 minutes", "last hour", "since 5 am today"]);
        expect(contexts.every(e => e.context_sampling_boundary === "posting" && !Object.hasOwn(e, "evidence_instant"))).toBe(true);
      }
      for (const value of [undefined, null, "seen"]) mutations.push(x => {
        const row = x.notification_histories[0]!.notification_evidence[1]!;
        if (value === undefined) Reflect.deleteProperty(row, "context_sampling_boundary"); else Reflect.set(row, "context_sampling_boundary", value);
      });
      const altered = structuredClone(input);
      altered.notification_histories[0]!.notification_evidence[1]!.evidence_value_json = "0";
      await persist(altered);
      expect(altered.notification_histories[0]!.notification_evidence.at(-1)).toEqual(input.notification_histories[0]!.notification_evidence.at(-1));
    } else if (source.endsWith("s24082612")) {
      expect(input.notification_histories.map(h => h.notification_evidence[2]!.evidence_value_json)).toEqual(["13", "0"]);
      for (const value of [undefined, null, "", " ", 1]) mutations.push(x => {
        const row = x.notification_histories[0]!.notification_evidence[2]!;
        if (value === undefined) Reflect.deleteProperty(row, "observed_property"); else Reflect.set(row, "observed_property", value);
      });
      for (const [field, value] of [["evidence_value_json", "not-json"], ["context_sampling_boundary", "posting"], ["action_kind", null], ["response_stage_id", null]] as const) {
        mutations.push(x => { Reflect.set(x.notification_histories[0]!.notification_evidence[2]!, field, value); });
      }
      for (const token of [undefined, null, "null", "0", '"0"']) {
        const variant = structuredClone(input), row = variant.notification_histories[0]!.notification_evidence[2]!;
        if (token === undefined) delete row.evidence_value_json; else row.evidence_value_json = token;
        await persist(variant);
      }
    } else {
      expect(input.notification_histories.map(h => h.original_notification_history_reference)).toEqual(["example:snooze:original", "example:snooze:original", undefined]);
      expect(input.notification_histories[2]!.notification_evidence.filter(e => e.action_kind === "snooze").map(e => e.occurrence_ordinal)).toEqual([0, 1]);
      for (const reference of ["missing", "example:snooze:temporary-prompt", "", " ", 1]) mutations.push(x => {
        Reflect.set(x.notification_histories[0]!, "original_notification_history_reference", reference);
      });
      for (const field of ["participant_id", "device_id", "method_profile_id", "source_work_id"]) mutations.push(x => {
        Reflect.set(x.notification_histories[2]!, field, "foreign");
      });
      for (const value of [undefined, null]) {
        const variant = structuredClone(input);
        if (value === undefined) delete variant.notification_histories[0]!.original_notification_history_reference;
        else variant.notification_histories[0]!.original_notification_history_reference = value;
        await persist(variant);
        variant.notification_histories.forEach(h => { delete h.device_id; });
        await persist(variant); // Explicit unknown-device scope, not physical device equality.
      }
    }
    await persist(input);
    const savedBefore = await loadResearchMethodSelection();
    for (const mutate of mutations) {
      const invalid = structuredClone(input); mutate(invalid);
      await expect(persist(invalid)).rejects.toThrow();
      expect(await loadResearchMethodSelection()).toBe(savedBefore);
    }
  });

  itWithPrivateCorpus("composes notification boundary records without merging independently owned items", () => {
    const fixtures = ["doi:10.1145/3130956", "doi:10.3390/s24082612", "doi:10.1145/3229434.3229436"].map(source =>
      notificationBoundaryExample(parseStudyMethodProfileLibrary({ profiles: [rawProfiles().find(p => p.source_work_id === source)] }).profiles[0]!));
    const input = { profiles: fixtures.flatMap(f => f.profiles), notification_histories: fixtures.flatMap(f => f.notification_histories) };
    expect(parseStudyMethodProfileLibrary(input).notification_histories).toEqual(input.notification_histories);
  });

  itWithPrivateCorpus.each([
    ["doi:10.1145/3130956", "posting-relative context", { evidence_kind: "context", observed_property: "unlocks", context_sampling_boundary: "posting", lookback: "last 5 minutes", evidence_value_json: "2" }],
    ["doi:10.3390/s24082612", "independent IDL quantity", { evidence_kind: "quantity", observed_property: "Interaction Delay (IDL)", evidence_value_json: "37", evidence_unit: "seconds" }],
    ["doi:10.1145/3229434.3229436", "original notification reference", { evidence_kind: "action_occurrence", action_kind: "temporary snooze prompt created" }],
  ] as const)("retains %s %s in its existing notification owner", async (source, _label, evidence) => {
    const profile = parseStudyMethodProfileLibrary({ profiles: [rawProfiles().find(p => p.source_work_id === source)] }).profiles[0]!;
    const history = { notification_history_id: "example:history", method_profile_id: profile.method_profile_id,
      source_work_id: source, participant_id: "example:participant", history_record_origin: "analyst_constructed_example",
      notification_item_id: "example:item", notification_evidence: [{ evidence_record_id: "example:evidence",
        evidence_role: "inferred", ...evidence, source_locators: ["Constructed example of the source-defined distinction; not an original row."] }],
      source_locators: [source] };
    const histories = source.endsWith("3229436") ? [{ ...history, original_notification_history_reference: "example:original" },
      { ...history, notification_history_id: "example:original", notification_item_id: "example:original-item", notification_evidence: [] }] : [history];
    const parsed = parseStudyMethodProfileLibrary({ profiles: [profile], notification_histories: histories });
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], notification_histories: parsed.notification_histories }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], notification_histories: saved.notification_histories }).notification_histories).toEqual(histories);
  });

  itWithPrivateCorpus("preserves Digital Nightlife's separate missingness stages, category designations and exact sleep-item anchors", () => {
    const profile = parseStudyMethodProfileLibrary({ profiles: [rawProfiles().find(p => p.source_work_id === "doi:10.1177/00936502241276793")] }).profiles[0]!;
    const definition = (key: string) => JSON.parse(String(profile.method_settings.find(s => s.method_parameter_key === key)!.method_value_json)) as Record<string, unknown>;
    expect(definition("quality.raw_complete_cases")).toEqual({ operation: "na.omit()", row_rule: "drop rows containing NA in any loaded column",
      after: "map_df(files, vroom, col_types = s)", before: "rename(apk = app_name)" });
    expect(definition("quality.timeframe_complete_cases")).toEqual({ operation: "na.omit()", row_rule: "drop rows containing NA in any candidate-timeframe column",
      after: "mutate(hbefore_bt_yes = bt_yes - hours(1), .before = bt_yes)" });
    expect(definition("diary.sleep_quality_item")).toEqual({ instrument: "Pittsburgh Sleep Diary sleep-quality item",
      instrument_relation: "PSQI derivative adjusted for repeated daily measurement", prompt: "How did you sleep last night?",
      scale: { min: 1, max: 7, midpoint: 4, min_label: "not good at all", midpoint_label: "somewhat good", max_label: "very good" } });
    expect(definition("quality.outlier_boundary_source_conflict")).toMatchObject({ scope_conflict: false, paper_filter_scope: "all app activities", code_filter_scope: "all app activities" });
    const space = profile.method_configuration_space as { method_configuration_groups: Array<Record<string, unknown>> };
    const group = space.method_configuration_groups.find(g => (g.method_configuration_axis as string[]).includes("feature.app_scope_interaction_designation"))!;
    expect(JSON.parse(String(group.method_selection_semantics))).toEqual({ key: "feature.app_scope_interaction_designation", value: {
      lean_forward: ["social", "game"], lean_back: ["video"], designation_scope: "source app-category designation, not an observed per-activity interaction mode",
      aggregation_scope: "social, game and video remain separate app scopes" } });
    expect(group.method_configuration_group_kind).toBe("source_configuration_metadata");
    expect(requiresConfigurationSelection(group)).toBe(false);
    const campaign = space.method_configuration_groups.filter(g => g.method_configuration_group_kind === "source_campaign_model_cell");
    expect(campaign).toHaveLength(1);
    expect(campaign[0]!.method_configuration_levels).toHaveLength(28);
    expect(requiresConfigurationSelection(campaign[0]!)).toBe(false);
  });

  itWithPrivateCorpus("preserves MultiDevice's eight rated-device answers independently from the fifth collector", async () => {
    const profile = parseStudyMethodProfileLibrary({ profiles: [rawProfiles().find(p => p.source_work_id === "doi:10.1145/2971648.2971732")] }).profiles[0]!;
    const input = multiDeviceQuestionnaireExample(profile);
    const persist = async (value: typeof input) => {
      const parsed = parseStudyMethodProfileLibrary(value);
      await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], notification_histories: parsed.notification_histories }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
      return parseStudyMethodProfileLibrary({ profiles: [saved.profile], notification_histories: saved.notification_histories });
    };
    expect((await persist(input)).notification_histories).toEqual(input.notification_histories);
    const history = input.notification_histories[0]!;
    expect(history.questionnaire_responses).toHaveLength(10);
    expect(new Set(history.questionnaire_responses!.filter(r => /^Q[34]:/.test(r.questionnaire_response_id)).map(r => r.questionnaire_response_id)).size).toBe(8);
    expect(history.questionnaire_responses!.slice(0, 2).map(r => JSON.parse(r.response_value_json) as unknown)).toEqual([["In transit", "Work/uni"], "1-3"]);
    expect(history.device_id).toBe("example:ESM-collector-phone");
    expect(history).not.toHaveProperty("acceptance_records");
    const reordered = structuredClone(input);
    reordered.notification_histories[0]!.questionnaire_responses!.reverse();
    reordered.notification_histories[0]!.device_id = "example:replacement-collector";
    expect((await persist(reordered)).notification_histories).toEqual(reordered.notification_histories);
    expect(reordered.notification_histories[0]!.questionnaire_responses!.slice().reverse()).toEqual(history.questionnaire_responses);
    for (const value of ["null", "0", '""']) {
      const partial = structuredClone(input);
      partial.notification_histories[0]!.questionnaire_responses![0]!.response_value_json = value;
      partial.notification_histories[0]!.questionnaire_responses!.pop();
      expect((await persist(partial)).notification_histories).toEqual(partial.notification_histories);
    }
    for (const value of [undefined, null, []]) {
      const partial = structuredClone(input);
      if (value === undefined) Reflect.deleteProperty(partial.notification_histories[0]!, "questionnaire_responses");
      else partial.notification_histories[0]!.questionnaire_responses = value;
      expect((await persist(partial)).notification_histories).toEqual(partial.notification_histories);
    }
    for (const value of [undefined, null]) {
      const invalid = structuredClone(input);
      if (value === undefined) Reflect.deleteProperty(invalid.notification_histories[0]!.questionnaire_responses![0]!, "response_value_json");
      else Reflect.set(invalid.notification_histories[0]!.questionnaire_responses![0]!, "response_value_json", value);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("response_value_json");
    }
    const invalid = structuredClone(input);
    invalid.notification_histories[0]!.questionnaire_responses!.push(structuredClone(history.questionnaire_responses![0]!));
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("duplicated within history");
  });

  itWithPrivateCorpus("preserves the touch-authentication poster's ten item identities and separate reported means", async () => {
    const work = "doi:10.1145/3490100.3516456";
    const profile = parseStudyMethodProfileLibrary({ profiles: [rawProfiles().find((p) => p.source_work_id === work)] }).profiles[0]!;
    const questionnaire = profile.method_settings.find((s) => s.method_parameter_key === "study.questionnaire")!;
    const results = profile.method_settings.find((s) => s.method_parameter_key === "result.questionnaire_item_means")!;
    expect(questionnaire.method_setting_id).toBe("method-setting-fea55ccb5ef7565b4c3c4157");
    const instrument = JSON.parse(String(questionnaire.method_value_json)) as { items: Array<{ id: string; statement: string }> };
    const table = JSON.parse(String(results.method_value_json)) as { instrument_key: string; items: Array<{ id: string; average_score: string }> };
    const ids = Array.from({ length: 10 }, (_, i) => String(i + 1));
    expect(instrument.items.map((item) => item.id)).toEqual(ids);
    expect(table.items.map((item) => item.id)).toEqual(ids);
    expect(table.instrument_key).toBe(questionnaire.method_parameter_key);
    expect(table.items.map((item) => item.average_score)).toEqual(["3.0", "3.0", "4.0", "3.0", "3.0", "3.0", "3.5", "3.0", "3.0", "4.0"]);
    expect(instrument.items[6]!.statement).toBe(instrument.items[7]!.statement);
    expect(instrument.items[6]!.id).not.toBe(instrument.items[7]!.id);
    // Poster p1, Closed-ended Questionnaire Score: retain printed wording, including duplicate 7/8.
    expect(instrument.items.map((item) => item.statement)).toEqual([
      "I found the authentication intuitive to understand the security of smartphone.",
      "The authentication process made it quick to complete the required tasks of getting access to smartphone.",
      "I found it clear and understandable to use the authentication system on smartphone.",
      "The touch interaction behavior based approach supports the security of a smartphone.",
      "I found it easy and intuitive to use the system in order to ensure the access control of smartphone.",
      "I found the approach useful as it does not require remembering PIN or pattern.",
      "Overall, the system and the approach was easy to use.",
      "Overall, the system and the approach was easy to use.",
      "I am excited to use the system and the approach in future on my smartphone.",
      "I would like to recommend others using this system and the approach.",
    ]);
    expect(questionnaire.method_value_json).not.toContain("average_score");
    expect(results.method_setting_role).toBe("reporting");
    expect(results.method_target_layer).toBe("outcome");
    expect(results.method_implementation_status).toBe("specification_only");
    expect(profile.method_settings.find((s) => s.method_parameter_key === "study.questionnaire_scale_missing")!.method_value_json)
      .toContain("response scale, item anchors, missing-response handling, and participant-level responses are not disclosed");
    const enumerated = enumerateMethodConfigurations(profile);
    expect(enumerated.ok).toBe(true);
    if (!enumerated.ok) return;
    for (const selection of enumerated.selections) expect(selection.effectiveSettingIds).not.toContain(results.method_setting_id);
    expect(compileNativeMethodProfile(profile).ok).toBe(false);
    await saveResearchMethodSelection(JSON.stringify({ profile, selectedLevels: {} }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: typeof profile };
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
    expect(restored).toEqual(profile);
  });

  itWithPrivateCorpus("preserves Rabbit Hole's source inventory, partial order and distinct nonselectable memberships", async () => {
    const work = "doi:10.1145/3604241";
    const audit = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/post-freeze-source-audits/rabbit-hole-2023.json"), "utf8")) as {
      disclosed_atoms: Array<{ key: string; value: unknown; canonical_role: string; canonical_target: string; locator: string; projection_disposition: string }>;
      method_operations: Array<Record<string, unknown>>;
      configuration_verdicts: Array<{ configuration_id: string; atom_keys: string[]; configuration_unit_kind: string }>;
      source_configuration_repairs: Array<{ group_id: string; atom_keys: string[]; conditional_atom_keys?: string[] }>;
    };
    const raw = rawProfiles().find((p) => p.source_work_id === work);
    expect(raw, "source-approved definitions must actually be canonically admitted").toBeDefined();
    const profile = parseStudyMethodProfileLibrary({ profiles: [raw] }).profiles[0]!;
    expect(profile.method_settings).toHaveLength(91);
    expect(compileNativeMethodProfile(profile).readiness.configuration.blockers).toEqual([]);
    for (const atom of audit.disclosed_atoms.filter((a) => a.projection_disposition !== "configuration_metadata")) {
      const setting = profile.method_settings.find((s) => s.method_parameter_key === atom.key)!;
      expect(JSON.parse(setting.method_value_json as string), atom.key).toEqual(atom.value);
      expect(setting.method_setting_role).toBe(atom.canonical_role);
      expect(setting.method_target_layer).toBe(atom.canonical_target);
    }
    expect(profile.method_operations).toEqual(audit.method_operations);
    const operations = profile.method_operations as Array<Record<string, unknown>>;
    expect(operations).toHaveLength(25);
    expect(operations.find((o) => o.operation_id === "rabbit_hole.construct_sessions")!.operation_role).toBe("reconstruction");
    expect(operations.find((o) => o.operation_id === "rabbit_hole.construct_sessions")!.epistemic_role).toBe("infer");
    expect(operations.find((o) => o.operation_id === "rabbit_hole.compare_suq_prepost")!.depends_on)
      .toEqual(["rabbit_hole.initial_survey", "rabbit_hole.final_survey"]);
    expect(operations.find((o) => o.operation_id === "rabbit_hole.derive_revised_definition")!.depends_on)
      .toEqual(["rabbit_hole.conduct_focus_group", "rabbit_hole.paired_user_comparisons"]);
    const space = profile.method_configuration_space as {
      invariant_method_setting_ids: string[];
      method_configuration_groups: Array<{ method_configuration_group_kind: string; method_configuration_axis: string[];
        method_selection_semantics: string; method_cross_product_policy: string;
        method_configuration_levels: Array<{ included_method_setting_ids: string[]; common_method_setting_ids: string[]; branch_method_setting_ids: string[] }> }>;
    };
    const idsFor = (keys: string[]) => keys.map((k) => profile.method_settings.find((s) => s.method_parameter_key === k)!.method_setting_id);
    const fixed = space.method_configuration_groups.find((g) => g.method_configuration_axis.includes("rabbit_hole:collection_and_device_sessions"))!;
    expect(fixed.method_configuration_group_kind).toBe("fixed_pipeline_stage_component");
    expect(fixed.method_selection_semantics).toBe("fixed_source_inventory_no_user_selection");
    expect(fixed.method_cross_product_policy).toBe("source_declared_fixed_inventory_no_cartesian_product");
    expect(fixed.method_configuration_levels).toHaveLength(1);
    expect(fixed.method_configuration_levels[0]!.included_method_setting_ids).toEqual([]);
    expect(fixed.method_configuration_levels[0]!.branch_method_setting_ids).toEqual([]);
    const collection = audit.configuration_verdicts.find((v) => v.configuration_id === "rabbit_hole:collection_and_device_sessions")!;
    expect(fixed.method_configuration_levels[0]!.common_method_setting_ids).toEqual(idsFor(collection.atom_keys));
    for (const id of idsFor(collection.atom_keys)) expect(space.invariant_method_setting_ids).toContain(id);
    const duplicate = structuredClone(profile);
    const duplicateSpace = duplicate.method_configuration_space as typeof space;
    duplicateSpace.method_configuration_groups.find(g => g.method_selection_semantics === "fixed_source_inventory_no_user_selection")!
      .method_configuration_levels[0]!.included_method_setting_ids.push(idsFor(collection.atom_keys)[0]!);
    expect(compileNativeMethodProfile(duplicate).readiness.configuration.blockers.some(b =>
      b.code === "configuration_selection_mismatch" && b.detail.includes("more than once"))).toBe(true);
    for (const verdict of audit.configuration_verdicts.filter((v) => v.configuration_unit_kind === "campaign_internal_job_model_cell")) {
      const group = space.method_configuration_groups.find((g) => g.method_configuration_axis.includes(verdict.configuration_id))!;
      expect(group.method_selection_semantics).toBe("source_campaign_cell_no_user_selection");
      expect(group.method_configuration_levels[0]!.included_method_setting_ids).toEqual(idsFor(verdict.atom_keys));
      for (const id of idsFor(verdict.atom_keys)) expect(space.invariant_method_setting_ids).not.toContain(id);
    }
    const esm = space.method_configuration_groups.find((g) => g.method_configuration_group_kind === "conditional_joint_protocol")!;
    expect(esm.method_configuration_axis).toEqual(["esm_protocol"]);
    const lockKeys = audit.source_configuration_repairs.find((g) => g.group_id === "esm_protocol")!.conditional_atom_keys!;
    expect(esm.method_configuration_levels[0]!.branch_method_setting_ids).toEqual(idsFor(lockKeys));
    for (const id of idsFor(lockKeys)) expect(space.invariant_method_setting_ids).not.toContain(id);
    for (const id of idsFor(["diary.unlock_instrument", "diary.unlock_trigger"])) expect(space.invariant_method_setting_ids).toContain(id);
    for (const id of idsFor(audit.configuration_verdicts.find((v) => v.configuration_unit_kind === "evidence_only_unavailable")!.atom_keys.filter((k) => k !== "structure.source_scope_and_qualifications"))) {
      expect(space.invariant_method_setting_ids).not.toContain(id);
    }
    const metadata = space.method_configuration_groups.find((g) => g.method_configuration_axis.includes("structure.source_scope_and_qualifications"))!;
    expect(JSON.stringify(metadata)).toContain("operation_order_unknowns");
    expect(JSON.stringify(metadata)).toContain("printed-reference:10.1145/3604241:87");
    const reordered = structuredClone(profile);
    (reordered.method_operations as Array<Record<string, unknown>>).reverse();
    const imported = parseStudyMethodProfileLibrary({ profiles: [reordered] }).profiles[0]!;
    await saveResearchMethodSelection(JSON.stringify({ profile: imported, selectedLevels: {} }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
    expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]).toEqual(reordered);
    const cycle = structuredClone(profile);
    (cycle.method_operations as Array<Record<string, unknown>>)[0]!.depends_on = ["rabbit_hole.fit_revised_model"];
    expect(() => parseStudyMethodProfileLibrary({ profiles: [cycle] })).toThrow("dependency cycle");
    const selections = enumerateMethodConfigurations(profile);
    expect(selections.ok).toBe(true);
    if (selections.ok) expect(selections.selections).toHaveLength(1); // Campaigns and short/long conditions are not selectors.
    for (const group of space.method_configuration_groups) expect(requiresConfigurationSelection(group)).toBe(false);
    expect(compileNativeMethodProfile(profile).ok).toBe(false);
  });

  itWithPrivateCorpus("attaches Corona's obtained-event to on-device aggregate to backend partial order without inventing a constructor", async () => {
    const work = "doi:10.1038/s41597-026-07015-7";
    const profile = parseStudyMethodProfileLibrary({ profiles: [rawProfiles().find((p) => p.source_work_id === work)] }).profiles[0]!;
    const operations = profile.method_operations as Array<Record<string, unknown>>;
    expect(operations.map((o) => [o.operation_id, o.depends_on])).toEqual([
      ["corona:obtain-usageevents", []],
      ["corona:on-device-daily-aggregation", ["corona:obtain-usageevents"]],
      ["corona:transmit-aggregate", ["corona:on-device-daily-aggregation"]],
    ]);
    expect(operations[0]!.configuration_dependencies).toContain("acquisition.explicit_usage_access_permission");
    expect(operations[0]!.configuration_dependencies).toContain("acquisition.response_triggered_not_continuous");
    expect(operations[1]!.configuration_dependencies).toContain("aggregation.location_on_device");
    expect(operations[1]!.configuration_dependencies).toContain("aggregation.reported_daily_granularity");
    expect(operations[2]!.consumes).toEqual(operations[1]!.produces);
    expect(operations.flatMap((o) => o.configuration_dependencies as string[])).not.toContain("quality.duration_unit_undisclosed");
    expect(operations.flatMap((o) => o.configuration_dependencies as string[])).not.toContain("schema.appdata_day_window_conflict");
    expect(operations[2]!.configuration_dependencies).not.toContain("backend.answersheet_endpoint");
    const reordered = structuredClone(profile);
    (reordered.method_operations as Array<Record<string, unknown>>).reverse(); // Array position is not the source's dependency graph.
    const parsed = parseStudyMethodProfileLibrary({ profiles: [reordered] }).profiles[0]!;
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed, selectedLevels: {} }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
    expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]).toEqual(reordered);
    const invalid = structuredClone(profile);
    (invalid.method_operations as Array<Record<string, unknown>>)[0]!.depends_on = ["corona:transmit-aggregate"];
    expect(() => parseStudyMethodProfileLibrary({ profiles: [invalid] })).toThrow("dependency cycle");
    expect(compileNativeMethodProfile(profile).ok).toBe(false);
    expect(profile.method_settings.find((s) => s.method_parameter_key === "schema.appdata_day_window_conflict")).toBeDefined();
    expect(profile.method_settings.find((s) => s.method_parameter_key === "quality.duration_unit_undisclosed")).toBeDefined();
  });

  it("preserves response-stage availability separately from endpoints, objectives and device-use context", async () => {
    const input = notificationResponseExample();
    const library = parseStudyMethodProfileLibrary(input);
    await saveResearchMethodSelection(JSON.stringify({ profile: library.profiles[0], notification_histories: library.notification_histories }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], notification_histories: saved.notification_histories });
    expect(restored.notification_histories).toEqual(input.notification_histories);
    const [partial, complete, negative] = restored.notification_histories!;
    expect(partial!.notification_evidence.find((e) => e.evidence_kind === "response_endpoint")!.evidence_references).toEqual(["D1", "D2", "expiry"]);
    expect(complete!.notification_evidence[0]).not.toHaveProperty("evidence_value_json");
    expect(complete!.notification_evidence[1]!.evidence_value_json).toBeNull();
    expect(complete!.notification_evidence.filter((e) => e.evidence_kind === "response_objective_label").map((e) => e.observed_property)).toEqual(["receptivity"]);
    expect(negative!.notification_evidence.find((e) => e.evidence_kind === "response_endpoint")!.evidence_value_json).toBe('"null"');
    expect(negative!.notification_evidence[0]!.response_observability).toBe("observable");
    expect(compileNativeMethodProfile(restored.profiles[0]!, DEFAULT_BROWSER_OPTIONS).ok).toBe(false);
    const variant = structuredClone(input);
    variant.notification_histories.reverse();
    for (const history of variant.notification_histories) history.notification_evidence.reverse();
    const stage = variant.notification_histories[1]!.notification_evidence.find((e) => e.evidence_record_id === "D1")!;
    stage.response_stage_id = "merged-or-later-decision-not-D1-D3";
    stage.evidence_value_json = ' {"supplied_inferred_annotation":true} '; // Unobservable decisions may still have supplied inferences.
    expect(parseStudyMethodProfileLibrary(variant).notification_histories).toEqual(variant.notification_histories);
    const copy = { ...structuredClone(input.notification_histories[0]!), participant_id: "other-participant" };
    input.notification_histories.push(copy);
    expect(parseStudyMethodProfileLibrary(input).notification_histories).toHaveLength(4);
  });

  it("rejects malformed stage/objective fields and foreign supports without substituting missing evidence", () => {
    const input = notificationResponseExample();
    const mutations: Array<(x: typeof input) => void> = [
      (x) => Reflect.deleteProperty(x.notification_histories[0]!.notification_evidence[0]!, "response_stage_id"),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[0]!, "response_stage_id", " "),
      (x) => Reflect.deleteProperty(x.notification_histories[0]!.notification_evidence[0]!, "response_observability"),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[0]!, "response_observability", "negative"),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[2]!, "response_stage_id", "D1"),
      (x) => Reflect.deleteProperty(x.notification_histories[0]!.notification_evidence[5]!, "observed_property"),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[5]!, "observed_property", " "),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[5]!, "context_sampling_boundary", "interruption"),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[5]!, "lookback", "1s"),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[0]!, "observed_property", "reachability"),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[4]!, "evidence_references", ["D3"]),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[5]!, "evidence_references", ["endpoint", "endpoint"]),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[4]!, "evidence_references", ["endpoint"]),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[4]!, "evidence_value_json", "undefined"),
    ];
    for (const [index, mutate] of mutations.entries()) {
      const invalid = structuredClone(input);
      mutate(invalid);
      expect(() => parseStudyMethodProfileLibrary(invalid), `response mutation ${index}`).toThrow();
    }
  });

  it("preserves participant-day aggregates and subjective supports without substituting the diary submission day", async () => {
    const input = notificationParticipantDayExample();
    const library = parseStudyMethodProfileLibrary(input);
    await saveResearchMethodSelection(JSON.stringify({ profile: library.profiles[0], participant_day_observations: library.participant_day_observations }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], participant_day_observations: saved.participant_day_observations });
    expect(restored.participant_day_observations).toEqual(input.participant_day_observations);
    expect(restored.participant_day_observations!.slice(0, 2).map((r) => r.day_observation_value_json)).toEqual(["0", "0.00"]);
    expect(restored.participant_day_observations![2]!.aggregate_observation_references).toEqual(["daily-messenger-count", "daily-email-count"]);
    expect(restored.participant_day_observations![4]!.day_observation_value_json).toBe("null");
    expect(restored.participant_day_observations![5]!.day_observation_value_json).toBeNull();
    expect(Object.hasOwn(restored.participant_day_observations![6]!, "day_observation_value_json")).toBe(false);
    expect(restored.participant_day_observations![8]!.aggregate_observation_references).toEqual([]);
    const variant = structuredClone(input);
    variant.participant_day_observations.reverse();
    const response = variant.participant_day_observations.find((r) => r.day_observation_id === "reported-stress" && r.referenced_day_token === "example:prior-day-1-not-a-date")!;
    response.day_observation_value_json = ' ["example",null,0] ';
    response.questionnaire_item_label = "Example supplied wording; not the unrecovered study instrument";
    response.observation_category = "different supplied answer scope"; // Support does not assert category equality.
    const changed = parseStudyMethodProfileLibrary(variant);
    await saveResearchMethodSelection(JSON.stringify({ profile: changed.profiles[0], participant_day_observations: changed.participant_day_observations }));
    const again = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    expect(parseStudyMethodProfileLibrary({ profiles: [again.profile], participant_day_observations: again.participant_day_observations }).participant_day_observations).toEqual(variant.participant_day_observations);
    expect(compileNativeMethodProfile(restored.profiles[0]!).ok).toBe(false);
    expect(parseStudyMethodProfileLibrary({ profiles: input.profiles }).participant_day_observations).toBeUndefined();
    expect(parseStudyMethodProfileLibrary({ profiles: input.profiles, participant_day_observations: [] }).participant_day_observations).toEqual([]);
  });

  it("rejects malformed day observations and cross-owner/day or subjective aggregate supports", () => {
    const input = notificationParticipantDayExample();
    const mutations: Array<(x: typeof input) => void> = [
      (x) => Reflect.set(x, "participant_day_observations", null),
      (x) => Reflect.set(x.participant_day_observations, "0", null),
      (x) => { x.participant_day_observations[0]!.source_work_id = "foreign-work"; },
      (x) => { x.participant_day_observations[0]!.method_profile_id = "foreign-profile"; },
      (x) => { x.participant_day_observations[0]!.day_observation_id = " "; },
      (x) => { x.participant_day_observations[0]!.participant_id = " "; },
      (x) => { x.participant_day_observations[0]!.referenced_day_token = " "; },
      (x) => Reflect.deleteProperty(x.participant_day_observations[0]!, "referenced_day_token"),
      (x) => Reflect.set(x.participant_day_observations[0]!, "referenced_day_token", 0),
      (x) => { x.participant_day_observations[0]!.observed_property = ""; },
      (x) => Reflect.set(x.participant_day_observations[0]!, "day_record_origin", "authentic_source"),
      (x) => Reflect.set(x.participant_day_observations[0]!, "day_observation_kind", "notification_item"),
      (x) => Reflect.set(x.participant_day_observations[0]!, "day_observation_value_json", 0),
      (x) => { x.participant_day_observations[0]!.day_observation_value_json = "NaN"; },
      (x) => Reflect.set(x.participant_day_observations[0]!, "evidence_unit", false),
      (x) => Reflect.set(x.participant_day_observations[0]!, "observation_category", []),
      (x) => Reflect.set(x.participant_day_observations[2]!, "questionnaire_item_label", false),
      (x) => { x.participant_day_observations[0]!.source_locators = []; },
      (x) => { x.participant_day_observations[0]!.source_locators = [" "]; },
      (x) => Reflect.set(x.participant_day_observations[0]!, "unreported_raw_day_key", "invented"),
      (x) => { x.participant_day_observations.push(structuredClone(x.participant_day_observations[0]!)); },
      (x) => { x.participant_day_observations[0]!.aggregate_observation_references = []; },
      (x) => { x.participant_day_observations[0]!.questionnaire_item_label = null; },
      (x) => Reflect.set(x.participant_day_observations[2]!, "aggregate_observation_references", "daily-email-count"),
      (x) => Reflect.set(x.participant_day_observations[2]!, "aggregate_observation_references", [false]),
      (x) => { x.participant_day_observations[2]!.aggregate_observation_references = ["daily-email-count", "daily-email-count"]; },
      (x) => { x.participant_day_observations[2]!.aggregate_observation_references = ["reported-stress"]; },
      (x) => { x.participant_day_observations[2]!.aggregate_observation_references = ["missing"]; },
      (x) => { x.participant_day_observations[2]!.participant_id = "another-participant"; },
      (x) => { x.participant_day_observations[2]!.referenced_day_token = "example:prior-day-2-not-a-date"; },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const invalid = structuredClone(input);
      mutate(invalid);
      expect(() => parseStudyMethodProfileLibrary(invalid), `participant-day mutant ${index}`).toThrow();
    }
    const otherProfile = structuredClone(input);
    otherProfile.profiles.push({ ...structuredClone(input.profiles[0]!), method_profile_id: "other-day-profile" });
    otherProfile.participant_day_observations[2]!.method_profile_id = "other-day-profile";
    expect(() => parseStudyMethodProfileLibrary(otherProfile)).toThrow("within profile/participant/referenced period");
  });

  it("preserves one shared opening, distinct equal-time openings and supplied pending memberships", async () => {
    const input = notificationOpeningExample();
    const library = parseStudyMethodProfileLibrary(input);
    await saveResearchMethodSelection(JSON.stringify({ profile: library.profiles[0],
      notification_histories: library.notification_histories, notification_opening_occurrences: library.notification_opening_occurrences }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile],
      notification_histories: saved.notification_histories, notification_opening_occurrences: saved.notification_opening_occurrences });
    expect(restored.notification_histories).toEqual(input.notification_histories);
    expect(restored.notification_opening_occurrences).toEqual(input.notification_opening_occurrences);
    expect(restored.notification_opening_occurrences).toHaveLength(6);
    expect(restored.notification_histories!.slice(0, 2).map((h) => h.notification_evidence[0]!.opening_occurrence_reference)).toEqual(["app-opening-1", "app-opening-1"]);
    expect(restored.notification_opening_occurrences!.slice(0, 2).map((o) => o.occurrence_instant)).toEqual(["equal-supplied-opening-time", "equal-supplied-opening-time"]);
    expect(restored.notification_opening_occurrences![0]!.pending_history_references).toEqual(["example-history-2", "example-history-1"]);
    expect(restored.notification_opening_occurrences![3]!.pending_history_references).toEqual([]);
    expect(restored.notification_opening_occurrences![4]!.pending_history_references).toBeNull();
    expect(Object.hasOwn(restored.notification_opening_occurrences![5]!, "pending_history_references")).toBe(false);
    expect(compileNativeMethodProfile(restored.profiles[0]!).ok).toBe(false);
    const variant = structuredClone(input);
    variant.notification_histories[0]!.notification_evidence[0]!.evidence_instant = "independent-view-time";
    variant.notification_histories[0]!.notification_evidence[0]!.evidence_references = [];
    variant.notification_histories[1]!.notification_evidence[0]!.evidence_kind = "seen_latency";
    variant.notification_histories[1]!.notification_evidence[0]!.evidence_value_json = "0.00";
    Reflect.set(variant.notification_opening_occurrences[0]!, "app_package_name", null);
    Reflect.deleteProperty(variant.notification_opening_occurrences[4]!, "device_id");
    Reflect.set(variant.notification_histories[2]!.notification_evidence[0]!, "opening_occurrence_reference", null);
    Reflect.deleteProperty(variant.notification_histories[0]!.notification_evidence[1]!, "opening_occurrence_reference");
    const changed = parseStudyMethodProfileLibrary(variant);
    await saveResearchMethodSelection(JSON.stringify({ profile: changed.profiles[0],
      notification_histories: changed.notification_histories, notification_opening_occurrences: changed.notification_opening_occurrences }));
    const again = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    const variantReload = parseStudyMethodProfileLibrary({ profiles: [again.profile],
      notification_histories: again.notification_histories, notification_opening_occurrences: again.notification_opening_occurrences });
    expect(variantReload.notification_histories).toEqual(variant.notification_histories);
    expect(variantReload.notification_opening_occurrences).toEqual(variant.notification_opening_occurrences);
    expect(parseStudyMethodProfileLibrary({ profiles: input.profiles }).notification_opening_occurrences).toBeUndefined();
    expect(parseStudyMethodProfileLibrary({ profiles: input.profiles, notification_opening_occurrences: [] }).notification_opening_occurrences).toEqual([]);
  });

  it("rejects malformed shared openings and links without positive known-device membership", () => {
    const input = notificationOpeningExample();
    const mutations: Array<(x: typeof input) => void> = [
      (x) => Reflect.set(x, "notification_opening_occurrences", null),
      (x) => Reflect.set(x.notification_opening_occurrences, "0", null),
      (x) => { x.notification_opening_occurrences[0]!.source_work_id = "foreign-work"; },
      (x) => { x.notification_opening_occurrences[0]!.method_profile_id = "foreign-profile"; },
      (x) => { x.notification_opening_occurrences[0]!.participant_id = "foreign-participant"; },
      (x) => { x.notification_opening_occurrences[0]!.opening_occurrence_id = ""; },
      (x) => Reflect.set(x.notification_opening_occurrences[0]!, "opening_kind", "corresponding_app_launch"),
      (x) => Reflect.set(x.notification_opening_occurrences[0]!, "opening_record_origin", "authentic_source"),
      (x) => Reflect.set(x.notification_opening_occurrences[0]!, "occurrence_instant", 0),
      (x) => Reflect.set(x.notification_opening_occurrences[0]!, "app_package_name", false),
      (x) => { x.notification_opening_occurrences[0]!.app_package_name = "foreign-app"; },
      (x) => Reflect.set(x.notification_opening_occurrences[2]!, "app_package_name", "invented-drawer-app"),
      (x) => { x.notification_opening_occurrences[0]!.device_id = "foreign-device"; },
      (x) => { x.notification_opening_occurrences[0]!.device_id = " "; },
      (x) => { x.notification_opening_occurrences[0]!.device_id = null; },
      (x) => Reflect.deleteProperty(x.notification_opening_occurrences[0]!, "device_id"),
      (x) => { x.notification_histories[0]!.device_id = null; },
      (x) => Reflect.deleteProperty(x.notification_histories[0]!, "device_id"),
      (x) => Reflect.set(x.notification_opening_occurrences[0]!, "pending_history_references", "example-history-1"),
      (x) => Reflect.set(x.notification_opening_occurrences[0]!, "pending_history_references", [false]),
      (x) => Reflect.set(x.notification_opening_occurrences[0]!, "pending_history_references", ["example-history-1", "example-history-1"]),
      (x) => Reflect.set(x.notification_opening_occurrences[0]!, "pending_history_references", ["missing"]),
      (x) => Reflect.set(x.notification_opening_occurrences[0]!, "pending_history_references", ["example-history-1"]), // Linked history2 not a member.
      (x) => Reflect.set(x.notification_opening_occurrences[0]!, "pending_history_references", []),
      (x) => Reflect.set(x.notification_opening_occurrences[0]!, "pending_history_references", null),
      (x) => Reflect.deleteProperty(x.notification_opening_occurrences[0]!, "pending_history_references"),
      (x) => { x.notification_opening_occurrences[0]!.source_locators = []; },
      (x) => Reflect.set(x.notification_opening_occurrences[0]!, "raw_item_key", "invented"),
      (x) => { x.notification_opening_occurrences.push(structuredClone(x.notification_opening_occurrences[0]!)); },
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[0]!, "opening_occurrence_reference", "missing"),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[0]!, "opening_occurrence_reference", false),
      (x) => { x.notification_histories[0]!.notification_evidence[0]!.evidence_kind = "arrival"; },
      (x) => { x.notification_histories[0]!.notification_evidence[0]!.evidence_role = "recorded"; },
      (x) => Reflect.deleteProperty(x, "notification_opening_occurrences"),
    ];
    for (const [index, mutate] of mutations.entries()) {
      const invalid = structuredClone(input);
      mutate(invalid);
      expect(() => parseStudyMethodProfileLibrary(invalid), `shared opening mutant ${index}`).toThrow();
    }
    const foreignOwner = structuredClone(input);
    foreignOwner.profiles.push({ ...structuredClone(input.profiles[0]!), method_profile_id: "other-profile" });
    foreignOwner.notification_opening_occurrences[0]!.method_profile_id = "other-profile";
    expect(() => parseStudyMethodProfileLibrary(foreignOwner)).toThrow("matching history within profile/participant/known device");
  });

  it("preserves shared participant/title labels independently of per-item category and withheld titles", async () => {
    const input = notificationTitleAnnotationExample();
    const library = parseStudyMethodProfileLibrary(input);
    await saveResearchMethodSelection(JSON.stringify({ profile: library.profiles[0],
      notification_histories: library.notification_histories, notification_title_annotations: library.notification_title_annotations }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile],
      notification_histories: saved.notification_histories, notification_title_annotations: saved.notification_title_annotations });
    expect(restored.notification_histories).toEqual(input.notification_histories);
    expect(restored.notification_title_annotations).toEqual(input.notification_title_annotations);
    expect(restored.notification_histories).toHaveLength(4); // Unique title list is not item deduplication.
    expect(restored.notification_histories![0]!.title_annotation_reference).toBe(restored.notification_histories![1]!.title_annotation_reference);
    expect(restored.notification_histories!.map((h) => h.notification_evidence[1]!.evidence_value_json)).toEqual(['"work"', '"social"', '"family"', "null"]);
    expect(restored.notification_title_annotations![0]!.sender_relationship_labels).toEqual(["work", "social"]);
    expect(restored.notification_title_annotations![1]!.sender_relationship_labels).toEqual(["family"]);
    expect(restored.notification_title_annotations![2]!.notification_title).toBeNull();
    expect(compileNativeMethodProfile(restored.profiles[0]!).ok).toBe(false);
    const variant = structuredClone(input);
    Reflect.deleteProperty(variant.notification_title_annotations[2]!, "notification_title");
    variant.notification_title_annotations[0]!.sender_relationship_labels.reverse();
    Reflect.set(variant.notification_histories[0]!, "device_id", "another-device");
    Reflect.set(variant.notification_histories[1]!, "app_package_name", "another-app");
    // Supplied association is not verified title equality or a computed category.
    variant.notification_histories[1]!.notification_title = "DIFFERENT supplied title";
    variant.notification_histories[1]!.notification_evidence[1]!.evidence_value_json = '"conflicting-supplied-category"';
    const changed = parseStudyMethodProfileLibrary(variant);
    await saveResearchMethodSelection(JSON.stringify({ profile: changed.profiles[0],
      notification_histories: changed.notification_histories, notification_title_annotations: changed.notification_title_annotations }));
    const again = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    const variantReload = parseStudyMethodProfileLibrary({ profiles: [again.profile], notification_histories: again.notification_histories,
      notification_title_annotations: again.notification_title_annotations });
    expect(variantReload.notification_histories).toEqual(variant.notification_histories);
    expect(variantReload.notification_title_annotations).toEqual(variant.notification_title_annotations);
    Reflect.set(variant.notification_histories[0]!, "title_annotation_reference", null);
    Reflect.deleteProperty(variant.notification_histories[1]!, "title_annotation_reference");
    expect(parseStudyMethodProfileLibrary(variant).notification_histories).toEqual(variant.notification_histories);
    expect(parseStudyMethodProfileLibrary({ profiles: input.profiles }).notification_title_annotations).toBeUndefined();
    expect(parseStudyMethodProfileLibrary({ profiles: input.profiles, notification_title_annotations: [] }).notification_title_annotations).toEqual([]);
  });

  it("rejects malformed shared annotations and missing or cross-participant links", () => {
    const input = notificationTitleAnnotationExample();
    const mutations: Array<(x: typeof input) => void> = [
      (x) => Reflect.set(x, "notification_title_annotations", null),
      (x) => Reflect.set(x.notification_title_annotations, "0", null),
      (x) => { x.notification_title_annotations[0]!.source_work_id = "foreign-work"; },
      (x) => { x.notification_title_annotations[0]!.method_profile_id = "foreign-profile"; },
      (x) => { x.notification_title_annotations[0]!.participant_id = ""; },
      (x) => { x.notification_title_annotations[0]!.title_annotation_id = ""; },
      (x) => Reflect.set(x.notification_title_annotations[0]!, "notification_title", false),
      (x) => { x.notification_title_annotations[0]!.sender_relationship_labels = []; },
      (x) => { x.notification_title_annotations[0]!.sender_relationship_labels = ["work", "work"]; },
      (x) => { x.notification_title_annotations[0]!.sender_relationship_labels = [" "]; },
      (x) => Reflect.set(x.notification_title_annotations[0]!, "sender_relationship_labels", "work"),
      (x) => { x.notification_title_annotations[0]!.source_locators = []; },
      (x) => Reflect.set(x.notification_title_annotations[0]!, "annotation_record_origin", "authentic_source"),
      (x) => Reflect.set(x.notification_title_annotations[0]!, "unreported_raw_key", "invented"),
      (x) => { x.notification_title_annotations.push(structuredClone(x.notification_title_annotations[0]!)); },
      (x) => { x.notification_histories[0]!.title_annotation_reference = "missing"; },
      (x) => { x.notification_histories[2]!.title_annotation_reference = "example-unranked-label"; },
      (x) => Reflect.set(x.notification_histories[0]!, "title_annotation_reference", 1),
      (x) => Reflect.deleteProperty(x, "notification_title_annotations"),
    ];
    for (const [index, mutate] of mutations.entries()) {
      const invalid = structuredClone(input);
      mutate(invalid);
      expect(() => parseStudyMethodProfileLibrary(invalid), `annotation mutant ${index}`).toThrow();
    }
    const otherOwner = structuredClone(input);
    otherOwner.profiles.push({ ...structuredClone(input.profiles[0]!), method_profile_id: "other-profile" });
    otherOwner.notification_title_annotations[0]!.method_profile_id = "other-profile";
    expect(() => parseStudyMethodProfileLibrary(otherOwner)).toThrow("matching profile/participant annotation");
  });

  it("preserves item context boundaries separately from preceding-minute feature windows", async () => {
    const input = notificationContextExample();
    const library = parseStudyMethodProfileLibrary(input);
    for (const profile of library.profiles) {
      const histories = library.notification_histories!.filter((h) => h.method_profile_id === profile.method_profile_id);
      await saveResearchMethodSelection(JSON.stringify({ profile, notification_histories: histories }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
      const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], notification_histories: saved.notification_histories });
      expect(restored.notification_histories).toEqual(histories);
      expect(compileNativeMethodProfile(restored.profiles[0]!).ok).toBe(false);
    }
    const context = library.notification_histories![0]!.notification_evidence.filter((e) => e.evidence_kind === "context");
    expect(context).toHaveLength(12);
    expect(context.filter((e) => e.context_sampling_boundary === "arrival")).toHaveLength(6);
    expect(context.filter((e) => e.context_sampling_boundary === "removal")).toHaveLength(6);
    expect(context.filter((e) => e.observed_property === "Surrounding light intensity").map((e) => e.evidence_value_json)).toEqual(["0", "10"]);
    const unknownContext = library.notification_histories![2]!.notification_evidence.filter((e) => e.evidence_kind === "context");
    expect(unknownContext.every((e) => e.context_sampling_boundary === "source_unreported")).toBe(true);
    expect(unknownContext.filter((e) => e.lookback === "last one minute").map((e) => e.observed_property)).toEqual(["Proximity", "Phone's status"]);
    expect(unknownContext.every((e) => !Object.hasOwn(e, "evidence_instant") && !Object.hasOwn(e, "evidence_references"))).toBe(true);
    expect(unknownContext.find((e) => e.observed_property === "Ringer mode")?.evidence_value_json).toBe('"LED"');
    expect(unknownContext.find((e) => e.observed_property === "Surrounding sound")?.evidence_value_json).toBe("false");
    for (const token of ["false", '"false"', "0", "0.00", '""', "null"]) {
      const variant = structuredClone(input);
      const sample = variant.notification_histories[0]!.notification_evidence.find((e) => e.evidence_kind === "context")!;
      sample.evidence_value_json = token;
      sample.evidence_instant = "independently-supplied-token";
      sample.evidence_unit = null;
      sample.lookback = null;
      const saved = parseStudyMethodProfileLibrary(variant);
      await saveResearchMethodSelection(JSON.stringify({ profile: saved.profiles[0], notification_histories: saved.notification_histories!.slice(0, 2) }));
      const reload = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
      expect(parseStudyMethodProfileLibrary({ profiles: [reload.profile], notification_histories: reload.notification_histories }).notification_histories)
        .toEqual(variant.notification_histories.slice(0, 2));
    }
    const unknownValue = structuredClone(input);
    const sample = unknownValue.notification_histories[0]!.notification_evidence.find((e) => e.evidence_kind === "context")!;
    sample.evidence_value_json = null;
    sample.evidence_references = null;
    expect(parseStudyMethodProfileLibrary(unknownValue).notification_histories).toEqual(unknownValue.notification_histories);
    Reflect.deleteProperty(sample, "evidence_value_json");
    expect(parseStudyMethodProfileLibrary(unknownValue).notification_histories).toEqual(unknownValue.notification_histories);
    sample.evidence_references = ["arrival", "arrival-context-1", "removal"];
    sample.evidence_role = "inferred";
    // Supporting provenance is not an exclusive time anchor. Do not infer or
    // overwrite the declared sampling boundary from these mixed supports.
    const mixedSupport = parseStudyMethodProfileLibrary(unknownValue);
    await saveResearchMethodSelection(JSON.stringify({ profile: mixedSupport.profiles[0], notification_histories: mixedSupport.notification_histories!.slice(0, 2) }));
    const reloaded = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    expect(parseStudyMethodProfileLibrary({ profiles: [reloaded.profile], notification_histories: reloaded.notification_histories }).notification_histories)
      .toEqual(unknownValue.notification_histories.slice(0, 2));
  });

  it("rejects malformed context, foreign support and boundary substitution without inventing sampling", () => {
    const input = notificationContextExample();
    const mutations: Array<(row: Record<string, unknown>) => void> = [
      (r) => Reflect.deleteProperty(r, "observed_property"),
      (r) => { r.observed_property = false; },
      (r) => { r.observed_property = ""; },
      (r) => Reflect.deleteProperty(r, "context_sampling_boundary"),
      (r) => { r.context_sampling_boundary = null; },
      (r) => { r.context_sampling_boundary = "seen"; },
      (r) => { r.lookback = 60; },
      (r) => { r.evidence_value_json = false; },
      (r) => { r.evidence_value_json = "{"; },
      (r) => { r.evidence_references = ["inferred-clicked"]; }, // Other item.
      (r) => { r.evidence_references = ["arrival", "arrival"]; },
      (r) => { r.evidence_references = [r.evidence_record_id]; },
      (r) => { r.evidence_record_id = "arrival"; },
      (r) => { r.source_locators = []; },
      (r) => { r.evidence_kind = "arrival"; }, // Context fields cannot decorate an event instead.
      (r) => { r.source_work_id = "foreign-work"; },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const invalid = structuredClone(input);
      mutate(invalid.notification_histories[0]!.notification_evidence.find((e) => e.evidence_kind === "context")!);
      expect(() => parseStudyMethodProfileLibrary(invalid), `malformed context ${index}`).toThrow();
    }
  });

  it("round-trips notification evidence, linked questionnaire answers and acceptance without conflating them", async () => {
    const input = notificationHistoryExample();
    const persist = async (value: unknown) => {
      const library = parseStudyMethodProfileLibrary(value);
      await saveResearchMethodSelection(JSON.stringify({ profile: library.profiles[0], selectedLevels: {},
        notification_histories: library.notification_histories }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
      return parseStudyMethodProfileLibrary({ profiles: [saved.profile],
        ...(saved.notification_histories !== undefined ? { notification_histories: saved.notification_histories } : {}) });
    };
    const restored = await persist(input);
    expect(restored.notification_histories).toEqual(input.notification_histories);
    const first = restored.notification_histories![0]!;
    expect(first.notification_evidence.find((row) => row.evidence_kind === "dismissed")).toMatchObject({ evidence_value_json: "true" });
    expect(first.acceptance_records![0]).toMatchObject({ acceptance_code: 1,
      evidence_references: ["dismissal-status"], questionnaire_response_references: ["initial-handling"] });
    expect(first.notification_title).toBe("");
    expect(first).not.toHaveProperty("device_id");
    const second = restored.notification_histories![1]!;
    expect(second.notification_title).toBeNull();
    expect(second.notification_evidence.map((row) => row.evidence_kind)).toEqual(["arrival", "seen_latency"]);
    expect(second.notification_evidence[1]).toMatchObject({ evidence_value_json: "0", evidence_references: [] });
    expect(second).not.toHaveProperty("questionnaire_responses");
    expect(second).not.toHaveProperty("acceptance_records");
    expect(compileNativeMethodProfile(restored.profiles[0]!).ok).toBe(false);
    for (const token of ["false", "0", "null", '""', '"false"', "0.00", "[true, false]"]) {
      const variant = structuredClone(input);
      Reflect.set(variant.notification_histories[0]!.notification_evidence[4]!, "evidence_value_json", token);
      expect((await persist(variant)).notification_histories![0]!.notification_evidence[4]!.evidence_value_json).toBe(token);
    }
    const variant = structuredClone(input);
    const history = variant.notification_histories[0]!;
    Reflect.set(history, "device_id", null);
    Reflect.set(history.notification_evidence[3]!, "evidence_instant", null);
    Reflect.set(history.notification_evidence[3]!, "evidence_basis", null); // Supplied unknown, not filled from the paper.
    history.notification_evidence.reverse(); // No timestamp sort, chronology repair or action matching.
    history.acceptance_records![0]!.acceptance_code = 0; // Preserve a supplied conflict; do not apply the recipe.
    expect((await persist(variant)).notification_histories).toEqual(variant.notification_histories);
    const unknown = structuredClone(input);
    unknown.notification_histories[0]!.questionnaire_responses = null;
    unknown.notification_histories[0]!.acceptance_records![0]!.questionnaire_response_references = null;
    unknown.notification_histories[0]!.notification_evidence[3]!.evidence_references = null;
    unknown.notification_histories[0]!.notification_evidence[4]!.evidence_value_json = null;
    unknown.notification_histories[1]!.acceptance_records = null;
    expect((await persist(unknown)).notification_histories).toEqual(unknown.notification_histories);
    for (const kind of ["notification_bar_click", "corresponding_app_launch", "swipe_dismiss"] as const) {
      const channel = structuredClone(input);
      channel.notification_histories[0]!.notification_evidence.push({ evidence_record_id: "reaction-channel",
        evidence_kind: kind, evidence_role: "recorded", evidence_instant: "supplied-reaction-time-token",
        source_locators: ["My Phone and Me PDF p.3 Reasoning, txt165-169"] });
      expect((await persist(channel)).notification_histories).toEqual(channel.notification_histories);
    }
    const clicked = structuredClone(input);
    const clickedHistory = clicked.notification_histories[0]!;
    Reflect.set(clickedHistory.notification_evidence[4]!, "evidence_kind", "clicked");
    Reflect.deleteProperty(clickedHistory, "questionnaire_responses");
    Reflect.deleteProperty(clickedHistory.acceptance_records![0]!, "questionnaire_response_references");
    expect((await persist(clicked)).notification_histories).toEqual(clicked.notification_histories);
    const noAnswer = structuredClone(input);
    Reflect.deleteProperty(noAnswer.notification_histories[0]!, "questionnaire_responses");
    Reflect.deleteProperty(noAnswer.notification_histories[0]!, "acceptance_records");
    expect((await persist(noAnswer)).notification_histories![0]).not.toHaveProperty("acceptance_records");
    expect((await persist({ profiles: input.profiles })).notification_histories).toBeUndefined();
    expect((await persist({ ...input, notification_histories: [] })).notification_histories).toEqual([]);
  });

  it("rejects malformed notification-history ingress without silently dropping or coercing nested records", () => {
    const input = notificationHistoryExample();
    const mutations: Array<(x: typeof input) => void> = [
      (x) => Reflect.set(x, "notification_histories", null),
      (x) => Reflect.set(x.notification_histories, "0", null),
      (x) => { x.notification_histories[0]!.source_work_id = "foreign-work"; },
      (x) => { x.notification_histories[0]!.method_profile_id = "foreign-profile"; },
      (x) => Reflect.deleteProperty(x.notification_histories[0]!, "notification_item_id"),
      (x) => Reflect.set(x.notification_histories[0]!, "device_id", false),
      (x) => Reflect.set(x.notification_histories[0]!, "device_id", ""),
      (x) => Reflect.set(x.notification_histories[0]!, "history_record_origin", "original_source_export"),
      (x) => Reflect.set(x.notification_histories[0]!, "notification_title", false),
      (x) => Reflect.set(x.notification_histories[0]!, "source_locators", []),
      (x) => Reflect.set(x.notification_histories[0]!, "source_locators", [" "]),
      (x) => Reflect.deleteProperty(x.notification_histories[0]!, "notification_evidence"),
      (x) => Reflect.set(x.notification_histories[0]!, "notification_evidence", [null]),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[0]!, "source_locators", [4]),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[0]!, "evidence_kind", "observed_attention"),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[3]!, "evidence_role", "recorded"),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[0]!, "evidence_instant", 0),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[0]!, "evidence_basis", {}),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[4]!, "evidence_value_json", false),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[4]!, "evidence_value_json", "{"),
      (x) => { x.notification_histories[0]!.notification_evidence[1]!.evidence_record_id = "arrival"; },
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[3]!, "evidence_references", "unlock"),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[3]!, "evidence_references", ["arrival", "arrival"]),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[3]!, "evidence_references", ["assumed-seen"]),
      (x) => Reflect.set(x.notification_histories[0]!.notification_evidence[3]!, "notification_item_id", "another-item"),
      (x) => Reflect.set(x.notification_histories[0]!, "questionnaire_responses", ["not-a-record"]),
      (x) => Reflect.set(x.notification_histories[0]!.questionnaire_responses![0]!, "response_value_json", "undefined"),
      (x) => Reflect.set(x.notification_histories[0]!.questionnaire_responses![0]!, "questionnaire_item_label", ""),
      (x) => Reflect.set(x.notification_histories[0]!, "acceptance_records", "unknown"),
      (x) => Reflect.set(x.notification_histories[0]!.acceptance_records![0]!, "acceptance_code", true),
      (x) => Reflect.set(x.notification_histories[0]!.acceptance_records![0]!, "acceptance_code", "1"),
      (x) => Reflect.set(x.notification_histories[0]!.acceptance_records![0]!, "acceptance_code", 2),
      (x) => Reflect.deleteProperty(x.notification_histories[0]!.acceptance_records![0]!, "evidence_references"),
      (x) => Reflect.set(x.notification_histories[0]!.acceptance_records![0]!, "questionnaire_response_references", ["foreign-response"]),
      (x) => Reflect.set(x.notification_histories[0]!.acceptance_records![0]!, "evidence_references", ["initial-handling"]),
      (x) => Reflect.set(x.notification_histories[0]!.acceptance_records![0]!, "questionnaire_response_references", ["arrival"]),
      (x) => { x.notification_histories.push(structuredClone(x.notification_histories[0]!)); },
      (x) => { x.notification_histories[1]!.notification_item_id = "example-item-1"; },
      (x) => Reflect.set(x.notification_histories[1]!.notification_evidence[1]!, "evidence_references", ["unlock"]),
    ];
    for (const [index, mutate] of mutations.entries()) {
      const invalid = structuredClone(input);
      mutate(invalid);
      expect(() => parseStudyMethodProfileLibrary(invalid), `malformed history case ${index}`).toThrow();
    }
  });

  it("keeps normalized notification identity and supporting references owner-local rather than matching app or time", () => {
    const input = notificationHistoryExample();
    const library = parseStudyMethodProfileLibrary(input);
    expect(library.notification_histories?.map((row) => row.notification_item_id)).toEqual(["example-item-1", "example-item-2"]);
    const anotherOwner = structuredClone(input);
    const secondProfile = structuredClone(input.profiles[0]!);
    secondProfile.method_profile_id = "example:another-profile";
    anotherOwner.profiles.push(secondProfile);
    for (const delta of [{ participant_id: "another-participant" }, { device_id: "another-device" },
      { method_profile_id: "example:another-profile" }]) {
      const duplicate = { ...structuredClone(input.notification_histories[0]!), ...delta };
      anotherOwner.notification_histories.push(duplicate);
    }
    expect(parseStudyMethodProfileLibrary(anotherOwner).notification_histories).toHaveLength(5);
    const sameUnknownDevice = structuredClone(input);
    sameUnknownDevice.notification_histories.push({ ...structuredClone(input.notification_histories[0]!), device_id: null });
    expect(() => parseStudyMethodProfileLibrary(sameUnknownDevice)).toThrow("duplicated within profile/participant/device");
  });

  itWithPrivateCorpus.each([
    ["abdullah-2016-cognitive-rhythms", "doi:10.1145/2971648.2971712", 79, 18],
    ["hiniker-2016-why-would-you-do-that", "doi:10.1145/2971648.2971762", 79, 16],
    ["okoshi-2015-attelia2", "doi:10.1145/2750858.2807517", 49, 22],
    ["murnane-2016-mobile-alertness", "doi:10.1145/2935334.2935383", 62, 20],
    ["prefminer-notification-management", "doi:10.1145/2971648.2971747", 45, 12],
    ["okoshi-2017-attention-engagement", "doi:10.1109/percom.2017.7917856", 39, 14],
    ["my-phone-and-me", "doi:10.1145/2858036.2858566", 75, 21],
    ["content-driven-notification-management", "doi:10.1145/2750858.2807544", 55, 26],
    ["in-situ-notifications", "doi:10.1145/2628363.2628364", 57, 15],
    ["large-scale-notifications", "doi:10.1145/2556288.2557189", 45, 23],
    ["reachable-not-receptive", "doi:10.1016/j.pmcj.2017.01.011", 35, 20],
    ["call-availability", "doi:10.1145/2632048.2632060", 61, 18],
    ["falaki-diversity-smartphone-usage", "doi:10.1145/1814433.1814453", 78, 27],
    ["mercati-date2014-process-allocation", "source-ref:22c0acbc687e7ae7f40e", 15, 7],
    ["rodrigues-2022-text-entry", "doi:10.1145/3491102.3501908", 40, 11, 2],
  ] as const)("preserves every reviewed definition and scoped dependency for %s", async (name, sourceWorkId, settings, operations, metadataRecords: number = 1) => {
    const audit = JSON.parse(readFileSync(privateCorpusPath(`ontology-sublation-20260831/post-freeze-source-audits/${name}.json`), "utf8")) as {
      disclosed_atoms: Array<{ key: string; value: unknown; canonical_role: string; canonical_target: string; locator: string;
        projection_disposition: string; role: string; method_unit?: string; method_comparator?: string; method_boundary_convention?: string }>;
      method_operations: Array<Record<string, unknown>>;
      session_construction_policies?: Array<{ session_construction_policy_id: string; session_input_layer: string;
        session_output_layer: string; method_setting_keys: string[] }>;
    };
    const profile = parseStudyMethodProfileLibrary({ profiles: [rawProfiles().find((row) => row.source_work_id === sourceWorkId)] }).profiles[0]!;
    const space = profile.method_configuration_space as {
      invariant_method_setting_ids: string[]; method_configuration_groups: Array<Record<string, unknown>>;
    };
    expect(profile.method_settings).toHaveLength(settings);
    expect(audit.disclosed_atoms).toHaveLength(settings + metadataRecords);
    for (const atom of audit.disclosed_atoms) {
      if (atom.projection_disposition === "configuration_metadata") {
        const group = space.method_configuration_groups.find((g) => (g.method_configuration_axis as string[]).includes(atom.key))!;
        expect(JSON.parse(String(group.method_selection_semantics))).toEqual({ key: atom.key, value: atom.value });
        expect((group.source_locators as string[]).map((s) => decodeURIComponent(s.split("#audit-locator=")[1]!))).toContain(atom.locator);
        continue;
      }
      const members = profile.method_settings.filter((s) => s.method_parameter_key === atom.key);
      expect(members).toHaveLength(1);
      const setting = members[0]!;
      expect(JSON.parse(String(setting.method_value_json))).toEqual(atom.value);
      expect(setting.method_setting_role).toBe(atom.canonical_role);
      expect(setting.method_target_layer).toBe(atom.canonical_target);
      expect(setting.method_unit).toBe(atom.method_unit);
      expect(setting.method_comparator).toBe(atom.method_comparator);
      expect(setting.method_boundary_convention).toBe(atom.method_boundary_convention);
      expect((setting.source_locators as string[]).map((s) => decodeURIComponent(s.split("#audit-locator=")[1]!))).toContain(atom.locator);
      expect(setting.contract_bindings).toEqual([]);
      if (atom.role === "release_provenance") {
        expect(setting).toMatchObject({ method_implementation_status: "native", method_execution_route: "receipt_conformance",
          method_execution_destination_id: "chronicle.profile-protocol-documentary-registry" });
      } else if (admittedAndroidCalculationReceipts[setting.method_setting_id]) {
        expectAdmittedAndroidCalculationReceipt(setting);
      } else expect(setting.method_implementation_status).toBe("specification_only");
      if (["reported_result", "evidence_gap", "evidence_conflict"].includes(atom.role)) expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
    }
    expect(profile.method_operations).toEqual(audit.method_operations);
    expect(profile.method_operations).toHaveLength(operations);
    const policies = (profile.session_construction_policies ?? []) as Array<Record<string, unknown>>;
    expect(policies).toHaveLength(audit.session_construction_policies?.length ?? 0);
    for (const [i, expected] of (audit.session_construction_policies ?? []).entries()) {
      const policy = policies[i]!;
      expect(policy).toMatchObject({ session_construction_policy_id: expected.session_construction_policy_id,
        session_input_layer: expected.session_input_layer, session_output_layer: expected.session_output_layer });
      expect(policy).not.toHaveProperty("reconstruction_strategy");
      expect(policy.method_settings).toEqual(expected.method_setting_keys.map((key) => profile.method_settings.find((s) => s.method_parameter_key === key)));
    }
    expect(space.method_configuration_groups.filter(requiresConfigurationSelection)).toHaveLength(0);
    expect(enumerateMethodConfigurations(profile)).toMatchObject({ ok: true, selections: [expect.anything()] });
    const value = (key: string) => JSON.parse(String(profile.method_settings.find((s) => s.method_parameter_key === key)!.method_value_json)) as Record<string, unknown>;
    const ops = new Map((profile.method_operations as Array<Record<string, unknown>>).map((o) => [o.operation_id, o]));
    if (name === "call-availability") {
      const definition = (key: string) => value(key).definition as Record<string, unknown>;
      for (const key of ["feature.time_since_last_plug_change", "feature.time_since_last_screen_change"]) {
        expect(definition(key)).toMatchObject({ temporal_representation: null, unit: null, clock: null });
        expect(definition(key)).not.toHaveProperty("elapsed_since");
      }
      expect(definition("intervention.shake_calibration_window")).toMatchObject({ first_seconds_of_each_call: 2,
        exact_timer_boundary: null, serialized_maximum: null });
      expect(definition("intervention.shake_threshold_and_mute")).toMatchObject({ comparator: ">", restoration: null,
        availability_predictor_drives_mute: false });
      expect(definition("analysis.personalized_call_count_arms").per_user_model_dataset_call_counts)
        .toEqual(Array.from({ length: 19 }, (_, i) => (i + 1) * 10));
      expect(definition("analysis.personalized_cross_validation")).toMatchObject({ folds: 10, generic_holdout_inherited: false,
        exact_predictor_membership: null });
      expect(definition("result.personalized_at_120_calls")).toMatchObject({ per_user_model_dataset_calls: 120,
        accuracy_percent: 87.02, generic_comparator_kappa_printed: .64, personalized_kappa: null });
      expect(definition("result.personalized_at_120_calls").kappa_relation).toContain("exceeded");
      expect(definition("result.generic_confusion_matrix").cells).toEqual([[3364, 480], [569, 1849]]);
      expect(definition("result.all_feature_ranks").rows).toHaveLength(15);
      expect(ops.get("call.conditionally_mute")!.depends_on).toEqual(["call.calibrate_mute_eligibility"]);
      expect(ops.get("call.record_handling")!.depends_on).toEqual(["call.observe_incoming"]);
      expect(ops.get("call.derive_binary_proxy")!.depends_on).toEqual(["call.record_handling"]);
      expect(ops.get("call.rank_driven_ablation")!.depends_on).toContain("call.rank_features");
      expect(ops.get("call.personalized_cv")!.configuration_dependencies).not.toContain("analysis.generic_holdout");
      for (const op of profile.method_operations as Array<{ configuration_dependencies: string[] }>) {
        expect(op.configuration_dependencies.some((key) => key.startsWith("result.") || key.startsWith("future."))).toBe(false);
      }
    }
    if (name === "falaki-diversity-smartphone-usage") {
      const definition = (key: string) => value(key).definition as Record<string, unknown>;
      expect(definition("reconstruction.android_interaction_predicate").active_when)
        .toEqual({ operator: "OR", states: ["screen on", "voice call active"] });
      expect(definition("acquisition.android_counter_snapshot").numeric_cadence).toBeNull();
      expect(definition("reconstruction.android_precise_app_session_unavailable").application_session_analysis_platform).toBe("Dataset2 only");
      expect(definition("analysis.session_length_binned_session_counts")).toMatchObject({ platform: "Dataset2 Windows only",
        printed_bins: ["<10", "10–20", "20–30", "30–40", "40–60", ">60"], endpoint_allocation: null });
      expect(definition("analysis.interaction_time_binned_diurnal_ratio").printed_bins)
        .toEqual(["<30", "30–60", "60–90", "90–120", "120–150", "150–200", "200–300", ">300"]);
      expect(definition("feature.energy_drain_variability_by_window").window_minutes).toEqual([10, 60, 120]);
      expect(definition("analysis.energy_prediction_horizons").w_hours).toEqual([1, 2]);
      expect(definition("analysis.generic_prediction_comparator")).toMatchObject({ Windows_users_included: false });
      expect(definition("reporting.session_distribution_ranges").user_mean_session_length_seconds_range).toEqual([10, 250]);
      expect(definition("reporting.session_distribution_ranges")).not.toHaveProperty("pooled_mean_session_length_seconds_range");
      expect(definition("aggregation.daily_interaction_statistics")).toMatchObject({ shown_SD_endpoint: "upper only for visual clarity",
        uncertainty_symmetric: true });
      expect(definition("aggregation.application_category_popularity").pooled_duration_ratio).toBe(false);
      expect(definition("aggregation.energy_drain_statistics").Figure24_gate_universally_applied).toBeNull();
      expect(definition("reporting.trace_application_count_result")).toMatchObject({ reported_range: [10, 90],
        reported_median: 50, median_qualification: "roughly", analysis_filter: false });
      expect(definition("reporting.fitted_parameter_distributions").exact_figure_points).not.toContain("unreleased");
      expect(definition("evidence.source_realization_limits").indispensable_unavailable_facts)
        .toEqual(expect.arrayContaining([expect.stringContaining("confidence intervals")]));
      expect(ops.get("falaki.usage_summaries_checks")!.depends_on).toContain("falaki.traffic_analysis");
      expect(ops.get("falaki.usage_summaries_checks")!.data_effects)
        .toEqual(expect.arrayContaining([expect.stringContaining("applies only to Figure20")]));
      expect(definition("validation.session_stationarity_test").preprocessing_gate).toBe(false);
      expect(definition("reporting.application_popularity_model_mse")).toMatchObject({ MSE_percent_comparator: "<", MSE_percent: 5, users_percent: 95 });
      expect(ops.get("falaki.upload")!.depends_on).toEqual(["falaki.local_store"]);
      expect(ops.get("falaki.mixture_fit")!.depends_on).toEqual(["falaki.interaction_aggregation", "falaki.infer_timeout"]);
      expect(ops.get("falaki.weibull_fit")!.depends_on).toEqual([]);
      for (const id of ["falaki.short_term_predict", "falaki.time_of_day_predict"]) {
        expect(ops.get(id)!.depends_on).toEqual(["falaki.battery_drain"]);
        expect(ops.get(id)!.configuration_dependencies).not.toContain("analysis.trend_table_history_cardinality");
      }
    }
    if (name.startsWith("abdullah")) {
      expect(value("output.chronotype_contrast").definition).not.toHaveProperty("MSF_SC_sd_hours");
      expect(value("output.chronotype_contrast").definition).toHaveProperty("MSF_SC_reported_plus_minus_hours", 0.94);
      expect((value("analysis.sleep_dst_relation").definition as Record<string, unknown>).comparison).toContain("following-day median RRT");
    } else if (name.startsWith("hiniker")) {
      expect(value("session.delimiter.system_launcher_idle").definition).toMatchObject({ state_gate: "system or launcher window", threshold: 30, comparator: ">=", boundary_instant: null });
      expect(value("report.table2_category_share")).toMatchObject({ calculated_sum_of_printed_percentages: 99.6, normalization: "none; printed percentages retained" });
      expect(ops.get("hiniker.category_ablation")!.configuration_dependencies).toEqual(["analysis.category_only_ablation"]);
    } else if (name === "okoshi-2015-attelia2") {
      expect(value("feature.activity_transition_lookup_matrix").breakpoint_predicate).toEqual({ field: "mean", operator: ">", threshold: 5 });
      expect(ops.get("attelia2.share")!.depends_on).toEqual([]);
      expect(ops.get("attelia2.dispatch")!.depends_on).toEqual([]);
      expect(ops.get("attelia2.phase2_assignment")!.depends_on).toEqual(["attelia2.phase1_select"]);
      expect(ops.get("attelia2.phase2_comparison")!.depends_on).toEqual(["attelia2.phase2_assignment", "attelia2.responses", "attelia2.nightly_workload"]);
    } else if (name.startsWith("murnane")) {
      expect(value("window.assessment_surrounding_hour").source_interpretation_limits).toContain("not a session gap");
      expect(ops.get("murnane.baseline_deviation")!.depends_on).toEqual(["murnane.pvt_quality_control"]);
      expect(ops.get("murnane.internal_analysis")!.depends_on).not.toContain("murnane.external_summaries");
      expect(value("output.category_app_and_event_counts").definition).toHaveProperty("Time & Weather.example_apps", ["Clock", "Timely", "Weather Channel"]);
    } else if (name.startsWith("prefminer")) {
      expect(ops.get("prefminer.title_cleaning")!.depends_on).toEqual(["prefminer.reminder_exclusion"]);
      expect(ops.get("prefminer.reminder_exclusion")!.configuration_dependencies).toEqual(["notification.reminder_zero_click_rate"]);
      expect(value("deployment.notification_filter_output").definition).not.toHaveProperty("filter_precision_percent");
      expect(value("report.field_filter_results").definition).toHaveProperty("precision_basis", "every active rule accepted by user");
      expect(value("artifact.code_click_rate_integer_division").source_interpretation_limits).toContain("not evidence it implements");
      expect(value("report.exit_questionnaire_results").definition).toHaveProperty("rows", [{ item: "Q1", mean: 4.25 }, { item: "Q2", mean: 4.33 }, { item: "Q3", mean: 1.58 }]);
    } else if (name === "okoshi-2017-attention-engagement") {
      expect(ops.get("okoshi2017.post_and_stop")!.depends_on).toEqual(["okoshi2017.content_receipt"]);
      expect(value("intervention.one_hour_fallback").source_interpretation_limits).toContain("not response censor");
      expect(value("output.true_breakpoint_activity_distribution").definition).toHaveProperty("diagonal", "blank, not zero");
      expect(value("evidence.daily_access_direction_conflict").definition).toMatchObject({ resolution: null });
    } else if (name === "my-phone-and-me") {
      expect(value("acceptance.esm_recode").definition).toMatchObject({
        clicked_branch: { accepted_code: 1, requires_initial_handling_answer: false },
        dismissed_branch: { initial_handling_no_further_action: 1, other_answered_initial_handling: 0, missing_answer_behavior: null },
      });
      expect(value("esm.daily_schedule").definition).toHaveProperty("not_a_guaranteed_response_count", true);
      expect(value("results.personality_disruption").definition).toMatchObject({
        N: 11, F: { df: [5, 5], value: 2.802, p: 0.01413 },
      });
      expect(value("results.acceptance_logistic_fit").definition).toHaveProperty("author_reported_likelihood_factor_per_unit", 0.581);
      expect(value("acceptance.logistic_model").definition).not.toHaveProperty("reported_odds_multiplier_per_unit");
    } else if (name === "content-driven-notification-management") {
      expect(value("notification.participant_title_annotation_list").definition).toMatchObject({
        deduplication_target: "participant annotation-title list", notification_event_deduplication_disclosed: null,
      });
      expect(value("notification.multilabel_location_resolution").definition).toHaveProperty("relationship_other_fallback", null);
      expect(value("analysis.personal_versus_generic_models").definition).toHaveProperty("training_target_disjointness", null);
      expect(value("report.comparison_plot_shapes").definition).toHaveProperty("figures6_7", "box-and-whisker plots");
      expect(value("report.feature_ranking_table3").definition).toHaveProperty("rows", expect.arrayContaining([["Proximity", 10, 0.017]]));
    } else if (name === "in-situ-notifications") {
      expect(value("notification.view_drawer_bulk_proxy")).toHaveProperty("source_facing_target", "pending_notifications_shown_in_drawer");
      expect(value("notification.view_application_bulk_proxy")).toHaveProperty("source_facing_target", "pending_notifications_for_opened_app");
      expect(value("diary.objective_subjective_day_join").definition).toHaveProperty("join", "participant and referenced prior day");
      expect(value("diary.next_morning_prior_day_prompt").definition).toHaveProperty("delivery_and_submission_calendar", null);
      expect(value("report.application_cleaning_yield").definition).toHaveProperty("not_whitelist_cardinality", true);
      expect(value("report.diary_completion").definition).toMatchObject({ entries: 97, min: 4, max: 7 });
      expect(ops.get("insitu.category")!.depends_on).toEqual(["insitu.clean"]);
    } else if (name === "large-scale-notifications") {
      expect(value("notification.recorded_fields").definition).toMatchObject({ reception_equals_shown: null, server_upload_timestamp: null });
      expect(value("notification.update_flood_semantics").definition).toMatchObject({ systematic_dedup_performed: null });
      expect(value("survey.importance_scale").definition).toMatchObject({ display_code_order: [5, 4, 3, 2, 1], generating_app_example_is_universal: false });
      expect(value("survey.free_text_item").definition).toHaveProperty("question", "Would you please describe why?");
      expect(value("report.click_distribution").definition).toMatchObject({ separate_conditional_claim: {
        antecedent: "not clicked in first5minutes", probability_ever_click_percent: "17", denominator: null,
        equivalence_to_83_percent_complement: null }, censoring_rule_disclosed: false });
      expect(value("report.category_inventory_table1").definition).toHaveProperty("rows", expect.arrayContaining([["overall", 37233, 173, 4795226, 3636]]));
      expect(value("report.notifications_per_day_table2").definition).toHaveProperty("exposure_day_convention", null);
      expect(ops.get("large.pair")!.depends_on).toEqual([]);
      expect(ops.get("large.survey_button")!.depends_on).toEqual(["large.poll"]);
      expect(ops.get("large.blacklist_followup")!.depends_on).toEqual([]);
      expect(ops.get("large.click_association")!.depends_on).toEqual(["large.latency", "large.survey_answer"]);
      expect(ops.get("large.blacklist_association")!.depends_on).toEqual(["large.blacklist_followup", "large.survey_answer"]);
      expect(ops.get("large.class_association")!.depends_on).toEqual(["large.code_assign", "large.survey_answer"]);
    } else if (name === "reachable-not-receptive") {
      expect(value("intervention.four_randomized_triggers").definition).toMatchObject({
        one_joint_randomized_protocol: true, GUI_alternatives: false,
        adaptive_X_update: "X increments or decrements each time a notification in that hour on previous days is consumed or not",
        logistic_training_outcome: "whether notifications were fully consumed in similar contexts during the previous seven days",
      });
      expect(value("acquisition.asynchronous_window_completion").definition).toMatchObject({
        condition_combination: "OR", timeout_seconds: 2,
        missing_source_disposition_after_timeout: { action: "set_to_null", value: null },
        internal_null_retention_storage_reopen_order: null,
      });
      expect(value("acquisition.post_interruption_stop").definition).toMatchObject({
        elapsed_timer_anchor: null, post_delivery_duration_seconds: null, derived_25_second_post_delivery_window: false,
      });
      expect(value("reconstruction.device_in_use_from_screen").definition).toMatchObject({
        derived_property: "device_in_use_at_interruption", response_or_attendance_label: false,
        endpoint_inclusivity: null, nearest_sample_ties: null,
      });
      expect(value("observability.in_use_branch").definition).toHaveProperty("unobservable_stage_is_negative_or_null_response", false);
      expect(value("analysis.online_daily_retraining").definition).toMatchObject({
        prose_eligibility: "at least 21 days", caption_eligibility: ">21 days",
        effective_equality_boundary: null, online_RUS_placement: null,
      });
      expect(ops.get("reachable.deliver")!.depends_on).toEqual(["reachable.schedule"]);
      expect(ops.get("reachable.AT_PT")!.depends_on).toEqual(["reachable.balance_offline"]);
      expect(ops.get("reachable.online")!.depends_on).not.toContain("reachable.balance_offline");
    }
    expect(compileNativeMethodProfile(profile).ok).toBe(false);
    await saveResearchMethodSelection(JSON.stringify({ profile, selectedLevels: {} }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
    expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]).toEqual(profile);
    const mutant = structuredClone(profile);
    (mutant.method_operations as Array<Record<string, unknown>>)[0]!.depends_on = ["invented.operation"];
    expect(() => parseStudyMethodProfileLibrary({ profiles: [mutant] })).toThrow();
  });

  itWithPrivateCorpus("preserves populated ringer occupancy, unknown bounds and policy ownership without device-use inference", async () => {
    const profile = parseStudyMethodProfileLibrary({ profiles: [rawProfiles().find((row) =>
      row.source_work_id === "doi:10.1145/2785830.2785852")] }).profiles[0]!;
    const input = ringerStateIntervalExample(profile);
    const persist = async (value: unknown) => {
      const library = parseStudyMethodProfileLibrary(value);
      await saveResearchMethodSelection(JSON.stringify({ profile: library.profiles[0], selectedLevels: {},
        ringer_state_intervals: library.ringer_state_intervals }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; ringer_state_intervals?: unknown };
      return parseStudyMethodProfileLibrary({ profiles: [saved.profile],
        ...(saved.ringer_state_intervals !== undefined ? { ringer_state_intervals: saved.ringer_state_intervals } : {}) });
    };
    const restored = await persist(input);
    expect(restored.ringer_state_intervals).toEqual(input.ringer_state_intervals);
    expect(restored.ringer_state_intervals?.map((r) => r.ringer_mode)).toEqual(["Silent", "Normal", "Vibrate"]);
    expect(restored.ringer_state_intervals![0]!.denotes_interval).not.toHaveProperty("duration_seconds");
    expect(restored.ringer_state_intervals![1]!.denotes_interval).toHaveProperty("duration_seconds", null);
    expect(restored.ringer_state_intervals![2]!.denotes_interval).toHaveProperty("end_instant", null);
    expect(restored.ringer_state_intervals![2]!.denotes_interval).not.toHaveProperty("end_status");
    expect(restored.profiles[0]).toEqual(profile); // Includes the study-wide power-off limitation, not an observed shutdown.
    expect(compileNativeMethodProfile(restored.profiles[0]!).ok).toBe(false);
    const changed = structuredClone(input);
    changed.ringer_state_intervals[0]!.ringer_mode = "Normal";
    expect((await persist(changed)).ringer_state_intervals![0]!.ringer_mode).toBe("Normal");
    expect((await persist(changed)).ringer_state_intervals![0]!.denotes_interval)
      .toEqual(restored.ringer_state_intervals![0]!.denotes_interval);
    expect((await persist({ profiles: [profile] })).ringer_state_intervals).toBeUndefined();
    const variants = structuredClone(input);
    variants.ringer_state_intervals.reverse(); // No undisclosed sorting or overlap repair.
    variants.ringer_state_intervals.push({ ...variants.ringer_state_intervals[0]!, participant_id: "another-participant" });
    Reflect.set(variants.ringer_state_intervals[0]!, "interval_record_origin", "supplied_normalized_records");
    expect((await persist(variants)).ringer_state_intervals).toEqual(variants.ringer_state_intervals);
    for (const mutate of [
      (x: typeof input) => Reflect.set(x.ringer_state_intervals[0]!, "ringer_mode", null),
      (x: typeof input) => Reflect.set(x.ringer_state_intervals[0]!, "ringer_mode", 0),
      (x: typeof input) => Reflect.set(x.ringer_state_intervals[0]!, "ringer_mode", "silent"),
      (x: typeof input) => Reflect.set(x.ringer_state_intervals[0]!, "interval_record_origin", ["analyst_constructed_example"]),
      (x: typeof input) => { x.ringer_state_intervals[0]!.source_work_id = "another-source"; },
      (x: typeof input) => { x.ringer_state_intervals[0]!.session_construction_policy_reference = "foreign-policy"; },
      (x: typeof input) => { x.ringer_state_intervals.push(structuredClone(x.ringer_state_intervals[0]!)); },
      (x: typeof input) => Reflect.set(x.ringer_state_intervals[0]!.denotes_interval, "duration_seconds", "600"),
      (x: typeof input) => Reflect.set(x.ringer_state_intervals[0]!.denotes_interval, "end_status", "invented-censoring"),
      (x: typeof input) => Reflect.set(x.ringer_state_intervals[0]!.denotes_interval, "ringer_mode", "Silent"),
      (x: typeof input) => Reflect.set(x.ringer_state_intervals[0]!, "power_off_duration_unknown", true),
    ]) {
      const invalid = structuredClone(input);
      mutate(invalid);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
    }
    const wrongTarget = structuredClone(input);
    const policy = (wrongTarget.profiles[0]!.session_construction_policies as Array<Record<string, unknown>>)[0]!;
    policy.session_output_layer = "device_session";
    for (const setting of policy.method_settings as Array<Record<string, unknown>>) {
      if (setting.method_setting_role === "reconstruction") {
        setting.method_target_layer = "device_session";
        wrongTarget.profiles[0]!.method_settings.find((s) => s.method_setting_id === setting.method_setting_id)!.method_target_layer = "device_session";
      }
    }
    expect(() => parseStudyMethodProfileLibrary(wrongTarget)).toThrow("setting-state policy");
  });

  itWithPrivateCorpus("preserves Mathur's three stages, separate proxy/context paths and inclusive phone-session policy", async () => {
    const audit = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/post-freeze-source-audits/mathur-2016-engagement-aware.json"), "utf8")) as {
      disclosed_atoms: Array<{ key: string; value: unknown; canonical_role: string; canonical_target: string; locator: string; projection_disposition: string }>;
      method_operations: Array<Record<string, unknown>>;
    };
    const profile = parseStudyMethodProfileLibrary({ profiles: [rawProfiles().find((row) =>
      row.source_work_id === "doi:10.1145/2971648.2971760")] }).profiles[0]!;
    const value = (key: string) => JSON.parse(String(profile.method_settings.find((s) =>
      s.method_parameter_key === key)!.method_value_json)) as Record<string, unknown>;
    const space = profile.method_configuration_space as {
      invariant_method_setting_ids: string[]; method_configuration_groups: Array<Record<string, unknown>>;
    };
    expect(audit.disclosed_atoms).toHaveLength(69);
    expect(profile.method_settings).toHaveLength(68);
    for (const atom of audit.disclosed_atoms) {
      if (atom.projection_disposition === "configuration_metadata") {
        const group = space.method_configuration_groups.find((g) =>
          (g.method_configuration_axis as string[]).includes(atom.key))!;
        expect(JSON.parse(String(group.method_selection_semantics))).toEqual({ key: atom.key, value: atom.value });
        expect((group.source_locators as string[]).map((s) => decodeURIComponent(s.split("#audit-locator=")[1]!)))
          .toContain(atom.locator);
        continue;
      }
      const setting = profile.method_settings.find((s) => s.method_parameter_key === atom.key)!;
      expect(value(atom.key)).toEqual(atom.value);
      expect(setting.method_setting_role).toBe(atom.canonical_role);
      expect(setting.method_target_layer).toBe(atom.canonical_target);
      expect((setting.source_locators as string[]).map((s) => decodeURIComponent(s.split("#audit-locator=")[1]!)))
        .toContain(atom.locator);
      expect(setting.contract_bindings).toEqual([]);
      if (admittedAndroidCalculationReceipts[setting.method_setting_id]) {
        expectAdmittedAndroidCalculationReceipt(setting);
      } else expect(setting.method_implementation_status).toBe("specification_only");
      if (atom.key.startsWith("result.") || atom.key.startsWith("evidence.")) {
        expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
      }
    }
    expect(profile.method_operations).toEqual(audit.method_operations);
    expect(profile.method_operations).toHaveLength(17);
    const operations = new Map((profile.method_operations as Array<Record<string, unknown>>).map((o) => [o.operation_id, o]));
    expect(operations.get("mathur.sessionlogger_bes_labels")!.depends_on)
      .toEqual(["mathur.sessionlogger_identify_app_periods", "mathur.benchmark_select_bes"]);
    expect(operations.get("mathur.quantapp_context_features")!.depends_on).toEqual(["mathur.quantapp_collect"]);
    expect(operations.get("mathur.quantapp_proxy_session_labels")!.depends_on)
      .toEqual(["mathur.sessionlogger_fit_compare_proxy", "mathur.quantapp_app_features"]);
    expect(operations.get("mathur.quantapp_fit_compare_context_models")!.depends_on)
      .toEqual(["mathur.quantapp_context_features", "mathur.quantapp_proxy_session_labels"]);
    expect(operations.get("mathur.quantapp_context_features")!.part_of_operation).toBe("mathur.quantapp_stage");
    const policies = profile.session_construction_policies as Array<Record<string, unknown>>;
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({ session_input_layer: "raw_record", session_output_layer: "device_session" });
    expect(policies[0]).not.toHaveProperty("reconstruction_strategy");
    expect((policies[0]!.method_settings as Array<Record<string, unknown>>).map((s) => s.method_parameter_key))
      .toEqual(["sessionlogger.screen_session_bounds", "sessionlogger.no_unlock_filter",
        "sessionlogger.screen_session_merge", "sessionlogger.merge_parameter_provenance"]);
    expect(value("sessionlogger.screen_session_merge").definition).toMatchObject({ threshold: 5, unit: "seconds", comparator: "<=" });
    expect(value("app_feature.bucket_id").definition).toMatchObject({ day_bin_minutes: 5 });
    expect(value("quantapp.context_feature_anchor").count_discrepancy)
      .toMatchObject({ prose_context_features: 25, Table5_enumerated_entries: 26 });
    expect(value("proxy.selected_random_forest").feature_importance_method).toContain("MeanDecreaseGini");
    expect(value("benchmark.eeg_cadence").instrument_processing).toMatchObject({ eeg_channels: 5, algorithm: "proprietary Insight processing" });
    expect(value("quantapp.svm_and_ranking").summary_and_detailed_method_boundary).toMatchObject({
      summary_p2: "SVM classifier uses10 empirically picked contextual features.",
      unresolved: "Exact feature-selection/refitting sequence and complete fitted predictor inventory are not disclosed; do not assert all26 or only10 predictors in a recovered executable model.",
    });
    expect(value("result.context_feature_associations").rows).toEqual([
      { rank: 1, feature: "TimeSinceLastCall", correlation: -0.0773 },
      { rank: 2, feature: "TimeSinceLastNotification", correlation: -0.0001 },
      { rank: 3, feature: "LastHourActiveTime", correlation: 0.0009 },
      { rank: 4, feature: "LastHourAppCount", correlation: 0.01531 },
      { rank: 5, feature: "LastHourSessionCount", correlation: 0.0762 },
      { rank: 6, feature: "LastHourAppsPerMin", correlation: 0.02951 },
      { rank: 7, feature: "LastHourNotificationAttended", correlation: 0.00579 },
      { rank: 8, feature: "LastHourBatteryDrain", correlation: -0.01199 },
      { rank: 9, feature: "BatteryLevel", correlation: -0.05463 },
      { rank: 10, feature: "AmbientNoise", correlation: 0.03172 },
    ]);
    expect(value("evidence.undisclosed_method_details").unavailable_facts).toHaveLength(9);
    const campaigns = space.method_configuration_groups.filter((g) => g.method_configuration_group_kind === "source_campaign_model_cell");
    expect(campaigns).toHaveLength(2);
    expect(space.method_configuration_groups.filter(requiresConfigurationSelection)).toHaveLength(0);
    expect(enumerateMethodConfigurations(profile)).toMatchObject({ ok: true, selections: [expect.anything()] });
    expect(compileNativeMethodProfile(profile).ok).toBe(false);
    await saveResearchMethodSelection(JSON.stringify({ profile, selectedLevels: {} }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
    expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]).toEqual(profile);
    const mutant = structuredClone(profile);
    (mutant.session_construction_policies as Array<Record<string, unknown>>)[0]!.session_output_layer = "app_session";
    expect(() => parseStudyMethodProfileLibrary({ profiles: [mutant] })).toThrow("constructor/output target mismatch");
  });

  itWithPrivateCorpus.each([
    ["doi:10.1145/2371574.2371617", "back-to-the-app", 29, 11, "app_session"],
    ["doi:10.1145/2785830.2785852", "chang-ringer-mode-usage", 30, 11, "device_setting_state_interval"],
  ] as const)("preserves independently reviewed temporal definitions for %s", async (work, name, atoms, operations, target) => {
    const audit = JSON.parse(readFileSync(privateCorpusPath(`ontology-sublation-20260831/post-freeze-source-audits/${name}.json`), "utf8")) as {
      disclosed_atoms: Array<{ key: string; value: unknown; canonical_role: string; canonical_target: string; locator: string }>;
      method_operations: Array<Record<string, unknown>>;
    };
    const profile = parseStudyMethodProfileLibrary({ profiles: [rawProfiles().find((row) => row.source_work_id === work)] }).profiles[0]!;
    expect(profile.method_settings).toHaveLength(atoms);
    expect(profile.method_operations).toEqual(audit.method_operations);
    expect(profile.method_operations).toHaveLength(operations);
    const policies = profile.session_construction_policies as Array<Record<string, unknown>>;
    expect(policies).toHaveLength(1);
    expect(policies[0]!.session_output_layer).toBe(target);
    expect(policies[0]).not.toHaveProperty("reconstruction_strategy");
    const value = (key: string) => JSON.parse(String(profile.method_settings.find((s) => s.method_parameter_key === key)!.method_value_json)) as Record<string, unknown>;
    for (const atom of audit.disclosed_atoms) {
      const setting = profile.method_settings.find((s) => s.method_parameter_key === atom.key)!;
      expect(JSON.parse(String(setting.method_value_json))).toEqual(atom.value);
      expect(setting.method_setting_role).toBe(atom.canonical_role);
      expect(setting.method_target_layer).toBe(atom.canonical_target);
      expect((setting.source_locators as string[]).map((locator) =>
        decodeURIComponent(locator.split("#audit-locator=")[1]!))).toContain(atom.locator);
      expect(setting.contract_bindings).toEqual([]);
      if (admittedAndroidCalculationReceipts[setting.method_setting_id]) {
        expectAdmittedAndroidCalculationReceipt(setting);
      } else expect(setting.method_implementation_status).toBe("specification_only");
    }
    const space = profile.method_configuration_space as { invariant_method_setting_ids: string[]; method_configuration_groups: Array<Record<string, unknown>> };
    expect(space.method_configuration_groups.filter(requiresConfigurationSelection)).toHaveLength(0);
    for (const atom of audit.disclosed_atoms.filter((row) => row.canonical_role === "provenance" || row.canonical_role === "reporting")) {
      expect(space.invariant_method_setting_ids).not.toContain(profile.method_settings.find((s) => s.method_parameter_key === atom.key)!.method_setting_id);
    }
    const byId = (id: string) => (profile.method_operations as Array<Record<string, unknown>>).find((row) => row.operation_id === id)!;
    if (name === "back-to-the-app") {
      expect(value("activity.same_user_day_app_gap_split")).toMatchObject({ threshold_seconds: 60, comparator: ">", equality_behavior: "gap exactly one minute is not split by the printed formula" });
      expect(byId("leiva.summarize_all_case_frequency").depends_on).toEqual(["leiva.classify_interruption"]);
      expect(byId("leiva.separate_analysis_populations").produces).toEqual(["paired analysis population"]);
      expect(byId("leiva.summarize_and_compare").consumes).toEqual(["paired analysis population", "signed interruption overhead T_o", "outlier exclusion decisions", "T_n", "T_r", "T_i"]);
      expect(value("measure.interrupted_runtime_components").nonnegative_domain).toEqual(["T_b", "T_a", "T_i", "T_n"]);
      expect(value("measure.signed_overhead").domain).toBe("signed real; negative allowed");
      expect(value("source_anomaly.table3_mean_overhead_vs_equation").source_explanation).toBeNull();
      expect(value("evidence.undisclosed_method_details").unreported_details).toHaveLength(5);
    } else {
      expect(value("feature.attendance_bins").definition).toMatchObject({ ordinal_categories: [
        { printed_interval: "<1 minute", code: 3 }, { printed_interval: "1–6 minutes", code: 2 }, { printed_interval: ">6 minutes", code: 1 },
      ], middle_bin_exact_boundary_algorithm: null, unit: "minutes" });
      expect(byId("chang.derive_general_attending_actions").depends_on).toEqual(["chang.acquire_events_and_context"]);
      expect(byId("chang.derive_general_attending_actions").configuration_dependencies).toContain("feature.attendance_bins");
      expect(value("analysis.qualitative_coding").procedures).toHaveLength(2);
      expect(byId("chang.aggregate_attentiveness_within_ringer_intervals").depends_on)
        .toEqual(["chang.construct_ringer_state_intervals", "chang.derive_general_attending_actions"]);
      expect(value("outcome.same_contact_sms_response").reported_horizon_statement).toContain("without asserting a universal");
      expect(value("reconstruction.ringer_mode_interval").source_interpretation_limits).toContain("does not prescribe bridging");
      expect(value("output.ringer_changes_and_intervals").Figure5_intervals).toEqual({ all: 749, Silent: 163, Normal: 306, Vibrate: 280 });
      expect(value("output.attentiveness").table1_new_SMS_denominator).toContain("Do not renormalize");
    }
    expect(compileNativeMethodProfile(profile).ok).toBe(false);
    await saveResearchMethodSelection(JSON.stringify({ profile, selectedLevels: {} }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
    expect(restored).toEqual(profile);
    // An enum-valid device-session substitution contradicts the source constructor.
    const mutant = structuredClone(restored);
    (mutant.session_construction_policies as Array<Record<string, unknown>>)[0]!.session_output_layer = "device_session";
    expect(() => parseStudyMethodProfileLibrary({ profiles: [mutant] })).toThrow("constructor/output target mismatch");
  });

  it("preserves the Jones partition-local history rule as queryable fields through IndexedDB", async () => {
    const input = jonesSequenceExample();
    const query = (library: ReturnType<typeof parseStudyMethodProfileLibrary>) => {
      const profile = library.profiles[0]!;
      const op = (profile.method_operations as Array<Record<string, unknown>>).find((row) => row.sequence_encoding_rule);
      if (!op) return null;
      const symbol = (key: string) => JSON.parse(String(profile.method_settings.find((s) => s.method_setting_id === op[key])!.method_value_json)) as string;
      return { rule: op.sequence_encoding_rule, scope: op.sequence_scope_operation_ids, identity: op.sequence_identity_setting_ids,
        first: symbol("sequence_first_symbol_setting_id"), repeat: symbol("sequence_repeat_symbol_setting_id") };
    };
    const parsed = parseStudyMethodProfileLibrary(input);
    const expected = { rule: "first_vs_previously_seen_in_partition", scope: ["jones.session_partition"],
      identity: ["example:sequence:application"], first: "F", repeat: "B" };
    expect(query(parsed)).toEqual(expected);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], selectedLevels: {} }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
    const restoredPolicy = query(parseStudyMethodProfileLibrary({ profiles: [saved.profile] }));
    expect(restoredPolicy).toEqual(expected);

    // A source-semantic contrast, NOT a native executor or a paper-result proof.
    const normalizedPartitions = [["A", "B", "A", "A", "C"], ["A"]];
    const encode = (policy: NonNullable<typeof restoredPolicy>) => {
      if (policy.rule !== "first_vs_previously_seen_in_partition") throw new Error("unsupported test policy");
      return normalizedPartitions.map((partition) => {
        const seen = new Set<string>();
        return partition.map((id) => { const token = seen.has(id) ? policy.repeat : policy.first; seen.add(id); return token; }).join("");
      });
    };
    const encoded = encode(restoredPolicy!);
    expect(encoded).toEqual(["FFBBF", "F"]);
    expect(normalizedPartitions.map((partition) => [...new Set(partition)].map(() => "F").join(""))).not.toEqual(encoded);
    const globalSeen = new Set<string>();
    expect(normalizedPartitions.map((partition) => partition.map((id) => {
      const token = globalSeen.has(id) ? "B" : "F"; globalSeen.add(id); return token;
    }).join(""))).not.toEqual(encoded);
    expect(normalizedPartitions.map((partition) => partition.map((id, i) => i > 0 && partition[i - 1] === id ? "B" : "F").join(""))).not.toEqual(encoded);
    const swapped = jonesSequenceExample();
    Object.assign(swapped.profiles[0]!.method_operations[1]!, {
      sequence_first_symbol_setting_id: "example:sequence:repeat", sequence_repeat_symbol_setting_id: "example:sequence:first",
    });
    expect(encode(query(parseStudyMethodProfileLibrary(swapped))!)).toEqual(["BBFFB", "B"]);
    const omitted = structuredClone(input);
    for (const key of Object.keys(omitted.profiles[0]!.method_operations[1]!)) {
      if (key.startsWith("sequence_")) Reflect.deleteProperty(omitted.profiles[0]!.method_operations[1]!, key);
    }
    expect(query(parseStudyMethodProfileLibrary(omitted))).toBeNull();
    expect(compileNativeMethodProfile(parsed.profiles[0]!, DEFAULT_BROWSER_OPTIONS).ok).toBe(false);
  });

  it("rejects forged or incomplete Jones sequence fields without changing grouping rules", () => {
    for (const value of ["null", "1", "{}", '""', '"B"', "invalid"]) {
      const mutant = jonesSequenceExample();
      mutant.profiles[0]!.method_settings[1]!.method_value_json = value;
      expect(() => parseStudyMethodProfileLibrary(mutant)).toThrow();
    }
    for (const change of [
      { sequence_encoding_rule: "global_history" }, { sequence_encoding_rule: null },
      { sequence_scope_operation_ids: [] }, { sequence_scope_operation_ids: ["foreign"] },
      { sequence_scope_operation_ids: ["jones.sequence_encoding"] },
      { sequence_scope_operation_ids: ["jones.session_partition", "jones.session_partition"] },
      { sequence_identity_setting_ids: [] }, { sequence_identity_setting_ids: ["foreign"] },
      { sequence_identity_setting_ids: ["example:sequence:application", "example:sequence:application"] },
      { sequence_first_symbol_setting_id: "foreign" }, { sequence_first_symbol_setting_id: null },
      { sequence_repeat_symbol_setting_id: "example:sequence:first" },
      { selection_rule: "FIRST" }, { grouping_basis: "field_equality" },
    ]) {
      const mutant = jonesSequenceExample();
      Object.assign(mutant.profiles[0]!.method_operations[1]!, change);
      expect(() => parseStudyMethodProfileLibrary(mutant)).toThrow();
    }
    const incomplete = jonesSequenceExample();
    Reflect.deleteProperty(incomplete.profiles[0]!.method_operations[1]!, "sequence_encoding_rule");
    expect(() => parseStudyMethodProfileLibrary(incomplete)).toThrow();
  });

  it("preserves observed drawer membership, scoped recurrence and distinct identity bases through the existing store", async () => {
    const input = clearAllSnapshotExample();
    const query = (library: ReturnType<typeof parseStudyMethodProfileLibrary>) => {
      const snapshots = library.notification_snapshots ?? [];
      return {
        observations: snapshots.map((s) => [s.snapshot_record_id, s.device_id, s.snapshot_instant, s.timezone]),
        appearances: snapshots.flatMap((s) => s.pending_item_appearances.map((a) => [s.snapshot_record_id, s.device_id,
          a.appearance_record_id, a.notification_item_id, a.item_identity_basis, a.drawer_position,
          a.notification_id_json, a.notification_tag_json, a.creation_instant, a.notification_key_token, a.post_time_identity_token])),
        distinctItems: new Set(snapshots.flatMap((s) => s.pending_item_appearances.map((a) =>
          JSON.stringify([s.method_profile_id, s.device_id, a.item_identity_basis, a.notification_item_id])))).size,
        empty: snapshots.filter((s) => !s.pending_item_appearances.length).map((s) => s.snapshot_record_id),
      };
    };
    const expected = {
      observations: [["S1", "D1", "2026-01-01T09:00:00Z", "UTC"], ["S2", "D1", "2026-01-01T09:17:00Z", "UTC"],
        ["S3", "D1", "2026-01-01T09:34:00Z", "UTC"], ["S4", "D2", "2026-01-01T09:17:00Z", "UTC"], ["S5", "D1", "2026-01-01T09:51:00Z", "UTC"]],
      appearances: [["S1", "D1", "a1", "item-1", "paper_four_field_combination", 2, "7", "null", "2026-01-01T08:00:00Z", undefined, undefined],
        ["S2", "D1", "a2", "item-1", "paper_four_field_combination", 1, "7", "null", "2026-01-01T08:00:00Z", undefined, undefined],
        ["S4", "D2", "a4", "item-1", "paper_four_field_combination", 4, "7", "null", "2026-01-01T08:00:00Z", undefined, undefined],
        ["S5", "D1", "a5", "item-1", "linked_code_key_posttime", null, undefined, undefined, undefined, "opaque-key", "12345"]],
      distinctItems: 3, empty: ["S3"],
    };
    const restore = async (value: { profiles: unknown[]; notification_snapshots?: unknown }) => {
      const parsed = parseStudyMethodProfileLibrary(value);
      await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], selectedLevels: {}, notification_snapshots: parsed.notification_snapshots }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; notification_snapshots?: unknown };
      const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile],
        ...(saved.notification_snapshots !== undefined ? { notification_snapshots: saved.notification_snapshots } : {}) });
      expect(restored).toEqual(parsed);
      expect(restored.notification_snapshots).toEqual(value.notification_snapshots);
      return restored;
    };
    const restored = await restore(input);
    expect(restored.notification_snapshots).toEqual(input.notification_snapshots);
    expect(query(restored)).toEqual(expected);
    expect(restored.notification_snapshots?.some((s) => s.snapshot_instant === "2026-01-01T09:15:00Z")).toBe(false);
    expect(query(await restore({ profiles: input.profiles }))).toEqual({ observations: [], appearances: [], distinctItems: 0, empty: [] });
    // These are transportable but not the specified source example: preserving a
    // generic valid record does not itself prove source-faithful relationships.
    for (const mutate of [
      (x: typeof input) => { x.notification_snapshots.splice(2, 1); },
      (x: typeof input) => { x.notification_snapshots[3]!.device_id = "D1"; },
      (x: typeof input) => {
        x.notification_snapshots[4]!.pending_item_appearances = [structuredClone(x.notification_snapshots[0]!.pending_item_appearances[0]!)];
      },
      (x: typeof input) => {
        const added = structuredClone(x.notification_snapshots[2]!);
        added.snapshot_record_id = "S6"; added.snapshot_instant = "2026-01-01T09:15:00Z"; x.notification_snapshots.push(added);
      },
      (x: typeof input) => {
        Object.assign(x.notification_snapshots[0]!.pending_item_appearances[0]!, { notification_item_id: "different-item", notification_tag_json: '"null"' });
      },
    ]) {
      const mutant = structuredClone(input);
      mutate(mutant);
      expect(query(await restore(mutant))).not.toEqual(expected);
    }
    for (const mutate of [
      (x: typeof input) => { Reflect.deleteProperty(x.notification_snapshots[0]!, "pending_item_appearances"); },
      (x: typeof input) => { Reflect.set(x.notification_snapshots[0]!, "pending_item_appearances", null); },
      (x: typeof input) => { x.notification_snapshots[0]!.source_work_id = "wrong-work"; },
      (x: typeof input) => { x.notification_snapshots[0]!.method_profile_id = "wrong-profile"; },
      (x: typeof input) => { x.notification_snapshots.push(structuredClone(x.notification_snapshots[0]!)); },
      (x: typeof input) => { x.notification_snapshots[0]!.pending_item_appearances.push(structuredClone(x.notification_snapshots[0]!.pending_item_appearances[0]!)); },
      (x: typeof input) => { x.notification_snapshots[0]!.pending_item_appearances[0]!.notification_id_json = "invalid JSON"; },
      (x: typeof input) => { x.notification_snapshots[0]!.pending_item_appearances[0]!.notification_tag_json = '"null"'; },
      (x: typeof input) => { x.notification_snapshots[1]!.pending_item_appearances[0]!.notification_item_id = "false-split"; },
      (x: typeof input) => { x.notification_snapshots[0]!.pending_item_appearances[0]!.notification_key_token = null; },
      (x: typeof input) => { x.notification_snapshots[4]!.pending_item_appearances[0]!.creation_instant = null; },
      (x: typeof input) => { x.notification_snapshots[0]!.pending_item_appearances[0]!.item_identity_basis = "assumed-equivalent"; },
      (x: typeof input) => { x.notification_snapshots[0]!.pending_item_appearances[0]!.drawer_position = 1.5; },
      (x: typeof input) => { x.notification_snapshots[0]!.pending_item_appearances[0]!.source_locators = []; },
      (x: typeof input) => { Reflect.set(x.notification_snapshots[0]!, "inferred_clear_all", true); },
      (x: typeof input) => {
        x.notification_snapshots[0]!.pending_item_appearances[0]!.notification_id_json = "9007199254740992";
        x.notification_snapshots[1]!.pending_item_appearances[0]!.notification_id_json = "9007199254740993";
      },
    ]) {
      const invalid = structuredClone(input);
      mutate(invalid);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
    }
    const lexical = structuredClone(input);
    for (const s of lexical.notification_snapshots.slice(0, 2)) {
      s.pending_item_appearances[0]!.notification_id_json = "9007199254740993";
    }
    lexical.notification_snapshots[3]!.snapshot_record_id = "S1"; // IDs are scoped, not global.
    lexical.notification_snapshots[1]!.pending_item_appearances[0]!.appearance_record_id = "a1";
    Reflect.set(lexical.notification_snapshots[1]!, "timezone", null);
    expect((await restore(lexical)).notification_snapshots).toEqual(lexical.notification_snapshots);
    const otherProfile = structuredClone(input.profiles[0]!);
    otherProfile.method_profile_id = "example:independent-profile";
    const otherScope = structuredClone(input.notification_snapshots[0]!);
    otherScope.method_profile_id = otherProfile.method_profile_id;
    otherScope.pending_item_appearances[0]!.notification_id_json = "8";
    const profiles = { profiles: [...input.profiles, otherProfile], notification_snapshots: [...input.notification_snapshots, otherScope] };
    expect(parseStudyMethodProfileLibrary(profiles).notification_snapshots).toEqual(profiles.notification_snapshots);
    const concatenated = structuredClone(input);
    const code = concatenated.notification_snapshots[4]!.pending_item_appearances[0]!;
    Object.assign(code, { notification_key_token: "a@b", post_time_identity_token: "c" });
    const another = structuredClone(concatenated.notification_snapshots[4]!);
    another.snapshot_record_id = "S6";
    Object.assign(another.pending_item_appearances[0]!, { notification_key_token: "a", post_time_identity_token: "b@c", app_package_name: "other.observed.package" });
    concatenated.notification_snapshots.push(another);
    // Symbolic code-string collision, not a claim about valid Android data.
    expect((await restore(concatenated)).notification_snapshots).toEqual(concatenated.notification_snapshots);
    another.pending_item_appearances[0]!.notification_item_id = "false-code-split";
    expect(() => parseStudyMethodProfileLibrary(concatenated)).toThrow("splits one identity");
    expect(compileNativeMethodProfile(restored.profiles[0]!).ok).toBe(false);
  });

  it("preserves snapshot metadata and changing appearance-local values without applying release defaults or coercions", async () => {
    const input = clearAllSnapshotExample();
    for (const [path, mutate] of [
      ["notification_snapshots must be an array", (v: typeof input) => Reflect.set(v, "notification_snapshots", {})],
      ["notification_snapshots[0] must be an object", (v: typeof input) => Reflect.set(v.notification_snapshots, 0, null)],
      ["snapshot_record_origin is unknown", (v: typeof input) => Reflect.set(v.notification_snapshots[0]!, "snapshot_record_origin", "foreign")],
      ["pending_item_appearances[0] must be an object", (v: typeof input) => Reflect.set(v.notification_snapshots[0]!.pending_item_appearances, 0, null)],
      ["notification_key_token and post_time_identity_token must be supplied string tokens", (v: typeof input) => Reflect.set(v.notification_snapshots[4]!.pending_item_appearances[0]!, "notification_key_token", null)],
    ] as const) {
      const invalid = structuredClone(input); mutate(invalid);
      expect(() => parseStudyMethodProfileLibrary(invalid), path).toThrow(path);
    }
    const parsed = parseStudyMethodProfileLibrary(input);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], selectedLevels: {}, notification_snapshots: parsed.notification_snapshots }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; notification_snapshots: unknown };
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], notification_snapshots: saved.notification_snapshots });
    expect(restored.notification_snapshots).toEqual(input.notification_snapshots);
    const snapshots = restored.notification_snapshots!;
    const storeRoundtrip = async (value: typeof input) => {
      const library = parseStudyMethodProfileLibrary(value);
      await saveResearchMethodSelection(JSON.stringify({ profile: library.profiles[0], selectedLevels: {}, notification_snapshots: library.notification_snapshots }));
      const selection = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; notification_snapshots: unknown };
      const result = parseStudyMethodProfileLibrary({ profiles: [selection.profile], notification_snapshots: selection.notification_snapshots });
      expect(result.notification_snapshots).toEqual(value.notification_snapshots);
      return result.notification_snapshots!;
    };
    expect(snapshots.slice(0, 2).map((s) => [s.android_version, s.device_model, s.device_product, s.device_manufacturer, s.snapshot_transmission_id_token])).toEqual([
      ["9.0", "Example Model", "example_product", "Example Manufacturer", "9007199254740993"],
      ["10.0", "", null, undefined, "9007199254740994"],
    ]);
    expect(snapshots.flatMap((s) => s.pending_item_appearances.map((a) => [a.notification_item_id, a.priority_value_json,
      a.clearability_value_json, a.group_key_compat_value_json, a.group_key_compat_absent, a.group_summary_compat_value_json]))).toEqual([
      ["item-1", "-2", "false", undefined, true, "false"],
      ["item-1", "2", "true", '""', false, '"false"'],
      ["item-1", "0", "0", "null", undefined, "null"],
      ["item-1", undefined, undefined, undefined, undefined, undefined],
    ]);
    expect(snapshots[2]!.pending_item_appearances).toEqual([]);
    expect(Object.hasOwn(snapshots[4]!.pending_item_appearances[0]!, "group_key_compat_absent")).toBe(false);
    for (const field of ["android_version", "device_model", "device_product", "device_manufacturer", "snapshot_transmission_id_token"]) {
      const invalid = structuredClone(input);
      Reflect.set(invalid.notification_snapshots[0]!, field, 7);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(`${field} must be a string or null`);
    }
    for (const field of ["priority_value_json", "clearability_value_json", "group_key_compat_value_json", "group_summary_compat_value_json"]) {
      for (const value of [null, false, 0, "invalid JSON"]) {
        const invalid = structuredClone(input);
        Reflect.set(invalid.notification_snapshots[1]!.pending_item_appearances[0]!, field, value);
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
      }
      const lexical = structuredClone(input);
      Reflect.set(lexical.notification_snapshots[1]!.pending_item_appearances[0]!, field, " 9007199254740993 ");
      expect((await storeRoundtrip(lexical))[1]!.pending_item_appearances[0]![field]).toBe(" 9007199254740993 ");
    }
    for (const token of ['""', "null", "false", "0"]) {
      const invalid = structuredClone(input);
      Object.assign(invalid.notification_snapshots[0]!.pending_item_appearances[0]!, { group_key_compat_value_json: token });
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("cannot assert absence and supply a group-key value");
    }
    const invalid = structuredClone(input);
    Reflect.set(invalid.notification_snapshots[0]!.pending_item_appearances[0]!, "group_key_compat_absent", "true");
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("group_key_compat_absent must be a boolean or null");
    const rawMembers = structuredClone(input);
    rawMembers.notification_snapshots[0]!.pending_item_appearances = [true, true, false].map((summary, index) => ({
      ...input.notification_snapshots[0]!.pending_item_appearances[0]!, appearance_record_id: `raw-${index}`,
      notification_item_id: `raw-item-${index}`, notification_id_json: String(index), priority_value_json: "99",
      group_summary_compat_value_json: JSON.stringify(summary),
    }));
    const unprocessed = (await storeRoundtrip(rawMembers))[0]!.pending_item_appearances;
    expect(unprocessed).toEqual(rawMembers.notification_snapshots[0]!.pending_item_appearances);
    expect(unprocessed.map((a) => a.priority_value_json)).toEqual(["99", "99", "99"]);
    expect(unprocessed.map((a) => a.group_summary_compat_value_json)).toEqual(["true", "true", "false"]);
    expect(unprocessed.every((a) => !Object.hasOwn(a, "group_key_compat_value_json"))).toBe(true);
    const unknown = structuredClone(input);
    Reflect.set(unknown.notification_snapshots[4]!.pending_item_appearances[0]!, "group_key_compat_absent", null);
    expect((await storeRoundtrip(unknown))[4]!.pending_item_appearances[0]!.group_key_compat_absent).toBeNull();
    const codeMetadata = structuredClone(input);
    Object.assign(codeMetadata.notification_snapshots[4]!.pending_item_appearances[0]!, { priority_value_json: "0", clearability_value_json: "false", group_key_compat_value_json: '""', group_summary_compat_value_json: "true" });
    expect((await storeRoundtrip(codeMetadata))[4]!.pending_item_appearances[0]!.group_summary_compat_value_json).toBe("true");
    expect(compileNativeMethodProfile(restored.profiles[0]!).ok).toBe(false);
  });

  it("preserves Clear All's ordered raw concatenation and plural summary selection without treating snapshots as callbacks", async () => {
    const imported = parseStudyMethodProfileLibrary(clearAllGroupingExample()).profiles[0]!;
    const members: Array<Record<string, unknown>> = [
      { id: "s1", packageName: "com.a", groupKeyCompat: "bc", isGroupSummaryCompat: true },
      { id: "m1", packageName: "com.ab", groupKeyCompat: "c", isGroupSummaryCompat: false },
      { id: "s2", packageName: "com.a", groupKeyCompat: "bc", isGroupSummaryCompat: true },
      { id: "bare", packageName: "x", isGroupSummaryCompat: false },
      { id: "m2", packageName: "y", groupKeyCompat: "z", isGroupSummaryCompat: false },
      { id: "m3", packageName: "y", groupKeyCompat: "z", isGroupSummaryCompat: false },
      { id: "lone", packageName: "u", isGroupSummaryCompat: true },
    ];
    // Synthetic code-semantic contrast, not observed Android keys or data replay.
    const expected = ["s1", "s2", "bare", "m2", "m3", "lone"];
    const query = (profile: typeof imported, input = members) => {
      const operation = (profile.method_operations as Array<Record<string, unknown>> | undefined)?.find((row) => row.selection_rule);
      if (!operation) return undefined;
      const fields = new Map(profile.method_settings.map((row) => [row.method_setting_id, JSON.parse(String(row.method_value_json)) as string]));
      const operandIds = (operation.grouping_basis === "field_equality" ? operation.equality_key_setting_ids : operation.concatenated_key_setting_ids) as string[];
      const defaults = operation.empty_if_absent_key_setting_ids as string[] | undefined;
      const keys = input.map((member) => {
        const values = operandIds.map((id) => {
          const field = fields.get(id)!;
          const value = !Object.hasOwn(member, field) && defaults?.includes(id) ? "" : member[field];
          if (typeof value !== "string") throw new Error("Operand is not a raw string; absence is not null");
          return value;
        });
        return operation.grouping_basis === "field_equality" ? JSON.stringify(values) : values.join("");
      });
      return input.filter((member, index) => {
        const positions = keys.flatMap((key, i) => key === keys[index] ? [i] : []);
        const summaries = positions.filter((i) => input[i]!.isGroupSummaryCompat === true);
        switch (operation.selection_rule) {
          case "RETAIN_SUMMARIES_IF_PRESENT_ELSE_ALL": return !summaries.length || summaries.includes(index);
          case "DISCARD_SUMMARY_IF_NON_SUMMARY_EXISTS": return summaries.length === positions.length || !summaries.includes(index);
          case "FIRST": return index === positions[0];
          case "LAST": return index === positions.at(-1);
          default: throw new Error("Unknown selection rule");
        }
      }).map((member) => member.id);
    };
    const restore = async (profile: typeof imported) => {
      await saveResearchMethodSelection(JSON.stringify({ profile, selectedLevels: {} }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
      const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
      expect(restored).toEqual(profile);
      return restored;
    };
    const restoredSource = await restore(imported);
    expect((restoredSource.method_operations as Array<Record<string, unknown>>)[1]).toMatchObject({
      group_scope_operation_ids: ["clear_all.snapshot_partition"], grouping_basis: "raw_string_concatenation",
      concatenated_key_setting_ids: ["example:field:packageName", "example:field:groupKeyCompat"],
      empty_if_absent_key_setting_ids: ["example:field:groupKeyCompat"], selection_rule: "RETAIN_SUMMARIES_IF_PRESENT_ELSE_ALL",
    });
    expect(query(restoredSource)).toEqual(expected);
    expect(query(imported, [members[0]!, members[4]!, members[2]!, members[5]!])).toEqual(["s1", "m2", "s2", "m3"]);
    expect(query(imported, [])).toEqual([]);
    expect(query(imported, [members[1]!])).toEqual(["m1"]); // A different snapshot does not inherit a prior summary.
    expect(query(imported, [members[3]!, { id: "empty-key-summary", packageName: "x", groupKeyCompat: "", isGroupSummaryCompat: true }]))
      .toEqual(["empty-key-summary"]);
    expect(() => query(imported, [{ id: "explicit-null", packageName: "x", groupKeyCompat: null }])).toThrow("absence is not null");
    const omitted = structuredClone(imported);
    for (const operation of omitted.method_operations as Array<Record<string, unknown>>) {
      for (const key of ["group_scope_operation_ids", "grouping_basis", "equality_key_setting_ids", "concatenated_key_setting_ids", "empty_if_absent_key_setting_ids", "selection_rule"]) delete operation[key];
    }
    expect(query(parseStudyMethodProfileLibrary({ profiles: [omitted] }).profiles[0]!)).toBeUndefined();
    for (const change of [
      { selection_rule: "DISCARD_SUMMARY_IF_NON_SUMMARY_EXISTS" }, { selection_rule: "FIRST" }, { selection_rule: "LAST" },
      { concatenated_key_setting_ids: ["example:field:groupKeyCompat", "example:field:packageName"] },
      { grouping_basis: "field_equality", equality_key_setting_ids: ["example:field:packageName", "example:field:groupKeyCompat"],
        concatenated_key_setting_ids: [], empty_if_absent_key_setting_ids: [] },
    ]) {
      const mutant = structuredClone(imported);
      Object.assign((mutant.method_operations as Array<Record<string, unknown>>)[1]!, change);
      const parsed = parseStudyMethodProfileLibrary({ profiles: [mutant] }).profiles[0]!;
      const restored = await restore(parsed);
      expect(restored).toEqual(mutant);
      // Tuple equality differs even with complete operands, independent of default handling.
      expect(query(restored, members.slice(0, 3))).not.toEqual(["s1", "s2"]);
    }
    const noDefault = structuredClone(imported);
    (noDefault.method_operations as Array<Record<string, unknown>>)[1]!.empty_if_absent_key_setting_ids = [];
    expect(() => query(parseStudyMethodProfileLibrary({ profiles: [noDefault] }).profiles[0]!)).toThrow("not a raw string");
    const repeatedOperand = structuredClone(imported);
    (repeatedOperand.method_operations as Array<Record<string, unknown>>)[1]!.concatenated_key_setting_ids = ["example:field:packageName", "example:field:groupKeyCompat", "example:field:groupKeyCompat"];
    expect((await restore(parseStudyMethodProfileLibrary({ profiles: [repeatedOperand] }).profiles[0]!)).method_operations)
      .toEqual(repeatedOperand.method_operations); // Ordered operands are not a deduplicated field set.
    expect(query(parseStudyMethodProfileLibrary({ profiles: [repeatedOperand] }).profiles[0]!, members.slice(0, 3)))
      .not.toEqual(["s1", "s2"]); // Generic acceptance does not make three operands source-faithful.
    for (const change of [
      { concatenated_key_setting_ids: [] }, { concatenated_key_setting_ids: ["example:field:packageName"] },
      { concatenated_key_setting_ids: ["example:field:packageName", "foreign"] },
      { concatenated_key_setting_ids: ["example:field:packageName", null] },
      { empty_if_absent_key_setting_ids: ["example:field:isGroupSummaryCompat"] },
      { empty_if_absent_key_setting_ids: ["example:field:groupKeyCompat", "example:field:groupKeyCompat"] },
      { equality_key_setting_ids: ["example:field:packageName"] }, { grouping_basis: "declared_group_membership" },
    ]) {
      const invalid = structuredClone(imported);
      Object.assign((invalid.method_operations as Array<Record<string, unknown>>)[1]!, change);
      expect(() => parseStudyMethodProfileLibrary({ profiles: [invalid] })).toThrow();
    }
    expect(compileNativeMethodProfile(imported).ok).toBe(false);
  });

  itWithPrivateCorpus("preserves normalized current trace membership, event payload identities and paired redaction effects", async () => {
    const input = odimInteractionTraceExample(rawProfiles().find((row) => row.source_work_id === "doi:10.1145/3743726"));
    const expected = {
      members: [["e1", "image1", "hierarchy1", null, true, null], ["e3", "image3", "hierarchy3", "gesture3", false, true]],
      redactions: [
        ["e1", "device1", "selected_ui_element", ["element1"], undefined, "image1-redacted", "hierarchy1-redacted", "selected_element_pixels_deleted", "corresponding_text_content_tagged", "Synthetic example of a private name"],
        ["e3", "web3", "drawn_region_sufficient_iou", ["element3"], "rectangle3", "image3-redacted", "hierarchy3-redacted", "drawn_region_blackened", "qualifying_element_metadata_removed", undefined],
      ],
    };
    const query = (library: ReturnType<typeof parseStudyMethodProfileLibrary>) => {
      const events = [...(library.interaction_traces?.[0]?.interaction_events ?? [])].sort((a, b) => a.event_sequence_position - b.event_sequence_position);
      return { members: events.map((event) => [event.interaction_event_id, event.screenshot_artifact_id, event.hierarchy_artifact_id,
        event.gesture_artifact_id, event.capture_incomplete, event.human_detected_incorrect]),
      redactions: events.flatMap((event) => (event.interaction_redactions ?? []).map((redaction) => [event.interaction_event_id,
        redaction.redaction_record_id, redaction.redaction_selection_basis, redaction.selected_element_ids, redaction.target_region_id,
        redaction.redacted_screenshot_artifact_id, redaction.redacted_hierarchy_artifact_id,
        redaction.screenshot_redaction_effect, redaction.hierarchy_redaction_effect, redaction.redaction_justification])) };
    };
    const imported = parseStudyMethodProfileLibrary(input);
    expect(query(imported)).toEqual(expected);
    await saveResearchMethodSelection(JSON.stringify({ profile: imported.profiles[0], selectedLevels: {},
      interaction_traces: imported.interaction_traces, referenced_artifacts: imported.referenced_artifacts }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; interaction_traces: unknown; referenced_artifacts: unknown };
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], interaction_traces: saved.interaction_traces,
      referenced_artifacts: saved.referenced_artifacts });
    expect(restored).toEqual(imported);
    expect(query(restored)).toEqual(expected);
    expect(restored.referenced_artifacts?.some((artifact) => artifact.artifact_id === "image2")).toBe(true);
    expect(query(restored).members.some((row) => row[0] === "e2")).toBe(false);
    // Necessity: without the typed records, descriptors alone cannot answer these relational queries.
    expect(query(parseStudyMethodProfileLibrary({ profiles: input.profiles, referenced_artifacts: input.referenced_artifacts })))
      .toEqual({ members: [], redactions: [] });
    const shuffled = structuredClone(input);
    shuffled.interaction_traces[0]!.interaction_events.reverse();
    expect(parseStudyMethodProfileLibrary(shuffled).interaction_traces).toEqual(shuffled.interaction_traces);
    expect(query(parseStudyMethodProfileLibrary(shuffled))).toEqual(expected); // Positions, not accidental JSON array order.
    const noQualifyingWebElements = structuredClone(input);
    noQualifyingWebElements.interaction_traces[0]!.interaction_events[1]!.interaction_redactions![0]!.selected_element_ids = [];
    expect(parseStudyMethodProfileLibrary(noQualifyingWebElements).interaction_traces).toEqual(noQualifyingWebElements.interaction_traces);
    for (const mutate of [
      (x: typeof input) => { x.interaction_traces[0]!.interaction_events[0]!.hierarchy_artifact_id = "hierarchy3"; },
      (x: typeof input) => { x.interaction_traces[0]!.interaction_events[0]!.gesture_artifact_id = "gesture3"; },
      (x: typeof input) => { x.interaction_traces[0]!.interaction_events.forEach((event) => { event.event_sequence_position = 1 - event.event_sequence_position; }); },
      (x: typeof input) => { x.interaction_traces[0]!.interaction_events.push({ interaction_event_id: "e2", event_sequence_position: 2, screenshot_artifact_id: "image2", hierarchy_artifact_id: "hierarchy2", gesture_artifact_id: "gesture2" }); },
      (x: typeof input) => { x.interaction_traces[0]!.interaction_events[0]!.interaction_redactions![0]!.redacted_hierarchy_artifact_id = "hierarchy3-redacted"; },
      (x: typeof input) => { x.interaction_traces[0]!.interaction_events[0]!.interaction_redactions = []; },
      (x: typeof input) => { x.interaction_traces[0]!.interaction_events[1]!.interaction_redactions![0]!.hierarchy_redaction_effect = "corresponding_text_content_tagged"; },
      (x: typeof input) => { x.interaction_traces[0]!.interaction_events[1]!.interaction_redactions![0]!.redaction_selection_basis = "selected_ui_element"; },
    ]) {
      const changed = structuredClone(input);
      mutate(changed);
      const parsed = parseStudyMethodProfileLibrary(changed);
      expect(parsed.interaction_traces).toEqual(changed.interaction_traces);
      expect(parsed.referenced_artifacts).toEqual(changed.referenced_artifacts);
      expect(query(parsed)).not.toEqual(expected);
      await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], selectedLevels: {},
        interaction_traces: parsed.interaction_traces, referenced_artifacts: parsed.referenced_artifacts }));
      const savedMutant = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; interaction_traces: unknown; referenced_artifacts: unknown };
      expect(parseStudyMethodProfileLibrary({ profiles: [savedMutant.profile], interaction_traces: savedMutant.interaction_traces,
        referenced_artifacts: savedMutant.referenced_artifacts })).toEqual(parsed);
    }
    for (const mutate of [
      (x: typeof input) => { x.referenced_artifacts.pop(); },
      (x: typeof input) => { x.referenced_artifacts[0]!.digest = "not-a-digest"; },
      (x: typeof input) => { x.interaction_traces[0]!.interaction_events[1]!.event_sequence_position = 0; },
      (x: typeof input) => { x.interaction_traces[0]!.interaction_events[1]!.interaction_event_id = "e1"; },
      (x: typeof input) => { x.interaction_traces[0]!.interaction_events[0]!.interaction_redactions![0]!.hierarchy_redaction_effect = null as never; },
      (x: typeof input) => { x.interaction_traces[0]!.source_work_id = "another-source"; },
      (x: typeof input) => { x.interaction_traces[0]!.trace_record_origin = ["analyst_constructed_example"] as never; },
      (x: typeof input) => { x.interaction_traces[0]!.interaction_events[0]!.interaction_redactions![0]!.selected_element_ids = []; },
      (x: typeof input) => { x.interaction_traces[0]!.interaction_events[1]!.interaction_redactions![0]!.target_region_id = undefined; },
    ]) {
      const invalid = structuredClone(input);
      mutate(invalid);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
    }
    expect(compileNativeMethodProfile(restored.profiles[0]!).ok).toBe(false);
  });

  itWithPrivateCorpus("preserves ODIM trace and screen descriptions independently of shared payloads", async () => {
    const input = odimInteractionTraceExample(rawProfiles().find((row) => row.source_work_id === "doi:10.1145/3743726"));
    const persist = async (value: typeof input) => {
      const parsed = parseStudyMethodProfileLibrary(value);
      await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], selectedLevels: {},
        interaction_traces: parsed.interaction_traces, referenced_artifacts: parsed.referenced_artifacts }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
      return parseStudyMethodProfileLibrary({ profiles: [saved.profile], interaction_traces: saved.interaction_traces,
        referenced_artifacts: saved.referenced_artifacts });
    };
    expect((await persist(input)).interaction_traces).toEqual(input.interaction_traces);
    for (const field of ["trace_description", "screen_description"]) {
      for (const value of [undefined, null, "", "  supplied\nUnicode: café 日本語 <script>not executable</script>  "]) {
        const changed = structuredClone(input);
        const trace = changed.interaction_traces[0]!;
        const owner = field === "trace_description" ? trace : trace.interaction_events[0]!;
        if (value === undefined) Reflect.deleteProperty(owner, field);
        else Reflect.set(owner, field, value);
        const restored = await persist(changed);
        expect(restored.interaction_traces).toEqual(changed.interaction_traces);
        expect(restored.referenced_artifacts).toEqual(input.referenced_artifacts);
        if (field === "trace_description") expect(trace.interaction_events).toEqual(input.interaction_traces[0]!.interaction_events);
        else {
          expect(trace.trace_description).toBe(input.interaction_traces[0]!.trace_description);
          expect(trace.interaction_events[1]).toEqual(input.interaction_traces[0]!.interaction_events[1]);
        }
      }
      for (const value of [0, false, [], { text: "not a string" }]) {
        const invalid = structuredClone(input);
        const trace = invalid.interaction_traces[0]!;
        Reflect.set(field === "trace_description" ? trace : trace.interaction_events[0]!, field, value);
        const before = await loadResearchMethodSelection();
        await expect(persist(invalid)).rejects.toThrow(field);
        expect(await loadResearchMethodSelection()).toBe(before);
      }
    }
    const shared = structuredClone(input);
    shared.interaction_traces[0]!.interaction_events[1]!.screenshot_artifact_id = "image1";
    const second = structuredClone(shared.interaction_traces[0]!);
    second.interaction_trace_id = "example:another-trace";
    second.trace_description = "Independent trace description";
    second.interaction_events[0]!.screen_description = "Independent screen description with reused event/payload identity";
    shared.interaction_traces.push(second);
    expect((await persist(shared)).interaction_traces).toEqual(shared.interaction_traces);
    expect(second.interaction_events[0]!.interaction_event_id).toBe(shared.interaction_traces[0]!.interaction_events[0]!.interaction_event_id);
    expect(second.interaction_events[0]!.screen_description).not.toBe(shared.interaction_traces[0]!.interaction_events[0]!.screen_description);
  });

  itWithPrivateCorpus("queries ODIM's prospective paired capture and gesture quality after import and restore", async () => {
    const expected = [
      { id: "odim.capture_snapshot", required: ["screenshot", "view_hierarchy"], optional: [],
        absentIsIncomplete: true, association: undefined, presenceEstablishesCorrectness: undefined },
      { id: "odim.complete_event", required: ["screenshot", "view_hierarchy"], optional: ["gesture"],
        absentIsIncomplete: undefined, association: "gesture_to_most_recent_paired_snapshot", presenceEstablishesCorrectness: false },
    ];
    const query = (profile: ReturnType<typeof parseStudyMethodProfileLibrary>["profiles"][number]) =>
      (profile.method_operations as Array<Record<string, unknown>>).filter((operation) => operation.required_event_payload_roles)
        .map((operation) => ({ id: operation.operation_id, required: [...operation.required_event_payload_roles as string[]].sort(),
          optional: Array.isArray(operation.optional_event_payload_roles) ? [...operation.optional_event_payload_roles as string[]].sort() : undefined,
          absentIsIncomplete: operation.missing_gesture_marks_incomplete,
          association: operation.event_payload_association, presenceEstablishesCorrectness: operation.gesture_presence_implies_correctness }));
    const profile = parseStudyMethodProfileLibrary({ profiles: [rawProfiles().find((row) => row.source_work_id === "doi:10.1145/3743726")] }).profiles[0]!;
    expect(query(profile)).toEqual(expected);
    await saveResearchMethodSelection(JSON.stringify({ profile, selectedLevels: {} }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
    expect(restored).toEqual(profile);
    expect(query(restored)).toEqual(expected);
    // Composition is a set; changing its serialized order is not a different method.
    const reordered = structuredClone(restored);
    for (const operation of reordered.method_operations as Array<Record<string, unknown>>) {
      if (Array.isArray(operation.required_event_payload_roles)) operation.required_event_payload_roles.reverse();
    }
    const reparsed = parseStudyMethodProfileLibrary({ profiles: [reordered] }).profiles[0]!;
    expect(reparsed).toEqual(reordered);
    expect(query(reparsed)).toEqual(expected);
    const omitted = structuredClone(restored);
    for (const operation of omitted.method_operations as Array<Record<string, unknown>>) {
      for (const key of ["required_event_payload_roles", "optional_event_payload_roles", "event_payload_association",
        "missing_gesture_marks_incomplete", "gesture_presence_implies_correctness"]) delete operation[key];
    }
    expect(query(parseStudyMethodProfileLibrary({ profiles: [omitted] }).profiles[0]!)).toEqual([]);
    for (const [id, change] of [
      ["odim.capture_snapshot", { required_event_payload_roles: ["screenshot"] }],
      ["odim.capture_snapshot", { missing_gesture_marks_incomplete: false }],
      ["odim.capture_snapshot", { optional_event_payload_roles: ["gesture"] }],
      ["odim.complete_event", { required_event_payload_roles: ["screenshot", "view_hierarchy", "gesture"], optional_event_payload_roles: [] }],
      ["odim.complete_event", { gesture_presence_implies_correctness: true }],
      ["odim.complete_event", { event_payload_association: undefined }],
    ] as const) {
      const mutant = structuredClone(restored);
      Object.assign((mutant.method_operations as Array<Record<string, unknown>>).find((operation) => operation.operation_id === id)!, change);
      // A shape-valid alternative is not ODIM's source declaration. Each probe is independent.
      expect(query(parseStudyMethodProfileLibrary({ profiles: [mutant] }).profiles[0]!)).not.toEqual(expected);
    }
    // These are prospective method declarations, not captured instances or execution authorization.
    expect(compileNativeMethodProfile(restored).ok).toBe(false);
  });

  itWithPrivateCorpus("queries source-backed grouped subset semantics after import and IndexedDB restore", async () => {
    const expected = [
      { operation_id: "dismissed.keep_last", scope: ["dismissed.burst_group"],
        basis: "declared_group_membership", fields: [], rule: "LAST" },
      { operation_id: "annotif.summary_filter", scope: ["annotif.app_day_clusters"],
        basis: "field_equality", fields: ["collector.group_key"], rule: "DISCARD_SUMMARY_IF_NON_SUMMARY_EXISTS" },
      { operation_id: "annotif.keep_first_hash", scope: ["annotif.app_day_clusters"],
        basis: "field_equality", fields: ["collector.package", "collector.content_hash"], rule: "FIRST" },
    ];
    const query = (profile: ReturnType<typeof parseStudyMethodProfileLibrary>["profiles"][number]) => {
      const keys = new Map(profile.method_settings.map((setting) => [setting.method_setting_id, setting.method_parameter_key]));
      return (profile.method_operations as Array<Record<string, unknown>>).filter((operation) => operation.selection_rule)
        .map((operation) => ({ operation_id: operation.operation_id, scope: operation.group_scope_operation_ids,
          basis: operation.grouping_basis, fields: (operation.equality_key_setting_ids as string[]).map((id) => keys.get(id)),
          rule: operation.selection_rule }));
    };
    for (const work of ["doi:10.1145/3229434.3229445", "doi:10.1145/3365610.3365611"]) {
      const profile = parseStudyMethodProfileLibrary({ profiles: [rawProfiles().find((row) => row.source_work_id === work)] }).profiles[0]!;
      await saveResearchMethodSelection(JSON.stringify({ profile, selectedLevels: {} }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
      const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
      const sourceExpected = expected.filter((row) => row.operation_id.startsWith(work.endsWith("3229445") ? "dismissed." : "annotif."));
      expect(query(restored)).toEqual(sourceExpected);
      expect(restored).toEqual(profile);
      // The four terms are necessary for this structured query, not for prose preservation.
      const withoutTerms = structuredClone(restored);
      for (const operation of withoutTerms.method_operations as Array<Record<string, unknown>>) {
        for (const key of ["group_scope_operation_ids", "grouping_basis", "equality_key_setting_ids", "selection_rule"]) delete operation[key];
      }
      expect(query(parseStudyMethodProfileLibrary({ profiles: [withoutTerms] }).profiles[0]!)).toEqual([]);
      const mutant = structuredClone(restored);
      const operations = mutant.method_operations as Array<Record<string, unknown>>;
      const first = operations.find((operation) => operation.selection_rule)!;
      first.selection_rule = first.selection_rule === "LAST" ? "FIRST" : "LAST";
      // A shape-valid policy is not necessarily the paper's policy.
      expect(query(parseStudyMethodProfileLibrary({ profiles: [mutant] }).profiles[0]!)).not.toEqual(sourceExpected);
      if (work.endsWith("3365611")) {
        const firstHash = operations.find((operation) => operation.operation_id === "annotif.keep_first_hash")!;
        expect(firstHash.depends_on).toEqual(["annotif.summary_filter"]);
        expect(firstHash.group_scope_operation_ids).toEqual(["annotif.app_day_clusters"]);
        const summary = restored.method_settings.find((setting) => setting.method_parameter_key === "server.group_summary_disposition")!;
        expect(JSON.parse(String(summary.method_value_json))).toContain("without a singleton-cardinality rule");
        // Each shape-valid mutant independently loses a source-backed distinction.
        const [packageId, hashId] = firstHash.equality_key_setting_ids as string[];
        const groupId = restored.method_settings.find((setting) => setting.method_parameter_key === "collector.group_key")!.method_setting_id;
        for (const change of [{ selection_rule: "LAST" },
          { group_scope_operation_ids: ["annotif.age_filter"] },
          { equality_key_setting_ids: [packageId] }, { equality_key_setting_ids: [hashId] },
          { equality_key_setting_ids: [packageId, hashId, groupId] }]) {
          const changed = structuredClone(restored);
          Object.assign((changed.method_operations as Array<Record<string, unknown>>)
            .find((operation) => operation.operation_id === "annotif.keep_first_hash")!, change);
          expect(query(parseStudyMethodProfileLibrary({ profiles: [changed] }).profiles[0]!)).not.toEqual(sourceExpected);
        }
      }
      expect(compileNativeMethodProfile(restored).ok).toBe(false);
    }
  });

  itWithPrivateCorpus.each([
    ["doi:10.1145/3229434.3229445", "dismissed", 43, 17],
    ["doi:10.1145/3365610.3365611", "annotif", 40, 12],
    ["doi:10.1145/3743726", "odim", 39, 10],
    ["doi:10.1145/3340764.3340765", "clear-all", 67, 23],
    ["doi:10.1145/2858036.2858348", "van-berkel", 76, 16],
    ["doi:10.1145/2750858.2807542", "jones", 57, 19],
  ] as const)("preserves source admission %s without promoting the full profile", async (workId, name, atomCount, operationCount) => {
    const raw = rawProfiles().find((profile) => profile.source_work_id === workId);
    expect(raw).toBeDefined();
    const audit = JSON.parse(readFileSync(privateCorpusPath(`ontology-sublation-20260831/post-freeze-source-audits/${name}.json`), "utf8")) as {
      disclosed_atoms: Array<{ key: string; value: unknown }>;
      method_operations: Array<Record<string, unknown>>;
      source_configuration_repairs: Array<{ topology?: string; configuration_axis: string; conditional_branches?: string[]; conditional_atom_keys?: string[] }>;
    };
    const profile = parseStudyMethodProfileLibrary({ profiles: [raw] }).profiles[0]!;
    expect(profile.method_settings).toHaveLength(atomCount);
    expect(profile.method_operations).toEqual(audit.method_operations);
    expect(profile.method_operations).toHaveLength(operationCount);
    for (const atom of audit.disclosed_atoms) {
      const setting = profile.method_settings.find((row) => row.method_parameter_key === atom.key)!;
      expect(JSON.parse(String(setting.method_value_json))).toEqual(atom.value);
      expect(setting.contract_bindings).toEqual([]);
      const documentaryKeys = { dismissed: ["provenance.claimed_added_material"],
        annotif: ["collector.background_service_claim"], odim: ["system.workflow_stages"],
        "clear-all": ["artifact.paper_linked_release", "artifact.release_runtime_context"],
        "van-berkel": ["quality.application_name_loss", "quality.locked_screen_scope", "quality.notification_data_missing",
          "provenance.threshold_recommendation", "analysis.revisitation_first_bin_proposal", "artifact.primary_version"],
        jones: ["provenance.method_adoption", "provenance.causal_interpretation", "provenance.limitations"] }[name];
      if (documentaryKeys.includes(atom.key)) {
        // Existing documentary receipts preserve facts; they are execution-ineligible.
        expect(setting.method_execution_route).toBe("receipt_conformance");
        expect(setting.method_execution_destination_id).toBe("chronicle.profile-protocol-documentary-registry");
      } else if (admittedAndroidCalculationReceipts[setting.method_setting_id]) {
        expectAdmittedAndroidCalculationReceipt(setting);
      } else {
        expect(setting.method_implementation_status).toBe("specification_only");
        expect(setting.executor_id).toBeUndefined();
      }
    }
    const space = profile.method_configuration_space as {
      invariant_method_setting_ids: string[];
      method_configuration_groups: Array<Record<string, unknown>>;
    };
    if (name === "jones") {
      const setting = (key: string) => profile.method_settings.find((row) => row.method_parameter_key === key)!;
      const operations = profile.method_operations as Array<Record<string, unknown>>;
      const sequence = operations.find((row) => row.operation_id === "jones.FB_sequence")!;
      expect(sequence).toMatchObject({
        sequence_encoding_rule: "first_vs_previously_seen_in_partition",
        sequence_scope_operation_ids: ["jones.sessions"],
        sequence_identity_setting_ids: [setting("schema.FB_application_identity").method_setting_id],
        sequence_first_symbol_setting_id: setting("derive.first_occurrence_symbol").method_setting_id,
        sequence_repeat_symbol_setting_id: setting("derive.repeated_occurrence_symbol").method_setting_id,
      });
      expect(JSON.parse(String(setting("derive.first_occurrence_symbol").method_value_json))).toBe("F");
      expect(JSON.parse(String(setting("derive.repeated_occurrence_symbol").method_value_json))).toBe("B");
      expect(operations.find((row) => row.operation_id === "jones.app_support")!.depends_on).toEqual(["jones.acquire"]);
      expect(operations.find((row) => row.operation_id === "jones.app_intervals")!.depends_on).toEqual(["jones.app_support", "jones.general_eligibility"]);
      expect(operations.find((row) => row.operation_id === "jones.phase_summaries")!.consumes).toEqual(["strategy labels", "F/B strings"]);
      expect(JSON.parse(String(setting("derive.curve_vectors").method_value_json))).toMatchObject({ dimensions: 15, normalization_weighting_formula: null });
      expect(JSON.parse(String(setting("evidence.source_discrepancies").method_value_json))).toMatchObject({
        cited_histogram_bin_conflict: { Jones_related_work_attribute_to_Adar: 15, Adar_primary_actual: 16, Jones_own_method: 15 },
      });
      expect(space.method_configuration_groups.filter(requiresConfigurationSelection)).toHaveLength(0);
      for (const atom of audit.disclosed_atoms.filter((row) => /^(output|evidence|provenance)\./.test(row.key))) {
        expect(space.invariant_method_setting_ids).not.toContain(setting(atom.key).method_setting_id);
      }
    }
    if (name === "van-berkel") {
      const setting = (key: string) => profile.method_settings.find((row) => row.method_parameter_key === key)!;
      const value = (key: string) => JSON.parse(String(setting(key).method_value_json)) as Record<string, unknown>;
      expect(setting("model.constant_gap_predicate").method_target_layer).toBe("model");
      expect(value("model.constant_gap_predicate")).toMatchObject({ continuous_condition: "Gap < T", new_condition: "Gap >= T", unit: "milliseconds" });
      expect(value("model.one_rule")).not.toHaveProperty("selected_attribute");
      expect(value("output.one_rule_fitted_attribute").selected_attribute).toBe("hour");
      expect(value("participant.eligibility")).toEqual({ required: "owns Android-based smartphone" });
      expect(value("output.notification_unlock_table").rows).toHaveLength(16);
      expect((value("output.notification_unlock_table").rows as unknown[][]).some((row) => row[0] === 15)).toBe(false);
      expect(value("output.participant_response_table").rows).toHaveLength(18);
      expect(value("analysis.unlock_answer_ratio_correlation").correlation_method).toBeNull();
      expect(value("analysis.notification_continuation_ratio_correlation").correlation_method).toBeNull();
      expect(setting("analysis.labelled_objective_duration").method_target_layer).toBe("derived_feature");
      expect(setting("quality.ESM_response_latency_outliers").method_target_layer).toBe("analysis_record_set");
      const operations = profile.method_operations as Array<Record<string, unknown>>;
      expect(operations.find((row) => row.operation_id === "van_berkel.labelled_duration")!.depends_on).toEqual(["van_berkel.label_and_features"]);
      expect(operations.find((row) => row.operation_id === "van_berkel.one_rule_classifier")!.part_of_operation).toBe("van_berkel.validation_campaign");
      expect(space.method_configuration_groups.filter(requiresConfigurationSelection)).toHaveLength(0);
      for (const key of ["model.constant_gap_predicate", "model.similar_sets_basis", "model.one_rule", "analysis.threshold_sweep",
        "output.one_rule_fitted_attribute", "analysis.revisitation_first_bin_proposal", "evidence.event_order_pairing"]) {
        expect(space.invariant_method_setting_ids).not.toContain(setting(key).method_setting_id);
      }
    }
    if (name === "clear-all") {
      const operations = profile.method_operations as Array<Record<string, unknown>>;
      const byId = (id: string) => operations.find((operation) => operation.operation_id === id)!;
      const selection = byId("clear_all.visual_group_selection");
      const fieldId = (key: string) => profile.method_settings.find((setting) => setting.method_parameter_key === key)!.method_setting_id;
      expect(selection).toMatchObject({ grouping_basis: "raw_string_concatenation",
        group_scope_operation_ids: ["clear_all.snapshot_partition"],
        concatenated_key_setting_ids: [fieldId("input.code_package_name"), fieldId("input.code_group_key")],
        empty_if_absent_key_setting_ids: [fieldId("input.code_group_key")],
        selection_rule: "RETAIN_SUMMARIES_IF_PRESENT_ELSE_ALL" });
      expect(byId("clear_all.raw_clearability").selection_rule).toBeUndefined();
      expect(byId("clear_all.raw_clearability").depends_on).toEqual(["clear_all.release_input_boundary"]);
      expect(byId("clear_all.clearability_distribution").selection_rule).toBe("LAST");
      expect(byId("clear_all.priority_distribution").selection_rule).toBe("LAST");
      expect(byId("clear_all.snapshot_partition").depends_on).toEqual(["clear_all.release_input_boundary"]);
      expect(byId("clear_all.appearance_age").depends_on).not.toContain("clear_all.visual_group_selection");
      expect(byId("clear_all.snapshot_hour_coverage").depends_on).toEqual(["clear_all.release_input_boundary"]);
      expect(byId("clear_all.rank_distribution").depends_on).toContain("clear_all.supplied_category_map");
      expect(byId("clear_all.rank_distribution").depends_on).not.toContain("clear_all.app_occurrence_and_categories");
    }
    const conditional = space.method_configuration_groups.filter((group) =>
      group.method_configuration_group_kind === "conditional_joint_protocol");
    const sourceConditions = audit.source_configuration_repairs.filter((repair) => repair.conditional_branches);
    expect(conditional).toHaveLength(sourceConditions.length);
    for (const repair of sourceConditions) {
      const group = conditional.find((row) => (row.method_configuration_axis as string[])
        .includes(repair.configuration_axis))!;
      const levels = group.method_configuration_levels as Array<{
        branch_method_setting_ids: string[];
        included_method_setting_ids: string[];
      }>;
      const sourceIds = repair.conditional_atom_keys!.map((key) =>
        profile.method_settings.find((row) => row.method_parameter_key === key)!.method_setting_id);
      expect(levels).toHaveLength(1);
      expect(levels[0]!.branch_method_setting_ids).toEqual(sourceIds);
      // Membership is conditional, never an instruction to apply every branch.
      expect(levels[0]!.included_method_setting_ids).toEqual([]);
      expect(requiresConfigurationSelection(group)).toBe(false);
      for (const clause of repair.conditional_branches!) {
        expect(JSON.stringify(conditional)).toContain(JSON.stringify(clause).slice(1, -1));
      }
      for (const key of repair.conditional_atom_keys!) {
        const setting = profile.method_settings.find((row) => row.method_parameter_key === key)!;
        expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
      }
    }
    const readinessChanged = structuredClone(profile);
    const changedSpace = readinessChanged.method_configuration_space as typeof space;
    for (const group of changedSpace.method_configuration_groups.filter((row) =>
      row.method_configuration_group_kind === "conditional_joint_protocol")) {
      group.unresolved_method_setting_ids = [];
    }
    for (const setting of readinessChanged.method_settings) setting.method_implementation_status = "native";
    const restoredMembership = parseStudyMethodProfileLibrary({ profiles: [readinessChanged] }).profiles[0]!
      .method_configuration_space as typeof space;
    expect(restoredMembership.method_configuration_groups.filter((row) =>
      row.method_configuration_group_kind === "conditional_joint_protocol").map((row) => row.method_configuration_levels))
      .toEqual(conditional.map((row) => row.method_configuration_levels));
    if (name === "odim") {
      for (const key of ["repair.long_trace_segmentation", "evaluation.raw_capture_protocol",
        "evaluation.capture_accuracy_order", "evaluation.usability_protocol", "evaluation.llm_baseline",
        "evaluation.post_trace_questionnaire", "evaluation.llm_description_quality_rating"]) {
        const setting = profile.method_settings.find((row) => row.method_parameter_key === key)!;
        expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
      }
    }
    const enumerated = enumerateMethodConfigurations(profile);
    expect(enumerated.ok).toBe(true);
    if (enumerated.ok) {
      expect(enumerated.selections).toHaveLength(name === "odim" ? 5 : 1);
      for (const selection of enumerated.selections) {
        expect(compileNativeMethodProfile(profile, undefined, selection).ok).toBe(false);
      }
    }
    await saveResearchMethodSelection(JSON.stringify({ profile, selectedLevels: {} }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
    expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]).toEqual(profile);
  });

  itWithPrivateCorpus("includes both Healthy Mind study-wide analyses with each notification arm", () => {
    const raw = rawProfiles().find((profile) => profile.source_work_id === "doi:10.1371/journal.pone.0169162")!;
    const profile = parseStudyMethodProfileLibrary({ profiles: [raw] }).profiles[0]!;
    const groups = (profile.method_configuration_space as {
      method_configuration_groups: Array<{
        method_configuration_group_kind: string;
        method_configuration_levels: Array<{ method_configuration_level_id: string; included_method_setting_ids: string[] }>;
      }>;
    }).method_configuration_groups;
    const fixed = groups.filter((group) => group.method_configuration_group_kind === "fixed_pipeline_stage_component");
    expect(fixed).toHaveLength(2);
    expect(groups.filter(requiresConfigurationSelection)).toHaveLength(1);
    const enumerated = enumerateMethodConfigurations(profile);
    expect(enumerated.ok).toBe(true);
    if (!enumerated.ok) return;
    expect(enumerated.selections).toHaveLength(3);
    const requiredKeys = ["intervention.tool_inventory", "usage.notifications_received", "analysis.pairwise_d_gate",
      "analysis.interview_schedule", "analysis.qualitative_method"];
    const requiredIds = requiredKeys.map((key) => profile.method_settings.find((setting) =>
      setting.method_parameter_key === key)!.method_setting_id);
    for (const selection of enumerated.selections) {
      expect(fixed.every((group) => selection.selectedLevelIds.includes(group.method_configuration_levels[0]!.method_configuration_level_id))).toBe(true);
      expect(requiredIds.every((id) => selection.effectiveSettingIds.includes(id))).toBe(true);
      expect(compileNativeMethodProfile(profile, undefined, selection).readiness.configuration.blockers).toEqual([]);
    }
  });

  itWithPrivateCorpus("keeps receipt-only evidence and level-local facts out of space-wide method selection", () => {
    for (const profile of rawProfiles()) {
      const space = profile.method_configuration_space as {
        invariant_method_setting_ids: string[];
        documentary_method_setting_ids: string[];
        method_configuration_groups: Array<{
          method_configuration_group_kind: string;
          documentary_method_setting_ids: string[];
          unresolved_method_setting_ids: string[];
          method_configuration_levels: Array<{ included_method_setting_ids: string[] }>;
        }>;
      };
      const globalIds = new Set(space.invariant_method_setting_ids.concat(space.documentary_method_setting_ids));
      for (const group of space.method_configuration_groups.filter((item) =>
        ["source_evidence_not_method_decision", "source_results_and_provenance_not_method_settings"]
          .includes(item.method_configuration_group_kind))) {
        for (const id of group.documentary_method_setting_ids.concat(group.unresolved_method_setting_ids)) {
          expect(globalIds.has(id), `${String(profile.source_work_id)}: evidence setting ${id} became global`).toBe(false);
        }
      }
    }
    for (const sourceWorkId of ["doi:10.1016/j.chb.2024.108281", "doi:10.1016/j.pmcj.2017.01.007"]) {
      const profile = rawProfiles().find((row) => row.source_work_id === sourceWorkId)!;
      const space = profile.method_configuration_space as {
        documentary_method_setting_ids: string[];
        method_configuration_groups: Array<{
          method_configuration_group_kind: string;
          documentary_method_setting_ids: string[];
        }>;
      };
      const globalDocumentaryIds = new Set(space.documentary_method_setting_ids);
      for (const group of space.method_configuration_groups.filter((item) =>
        item.method_configuration_group_kind === "source_configuration_alternative")) {
        for (const id of group.documentary_method_setting_ids) {
          expect(globalDocumentaryIds.has(id), `${sourceWorkId}: alternative setting ${id} became global`).toBe(false);
        }
      }
    }
  });

  // Exercise every retained profile; the checks below guard paper-specific distinctions.
  itWithPrivateCorpus.each(privateCorpusAvailable ? rawProfiles().map((profile) => String(profile.source_work_id)) : [])("round-trips %s without changing its settings or source selection", async (sourceWorkId) => {
    const source = rawProfiles().find((profile) => profile.source_work_id === sourceWorkId);
    expect(source).toBeDefined();
    const imported = parseStudyMethodProfileLibrary({ profiles: [source] }).profiles[0]!;
    expect(imported.method_settings).toEqual(source!.method_settings);
    expect(imported.method_configuration_space).toEqual(source!.method_configuration_space);
    const enumerated = enumerateMethodConfigurations(imported);
    expect(enumerated.ok).toBe(true);
    if (!enumerated.ok) return;
    const chosen = enumerated.selections[0]!;
    const groups = (imported.method_configuration_space as { method_configuration_groups: Array<{
      method_configuration_group_id: string;
      method_configuration_axis?: string[];
      method_configuration_levels: Array<{
        method_configuration_level_id: string;
        method_configuration_level_label: string;
        included_method_setting_ids: string[];
        branch_method_setting_ids?: string[];
      }>;
    }> }).method_configuration_groups;
    for (const group of groups.filter((candidate) =>
      (candidate as Record<string, unknown>).method_selection_semantics === "source_campaign_cells_no_user_selection")) {
      expect(group.method_configuration_levels.every((level) =>
        !chosen.selectedLevelIds.includes(level.method_configuration_level_id))).toBe(true);
      const attempted = selectMethodConfiguration(imported, {
        [group.method_configuration_group_id]: group.method_configuration_levels[0]!.method_configuration_level_id,
      });
      expect(attempted.ok).toBe(false);
      if (!attempted.ok) expect(attempted.blockers.some((blocker) => blocker.code === "nonselectable_level")).toBe(true);
    }
    const selectedLevels = Object.fromEntries(groups.flatMap((group) =>
      group.method_configuration_levels.some((level) => chosen.selectedLevelIds.includes(level.method_configuration_level_id))
        ? [[group.method_configuration_group_id, chosen.selectedLevelIds.find((id) =>
          group.method_configuration_levels.some((level) => level.method_configuration_level_id === id))!]]
        : []));
    await saveResearchMethodSelection(JSON.stringify({ profile: imported, selectedLevels }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; selectedLevels: Record<string, string> };
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
    const selection = selectMethodConfiguration(restored, saved.selectedLevels);
    expect(restored).toEqual(imported);
    expect(selection).toEqual({ ok: true, selection: chosen });
    const expectedScreenPolicies = ({
      "doi:10.1145/3422821": [["source-policy:3422821:interaction-bout", "raw_record", "screen_bout", ["screen.schema_and_constructor"]]],
      "doi:10.2196/13209": [["source-policy:13209:interaction-bout", "raw_record", "screen_bout", ["schema.screen_status_events", "phone.interaction_interval"]]],
      "doi:10.4088/jcp.15m10310": [["source-policy:jcp15m10310:screen-epoch", "raw_occurrence", "screen_bout", ["event_schema.screen_state_events", "reconstruction.epoch_boundary", "reconstruction.successive_pairing", "reconstruction.one_epoch_per_pair", "reconstruction.screen_state_basis", "reconstruction.device_screen_not_package", "reconstruction.edge_policies_unreported", "reconstruction.no_inactivity_grouping"]]],
      "doi:10.1080/15213269.2024.2334025": [
        ["source-policy:dekker2024:paper-phone-check", "raw_occurrence", "device_session", ["collector.phone_check_definition"]],
        ["source-policy:dekker2024:preregistered-app-session-grouping", "app_session", "device_session", ["prereg.phone_session_from_app_sessions"]],
      ],
    } as Record<string, Array<[string, string, string, string[]]>>)[sourceWorkId];
    if (expectedScreenPolicies) {
      const policies = restored.session_construction_policies as Array<Record<string, unknown>>;
      expect(policies).toHaveLength(expectedScreenPolicies.length);
      expect(policies.map((policy) => [policy.session_construction_policy_id, policy.session_input_layer, policy.session_output_layer,
        (policy.method_settings as Array<Record<string, unknown>>).map((setting) => setting.method_parameter_key)]))
        .toEqual(expectedScreenPolicies);
      for (const policy of policies) {
        expect(policy).not.toHaveProperty("reconstruction_strategy");
        const members = policy.method_settings as Array<Record<string, unknown>>;
        expect(members).toEqual(members.map((member) => restored.method_settings.find((setting) => setting.method_setting_id === member.method_setting_id)));
        expect(policy.source_locators).toEqual([...new Set(members.flatMap((member) => member.source_locators as string[]))]);
      }
      expect(compileNativeMethodProfile(restored, DEFAULT_BROWSER_OPTIONS).ok).toBe(false);
      if (sourceWorkId === "doi:10.4088/jcp.15m10310") {
        const boundary = restored.method_settings.find((setting) => setting.method_parameter_key === "reconstruction.epoch_boundary")!;
        expect(JSON.parse(String(boundary.method_value_json))).toEqual({ opener: "screen-on", closer: "screen-off" });
        expect(restored.method_settings.find((setting) => setting.method_parameter_key === "reconstruction.successive_pairing")?.method_value_json)
          .toBe(JSON.stringify("Pair each screen-on to the successive screen-off."));
        expect(restored.method_settings.find((setting) => setting.method_parameter_key === "reconstruction.no_inactivity_grouping"))
          .toMatchObject({ method_setting_role: "provenance", method_target_layer: "screen_bout", method_implementation_status: "specification_only" });
        for (const change of [{ session_output_layer: "device_session" }, { session_input_layer: "invented" }, { extra: true }, { reconstruction_strategy: null }, { method_settings: null },
          { source_locators: [" "] }, { method_settings: [null] },
          { method_settings: [policies[0]!.method_settings instanceof Array ? policies[0]!.method_settings[0] : undefined, { method_setting_id: "foreign" }] }]) {
          const invalid = structuredClone(source!);
          Object.assign((invalid.session_construction_policies as Array<Record<string, unknown>>)[0]!, change);
          expect(() => parseStudyMethodProfileLibrary({ profiles: [invalid] })).toThrow(/session_construction_policies/);
        }
        const duplicate = structuredClone(source!);
        (duplicate.session_construction_policies as unknown[]).push(structuredClone(policies[0]));
        expect(() => parseStudyMethodProfileLibrary({ profiles: [duplicate] })).toThrow(/duplicate policy ID/);
        for (const changed of ["duplicate", "value", "locator"]) {
          const invalid = structuredClone(source!);
          const members = (invalid.session_construction_policies as Array<{ method_settings: Array<Record<string, unknown>> }>)[0]!.method_settings;
          if (changed === "duplicate") members.push(structuredClone(members[0]!));
          if (changed === "value") members[0]!.method_value_json = '"wrong boundary"';
          if (changed === "locator") members[0]!.source_locators = ["unrelated:1"];
          expect(() => parseStudyMethodProfileLibrary({ profiles: [invalid] })).toThrow(/policy member/);
        }
      }
      if (sourceWorkId === "doi:10.1080/15213269.2024.2334025") {
        const prereg = restored.method_settings.find((setting) => setting.method_parameter_key === "prereg.phone_session_from_app_sessions")!;
        expect(JSON.parse(String(prereg.method_value_json))).toMatchObject({ merge_comparator: "<", merge_gap_ms: 500,
          input_unit: "one or more consecutive app sessions, including homescreen/phone launcher",
          gap_anchor: "closing timestamp of the former app to opening timestamp of the new app" });
        expect(prereg).toMatchObject({ method_applicability_status: "undetermined", method_unit: "milliseconds", method_comparator: "less-than", method_implementation_status: "specification_only" });
        expect(restored.method_settings.find((setting) => setting.method_parameter_key === "prereg.phone_session_count_unit")?.method_value_json)
          .toContain("per hour");
        expect(restored.method_settings.find((setting) => setting.method_parameter_key === "collector.phone_check_definition")?.method_value_json)
          .toContain("locked again");
      }
    }
    if (sourceWorkId === "doi:10.1016/j.chb.2023.107977") {
      const audit = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/source-completeness-audits/doi-10.1016-j.chb.2023.107977.json"), "utf8")) as {
        method_operations: Array<{ operation_id: string; depends_on: string[]; configuration_dependencies: string[] }>;
      };
      expect(restored.method_operations).toHaveLength(6);
      expect(restored.method_operations).toEqual(audit.method_operations);
      expect(audit.method_operations.map((operation: { operation_id: string }) => operation.operation_id)).toEqual([
        "phonestudy.screen_deduplicate", "phonestudy.call_filter", "phonestudy.screen_repair",
        "phonestudy.usage_label", "phonestudy.short_gap_merge", "phonestudy.nonusage_label",
      ]);
      const operations = restored.method_operations as Array<{ operation_id: string; depends_on: string[]; configuration_dependencies: string[] }>;
      expect(operations.find((operation) => operation.operation_id === "phonestudy.call_filter")?.configuration_dependencies)
        .toContain("profile.screen_preprocessing.id_comm_negative_logical_index");
      expect(JSON.parse(String(restored.method_settings.find((setting) =>
        setting.method_parameter_key === "profile.anomaly_repair.clause.2.off_unlocked_on_unlocked")?.method_value_json)))
        .toBe("Declared comment: OFF_UNLOCKED→ON_UNLOCKED sequences shorter than 10 seconds; released code instead compares vector-wide automatic difftime units to 10");
      expect(JSON.parse(String(restored.method_settings.find((setting) =>
        setting.method_parameter_key === "profile.screen_preprocessing.double_on_unlocked")?.method_value_json)))
        .toBe("After call-overlap and OFF_UNLOCKED→ON_UNLOCKED anomaly filtering, delete the second row of adjacent SCREEN ON_UNLOCKED→ON_UNLOCKED; before usage labeling and five-second merging");
      for (const key of ["profile.anomaly_repair.clause.2.off_unlocked_on_unlocked", "profile.screen_preprocessing.double_on_unlocked"]) {
        const setting = restored.method_settings.find((candidate) => candidate.method_parameter_key === key)!;
        expect(setting.method_implementation_status).toBe("specification_only");
        expect(setting.contract_bindings).toEqual([]);
        expect(setting.mapped_contract_slot).toEqual([]);
        expect(setting.executor_id).toBeUndefined();
        expect(setting.conformance_fixture_id).toBeUndefined();
        expect(setting.conformance_result_digest).toBeUndefined();
      }
      for (const [index, operation] of operations.entries()) {
        expect(operation.depends_on).toEqual(index ? [operations[index - 1]!.operation_id] : []);
        expect(operation.configuration_dependencies.every((key) => restored.method_settings.some((item) =>
          item.method_parameter_key === key && Array.isArray(item.source_locators) && item.source_locators.length > 0))).toBe(true);
      }
      expect(compileNativeMethodProfile(restored, undefined, chosen).ok).toBe(false);
    }
    if (sourceWorkId === "doi:10.1109/apnoms.2011.6077030") {
      const audit = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/source-completeness-audits/doi-10.1109-apnoms.2011.6077030.json"), "utf8")) as {
        method_operations: Array<{ operation_id: string; configuration_dependencies: string[]; depends_on?: string[] }>;
      };
      expect(restored.method_operations).toEqual(audit.method_operations);
      expect(audit.method_operations.map((operation) => operation.operation_id)).toEqual([
        "batterylogger.periodic_state_log", "batterylogger.five_state_time", "batterylogger.five_state_battery",
      ]);
      for (const operation of audit.method_operations) {
        for (const key of operation.configuration_dependencies) {
          const setting = restored.method_settings.find((item) => item.method_parameter_key === key);
          expect(Array.isArray(setting?.source_locators) ? setting.source_locators.length : 0,
            `${operation.operation_id}: ${key}`).toBeGreaterThan(0);
        }
      }
      expect(audit.method_operations.slice(1).every((operation) =>
        operation.depends_on?.includes("batterylogger.periodic_state_log"))).toBe(true);
      expect(compileNativeMethodProfile(restored, undefined, chosen).ok).toBe(false);
    }
    if (sourceWorkId === "doi:10.1145/2647868.2654933") {
      const audit = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/source-completeness-audits/doi-10.1145-2647868.2654933.json"), "utf8")) as {
        method_operations: Array<{ operation_id: string; configuration_dependencies: string[]; depends_on?: string[] }>;
      };
      expect(restored.method_operations).toEqual(audit.method_operations);
      expect(audit.method_operations.map((operation) => operation.operation_id)).toEqual([
        "lepri.match_sms_replies", "lepri.sms_response_rate", "lepri.sms_median_response_latency",
      ]);
      expect(audit.method_operations.slice(1).every((operation) =>
        operation.depends_on?.includes("lepri.match_sms_replies"))).toBe(true);
      for (const operation of audit.method_operations) {
        for (const key of operation.configuration_dependencies) {
          const setting = restored.method_settings.find((item) => item.method_parameter_key === key);
          expect(Array.isArray(setting?.source_locators) ? setting.source_locators.length : 0,
            `${operation.operation_id}: ${key}`).toBeGreaterThan(0);
        }
      }
      expect(compileNativeMethodProfile(restored, undefined, chosen).ok).toBe(false);
    }
    if (sourceWorkId === "doi:10.1007/978-3-642-37210-0_6") {
      const audit = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/source-completeness-audits/doi-10.1007-978-3-642-37210-0_6.json"), "utf8")) as {
        method_operations: Array<{ operation_id: string; configuration_dependencies: string[]; depends_on: string[]; data_effects: string[] }>;
      };
      expect(restored.method_operations).toEqual(audit.method_operations);
      expect(audit.method_operations.map((operation) => [operation.operation_id, operation.depends_on])).toEqual([
        ["de_montjoye.sms_response_match", []],
        ["de_montjoye.sms_response_rate", ["de_montjoye.sms_response_match"]],
        ["de_montjoye.sms_response_latency", ["de_montjoye.sms_response_match"]],
      ]);
      const match = restored.method_settings.find((setting) => setting.method_parameter_key === "feature.text_response_match")!;
      const value = JSON.parse(String(match.method_value_json)) as Record<string, unknown>;
      expect(value).toEqual({ incoming_channel: "text", outgoing_channel: "text", same_counterpart: true,
        received_text_selection: "last_received_from_same_counterpart", window_hours: 1,
        source_wording: "within an hour after user A received the last text from user B" });
      expect((match.source_locators as string[]).map((locator) => decodeURIComponent(locator.split("#audit-locator=")[1]!)))
        .toEqual([".tmp-literature-review-private/source-completeness-artifacts/doi-10.1007-978-3-642-37210-0_6/de-montjoye-2013-author.txt#lines=220-226"]);
      for (const operation of audit.method_operations) {
        expect(operation.configuration_dependencies.every((key) => restored.method_settings.some((setting) =>
          setting.method_parameter_key === key && Array.isArray(setting.source_locators) && setting.source_locators.length > 0))).toBe(true);
      }
      expect(audit.method_operations[0]!.data_effects.join(" ")).toContain("Exactly-one-hour matching eligibility");
      expect(compileNativeMethodProfile(restored, undefined, chosen).ok).toBe(false);
    }
    if (sourceWorkId === "doi:10.1145/2634317.2634325") {
      const audit = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/source-completeness-audits/doi-10.1145-2634317.2634325.json"), "utf8")) as {
        method_operations: Array<{ operation_id: string; configuration_dependencies: string[]; depends_on?: string[] }>;
      };
      expect(restored.method_operations).toEqual(audit.method_operations);
      expect(audit.method_operations.map((operation) => operation.operation_id)).toEqual([
        "hammer.screen_sessions", "hammer.session_type", "hammer.notification_response_time", "hammer.infer_notification_action",
      ]);
      const seenOperations = new Set<string>();
      for (const operation of audit.method_operations) {
        expect((operation.depends_on ?? []).every((id) => seenOperations.has(id)), operation.operation_id).toBe(true);
        for (const key of operation.configuration_dependencies) {
          const setting = restored.method_settings.find((item) => item.method_parameter_key === key);
          expect(Array.isArray(setting?.source_locators) ? setting.source_locators.length : 0,
            `${operation.operation_id}: ${key}`).toBeGreaterThan(0);
        }
        seenOperations.add(operation.operation_id);
      }
      expect(compileNativeMethodProfile(restored, undefined, chosen).ok).toBe(false);
    }
    if (sourceWorkId === "doi:10.1145/2789168.2790107") {
      expect(compileNativeMethodProfile(restored, undefined, chosen).readiness.configuration.blockers).toEqual([]);
      const settings = new Map(restored.method_settings.map((setting) => [setting.method_parameter_key, setting]));
      expect(settings.get("hush.paper_selected_result")?.method_implementation_status).toBe("specification_only");
      expect(settings.get("hush.paper_selected_result")?.method_execution_blocker_code).toBe("scientific_oracle_comparison_receipt_required");
      expect(settings.get("hush.code_state_parcel_serialization")?.method_implementation_status).toBe("specification_only");
      const devicePowerGroup = groups.find((group) => group.method_configuration_axis?.includes("device_power_model"));
      expect(devicePowerGroup?.method_configuration_levels).toHaveLength(2);
      expect(requiresConfigurationSelection(devicePowerGroup!)).toBe(false);
    }
    if (sourceWorkId === "doi:10.2196/13209") {
      expect(enumerated.selections).toHaveLength(1);
      const campaigns = groups.filter((group) =>
        (group as Record<string, unknown>).method_configuration_group_kind === "source_campaign_model_cell"
          && !group.method_configuration_axis?.includes("source_campaign_inventory"));
      expect(campaigns).toHaveLength(4);
      expect(campaigns.every((group) => group.method_configuration_levels.length === 1
        && !requiresConfigurationSelection(group)
        && chosen.selectedLevelIds.includes(group.method_configuration_levels[0]!.method_configuration_level_id))).toBe(true);
      const inventory = groups.find((group) => group.method_configuration_axis?.includes("source_campaign_inventory"))!;
      expect(inventory.method_configuration_levels).toHaveLength(18);
      expect(requiresConfigurationSelection(inventory)).toBe(false);
      expect(chosen.effectiveSettingIds).toEqual((restored.method_configuration_space as {
        invariant_method_setting_ids: string[];
      }).invariant_method_setting_ids);
    }
    if (sourceWorkId === "doi:10.1145/2634317.2634325") {
      expect(restored.method_settings).toHaveLength(66);
      expect(restored.method_settings.every((setting) =>
        Array.isArray(setting.source_locators) && setting.source_locators.length > 0)).toBe(true);
      expect(restored.session_construction_policies).toHaveLength(3);
      expect(restored.release_profiles).toHaveLength(6);
      expect(groups.every((group) => !requiresConfigurationSelection(group))).toBe(true);
      expect(restored.method_settings.find((setting) => setting.method_parameter_key === "result.status_accuracy")?.method_execution_blocker_code)
        .toBe("scientific_oracle_comparison_receipt_required");
      const invariantIds = new Set((restored.method_configuration_space as {
        invariant_method_setting_ids: string[];
      }).invariant_method_setting_ids);
      const evidence = groups.find((group) => (group as Record<string, unknown>).method_configuration_group_kind
        === "source_evidence_not_method_decision") as Record<string, unknown>;
      expect(evidence).toBeDefined();
      const evidenceIds = new Set((evidence.documentary_method_setting_ids as string[])
        .concat(evidence.unresolved_method_setting_ids as string[]));
      for (const key of ["study.volume", "result.session_gap", "result.null_session_rate",
        "result.notification_departure_to_arrival_rate_ratio",
        "result.notification_interdeparture_within_five_seconds", "result.label_filtering_table",
        "result.status_accuracy", "result.energy_impact"]) {
        const id = restored.method_settings.find((setting) => setting.method_parameter_key === key)!.method_setting_id;
        expect(evidenceIds.has(id)).toBe(true);
        expect(invariantIds.has(id)).toBe(false);
      }
      for (const key of ["feature.notification_interdeparture", "study.duration", "result.inference_arms"]) {
        const id = restored.method_settings.find((setting) => setting.method_parameter_key === key)!.method_setting_id;
        expect(invariantIds.has(id)).toBe(true);
        expect(evidenceIds.has(id)).toBe(false);
      }
      const energy = groups.find((group) => group.method_configuration_axis?.includes("energy_validation")) as Record<string, unknown>;
      const energyDeviceId = restored.method_settings.find((setting) =>
        setting.method_parameter_key === "result.energy_devices")!.method_setting_id;
      expect(energy.unresolved_method_setting_ids).toEqual([energyDeviceId]);
      expect(invariantIds.has(energyDeviceId)).toBe(false);
      expect(evidenceIds.has(energyDeviceId)).toBe(false);
    }
    if (sourceWorkId === "doi:10.1016/j.procs.2019.08.027") {
      const campaign = groups.filter((group) => (group as Record<string, unknown>).method_configuration_group_kind === "source_campaign_model_cell");
      expect(campaign).toHaveLength(3);
      expect(campaign.every((group) => group.method_configuration_levels.length === 1
        && !requiresConfigurationSelection(group))).toBe(true);
      const branchKeys = ["model.input.touch_only", "model.input.sensor_only", "model.input.combined", "model.architecture.layer_count"];
      const branchIds = branchKeys.map((key) => restored.method_settings.find((setting) => setting.method_parameter_key === key)!.method_setting_id);
      expect(campaign.flatMap((group) => group.method_configuration_levels.flatMap((level) =>
        (level as Record<string, unknown>).included_method_setting_ids as string[]))).toEqual(branchIds);
      expect(branchIds.every((id) => !chosen.effectiveSettingIds.includes(id))).toBe(true);
      expect(branchIds.every((id) => !(restored.method_configuration_space as { invariant_method_setting_ids: string[] })
        .invariant_method_setting_ids.includes(id))).toBe(true);
      const upstream = restored.method_settings.filter((setting) =>
        ["UPSTREAM_RELEASE_ONLY", "UPSTREAM_PACKET_UNVERIFIED"].includes(String(setting.source_coverage_status)));
      expect(upstream).toHaveLength(35);
      expect(upstream.every((setting) => setting.source_evidence_work_id !== sourceWorkId
        && setting.method_applicability_status === "undetermined"
        && setting.method_disclosure_status === "undetermined")).toBe(true);
      expect(upstream.every((setting) => !(restored.method_configuration_space as { invariant_method_setting_ids: string[] })
        .invariant_method_setting_ids.includes(setting.method_setting_id))).toBe(true);
    }
    if (sourceWorkId === "doi:10.1145/2470654.2481345") {
      const provisional = restored.method_settings.filter((setting) =>
        setting.source_coverage_status === "PROVISIONAL_DERIVED_INDEX_ARTICLE_UNPINNED");
      expect(provisional).toHaveLength(112);
      expect(provisional.every((setting) => setting.method_disclosure_status === "undetermined"
        && Array.isArray(setting.source_locators) && setting.source_locators.length === 1
        && !String(setting.source_locators[0]).includes("github-"))).toBe(true);
    }
    if (sourceWorkId === "doi:10.1016/j.compedu.2019.103611") {
      const invariantIds = (restored.method_configuration_space as { invariant_method_setting_ids: string[] }).invariant_method_setting_ids;
      const evidence = groups.find((group) => (group as Record<string, unknown>).method_configuration_group_kind === "source_evidence_not_method_decision") as Record<string, unknown>;
      const evidenceIds = new Set((evidence.documentary_method_setting_ids as string[]).concat(evidence.unresolved_method_setting_ids as string[]));
      for (const key of ["protocol.study_scale", "rq1.class_prevalence", "rq1.class_session_results", "apps.top_five_share",
        "apps.main_results", "apps.multitasking", "apps.notifications", "rhythm.reported_shape",
        "rq4.duration_coefficients", "rq4.frequency_coefficients", "rq5.reported_coefficients"]) {
        const id = restored.method_settings.find((setting) => setting.method_parameter_key === key)!.method_setting_id;
        expect(evidenceIds.has(id)).toBe(true);
        expect(invariantIds).not.toContain(id);
      }
      expect(invariantIds).toContain(restored.method_settings.find((setting) =>
        setting.method_parameter_key === "apps.within_user_normalization")!.method_setting_id);
      for (const key of ["apps.group_test", "rq5.block_1", "rq5.block_2", "rq5.block_3"]) {
        const method = restored.method_settings.find((setting) => setting.method_parameter_key === key)!;
        const result = restored.method_settings.find((setting) => setting.method_parameter_key === `${key}.reported_result`)!;
        expect(invariantIds).toContain(method.method_setting_id);
        expect(evidenceIds.has(result.method_setting_id)).toBe(true);
        expect(invariantIds).not.toContain(result.method_setting_id);
      }
      const topFive = restored.method_settings.find((setting) => setting.method_parameter_key === "apps.top_five")!;
      expect(evidenceIds.has(topFive.method_setting_id)).toBe(true);
      expect(invariantIds).not.toContain(topFive.method_setting_id);
      expect(invariantIds).toContain(restored.method_settings.find((setting) =>
        setting.method_parameter_key === "rq5.app_predictor_set")!.method_setting_id);
      expect(invariantIds).toContain(restored.method_settings.find((setting) =>
        setting.method_parameter_key === "apps.ringer_modes")!.method_setting_id);
      expect(evidenceIds.has(restored.method_settings.find((setting) =>
        setting.method_parameter_key === "apps.ringer_modes.reported_result")!.method_setting_id)).toBe(true);
    }
    if (sourceWorkId === "doi:10.1002/per.2309") {
      const audit = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/source-completeness-audits/doi-10.1002-per.2309.json"), "utf8")) as {
        method_operations: Array<{ operation_id: string; configuration_dependencies: string[]; depends_on: string[]; data_effects: string[] }>;
      };
      expect(restored.method_operations).toEqual(audit.method_operations);
      expect(audit.method_operations.map((operation) => [operation.operation_id, operation.depends_on])).toEqual([
        ["ruegger.identify_first_esm_response_endpoint", []],
        ["ruegger.construct_preceding_thirty_minute_timeframe", ["ruegger.identify_first_esm_response_endpoint"]],
        ["ruegger.derive_endpoint_hour_feature", ["ruegger.construct_preceding_thirty_minute_timeframe"]],
      ]);
      expect(JSON.parse(String(restored.method_settings.find((setting) => setting.method_parameter_key === "window.ends_first_esm_element")!.method_value_json)))
        .toBe("window ends at the participant's response to the first ESM element, the photographic affect meter, not final personality submission");
      expect(JSON.parse(String(restored.method_settings.find((setting) => setting.method_parameter_key === "window.preceding_thirty_minutes")!.method_value_json)))
        .toBe("smartphone-data window is the preceding 30 minutes");
      expect(JSON.parse(String(restored.method_settings.find((setting) => setting.method_parameter_key === "feature.time.anchor")!.method_value_json)))
        .toContain("only if the final offset is None");
      expect(audit.method_operations[1]!.data_effects.join(" ")).toContain("Do not universally delete out-of-window rows");
      for (const operation of audit.method_operations) {
        expect(operation.configuration_dependencies.every((key) => restored.method_settings.some((setting) =>
          setting.method_parameter_key === key && Array.isArray(setting.source_locators) && setting.source_locators.length > 0))).toBe(true);
      }
      expect(compileNativeMethodProfile(restored, undefined, chosen).ok).toBe(false);
      const invariantIds = (restored.method_configuration_space as { invariant_method_setting_ids: string[] }).invariant_method_setting_ids;
      const evidence = groups.find((group) => (group as Record<string, unknown>).method_configuration_group_kind === "source_evidence_not_method_decision") as Record<string, unknown>;
      const evidenceIds = new Set((evidence.documentary_method_setting_ids as string[]).concat(evidence.unresolved_method_setting_ids as string[]));
      for (const sensor of ["accelerometer", "bluetooth", "location", "microphone"]) {
        const planned = restored.method_settings.find((setting) => setting.method_parameter_key === `collector.${sensor}`)!;
        const observed = restored.method_settings.find((setting) => setting.method_parameter_key === `collector.${sensor}.observed_interval`)!;
        expect(invariantIds).toContain(planned.method_setting_id);
        expect(JSON.parse(planned.method_value_json as string)).not.toHaveProperty("modal_actual_minutes");
        expect(evidenceIds.has(observed.method_setting_id)).toBe(true);
        expect(invariantIds).not.toContain(observed.method_setting_id);
      }
      const initialSample = restored.method_settings.find((setting) => setting.method_parameter_key === "cohort.initial_installed_sample")!;
      expect(initialSample.method_setting_role).toBe("reporting");
      expect(evidenceIds.has(initialSample.method_setting_id)).toBe(true);
    }
    if (["doi:10.1016/j.smhl.2020.100137", "doi:10.1016/j.psychres.2023.115298",
      "doi:10.1145/2745844.2745875", "doi:10.1145/3422821",
      "doi:10.1145/3429360.3468192"].includes(sourceWorkId)) {
      const invariants = new Set((restored.method_configuration_space as { invariant_method_setting_ids: string[] }).invariant_method_setting_ids);
      const evidenceIds = new Set(groups.filter((group) =>
        (group as Record<string, unknown>).method_configuration_group_kind === "source_evidence_not_method_decision")
        .flatMap((group) => [...((group as Record<string, unknown>).documentary_method_setting_ids as string[]),
          ...((group as Record<string, unknown>).unresolved_method_setting_ids as string[])]));
      const resultKey = ({
        "doi:10.1016/j.smhl.2020.100137": "result.android_category_correlations",
        "doi:10.1016/j.psychres.2023.115298": "reporting.table2.whatsapp_text",
        "doi:10.1145/2745844.2745875": "result.user_quintiles",
        "doi:10.1145/3422821": "result.change_single",
        "doi:10.1145/3429360.3468192": "dataset.events_all",
      } as Record<string, string>)[sourceWorkId];
      const methodKey = ({
        "doi:10.1016/j.smhl.2020.100137": "analysis.correlation_method",
        "doi:10.1016/j.psychres.2023.115298": "analysis.h1_spearman_design",
        "doi:10.1145/2745844.2745875": "analysis.user_quintiles",
        "doi:10.1145/3422821": "model.single_feature_set",
        "doi:10.1145/3429360.3468192": "total_sessions.axes",
      } as Record<string, string>)[sourceWorkId];
      const result = restored.method_settings.find((setting) => setting.method_parameter_key === resultKey)!;
      const method = restored.method_settings.find((setting) => setting.method_parameter_key === methodKey)!;
      expect(evidenceIds.has(result.method_setting_id)).toBe(true);
      expect(invariants.has(result.method_setting_id)).toBe(false);
      expect(invariants.has(method.method_setting_id)).toBe(true);
      if (sourceWorkId === "doi:10.1145/3429360.3468192") {
        expect((JSON.parse(method.method_value_json as string) as { time_ranges_analyzed: unknown }).time_ranges_analyzed).toContain("morning");
        expect(restored.method_settings.find(setting => setting.method_parameter_key === "cohort.boundary_ambiguity")?.method_value_json)
          .toContain("Exactly 3.0 is explicitly excluded from the analytic high/low comparison");
        expect(restored.method_settings.find(setting => setting.method_parameter_key === "sessions.contract_missing")?.method_value_json)
          .toContain("equality at 45 seconds does not satisfy that split predicate");
      }
      if (sourceWorkId === "doi:10.1016/j.psychres.2023.115298") {
        expect(restored.method_settings.find((setting) => setting.method_parameter_key === "reporting.table2.posting")?.source_observed_setting)
          .toContain("TikTok/Instagram");
        expect(restored.method_settings.find((setting) => setting.method_parameter_key === "cohort.flowchart_ordering_ambiguity")?.source_observed_setting)
          .toContain("H1 r(449)");
      }
      if (sourceWorkId === "doi:10.1145/2745844.2745875") {
        // Physical pp.13–14, printed pp.163–164, Tables6–10: retain each cell and its printed axes/units.
        const expectedTables = {
          cpu_model: {"table6":{"device":"Galaxy S3","frequency_unit":"MHz","power_unit":"mW","utilization_basis":"100% CPU utilization","core0_frequencies":[384,594,810,1026,1242,1512],"core1_frequencies":[0,384,594,810,1026,1242,1512],"core1_zero_meaning":"core-1 turned off","power_cells":[[296,744,766,818,873,977,1047],[359,766,814,866,921,1036,1103],[411,818,866,918,973,1080,1154],[455,873,921,977,1029,1136,1217],[555,981,1029,1084,1140,1199,1277],[633,1062,1106,1158,1221,1273,1351]],"printed_asymmetries_preserved":true},"table7":{"device":"Galaxy S4","frequency_unit":"MHz","power_unit":"mW","utilization_basis":"100% CPU utilization","online_core_counts":[1,2,3,4],"frequency_columns":[384,1026,1890],"components_per_frequency":["P_B,Nc","P_delta(f_i)"],"power_cells":[[86,207,86,438,86,1358],[269,70,363,228,647,811],[351,72,464,239,917,891],[472,75,577,243,1205,962]]}},
          screen_model: {"table8":{"brightness_columns":[0,51,102,153,204,255],"brightness_unit":null,"power_unit":"mW","device_rows":["Galaxy S3","Galaxy S4"],"power_cells":[[417,452,484,511,542,573],[507,562,616,671,725,780]]}},
          gpu_model: {"table9":{"Galaxy S3":{"frequency_unit":"MHz","frequency_columns":[128,200,300,400],"printed_power_unit":"mA","state_rows":["Active","Nap"],"power_cells":[[729,975,1217,1482],[78,0,0,78]]},"Galaxy S4":{"frequency_unit":"MHz","frequency_columns":[128,200,320,450],"printed_power_unit":"mW","state_rows":["Active","Nap"],"power_cells":[[293,398,562,1034],[0,0,0,164]]}}},
          radio_models: {"table10":{"wifi":{"signal_quantity":"RSSI","signal_unit":"dBm","signal_rows":[-50,-60,-70,-80,-85],"power_unit":"mW","columns":["S3 Tx","S3 Rx","S3 Tail","S4 Tx","S4 Rx","S4 Tail"],"cells":[[564,396,242,654,451,289],[596,422,242,723,528,289],[641,431,242,1019,592,289],[704,400,242,1113,633,289],[702,382,242,892,514,289]],"tail_duration_ms_both_devices":210},"three_g_phase_parameters":{"signal_quantity":"RSSI","signal_unit":"dBm","signal_rows":[-85,-95,-105],"columns":["promotion power mW","promotion duration s","DCH tail power mW","DCH tail duration s","FACH tail power mW","FACH tail duration s"],"Galaxy S3":[[836,1.6,783,3.3,486,6.7],[836,1.6,1034,3.3,486,6.7],[836,1.6,1224,3.3,486,6.7]],"Galaxy S4":[[647,2.1,577,3.3,332,1.7],[663,2.1,679,3.3,390,1.7],[807,2.2,722,3.3,390,1.7]]},"three_g_transfer_power":{"signal_quantity":"RSSI","signal_unit":"dBm","signal_rows":[-85,-95,-105],"power_unit":"mW","columns":["S3 Tx","S3 Rx","S4 Tx","S4 Rx"],"cells":[[1414,1300,667,843],[1737,1718,835,1043],[2280,2060,1772,1545]]},"lte_state_parameters":{"state_rows":["LTE promotion","Short DRX","Long DRX","LTE tail base","DRX in IDLE"],"columns":["power mW","duration ms","periodicity ms"],"Galaxy S3":[[1200,200,"N/A"],[788,41,100],[788,45,320],[61,11000,"N/A"],[570,32,1280]],"Galaxy S4":[[1326,200,"N/A"],["N/A","N/A","N/A"],[585,30,320],[69,11000,"N/A"],[452,24,1280]]},"lte_transfer_power":{"signal_quantity":"RSRP","signal_unit":"dBm","signal_rows":[-85,-95,-105],"power_unit":"mW","columns":["S3 Tx","S3 Rx","S4 Tx","S4 Rx"],"cells":[[1218,1085,1177,938],[1683,1264,1849,1110],[1840,1271,1699,1140]]}}},
        };
        const stableIds = {
          cpu_model: "method-setting-d44e641d57278d1377b480f6", screen_model: "method-setting-e3b692e617bee2deb414043c",
          gpu_model: "method-setting-136557d262baa1615ff0124e", radio_models: "method-setting-4093f197462a12eb4326fe19",
        };
        const modelValue = (key: keyof typeof expectedTables) => {
          const setting = restored.method_settings.find(s => s.method_parameter_key === key)!;
          expect(setting.method_setting_id).toBe(stableIds[key]);
          expect(setting.method_setting_role).toBe("analysis"); expect(setting.method_target_layer).toBe("model");
          const value: unknown = JSON.parse(String(setting.method_value_json));
          expect(value).toMatchObject(expectedTables[key]);
          return value;
        };
        const cpu = modelValue("cpu_model") as typeof expectedTables.cpu_model;
        const screen = modelValue("screen_model") as typeof expectedTables.screen_model;
        const gpu = modelValue("gpu_model") as typeof expectedTables.gpu_model;
        const radio = modelValue("radio_models") as typeof expectedTables.radio_models;
        const cells = [
          cpu.table6.power_cells, cpu.table7.power_cells, screen.table8.power_cells,
          gpu.table9["Galaxy S3"].power_cells, gpu.table9["Galaxy S4"].power_cells,
          radio.table10.wifi.cells, radio.table10.three_g_phase_parameters["Galaxy S3"], radio.table10.three_g_phase_parameters["Galaxy S4"],
          radio.table10.three_g_transfer_power.cells, radio.table10.lte_state_parameters["Galaxy S3"], radio.table10.lte_state_parameters["Galaxy S4"], radio.table10.lte_transfer_power.cells,
        ].flat(2);
        expect(cells).toHaveLength(214); expect(cells.filter(cell => cell === "N/A")).toHaveLength(7);
        expect(cpu.table6.power_cells[0]![5]).toBe(977); expect(cpu.table6.power_cells[4]![1]).toBe(981);
        expect(gpu).toMatchObject({
          states: ["Active", "Nap", "Idle"],
          idle_statement: { value: 0, unit_repeated_in_prose: null, not_shown_in_table9: true },
          source_unit_conflict: "Table 9 prints Galaxy S3 values in mA and Galaxy S4 values in mW; no conversion or correction is applied",
        });
        expect(radio).toMatchObject({
          wifi_prose_states: ["Tx", "Rx", "Tail", "Idle"], wifi_figure17_states: ["IDLE", "ACTIVE", "PSM Tail"],
          wifi_figure17_idle_annotation: "0mA",
          three_g_transition_boundary: { complete_transition_rules: "delegated to references 19 and 18", displayed_table10_parameters_are_available: true },
          source_qualifications: [
            "Table 10 contains explicit 3G subtables despite the WiFi/LTE caption",
            "S4 Short DRX is printed N/A in all three columns, not zero or omitted",
            "prose describes LTE base power as zero or close to zero while Table 10 prints 61 and 69 mW; retain both without reconciliation",
            "no signal interpolation, extrapolation, state executor or numeric repairs are supplied",
          ],
        });
        const componentProtocol = restored.method_settings.find((setting) => setting.method_parameter_key === "validation.component_protocol")!;
        expect(invariants.has(componentProtocol.method_setting_id)).toBe(true);
        expect(componentProtocol.method_value_json).toContain("10 minutes");
        expect(componentProtocol.method_value_json).not.toContain("omitted");
        for (const key of ["result.component_s4_similarity", "provenance.component_validation_figure_coverage"]) {
          const id = restored.method_settings.find((setting) => setting.method_parameter_key === key)!.method_setting_id;
          expect(evidenceIds.has(id)).toBe(true);
          expect(invariants.has(id)).toBe(false);
        }
        const error = restored.method_settings.find((setting) => setting.method_parameter_key === "model.additivity_validation")!;
        expect(error.method_setting_role).toBe("reporting");
        expect(JSON.parse(error.method_value_json as string)).toEqual({ reported_error_pct: "<10" });
        expect(evidenceIds.has(error.method_setting_id)).toBe(true);
        expect(invariants.has(error.method_setting_id)).toBe(false);
        const criterion = restored.method_settings.find((setting) => setting.method_parameter_key === "cohort.inclusion_rule_conflict")!;
        expect(criterion.method_setting_role).toBe("quality_control");
        expect(criterion.method_target_layer).toBe("study_window");
        expect(JSON.parse(criterion.method_value_json as string)).toMatchObject({ comparator: ">", threshold: 10, unit: "days" });
        expect(invariants.has(criterion.method_setting_id)).toBe(true);
        expect(evidenceIds.has(restored.method_settings.find((setting) =>
          setting.method_parameter_key === "cohort.trace_duration")!.method_setting_id)).toBe(true);
      }
      if (sourceWorkId === "doi:10.1145/3422821") {
        for (const key of ["result.early_post", "result.early_change", "result.early_post_majority_vote",
          "result.early_change_majority_vote", "result.ablation_salience", "result.ablation_restricted_best",
          "result.behavioral_vs_change_features",
          "result.no_severity_level_improvement"]) {
          const id = restored.method_settings.find((setting) => setting.method_parameter_key === key)!.method_setting_id;
          expect(evidenceIds.has(id)).toBe(true);
          expect(invariants.has(id)).toBe(false);
        }
        const campaignBranchIds = new Set(groups.filter((group) =>
          (group as Record<string, unknown>).method_configuration_group_kind === "source_campaign_model_cell")
          .flatMap((group) => group.method_configuration_levels.flatMap((level) =>
            (level as Record<string, unknown>).branch_method_setting_ids as string[])));
        for (const key of ["reporting.earliest_top_five_post", "reporting.earliest_top_five_change",
          "reporting.ablation_mean_accuracy", "reporting.ablation_restricted_best"]) {
          const id = restored.method_settings.find((setting) => setting.method_parameter_key === key)!.method_setting_id;
          expect(campaignBranchIds.has(id)).toBe(true);
          expect(invariants.has(id)).toBe(false);
          expect(evidenceIds.has(id)).toBe(false);
        }
        const ablationSummary = groups.find((group) =>
          group.method_configuration_axis?.includes("chikersal3422821:ablation-reporting-summary"))!;
        const selectedFeatureAnalysis = groups.flatMap((group) => group.method_configuration_levels)
          .find((level) => level.method_configuration_level_label === "chikersal3422821:selected-feature-analysis")!;
        for (const key of ["reporting.ablation_mean_accuracy", "reporting.ablation_restricted_best"]) {
          const id = restored.method_settings.find((setting) => setting.method_parameter_key === key)!.method_setting_id;
          expect(ablationSummary.method_configuration_levels[0]?.branch_method_setting_ids).toContain(id);
          expect(selectedFeatureAnalysis.included_method_setting_ids).not.toContain(id);
        }
        expect(selectedFeatureAnalysis.included_method_setting_ids).toContain(restored.method_settings.find((setting) =>
          setting.method_parameter_key === "selection.nested_randomized_logistic")!.method_setting_id);
        const change = restored.method_settings.find((setting) => setting.method_parameter_key === "outcome.change_binary")!;
        expect(change.method_value_json).toContain("improved severity levels are outside the observed study domain");
        expect(invariants.has(change.method_setting_id)).toBe(true);
        const behavioralOnly = restored.method_settings.find((setting) =>
          setting.method_parameter_key === "analysis.behavioral_only_selection")!;
        expect(behavioralOnly.method_setting_role).toBe("analysis");
        expect(invariants.has(behavioralOnly.method_setting_id)).toBe(true);
        expect(JSON.parse(behavioralOnly.method_value_json as string)).toContain("behavioral features only");
        const hushAliases = aliases().filter((alias) => alias.alias_source_work_id === sourceWorkId);
        expect(hushAliases.filter((alias) => alias.replacement_method_setting_id === restored.method_settings.find((setting) =>
          setting.method_parameter_key === "result.ablation_salience")!.method_setting_id)).toHaveLength(18);
        expect(hushAliases.filter((alias) => alias.replacement_method_setting_id === restored.method_settings.find((setting) =>
          setting.method_parameter_key === "result.behavioral_vs_change_features")!.method_setting_id)).toHaveLength(6);
      }
    }
    expect(restored.profile_implementation_status).toBe("blocked");
  });

  itWithPrivateCorpus("keeps the linked B2SHARE dataset out of paper method profiles", () => {
    expect(rawProfiles().some((profile) => profile.source_work_id === "doi:10.23728/b2share.cgf63-kme28")).toBe(false);
  });

  itWithPrivateCorpus("selects exactly one Healthy Mind delivery arm and includes both fixed analyses", () => {
    const audit = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/source-completeness-audits/doi-10.1371-journal.pone.0169162.json"), "utf8")) as {
      configuration_verdicts: Array<{ configuration: string; atom_keys: string[] }>;
    };
    const profile = parseStudyMethodProfileLibrary({ profiles: [rawProfiles().find((row) =>
      row.source_work_id === "doi:10.1371/journal.pone.0169162")!] }).profiles[0]!;
    const space = profile.method_configuration_space as {
      method_configuration_structure: string;
      invariant_method_setting_ids: string[];
      allowed_method_combinations: unknown[];
      method_configuration_groups: Array<{
        method_configuration_group_id: string;
        method_configuration_group_kind: string;
        method_configuration_axis: string[];
        method_configuration_levels: Array<{
          method_configuration_level_id: string;
          method_configuration_level_label: string;
          branch_method_setting_ids: string[];
          included_method_setting_ids: string[];
        }>;
        unresolved_method_setting_ids: string[];
        documentary_method_setting_ids: string[];
      }>;
    };
    const selectable = space.method_configuration_groups.filter(requiresConfigurationSelection);
    expect(space.method_configuration_structure).toBe("source_declared_axes");
    expect(space.allowed_method_combinations).toEqual([]);
    expect(selectable).toHaveLength(1);
    expect(selectable[0]!.method_configuration_levels.map((level) => level.method_configuration_level_label))
      .toEqual(audit.configuration_verdicts.slice(0, 3).map((verdict: { configuration: string }) => verdict.configuration));
    const analysisGroups = space.method_configuration_groups.filter((group) =>
      group.method_configuration_group_kind === "fixed_pipeline_stage_component"
        && group.method_configuration_axis.includes("dependent_study_analysis"));
    expect(analysisGroups).toHaveLength(2);
    expect(analysisGroups.every((group) => !requiresConfigurationSelection(group))).toBe(true);
    const armKeys = new Set(audit.configuration_verdicts.slice(0, 3)
      .flatMap((verdict: { atom_keys: string[] }) => verdict.atom_keys));
    const analysisOnlyKeys = new Set(audit.configuration_verdicts.slice(3)
      .flatMap((verdict: { atom_keys: string[] }) => verdict.atom_keys)
      .filter((key: string) => !armKeys.has(key)));
    const analysisOnlyIds = profile.method_settings.filter((setting) =>
      typeof setting.method_parameter_key === "string" && analysisOnlyKeys.has(setting.method_parameter_key)).map((setting) => setting.method_setting_id);
    const evidenceIds = space.method_configuration_groups
      .filter((group) => group.method_configuration_group_kind === "source_evidence_not_method_decision")
      .flatMap((group) => group.documentary_method_setting_ids.concat(group.unresolved_method_setting_ids));
    expect(analysisOnlyIds).toHaveLength(analysisOnlyKeys.size);
    expect(analysisOnlyIds.every((id) => !space.invariant_method_setting_ids.includes(id))).toBe(true);
    const stageIds = analysisGroups.flatMap((group) => group.method_configuration_levels[0]!.included_method_setting_ids);
    expect(analysisOnlyIds.every((id) => stageIds.includes(id) || evidenceIds.includes(id))).toBe(true);
    const enumerated = enumerateMethodConfigurations(profile);
    expect(enumerated.ok).toBe(true);
    if (!enumerated.ok) return;
    expect(enumerated.selections).toHaveLength(3);
    const branchKeys = ["intelligent.context_sampling_period", "daily.frequency", "occasional.frequency"];
    const branchIds = branchKeys.map((key) => profile.method_settings.find((setting) =>
      setting.method_parameter_key === key)!.method_setting_id);
    for (const [index, level] of selectable[0]!.method_configuration_levels.entries()) {
      const selection = selectMethodConfiguration(profile, {
        [selectable[0]!.method_configuration_group_id]: level.method_configuration_level_id,
      });
      expect(selection.ok).toBe(true);
      if (!selection.ok) continue;
      expect(selection.selection.effectiveSettingIds).toContain(branchIds[index]);
      expect(branchIds.filter((_, other) => other !== index).every((id) =>
        !selection.selection.effectiveSettingIds.includes(id))).toBe(true);
      expect(stageIds.every((id) => selection.selection.effectiveSettingIds.includes(id))).toBe(true);
      expect(evidenceIds.every((id) => !selection.selection.effectiveSettingIds.includes(id))).toBe(true);
    }
  });
});
