import "fake-indexeddb/auto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect } from "vitest";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { lazyPrivateCorpusJson, privateCorpusAvailable, privateCorpusPath } from "@/testSupport/privateCorpus";
import { parseStudyMethodProfileLibrary, type StudyMethodProfile, type TaskOccurrenceRecord, type SampledQuantityObservationRecord } from "./methodProfiles";
import { loadResearchMethodSelection, saveResearchMethodSelection } from "./lastRunStore";
import { apnomsSnapshotExample, directScreenTimeObservationExample, energyDrainObservationExample, lonelinessStepObservationExample, mommFormFactorObservationExample, moodableAvailabilityExample, participantHourObservationExample, scalarObservationExample, screenomicsHourObservationExample, temporalObservationExample } from "../../e2e/fixtures/temporal-observations";
import { notificationParticipantDayExample } from "../../e2e/fixtures/notification-history";
import { mommSuppliedObservationExample } from "../../e2e/fixtures/temporal-observations";
import { apnomsSummaryExample, energyDrainSummaryExample, appMembershipObservationExample } from "../../e2e/fixtures/temporal-observations";
import { taskInstrumentExamples } from "../../e2e/fixtures/task-instrument-examples";
import { boredomRawObservationExample, energyDrainRawObservationExample, hammerObservationExample } from "../../e2e/fixtures/temporal-observations";
import { nextAppObservationExample, predictorObservationExample, s3ObservationExample, autosenObservationExample } from "../../e2e/fixtures/temporal-observations";
import { hammerDeviceSessionExample } from "../../e2e/fixtures/device-use-session";
import { falakiObservationExample, trafficObservationExample, depressionTrafficObservationExample } from "../../e2e/fixtures/temporal-observations";
import { moodscopeObservationExample, wearableMoodObservationExample } from "../../e2e/fixtures/temporal-observations";
import { mercatiGovernorObservationExample, signalPowerObservationExample } from "../../e2e/fixtures/temporal-observations";
import { prefminerObservationExample, tailFourExample, assessmentTrioExample, typingMotionExample, classroomContextExample, cohortAppSummaryExample, backDeviceAuthenticationExample, timeKillingObservationExample } from "../../e2e/fixtures/temporal-observations";

const canonical = lazyPrivateCorpusJson<{ profiles: StudyMethodProfile[] }>("ontology-sublation-20260831/adjudicated-method-profile-library.json");
const workIds = ["doi:10.1145/1879141.1879176", "doi:10.1038/s41598-021-82294-1"];

function nextAppInput() {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/2684822.2685302")!);
  return { profiles: [profile], sampled_quantity_observations: nextAppObservationExample(profile) };
}
itWithPrivateCorpus("rejects contradictory supplied Next App categories, scalar summaries and printed tokens while retaining opaque embeddings", () => {
  const row = (v: ReturnType<typeof nextAppInput>, id: string) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === "constructed:next-" + id)!;
  const quantity = (v: ReturnType<typeof nextAppInput>, id: string, property: string) => row(v, id).quantities!.find(q => q.observed_property === property)!;
  for (const [id, property, token, error] of [
    ["raw-0", "action family", '"Screen Wake"', /incompatible Next App category/],
    ["global", "app openings", "{}", /must contain a supplied scalar or JSON null/],
    ["global", "app openings", "1e400", /invalid numeric value/],
    ["raw-1", "rendered event token", '"AppOpened"', /contradicts its printed event token/],
  ] as const) { const invalid = nextAppInput(); quantity(invalid, id, property).evidence_value_json = token; expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(error); }
  const opaque = nextAppInput(); quantity(opaque, "features-A", "Last App Open").evidence_value_json = ' "unreported embedding" ';
  expect(parseStudyMethodProfileLibrary(opaque).sampled_quantity_observations).toEqual(opaque.sampled_quantity_observations);
});
itWithPrivateCorpus("rejects malformed sampled quantity carriers before interpreting Next App values", () => {
  const source = nextAppInput();
  for (const [mutate, error] of [
    [(v: typeof source) => Reflect.set(v.sampled_quantity_observations[0]!, "quantities", {}), /quantities must be an array or null/],
    [(v: typeof source) => Reflect.set(v.sampled_quantity_observations[0]!, "quantities", [null]), /quantities\[0\] must be an object/],
    [(v: typeof source) => Reflect.set(v.sampled_quantity_observations[0]!.quantities![0]!, "evidence_value_json", 1), /evidence_value_json must be a string or null/],
  ] as const) { const invalid = structuredClone(source); mutate(invalid); expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(error); }
});
const nextAppRootKeys = [
  "source.action_family_inventory", "features.event_training_rows", "features.action_context_sampling", "features.embedding_mapreduce",
  "popularity.global_frequency", "popularity.timeslot_frequency", "popularity.weekly_cycle", "popularity.activeness",
  "model.prediction_rule", "cold_app.installation_partition", "cold_app.longevity_classifier", "cold_app.short_term_prior",
  "cold_app.long_term_prior", "cold_user.most_similar", "cold_user.pseudo_inventory", "cold_user.pseudo_history",
] as const;
itWithPrivateCorpus.each(nextAppRootKeys)("accepts actual Next App %s definition independently before testing source/body/tuple rejection", key => {
  const source = nextAppInput();
  const local = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  source.sampled_quantity_observations = source.sampled_quantity_observations.filter(row => row.method_setting_reference === local(source).method_setting_id);
  for (const row of source.sampled_quantity_observations) delete row.sampled_observation_references;
  expect(source.sampled_quantity_observations.length).toBeGreaterThan(0);
  expect(() => parseStudyMethodProfileLibrary({ profiles: source.profiles })).not.toThrow();
  expect(parseStudyMethodProfileLibrary(source).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  const content = JSON.parse(String(local(source).method_value_json)) as Record<string, unknown>;
  const bare = structuredClone(source); local(bare).method_value_json = JSON.stringify(content.definition);
  expect(parseStudyMethodProfileLibrary(bare).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  for (const body of [null, {}, { conceptual_observation_roles: ["process/application identity", "bytes sent", "bytes received"] },
    { ...content, definition: null }, { ...content, definition: {} }, { ...content, source_facing_role: "preprocessing" }, { ...content, source_facing_target: "acquired_snapshot" }]) {
    const wrong = structuredClone(source); local(wrong).method_value_json = JSON.stringify(body);
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  for (const [field, value] of [["source_work_id", "doi:foreign"], ["method_setting_role", "reporting"], ["method_target_layer", "outcome"]]) {
    const wrong = structuredClone(source); Reflect.set(local(wrong), field!, value);
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(/local definition role\/target|sampled-quantity definition/);
  }
  const foreign = structuredClone(source);
  foreign.profiles[0]!.source_work_id = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = foreign.profiles[0]!.source_work_id; });
  foreign.sampled_quantity_observations.forEach(row => { row.source_work_id = foreign.profiles[0]!.source_work_id; });
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow("sampled-quantity definition");
});
itWithPrivateCorpus("requires every exact Next App raw/basic/last-family companion, not compatible tuple alone", () => {
  for (const [key, root] of [
    ...["source.event_envelope", "source.app_open_payload", "source.location_payload", "source.context_payload", "source.cable_semantics"].map(key => [key, "source.action_family_inventory"]),
    ...["features.basic_inventory", "features.time_of_day", "features.last_action_representations", "features.experimental_history_window"].map(key => [key, "features.event_training_rows"]),
  ]) {
    const source = nextAppInput(), setting = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === root)!;
    source.sampled_quantity_observations = source.sampled_quantity_observations.filter(row => row.method_setting_reference === setting.method_setting_id);
    source.sampled_quantity_observations.forEach(row => { delete row.sampled_observation_references; });
    expect(() => parseStudyMethodProfileLibrary(source)).not.toThrow();
    const local = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
    local.method_value_json = "{}";
    expect(() => parseStudyMethodProfileLibrary({ profiles: source.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(source)).toThrow("sampled-quantity definition");
  }
});
itWithPrivateCorpus("roundtrips complete Next App raw/feature/context/inventory/class/prior families without calculations or inferred links", async () => {
  const source = nextAppInput();
  const row = (v: typeof source, id: string) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === "constructed:next-" + id)!;
  const persist = async (value: typeof source) => {
    const { profiles, ...records } = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], selectedLevels: {}, ...records }));
    const { profile, sampled_quantity_observations } = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile; sampled_quantity_observations: typeof records.sampled_quantity_observations };
    expect(profile).toEqual(value.profiles[0]);
    expect(parseStudyMethodProfileLibrary({ profiles: [profile], sampled_quantity_observations }).sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
  };
  await persist(source);
  const keys = source.sampled_quantity_observations.map(r => source.profiles[0]!.method_settings.find(s => s.method_setting_id === r.method_setting_reference)!.method_parameter_key);
  expect(new Set(keys)).toEqual(new Set(nextAppRootKeys));
  expect(row(source, "features-A").sampled_observation_references!.map(r => r.relationship_label)).toEqual(["AppOpen anchor", "Last App Open", "Last Location Update", "Last Charge Cable", "Last Audio Cable", "Last Context Trigger", "Last Context Pulled"]);
  expect(row(source, "features-A").quantities).toHaveLength(16);
  expect(row(source, "raw-1").source_event_time_token).toBe("2014-01-10 12:36:09");
  expect(row(source, "raw-1").observation_instant).toBe("independent-supplied-collection-time");
  expect(row(source, "context").sampled_observation_references!.at(-1)!.sampled_observation_reference).toBe("constructed:next-raw-3");
  expect(row(source, "raw-3").source_event_time_token).toBe("2014-01-10 12:47:41"); // A following context member is allowed.
  expect(row(source, "features-A").quantities!.filter(q => q.observed_property.startsWith("Last ")).map(q => q.evidence_value_json)).toEqual(["[0.25,null,-0.5]", "[1.25,null,-0.5]", "[2.25,null,-0.5]", "[3.25,null,-0.5]", "[4.25,null,-0.5]", "[5.25,null,-0.5]"]);
  const classes = source.sampled_quantity_observations.filter(r => r.sampled_observation_id.startsWith("constructed:next-Table2-"));
  expect(classes).toHaveLength(20);
  expect(classes.every(r => !Object.hasOwn(r, "participant_id") && !Object.hasOwn(r, "device_id"))).toBe(true);
  const classifier = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === "cold_app.longevity_classifier")!;
  const definition = JSON.parse(String(classifier.method_value_json)) as { definition: { numeric_cutoff: null; table2_examples: Record<string, string[]> } };
  expect(classifier.method_setting_id).toBe("method-setting-9da9b48e7557287a47df3154");
  expect(definition.definition.numeric_cutoff).toBeNull();
  expect(definition.definition.table2_examples).toEqual(Object.fromEntries(["short-term", "long-term"].map(label => [label, classes.filter(r => r.quantities![0]!.evidence_value_json === JSON.stringify(label)).map(r => r.observed_entity_token)])));
  const changed = structuredClone(source);
  row(changed, "features-A").sampled_observation_references![1]!.sampled_observation_reference = "constructed:next-prior-repeat";
  expect(row(changed, "features-A").sampled_observation_references!.slice(2)).toEqual(row(source, "features-A").sampled_observation_references!.slice(2));
  expect(row(changed, "features-A").quantities).toEqual(row(source, "features-A").quantities);
  await persist(changed);
  const anchorChanged = structuredClone(source); row(anchorChanged, "features-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:next-open-B";
  expect(row(anchorChanged, "features-A").sampled_observation_references!.slice(1)).toEqual(row(source, "features-A").sampled_observation_references!.slice(1));
  await persist(anchorChanged);
  const independent = structuredClone(source);
  row(independent, "long-prior").quantities![0]!.evidence_value_json = "0.90";
  expect(row(independent, "long-prior").quantities!.slice(1)).toEqual(row(source, "long-prior").quantities!.slice(1));
  row(independent, "inventory-A").entity_members![0]!.observed_entity_token = "constructed:another-installed-app";
  expect(row(independent, "similar").quantities).toEqual(row(source, "similar").quantities);
  await persist(independent);
  for (const links of [undefined, null, []]) {
    const value = structuredClone(source);
    if (links === undefined) delete row(value, "features-A").sampled_observation_references;
    else row(value, "features-A").sampled_observation_references = links;
    await persist(value);
  }
  for (const token of [undefined, null, "null", "0.00", ' "unreported" ']) {
    const value = structuredClone(source), quantity = row(value, "global").quantities![0]!;
    if (token === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = token;
    await persist(value);
  }
  for (const ref of [undefined, null]) {
    const value = structuredClone(source), link = row(value, "features-A").sampled_observation_references![1]!;
    if (ref === undefined) delete link.sampled_observation_reference; else link.sampled_observation_reference = ref;
    await persist(value);
  }
  for (const token of ["true", "false", '"unknown original cable code"', "null"]) {
    const value = structuredClone(source); row(value, "raw-4").quantities![1]!.evidence_value_json = token;
    await persist(value);
  }
  // Neither equality case has a recovered exclusion rule.
  const equal = structuredClone(source);
  row(equal, "features-A").sampled_observation_references![1]!.sampled_observation_reference = "constructed:next-raw-1";
  row(equal, "install-partition").sampled_observation_references!.push({ relationship_label: "training member", sampled_observation_reference: "constructed:next-raw-7", source_locators: ["Supplied boundary equality; disposition unreported"] });
  await persist(equal);
});
itWithPrivateCorpus("rejects Next App wrong family, ambiguous or foreign scope, and comparison-as-inventory without changing saved selection", async () => {
  const source = nextAppInput(), parsed = parseStudyMethodProfileLibrary(source);
  const saved = JSON.stringify({ profile: parsed.profiles[0], sampled_quantity_observations: parsed.sampled_quantity_observations });
  await saveResearchMethodSelection(saved);
  const row = (v: typeof source, id: string) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === "constructed:next-" + id)!;
  const mutations: Array<(v: typeof source) => void> = [
    v => { row(v, "features-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:next-raw-3"; },
    v => { row(v, "features-A").sampled_observation_references![1]!.sampled_observation_reference = "constructed:next-history-A"; },
    v => { row(v, "prior-app").device_id = "known-other-phone"; },
    v => { row(v, "features-A").sampled_observation_references!.push(structuredClone(row(v, "features-A").sampled_observation_references![1]!)); },
    v => { row(v, "features-A").sampled_observation_references![0]!.sampled_observation_reference = " "; },
    v => { Reflect.set(row(v, "features-A").sampled_observation_references![0]!, "sampled_observation_reference", 0); },
    v => { Reflect.set(row(v, "features-A"), "sampled_observation_references", {}); },
    v => { row(v, "features-A").sampled_observation_references![1]!.relationship_label = "last six events"; },
    v => { row(v, "features-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:next-features-A"; },
    v => { row(v, "context").sampled_observation_references![1]!.sampled_observation_reference = "constructed:next-raw-1"; },
    v => { row(v, "similar").sampled_observation_references![1]!.sampled_observation_reference = "constructed:next-cover"; },
    v => { row(v, "similar").sampled_observation_references![1]!.sampled_observation_reference = "constructed:next-inventory-new"; },
    v => { row(v, "surrogate").sampled_observation_references![3]!.sampled_observation_reference = "constructed:next-prior-app"; },
    v => { row(v, "surrogate").sampled_observation_references!.splice(2, 1); },
    v => { row(v, "raw-0").sampled_observation_references = []; },
    v => { row(v, "raw-0").quantities!.push({ observed_property: "rendered event token", evidence_value_json: '"App_Opened"' }); },
    v => { row(v, "raw-0").quantities!.push({ observed_property: "latitude", evidence_value_json: "0" }); },
    v => { row(v, "features-A").quantities![0]!.evidence_value_json = '"different-known-app"'; },
    v => { row(v, "features-A").quantities![10]!.evidence_value_json = "[true]"; },
    v => { row(v, "features-A").quantities![10]!.evidence_value_json = "[1e999]"; },
    v => { row(v, "raw-3").quantities![1]!.evidence_unit = "m/s"; },
    v => { row(v, "inventory-A").entity_members![0]!.member_entity_kind = "cell"; },
    v => { Reflect.deleteProperty(row(v, "global"), "participant_id"); },
    v => { delete row(v, "features-A").device_id; v.sampled_quantity_observations.push({ ...row(v, "prior-app"), device_id: "second-phone" }); },
  ];
  for (const mutate of mutations) {
    const wrong = structuredClone(source); mutate(wrong);
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
    expect(await loadResearchMethodSelection()).toBe(saved);
  }
});
const falakiKeys = [
  "acquisition.android_counter_snapshot", "acquisition.android_screen_state", "acquisition.android_voice_call_bounds", "acquisition.android_traffic_channel",
  "feature.battery_indicator_drain", "aggregation.daily_interaction_statistics", "aggregation.hourly_interaction_metrics",
  "feature.voice_usage_ratio", "feature.diurnal_ratio", "validation.first_second_half_usage", "feature.trace_application_count",
  "feature.relative_application_popularity", "feature.hourly_application_popularity", "feature.application_category_vocabulary",
  "aggregation.application_category_popularity", "aggregation.traffic_statistics", "feature.traffic_interactive_screen_rule",
  "feature.received_traffic_prescreen_window", "feature.interactive_traffic_fraction", "aggregation.energy_drain_statistics",
  "feature.energy_drain_variability_by_window", "feature.inferred_screen_timeout", "feature.trend_table_chunk_width",
  "feature.trend_table_quantization_and_statistics", "reporting.fitted_parameter_distributions",
  "analysis.trend_neighbor_weighted_prediction", "analysis.generic_prediction_comparator", "analysis.short_term_prediction_comparator", "analysis.time_of_day_prediction_comparator",
] as const;
function falakiInput() {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/1814433.1814453")!);
  return { profiles: [profile], ...falakiObservationExample(profile) };
}
itWithPrivateCorpus.each(falakiKeys)("admits only the exact Falaki populated definition %s", key => {
  const all = falakiInput(), local = (v: typeof all) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  const input = { ...all, sampled_quantity_observations: all.sampled_quantity_observations.filter(row => row.method_setting_reference === local(all).method_setting_id),
    participant_day_observations: [] };
  expect(input.sampled_quantity_observations.length).toBeGreaterThan(0);
  const original = JSON.parse(String(local(input).method_value_json)) as Record<string, unknown>;
  const body = original.definition ?? original;
  const wrapper = { definition: body, source_facing_role: original.source_facing_role ?? local(input).method_setting_role,
    source_facing_target: original.source_facing_target ?? local(input).method_target_layer };
  for (const value of [body, wrapper]) {
    const positive = structuredClone(input); local(positive).method_value_json = JSON.stringify(value);
    expect(parseStudyMethodProfileLibrary(positive).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  }
  for (const value of [{ ...wrapper, definition: null }, { ...wrapper, definition: "invented source body" },
    { ...wrapper, source_facing_role: "provenance" }, { ...wrapper, source_facing_target: "app_episode" },
    ...(wrapper.source_facing_role !== local(input).method_setting_role ? [{ ...wrapper, source_facing_role: local(input).method_setting_role }] : [])]) {
    const negative = structuredClone(input); local(negative).method_value_json = JSON.stringify(value);
    expect(() => parseStudyMethodProfileLibrary({ profiles: negative.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(negative)).toThrow();
  }
  for (const [field, value] of [["method_setting_role", "provenance"], ["method_target_layer", "study_window"], ["source_work_id", "doi:foreign"]]) {
    const negative = structuredClone(input); Reflect.set(local(negative), field!, value);
    expect(() => parseStudyMethodProfileLibrary(negative)).toThrow();
  }
  const foreign = structuredClone(input), work = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.source_work_id = work;
  for (const setting of foreign.profiles[0]!.method_settings) setting.source_work_id = work;
  for (const row of foreign.sampled_quantity_observations) row.source_work_id = work;
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow(/sampled-quantity|participant_id/);
});
itWithPrivateCorpus("preserves all Falaki raw, summary and following-window families without manufacturing joins or periods", async () => {
  const source = falakiInput();
  const keys = source.sampled_quantity_observations.map(row => source.profiles[0]!.method_settings.find(s => s.method_setting_id === row.method_setting_reference)!.method_parameter_key);
  expect(new Set(keys)).toEqual(new Set(falakiKeys));
  expect(source.participant_day_observations).toHaveLength(6);
  const byId = (v: typeof source, id: string) => v.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:falaki-" + id)!;
  const timers = ["timer-A", "timer-B"].map(id => byId(source, id));
  expect(timers.map(row => row.observed_entity_token)).toEqual(["constructed:executable-A", "constructed:executable-A"]);
  expect(timers.map(row => row.observation_instant)).toEqual(Array(2).fill("constructed:same-collection-token"));
  expect(timers.map(row => row.quantities![0]!.evidence_value_json)).toEqual(["0", '"7.000"']);
  expect(timers.every(row => !Object.hasOwn(row.quantities![0]!, "evidence_unit"))).toBe(true);
  expect(byId(source, "call-0").source_event_time_token).not.toBe(byId(source, "call-0").observation_instant);
  expect(byId(source, "pooled-category")).not.toHaveProperty("participant_id");
  expect(byId(source, "pooled-category")).not.toHaveProperty("device_id");
  expect(byId(source, "app-category").observed_entity_kind).toBe("application");
  expect(byId(source, "pooled-category").observed_entity_kind).toBe("application_category");
  expect(byId(source, "trend-table-0").quantities!.slice(0, 3).map(q => q.observed_property)).toEqual(["preceding quantized x1", "preceding quantized x2", "preceding quantized x3"]);
  expect(byId(source, "trend-table-0").quantities!.slice(3).map(q => q.quantity_qualifier)).toEqual(Array(2).fill("1-hour horizon"));
  expect(byId(source, "trend-table-1").quantities!.slice(3).map(q => q.quantity_qualifier)).toEqual(Array(2).fill("2-hour horizon"));
  expect(source).not.toHaveProperty("task_occurrences"); expect(source).not.toHaveProperty("app_feature_sessions");
  const persist = async (value: typeof source) => {
    const { profiles, ...records } = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], ...records }));
    const { profile, ...saved } = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile } & typeof records;
    const restored = parseStudyMethodProfileLibrary({ profiles: [profile], ...saved });
    expect(restored.sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
    expect(restored.participant_day_observations).toEqual(value.participant_day_observations);
  };
  await persist(source);
  for (const value of [undefined, null, "null", ' "NA" ', "0.00", ' "0.00" ']) {
    const partial = structuredClone(source), timer = byId(partial, "timer-A");
    if (value === undefined) delete timer.quantities![0]!.evidence_value_json; else timer.quantities![0]!.evidence_value_json = value;
    await persist(partial);
  }
  for (const values of [undefined, null, []]) {
    const partial = structuredClone(source);
    if (values === undefined) delete byId(partial, "timer-A").quantities; else byId(partial, "timer-A").quantities = values;
    await persist(partial);
  }
  const unknownCategory = structuredClone(source); byId(unknownCategory, "pooled-category").participant_id = null;
  await persist(unknownCategory);
  await persist(source); const savedBefore = await loadResearchMethodSelection();
  const mutations: Array<(v: typeof source) => void> = [
    v => { byId(v, "timer-A").observed_entity_kind = "process"; },
    v => { byId(v, "timer-A").quantities![0]!.observed_property = "interval app usage"; },
    v => { byId(v, "timer-A").quantities![0]!.evidence_unit = "seconds"; },
    v => { byId(v, "traffic-A").quantities![0]!.evidence_unit = "bytes"; },
    v => { byId(v, "screen-off").quantities![0]!.evidence_value_json = '"screen turned off"'; },
    v => { byId(v, "call-0").quantities![0]!.evidence_value_json = '"voice call active"'; },
    v => { Reflect.deleteProperty(byId(v, "timer-A"), "participant_id"); },
    v => { Reflect.deleteProperty(byId(v, "app-popularity"), "participant_id"); },
    v => { byId(v, "pooled-category").observed_entity_kind = "application"; },
    v => { byId(v, "pooled-category").observed_entity_token = "constructed:executable-A"; },
    v => { byId(v, "battery").quantities![0]!.evidence_unit = "mAh"; },
    v => { byId(v, "battery").quantities![0]!.evidence_value_json = "101"; },
    v => { byId(v, "hour-of-day-statistics").quantities![0]!.quantity_qualifier = "24"; },
    v => { byId(v, "energy-statistics").quantities![0]!.quantity_qualifier = "all periods"; },
    v => { byId(v, "variability").quantities![0]!.quantity_qualifier = "1-hour horizon"; },
    v => { byId(v, "trend-table-0").quantities![4]!.quantity_qualifier = "2-hour horizon"; },
    v => { byId(v, "trend-table-0").quantities![0]!.quantity_qualifier = "oldest measured wall-clock instant"; },
    v => { byId(v, "prediction-0").quantities![0]!.quantity_qualifier = "10-minute horizon"; },
    v => { byId(v, "timer-B").sampled_observation_id = byId(v, "timer-A").sampled_observation_id; },
    v => { Reflect.set(byId(v, "call-0"), "source_event_time_token", false); },
    v => { byId(v, "timer-A").quantities!.push(structuredClone(byId(v, "timer-A").quantities![0]!)); },
    v => { v.participant_day_observations[0]!.referenced_hour_token = "invented-extra-hour"; },
    ...["{}", "[]", "true", "1e400"].map(value => (v: typeof source) => { byId(v, "timer-A").quantities![0]!.evidence_value_json = value; }),
  ];
  for (const mutate of mutations) {
    const negative = structuredClone(source); mutate(negative);
    await expect(persist(negative)).rejects.toThrow();
    expect(await loadResearchMethodSelection()).toBe(savedBefore);
  }
});
itWithPrivateCorpus.each(["analysis.trend_table_history_cardinality", "feature.trend_table_chunk_width", "analysis.energy_prediction_horizons"])("requires the exact Falaki trend-table companion %s", key => {
  const all = falakiInput(), input = { ...all, sampled_quantity_observations: all.sampled_quantity_observations.filter(row => row.sampled_observation_id.includes("trend-table")), participant_day_observations: [] };
  const setting = (v: typeof input) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  const wrapped = JSON.parse(String(setting(input).method_value_json)) as Record<string, unknown>;
  for (const value of [{ ...wrapped, definition: null }, { ...wrapped, source_facing_role: "provenance" }, { ...wrapped, source_facing_target: "device_session" }]) {
    const invalid = structuredClone(input); setting(invalid).method_value_json = JSON.stringify(value);
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
});


const boredomRawKeys = [
  "battery_status", "proximity", "ringer_mode", "airplane_mode", "ambient_noise", "audio_jack",
  "cell_tower", "data_activity", "foreground_package", "light", "screen_orientation", "wifi_info",
  "screen_events", "phone_events", "sms",
] as const;
function boredomRawInput() {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/2750858.2804252")!);
  return { profiles: [profile], ...boredomRawObservationExample(profile) };
}
itWithPrivateCorpus.each(boredomRawKeys)("preserves Boredom raw Table1/2 %s independently, not as a predictor/task/session", key => {
  const source = boredomRawInput();
  const local = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === "borapp.schema." + key)!;
  const reference = local(source).method_setting_id;
  source.sampled_quantity_observations = source.sampled_quantity_observations.filter(row => row.method_setting_reference === reference);
  source.notification_histories = [];
  expect(source.sampled_quantity_observations).toHaveLength(key === "screen_events" || key === "sms" ? 3 : key === "phone_events" ? 2 : 1);
  expect(() => parseStudyMethodProfileLibrary({ profiles: source.profiles })).not.toThrow();
  expect(parseStudyMethodProfileLibrary(source).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  const content = JSON.parse(String(local(source).method_value_json)) as Record<string, unknown>;
  const bare = structuredClone(source); local(bare).method_value_json = JSON.stringify(content.definition);
  expect(parseStudyMethodProfileLibrary(bare).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  for (const body of [null, {}, "derived predictor", { ...content, definition: null }, { ...content, definition: {} },
    { ...content, source_facing_role: null }, { ...content, source_facing_target: "acquired_snapshot" }]) {
    const wrong = structuredClone(source); local(wrong).method_value_json = JSON.stringify(body);
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  for (const [field, value] of [["source_work_id", "doi:foreign"], ["method_setting_role", "feature_engineering"], ["method_target_layer", "derived_feature"]]) {
    const wrong = structuredClone(source); Reflect.set(local(wrong), field!, value);
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(/local definition role\/target|sampled-quantity definition/);
  }
  const gate = structuredClone(source);
  gate.profiles[0]!.method_settings.find(s => s.method_parameter_key === "borapp.acquisition.screen_on_and_unlocked_gate")!.method_value_json = "null";
  expect(() => parseStudyMethodProfileLibrary(gate)).toThrow("sampled-quantity definition");
  // A known key/body and internally consistent foreign source still cannot borrow this admission.
  const foreign = structuredClone(source);
  foreign.profiles[0]!.source_work_id = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = foreign.profiles[0]!.source_work_id; });
  foreign.sampled_quantity_observations.forEach(row => { row.source_work_id = foreign.profiles[0]!.source_work_id; });
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow("sampled-quantity definition");
});
itWithPrivateCorpus("preserves all16 Boredom raw channels and independent event/collection times through actual save/reload", async () => {
  const source = boredomRawInput();
  const sourceKeys = [
    "battery_status", "notifications", "screen_events", "phone_events", "proximity", "ringer_mode", "sms",
    "airplane_mode", "ambient_noise", "audio_jack", "cell_tower", "data_activity", "foreground_package", "light", "screen_orientation", "wifi_info",
  ].map(key => "borapp.schema." + key);
  const keys = source.sampled_quantity_observations.map(r => source.profiles[0]!.method_settings.find(s => s.method_setting_id === r.method_setting_reference)!.method_parameter_key);
  keys.push("borapp.schema.notifications");
  expect(new Set(keys)).toEqual(new Set(sourceKeys));
  expect(source.sampled_quantity_observations).toHaveLength(20);
  expect(source).not.toHaveProperty("task_occurrences"); expect(source).not.toHaveProperty("device_use_sessions");
  expect(source.sampled_quantity_observations.every(r => r.observed_entity_kind === "device" && !Object.hasOwn(r, "task_occurrence_reference") && !Object.hasOwn(r, "denotes_interval"))).toBe(true);
  expect(source.sampled_quantity_observations.slice(12).map(r => JSON.parse(r.quantities![0]!.evidence_value_json!) as unknown)).toEqual([
    "screen turned on", "screen turned off", "screen unlocked", "incoming call", "outgoing call", "receiving SMS", "reading SMS", "sending SMS",
  ]);
  expect(source.sampled_quantity_observations[15]!.source_event_time_token).toBe("supplied-call-time-A");
  expect(source.sampled_quantity_observations[15]!.observation_instant).toBe("independently-supplied-collection-token");
  expect(source.notification_histories).toHaveLength(2);
  expect(source.notification_histories[0]!.app_package_name).toBe("example.notification.package");
  expect(source.notification_histories[0]!.app_package_name).not.toBe(JSON.parse(source.sampled_quantity_observations[8]!.quantities![0]!.evidence_value_json!));
  expect(source.notification_histories.map(h => h.notification_evidence[0]!.evidence_instant)).toEqual(["same-supplied-notification-time", "same-supplied-notification-time"]);
  expect(source.notification_histories[0]!.notification_item_id).not.toBe(source.notification_histories[1]!.notification_item_id);
  const persist = async (value: typeof source) => {
    const { profiles, ...records } = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], ...records }));
    const { profile, ...stored } = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile } & typeof records;
    const restored = parseStudyMethodProfileLibrary({ profiles: [profile], ...stored });
    expect(restored.sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
    expect(restored.notification_histories).toEqual(value.notification_histories);
  };
  await persist(source);
  for (const token of [undefined, null, "null", ' "NA" ', "0.00", ' "101" ']) {
    const value = structuredClone(source), q = value.sampled_quantity_observations[0]!.quantities![0]!;
    if (token === undefined) delete q.evidence_value_json; else q.evidence_value_json = token;
    await persist(value);
  }
  for (const token of [undefined, null, "", "opaque supplied time"]) {
    const value = structuredClone(source), event = value.sampled_quantity_observations[15]!;
    if (token === undefined) delete event.source_event_time_token; else event.source_event_time_token = token;
    await persist(value);
  }
  for (const values of [undefined, null, []]) {
    const value = structuredClone(source);
    if (values === undefined) delete value.sampled_quantity_observations[0]!.quantities;
    else value.sampled_quantity_observations[0]!.quantities = values;
    await persist(value);
  }
  const reordered = structuredClone(source); reordered.sampled_quantity_observations.reverse(); await persist(reordered);
  await persist(source); const retained = await loadResearchMethodSelection();
  const wrong = structuredClone(source); wrong.sampled_quantity_observations[15]!.method_setting_reference = "foreign";
  await expect(persist(wrong)).rejects.toThrow("local definition role/target");
  expect(await loadResearchMethodSelection()).toBe(retained);
});
itWithPrivateCorpus("keeps raw Boredom percentage/dB/lux/directional bytes/states distinct from events and predictors", () => {
  const source = boredomRawInput();
  const row = (v: typeof source, short: string) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === "example:boredom-raw:" + short)!;
  expect(row(source, "data_activity").quantities!.map(q => [q.observed_property, q.evidence_value_json, q.evidence_unit])).toEqual([
    ["bytes uploaded", "0", "bytes"], ["bytes downloaded", "5", "bytes"],
  ]);
  expect(row(source, "ambient_noise").quantities![0]!.evidence_unit).toBe("dB");
  expect(row(source, "light").quantities![0]!.evidence_unit).toBe("lux");
  for (const [short, field, value] of [
    ["battery_status", "evidence_value_json", "-1"], ["battery_status", "evidence_value_json", "101"],
    ["battery_status", "observed_property", "battery_level"], ["battery_status", "evidence_unit", "minutes"],
    ["ambient_noise", "evidence_unit", "lux"], ["light", "evidence_unit", "dB"],
    ["ringer_mode", "evidence_value_json", '"vibrate"'], ["screen_orientation", "evidence_value_json", '"portrait"'],
    ["proximity", "evidence_value_json", "false"], ["foreground_package", "observed_property", "notification app"],
  ]) {
    const wrong = structuredClone(source); Reflect.set(row(wrong, short!).quantities![0]!, field!, value);
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
  }
  const duplicate = structuredClone(source);
  row(duplicate, "data_activity").quantities!.push(structuredClone(row(duplicate, "data_activity").quantities![0]!));
  expect(() => parseStudyMethodProfileLibrary(duplicate)).toThrow("duplicated within observation");
  const wrongEvent = structuredClone(source); wrongEvent.sampled_quantity_observations[12]!.quantities![0]!.evidence_value_json = '"OFF_LOCKED"';
  expect(() => parseStudyMethodProfileLibrary(wrongEvent)).toThrow("disclosed categorical state");
  const wrongSchema = structuredClone(source);
  const eventSetting = wrongSchema.profiles[0]!.method_settings.find(s => s.method_parameter_key === "borapp.schema.screen_events")!;
  eventSetting.method_target_layer = "raw_record";
  expect(() => parseStudyMethodProfileLibrary(wrongSchema)).toThrow("local definition role/target");
  const notificationAsScalar = structuredClone(source);
  notificationAsScalar.sampled_quantity_observations[0]!.method_setting_reference = notificationAsScalar.profiles[0]!.method_settings.find(s => s.method_parameter_key === "borapp.schema.notifications")!.method_setting_id;
  expect(() => parseStudyMethodProfileLibrary(notificationAsScalar)).toThrow("sampled-quantity definition");
  for (const value of ["0", "100", " 17.5000 "]) {
    const valid = structuredClone(source); row(valid, "battery_status").quantities![0]!.evidence_value_json = value;
    expect(parseStudyMethodProfileLibrary(valid).sampled_quantity_observations).toEqual(valid.sampled_quantity_observations);
  }
  for (const token of [0, false, {}, []]) {
    const wrong = structuredClone(source); Reflect.set(wrong.sampled_quantity_observations[15]!, "source_event_time_token", token);
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow("source_event_time_token must be a string or null");
  }
});
itWithPrivateCorpus("preserves Boredom and Energy raw observations through independently generated JSON Schema/Pydantic shapes", () => {
  const source = boredomRawInput();
  source.sampled_quantity_observations.push(...energyDrainRawObservationExample(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/2745844.2745875")!));
  const hammer = hammerObservationExample(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/2634317.2634325")!);
  source.sampled_quantity_observations.push(...hammer.sampled_quantity_observations); source.notification_histories.push(...hammer.notification_histories);
  const falaki = falakiObservationExample(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/1814433.1814453")!);
  source.sampled_quantity_observations.push(...falaki.sampled_quantity_observations);
  const traffic = trafficObservationExample(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/1879141.1879176")!);
  source.sampled_quantity_observations.push(...traffic.sampled_quantity_observations);
  Reflect.set(source, "participant_day_observations", [...falaki.participant_day_observations, ...traffic.participant_day_observations]);
  const schemaPath = resolve(import.meta.dirname, "../../schema/generated/json-schema/chronicle-research-ontology.schema.json");
  const pydanticPath = resolve(import.meta.dirname, "../../schema/generated/pydantic");
  const script = [
    "import json,sys",
    "from pathlib import Path",
    "from jsonschema import Draft202012Validator",
    "from pydantic import ValidationError",
    "sys.path.insert(0,sys.argv[2])",
    "import chronicle_research_ontology as model",
    "schema=json.loads(Path(sys.argv[1]).read_text()); data=json.load(sys.stdin)",
    "def preserved(name,row):",
    " cls=getattr(model,name); Draft202012Validator({'$ref':'#/$defs/'+name,'$defs':schema['$defs']}).validate(row)",
    " assert cls(**row).model_dump(exclude_unset=True)==row",
    "for row in data['sampled_quantity_observations']:",
    " preserved('SampledQuantityObservationRecord',row)",
    " for omitted in [False,True]:",
    "  variant=dict(row)",
    "  if omitted: variant.pop('source_event_time_token',None)",
    "  else: variant['source_event_time_token']=None",
    "  preserved('SampledQuantityObservationRecord',variant)",
    " for value in [0,False,[],{}]:",
    "  bad=dict(row,source_event_time_token=value)",
    "  validator=Draft202012Validator({'$ref':'#/$defs/SampledQuantityObservationRecord','$defs':schema['$defs']})",
    "  assert not validator.is_valid(bad)",
    "  try: model.SampledQuantityObservationRecord(**bad)",
    "  except ValidationError: pass",
    "  else: raise AssertionError('event time must not coerce malformed value')",
    "for row in data['notification_histories']: preserved('NotificationHistoryRecord',row)",
    "for row in data['participant_day_observations']: preserved('ParticipantDayObservationRecord',row)",
    "print('Boredom raw shape parity')",
  ].join("\n");
  expect(execFileSync("uvx", ["--from", "linkml==1.10.0", "--with", "jsonschema", "python", "-c", script, schemaPath, pydanticPath], {
    input: JSON.stringify(source), encoding: "utf8", timeout: 180_000,
  }).trim()).toBe("Boredom raw shape parity");
});

function energySummaryInput() {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/2745844.2745875")!);
  return { profiles: [profile], ...energyDrainSummaryExample(profile) };
}
itWithPrivateCorpus.each([
  "analysis.screen_intervals", "analysis.cpu_classes", "analysis.energy_components", "analysis.network_connectivity",
  "analysis.per_app", "analysis.app_categories", "analysis.named_app_versions", "analysis.user_quintiles",
  "analysis.device_os_strata", "analysis.cellular_strata",
])("admits Energy supplied %s only through its actual source definition", key => {
  const source = energySummaryInput();
  const setting = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  const reference = setting(source).method_setting_id;
  source.sampled_quantity_observations = source.sampled_quantity_observations.filter(row => row.method_setting_reference === reference);
  source.participant_day_observations = [];
  expect(source.sampled_quantity_observations.length).toBeGreaterThan(0);
  expect(() => parseStudyMethodProfileLibrary({ profiles: source.profiles })).not.toThrow();
  const body: unknown = JSON.parse(String(setting(source).method_value_json));
  const wrapper = { definition: body, source_facing_role: "analysis", source_facing_target: "derived_feature" };
  for (const content of [body, wrapper]) {
    const valid = structuredClone(source); setting(valid).method_value_json = JSON.stringify(content);
    expect(parseStudyMethodProfileLibrary(valid).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  }
  for (const content of [
    typeof body === "string" ? body + " altered" : [...body as unknown[]].reverse(), null,
    { conceptual_observation_roles: ["process/application identity", "bytes sent", "bytes received"] },
    { ...wrapper, definition: null }, { ...wrapper, source_facing_role: "event_schema" },
    { ...wrapper, source_facing_target: "app_session" },
  ]) {
    const invalid = structuredClone(source); setting(invalid).method_value_json = JSON.stringify(content);
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  for (const [field, value] of [["method_setting_role", "event_schema"], ["method_target_layer", "acquired_snapshot"], ["source_work_id", "doi:foreign"]]) {
    const invalid = structuredClone(source); Reflect.set(setting(invalid), field!, value);
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/definition|participant_id/);
  }
  const other = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/1879141.1879176")!);
  other.method_settings.push({ ...structuredClone(setting(source)), source_work_id: other.source_work_id });
  other.method_setting_count = other.method_settings.length; other.method_setting_ids = other.method_settings.map(s => s.method_setting_id);
  const foreign = { profiles: [other], sampled_quantity_observations: source.sampled_quantity_observations.map(row => ({
    ...row, method_profile_id: other.method_profile_id, source_work_id: other.source_work_id,
    participant_id: "constructed:foreign-context",
  })) };
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow(/local definition role\/target/);
});
itWithPrivateCorpus("preserves Energy application versus device/day ownership, components and independent EDR inputs through save/reload", async () => {
  const source = energySummaryInput();
  const persist = async (value: typeof source) => {
    const parsed = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0],
      sampled_quantity_observations: parsed.sampled_quantity_observations, participant_day_observations: parsed.participant_day_observations }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile],
      sampled_quantity_observations: saved.sampled_quantity_observations, participant_day_observations: saved.participant_day_observations });
    expect(restored.sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
    expect(restored.participant_day_observations).toEqual(value.participant_day_observations);
    return restored;
  };
  const restored = await persist(source);
  const app = source.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:app-energy-0")!;
  expect(app.observed_entity_kind).toBe("application"); expect(app).not.toHaveProperty("participant_id"); expect(app).not.toHaveProperty("device_id");
  expect(app.quantities!.slice(0, 6).map(q => q.evidence_value_json)).toEqual(["0", "1.25", "null", null, undefined, "7"]);
  expect(app.quantities!.slice(-3)).toEqual([
    { observed_property: "total foreground energy", evidence_value_json: "20.00", evidence_unit: "mAh" },
    { observed_property: "total foreground time", evidence_value_json: '"2.75"' },
    { observed_property: "foreground energy drain rate", evidence_value_json: "333.30", evidence_unit: "mA" },
  ]);
  expect(source.sampled_quantity_observations.filter(row => row.sampled_observation_id.startsWith("constructed:app-version-"))
    .map(row => row.quantities!.map(q => q.evidence_value_json))).toEqual([
      ['"Facebook"', '"supplied-version-A"', "123.50"], ['"Facebook"', '"supplied-version-B"', '"0.00"'],
    ]);
  expect(new Set(restored.participant_day_observations!.map(row => row.device_id)).size).toBe(2);
  expect(new Set(restored.participant_day_observations!.map(row => row.referenced_day_token)).size).toBe(2);
  expect(restored.participant_day_observations!.filter(row => row.day_observation_id === "constructed:app-0-component-0")).toHaveLength(4);
  expect(new Set(restored.participant_day_observations!.filter(row => row.app_package_name).map(row => row.app_package_name)).size).toBe(2);
  const optionalParticipant = structuredClone(source);
  Reflect.set(optionalParticipant.sampled_quantity_observations.find(row => row.sampled_observation_id === app.sampled_observation_id)!, "participant_id", null);
  await persist(optionalParticipant);
  for (const value of [undefined, null, "null", ' "0.00" ']) {
    const variant = structuredClone(source), quantity = variant.sampled_quantity_observations.find(row => row.sampled_observation_id === app.sampled_observation_id)!.quantities![0]!;
    if (value === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = value;
    const roundtrip = await persist(variant);
    expect(roundtrip.sampled_quantity_observations!.find(row => row.sampled_observation_id === "constructed:app-energy-1")).toEqual(source.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:app-energy-1"));
  }
  const reordered = structuredClone(source);
  reordered.sampled_quantity_observations.reverse(); reordered.participant_day_observations.reverse();
  reordered.sampled_quantity_observations.forEach(row => row.quantities?.reverse()); await persist(reordered);
  await persist(source); const retained = await loadResearchMethodSelection();
  const appRow = (v: typeof source) => v.sampled_quantity_observations.find(row => row.sampled_observation_id === app.sampled_observation_id)!;
  const mutations: Array<(v: typeof source) => void> = [
    v => { Reflect.set(appRow(v), "observed_entity_kind", "android_uid"); },
    v => { const category = v.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:app-category")!; Reflect.set(category, "participant_id", "constructed:category-context"); Reflect.set(category, "observed_entity_kind", "application"); },
    v => { Reflect.set(appRow(v), "participant_id", " "); },
    v => { Reflect.set(appRow(v), "participant_id", 0); },
    v => { Reflect.deleteProperty(v.sampled_quantity_observations[0]!, "participant_id"); },
    v => { Reflect.set(v.sampled_quantity_observations[0]!, "participant_id", null); },
    v => { appRow(v).quantities![0]!.evidence_unit = "mW"; },
    v => { appRow(v).quantities!.find(q => q.observed_property === "total foreground time")!.evidence_unit = "minutes"; },
    v => { appRow(v).quantities![0]!.observed_property = "UID energy"; },
    v => { appRow(v).quantities!.push(structuredClone(appRow(v).quantities![0]!)); },
    v => { Reflect.set(appRow(v), "entity_members", []); },
    v => { v.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:device-cpu-summaries")!.quantities![0]!.quantity_qualifier = "CPU suspended"; },
    v => { v.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:radio-summaries")!.quantities![0]!.quantity_qualifier = "5G"; },
    v => { v.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:quintile-0")!.quantities![0]!.evidence_value_json = '"arbitrary cutoff group"'; },
    v => { v.participant_day_observations.push(structuredClone(v.participant_day_observations[0]!)); },
    v => { v.participant_day_observations[0]!.device_id = ""; },
    v => { Reflect.set(v.participant_day_observations[0]!, "device_id", 1); },
  ];
  for (const value of ["true", "{}", "[]", "bad-json", "1e400"]) mutations.push(v => { appRow(v).quantities![0]!.evidence_value_json = value; });
  for (const mutate of mutations) {
    const invalid = structuredClone(source); mutate(invalid);
    await expect(persist(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained);
  }
});
itWithPrivateCorpus("keeps participant-period supports within a supplied device, while omitted/null device stays unknown", () => {
  const source = energySummaryInput();
  const objective = structuredClone(source.participant_day_observations[0]!);
  for (const device of [undefined, null, "constructed:independent-device"]) {
    const row = structuredClone(objective);
    if (device === undefined) delete row.device_id; else row.device_id = device;
    expect(parseStudyMethodProfileLibrary({ profiles: source.profiles, participant_day_observations: [row] }).participant_day_observations).toEqual([row]);
  }
  // Generic relationship-contract probe, not an Energy questionnaire or recovered source join.
  const response = { ...objective, day_observation_id: "constructed:contract-response", day_observation_kind: "subjective_response",
    observed_property: "constructed support-ownership probe", source_locators: ["Normalized parser contract only; not a source questionnaire."] };
  const same = { ...response, aggregate_observation_references: [objective.day_observation_id] };
  expect(parseStudyMethodProfileLibrary({ profiles: source.profiles, participant_day_observations: [objective, same] }).participant_day_observations).toEqual([objective, same]);
  expect(() => parseStudyMethodProfileLibrary({ profiles: source.profiles, participant_day_observations: [objective, { ...same, device_id: "constructed:energy-device-B" }] })).toThrow(/missing objective records/);
  const cross = { ...response, referenced_day_token: "supplied-other-day", cross_period_aggregate_references: [{
    day_observation_id: objective.day_observation_id, referenced_day_token: objective.referenced_day_token,
    relationship_label: "constructed different-period support", source_locators: ["Normalized parser contract only; no temporal inference."],
  }] };
  expect(parseStudyMethodProfileLibrary({ profiles: source.profiles, participant_day_observations: [objective, cross] }).participant_day_observations).toEqual([objective, cross]);
  expect(() => parseStudyMethodProfileLibrary({ profiles: source.profiles, participant_day_observations: [objective, { ...cross, device_id: "constructed:energy-device-B" }] })).toThrow(/distinct objective targets/);
  expect(() => parseStudyMethodProfileLibrary({ profiles: source.profiles, participant_day_observations: [{ ...objective, method_setting_reference: "constructed:day-only-ref" }] })).toThrow(/method_setting_reference is run-availability-only/);
  for (const [value, error] of [[{}, /cross_period_aggregate_references must be an array or null/], [[null], /cross_period_aggregate_references member must be an object/]] as const) {
    const bad = structuredClone(cross); Reflect.set(bad, "cross_period_aggregate_references", value);
    expect(() => parseStudyMethodProfileLibrary({ profiles: source.profiles, participant_day_observations: [objective, bad] })).toThrow(error);
  }
});

function energyDrainRawInput() {
  const profile = canonical().profiles.find(p => p.source_work_id === "doi:10.1145/2745844.2745875");
  if (!profile) throw new Error("Required frozen Energy Drain profile absent");
  return { profiles: [structuredClone(profile)], sampled_quantity_observations: energyDrainRawObservationExample(profile) };
}
itWithPrivateCorpus.each(["collector.dynamic_events", "network_reconstruction.input", "cpu_model", "screen_model"])(
  "imports only Energy Drain's actual raw %s definition and original tuple", key => {
    const source = energyDrainRawInput();
    const setting = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
    source.sampled_quantity_observations = source.sampled_quantity_observations.filter(row => row.method_setting_reference === setting(source).method_setting_id);
    expect(source.sampled_quantity_observations.length).toBeGreaterThan(0);
    expect(parseStudyMethodProfileLibrary(source).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
    const body: unknown = JSON.parse(String(setting(source).method_value_json));
    const wrapper = { definition: body, source_facing_role: setting(source).method_setting_role, source_facing_target: setting(source).method_target_layer };
    for (const content of [body, wrapper]) {
      const valid = structuredClone(source); setting(valid).method_value_json = JSON.stringify(content);
      expect(parseStudyMethodProfileLibrary(valid).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
    }
    const changedBody = Array.isArray(body) ? [...body as unknown[]].reverse() : { ...body as Record<string, unknown>, invented_input: true };
    for (const content of [null, changedBody, { conceptual_observation_roles: ["process/application identity", "bytes sent", "bytes received"] },
      { ...wrapper, definition: null }, { ...wrapper, source_facing_role: null }, { ...wrapper, source_facing_target: "raw_occurrence" }]) {
      const invalid = structuredClone(source); setting(invalid).method_value_json = JSON.stringify(content);
      expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/sampled-quantity definition|source-facing definition/);
    }
    for (const [field, value] of [["method_setting_role", "provenance"], ["method_target_layer", "study_window"], ["source_work_id", "doi:foreign"]]) {
      const invalid = structuredClone(source); Reflect.set(setting(invalid), field!, value);
      expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/local definition role\/target|sampled-quantity definition/);
    }
    const other = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/1879141.1879176")!);
    other.method_settings.push({ ...structuredClone(setting(source)), source_work_id: other.source_work_id });
    other.method_setting_count = other.method_settings.length; other.method_setting_ids = other.method_settings.map(s => s.method_setting_id);
    const foreign = { profiles: [other], sampled_quantity_observations: source.sampled_quantity_observations.map(row => ({
      ...row, method_profile_id: other.method_profile_id, source_work_id: other.source_work_id,
    })) };
    expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow(/sampled-quantity definition/);
  });
itWithPrivateCorpus("round-trips Energy raw event clocks, independent core/brightness inputs and UID counter intervals without reconstruction", async () => {
  const source = energyDrainRawInput();
  const persist = async (value: typeof source) => {
    const parsed = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], sampled_quantity_observations: parsed.sampled_quantity_observations }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], sampled_quantity_observations: saved.sampled_quantity_observations });
    expect(restored.sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
    return restored;
  };
  const rows = (await persist(source)).sampled_quantity_observations!;
  expect(rows).toHaveLength(18);
  expect(rows.slice(0, 13).map(row => JSON.parse(row.quantities![0]!.evidence_value_json!) as unknown)).toEqual([
    "WiFi on", "WiFi off", "mobile data on", "mobile data off", "screen on", "screen off", "WiFi association", "WiFi scan",
    "WiFi signal change", "cellular signal change", "battery 1% change", "app start", "app stop",
  ]);
  expect(rows.slice(0, 13).map(row => row.source_event_time_token)).toEqual(Array(13).fill("supplied-event-token-E"));
  expect(rows.slice(0, 13).map(row => row.observation_instant)).toEqual(Array(13).fill("independent-collection-token-C"));
  expect(new Set(rows.slice(0, 13).map(row => row.sampled_observation_id)).size).toBe(13);
  expect(rows.slice(11, 13).map(row => row.observed_entity_kind)).toEqual(["application", "application"]);
  expect(rows.slice(13, 15).map(row => [row.observed_entity_kind, row.observed_entity_token, row.quantities![0]!.evidence_value_json]))
    .toEqual([["cpu_core", "supplied-core-alpha", "384"], ["cpu_core", "supplied-core-beta", ' "594.000" ']]);
  expect(rows[15]!.quantities).toEqual([{ observed_property: "screen brightness", evidence_value_json: "51.000" }]);
  expect(rows.slice(16).map(row => row.quantities!.map(q => [q.observed_property, q.evidence_value_json, q.evidence_unit])))
    .toEqual([[["Nsnd", "0", "bytes"], ["Nrcv", "5", "bytes"], ["T", "1", "seconds"]],
      [["Nsnd", "7", "bytes"], ["Nrcv", "0", "bytes"], ["T", ' "5.00" ', "seconds"]]]);
  expect(rows[16]!.observed_entity_token).not.toBe(rows[17]!.observed_entity_token);
  for (const value of [undefined, null, "null"]) {
    const variant = structuredClone(source);
    for (const index of [0, 13, 15, 16]) {
      const quantity = variant.sampled_quantity_observations[index]!.quantities![0]!;
      if (value === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = value;
    }
    await persist(variant);
  }
  for (const value of [undefined, null]) {
    const variant = structuredClone(source), event = variant.sampled_quantity_observations[0]!, brightness = variant.sampled_quantity_observations[15]!;
    if (value === undefined) { delete event.source_event_time_token; delete event.observation_instant; delete brightness.quantities![0]!.evidence_unit; }
    else { event.source_event_time_token = value; event.observation_instant = value; brightness.quantities![0]!.evidence_unit = value; }
    await persist(variant);
  }
  for (const value of [undefined, null, []]) {
    const variant = structuredClone(source);
    if (value === undefined) delete variant.sampled_quantity_observations[0]!.quantities; else variant.sampled_quantity_observations[0]!.quantities = value;
    await persist(variant);
  }
  const independent = structuredClone(source);
  independent.sampled_quantity_observations[16]!.quantities![2]!.evidence_value_json = "2.500"; // No 1/5-second cadence eligibility or clock inference.
  independent.sampled_quantity_observations[15]!.quantities![0]!.evidence_value_json = "300"; // Printed calibration columns are not a declared raw eligibility range.
  await persist(independent);
  expect(independent.sampled_quantity_observations[17]).toEqual(source.sampled_quantity_observations[17]);
  const reversed = structuredClone(source); reversed.sampled_quantity_observations.reverse(); reversed.sampled_quantity_observations.forEach(row => row.quantities?.reverse());
  await persist(reversed);
  await persist(source); const saved = await loadResearchMethodSelection();
  for (const mutate of [
    (v: typeof source) => { v.sampled_quantity_observations[4]!.quantities![0]!.evidence_value_json = '"ON"'; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.quantities![0]!.evidence_value_json = "0"; },
    (v: typeof source) => { v.sampled_quantity_observations[11]!.observed_entity_kind = "device"; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.observed_entity_kind = "application"; },
    (v: typeof source) => { Reflect.deleteProperty(v.sampled_quantity_observations[11]!, "participant_id"); },
    (v: typeof source) => { v.sampled_quantity_observations[13]!.observed_entity_kind = "process"; },
    (v: typeof source) => { v.sampled_quantity_observations[13]!.quantities![0]!.observed_property = "frequency residency duration"; },
    (v: typeof source) => { v.sampled_quantity_observations[13]!.quantities![0]!.evidence_unit = "seconds"; },
    (v: typeof source) => { v.sampled_quantity_observations[15]!.quantities![0]!.evidence_unit = "percent"; },
    (v: typeof source) => { v.sampled_quantity_observations[16]!.observed_entity_kind = "application"; },
    (v: typeof source) => { v.sampled_quantity_observations[16]!.quantities![2]!.evidence_unit = "milliseconds"; },
    (v: typeof source) => { v.sampled_quantity_observations[16]!.quantities![2]!.observed_property = "observation_instant"; },
    (v: typeof source) => { v.sampled_quantity_observations[16]!.quantities!.push(structuredClone(v.sampled_quantity_observations[16]!.quantities![0]!)); },
    (v: typeof source) => { v.sampled_quantity_observations[16]!.quantities![2]!.evidence_value_json = "1e400"; },
    (v: typeof source) => { v.sampled_quantity_observations[16]!.quantities![2]!.evidence_value_json = "{}"; },
    (v: typeof source) => { Reflect.set(v.sampled_quantity_observations[0]!, "source_event_time_token", 0); },
    (v: typeof source) => { Reflect.set(v.sampled_quantity_observations[16]!, "denotes_interval", { duration_seconds: 1 }); },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.sampled_observation_id = v.sampled_quantity_observations[1]!.sampled_observation_id; },
  ]) {
    const invalid = structuredClone(source); mutate(invalid);
    await expect(persist(invalid)).rejects.toThrow();
    expect(await loadResearchMethodSelection()).toBe(saved);
  }
});

function energyDrainInput() {
  const profile = canonical().profiles.find(p => p.source_work_id === "doi:10.1145/2745844.2745875");
  if (!profile) throw new Error("Required frozen Energy Drain profile absent");
  return { profiles: [structuredClone(profile)], sampled_quantity_observations: energyDrainObservationExample() };
}
itWithPrivateCorpus.each(["collector.network_counters", "collector.cpu_app_sources", "collector.gpu_fields"])("imports Energy Drain %s through its actual source definition", key => {
  const source = energyDrainInput();
  const setting = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  const reference = setting(source).method_setting_id;
  source.sampled_quantity_observations = source.sampled_quantity_observations.filter(row => row.method_setting_reference === reference);
  expect(source.sampled_quantity_observations.length).toBeGreaterThan(0);
  expect(() => parseStudyMethodProfileLibrary({ profiles: source.profiles })).not.toThrow();
  expect(parseStudyMethodProfileLibrary(source).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  const body: unknown = JSON.parse(String(setting(source).method_value_json));
  const wrapper = { definition: body, source_facing_role: "event_schema", source_facing_target: "acquired_snapshot" };
  for (const content of [body, wrapper]) {
    const valid = structuredClone(source); setting(valid).method_value_json = JSON.stringify(content);
    expect(parseStudyMethodProfileLibrary(valid).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  }
  const changedBody = Array.isArray(body) ? [...body as unknown[]].reverse() : "per-package interval totals";
  for (const content of [
    changedBody, null, { conceptual_observation_roles: ["process/application identity", "bytes sent", "bytes received"] },
    { ...wrapper, definition: null }, { ...wrapper, source_facing_role: null },
    { ...wrapper, source_facing_target: "raw_occurrence" },
  ]) {
    const invalid = structuredClone(source); setting(invalid).method_value_json = JSON.stringify(content);
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  for (const [field, value] of [["method_setting_role", "acquisition"], ["method_target_layer", "raw_record"], ["source_work_id", "doi:foreign"]]) {
    const invalid = structuredClone(source); Reflect.set(setting(invalid), field!, value);
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/local definition role\/target|sampled-quantity definition/);
  }
  // A self-consistent other source must not borrow the recognized key/body; this reaches the DOI guard.
  const other = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/1879141.1879176")!);
  const transplanted = { ...structuredClone(setting(source)), source_work_id: other.source_work_id };
  other.method_settings.push(transplanted);
  other.method_setting_count = other.method_settings.length;
  other.method_setting_ids = other.method_settings.map(s => s.method_setting_id);
  const foreign = { profiles: [other], sampled_quantity_observations: source.sampled_quantity_observations.map(row => ({
    ...row, method_profile_id: other.method_profile_id, source_work_id: other.source_work_id,
  })) };
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow(/sampled-quantity definition/);
});
itWithPrivateCorpus("preserves independently owned Energy Drain scalars and unknowns through import/save/reload", async () => {
  const source = energyDrainInput();
  const persist = async (value: typeof source) => {
    const parsed = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], sampled_quantity_observations: parsed.sampled_quantity_observations }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], sampled_quantity_observations: saved.sampled_quantity_observations });
    expect(restored.sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
    return restored.sampled_quantity_observations!;
  };
  const rows = await persist(source);
  expect(rows[0]!.observation_instant).toBe(rows[1]!.observation_instant);
  expect(rows[0]!.sampled_observation_id).not.toBe(rows[1]!.sampled_observation_id);
  expect(rows[0]!.observed_entity_token).not.toBe(rows[1]!.observed_entity_token);
  expect(rows.slice(0, 2).map(row => row.quantities!.map(q => q.evidence_value_json))).toEqual([["0", '"5"'], [" 7 ", "0"]]);
  expect(rows[2]!.observed_entity_kind).toBe("process");
  expect(rows[3]!.observed_entity_kind).toBe("cpu_core");
  expect(rows[3]!.quantities!.slice(1).map(q => q.quantity_qualifier)).toEqual(["supplied-frequency-A", "supplied-frequency-B"]);
  expect(rows[4]!.quantities!.map(q => q.observed_property)).toEqual(["GPU state", "GPU frequency", "time in state"]);
  for (const value of [undefined, null, "null", ' "0.00" ']) {
    const variant = structuredClone(source), quantity = variant.sampled_quantity_observations[0]!.quantities![0]!;
    if (value === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = value;
    const restored = await persist(variant);
    expect(restored[0]!.quantities![1]).toEqual(rows[0]!.quantities![1]);
    expect(restored.slice(1)).toEqual(rows.slice(1));
  }
  for (const value of [undefined, null, []]) {
    const variant = structuredClone(source), row = variant.sampled_quantity_observations[4]!;
    if (value === undefined) delete row.quantities; else row.quantities = value;
    await persist(variant);
  }
  const unknownClock = structuredClone(source);
  delete unknownClock.sampled_quantity_observations[0]!.observation_instant;
  unknownClock.sampled_quantity_observations[1]!.observation_instant = null;
  await persist(unknownClock);
  const reordered = structuredClone(source);
  reordered.sampled_quantity_observations.reverse();
  reordered.sampled_quantity_observations.forEach(row => row.quantities?.reverse());
  await persist(reordered);
  await persist(source); const retained = await loadResearchMethodSelection();
  const mutations: Array<(v: typeof source) => void> = [
    v => { v.sampled_quantity_observations[0]!.observed_entity_kind = "process"; },
    v => { v.sampled_quantity_observations[4]!.observed_entity_kind = "cpu_core"; },
    v => { v.sampled_quantity_observations[0]!.source_work_id = "doi:foreign"; },
    v => { v.sampled_quantity_observations[0]!.method_setting_reference = v.sampled_quantity_observations[2]!.method_setting_reference; },
    v => { v.sampled_quantity_observations[0]!.quantities![0]!.evidence_unit = "seconds"; },
    v => { v.sampled_quantity_observations[4]!.quantities![1]!.evidence_unit = "mW"; },
    v => { v.sampled_quantity_observations[2]!.quantities![0]!.evidence_unit = "percent"; },
    v => { v.sampled_quantity_observations[4]!.quantities![2]!.evidence_unit = "seconds"; },
    v => { v.sampled_quantity_observations[0]!.quantities![0]!.observed_property = "network usage"; },
    v => { v.sampled_quantity_observations[2]!.quantities!.push({ observed_property: "frequency residency duration", evidence_value_json: "1" }); },
    v => { v.sampled_quantity_observations[3]!.quantities![0]!.quantity_qualifier = "supplied-frequency-A"; },
    v => { v.sampled_quantity_observations[3]!.quantities!.push(structuredClone(v.sampled_quantity_observations[3]!.quantities![0]!)); },
    v => { v.sampled_quantity_observations[3]!.quantities!.push(structuredClone(v.sampled_quantity_observations[3]!.quantities![1]!)); },
    v => { v.sampled_quantity_observations.push(structuredClone(v.sampled_quantity_observations[0]!)); },
    v => { Reflect.set(v.sampled_quantity_observations[0]!, "app_package_name", "not-a-disclosed-UID-join"); },
    v => { Reflect.set(v.sampled_quantity_observations[4]!, "denotes_interval", { duration_seconds: 7 }); },
  ];
  for (const token of ["true", "{}", "[]", "bad-json", "1e400"]) mutations.push(v => {
    v.sampled_quantity_observations[0]!.quantities![0]!.evidence_value_json = token;
  });
  for (const mutate of mutations) {
    const invalid = structuredClone(source); mutate(invalid);
    await expect(persist(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained);
  }
});
function apnomsInput() {
  return { profiles: [structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1109/apnoms.2011.6077030")!)], sampled_quantity_observations: apnomsSnapshotExample() };
}
itWithPrivateCorpus("preserves APNOMS independent five-state, three-state and power-source summaries", async () => {
  const source = apnomsInput(); source.sampled_quantity_observations = apnomsSummaryExample(source.profiles[0]!);
  const parsed = parseStudyMethodProfileLibrary(source);
  await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], sampled_quantity_observations: parsed.sampled_quantity_observations }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
  expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], sampled_quantity_observations: saved.sampled_quantity_observations }).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  const changed = structuredClone(source); changed.sampled_quantity_observations[2]!.quantities![0]!.evidence_value_json = "99.00";
  expect(parseStudyMethodProfileLibrary(changed).sampled_quantity_observations).toEqual(changed.sampled_quantity_observations);
  expect(changed.sampled_quantity_observations[4]).toEqual(source.sampled_quantity_observations[4]);
  for (const mutate of [
    (v: typeof source) => { v.sampled_quantity_observations[0]!.quantities![0]!.evidence_unit = "seconds"; },
    (v: typeof source) => { v.sampled_quantity_observations[2]!.quantities![0]!.evidence_unit = "hours"; },
    (v: typeof source) => { v.sampled_quantity_observations[4]!.quantities![0]!.quantity_qualifier = "waiting"; },
    (v: typeof source) => { v.sampled_quantity_observations[6]!.quantities![0]!.quantity_qualifier = "Wi-Fi"; },
    (v: typeof source) => { v.sampled_quantity_observations[2]!.quantities![0]!.evidence_value_json = "101"; },
    (v: typeof source) => { v.sampled_quantity_observations[2]!.observed_entity_kind = "process"; },
  ]) { const invalid = structuredClone(source); mutate(invalid); expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(); }
  for (const row of source.sampled_quantity_observations) {
    const invalid = structuredClone(source), setting = invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === row.method_setting_reference)!;
    setting.method_value_json = JSON.stringify({ definition: "invented", source_facing_role: setting.method_setting_role, source_facing_target: setting.method_target_layer });
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
});
itWithPrivateCorpus.each(["collector.periodic_sampling", "schema.call_status_vocabulary", "schema.screen_status_vocabulary", "schema.three_g_data_status_vocabulary", "schema.active_network_vocabulary", "schema.wifi_status_vocabulary", "schema.battery_level_range", "schema.battery_status_vocabulary", "schema.battery_plugged_vocabulary"])("requires APNOMS exact local %s for joint samples", key => {
  const source = apnomsInput(), setting = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  const body: unknown = JSON.parse(String(setting(source).method_value_json));
  const wrapper = { definition: body, source_facing_role: setting(source).method_setting_role, source_facing_target: setting(source).method_target_layer };
  const contexts = (value: typeof source) => {
    const other = input();
    return [value, { ...other, profiles: [...value.profiles, ...other.profiles], sampled_quantity_observations: [...value.sampled_quantity_observations, ...other.sampled_quantity_observations] }];
  };
  for (const content of [body, wrapper]) {
    const valid = structuredClone(source); setting(valid).method_value_json = JSON.stringify(content);
    for (const value of contexts(valid)) expect(parseStudyMethodProfileLibrary(value).sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
  }
  const drift = Array.isArray(body) ? [...body as unknown[]].reverse() : { ...(body as Record<string, unknown>), invented: true };
  for (const content of [{ ...wrapper, definition: null }, { ...wrapper, definition: drift }, { ...wrapper, source_facing_role: "provenance" }, { ...wrapper, source_facing_target: "study_window" }]) {
    const invalid = structuredClone(source); setting(invalid).method_value_json = JSON.stringify(content);
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    for (const value of contexts(invalid)) expect(() => parseStudyMethodProfileLibrary(value)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  for (const [field, value] of [["method_setting_role", "provenance"], ["method_target_layer", "study_window"], ["source_work_id", "doi:foreign"]]) {
    const invalid = structuredClone(source); Reflect.set(setting(invalid), field!, value);
    for (const candidate of contexts(invalid)) expect(() => parseStudyMethodProfileLibrary(candidate)).toThrow(/local definition role\/target|sampled-quantity definition/);
  }
  if (key !== "collector.periodic_sampling") {
    const missing = structuredClone(source); setting(missing).method_parameter_key = `unrelated:${key}`;
    expect(() => parseStudyMethodProfileLibrary({ profiles: missing.profiles })).not.toThrow();
    for (const value of contexts(missing)) expect(() => parseStudyMethodProfileLibrary(value)).toThrow(/sampled-quantity definition/);
  }
  const duplicate = structuredClone(source); duplicate.profiles[0]!.method_settings.push({ ...structuredClone(setting(source)), method_setting_id: `${setting(source).method_setting_id}:duplicate` });
  duplicate.profiles[0]!.method_setting_count = duplicate.profiles[0]!.method_settings.length;
  duplicate.profiles[0]!.method_setting_ids = duplicate.profiles[0]!.method_settings.map(s => s.method_setting_id);
  expect(() => parseStudyMethodProfileLibrary({ profiles: duplicate.profiles })).not.toThrow();
  for (const value of contexts(duplicate)) expect(() => parseStudyMethodProfileLibrary(value)).toThrow(/sampled-quantity definition/);
});
itWithPrivateCorpus("preserves APNOMS joint snapshots, source categories and independent values through storage", async () => {
  const source = apnomsInput();
  const persist = async (value: typeof source) => {
    const parsed = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], sampled_quantity_observations: parsed.sampled_quantity_observations }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    const result = parseStudyMethodProfileLibrary({ profiles: [saved.profile], sampled_quantity_observations: saved.sampled_quantity_observations });
    expect(result.sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
    return result.sampled_quantity_observations!;
  };
  const restored = await persist(source);
  expect(restored[0]!.observation_instant).toBe(restored[1]!.observation_instant);
  expect(restored[0]!.sampled_observation_id).not.toBe(restored[1]!.sampled_observation_id);
  expect(restored[2]!.quantities!.slice(1, 4).map(q => q.evidence_value_json)).toEqual(["null", null, undefined]);
  const changed = structuredClone(source); changed.sampled_quantity_observations[0]!.quantities![2]!.evidence_value_json = ' "In" ';
  const changedRows = await persist(changed);
  expect(changedRows[0]!.quantities!.filter((_, i) => i !== 2)).toEqual(restored[0]!.quantities!.filter((_, i) => i !== 2));
  expect(changedRows.slice(1)).toEqual(restored.slice(1));
  for (const value of [undefined, null, "null", ' "75.00" ', "100"]) {
    const variant = structuredClone(source), q = variant.sampled_quantity_observations[0]!.quantities![5]!;
    if (value === undefined) delete q.evidence_value_json; else q.evidence_value_json = value;
    await persist(variant);
  }
  await persist(source); const retained = await loadResearchMethodSelection();
  for (const [index, tokens] of [[0, ['"Idle"', '"ringing"', "0", "true", "{}", "[]"]], [6, ['"Charging"']], [5, ["-1", "101", "1e400"]]] as const) for (const token of tokens) {
    const invalid = structuredClone(source); invalid.sampled_quantity_observations[0]!.quantities![index]!.evidence_value_json = token;
    await expect(persist(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained);
  }
  for (const mutate of [
    (v: typeof source) => { v.sampled_quantity_observations[0]!.observed_entity_kind = "process"; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.quantities![0]!.evidence_unit = "seconds"; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.quantities![5]!.evidence_unit = "minutes"; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.quantities![0]!.observed_property = "operation state"; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.source_work_id = "doi:foreign"; },
  ]) {
    const invalid = structuredClone(source); mutate(invalid);
    await expect(persist(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained);
  }
});
function mommSuppliedInput() {
  return mommSuppliedObservationExample(structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/2684103.2684156")!));
}

itWithPrivateCorpus.each([
  "schema.location_inputs", "schema.wifi_scan", "context.gsm_places", "context.wifi_places",
  "context.meaningful_places", "context.office_rule", "context.home_rule", "context.other_and_abroad",
  "aggregation.daily_features", "aggregation.session_features", "analysis.scan_yield",
  "analysis.security_configuration", "analysis.locking_population", "analysis.unlock_measure", "analysis.unlock_groups",
])("requires MOMM exact source-owned %s for its populated supplied owner", key => {
  const source = mommSuppliedInput();
  const route = key === "analysis.unlock_groups" ? "analysis.unlock_measure"
    : ["context.meaningful_places", "context.office_rule", "context.home_rule", "context.other_and_abroad"].includes(key) ? "context.wifi_places" : key;
  const reference = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === route)!.method_setting_id;
  source.sampled_quantity_observations = source.sampled_quantity_observations.filter(r => r.method_setting_reference === reference);
  expect(source.sampled_quantity_observations.length).toBeGreaterThan(0);
  const setting = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  const wrapped = JSON.parse(String(setting(source).method_value_json)) as Record<string, unknown>;
  const body = wrapped.definition as Record<string, unknown>;
  const contexts = (v: typeof source) => {
    const other = input();
    return [v, { ...other, profiles: [...v.profiles, ...other.profiles], sampled_quantity_observations: [...v.sampled_quantity_observations, ...other.sampled_quantity_observations] }];
  };
  for (const value of [body, wrapped]) {
    const valid = structuredClone(source); setting(valid).method_value_json = JSON.stringify(value);
    for (const candidate of contexts(valid)) expect(parseStudyMethodProfileLibrary(candidate).sampled_quantity_observations).toEqual(candidate.sampled_quantity_observations);
  }
  for (const value of [
    { ...wrapped, definition: null }, { ...wrapped, definition: { ...body, invented: true } },
    { ...wrapped, source_facing_role: "provenance" }, { ...wrapped, source_facing_target: "study_window" },
  ]) {
    const invalid = structuredClone(source); setting(invalid).method_value_json = JSON.stringify(value);
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    for (const candidate of contexts(invalid)) expect(() => parseStudyMethodProfileLibrary(candidate)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  for (const [field, value] of [["source_work_id", "doi:foreign"], ["method_setting_role", "provenance"], ["method_target_layer", "study_window"]]) {
    const invalid = structuredClone(source); Reflect.set(setting(invalid), field!, value);
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    for (const candidate of contexts(invalid)) expect(() => parseStudyMethodProfileLibrary(candidate)).toThrow(/local definition role\/target|sampled-quantity definition/);
  }
  const duplicate = structuredClone(source);
  duplicate.profiles[0]!.method_settings.push({ ...structuredClone(setting(duplicate)), method_setting_id: `${setting(duplicate).method_setting_id}:duplicate` });
  duplicate.profiles[0]!.method_setting_count = duplicate.profiles[0]!.method_settings.length;
  duplicate.profiles[0]!.method_setting_ids = duplicate.profiles[0]!.method_settings.map(s => s.method_setting_id);
  expect(() => parseStudyMethodProfileLibrary({ profiles: duplicate.profiles })).not.toThrow();
  for (const candidate of contexts(duplicate)) expect(() => parseStudyMethodProfileLibrary(candidate)).toThrow(/sampled-quantity definition/);
  if (route !== key) {
    const missing = structuredClone(source); setting(missing).method_parameter_key = `unrelated:${key}`;
    for (const operation of missing.profiles[0]!.method_operations as Array<{ configuration_dependencies: string[] }>) {
      operation.configuration_dependencies = operation.configuration_dependencies.map(dependency => dependency === key ? `unrelated:${key}` : dependency);
    }
    expect(() => parseStudyMethodProfileLibrary({ profiles: missing.profiles })).not.toThrow();
    for (const candidate of contexts(missing)) expect(() => parseStudyMethodProfileLibrary(candidate)).toThrow(/sampled-quantity definition/);
  }
});

itWithPrivateCorpus("preserves MOMM scan/place membership, local roots and independent device evidence through storage", async () => {
  const source = mommSuppliedInput();
  const find = (v: typeof source, id: string) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === `constructed:${id}`)!;
  const persist = async (v: typeof source) => {
    const parsed = parseStudyMethodProfileLibrary(v);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], sampled_quantity_observations: parsed.sampled_quantity_observations }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], sampled_quantity_observations: saved.sampled_quantity_observations }).sampled_quantity_observations!;
    expect(restored).toEqual(v.sampled_quantity_observations);
    return restored;
  };
  await persist(source);
  expect(find(source, "gsm-0").quantities![0]).toEqual(find(source, "gsm-1").quantities![0]);
  expect(find(source, "gsm-0").quantities![1]).not.toEqual(find(source, "gsm-1").quantities![1]);
  expect(find(source, "scan-a").observation_instant).toBe(find(source, "scan-b").observation_instant);
  expect(find(source, "scan-a").entity_members![0]!.entity_member_id).toBe(find(source, "scan-b").entity_members![0]!.entity_member_id);
  expect(find(source, "scan-a").entity_members![0]!.quantities![2]!.evidence_value_json).toBe("-41.00");
  expect(find(source, "scan-b").entity_members![0]!.quantities![2]!.evidence_value_json).toBe("-42.00");
  expect(find(source, "scan-empty").entity_members).toEqual([]);
  expect(find(source, "scan-null").entity_members).toBeNull();
  expect(find(source, "scan-unknown")).not.toHaveProperty("entity_members");
  expect(find(source, "wifi-place-a").root_entity_member_reference).toBe(find(source, "wifi-place-a").entity_members![1]!.entity_member_id);
  expect(find(source, "wifi-place-a").entity_members![0]!.observed_entity_token).toBe(find(source, "wifi-place-b").entity_members![0]!.observed_entity_token);
  expect(source.sampled_quantity_observations.filter(r => r.sampled_observation_id.startsWith("constructed:authentication-")).map(r => r.quantities![0]!.evidence_value_json)).toEqual(["9.99", "10.00", "10.01"]);
  expect(find(source, "authentication-0").device_id).not.toBe(find(source, "daily-summary").device_id);
  expect(find(source, "daily-summary")).not.toHaveProperty("referenced_day_token");

  const changed = structuredClone(source);
  find(changed, "scan-a").entity_members![0]!.quantities![2]!.evidence_value_json = ' "-99.00" ';
  find(changed, "wifi-place-a").entity_members!.reverse();
  find(changed, "wifi-place-a").quantities![1]!.evidence_value_json = "0";
  find(changed, "daily-summary").quantities![0]!.evidence_value_json = "19.25";
  await persist(changed);
  expect(find(changed, "wifi-place-a").root_entity_member_reference).toBe("wifi-b");
  expect(find(changed, "wifi-place-a").quantities![0]).toEqual(find(source, "wifi-place-a").quantities![0]);
  expect(find(changed, "daily-summary").quantities!.slice(1)).toEqual(find(source, "daily-summary").quantities!.slice(1));
  for (const id of ["scan-b", "wifi-place-b", "session-summary", "scan-yield", "security", "authentication-0"]) expect(find(changed, id)).toEqual(find(source, id));
  for (const membership of [undefined, null, []]) {
    const variant = structuredClone(source), place = find(variant, "wifi-place-a");
    if (membership === undefined) { delete place.entity_members; delete place.root_entity_member_reference; }
    else { place.entity_members = membership; place.root_entity_member_reference = null; }
    await persist(variant);
  }
  for (const quantities of [undefined, null, []]) {
    const variant = structuredClone(source), member = find(variant, "scan-a").entity_members![0]!;
    if (quantities === undefined) delete member.quantities; else member.quantities = quantities;
    await persist(variant);
  }
  for (const value of [undefined, null, "null", "0", ' "0.00" ']) {
    const variant = structuredClone(source), q = find(variant, "scan-a").entity_members![0]!.quantities![2]!;
    if (value === undefined) delete q.evidence_value_json; else q.evidence_value_json = value;
    await persist(variant);
  }
  for (const value of [undefined, null, "null", "true", "false"]) {
    const variant = structuredClone(source), q = find(variant, "security").quantities![0]!;
    if (value === undefined) delete q.evidence_value_json; else q.evidence_value_json = value;
    await persist(variant);
  }
  const unknownQualifiers = structuredClone(source);
  delete find(unknownQualifiers, "daily-summary").quantities![0]!.quantity_qualifier;
  find(unknownQualifiers, "authentication-0").quantities![0]!.quantity_qualifier = null;
  await persist(unknownQualifiers);

  await persist(source); const retained = await loadResearchMethodSelection();
  const invalids: Array<[string, (v: typeof source) => void, RegExp]> = [
    ["duplicate local member", v => { find(v, "scan-a").entity_members!.push(structuredClone(find(v, "scan-a").entity_members![0]!)); }, /duplicated within observation/],
    ["foreign root existing in another scan", v => { find(v, "wifi-place-a").root_entity_member_reference = "appearance-a"; }, /resolve within its own/],
    ["unresolved root after empty membership", v => { find(v, "wifi-place-a").entity_members = []; }, /resolve within its own/],
    ["root forbidden on scan even null", v => { find(v, "scan-a").root_entity_member_reference = null; }, /incompatible/],
    ["AP/cell kind mismatch", v => { find(v, "scan-a").entity_members![0]!.member_entity_kind = "cell"; }, /member_entity_kind/],
    ["member field unknown", v => { Reflect.set(find(v, "scan-a").entity_members![0]!, "rank", 1); }, /unknown/],
    ["missing member locator", v => { find(v, "scan-a").entity_members![0]!.source_locators = []; }, /source_locators/],
    ["scan field at parent", v => { find(v, "scan-a").quantities = [{ observed_property: "RSSI", evidence_value_json: "-30" }]; }, /observed_property/],
    ["signal reading attached to inferred place", v => { find(v, "wifi-place-a").entity_members![0]!.quantities!.push({ observed_property: "RSSI", evidence_value_json: "-30" }); }, /observed_property/],
    ["CID/LAC not AP properties", v => { find(v, "scan-a").entity_members![0]!.quantities![0]!.observed_property = "CID"; }, /observed_property/],
    ["invented signal unit", v => { find(v, "scan-a").entity_members![0]!.quantities![2]!.evidence_unit = "dBm"; }, /evidence_unit/],
    ["nested opaque object cannot replace typed members", v => { find(v, "scan-a").entity_members![0]!.quantities![0]!.evidence_value_json = "{}"; }, /scalar/],
    ["same-property duplicate within member", v => { find(v, "scan-a").entity_members![0]!.quantities!.push(structuredClone(find(v, "scan-a").entity_members![0]!.quantities![0]!)); }, /duplicated within observation/],
    ["unknown raw state is not a geographic place", v => { find(v, "wifi-place-a").observed_entity_kind = "device"; }, /observed_entity_kind/],
    ["one device partition is explicit", v => { delete find(v, "wifi-place-a").device_id; }, /supplied device owner/],
    ["members forbidden on ordinary GSM sample", v => { find(v, "gsm-0").entity_members = null; }, /incompatible/],
    ["configuration is not numeric coding", v => { find(v, "security").quantities![0]!.evidence_value_json = "1"; }, /supplied boolean/],
    ["Other does not mean PIN", v => { find(v, "authentication-1").quantities![0]!.quantity_qualifier = "PIN"; }, /incompatible source-defined variant/],
    ["scan stream not context input", v => { find(v, "scan-yield").quantities![0]!.quantity_qualifier = "GPS scans"; }, /incompatible source-defined variant/],
    ["abroad not assigned", v => { find(v, "wifi-place-a").quantities![0]!.evidence_value_json = '"abroad"'; }, /categorical/],
    ["different duration unit", v => { find(v, "session-summary").quantities![0]!.evidence_unit = "minutes"; }, /evidence_unit/],
  ];
  for (const [label, mutate, message] of invalids) {
    const invalid = structuredClone(source); mutate(invalid);
    await expect(persist(invalid), label).rejects.toThrow(message);
    expect(await loadResearchMethodSelection(), label).toBe(retained);
  }
  for (const other of [input(), apnomsInput(), mommInput()]) {
    Reflect.set(other.sampled_quantity_observations[0]!, "entity_members", null);
    expect(() => parseStudyMethodProfileLibrary(other)).toThrow(/incompatible/);
  }
});

function mommInput() {
  return mommFormFactorObservationExample(structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/2684103.2684156")!));
}
itWithPrivateCorpus("preserves MOMM device form factors independently of session kind, context and raw screen geometry", async () => {
  const source = mommInput();
  const persist = async (input: typeof source) => {
    const parsed = parseStudyMethodProfileLibrary(input);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], sampled_quantity_observations: parsed.sampled_quantity_observations }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], sampled_quantity_observations: saved.sampled_quantity_observations }).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  };
  await persist(source);
  expect(source.sampled_quantity_observations.map(row => row.device_id)).toEqual(["constructed:phone", "constructed:tablet"]);
  for (const value of [undefined, null, "null", '"tablet"']) {
    const changed = structuredClone(source), quantity = changed.sampled_quantity_observations[0]!.quantities![0]!;
    if (value === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = value;
    await persist(changed);
    expect(changed.sampled_quantity_observations[1]).toEqual(source.sampled_quantity_observations[1]);
  }
  await persist(source); const retained = await loadResearchMethodSelection();
  for (const token of ['"phone"', "7", "true", "{}", "[]", "bad-json"]) {
    const invalid = structuredClone(source); invalid.sampled_quantity_observations[0]!.quantities![0]!.evidence_value_json = token;
    await expect(persist(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained);
  }
  for (const mutate of [
    (v: typeof source) => { v.sampled_quantity_observations[0]!.observed_entity_kind = "participant"; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.quantities![0]!.evidence_unit = "inch"; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.quantities![0]!.observed_property = "screen diagonal"; },
    (v: typeof source) => { v.sampled_quantity_observations.push(structuredClone(v.sampled_quantity_observations[0]!)); },
  ]) {
    const invalid = structuredClone(source); mutate(invalid);
    await expect(persist(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained);
  }
});
itWithPrivateCorpus("requires the exact MOMM form-factor source definition and both tuples", () => {
  const source = mommInput(), setting = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === "feature.form_factor")!;
  const wrapped = JSON.parse(String(setting(source).method_value_json)) as Record<string, unknown>;
  for (const value of [wrapped, wrapped.definition]) {
    const valid = structuredClone(source); setting(valid).method_value_json = JSON.stringify(value);
    expect(parseStudyMethodProfileLibrary(valid).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  }
  for (const value of [{ ...wrapped, definition: null }, { ...wrapped, definition: { ...(wrapped.definition as Record<string, unknown>), tablet: { comparator: ">", value: 7 } } }, { ...wrapped, source_facing_role: null }, { ...wrapped, source_facing_target: "device_session" }]) {
    const invalid = structuredClone(source); setting(invalid).method_value_json = JSON.stringify(value);
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
  for (const [field, value] of [["source_work_id", "doi:foreign"], ["method_setting_role", "analysis"], ["method_target_layer", "device_session"]]) {
    const invalid = structuredClone(source); Reflect.set(setting(invalid), field!, value);
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
});
function input() {
  const profiles = workIds.map(id => {
    const profile = canonical().profiles.find(p => p.source_work_id === id);
    if (!profile) throw new Error(`Required frozen-corpus profile absent: ${id}`);
    return structuredClone(profile);
  });
  return { profiles, ...temporalObservationExample() };
}

function scalarInput() {
  const rows = scalarObservationExample();
  return { profiles: [...new Set(rows.map(r => r.source_work_id))].map(id => {
    const profile = canonical().profiles.find(p => p.source_work_id === id);
    if (!profile) throw new Error(`Required frozen-corpus profile absent: ${id}`);
    return structuredClone(profile);
  }), sampled_quantity_observations: rows };
}

function lonelinessInput() {
  return { profiles: [structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.2196/13209")!)],
    sampled_quantity_observations: lonelinessStepObservationExample() };
}

itWithPrivateCorpus("admits Direct Measurements' supplied thirty-day participant result without turning it into a task or instant", async () => {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1371/journal.pone.0165331")!);
  const row = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "example:participant", sampled_observation_id: "example:selected-window-results",
    record_origin: "analyst_constructed_example", method_setting_reference: "method-setting-e446fda52d96418bff224c5f",
    observed_entity_kind: "participant", source_locators: ["Direct Measurements physical p3, Measurement of Smartphone Screen-time; constructed result"],
    quantities: [{ observed_property: "overall average screen-time", evidence_value_json: "3.50", evidence_unit: "minutes/hour" }] };
  const parsed = parseStudyMethodProfileLibrary({ profiles: [profile], sampled_quantity_observations: [row] });
  await saveResearchMethodSelection(JSON.stringify({ profile, sampled_quantity_observations: parsed.sampled_quantity_observations }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
  const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], sampled_quantity_observations: saved.sampled_quantity_observations });
  expect(restored.sampled_quantity_observations).toEqual([row]);
  expect(restored).not.toHaveProperty("task_occurrences");
  expect(restored.sampled_quantity_observations![0]).not.toHaveProperty("observation_instant");
});

function moodableInput() {
  const profile = canonical().profiles.find(p => p.source_work_id === "doi:10.1016/j.smhl.2020.100118");
  if (!profile) throw new Error("Required frozen-corpus Moodable profile absent");
  return { profiles: [structuredClone(profile)], participant_day_observations: moodableAvailabilityExample() };
}

function directInput() {
  const profile = canonical().profiles.find(p => p.source_work_id === "doi:10.1371/journal.pone.0165331")!;
  return { profiles: [structuredClone(profile)], ...directScreenTimeObservationExample() };
}

itWithPrivateCorpus.each(["feature.screen_time_30_day", "analysis.sleep_relative_windows"])("requires the exact Direct Measurements %s definition on populated results", key => {
  const source = directInput();
  const setting = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  const wrapper = { definition: JSON.parse(String(setting.method_value_json)) as unknown, source_facing_role: "aggregation", source_facing_target: "derived_feature" };
  const variants = (value: typeof source) => {
    const other = input();
    const mixed = { ...value, profiles: [...value.profiles, ...other.profiles], sampled_quantity_observations: [...value.sampled_quantity_observations, ...other.sampled_quantity_observations], monthly_app_use_cells: other.monthly_app_use_cells };
    return [value, mixed];
  };
  for (const value of variants(source)) expect(parseStudyMethodProfileLibrary(value).sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
  const wrapped = structuredClone(source);
  wrapped.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!.method_value_json = JSON.stringify(wrapper);
  for (const value of variants(wrapped)) expect(parseStudyMethodProfileLibrary(value).sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
  for (const content of [
    { ...wrapper, definition: null }, { ...wrapper, definition: [] }, { ...wrapper, definition: [...wrapper.definition as string[]].reverse() },
    { ...wrapper, source_facing_role: "provenance" }, { ...wrapper, source_facing_target: "study_window" },
  ]) {
    const invalid = structuredClone(source);
    invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!.method_value_json = JSON.stringify(content);
    for (const value of variants(invalid)) expect(() => parseStudyMethodProfileLibrary(value)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  for (const [field, value] of [["method_setting_role", "provenance"], ["method_target_layer", "study_window"], ["source_work_id", "doi:foreign"]] as const) {
    const invalid = structuredClone(source);
    Reflect.set(invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!, field, value);
    for (const value of variants(invalid)) expect(() => parseStudyMethodProfileLibrary(value)).toThrow(/local definition role\/target|sampled-quantity definition/);
  }
});

itWithPrivateCorpus("preserves Direct Measurements' thirty-day bins and particular hours independently through storage", async () => {
  const source = directInput();
  const persist = async (value: typeof source) => {
    const parsed = parseStudyMethodProfileLibrary(value);
    const selected = { profile: parsed.profiles[0], sampled_quantity_observations: parsed.sampled_quantity_observations, participant_day_observations: parsed.participant_day_observations };
    await saveResearchMethodSelection(JSON.stringify(selected));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as typeof selected;
    expect(saved).toEqual(selected);
    const result = parseStudyMethodProfileLibrary({ profiles: [saved.profile], sampled_quantity_observations: saved.sampled_quantity_observations, participant_day_observations: saved.participant_day_observations });
    expect(result.sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
    expect(result.participant_day_observations).toEqual(value.participant_day_observations);
    return result;
  };
  await persist(source);
  const row = source.sampled_quantity_observations[0]!;
  expect(row.quantities).toHaveLength(30);
  expect(row.quantities!.slice(2, 26).map(q => q.quantity_qualifier)).toEqual(Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")));
  expect(row.quantities!.slice(26).map(q => q.quantity_qualifier)).toEqual(["hour before reported bedtime", "reported bedtime hour", "hour after reported bedtime", "all hours from reported bedtime to reported wake-up time"]);
  for (const field of ["observation_instant", "observed_entity_token", "referenced_hour_token", "task_occurrence_id"]) expect(row).not.toHaveProperty(field);
  expect(source.participant_day_observations.map(r => r.day_observation_value_json)).toEqual(["0.00", "12.50", "null", null, undefined]);
  for (const index of [0, 1, 2, 26]) {
    const variant = structuredClone(source); variant.sampled_quantity_observations[0]!.quantities![index]!.evidence_value_json = "13.75";
    const result = await persist(variant);
    expect(result.sampled_quantity_observations![0]!.quantities!.filter((_, i) => i !== index)).toEqual(row.quantities!.filter((_, i) => i !== index));
    expect(result.participant_day_observations).toEqual(source.participant_day_observations);
  }
  for (const token of [undefined, null, "null", "0.00", ' "0.00" ']) {
    const variant = structuredClone(source), quantity = variant.sampled_quantity_observations[0]!.quantities![2]!;
    if (token === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = token;
    await persist(variant);
  }
  for (const unknown of [undefined, null]) {
    const variant = structuredClone(source), quantity = variant.sampled_quantity_observations[0]!.quantities![2]!;
    if (unknown === undefined) delete quantity.quantity_qualifier; else quantity.quantity_qualifier = unknown;
    await persist(variant);
  }
  for (const quantities of [undefined, null, []]) {
    const variant = structuredClone(source);
    if (quantities === undefined) delete variant.sampled_quantity_observations[0]!.quantities; else variant.sampled_quantity_observations[0]!.quantities = quantities;
    await persist(variant);
  }
  const reversed = structuredClone(source); reversed.sampled_quantity_observations[0]!.quantities!.reverse(); reversed.participant_day_observations.reverse(); await persist(reversed);
  const mutations: Array<(value: typeof source) => void> = [
    x => { x.profiles[0]!.method_settings.find(s => s.method_parameter_key === "analysis.sleep_relative_windows")!.method_parameter_key = "unrelated"; },
    x => { x.sampled_quantity_observations[0]!.source_work_id = "foreign"; },
    x => { x.sampled_quantity_observations[0]!.observed_entity_kind = "device"; },
    x => { Reflect.set(x.sampled_quantity_observations[0]!, "referenced_hour_token", "example:particular-hour-0"); },
    x => { x.sampled_quantity_observations[0]!.quantities![0]!.evidence_unit = "minutes"; },
    x => { x.sampled_quantity_observations[0]!.quantities![0]!.quantity_qualifier = "00"; },
    x => { x.sampled_quantity_observations[0]!.quantities![2]!.quantity_qualifier = "24"; },
    x => { x.sampled_quantity_observations[0]!.quantities![2]!.quantity_qualifier = "example:particular-hour-0"; },
    x => { x.sampled_quantity_observations[0]!.quantities![2]!.quantity_qualifier = "reported bedtime hour"; },
    x => { x.sampled_quantity_observations[0]!.quantities![26]!.quantity_qualifier = "00"; },
    x => { x.sampled_quantity_observations[0]!.quantities![3]!.quantity_qualifier = "00"; },
    x => { x.sampled_quantity_observations.push(structuredClone(x.sampled_quantity_observations[0]!)); },
  ];
  for (const token of ["true", "{}", "[]", "1e999", "not-json"]) mutations.push(x => { x.sampled_quantity_observations[0]!.quantities![0]!.evidence_value_json = token; });
  await persist(source); const savedBefore = await loadResearchMethodSelection();
  for (const mutate of mutations) {
    const invalid = structuredClone(source); mutate(invalid);
    await expect(persist(invalid)).rejects.toThrow();
    expect(await loadResearchMethodSelection()).toBe(savedBefore);
  }
});

itWithPrivateCorpus("admits Moodable run availability only under its exact local source definition", () => {
  const source = moodableInput();
  const setting = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === "modality.missingness")!;
  expect(parseStudyMethodProfileLibrary(source).participant_day_observations).toEqual(source.participant_day_observations);
  const body: unknown = JSON.parse(String(setting.method_value_json));
  const wrapper = { definition: body, source_facing_role: "quality_control", source_facing_target: "participant_modality" };
  const wrapped = structuredClone(source);
  wrapped.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!.method_value_json = JSON.stringify(wrapper);
  expect(parseStudyMethodProfileLibrary(wrapped).participant_day_observations).toEqual(source.participant_day_observations);
  for (const content of [
    { ...wrapper, definition: null }, { ...wrapper, definition: [] },
    { ...wrapper, definition: "only participants contributing every modality are retained" },
    { ...wrapper, source_facing_role: "provenance" }, { ...wrapper, source_facing_target: "study_window" },
  ]) {
    const invalid = structuredClone(source);
    invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!.method_value_json = JSON.stringify(content);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
  for (const [field, value] of [["method_setting_role", "provenance"], ["method_target_layer", "participant_measure"]] as const) {
    const invalid = structuredClone(source);
    Reflect.set(invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!, field, value);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
  for (const observed_property of ["contacts", "Twitter", "text messages", "GPS", "call logs", "Instagram", "voice"]) {
    const one = structuredClone(source); one.participant_day_observations = [{ ...one.participant_day_observations[0]!, observed_property }];
    expect(parseStudyMethodProfileLibrary(one).participant_day_observations).toEqual(one.participant_day_observations);
  }
});

itWithPrivateCorpus("preserves independent Moodable runs and unknown availability without inventing periods, zero or refusal", async () => {
  const source = moodableInput();
  const roundtrip = async (value: typeof source) => {
    const expected = structuredClone(value.participant_day_observations);
    const parsed = parseStudyMethodProfileLibrary(value);
    const selection = { profile: parsed.profiles[0]!, selectedLevels: {}, participant_day_observations: parsed.participant_day_observations! };
    await saveResearchMethodSelection(JSON.stringify(selection));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as typeof selection;
    expect(saved).toEqual(selection);
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], participant_day_observations: saved.participant_day_observations });
    expect(restored.participant_day_observations).toEqual(expected);
    return restored.participant_day_observations!;
  };
  const restored = await roundtrip(source);
  expect(restored.map(row => [row.referenced_run_token, row.day_observation_id, row.observed_property, row.day_observation_value_json])).toEqual([
    ["example:run-A-not-a-clock", "example:modality-text", "text messages", '"provided"'],
    ["example:run-A-not-a-clock", "example:modality-calls", "call logs", '"unavailable"'],
    ["example:run-B-not-a-clock", "example:modality-text", "text messages", '"unavailable"'],
    ["example:run-B-not-a-clock", "example:modality-calls", "call logs", '"provided"'],
  ]);
  expect(restored.every(row => ["referenced_day_token", "referenced_hour_token", "referenced_night_token", "evidence_unit"].every(field => !Object.hasOwn(row, field)))).toBe(true);
  const changed = structuredClone(source); changed.participant_day_observations[0]!.day_observation_value_json = '"unavailable"';
  expect((await roundtrip(changed)).slice(1)).toEqual(source.participant_day_observations.slice(1));
  const renamed = structuredClone(source); renamed.participant_day_observations[0]!.referenced_run_token = "example:independent-run-C";
  expect((await roundtrip(renamed)).slice(1)).toEqual(source.participant_day_observations.slice(1));
  const reordered = structuredClone(source); reordered.participant_day_observations.reverse(); await roundtrip(reordered);
  const otherParticipant = structuredClone(source);
  otherParticipant.participant_day_observations.push({ ...structuredClone(source.participant_day_observations[0]!), participant_id: "example:other-moodable-participant" });
  await roundtrip(otherParticipant);
  for (const value of [undefined, null, "null", ' "provided" ', ' "unavailable" ']) {
    const partial = structuredClone(source);
    if (value === undefined) delete partial.participant_day_observations[0]!.day_observation_value_json;
    else partial.participant_day_observations[0]!.day_observation_value_json = value;
    const result = await roundtrip(partial);
    expect(Object.hasOwn(result[0]!, "day_observation_value_json")).toBe(value !== undefined);
    expect(result[0]!.day_observation_value_json).toBe(value);
    expect(result.slice(1)).toEqual(source.participant_day_observations.slice(1));
  }
  const unknownUnit = structuredClone(source); unknownUnit.participant_day_observations[0]!.evidence_unit = null; await roundtrip(unknownUnit);
  await roundtrip(source); const retained = await loadResearchMethodSelection();
  const mutations: Array<(value: typeof source) => void> = [
    value => { value.participant_day_observations[0]!.source_work_id = "foreign"; },
    value => { value.participant_day_observations[0]!.method_profile_id = "foreign"; },
    value => { value.participant_day_observations[0]!.participant_id = " "; },
    value => { value.participant_day_observations[0]!.method_setting_reference = "foreign"; },
    value => { value.participant_day_observations[0]!.method_setting_reference = value.profiles[0]!.method_settings.find(s => s.method_parameter_key !== "modality.missingness")!.method_setting_id; },
    value => { delete value.participant_day_observations[0]!.method_setting_reference; },
    value => { value.participant_day_observations[0]!.method_setting_reference = null; },
    value => { delete value.participant_day_observations[0]!.referenced_run_token; },
    value => { value.participant_day_observations[0]!.referenced_run_token = "example:run-B-not-a-clock"; },
    value => { value.participant_day_observations.push(structuredClone(value.participant_day_observations[0]!)); },
    value => { value.participant_day_observations[0]!.day_observation_kind = "objective_aggregate"; },
    value => { value.participant_day_observations[0]!.day_observation_kind = "subjective_response"; },
    value => { value.participant_day_observations[0]!.observed_property = "permission denied"; },
    value => { value.participant_day_observations[0]!.evidence_unit = "participants"; },
    value => { value.participant_day_observations[0]!.aggregate_observation_references = []; },
    value => { value.participant_day_observations[0]!.cross_period_aggregate_references = []; },
    value => { value.participant_day_observations[0]!.questionnaire_item_label = null; },
  ];
  for (const field of ["referenced_day_token", "referenced_hour_token", "referenced_night_token"]) {
    for (const token of [null, "example:run-A-not-a-clock"]) mutations.push(value => { Reflect.set(value.participant_day_observations[0]!, field, token); });
    mutations.push(value => { delete value.participant_day_observations[0]!.referenced_run_token; Reflect.set(value.participant_day_observations[0]!, field, "supplied-period"); });
  }
  for (const token of [null, "", " ", 0]) mutations.push(value => { Reflect.set(value.participant_day_observations[0]!, "referenced_run_token", token); });
  for (const token of ["0", "0.00", '"0"', "false", '"refused"', '"permission denied"', '"unknown"', "[]", "{}", "not-json"]) mutations.push(value => { value.participant_day_observations[0]!.day_observation_value_json = token; });
  for (const mutate of mutations) {
    const invalid = structuredClone(source); mutate(invalid);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(); expect(await loadResearchMethodSelection()).toBe(retained);
  }
});

itWithPrivateCorpus.each(["acquisition.fitbit_streams", "steps.features", "sleep.states"])("admits loneliness %s on its populated quantity owner and rejects incompatible definitions", key => {
  const source = lonelinessInput();
  const setting = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  source.sampled_quantity_observations = source.sampled_quantity_observations.filter(row => row.method_setting_reference === setting.method_setting_id);
  expect(source.sampled_quantity_observations.length).toBeGreaterThan(0);
  expect(parseStudyMethodProfileLibrary(source).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  const body: unknown = JSON.parse(String(setting.method_value_json));
  const wrapper = { definition: body, source_facing_role: setting.method_setting_role, source_facing_target: setting.method_target_layer };
  const wrapped = structuredClone(source);
  wrapped.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!.method_value_json = JSON.stringify(wrapper);
  expect(parseStudyMethodProfileLibrary(wrapped).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  for (const content of [
    { ...wrapper, definition: null }, { ...wrapper, definition: 0 }, { ...wrapper, definition: [] },
    { ...wrapper, definition: key === "sleep.states" ? ["asleep", "awake", "restless"] : key === "acquisition.fitbit_streams" ? ["one-minute step counts", "one-minute sleep states"] : ["total and maximum steps per five-minute unit", "active and sedentary bout count/duration summaries", "steps within bouts"] },
    { ...wrapper, source_facing_role: "provenance" }, { ...wrapper, source_facing_target: "outcome" },
  ]) {
    const invalid = structuredClone(source);
    invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!.method_value_json = JSON.stringify(content);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
  for (const [field, value] of [["method_setting_role", "provenance"], ["method_target_layer", "outcome"]] as const) {
    const invalid = structuredClone(source);
    Reflect.set(invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!, field, value);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
});

itWithPrivateCorpus("preserves Fitbit counts including ten and independent scoped step summaries without deriving states or aggregates", async () => {
  const source = lonelinessInput();
  const roundtrip = async (value: typeof source) => {
    const expected = structuredClone(value.sampled_quantity_observations);
    const parsed = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], sampled_quantity_observations: parsed.sampled_quantity_observations }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile; sampled_quantity_observations: typeof source.sampled_quantity_observations };
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], sampled_quantity_observations: saved.sampled_quantity_observations });
    expect(restored.sampled_quantity_observations).toEqual(expected);
    return restored;
  };
  const restored = await roundtrip(source);
  expect(restored.sampled_quantity_observations!.slice(0, 3).map(r => r.quantities![0]!.evidence_value_json)).toEqual(["9", "10", "11"]);
  expect(restored.sampled_quantity_observations!.slice(0, 3).every(r => !Object.hasOwn(r, "bout_state"))).toBe(true);
  expect(restored.sampled_quantity_observations!.slice(3, 6).map(r => r.quantities![0]!.quantity_qualifier)).toEqual([
    "semester; all day; all days", "weeks 1–6; morning; weekdays", "week 7; evening; weekends",
  ]);
  expect(restored.sampled_quantity_observations!.slice(3, 6).every(r => !Object.hasOwn(r, "observation_instant"))).toBe(true);
  expect(restored.sampled_quantity_observations![3]!.quantities!.slice(0, 2).map(q => [q.observed_property, q.evidence_value_json])).toEqual([
    ["total steps", "1000.00"], ["maximum steps in any five-minute period", "50.00"],
  ]);
  for (const index of [1, 3, 4, 5]) {
    const changed = structuredClone(source); changed.sampled_quantity_observations[index]!.quantities![0]!.evidence_value_json = "77.00";
    const result = await roundtrip(changed);
    expect(result.sampled_quantity_observations!.filter((_, i) => i !== index)).toEqual(source.sampled_quantity_observations.filter((_, i) => i !== index));
    expect(result.sampled_quantity_observations![index]!.quantities!.slice(1)).toEqual(source.sampled_quantity_observations[index]!.quantities!.slice(1));
  }
  for (const index of [1, 3]) for (const token of [undefined, null, "null", "0.00", ' "unknown" ', ...(index === 3 ? ["-1"] : [])]) {
    const partial = structuredClone(source); const quantity = partial.sampled_quantity_observations[index]!.quantities![0]!;
    if (token === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = token;
    await roundtrip(partial);
  }
  for (const token of [undefined, null]) {
    const partial = structuredClone(source); const quantity = partial.sampled_quantity_observations[3]!.quantities![0]!;
    if (token === undefined) delete quantity.quantity_qualifier; else quantity.quantity_qualifier = token;
    await roundtrip(partial);
  }
  const reordered = structuredClone(source); reordered.sampled_quantity_observations.reverse();
  reordered.sampled_quantity_observations.forEach(row => row.quantities?.reverse()); await roundtrip(reordered);
  const sleepReference = "method-setting-10c72eeb4f304472e8920580";
  const sleepRows = restored.sampled_quantity_observations!.filter(row => row.method_setting_reference === sleepReference);
  expect(sleepRows.map(row => row.quantities![0]!.evidence_value_json)).toEqual(['"asleep"', '"awake"', '"restless"', '"unknown"', undefined, null, "null"]);
  expect(sleepRows[4]!.quantities![0]).not.toHaveProperty("evidence_value_json");
  expect(sleepRows.every(row => !Object.hasOwn(row.quantities![0]!, "evidence_unit"))).toBe(true);
  for (const token of [undefined, null, "null", ' "asleep" ', ' "unknown" ']) {
    const partial = structuredClone(source);
    const row = partial.sampled_quantity_observations.find(item => item.method_setting_reference === sleepReference)!;
    if (token === undefined) delete row.quantities![0]!.evidence_value_json; else row.quantities![0]!.evidence_value_json = token;
    const result = await roundtrip(partial);
    expect(result.sampled_quantity_observations!.slice(0, 6)).toEqual(source.sampled_quantity_observations.slice(0, 6));
  }
  for (const token of [undefined, null]) {
    const partial = structuredClone(source); const row = partial.sampled_quantity_observations.find(item => item.method_setting_reference === sleepReference)!;
    if (token === undefined) delete row.observation_instant; else row.observation_instant = token;
    if (token === undefined) delete row.quantities![0]!.evidence_unit; else row.quantities![0]!.evidence_unit = token;
    await roundtrip(partial);
  }
  const before = await loadResearchMethodSelection();
  for (const mutate of [
    (x: typeof source) => { x.sampled_quantity_observations[0]!.source_work_id = "foreign"; },
    (x: typeof source) => { x.sampled_quantity_observations[0]!.method_setting_reference = "foreign"; },
    (x: typeof source) => { x.sampled_quantity_observations[0]!.observed_entity_kind = "device"; },
    (x: typeof source) => { Reflect.set(x.sampled_quantity_observations[1]!, "bout_state", "sedentary"); },
    (x: typeof source) => { x.sampled_quantity_observations[0]!.quantities![0]!.evidence_unit = "minutes"; },
    (x: typeof source) => { x.sampled_quantity_observations[0]!.quantities![0]!.observed_property = "Android step count"; },
    (x: typeof source) => { x.sampled_quantity_observations[3]!.quantities![4]!.evidence_unit = "seconds"; },
    (x: typeof source) => { x.sampled_quantity_observations[3]!.quantities![0]!.observed_property = "steps per five-minute unit"; },
    (x: typeof source) => { x.sampled_quantity_observations[3]!.quantities![10]!.observed_property = "minimum steps over sedentary bouts"; },
    (x: typeof source) => { x.sampled_quantity_observations[3]!.quantities![0]!.quantity_qualifier = " "; },
    (x: typeof source) => { x.sampled_quantity_observations[3]!.quantities!.push(structuredClone(x.sampled_quantity_observations[3]!.quantities![0]!)); },
    (x: typeof source) => { x.sampled_quantity_observations.push(structuredClone(x.sampled_quantity_observations[0]!)); },
    ...['"deep sleep"', '"UNKNOWN"', '"0"', "0", "1", "-1", "true", "{}", "[]"].map(token => (x: typeof source) => {
      x.sampled_quantity_observations.find(row => row.method_setting_reference === sleepReference)!.quantities![0]!.evidence_value_json = token;
    }),
    (x: typeof source) => { x.sampled_quantity_observations.find(row => row.method_setting_reference === sleepReference)!.quantities![0]!.evidence_unit = "minutes"; },
  ]) {
    const invalid = structuredClone(source); mutate(invalid);
    await expect(roundtrip(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(before);
  }
});

describe("sampled process quantities and independent monthly app-use cells", () => {
  itWithPrivateCorpus("preserves Screenomics app/hour identities separately from overlapping category aggregates and lexical missingness", async () => {
    const profile = canonical().profiles.find(p => p.source_work_id === "doi:10.1007/s41347-024-00443-5")!;
    const rows = screenomicsHourObservationExample();
    const roundTrip = async (values: typeof rows) => {
      const parsed = parseStudyMethodProfileLibrary({ profiles: [profile], participant_day_observations: values });
      await saveResearchMethodSelection(JSON.stringify({ profile, participant_day_observations: parsed.participant_day_observations }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile; participant_day_observations: typeof rows };
      expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], participant_day_observations: saved.participant_day_observations }).participant_day_observations).toEqual(values);
    };
    await roundTrip(rows);
    expect(rows.slice(0, 5).map(r => r.day_observation_value_json)).toEqual(["0.00", '"NA"', "null", null, undefined]);
    expect(rows[4]).not.toHaveProperty("day_observation_value_json");
    expect(rows.slice(7).map(r => r.observation_category)).toEqual(["SNS", "Broad", "Google Play", "Popular SM"]);
    const codebook = JSON.parse(String(profile.method_settings.find(s => s.method_parameter_key === "category.package_membership_codebook")!.method_value_json)) as { positive_memberships: Array<{ package_name: string; categories: string[] }> };
    expect(codebook.positive_memberships.find(r => r.package_name === "com.instagram.android")!.categories).toEqual(["SNS", "Broad", "Google Play", "Popular SM"]);
    expect(codebook.positive_memberships.find(r => r.package_name === "com.google.android.youtube")!.categories).toEqual(["SNS", "Broad", "Popular SM"]);
    const moved = structuredClone(rows);
    [moved[0]!.app_package_name, moved[5]!.app_package_name] = [moved[5]!.app_package_name, moved[0]!.app_package_name];
    await roundTrip(moved);
    expect(moved.map(r => r.day_observation_value_json)).toEqual(rows.map(r => r.day_observation_value_json));
    expect(moved).not.toEqual(rows);
    for (const value of [undefined, null]) {
      const changed = structuredClone(rows);
      changed[0]!.app_package_name = value;
      if (value === undefined) delete changed[0]!.app_package_name;
      await roundTrip(changed);
    }
    for (const invalid of ["", " ", false, 0]) {
      const changed = structuredClone(rows);
      Reflect.set(changed[0]!, "app_package_name", invalid);
      expect(() => parseStudyMethodProfileLibrary({ profiles: [profile], participant_day_observations: changed })).toThrow("app_package_name");
    }
  });

  itWithPrivateCorpus("preserves independent participant-hour aggregates without inventing a day", async () => {
    const profile = scalarInput().profiles.find(p => p.source_work_id === "doi:10.1145/3313831.3376163")!;
    const rows = participantHourObservationExample();
    const parsed = parseStudyMethodProfileLibrary({ profiles: [profile], participant_day_observations: rows });
    expect(parsed.participant_day_observations).toEqual(rows);
    const selection = { profile: parsed.profiles[0], participant_day_observations: parsed.participant_day_observations };
    await saveResearchMethodSelection(JSON.stringify(selection));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as typeof selection;
    expect(saved).toEqual(selection);
    expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], participant_day_observations: saved.participant_day_observations }).participant_day_observations).toEqual(rows);
    expect(rows.every(row => !Object.hasOwn(row, "referenced_day_token"))).toBe(true);
    expect(rows.slice(0, 5).reduce((n, row) => n + Number(row.day_observation_value_json), 0)).toBeGreaterThan(100);
    expect(rows[2]!.day_observation_value_json).toBe(rows[3]!.day_observation_value_json);
    expect(rows.slice(0, 5).map(r => r.observed_property)).toEqual(["mean contempt", "mean disgust", "mean joy", "mean sadness", "mean surprise"]);
    const moved = structuredClone(rows);
    moved[0]!.referenced_hour_token = "example:hour-C-not-a-clock";
    expect(parseStudyMethodProfileLibrary({ profiles: [profile], participant_day_observations: moved }).participant_day_observations).toEqual(moved);
    expect(moved.map(r => r.day_observation_value_json)).toEqual(rows.map(r => r.day_observation_value_json));
  });

  itWithPrivateCorpus("keeps equal day/hour tokens distinct and rejects ambiguous or cross-period ownership", () => {
    const day = notificationParticipantDayExample();
    const hour = participantHourObservationExample();
    const profile = scalarInput().profiles.find(p => p.source_work_id === hour[0]!.source_work_id)!;
    const input = { profiles: [profile, ...day.profiles], participant_day_observations: [...hour, ...day.participant_day_observations] };
    const first = day.participant_day_observations[0]!;
    input.participant_day_observations.push({ ...first, referenced_day_token: hour[0]!.referenced_hour_token,
      method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
      participant_id: hour[0]!.participant_id, day_observation_id: hour[0]!.day_observation_id });
    expect(parseStudyMethodProfileLibrary(input).participant_day_observations).toEqual(input.participant_day_observations);
    for (const value of [undefined, null, "null", '"NA"', "0", "0.00", '"0.00"']) {
      const copy = structuredClone(input);
      if (value === undefined) Reflect.deleteProperty(copy.participant_day_observations[0]!, "day_observation_value_json");
      else Reflect.set(copy.participant_day_observations[0]!, "day_observation_value_json", value);
      expect(parseStudyMethodProfileLibrary(copy).participant_day_observations).toEqual(copy.participant_day_observations);
    }
    const mutations: Array<(x: typeof input) => void> = [
      x => { Reflect.deleteProperty(x.participant_day_observations[0]!, "referenced_hour_token"); },
      x => { Reflect.set(x.participant_day_observations[0]!, "referenced_hour_token", null); },
      x => { Reflect.set(x.participant_day_observations[0]!, "referenced_hour_token", 10); },
      x => { Reflect.set(x.participant_day_observations[0]!, "referenced_hour_token", " "); },
      x => { x.participant_day_observations.push(structuredClone(x.participant_day_observations[0]!)); },
      x => { x.participant_day_observations[0]!.participant_id = " "; },
      x => { x.participant_day_observations[0]!.method_profile_id = "foreign"; },
      x => { x.participant_day_observations[0]!.source_work_id = "foreign"; },
    ];
    for (const value of [undefined, null, "", "example-day"]) mutations.push(x => { Reflect.set(x.participant_day_observations[0]!, "referenced_day_token", value); });
    for (const mutation of mutations) { const copy = structuredClone(input); mutation(copy); expect(() => parseStudyMethodProfileLibrary(copy)).toThrow(); }
    // A day-owned response cannot link to an hour-owned aggregate even if tokens match.
    const crossPeriod = structuredClone(day);
    const aggregate = crossPeriod.participant_day_observations[0]!;
    Reflect.set(aggregate, "referenced_hour_token", aggregate.referenced_day_token);
    Reflect.deleteProperty(aggregate, "referenced_day_token");
    expect(() => parseStudyMethodProfileLibrary(crossPeriod)).toThrow("within profile/participant/referenced period");
    const hourA = structuredClone(day);
    for (const row of hourA.participant_day_observations) {
      Reflect.set(row, "referenced_hour_token", row.referenced_day_token);
      Reflect.deleteProperty(row, "referenced_day_token");
    }
    // This is an importer ownership probe, not a claim that In-Situ used hourly responses.
    expect(parseStudyMethodProfileLibrary(hourA).participant_day_observations).toEqual(hourA.participant_day_observations);
    Reflect.set(hourA.participant_day_observations[2]!, "referenced_hour_token", "another-hour");
    expect(() => parseStudyMethodProfileLibrary(hourA)).toThrow("within profile/participant/referenced period");
  });

  itWithPrivateCorpus("preserves Hush and emotion scalar ownership, lexical values and unknown qualifiers through save/reimport", async () => {
    const raw = scalarInput();
    const parsed = parseStudyMethodProfileLibrary(raw);
    expect(parsed.sampled_quantity_observations).toEqual(raw.sampled_quantity_observations);
    for (const profile of parsed.profiles) {
      const selected = { profile, selectedLevels: {}, sampled_quantity_observations: parsed.sampled_quantity_observations!.filter(r => r.method_profile_id === profile.method_profile_id) };
      await saveResearchMethodSelection(JSON.stringify(selected));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as typeof selected;
      expect(saved).toEqual(selected);
      expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], sampled_quantity_observations: saved.sampled_quantity_observations }).sampled_quantity_observations).toEqual(selected.sampled_quantity_observations);
    }
    for (const field of ["evidence_value_json", "evidence_unit", "quantity_qualifier"] as const) {
      for (const unknown of [undefined, null]) {
        const copy = scalarInput();
        const q = copy.sampled_quantity_observations[2]!.quantities![0]!;
        if (unknown === undefined) Reflect.deleteProperty(q, field); else Reflect.set(q, field, unknown);
        expect(parseStudyMethodProfileLibrary(copy).sampled_quantity_observations).toEqual(copy.sampled_quantity_observations);
      }
    }
    for (const token of [undefined, null, "null", '"null"', '"101"', "0", "100"]) {
      const copy = scalarInput();
      Reflect.set(copy.sampled_quantity_observations[8]!.quantities![0]!, "evidence_value_json", token);
      expect(parseStudyMethodProfileLibrary(copy).sampled_quantity_observations).toEqual(copy.sampled_quantity_observations);
    }
    const reversed = scalarInput();
    reversed.sampled_quantity_observations[2]!.quantities!.reverse();
    reversed.sampled_quantity_observations.reverse();
    expect(parseStudyMethodProfileLibrary(reversed).sampled_quantity_observations).toEqual(reversed.sampled_quantity_observations);
  });

  itWithPrivateCorpus("rejects wrong scalar definitions, units, subjects, duplicate known qualifiers and invented app joins", () => {
    const mutations: Array<(x: ReturnType<typeof scalarInput>) => void> = [
      x => { x.sampled_quantity_observations[0]!.source_work_id = "foreign"; },
      x => { x.sampled_quantity_observations[0]!.method_setting_reference = x.sampled_quantity_observations[3]!.method_setting_reference; },
      x => { Reflect.set(x.sampled_quantity_observations[3]!, "observed_entity_kind", "process"); },
      x => { Reflect.set(x.sampled_quantity_observations[0]!, "app_package_name", "invented.pid.mapping"); },
      x => { x.sampled_quantity_observations[0]!.quantities![0]!.evidence_unit = "seconds"; },
      x => { x.sampled_quantity_observations[3]!.quantities![0]!.evidence_unit = "bits"; },
      x => { Reflect.deleteProperty(x.sampled_quantity_observations[3]!.quantities![0]!, "evidence_unit"); },
      x => { x.sampled_quantity_observations[6]!.quantities![0]!.evidence_unit = "dBm"; },
      x => { x.sampled_quantity_observations[8]!.quantities![0]!.evidence_unit = "percent"; },
      x => { x.sampled_quantity_observations[2]!.quantities![1]!.quantity_qualifier = "supplied-frequency-A"; },
      x => { x.sampled_quantity_observations[0]!.quantities![0]!.quantity_qualifier = "not-residency"; },
      x => { x.sampled_quantity_observations[0]!.quantities!.push(structuredClone(x.sampled_quantity_observations[0]!.quantities![0]!)); },
      x => { x.sampled_quantity_observations[8]!.quantities![0]!.observed_property = "valence"; },
      x => { x.profiles[0]!.method_settings.find(s => s.method_setting_id === x.sampled_quantity_observations[0]!.method_setting_reference)!.method_value_json = JSON.stringify({ cadence_seconds: 300, source: "/proc/stat" }); },
      x => { x.profiles[1]!.method_settings.find(s => s.method_parameter_key === "collector.emotion_fields")!.method_value_json = JSON.stringify(["anger", "anger"]); },
    ];
    for (const token of ["101", "-1", "1e999", "true", "[]", "{}"])
      mutations.push(x => { x.sampled_quantity_observations[8]!.quantities![0]!.evidence_value_json = token; });
    for (const mutation of mutations) { const wrong = scalarInput(); mutation(wrong); expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(); }
    for (const row of scalarObservationExample()) {
      for (const field of ["method_setting_role", "method_target_layer", "method_value_json"]) {
        const wrong = scalarInput();
        const definition = wrong.profiles.find(p => p.method_profile_id === row.method_profile_id)!.method_settings.find(s => s.method_setting_id === row.method_setting_reference)!;
        Reflect.set(definition, field, field === "method_value_json" ? "{}" : field === "method_setting_role" ? "reporting" : "derived_feature");
        expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
      }
      for (const field of ["source_facing_role", "source_facing_target"]) {
        const wrong = scalarInput();
        const definition = wrong.profiles.find(p => p.method_profile_id === row.method_profile_id)!.method_settings.find(s => s.method_setting_id === row.method_setting_reference)!;
        const wrapper = { definition: JSON.parse(String(definition.method_value_json)) as unknown,
          source_facing_role: definition.method_setting_role, source_facing_target: definition.method_target_layer };
        Reflect.set(wrapper, field, field === "source_facing_role" ? "reporting" : "derived_feature");
        definition.method_value_json = JSON.stringify(wrapper);
        expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow("source-facing definition disagrees");
      }
    }
  });

  itWithPrivateCorpus("imports and persists constructed records under both actual canonical source definitions", async () => {
    const raw = input();
    const parsed = parseStudyMethodProfileLibrary(raw);
    expect(parsed.sampled_quantity_observations).toEqual(raw.sampled_quantity_observations);
    expect(parsed.monthly_app_use_cells).toEqual(raw.monthly_app_use_cells);
    for (const profile of parsed.profiles) {
      const selected = {
        profile, selectedLevels: {},
        sampled_quantity_observations: parsed.sampled_quantity_observations!.filter(r => r.method_profile_id === profile.method_profile_id),
        monthly_app_use_cells: parsed.monthly_app_use_cells!.filter(r => r.method_profile_id === profile.method_profile_id),
      };
      await saveResearchMethodSelection(JSON.stringify(selected));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as typeof selected;
      expect(saved).toEqual(selected);
      const reimported = parseStudyMethodProfileLibrary({ profiles: [saved.profile],
        sampled_quantity_observations: saved.sampled_quantity_observations, monthly_app_use_cells: saved.monthly_app_use_cells });
      expect(reimported.sampled_quantity_observations).toEqual(selected.sampled_quantity_observations);
      expect(reimported.monthly_app_use_cells).toEqual(selected.monthly_app_use_cells);
    }
    const swapped = input();
    swapped.sampled_quantity_observations.reverse();
    swapped.monthly_app_use_cells.reverse();
    expect(parseStudyMethodProfileLibrary(swapped).sampled_quantity_observations).toEqual(swapped.sampled_quantity_observations);
    expect(parseStudyMethodProfileLibrary(swapped).monthly_app_use_cells).toEqual(swapped.monthly_app_use_cells);
  });

  itWithPrivateCorpus("preserves unknown, empty, lexical null and scoped identity without inferring zero or joins", () => {
    const raw = input();
    const variants = [undefined, null, []] as const;
    for (const quantities of variants) {
      const value = structuredClone(raw);
      Reflect.set(value.sampled_quantity_observations[0]!, "quantities", quantities);
      Reflect.set(value.sampled_quantity_observations[0]!, "observation_instant", null);
      Reflect.deleteProperty(value.sampled_quantity_observations[0]!, "observed_entity_token");
      expect(parseStudyMethodProfileLibrary(value).sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
    }
    for (const token of [undefined, null, "null", "0", '"0"', "900719925474099312345", "true", "[]", "{}"]) {
      const value = structuredClone(raw);
      Reflect.set(value.sampled_quantity_observations[0]!.quantities[0]!, "evidence_value_json", token);
      expect(parseStudyMethodProfileLibrary(value).sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
    }
    const distinct = structuredClone(raw);
    distinct.sampled_quantity_observations.push({ ...structuredClone(distinct.sampled_quantity_observations[0]!), sampled_observation_id: "separate-observation-same-content" });
    distinct.sampled_quantity_observations.push({ ...structuredClone(distinct.sampled_quantity_observations[0]!), participant_id: "other-user" });
    distinct.monthly_app_use_cells.push({ ...structuredClone(distinct.monthly_app_use_cells[0]!), participant_id: "other-user" });
    expect(parseStudyMethodProfileLibrary(distinct).sampled_quantity_observations).toHaveLength(4);
    expect(parseStudyMethodProfileLibrary(distinct).monthly_app_use_cells).toHaveLength(5);
    const absent = parseStudyMethodProfileLibrary({ profiles: raw.profiles });
    expect(absent).not.toHaveProperty("sampled_quantity_observations");
    expect(absent).not.toHaveProperty("monthly_app_use_cells");
    expect(parseStudyMethodProfileLibrary({ profiles: raw.profiles, sampled_quantity_observations: [], monthly_app_use_cells: [] })).toMatchObject({ sampled_quantity_observations: [], monthly_app_use_cells: [] });
  });

  itWithPrivateCorpus("rejects incompatible owners, duplicate directions, invented fields and nonbinary monthly values", () => {
    const mutations: Array<(x: ReturnType<typeof input>) => void> = [
      x => Reflect.set(x, "monthly_app_use_cells", {}),
      x => Reflect.set(x, "monthly_app_use_cells", [null]),
      x => { x.sampled_quantity_observations[0]!.source_work_id = "foreign"; },
      x => { x.sampled_quantity_observations[0]!.method_setting_reference = x.monthly_app_use_cells[0]!.method_setting_reference; },
      x => { x.sampled_quantity_observations[0]!.observed_entity_kind = "application"; },
      x => { x.sampled_quantity_observations.push(structuredClone(x.sampled_quantity_observations[0]!)); },
      x => { x.sampled_quantity_observations[0]!.quantities.push(structuredClone(x.sampled_quantity_observations[0]!.quantities[0]!)); },
      x => { x.sampled_quantity_observations[0]!.quantities[0]!.evidence_unit = "bits"; },
      x => { x.sampled_quantity_observations[0]!.quantities[0]!.evidence_value_json = "invalid-json"; },
      x => { Reflect.set(x.sampled_quantity_observations[0]!, "app_package_name", "invented.process.mapping"); },
      x => { x.monthly_app_use_cells[0]!.method_profile_id = x.profiles[0]!.method_profile_id; },
      x => { x.monthly_app_use_cells.push(structuredClone(x.monthly_app_use_cells[0]!)); },
      x => { x.monthly_app_use_cells[0]!.month_label = " "; },
      x => { x.monthly_app_use_cells[0]!.app_identifier = ""; },
      x => { Reflect.set(x.monthly_app_use_cells[0]!, "referenced_day_token", "invented-day"); },
      x => { Reflect.set(x.profiles[0]!.method_settings.find(s => s.method_setting_id === x.sampled_quantity_observations[0]!.method_setting_reference)!, "method_value_json", "{}"); },
      x => { Reflect.set(x.profiles[1]!.method_settings.find(s => s.method_setting_id === x.monthly_app_use_cells[0]!.method_setting_reference)!, "method_value_json", '"installed-app list"'); },
    ];
    for (const used of [true, false, "0", "1", -1, 2, 0.5, {}, []]) mutations.push(x => { Reflect.set(x.monthly_app_use_cells[0]!, "used_in_month", used); });
    for (const mutate of mutations) { const wrong = input(); mutate(wrong); expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(); }
  });

  itWithPrivateCorpus("preserves the same supplied records in generated JSON Schema and Pydantic projections", () => {
    const raw = input();
    const scalar = scalarInput();
    const direct = directScreenTimeObservationExample();
    const allRows = { ...raw, sampled_quantity_observations: [...raw.sampled_quantity_observations, ...scalar.sampled_quantity_observations, ...lonelinessStepObservationExample(), ...direct.sampled_quantity_observations, ...mommInput().sampled_quantity_observations, ...apnomsSnapshotExample(), ...apnomsSummaryExample(apnomsInput().profiles[0]!), ...energyDrainObservationExample()],
      participant_day_observations: [...participantHourObservationExample(), ...screenomicsHourObservationExample(), ...notificationParticipantDayExample().participant_day_observations, ...moodableAvailabilityExample(), ...direct.participant_day_observations] };
    allRows.sampled_quantity_observations.push(...mommSuppliedInput().sampled_quantity_observations);
    allRows.sampled_quantity_observations.push(...nextAppInput().sampled_quantity_observations);
    allRows.sampled_quantity_observations.push(...predictorInput().sampled_quantity_observations);
    allRows.sampled_quantity_observations.push(...autosenInput().sampled_quantity_observations);
    const energySummaries = energySummaryInput();
    allRows.sampled_quantity_observations.push(...energySummaries.sampled_quantity_observations);
    allRows.participant_day_observations.push(...energySummaries.participant_day_observations);
    const appSummary = energySummaries.sampled_quantity_observations.find(row => row.observed_entity_kind === "application")!;
    allRows.sampled_quantity_observations.push({ ...appSummary, observed_entity_kind: "application", sampled_observation_id: "constructed:projection-null-participant", participant_id: null });
    const memberships = ["doi:10.1007/s42486-020-00045-z", "doi:10.4000/questionsdecommunication.9851", "doi:10.1145/2638728.2641700"].map(appMembershipInput);
    allRows.sampled_quantity_observations.push(...memberships.flatMap(value => value.sampled_quantity_observations));
    allRows.participant_day_observations.push(...memberships.flatMap(value => value.participant_day_observations));
    const wearable = wearableMoodInput();
    allRows.sampled_quantity_observations.push(...wearable.sampled_quantity_observations);
    const projectedRows = { ...allRows, app_feature_sessions: memberships.flatMap(value => value.app_feature_sessions),
      task_occurrences: [...memberships.flatMap(value => value.task_occurrences), ...wearable.task_occurrences] };
    const schemaPath = resolve(import.meta.dirname, "../../schema/generated/json-schema/chronicle-research-ontology.schema.json");
    const pydanticPath = resolve(import.meta.dirname, "../../schema/generated/pydantic");
    const result = execFileSync("uvx", ["--from", "linkml==1.10.0", "--with", "jsonschema", "python", "-c", [
      "import json,sys", "from jsonschema import Draft202012Validator", "sys.path.insert(0,sys.argv[2])",
      "import chronicle_research_ontology as model", "schema=json.load(open(sys.argv[1]))", "rows=json.load(sys.stdin)",
      "for name,records in [('SampledQuantityObservationRecord',rows['sampled_quantity_observations']),('MonthlyAppUseCellRecord',rows['monthly_app_use_cells']),('ParticipantDayObservationRecord',rows['participant_day_observations']),('AppFeatureSessionRecord',rows['app_feature_sessions']),('TaskOccurrenceRecord',rows['task_occurrences'])]:",
      " validator=Draft202012Validator({'$ref':'#/$defs/'+name,'$defs':schema['$defs']})",
      " for row in records:", "  validator.validate(row)", "  assert getattr(model,name)(**row).model_dump(exclude_unset=True)==row",
      "  assert not validator.is_valid(dict(row,invented_field=True))",
      "  for member in row.get('entity_members') or []:",
      "   assert not validator.is_valid(dict(row,entity_members=[dict(member,invented_field=True)]))",
      "   assert not validator.is_valid(dict(row,entity_members=[dict(member,member_entity_kind='wifi')]))",
      "  for link in row.get('sampled_observation_references') or []:",
      "   assert not validator.is_valid(dict(row,sampled_observation_references=[dict(link,invented_field=True)]))",
      "   assert not validator.is_valid(dict(row,sampled_observation_references=[dict(link,relationship_label='')]))",
      "  if name=='ParticipantDayObservationRecord':",
      "   periods=['referenced_day_token','referenced_hour_token','referenced_night_token','referenced_run_token']",
      "   token=next(field for field in periods if field in row)",
      "   assert not validator.is_valid({k:v for k,v in row.items() if k!=token})",
      "   for other in [field for field in periods if field!=token]:",
      "    for value in [None, '', 'other-period']:",
      "     assert not validator.is_valid(dict(row,**{other:value}))",
      "   for value in [None, '', ' ', 1]:",
      "    assert not validator.is_valid(dict(row,**{token:value}))",
      "print('projections-preserve-records')",
    ].join("\n"), schemaPath, pydanticPath], { input: JSON.stringify(projectedRows), encoding: "utf8", timeout: 180_000 });
    expect(result.trim()).toBe("projections-preserve-records");
  });
});

function boredomInput() {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/2750858.2804252")!);
  const records = taskInstrumentExamples(profile);
  records.sampled_quantity_observations = records.sampled_quantity_observations!.filter(row => !String(profile.method_settings.find(s => s.method_setting_id === row.method_setting_reference)?.method_parameter_key).startsWith("borapp.schema."));
  return { profiles: [profile], ...records };
}
itWithPrivateCorpus("preserves all 36 independently supplied Boredom predictors per ESM and pilot ratios without a window constructor", async () => {
  const source = boredomInput();
  const expectedNames = [
  "time_last_notif_access",
  "battery_level",
  "time_last_outgoing_call",
  "age",
  "bytes_received",
  "time_last_SMS_received",
  "screen_orient_changes",
  "light",
  "time_last_SMS_read",
  "hour_of_day",
  "num_apps",
  "semantic_location",
  "time_last_unlock",
  "time_last_notif",
  "most_used_app_category",
  "comm_notifs_in_tw",
  "ringer_mode",
  "day_of_week",
  "proximity",
  "prev_app_in_focus",
  "most_used_app",
  "last_notif",
  "bytes_transmitted",
  "num_unlock",
  "app_category_in_focus",
  "time_in_comm_apps",
  "apps_per_min",
  "time_last_SMS_sent",
  "audio",
  "charging",
  "gender",
  "num_notifs",
  "battery_drain",
  "time_last_incoming_call",
  "app_in_focus",
  "last_notif_category"
];
  const rows = source.sampled_quantity_observations!;
  expect(rows).toHaveLength(76);
  for (const taskId of ["example:boredom-esm-A", "example:boredom-esm-B"]) {
    const features = rows.filter(r => r.task_occurrence_reference === taskId);
    expect(features).toHaveLength(36);
    expect(features.map(r => r.quantities![0]!.observed_property)).toEqual(expectedNames);
    for (const row of features) {
      expect(row.source_work_id).toBe("doi:10.1145/2750858.2804252");
      expect(row).not.toHaveProperty("observation_instant");
      expect(row).not.toHaveProperty("denotes_interval");
    }
  }
  const persist = async (value: typeof source) => {
    const { profiles, ...records } = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], ...records }));
    const { profile, ...stored } = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile } & typeof records;
    const restored = parseStudyMethodProfileLibrary({ profiles: [profile], ...stored });
    expect(restored.sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
    expect(restored.task_occurrences).toEqual(value.task_occurrences);
    expect(restored.notification_histories).toEqual(value.notification_histories);
    return restored;
  };
  const parsed = await persist(source);
  const repeated = parsed.sampled_quantity_observations!.filter(r => r.quantities![0]!.observed_property === "bytes_received");
  expect(repeated).toHaveLength(2);
  expect(repeated[0]!.quantities).toEqual(repeated[1]!.quantities);
  expect(repeated[0]!.sampled_observation_id).not.toBe(repeated[1]!.sampled_observation_id);
  expect(repeated.map(r => r.task_occurrence_reference)).toEqual(["example:boredom-esm-A", "example:boredom-esm-B"]);
  for (const token of [undefined, null, "null", "0.00", ' "NA" ', " -2.5000 "]) {
    const changed = structuredClone(source);
    const quantity = changed.sampled_quantity_observations![0]!.quantities![0]!;
    if (token === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = token;
    await persist(changed);
  }
  for (const token of [undefined, null]) {
    const changed = structuredClone(source);
    if (token === undefined) delete changed.sampled_quantity_observations![0]!.task_occurrence_reference;
    else changed.sampled_quantity_observations![0]!.task_occurrence_reference = token;
    await persist(changed);
  }
  for (const membership of [undefined, null, []]) {
    const changed = structuredClone(source);
    if (membership === undefined) delete changed.sampled_quantity_observations![0]!.quantities;
    else changed.sampled_quantity_observations![0]!.quantities = membership;
    await persist(changed);
  }
  const moved = structuredClone(source);
  moved.sampled_quantity_observations!.reverse(); moved.task_occurrences.reverse();
  await persist(moved);
  await persist(source); const retained = await loadResearchMethodSelection();
  const mutations: Array<(v: typeof source) => void> = [
    v => { v.sampled_quantity_observations![0]!.task_occurrence_reference = "missing"; },
    v => { v.sampled_quantity_observations![0]!.task_occurrence_reference = " "; },
    v => { v.sampled_quantity_observations![0]!.participant_id = "foreign-participant"; },
    v => { v.sampled_quantity_observations![0]!.device_id = "known-device-without-task"; },
    v => { v.task_occurrences = []; },
    v => { v.sampled_quantity_observations![0]!.quantities![0]!.evidence_unit = "seconds"; },
    v => { v.sampled_quantity_observations![0]!.quantities![0]!.quantity_qualifier = ""; },
    v => { v.sampled_quantity_observations![0]!.quantities!.push(structuredClone(v.sampled_quantity_observations![0]!.quantities![0]!)); },
    v => { v.sampled_quantity_observations!.push(structuredClone(v.sampled_quantity_observations![0]!)); },
    v => { v.sampled_quantity_observations![0]!.quantities![0]!.evidence_value_json = "true"; },
    v => { v.sampled_quantity_observations![0]!.quantities![0]!.evidence_value_json = "{}"; },
    v => { v.sampled_quantity_observations![0]!.quantities![0]!.evidence_value_json = "NaN"; },
    v => { v.sampled_quantity_observations![72]!.quantities![0]!.quantity_qualifier = "randomized bored"; },
  ];
  for (const mutate of mutations) {
    const wrong = structuredClone(source); mutate(wrong);
    await expect(persist(wrong)).rejects.toThrow();
    expect(await loadResearchMethodSelection()).toBe(retained);
  }
  const knownDevice = structuredClone(source);
  knownDevice.task_occurrences.forEach(task => { task.device_id = "same supplied device"; });
  knownDevice.sampled_quantity_observations!.slice(0, 72).forEach(row => { row.device_id = "same supplied device"; });
  await persist(knownDevice);
  const foreignProfile = structuredClone(source);
  const other = structuredClone(foreignProfile.profiles[0]!); other.method_profile_id += ":other";
  foreignProfile.profiles.push(other);
  foreignProfile.task_occurrences = foreignProfile.task_occurrences.map(t => ({ ...t, method_profile_id: other.method_profile_id }));
  expect(() => parseStudyMethodProfileLibrary(foreignProfile)).toThrow("matching task within profile/source/participant/device");
});
itWithPrivateCorpus.each(["borapp.feature.time_last_notif_access","borapp.feature.battery_level","borapp.feature.time_last_outgoing_call","borapp.feature.age","borapp.feature.bytes_received","borapp.feature.time_last_SMS_received","borapp.feature.screen_orient_changes","borapp.feature.light","borapp.feature.time_last_SMS_read","borapp.feature.hour_of_day","borapp.feature.num_apps","borapp.feature.semantic_location","borapp.feature.time_last_unlock","borapp.feature.time_last_notif","borapp.feature.most_used_app_category","borapp.feature.comm_notifs_in_tw","borapp.feature.ringer_mode","borapp.feature.day_of_week","borapp.feature.proximity","borapp.feature.prev_app_in_focus","borapp.feature.most_used_app","borapp.feature.last_notif","borapp.feature.bytes_transmitted","borapp.feature.num_unlock","borapp.feature.app_category_in_focus","borapp.feature.time_in_comm_apps","borapp.feature.apps_per_min","borapp.feature.time_last_SMS_sent","borapp.feature.audio","borapp.feature.charging","borapp.feature.gender","borapp.feature.num_notifs","borapp.feature.battery_drain","borapp.feature.time_last_incoming_call","borapp.feature.app_in_focus","borapp.feature.last_notif_category"])("keeps Boredom predictor %s bound to its actual local source definition", key => {
  const source = boredomInput(), id = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!.method_setting_id;
  source.sampled_quantity_observations = source.sampled_quantity_observations!.filter(row => row.method_setting_reference === id);
  delete source.notification_histories;
  expect(source.sampled_quantity_observations).toHaveLength(2);
  expect(parseStudyMethodProfileLibrary(source).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  const setting = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_setting_id === id)!;
  const content = JSON.parse(String(setting(source).method_value_json)) as Record<string, unknown>;
  const bare = structuredClone(source); setting(bare).method_value_json = JSON.stringify(content.definition);
  expect(parseStudyMethodProfileLibrary(bare).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  for (const invalid of [null, "scalar decoy", {}, { ...content, definition: null }, { ...content, definition: "wrong body" },
    { ...content, source_facing_role: null }, { ...content, source_facing_target: "outcome" }]) {
    const wrong = structuredClone(source); setting(wrong).method_value_json = JSON.stringify(invalid);
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  for (const [field, value] of [["source_work_id", "doi:foreign"], ["method_setting_role", "analysis"], ["method_target_layer", "outcome"]]) {
    const wrong = structuredClone(source); Reflect.set(setting(wrong), field!, value);
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
  }
  const other = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/1879141.1879176")!);
  other.method_settings.push({ ...structuredClone(setting(source)), source_work_id: other.source_work_id });
  other.method_setting_count = other.method_settings.length; other.method_setting_ids = other.method_settings.map(s => s.method_setting_id);
  expect(() => parseStudyMethodProfileLibrary({ profiles: [other], sampled_quantity_observations: source.sampled_quantity_observations!.map(row => ({
    ...row, method_profile_id: other.method_profile_id, source_work_id: other.source_work_id, task_occurrence_reference: null,
  })) })).toThrow("sampled-quantity definition");
});
itWithPrivateCorpus.each(["borapp2.outcome.click_ratio", "borapp2.outcome.engagement_ratio"])("keeps Boredom pilot %s separate from history membership and condition assignment", key => {
  const source = boredomInput(), setting = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  source.sampled_quantity_observations = source.sampled_quantity_observations!.filter(row => row.method_setting_reference === setting.method_setting_id);
  delete source.notification_histories; source.task_occurrences = [];
  expect(parseStudyMethodProfileLibrary(source).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  for (const condition of [undefined, null]) {
    const changed = structuredClone(source), q = changed.sampled_quantity_observations![0]!.quantities![0]!;
    if (condition === undefined) delete q.quantity_qualifier; else q.quantity_qualifier = condition;
    expect(parseStudyMethodProfileLibrary(changed).sampled_quantity_observations).toEqual(changed.sampled_quantity_observations);
  }
  for (const value of ["-1", "101", "true", "{}", "[]"]) {
    const wrong = structuredClone(source); wrong.sampled_quantity_observations![0]!.quantities![0]!.evidence_value_json = value;
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
  }
  const missing = structuredClone(source);
  missing.profiles[0]!.method_settings.find(s => s.method_parameter_key === "borapp2.validation.repeated_measures_design")!.method_value_json = "null";
  expect(() => parseStudyMethodProfileLibrary(missing)).toThrow("sampled-quantity definition");
});

itWithPrivateCorpus.each([["hour_of_day", 23], ["day_of_week", 6]] as const)("checks only disclosed numeric integer bounds for Boredom %s, preserving lexical unknowns", (property, maximum) => {
  const source = boredomInput();
  const reference = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === `borapp.feature.${property}`)!.method_setting_id;
  source.sampled_quantity_observations = source.sampled_quantity_observations!.filter(row => row.method_setting_reference === reference);
  delete source.notification_histories;
  for (const value of ["-1", String(maximum + 1), "0.5", "1e309", "{}", "[]", "true"]) {
    const invalid = structuredClone(source); invalid.sampled_quantity_observations![0]!.quantities![0]!.evidence_value_json = value;
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
  for (const value of [undefined, null, "null", "0", String(maximum), '"24"', '"unknown"', " 2.0000 "]) {
    const valid = structuredClone(source), quantity = valid.sampled_quantity_observations![0]!.quantities![0]!;
    if (value === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = value;
    expect(parseStudyMethodProfileLibrary(valid).sampled_quantity_observations).toEqual(valid.sampled_quantity_observations);
  }
});

function appMembershipInput(workId: string) {
  const profile = canonical().profiles.find(p => p.source_work_id === workId);
  if (!profile) throw new Error(`Required frozen app-membership profile absent: ${workId}`);
  const cloned = structuredClone(profile);
  return { ...appMembershipObservationExample(cloned), ...(
    workId === "doi:10.4000/questionsdecommunication.9851" ? taskInstrumentExamples(cloned) : { task_occurrences: [] }
  ) };
}

itWithPrivateCorpus.each(["doi:10.1007/s42486-020-00045-z", "doi:10.4000/questionsdecommunication.9851"])(
  "preserves source-bound app memberships and independent source-owned channels for %s", async workId => {
    const source = appMembershipInput(workId);
    const roundtrip = async (value: typeof source) => {
      const { profiles, ...records } = parseStudyMethodProfileLibrary(value);
      await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], ...records }));
      const { profile, ...saved } = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile } & Omit<typeof source, "profiles">;
      const reparsed = parseStudyMethodProfileLibrary({ profiles: [profile], ...saved });
      expect(reparsed.profiles).toEqual(value.profiles);
      for (const [key, rows] of Object.entries(value)) if (key !== "profiles") expect(Reflect.get(reparsed, key)).toEqual(rows);
    };
    await roundtrip(source);
    const rows = source.sampled_quantity_observations, first = rows[0]!;
    expect(first.entity_members!.map(m => m.entity_member_id)).toEqual(["app-a", "app-b"]);
    expect(first.entity_members).toEqual(rows[1]!.entity_members);
    expect(first.sampled_observation_id).not.toBe(rows[1]!.sampled_observation_id);
    expect(rows[2]!.entity_members).toEqual([]); expect(rows[3]!.entity_members).toBeNull();
    expect(rows[4]).not.toHaveProperty("entity_members");
    expect(rows[5]!.entity_members![0]!.observed_entity_token).toBeNull();
    expect(rows[5]!.entity_members![1]).not.toHaveProperty("observed_entity_token");
    if (workId === "doi:10.4000/questionsdecommunication.9851") {
      expect(first.entity_members!.map(m => m.quantities![0]!.evidence_value_json)).toEqual(['"native/operator/manufacturer/Android"', '"user-installed"']);
      expect(rows.every(row => !Object.hasOwn(row, "observation_instant") && !Object.hasOwn(row, "referenced_day_token"))).toBe(true);
      expect(source.participant_day_observations.map(row => [row.observed_property, row.day_observation_value_json])).toEqual([
        ["screen activations per day", "12.00"], ["smartphone duration per day", "15.50"],
        ["application frequency per day", "2.00"], ["application duration per day", "0.00"],
      ]);
      expect(source.app_feature_sessions.map(row => row.denotes_interval)).toEqual([{ duration_seconds: 17.50 }, { start_instant: null, end_instant: null }]);
      expect(source.app_feature_sessions.every(row => row.feature_occurrences.length === 0)).toBe(true);
      expect(source.task_occurrences).toHaveLength(3);
      expect(source.task_occurrences[0]!.task_questionnaire_responses!.map(r => r.observed_property)).toEqual(
        ["sociodemographics", "equipment", "media practices", "cultural practices", "study field", "gender", "age"]);
      expect(source.task_occurrences.every(row => !Object.hasOwn(row, "referenced_day_token"))).toBe(true);
      const observed = (id: string) => rows.find(row => row.sampled_observation_id === id)!;
      expect(observed("constructed:screen-activation").source_event_time_token).toBe("constructed:screen-event-time");
      expect(observed("constructed:foreground-app").observed_entity_kind).toBe("application");
      for (const id of ["constructed:battery", "constructed:network", "constructed:screen-activation", "constructed:foreground-app", "constructed:sms-received", "constructed:sms-sent"]) {
        expect(observed(id)).not.toHaveProperty("observation_instant");
      }
      expect(observed("constructed:battery")).not.toHaveProperty("source_event_time_token");
      expect(observed("constructed:network")).not.toHaveProperty("source_event_time_token");
      expect(observed("constructed:sms-received").quantities![0]!.evidence_value_json).toBe('"received"');
      expect(observed("constructed:sms-sent").quantities![0]!.evidence_value_json).toBe('"sent"');
      expect(source.task_occurrences[2]!.participant_id).not.toBe(source.task_occurrences[0]!.participant_id);
      expect(source.task_occurrences[2]!.task_questionnaire_responses!.map(r => r.observed_property)).toEqual(["use logic", "representations", "routines", "context"]);
      const inventory = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === "aggregation.app_inventory")!;
      expect(inventory.method_target_layer).toBe("derived_feature");
      expect(JSON.parse(String(inventory.method_value_json))).toEqual({ student_mean_installed_apps: 84, native_share_five_cases_percent: 54, distinguish: ["native/operator/manufacturer/Android", "user-installed"] });
    } else {
      expect(rows[0]!.observation_instant).toBe(rows[1]!.observation_instant);
      expect(first.entity_members!.every(m => !Object.hasOwn(m, "quantities"))).toBe(true);
      expect(rows[6]!.entity_members!.map(m => m.quantities![0]!.evidence_value_json)).toEqual(["1.00", "0.00", "null"]);
      expect(rows[6]!.observation_instant).not.toBe(first.observation_instant);
      expect(rows[6]!.quantities!.map(q => q.evidence_value_json)).toEqual([" [1.00,0,0,0] ", "[0,1,0]"]);
      expect(rows[6]).not.toHaveProperty("task_occurrence_reference");
    }
    const changed = structuredClone(source);
    changed.sampled_quantity_observations[0]!.entity_members!.reverse();
    await roundtrip(changed);
    expect(changed.sampled_quantity_observations.slice(1)).toEqual(source.sampled_quantity_observations.slice(1));
    for (const quantities of [undefined, null, []]) {
      const variant = structuredClone(source), member = variant.sampled_quantity_observations[0]!.entity_members![0]!;
      if (quantities === undefined) delete member.quantities; else member.quantities = quantities;
      await roundtrip(variant);
    }
    if (workId === "doi:10.4000/questionsdecommunication.9851") for (const token of [undefined, null, "null", ' "user-installed" ']) {
      const variant = structuredClone(source), quantity = variant.sampled_quantity_observations[0]!.entity_members![0]!.quantities![0]!;
      if (token === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = token;
      await roundtrip(variant);
    }
    else for (const token of [undefined, null, "null", "0.00", "1e0"]) {
      const variant = structuredClone(source), quantity = variant.sampled_quantity_observations[6]!.entity_members![0]!.quantities![0]!;
      if (token === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = token;
      await roundtrip(variant);
    }
    if (workId === "doi:10.1007/s42486-020-00045-z") for (const [time, location] of [
      ["[0,0,0,0]", "[0,0]"], ["[1,1,0,0]", "[1,1]"], ["[1,null,0,0]", "[null,1]"], ["null", "null"],
    ]) {
      const variant = structuredClone(source), quantities = variant.sampled_quantity_observations[6]!.quantities!;
      quantities[0]!.evidence_value_json = time!; quantities[1]!.evidence_value_json = location!;
      await roundtrip(variant);
      // Preserve independently supplied binary tokens; primary discloses 0–1 vectors, not an exactly-one encoding rule.
    }
    const equal = structuredClone(source);
    equal.sampled_quantity_observations.push({ ...structuredClone(first), sampled_observation_id: "constructed:equal-content-distinct-owner-record" });
    await roundtrip(equal);
    expect(parseStudyMethodProfileLibrary(equal).sampled_quantity_observations).toHaveLength(rows.length + 1);
  }, 30_000);

itWithPrivateCorpus.each([
  ["doi:10.1007/s42486-020-00045-z", "dataset.fields", ["dataset.fields", "dataset.snapshot_kind", "preprocess.simultaneous_apps"]],
  ["doi:10.1007/s42486-020-00045-z", "preprocess.app_vector", ["dataset.fields", "dataset.snapshot_kind", "preprocess.simultaneous_apps", "preprocess.app_vocabulary", "preprocess.app_vector", "preprocess.context_append", "preprocess.location_discretization", "time.day_bins", "time.bin_encoding"]],
  ["doi:10.4000/questionsdecommunication.9851", "probe.static_device", ["probe.static_device", "aggregation.app_inventory"]],
  ["doi:10.1145/2638728.2641700", "collector.key_family", ["collector.key_family", "collector.rank_orientation", "collector.component_value", "collector.record_clock", "collector.snapshot_capacity"]],
  ...["probe.battery", "probe.network", "probe.screen_activation", "probe.foreground_app", "probe.sms"].map(key => ["doi:10.4000/questionsdecommunication.9851", key, [key]] as const),
] as const)("checks every local %s/%s source definition and companion before admitting application members", (workId, key, companions) => {
  const source = appMembershipInput(workId), owner = source.profiles[0]!;
  const reference = owner.method_settings.find(s => s.method_parameter_key === key)!.method_setting_id;
  source.sampled_quantity_observations = source.sampled_quantity_observations.filter(row => row.method_setting_reference === reference).slice(0, 1);
  expect(parseStudyMethodProfileLibrary(source).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  const foreign = structuredClone(source), foreignWork = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.source_work_id = foreignWork;
  foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = foreignWork; });
  foreign.sampled_quantity_observations.forEach(row => { row.source_work_id = foreignWork; });
  foreign.task_occurrences = []; foreign.participant_day_observations = []; foreign.app_feature_sessions = [];
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow("matching sampled-quantity definition");
  for (const companion of companions) {
    const setting = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === companion)!;
    const current = setting(source), body: unknown = JSON.parse(String(current.method_value_json));
    const wrapper = { definition: body, source_facing_role: companion === "collector.rank_orientation" ? "preprocessing" : current.method_setting_role, source_facing_target: companion === "time.day_bins" ? "timestamp_context_feature" : current.method_target_layer };
    const valid = structuredClone(source); setting(valid).method_value_json = JSON.stringify(wrapper);
    expect(parseStudyMethodProfileLibrary(valid).sampled_quantity_observations).toEqual(valid.sampled_quantity_observations);
    for (const bad of [null, [], {}, "foreign snapshot", { ...wrapper, definition: null }, { ...wrapper, definition: "outer body must not substitute" },
      { ...wrapper, source_facing_role: null }, { ...wrapper, source_facing_target: null }, { ...wrapper, source_facing_role: "acquisition" },
      { ...wrapper, source_facing_target: "participant_day" }, { definition: body, source_facing_target: current.method_target_layer },
      { definition: body, source_facing_role: current.method_setting_role },
      ...(companion === "collector.rank_orientation" ? [{ ...wrapper, source_facing_role: "event_schema" }] : [])]) {
      const invalid = structuredClone(source); setting(invalid).method_value_json = JSON.stringify(bad);
      expect(() => parseStudyMethodProfileLibrary(invalid), `${companion}: ${JSON.stringify(bad)}`).toThrow();
    }
    for (const field of ["method_setting_role", "method_target_layer", "source_work_id"] as const) {
      const invalid = structuredClone(source); Reflect.set(setting(invalid), field, "foreign");
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
    }
    const duplicate = structuredClone(source), duplicateSetting = { ...structuredClone(setting(duplicate)), method_setting_id: `constructed:duplicate-${companion}` };
    duplicate.profiles[0]!.method_settings.push(duplicateSetting);
    const declaredIds = duplicate.profiles[0]!.method_setting_ids;
    if (Array.isArray(declaredIds)) declaredIds.push(duplicateSetting.method_setting_id);
    Reflect.set(duplicate.profiles[0]!, "method_setting_count", duplicate.profiles[0]!.method_settings.length);
    expect(() => parseStudyMethodProfileLibrary(duplicate)).toThrow();
  }
});

itWithPrivateCorpus.each(["doi:10.1007/s42486-020-00045-z", "doi:10.4000/questionsdecommunication.9851"])(
  "rejects app-membership cross-kind/owner/quantity claims for %s without replacing saved records", async workId => {
    const source = appMembershipInput(workId);
    const persist = async (value: typeof source) => {
      const { profiles, ...records } = parseStudyMethodProfileLibrary(value);
      await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], ...records }));
    };
    await persist(source); const retained = await loadResearchMethodSelection();
    const first = (v: typeof source) => v.sampled_quantity_observations[0]!;
    const mutations: Array<(v: typeof source) => void> = [
      v => { first(v).entity_members!.push(structuredClone(first(v).entity_members![0]!)); },
      v => { first(v).entity_members![0]!.member_entity_kind = "access_point"; },
      v => { first(v).entity_members![0]!.source_locators = []; },
      v => { Reflect.set(first(v).entity_members![0]!, "rank", 1); },
      v => { Reflect.set(first(v).entity_members![0]!, "app_package_name", "invented.name.lookup"); },
      v => { Reflect.set(first(v), "root_entity_member_reference", null); },
      v => { Reflect.set(first(v), "referenced_day_token", "invented-day"); },
      v => { first(v).observed_entity_kind = "participant"; },
      v => { first(v).device_id = null; },
      v => { first(v).source_work_id = "foreign"; },
      v => { first(v).method_setting_reference = "foreign"; },
      v => { v.sampled_quantity_observations.push(structuredClone(first(v))); },
      v => { first(v).quantities = [{ observed_property: "installed apps", evidence_value_json: "84" }]; },
      v => { first(v).entity_members![0]!.quantities = [{ observed_property: "RSSI", evidence_value_json: "-42.00" }]; },
    ];
    if (workId === "doi:10.4000/questionsdecommunication.9851") {
      for (const value of ["0", "false", '"native"', '"running"', "[]", "{}"]) mutations.push(v => {
        first(v).entity_members![0]!.quantities![0]!.evidence_value_json = value;
      });
      mutations.push(v => { first(v).entity_members![0]!.quantities![0]!.evidence_unit = "percent"; });
      mutations.push(v => { first(v).entity_members![0]!.quantities!.push(structuredClone(first(v).entity_members![0]!.quantities![0]!)); });
      mutations.push(v => { first(v).entity_members![0]!.quantities![0]!.quantity_qualifier = "inferred from name"; });
    } else {
      mutations.push(v => { first(v).entity_members![0]!.quantities = [{ observed_property: "installation origin", evidence_value_json: '"user-installed"' }]; });
      for (const value of ["-1", "2", "0.5", "true", '"1"', "[]", "{}"]) mutations.push(v => {
        v.sampled_quantity_observations[6]!.entity_members![0]!.quantities![0]!.evidence_value_json = value;
      });
      mutations.push(v => { v.sampled_quantity_observations[6]!.entity_members![0]!.quantities![0]!.evidence_unit = "percent"; });
      for (const [property, values] of [
        ["time-bin vector", ["[]", "[1,0]", "[1,0,0,2]", "0", "true", '"opaque scalar"']],
        ["location vector", ["[]", "[1,2]", '["0",1]', "{}", "false"]],
      ] as const) for (const value of values) mutations.push(v => {
        v.sampled_quantity_observations[6]!.quantities!.find(q => q.observed_property === property)!.evidence_value_json = value;
      });
    }
    for (const mutate of mutations) {
      const invalid = structuredClone(source); mutate(invalid);
      await expect(persist(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained);
    }
  }, 30_000);

itWithPrivateCorpus("preserves supplied Ouakrat event time separately from collection time and rejects unsupported event fields", async () => {
  const source = appMembershipInput("doi:10.4000/questionsdecommunication.9851");
  const observed = (value: typeof source, id: string) => value.sampled_quantity_observations.find(row => row.sampled_observation_id === id)!;
  for (const token of [undefined, null, "constructed:opaque-event-token"]) {
    const variant = structuredClone(source), event = observed(variant, "constructed:screen-activation");
    if (token === undefined) delete event.source_event_time_token; else event.source_event_time_token = token;
    const { profiles, ...records } = parseStudyMethodProfileLibrary(variant);
    await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], ...records }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { sampled_quantity_observations: typeof variant.sampled_quantity_observations };
    expect(saved.sampled_quantity_observations).toEqual(variant.sampled_quantity_observations);
    expect(saved.sampled_quantity_observations.find((row: import("./methodProfiles").SampledQuantityObservationRecord) => row.sampled_observation_id === event.sampled_observation_id)).not.toHaveProperty("observation_instant");
  }
  for (const token of [undefined, null, "null", "0.00"]) {
    const variant = structuredClone(source), battery = observed(variant, "constructed:battery").quantities![0]!;
    if (token === undefined) delete battery.evidence_value_json; else battery.evidence_value_json = token;
    expect(parseStudyMethodProfileLibrary(variant).sampled_quantity_observations).toEqual(variant.sampled_quantity_observations);
  }
  const mutations: Array<(v: typeof source) => void> = [
    v => { Reflect.set(observed(v, "constructed:screen-activation"), "source_event_time_token", 0); },
    v => { Reflect.set(observed(v, "constructed:sms-received"), "source_event_time_token", []); },
    v => { observed(v, "constructed:screen-activation").entity_members = null; },
    v => { observed(v, "constructed:foreground-app").observed_entity_kind = "device"; },
    v => { observed(v, "constructed:screen-activation").quantities = [{ observed_property: "screen state", evidence_value_json: '"on"' }]; },
    v => { observed(v, "constructed:battery").quantities![0]!.evidence_unit = "percent"; },
    v => { observed(v, "constructed:network").quantities![0]!.observed_property = "call count"; },
    ...['"read"', "true", "0", "{}", "[]"].map(token => (v: typeof source) => { observed(v, "constructed:sms-received").quantities![0]!.evidence_value_json = token; }),
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(source); mutate(invalid);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
});

itWithPrivateCorpus("preserves ranked recent-task source cells, per-member boot times, package/activity distinction and supplied order through IndexedDB", async () => {
  const source = appMembershipInput("doi:10.1145/2638728.2641700");
  const roundtrip = async (value: typeof source) => {
    const { profiles, ...records } = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], ...records }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile } & Record<string, unknown>;
    const { profile, ...channels } = saved;
    expect(parseStudyMethodProfileLibrary({ profiles: [profile], ...channels }).sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
  };
  await roundtrip(source);
  const rows = source.sampled_quantity_observations, members = rows[0]!.entity_members!;
  const cell = (m: typeof members[number], property: string) => m.quantities!.find(q => q.observed_property === property)!;
  expect(members.map(m => m.observed_entity_token)).toEqual(["com.android.contacts", "com.android.contacts"]);
  expect(members.map(m => cell(m, "source key").evidence_value_json)).toEqual(['"app|recent|5"', '"app|recent|6"']);
  expect(members.map(m => cell(m, "source rank").evidence_value_json)).toEqual(["5", "6"]);
  expect(members.map(m => cell(m, "boot-elapsed logging time").evidence_value_json)).toEqual(['"89393313"', '"89393314"']);
  expect(members.map(m => cell(m, "component string").evidence_value_json)).toEqual([
    '"com.android.contacts/.activities.PeopleActivity"', '"com.android.contacts/.activities.DialtactsActivity"']);
  expect(members.map(m => cell(m, "source value").evidence_value_json)).toEqual(['"1"', '"1"']);
  expect(members.map(m => cell(m, "source row token").evidence_value_json)).toEqual(['"317"', '"318"']);
  expect(rows[0]!.entity_members).toEqual(rows[1]!.entity_members);
  expect(rows[0]!.sampled_observation_id).not.toBe(rows[1]!.sampled_observation_id);
  expect(members[0]!.entity_member_id).not.toBe(members[1]!.entity_member_id);
  expect(rows[2]!.entity_members).toEqual([]); expect(rows[3]!.entity_members).toBeNull();
  expect(rows[4]).not.toHaveProperty("entity_members");
  expect(rows.every(row => !Object.hasOwn(row, "observation_instant") && !Object.hasOwn(row, "source_event_time_token") && !Object.hasOwn(row, "task_occurrence_reference"))).toBe(true);
  const changed = structuredClone(source); changed.sampled_quantity_observations[0]!.entity_members!.reverse();
  await roundtrip(changed);
  expect(changed.sampled_quantity_observations.slice(1)).toEqual(source.sampled_quantity_observations.slice(1));
  for (const token of [undefined, null, "null", '"0"', ' "89393313" ']) {
    const variant = structuredClone(source), clock = cell(variant.sampled_quantity_observations[0]!.entity_members![0]!, "boot-elapsed logging time");
    if (token === undefined) delete clock.evidence_value_json; else clock.evidence_value_json = token;
    await roundtrip(variant);
  }
  for (const quantities of [undefined, null, []]) {
    const variant = structuredClone(source), member = variant.sampled_quantity_observations[0]!.entity_members![0]!;
    if (quantities === undefined) delete member.quantities; else member.quantities = quantities;
    await roundtrip(variant);
  }
  const partial = structuredClone(source);
  cell(partial.sampled_quantity_observations[0]!.entity_members![0]!, "source rank").evidence_value_json = "null";
  await roundtrip(partial);
  expect(cell(parseStudyMethodProfileLibrary(partial).sampled_quantity_observations![0]!.entity_members![0]!, "source rank").evidence_value_json).toBe("null");
});

itWithPrivateCorpus("rejects only explicit ranked recent-task shape/ownership contradictions without changing the saved selection", async () => {
  const source = appMembershipInput("doi:10.1145/2638728.2641700");
  const persist = async (value: typeof source) => {
    const { profiles, ...records } = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], ...records }));
  };
  await persist(source); const retained = await loadResearchMethodSelection();
  const first = (v: typeof source) => v.sampled_quantity_observations[0]!;
  const member = (v: typeof source, index = 0) => first(v).entity_members![index]!;
  const cell = (v: typeof source, property: string, index = 0) => member(v, index).quantities!.find(q => q.observed_property === property)!;
  const mutations: Array<(v: typeof source) => void> = [
    v => { first(v).device_id = null; },
    v => { first(v).participant_id = null; },
    v => { first(v).source_work_id = "foreign"; },
    v => { member(v).member_entity_kind = "cell"; },
    v => { first(v).observed_entity_kind = "application"; },
    v => { Reflect.set(first(v), "launch_instant", "invented-instant"); },
    v => { Reflect.set(first(v), "referenced_day_token", "invented-day"); },
    v => { Reflect.set(first(v), "root_entity_member_reference", null); },
    v => { member(v).quantities!.push(structuredClone(cell(v, "source value"))); },
    v => { member(v).quantities = [{ observed_property: "app used", evidence_value_json: "1" }]; },
    v => { member(v).quantities = [{ observed_property: "installation origin", evidence_value_json: '"user-installed"' }]; },
    v => { cell(v, "boot-elapsed logging time").evidence_unit = "milliseconds"; },
    v => { cell(v, "source rank").evidence_value_json = "6"; },
    v => { cell(v, "source rank", 1).evidence_value_json = "5"; cell(v, "source key", 1).evidence_value_json = '"app|recent|5"'; },
    v => { cell(v, "source rank", 1).evidence_value_json = "null"; cell(v, "source key", 1).evidence_value_json = '"app|recent|5"'; },
    v => { first(v).entity_members = Array.from({ length: 11 }, (_, i) => ({ entity_member_id: "constructed:too-many-" + i, member_entity_kind: "application" as const, source_locators: ["constructed:source-capacity-counterexample"] })); },
    ...["-1", "10", "0.5", '"0"', "true", "[]", "{}"].map(token => (v: typeof source) => { cell(v, "source rank").evidence_value_json = token; }),
    ...['"app|recent|10"', '"app|task|5"', "5", "false"].map(token => (v: typeof source) => { cell(v, "source key").evidence_value_json = token; }),
    ...["0", "false", "{}", "[]"].map(token => (v: typeof source) => { cell(v, "component string").evidence_value_json = token; }),
    ...["1", "true", "{}", "[]"].map(token => (v: typeof source) => { cell(v, "source value").evidence_value_json = token; }),
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(source); mutate(invalid);
    await expect(persist(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained);
  }
});

function hammerInput() {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/2634317.2634325")!);
  const observations = hammerObservationExample(profile);
  return { ...observations, device_use_sessions: hammerDeviceSessionExample(profile).device_use_sessions };
}
const hammerAudit = lazyPrivateCorpusJson<{
  disclosed_atoms: Array<{ key: string; role: string; target: string; value: unknown }>;
}>("ontology-sublation-20260831/source-completeness-audits/doi-10.1145-2634317.2634325.json");
async function persistHammer(input: ReturnType<typeof hammerInput>) {
  const { profiles, ...records } = parseStudyMethodProfileLibrary(input);
  await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], ...records }));
  const { profile, ...stored } = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile } & typeof records;
  const restored = parseStudyMethodProfileLibrary({ profiles: [profile], ...stored });
  for (const channel of ["sampled_quantity_observations", "notification_histories", "device_use_sessions"] as const) expect(restored[channel]).toEqual(input[channel]);
  return restored;
}
itWithPrivateCorpus("preserves Hammer raw inputs, independent30s frames, screen sessions and notification evidence without reconstructing labels or joins", async () => {
  const input = hammerInput(), setting = input.profiles[0]!.method_settings.find(s => s.method_parameter_key === "feature.app_category")!;
  expect(JSON.parse(String(setting.method_value_json))).toBe("application categories, including adopted application histogram and top-k dominant app categories; k, histogram measure and category mapping not reported");
  expect(input.profiles[0]!.method_settings).toHaveLength(66);
  const frames = input.sampled_quantity_observations.filter(row => row.sampled_observation_id.startsWith("constructed:hammer-frame"));
  expect(frames).toHaveLength(3);
  expect(frames[0]!.quantities).toEqual(frames[1]!.quantities);
  expect(frames[0]!.sampled_observation_id).not.toBe(frames[1]!.sampled_observation_id);
  expect(frames.every(row => !["denotes_interval", "task_occurrence_reference", "source_event_time_token", "observation_instant"].some(field => Object.hasOwn(row, field)))).toBe(true);
  expect(frames[0]!.quantities!.filter(q => q.observed_property === "forward-filled human label").map(q => q.quantity_qualifier)).toEqual(["isBusy", "isAlone", "isHappy", "isStressful"]);
  expect(frames[0]!.quantities!.find(q => q.observed_property === "logical location")!.evidence_value_json).toBe('"null"');
  expect(frames[2]!.quantities!.find(q => q.observed_property === "logical location")!.evidence_value_json).toBe("null");
  expect(input.device_use_sessions.map(row => row.denotes_interval!.duration_seconds)).toEqual([20, 17.5, 15, 0]);
  expect(input.device_use_sessions[2]!.session_labels).toBeNull(); expect(input.device_use_sessions[3]!.session_labels).toEqual([]);
  await persistHammer(input);
  const changed = structuredClone(input);
  const human = changed.sampled_quantity_observations[7]!.quantities!.find(q => q.observed_property === "human confidence")!;
  human.evidence_value_json = "0.1000";
  await persistHammer(changed);
  expect(changed.sampled_quantity_observations[8]).toEqual(input.sampled_quantity_observations[8]);
  expect(changed.device_use_sessions).toEqual(input.device_use_sessions);
  const reversed = structuredClone(input); reversed.sampled_quantity_observations.reverse();
  reversed.sampled_quantity_observations.forEach(row => { row.quantities?.reverse(); row.entity_members?.reverse(); });
  reversed.device_use_sessions.reverse(); await persistHammer(reversed);
  for (const token of [undefined, null, "null", ' "opaque raw label" ', "false"]) {
    const variant = structuredClone(input), q = variant.sampled_quantity_observations[7]!.quantities![0]!;
    if (token === undefined) delete q.evidence_value_json; else q.evidence_value_json = token;
    await persistHammer(variant);
  }
  for (const values of [undefined, null, []] as const) {
    const variant = structuredClone(input), frame = variant.sampled_quantity_observations[7]!;
    if (values === undefined) { delete frame.quantities; delete frame.entity_members; }
    else { frame.quantities = values === null ? null : []; frame.entity_members = values === null ? null : []; }
    await persistHammer(variant);
  }
});
itWithPrivateCorpus.each([
  "collector.foreground_app", "collector.screen_state_events", "collector.network_events", "collector.labels",
  "segmentation.frame_width", "aggregation.unique_count", "aggregation.categorical_mode", "aggregation.numeric",
  "feature.app_category", "feature.time_of_day", "feature.day_of_week", "feature.logical_location_inputs", "feature.logical_location",
  "label.forward_fill", "label.human_confidence", "label.human_confidence_prior", "label.secondary_source", "outcomes",
  "session.boundary", "session.null", "session.app", "session.duration", "session.unique_app_count", "session.inter_session_time", "feature.trigger_app", "feature.trigger_type",
])("requires the actual Hammer source definition %s without wrapper or same-role fallback", key => {
  const input = hammerInput(), atom = hammerAudit().disclosed_atoms.find(a => a.key === key)!;
  expect(parseStudyMethodProfileLibrary(input).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  // Isolate synthetic definition mutations from the separately tested exact policy-member copy.
  Reflect.deleteProperty(input.profiles[0]!, "session_construction_policies");
  const local = (v: typeof input) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  const value: unknown = JSON.parse(String(local(input).method_value_json));
  const body = value && typeof value === "object" && "definition" in value ? value.definition : value;
  const wrapper = { definition: body, source_facing_role: atom.role, source_facing_target: atom.target };
  for (const content of [body, wrapper]) {
    const valid = structuredClone(input); local(valid).method_value_json = JSON.stringify(content);
    expect(parseStudyMethodProfileLibrary(valid).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  }
  for (const content of [
    { ...wrapper, definition: null }, { ...wrapper, definition: "foreign inner value" }, { ...wrapper, definition: { unrelated: true } },
    { ...wrapper, source_facing_role: "provenance" }, { ...wrapper, source_facing_target: "participant_day" },
    { definition: body, source_facing_target: atom.target }, { definition: body, source_facing_role: atom.role },
    ...(atom.role !== local(input).method_setting_role || atom.target !== local(input).method_target_layer
      ? [{ ...wrapper, source_facing_role: local(input).method_setting_role, source_facing_target: local(input).method_target_layer }] : []),
  ]) {
    const invalid = structuredClone(input); local(invalid).method_value_json = JSON.stringify(content);
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
  for (const field of ["method_setting_role", "method_target_layer", "source_work_id"]) {
    const invalid = structuredClone(input);
    Reflect.set(local(invalid), field, field === "method_setting_role" ? "provenance" : field === "method_target_layer" ? "study_window" : "doi:foreign");
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
});
itWithPrivateCorpus("rejects Hammer source/subject, label/confidence and ownership contradictions before saved-state replacement", async () => {
  const input = hammerInput();
  const frame = (v: typeof input) => v.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:hammer-frame-a")!;
  const q = (v: typeof input, property: string) => frame(v).quantities!.find(row => row.observed_property === property)!;
  for (const [property, token, error] of [
    ["top-k dominant app categories", "[1]", /supplied category vector or JSON null/],
    ["logical location", '"school"', /disclosed logical-location state/],
    ["time of day", "true", /supplied scalar or JSON null/],
    ["unique application count", "1.5", /nonnegative integer/],
    ["time of day", "1e400", /finite numeric value/],
  ] as const) { const bad = structuredClone(input); q(bad, property).evidence_value_json = token; expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(error); }
  for (const [error, mutate] of [
    [/entity_members must be an array or null/, (v: typeof input) => Reflect.set(frame(v), "entity_members", {})],
    [/entity_members\[0\] must be an object/, (v: typeof input) => Reflect.set(frame(v), "entity_members", [null])],
    [/observed_entity_token must be a string or null/, (v: typeof input) => Reflect.set(frame(v).entity_members![0]!, "observed_entity_token", 7)],
    [/device_id must be nonblank or null/, (v: typeof input) => Reflect.set(frame(v), "device_id", 7)],
    [/notification_evidence\[0\]\.evidence_role is unknown/, (v: typeof input) => Reflect.set(v.notification_histories[0]!.notification_evidence[0]!, "evidence_role", "invented certainty")],
    [/session types do not imply questionnaire-answer support/, (v: typeof input) => { v.device_use_sessions[0]!.session_labels![0]!.questionnaire_response_references = ["invented answer"]; }],
  ] as const) { const bad = structuredClone(input); mutate(bad); expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(error); }
  await persistHammer(input); const retained = await loadResearchMethodSelection();
  for (const mutate of [
    (v: typeof input) => { v.sampled_quantity_observations.push(structuredClone(frame(v))); },
    (v: typeof input) => { frame(v).observed_entity_kind = "device"; },
    (v: typeof input) => { frame(v).source_work_id = "doi:foreign"; },
    (v: typeof input) => { frame(v).quantities!.push(structuredClone(q(v, "human confidence"))); },
    (v: typeof input) => { q(v, "human confidence").evidence_unit = "percent"; },
    (v: typeof input) => { q(v, "human confidence").quantity_qualifier = "not-a-declared-status"; },
    (v: typeof input) => { q(v, "forward-filled human label").quantity_qualifier = "unknown-status"; q(v, "forward-filled human label").evidence_value_json = null; },
    (v: typeof input) => { Reflect.set(frame(v), "denotes_interval", { duration_seconds: 30 }); },
    (v: typeof input) => { frame(v).task_occurrence_reference = null; },
    (v: typeof input) => { frame(v).source_event_time_token = "invented frame start"; },
    (v: typeof input) => { frame(v).entity_members![0]!.member_entity_kind = "cell"; },
    (v: typeof input) => { frame(v).entity_members!.push(structuredClone(frame(v).entity_members![0]!)); },
    (v: typeof input) => { v.sampled_quantity_observations[2]!.quantities![0]!.evidence_value_json = '"ON_LOCKED"'; },
    (v: typeof input) => { v.device_use_sessions[0]!.start_condition = "unlock"; },
    (v: typeof input) => { v.device_use_sessions[0]!.denotes_interval!.duration_seconds = 15; },
    (v: typeof input) => { v.device_use_sessions[0]!.session_labels![0]!.label_value_json = '"app session"'; },
    (v: typeof input) => { v.device_use_sessions[1]!.session_quantities![2]!.quantity_scope = "app"; },
    (v: typeof input) => { v.notification_histories[0]!.notification_evidence.at(-1)!.evidence_references = ["foreign-item"]; },
    ...["-0.01", "1.01", "90", "true", "{}", "[]", "1e400"].map(token => (v: typeof input) => { q(v, "human confidence").evidence_value_json = token; }),
    ...["0", "1", "[]", "{}"].map(token => (v: typeof input) => { q(v, "forward-filled human label").evidence_value_json = token; }),
  ]) {
    const invalid = structuredClone(input); mutate(invalid);
    await expect(persistHammer(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained);
  }
  const foreign = structuredClone(input);
  foreign.profiles[0]!.source_work_id = "doi:foreign";
  foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = "doi:foreign"; });
  for (const records of [foreign.sampled_quantity_observations, foreign.device_use_sessions, foreign.notification_histories]) records.forEach(row => { row.source_work_id = "doi:foreign"; });
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow();
  const cleared = { ...input, sampled_quantity_observations: [], notification_histories: [], device_use_sessions: [] };
  await persistHammer(cleared); expect((await loadResearchMethodSelection())!).not.toContain("constructed:hammer-frame-a");
});

function predictorInput() {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1007/s00530-018-0601-1")!);
  return { profiles: [profile], sampled_quantity_observations: predictorObservationExample(profile) };
}
const predictorRootKeys = ["event.type.AppOpenEvent","event.type.ChargeCableEvent","event.type.DataConnectedEvent","event.type.LocationChangedEvent","session.session_feature_definition","session.target_event","collector.periodicity_trigger","collector.installed_app_list","collector.app_power_consumption","cold.app_weight","cold.weighted_user_similarity","similarity.training_instances","warm.basic_cluster_state","warm.incremental_cluster_state","cev.icknn_cluster_state","warm.covered_set","warm.uncovered_set","cev.predict_single_cover","cold.apriori","cold.user_top_k","cold.periodicity_output.probability","fusion.user_set","fusion.item_set","fusion.intersection_set","fusion.ranked_output","collector.app_network_consumption"] as const;
itWithPrivateCorpus("rejects Predictor undeclared day categories and malformed explicit reference members", () => {
  const source = predictorInput(), row = (v: typeof source, id: string) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === "constructed:predictor-" + id)!;
  const category = structuredClone(source); row(category, "periodicity").quantities!.find(q => q.observed_property === "day type")!.evidence_value_json = '"vacation"';
  expect(() => parseStudyMethodProfileLibrary(category)).toThrow(/incompatible Predictor category/);
  const malformed = structuredClone(source); Reflect.set(row(malformed, "features-A"), "sampled_observation_references", [null]);
  expect(() => parseStudyMethodProfileLibrary(malformed)).toThrow(/sampled_observation_references\[0\] must be an object/);
});
itWithPrivateCorpus.each(predictorRootKeys)("admits exact Predictor %s with its original tuple before source/body/owner negatives", key => {
  const all = predictorInput(), local = (v: typeof all) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  const input = { ...all, sampled_quantity_observations: all.sampled_quantity_observations.filter(r => r.method_setting_reference === local(all).method_setting_id) };
  input.sampled_quantity_observations.forEach(r => { delete r.sampled_observation_references; });
  expect(input.sampled_quantity_observations.length).toBeGreaterThan(0);
  const body: unknown = JSON.parse(String(local(input).method_value_json));
  const wrapper = { definition: body, source_facing_role: local(input).method_setting_role, source_facing_target: local(input).method_target_layer };
  for (const value of [body, wrapper]) {
    const positive = structuredClone(input); local(positive).method_value_json = JSON.stringify(value);
    expect(parseStudyMethodProfileLibrary(positive).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  }
  for (const value of [null, {}, { conceptual_observation_roles: ["process/application identity", "bytes sent", "bytes received"] },
    { ...wrapper, definition: null }, { ...wrapper, definition: {} }, { ...wrapper, source_facing_role: "preprocessing" },
    { ...wrapper, source_facing_target: "raw_occurrence" }]) {
    const wrong = structuredClone(input); local(wrong).method_value_json = JSON.stringify(value);
    expect(() => parseStudyMethodProfileLibrary({ profiles: wrong.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  for (const [field, value] of [["source_work_id", "doi:foreign"], ["method_setting_role", "provenance"], ["method_target_layer", "raw_occurrence"]]) {
    const wrong = structuredClone(input); Reflect.set(local(wrong), field!, value);
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(/local definition role\/target|sampled-quantity definition/);
  }
  const foreign = structuredClone(input), work = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.source_work_id = work;
  foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = work; });
  foreign.sampled_quantity_observations.forEach(r => { r.source_work_id = work; });
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow(/sampled-quantity definition/);
});
itWithPrivateCorpus("requires Predictor payload, eight-feature, sensor and model-result companion definitions", () => {
  for (const [root, key] of [
    ["event.type.AppOpenEvent", "event.payload.app_package"], ["session.target_event", "session.feature_count"],
    ["session.target_event", "session.feature.last_light"], ["session.target_event", "experiment.event_window"],
    ["session.target_event", "experiment.event_effect_horizon"], ["collector.periodicity_trigger", "collector.periodicity_field.light"],
    ["cold.app_weight", "cold.market_download_input"], ["similarity.training_instances", "similarity.normalization"],
    ["cev.icknn_cluster_state", "cev.split_gate"], ["cold.apriori", "cold.dbscan_discretization"], ["fusion.ranked_output", "fusion.optimal_weights"],
  ]) {
    const input = predictorInput(), profile = input.profiles[0]!, rootId = profile.method_settings.find(s => s.method_parameter_key === root)!.method_setting_id;
    input.sampled_quantity_observations = input.sampled_quantity_observations.filter(r => r.method_setting_reference === rootId);
    input.sampled_quantity_observations.forEach(r => { delete r.sampled_observation_references; });
    expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
    profile.method_settings.find(s => s.method_parameter_key === key)!.method_value_json = "{}";
    expect(() => parseStudyMethodProfileLibrary({ profiles: input.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(input)).toThrow("sampled-quantity definition");
  }
});
itWithPrivateCorpus("persists all Predictor populated families with independent inputs, values, unknowns and supplied roles", async () => {
  const source = predictorInput();
  const row = (v: typeof source, id: string) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === "constructed:predictor-" + id)!;
  const persist = async (value: typeof source) => {
    const parsed = parseStudyMethodProfileLibrary(value);
    const selected = { profile: parsed.profiles[0], selectedLevels: {}, sampled_quantity_observations: parsed.sampled_quantity_observations };
    await saveResearchMethodSelection(JSON.stringify(selected));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as typeof selected;
    expect(saved).toEqual(selected);
    expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], sampled_quantity_observations: saved.sampled_quantity_observations }).sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
  };
  await persist(source);
  expect(source.profiles[0]!.method_settings).toHaveLength(208);
  expect(new Set(source.sampled_quantity_observations.map(r => source.profiles[0]!.method_settings.find(s => s.method_setting_id === r.method_setting_reference)!.method_parameter_key))).toEqual(new Set(predictorRootKeys));
  const roles = ["AppOpen anchor", "Latest prior opened app", "Latest prior audio cable", "Latest prior location", "Latest prior charge cable", "Latest prior Wi-Fi", "Latest prior mobile data", "Latest prior Bluetooth", "Latest prior light"];
  expect(row(source, "features-A").sampled_observation_references!.map(r => r.relationship_label)).toEqual(roles);
  expect(row(source, "features-A").quantities).toHaveLength(9);
  expect(JSON.parse(String(source.profiles[0]!.method_settings.find(s => s.method_parameter_key === "experiment.event_window")!.method_value_json))).toBe("four-hour sliding window");
  expect(JSON.parse(String(source.profiles[0]!.method_settings.find(s => s.method_parameter_key === "experiment.event_effect_horizon")!.method_value_json))).toBe("Assume an event affects future events during the next three to four hours.");
  expect(row(source, "consumption").quantities).toEqual([{ observed_property: "power consumption", evidence_value_json: "3.50" }]);
  expect(row(source, "network").quantities).toEqual([{ observed_property: "network consumption", evidence_value_json: '"250.00"' }]);
  expect(row(source, "consumption").observation_instant).not.toBe(row(source, "network").observation_instant);
  expect(row(source, "weight")).not.toHaveProperty("sampled_observation_references");
  expect(row(source, "open-A").source_event_time_token).toBe("supplied-open-time-A");
  expect(row(source, "open-A").observation_instant).toBe("independent-collection-time");
  expect(row(source, "prior-app").source_event_time_token).toBe(row(source, "prior-repeat").source_event_time_token);
  expect(row(source, "prior-app").sampled_observation_id).not.toBe(row(source, "prior-repeat").sampled_observation_id);
  expect(row(source, "periodicity").entity_members!.map(m => m.observed_entity_token)).toEqual(["com.android.dialer", "android.mms", "com.android.dialer"]);
  expect(row(source, "comparison").sampled_observation_references![1]!.sampled_observation_reference).toBe("constructed:predictor-inventory-cloud");
  expect(row(source, "inventory-cloud").participant_id).toBe("constructed:cloud-user");
  expect(row(source, "inventory-cloud").device_id).toBe("constructed:cloud-phone");
  expect(row(source, "distance").quantities!.map(q => q.evidence_value_json)).toEqual([...Array.from({ length: 8 }, () => ["0.25", "0.50"]).flat(), "1.25"]);
  expect(row(source, "cluster-2").quantities!.find(q => q.observed_property === "cluster credibility")!.evidence_value_json).toBe("0.90");
  const changed = structuredClone(source);
  row(changed, "features-A").sampled_observation_references![1]!.sampled_observation_reference = "constructed:predictor-prior-repeat";
  expect(row(changed, "features-A").sampled_observation_references!.slice(2)).toEqual(row(source, "features-A").sampled_observation_references!.slice(2));
  expect(row(changed, "features-A").quantities).toEqual(row(source, "features-A").quantities);
  row(changed, "weight").quantities!.at(-1)!.evidence_value_json = "0.60";
  expect(row(changed, "weight").quantities!.slice(0, -1)).toEqual(row(source, "weight").quantities!.slice(0, -1));
  row(changed, "rank-fused").entity_members![0]!.quantities![1]!.evidence_value_json = "0.20";
  expect(row(changed, "US")).toEqual(row(source, "US")); expect(row(changed, "IS")).toEqual(row(source, "IS")); expect(row(changed, "UIS")).toEqual(row(source, "UIS"));
  await persist(changed);
  for (const token of [undefined, null, "null", ' "unknown" ', "0.00", '"250.00"']) {
    const value = structuredClone(source), q = row(value, "network").quantities![0]!;
    if (token === undefined) delete q.evidence_value_json; else q.evidence_value_json = token;
    await persist(value);
  }
  for (const value of [undefined, null, []]) {
    const input = structuredClone(source), item = row(input, "features-A");
    if (value === undefined) delete item.sampled_observation_references; else item.sampled_observation_references = value;
    await persist(input);
  }
  for (const ref of [undefined, null]) {
    const input = structuredClone(source), item = row(input, "features-A").sampled_observation_references![8]!;
    if (ref === undefined) delete item.sampled_observation_reference; else item.sampled_observation_reference = ref;
    await persist(input);
  }
  for (const members of [undefined, null, []]) {
    const input = structuredClone(source), item = row(input, "inventory-new");
    if (members === undefined) delete item.entity_members; else item.entity_members = members;
    await persist(input);
  }
  const reversed = structuredClone(source);
  reversed.sampled_quantity_observations.reverse();
  row(reversed, "periodicity").entity_members!.reverse();
  await persist(reversed); // Supplied order survives; no inferred chronological or popularity sorting.
});
itWithPrivateCorpus("rejects Predictor wrong local roles/owners, app contradictions and unsupported clocks/units without replacing saved records", async () => {
  const source = predictorInput(), row = (v: typeof source, id: string) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === "constructed:predictor-" + id)!;
  const saved = JSON.stringify(parseStudyMethodProfileLibrary(source)); await saveResearchMethodSelection(saved);
  const mutations: Array<[(v: typeof source) => void, RegExp]> = [
    [v => { row(v, "features-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:predictor-charge"; }, /compatible, distinct/],
    [v => { row(v, "features-A").sampled_observation_references![8]!.sampled_observation_reference = "constructed:predictor-context-1"; }, /declared action family/],
    [v => { row(v, "features-A").sampled_observation_references![1]!.sampled_observation_reference = "constructed:predictor-open-A"; }, /latest prior event/],
    [v => { row(v, "features-A").quantities![0]!.evidence_value_json = '"wrong-known-app"'; }, /known AppOpen app/],
    [v => { row(v, "prior-app").device_id = "another-known-phone"; }, /compatible, distinct/],
    [v => { row(v, "comparison").sampled_observation_references![1]!.sampled_observation_reference = "constructed:predictor-inventory-new"; }, /another supplied user's/],
    [v => { row(v, "cluster-0").sampled_observation_references![0]!.sampled_observation_reference = "constructed:predictor-open-A"; }, /compatible, distinct/],
    [v => { row(v, "UIS").observed_entity_token = "known-different-app"; }, /known application identity/],
    [v => { row(v, "warm-prediction-2").sampled_observation_references!.push({ relationship_label: "covering cluster", sampled_observation_reference: "constructed:predictor-cluster-0", source_locators: ["constructed contradiction"] }); }, /coverage case/],
    [v => { row(v, "warm-prediction-0").sampled_observation_references![1]!.sampled_observation_reference = "constructed:predictor-cluster-2"; }, /sole supplied covering/],
    [v => { row(v, "features-A").sampled_observation_references!.push(structuredClone(row(v, "features-A").sampled_observation_references![1]!)); }, /duplicates a sampled-observation/],
    [v => { row(v, "features-A").sampled_observation_references![0]!.sampled_observation_reference = " "; }, /nonblank or null/],
    [v => { row(v, "features-A").sampled_observation_references![0]!.relationship_label = "latest eight arbitrary events"; }, /incompatible sampled-observation/],
    [v => { row(v, "consumption").quantities![0]!.evidence_unit = "mAh"; }, /source unit unspecified/],
    [v => { row(v, "features-A").quantities![1]!.quantity_qualifier = "three-hour sliding window"; }, /experimental window/],
    [v => { row(v, "consumption").observed_entity_kind = "process"; }, /must be application/],
    [v => { Reflect.set(row(v, "open-A"), "event_timestamp_epoch_ms", 1000); }, /unknown/],
    [v => { row(v, "distance").quantities![0]!.evidence_value_json = "1.01"; }, /invalid supplied Predictor/],
    [v => { row(v, "cluster-2").quantities!.find(q => q.observed_property === "CEV")!.evidence_value_json = "2"; }, /invalid supplied Predictor/],
    [v => { row(v, "launch-context").quantities![2]!.evidence_value_json = '{"invented_axis":1}'; }, /supplied scalar/],
    [v => { Reflect.set(row(v, "inventory-new").entity_members![0]!, "member_entity_kind", "cell"); }, /owning observation/],
    [v => { const copy = { ...row(v, "features-A"), device_id: "second-phone" }; delete copy.sampled_observation_references; v.sampled_quantity_observations.push(copy); delete row(v, "cluster-0").device_id; }, /unambiguously/],
  ];
  for (const [mutate, message] of mutations) {
    const wrong = structuredClone(source); mutate(wrong);
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(message);
    expect(await loadResearchMethodSelection()).toBe(saved);
  }
});

function trafficInput() {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/1879141.1879176")!);
  return { profiles: [profile], ...trafficObservationExample(profile) };
}
const trafficRootKeys = [
  "d1.raw_schema",
  "d1_transfer.key",
  "d1_transfer.idle_split",
  "d1_transfer.byte_scope",
  "d1_transfer.overhead_scope",
  "d1_transfer.overhead_time",
  "d2_transfer.inputs",
  "d2_transfer.contiguous",
  "d2_transfer.across_connections",
  "performance.rtt",
  "performance.retransmission",
  "performance.throughput",
  "performance.limit_method",
  "composition.wifi_ratio",
  "composition.direction_ratio",
  "composition.category_ontology",
  "power.interpacket",
  "power.replay"
] as const;
itWithPrivateCorpus.each(trafficRootKeys)("accepts actual Traffic %s source binding independently and rejects body/tuple/source spoofing", key => {
  const input = trafficInput();
  const local = (v: typeof input) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === local(input).method_setting_id);
  input.participant_day_observations = [];
  input.sampled_quantity_observations.forEach(row => { delete row.sampled_observation_references; });
  expect(input.sampled_quantity_observations.length).toBeGreaterThan(0);
  expect(() => parseStudyMethodProfileLibrary({ profiles: input.profiles })).not.toThrow();
  expect(parseStudyMethodProfileLibrary(input).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  const content: unknown = JSON.parse(String(local(input).method_value_json));
  const wrapped = content !== null && typeof content === "object" && Object.hasOwn(content, "definition");
  const body = wrapped ? (content as { definition: unknown }).definition : content;
  const bare = structuredClone(input); local(bare).method_value_json = JSON.stringify(body);
  expect(parseStudyMethodProfileLibrary(bare).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  const wrapper = { source_facing_role: local(input).method_setting_role, source_facing_target: local(input).method_target_layer, definition: body };
  const trueWrapper = structuredClone(input); local(trueWrapper).method_value_json = JSON.stringify(wrapper);
  expect(parseStudyMethodProfileLibrary(trueWrapper).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  for (const value of [null, {}, { conceptual_observation_roles: ["process/application identity", "bytes sent", "bytes received"] },
    { ...wrapper, definition: null }, { ...wrapper, definition: {} }, { ...wrapper, source_facing_role: "preprocessing" },
    { ...wrapper, source_facing_target: "acquired_snapshot" }]) {
    const wrong = structuredClone(input); local(wrong).method_value_json = JSON.stringify(value);
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  for (const [field, value] of [["method_setting_role", "reporting"], ["method_target_layer", "outcome"], ["source_work_id", "doi:foreign"]]) {
    const wrong = structuredClone(input); Reflect.set(local(wrong), field!, value);
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(/local definition role\/target|sampled-quantity definition/);
  }
  const foreign = structuredClone(input), id = "doi:10.1145/1814433.1814453";
  foreign.profiles[0]!.source_work_id = id;
  foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = id; });
  foreign.sampled_quantity_observations.forEach(row => { row.source_work_id = id; });
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow("sampled-quantity definition");
});
itWithPrivateCorpus("requires Traffic's exact collector, byte scope, independent eligibility and power-assumption companions", () => {
  for (const [root, key] of [
    ["d1.raw_schema", "d1.collector"], ["d1_transfer.idle_split", "d1_transfer.key"], ["d1_transfer.idle_split", "d1_transfer.byte_scope"],
    ["d2_transfer.contiguous", "d2_transfer.inputs"], ["d2_transfer.contiguous", "d2_transfer.across_connections"],
    ["performance.rtt", "performance.radio_awake"], ["performance.retransmission", "performance.retransmission_threshold"],
    ["performance.limit_method", "performance.limit_threshold"], ["power.replay", "power.state_model"],
    ["power.replay", "power.branches"], ["power.replay", "power.calibration_device"], ["power.replay", "power.platform_limit"],
  ]) {
    const input = trafficInput();
    const rootSetting = input.profiles[0]!.method_settings.find(s => s.method_parameter_key === root)!;
    input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === rootSetting.method_setting_id);
    input.sampled_quantity_observations.forEach(row => { delete row.sampled_observation_references; }); input.participant_day_observations = [];
    expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
    input.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!.method_value_json = "{}";
    expect(() => parseStudyMethodProfileLibrary({ profiles: input.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(input)).toThrow("sampled-quantity definition");
  }
});
async function persistTraffic(input: ReturnType<typeof trafficInput>) {
  const { profiles, ...records } = parseStudyMethodProfileLibrary(input);
  await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], selectedLevels: {}, ...records }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile } & typeof records;
  const { profile, sampled_quantity_observations, participant_day_observations } = saved;
  expect(parseStudyMethodProfileLibrary({ profiles: [profile], sampled_quantity_observations, participant_day_observations }))
    .toEqual({ profiles: [profile], ...records });
}
itWithPrivateCorpus("roundtrips all Traffic supplied packet/flow/transfer/metric/app/power families without executing their constructors", async () => {
  const input = trafficInput();
  // Retain the original accepted process-byte observations as independent controls;
  // none of the application intervals below invent a process-to-app mapping.
  const controls = parseStudyMethodProfileLibrary({ profiles: input.profiles, sampled_quantity_observations: temporalObservationExample().sampled_quantity_observations }).sampled_quantity_observations!;
  input.sampled_quantity_observations.push(...controls);
  const row = (id: string) => input.sampled_quantity_observations.find(r => r.sampled_observation_id === "constructed:traffic-" + id)!;
  const setting = (key: string) => input.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  const unwrapped = (key: string): unknown => {
    const content: unknown = JSON.parse(String(setting(key).method_value_json));
    return content !== null && typeof content === "object" && Object.hasOwn(content, "definition") ? (content as { definition: unknown }).definition : content;
  };
  expect(unwrapped("d1_transfer.idle_split")).toEqual({ idle_period_minutes: 1, action: "split into separate transfer", exact_idle_boundary_comparator: null });
  expect(unwrapped("performance.retransmission_threshold")).toBe("direction has more than 10 data packets");
  expect(unwrapped("performance.throughput")).toBe("TCP transfer throughput by direction for transfers with at least 10 data packets");
  expect(row("flow-A").sampled_observation_references!.map(r => r.sampled_observation_reference)).toEqual(["constructed:traffic-packet-1", "constructed:traffic-packet-2", "constructed:traffic-packet-3"]);
  expect(row("transfer-A").sampled_observation_references![0]!.sampled_observation_reference).toBe("constructed:traffic-flow-A");
  expect(row("transfer-B").sampled_observation_references![0]!.sampled_observation_reference).toBe("constructed:traffic-flow-A");
  expect(row("time-overhead").sampled_observation_references!.map(r => r.relationship_label)).toContain("first SYN");
  expect(row("rtt").sampled_observation_references!.map(r => r.relationship_label)).toContain("last SYN");
  expect(row("packet-1").source_event_time_token).toBe("supplied:packet-time-1");
  expect(row("packet-1").observation_instant).toBe("supplied:independent-capture-token");
  expect(row("app-transfer-A").observed_entity_kind).toBe("application");
  expect(row("interval-A").quantities!.map(q => q.evidence_value_json)).toEqual(["0", "5"]);
  expect(row("interval-B").quantities!.map(q => q.evidence_value_json)).toEqual(["7", "0"]);
  expect(row("windows-packet").device_id).toBe("constructed:windows-phone");
  expect(row("replay-2").quantities![0]!.quantity_qualifier).toBe("perfect-future oracle sleep decision");
  const represented = new Set(input.sampled_quantity_observations.map(r => input.profiles[0]!.method_settings.find(s => s.method_setting_id === r.method_setting_reference)!.method_parameter_key));
  for (const key of trafficRootKeys) expect(represented.has(key)).toBe(true);
  await persistTraffic(input);
  const result = parseStudyMethodProfileLibrary(input);
  expect(result.sampled_quantity_observations!.slice(-controls.length)).toEqual(controls);
  expect(result.participant_day_observations).toEqual(input.participant_day_observations);
});
itWithPrivateCorpus("preserves Traffic omitted/null/empty memberships and lexical quantities without inferring missing relationships", async () => {
  for (const shape of ["omitted", "null", "empty", "partial"] as const) {
    const input = trafficInput();
    for (const row of input.sampled_quantity_observations) {
      if (!Array.isArray(row.sampled_observation_references)) continue;
      if (shape === "omitted") delete row.sampled_observation_references;
      else if (shape === "null") row.sampled_observation_references = null;
      else if (shape === "empty") row.sampled_observation_references = [];
      else row.sampled_observation_references = row.sampled_observation_references.map(link => ({ ...link, sampled_observation_reference: null }));
    }
    await persistTraffic(input);
  }
  for (const value of [undefined, null, "null", "0", '"0.00"', '"NA"', " 17.5000 "]) {
    const input = trafficInput(), metric = input.sampled_quantity_observations.find(r => r.sampled_observation_id === "constructed:traffic-throughput")!;
    metric.quantities![0]!.evidence_value_json = value;
    if (value === undefined) delete metric.quantities![0]!.evidence_value_json;
    await persistTraffic(input);
  }
});
itWithPrivateCorpus("rejects Traffic explicit ownership, relationship, property, unit and collector contradictions before replacing selection", async () => {
  const input = trafficInput(), row = (v: typeof input, id: string) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === "constructed:traffic-" + id)!;
  await persistTraffic(input); const retained = await loadResearchMethodSelection();
  const mutations: Array<[string, (v: typeof input) => void]> = [
    ["application owner", v => { row(v, "app-transfer-A").observed_entity_token = "constructed:app-B"; }],
    ["supplied TCP flow", v => { row(v, "transfer-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:traffic-flow-B"; }],
    ["supplied TCP flow", v => { row(v, "flow-B").sampled_observation_references = [structuredClone(row(v, "flow-A").sampled_observation_references![0]!)]; }],
    ["supplied TCP flow", v => { row(v, "rtt").sampled_observation_references!.find(r => r.relationship_label === "last SYN")!.sampled_observation_reference = "constructed:traffic-foreign-flow-packet";
      const packet = structuredClone(row(v, "packet-1")); packet.sampled_observation_id = "constructed:traffic-foreign-flow-packet"; packet.sampled_observation_references![0]!.sampled_observation_reference = "constructed:traffic-flow-B"; v.sampled_quantity_observations.push(packet); }],
    ["both consecutive packets", v => { row(v, "delay").sampled_observation_references![1]!.sampled_observation_reference = "constructed:traffic-packet-1"; }],
    ["unambiguously", v => { row(v, "packet-1").participant_id = "constructed:foreign-user"; }],
    ["unambiguously", v => { row(v, "packet-1").device_id = "constructed:foreign-device"; }],
    ["unambiguously", v => { row(v, "transfer-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:traffic-packet-1"; }],
    ["unambiguously", v => { row(v, "packet-1").sampled_observation_references![0]!.sampled_observation_reference = "constructed:traffic-packet-1"; }],
    ["duplicates", v => { row(v, "transfer-A").sampled_observation_references!.push(structuredClone(row(v, "transfer-A").sampled_observation_references![1]!)); }],
    ["incompatible sampled-observation relationship", v => { row(v, "transfer-A").sampled_observation_references![1]!.relationship_label = "last packet by timestamp"; }],
    ["incompatible with this observation definition", v => { row(v, "wifi").sampled_observation_references = []; }],
    ["platform/collector pairing", v => { row(v, "packet-1").quantities!.find(q => q.observed_property === "capture collector")!.evidence_value_json = '"Netlog"'; }],
    ["observed_entity_kind must be application", v => { row(v, "interval-A").observed_entity_kind = "process"; }],
    ["source unit unspecified", v => { row(v, "wifi").quantities![0]!.evidence_unit = "percent"; }],
    ["evidence_unit must be bytes", v => { row(v, "packet-1").quantities!.find(q => q.observed_property === "packet byte count")!.evidence_unit = "bits"; }],
    ["disclosed categorical state", v => { row(v, "limit").quantities![0]!.evidence_value_json = '"invented-class"'; }],
    ["source-defined variant", v => { row(v, "rtt").quantities![0]!.quantity_qualifier = "manufactured radio-state filter"; }],
    ["unknown or duplicated", v => { row(v, "interval-A").quantities!.push(structuredClone(row(v, "interval-A").quantities![0]!)); }],
    ["scalar number, text or null", v => { row(v, "size").quantities![0]!.evidence_value_json = "{}"; }],
    ["source_event_time_token must be a string or null", v => { Reflect.set(row(v, "packet-1"), "source_event_time_token", 0); }],
  ];
  for (const [message, mutate] of mutations) {
    const invalid = structuredClone(input); mutate(invalid);
    await expect(persistTraffic(invalid)).rejects.toThrow(message);
    expect(await loadResearchMethodSelection()).toBe(retained);
  }
  const ambiguous = structuredClone(input);
  delete row(ambiguous, "transfer-A").device_id;
  const other = structuredClone(row(ambiguous, "flow-A")); other.device_id = "constructed:second-phone";
  other.sampled_observation_references = []; ambiguous.sampled_quantity_observations.push(other);
  expect(() => parseStudyMethodProfileLibrary(ambiguous)).toThrow("unambiguously");
  const foreign = structuredClone(input);
  const second = structuredClone(foreign.profiles[0]!); second.method_profile_id = "constructed:second-Traffic-profile";
  foreign.profiles.push(second); row(foreign, "packet-1").method_profile_id = second.method_profile_id;
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow("unambiguously");
});

function s3Input() {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.3390/s21113765")!);
  return { profiles: [profile], sampled_quantity_observations: s3ObservationExample(profile) };
}
const s3RootKeys = ["sensor.feature_count","statistics.feature_count","statistics.distinct_apps_minute","statistics.total_apps_minute","statistics.distinct_apps_day","statistics.total_apps_day","statistics.common_app_minute","statistics.common_app_minute_count","statistics.common_app_day","statistics.common_app_day_count","statistics.current_app","statistics.last_app","statistics.preceding_app","statistics.network_bytes_transmitted","statistics.network_bytes_received","speaker.embedding_size","exp1.sensor_feature_count","exp1.statistics_feature_count","exp1.speaker_features","exp1.ss.calendar_weekday","exp1.ss.seconds_in_day","dataset.info_schema","dataset.train_protocol_schema","dataset.test_protocol_schema","dataset.absent_sensor_users","vector_aggregation.same_window","vector_aggregation.fallback","exp2.join_window","exp2.sensta.schema","exp2.all.schema","experiment.score_direction","score_combination.state","score_combination.three","score_combination.two","score_combination.one","final.calibration_points"] as const;
const s3Row = (value: ReturnType<typeof s3Input>, suffix: string) => value.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:s3-" + suffix)!;
const s3Quantity = (value: ReturnType<typeof s3Input>, suffix: string, property: string) => s3Row(value, suffix).quantities!.find(q => q.observed_property === property)!;
itWithPrivateCorpus.each([
  ["training-A", "files", '["file-A.csv",1]', /must contain supplied file names, lexical text or null/],
  ["file-A", "type", '"st_st"', /not a disclosed S3 file-type composition/],
] as const)("rejects S3 supplied %s %s membership contradictions", (id, property, token, error) => {
  const invalid = s3Input(); s3Quantity(invalid, id, property).evidence_value_json = token;
  expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(error);
});
async function persistS3(value: ReturnType<typeof s3Input>) {
  const { profiles, ...records } = parseStudyMethodProfileLibrary(value);
  await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], selectedLevels: {}, ...records }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile; sampled_quantity_observations: typeof records.sampled_quantity_observations };
  expect(saved.profile).toEqual(value.profiles[0]);
  expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], sampled_quantity_observations: saved.sampled_quantity_observations }).sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
}
itWithPrivateCorpus.each(s3RootKeys)("accepts actual S3 %s independently and rejects source/body/tuple/inner-body fallback", key => {
  const input = s3Input(), local = (value: typeof input) => value.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === local(input).method_setting_id);
  input.sampled_quantity_observations.forEach(row => { delete row.sampled_observation_references; });
  expect(input.sampled_quantity_observations.length).toBeGreaterThan(0);
  expect(parseStudyMethodProfileLibrary(input).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  const content: unknown = JSON.parse(String(local(input).method_value_json));
  const definition = typeof content === "object" && content !== null && !Array.isArray(content) && Object.hasOwn(content, "definition")
    ? (content as Record<string, unknown>).definition : content;
  const bare = structuredClone(input); local(bare).method_value_json = JSON.stringify(definition);
  expect(parseStudyMethodProfileLibrary(bare).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  const wrapped = { definition, source_facing_role: local(input).method_setting_role, source_facing_target: local(input).method_target_layer };
  for (const body of [null, {}, "decoy", { ...wrapped, definition: null }, { ...wrapped, definition: 0 }, { ...wrapped, definition: "decoy" },
    { ...wrapped, source_facing_role: undefined }, { ...wrapped, source_facing_target: null }, { ...wrapped, source_facing_role: "provenance" },
    { ...wrapped, source_facing_target: "acquired_snapshot" }]) {
    const invalid = structuredClone(input); local(invalid).method_value_json = JSON.stringify(body);
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  for (const [field, value] of [["method_setting_role", "reporting"], ["method_target_layer", "outcome"], ["source_work_id", "doi:foreign"]]) {
    const invalid = structuredClone(input); Reflect.set(local(invalid), field!, value);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
  const duplicate = structuredClone(input); duplicate.profiles[0]!.method_settings.push({ ...local(duplicate), method_setting_id: "constructed:s3-duplicate-local" });
  duplicate.profiles[0]!.method_setting_count = duplicate.profiles[0]!.method_settings.length;
  duplicate.profiles[0]!.method_setting_ids = duplicate.profiles[0]!.method_settings.map(setting => setting.method_setting_id);
  expect(() => parseStudyMethodProfileLibrary({ profiles: duplicate.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(duplicate)).toThrow("sampled-quantity definition");
  const foreign = structuredClone(input); foreign.profiles[0]!.source_work_id = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.method_settings.forEach(setting => { setting.source_work_id = foreign.profiles[0]!.source_work_id; });
  foreign.sampled_quantity_observations.forEach(row => { row.source_work_id = foreign.profiles[0]!.source_work_id; });
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow("sampled-quantity definition");
});
itWithPrivateCorpus.each([["sensor.sources","sensor.feature_count"],["sensor.window","sensor.feature_count"],["sensor.average","sensor.feature_count"],["sensor.maximum","sensor.feature_count"],["sensor.minimum","sensor.feature_count"],["sensor.variance","sensor.feature_count"],["sensor.peak_to_peak","sensor.feature_count"],["sensor.magnitude","sensor.feature_count"],["dataset.record_schema","sensor.feature_count"],["dataset.calendar_features","sensor.feature_count"],["statistics.distinct_apps_minute","statistics.feature_count"],["statistics.total_apps_minute","statistics.feature_count"],["statistics.distinct_apps_day","statistics.feature_count"],["statistics.total_apps_day","statistics.feature_count"],["statistics.common_app_minute","statistics.feature_count"],["statistics.common_app_minute_count","statistics.feature_count"],["statistics.common_app_day","statistics.feature_count"],["statistics.common_app_day_count","statistics.feature_count"],["statistics.current_app","statistics.feature_count"],["statistics.last_app","statistics.feature_count"],["statistics.preceding_app","statistics.feature_count"],["statistics.network_bytes_transmitted","statistics.feature_count"],["statistics.network_bytes_received","statistics.feature_count"],["statistics.lookback","statistics.feature_count"],["speaker.embedding_layer","speaker.embedding_size"],["dataset.type_vocabulary","speaker.embedding_size"],["speaker.microphone_activation","speaker.embedding_size"],["exp1.ss.calendar_weekday","exp1.sensor_feature_count"],["exp1.ss.seconds_in_day","exp1.sensor_feature_count"],["exp1.statistics_app_encoding","exp1.statistics_feature_count"],["dataset.session_boundary","dataset.info_schema"],["framework.aggregation_control","vector_aggregation.same_window"],["exp2.allowed_aggregations","exp2.join_window"],["exp2.sensta.schema","exp2.join_window"],["exp2.all.schema","exp2.join_window"],["exp2.join_window","exp2.sensta.schema"],["experiment.score_direction","score_combination.state"]])("requires exact S3 companion %s for populated %s", (key, root) => {
  const input = s3Input(), setting = input.profiles[0]!.method_settings.find(s => s.method_parameter_key === root)!;
  input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === setting.method_setting_id);
  input.sampled_quantity_observations.forEach(row => { delete row.sampled_observation_references; });
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  input.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!.method_value_json = "{}";
  expect(() => parseStudyMethodProfileLibrary(input)).toThrow("sampled-quantity definition");
});
itWithPrivateCorpus("roundtrips complete S3 vector/file/protocol/missing-modality/score families independently without joins or calculations", async () => {
  const input = s3Input();
  expect(new Set(input.sampled_quantity_observations.map(row => input.profiles[0]!.method_settings.find(s => s.method_setting_id === row.method_setting_reference)!.method_parameter_key))).toEqual(new Set(s3RootKeys));
  await persistS3(input);
  expect(s3Quantity(input, "sensor-A", "sensor vector").evidence_value_json).toBe(s3Quantity(input, "sensor-equal-content", "sensor vector").evidence_value_json);
  expect(s3Row(input, "sensor-A").sampled_observation_id).not.toBe(s3Row(input, "sensor-equal-content").sampled_observation_id);
  expect(s3Quantity(input, "level-0", "authentication level").evidence_value_json).toBe("5.00");
  expect(s3Row(input, "file-A").sampled_observation_references).toHaveLength(1); // st retains statistics alone, not an invented sensor row.
  expect(s3Row(input, "target").participant_id).toBe(s3Row(input, "training-A").participant_id);
  expect(s3Row(input, "nontarget").participant_id).not.toBe(s3Row(input, "training-A").participant_id);
  const changed = structuredClone(input);
  s3Quantity(changed, "statistics-A", "bytes transmitted through network interfaces").evidence_value_json = "2048.0000";
  s3Quantity(changed, "level-0", "authentication level").evidence_value_json = "9.00";
  await persistS3(changed);
  expect(s3Quantity(changed, "statistics-A", "bytes received through network interfaces").evidence_value_json).toBe("0.00");
  const reversed = structuredClone(changed); reversed.sampled_quantity_observations.reverse();
  reversed.sampled_quantity_observations.forEach(row => { row.sampled_observation_references?.reverse(); row.quantities?.reverse(); });
  await persistS3(reversed); // Forward references and original supplied order are both retained.
  for (const variant of [undefined, null, "null", '"unreported lexical vector"']) {
    const value = structuredClone(input), quantity = s3Quantity(value, "sensor-A", "sensor vector");
    if (variant === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = variant;
    await persistS3(value);
  }
  for (const field of ["quantities", "sampled_observation_references"] as const) {
    for (const token of [undefined, null, []]) {
      const value = structuredClone(input);
      if (token === undefined) Reflect.deleteProperty(s3Row(value, "training-A"), field); else Reflect.set(s3Row(value, "training-A"), field, token);
      await persistS3(value);
    }
  }
  for (const token of [undefined, null, "opaque-supplied-generation-token"]) {
    const value = structuredClone(input);
    if (token === undefined) delete s3Row(value, "sensor-A").observation_instant; else s3Row(value, "sensor-A").observation_instant = token;
    await persistS3(value);
  }
  for (const token of [undefined, null]) {
    const value = structuredClone(input), quantity = s3Quantity(value, "statistics-A", "bytes transmitted through network interfaces");
    if (token === undefined) delete quantity.evidence_unit; else quantity.evidence_unit = token;
    await persistS3(value);
  }
  for (const suffix of ["level-1", "level-2", "experiment-aggregate"]) {
    const value = structuredClone(input);
    const reference = suffix === "experiment-aggregate" ? { relationship_label: "speaker vector", sampled_observation_reference: null, source_locators: ["Supplied unknown membership, no model/timing inference"] }
      : { ...s3Row(value, "score-state").sampled_observation_references![2]!, sampled_observation_reference: null };
    s3Row(value, suffix).sampled_observation_references!.push(reference);
    await persistS3(value);
  }
  expect(s3Quantity(input, "speaker-command", "microphone activation context").evidence_value_json).toBe('"voice command"');
  expect(s3Row(input, "speaker-command").quantities!.some(q => q.observed_property === "recording type")).toBe(false);
  const unknown = structuredClone(input); s3Quantity(unknown, "target", "label").evidence_value_json = "null";
  s3Row(unknown, "target").sampled_observation_references![1]!.sampled_observation_reference = null;
  await persistS3(unknown);
});
itWithPrivateCorpus("rejects S3 malformed coordinates, wrong quantities/owners/links and known identity contradictions before saved replacement", async () => {
  const input = s3Input(); await persistS3(input); const retained = await loadResearchMethodSelection();
  const invalids: Array<(value: typeof input) => void> = [
    value => { s3Row(value, "sensor-A").observed_entity_kind = "process"; },
    value => { s3Row(value, "target").participant_id = "constructed:foreign"; },
    value => { s3Row(value, "sensor-A").sampled_observation_id = s3Row(value, "sensor-equal-content").sampled_observation_id; },
    value => { s3Quantity(value, "file-A", "user").evidence_value_json = '"constructed:foreign"'; delete s3Row(value, "file-A").sampled_observation_references; },
    value => { s3Quantity(value, "file-A", "type").evidence_value_json = '"cr"'; },
    value => { s3Quantity(value, "file-all", "type").evidence_value_json = '"st_vn"'; },
    value => { s3Quantity(value, "training-A", "files").evidence_value_json = '["foreign.csv"]'; },
    value => { s3Quantity(value, "target", "file").evidence_value_json = '"foreign.csv"'; },
    value => { s3Quantity(value, "nontarget", "nameModel").evidence_value_json = '"foreign-model"'; },
    value => { s3Quantity(value, "target", "label").evidence_value_json = '"nontarget"'; },
    value => { s3Quantity(value, "nontarget", "label").evidence_value_json = '"target"'; },
    value => { s3Quantity(value, "missing-sensor", "retained").evidence_value_json = "false"; },
    value => { s3Quantity(value, "statistics-A", "bytes transmitted through network interfaces").evidence_unit = "bytes per second"; },
    value => { s3Quantity(value, "sensor-A", "sensor vector").evidence_unit = "m/s2"; },
    value => { s3Row(value, "sensor-A").quantities!.push(structuredClone(s3Quantity(value, "sensor-A", "sensor vector"))); },
    value => { s3Row(value, "generic-aggregate").sampled_observation_references!.push(structuredClone(s3Row(value, "generic-aggregate").sampled_observation_references![0]!)); },
    value => { s3Row(value, "training-A").sampled_observation_references!.push(structuredClone(s3Row(value, "training-A").sampled_observation_references![0]!)); },
    value => { s3Row(value, "training-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:s3-file-B"; },
    value => { s3Row(value, "file-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:s3-statistics-B"; },
    value => { s3Row(value, "file-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:s3-file-A"; },
    value => { s3Row(value, "file-A").sampled_observation_references![0]!.sampled_observation_reference = "unknown"; },
    value => { s3Row(value, "file-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:s3-training-A"; },
    value => { s3Row(value, "file-A").sampled_observation_references![0]!.relationship_label = "timing anchor"; },
    value => { s3Row(value, "sensor-A").sampled_observation_references = null; },
    value => { s3Row(value, "score-sensor").sampled_observation_references![0]!.sampled_observation_reference = "constructed:s3-statistics-A"; },
    value => { s3Row(value, "score-state").sampled_observation_references![0]!.sampled_observation_reference = "constructed:s3-score-statistics"; },
    value => { s3Row(value, "level-2").sampled_observation_references!.push({ ...s3Row(value, "score-state").sampled_observation_references![1]! }); },
    value => { s3Row(value, "level-1").sampled_observation_references!.push({ ...s3Row(value, "score-state").sampled_observation_references![2]! }); },
    value => { s3Row(value, "experiment-aggregate").sampled_observation_references!.push({ relationship_label: "speaker vector", sampled_observation_reference: "constructed:s3-speaker-A", source_locators: ["Constructed same-owner explicit speaker support, not a timing claim"] }); },
    value => { s3Quantity(value, "speaker-command", "microphone activation context").evidence_value_json = '"screen unlock"'; },
    value => { s3Row(value, "file-A").device_id = "constructed:foreign-phone"; },
    value => { const duplicate = structuredClone(s3Row(value, "statistics-A")); duplicate.device_id = null; value.sampled_quantity_observations.push(duplicate); },
    value => { Reflect.set(s3Row(value, "file-A").sampled_observation_references![0]!, "invented_field", true); },
    value => { s3Row(value, "file-A").sampled_observation_references![0]!.source_locators = []; },
    value => { Reflect.set(s3Row(value, "file-A"), "entity_members", null); },
  ];
  for (const [suffix, property, token] of [
    ["sensor-A", "sensor vector", "[]"], ["sensor-A", "sensor vector", "{}"], ["sensor-A", "sensor vector", "true"],
    ["speaker-A", "speaker embedding", "[1,null]"], ["sensor-A", "sensor vector", JSON.stringify(Array(40).fill({}))],
    ["weekday", "weekday", "0"], ["weekday", "weekday", "8"], ["weekday", "weekday", "1.5"],
    ["calibration", "empirical FPR", "10.5"], ["score-sensor", "authentication score", "100.01"],
    ["score-state", "scoresen", "1e400"], ["target", "label", '"positive"'],
  ]) invalids.push(value => { s3Quantity(value, suffix!, property!).evidence_value_json = token!; });
  for (const mutate of invalids) {
    const invalid = structuredClone(input); mutate(invalid);
    await expect(persistS3(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(retained);
  }
  const missingDevices = structuredClone(input); delete s3Row(missingDevices, "file-A").device_id; delete s3Row(missingDevices, "statistics-A").device_id;
  await persistS3(missingDevices); // Unknown device does not become an invented known-device mismatch.
  const cleared = parseStudyMethodProfileLibrary({ profiles: input.profiles, sampled_quantity_observations: [] });
  await saveResearchMethodSelection(JSON.stringify({ profile: cleared.profiles[0], selectedLevels: {}, sampled_quantity_observations: cleared.sampled_quantity_observations }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as { sampled_quantity_observations: unknown };
  expect(saved.sampled_quantity_observations).toEqual([]);
  expect(Object.hasOwn(parseStudyMethodProfileLibrary({ profiles: input.profiles }), "sampled_quantity_observations")).toBe(false);
});
itWithPrivateCorpus("preserves supplied S3 records through generated JSON Schema/Pydantic without claiming semantic execution", () => {
  const input = s3Input(), schemaPath = resolve(import.meta.dirname, "../../schema/generated/json-schema/chronicle-research-ontology.schema.json");
  const pydanticPath = resolve(import.meta.dirname, "../../schema/generated/pydantic");
  const script = [
    "import json,sys", "from jsonschema import Draft202012Validator", "sys.path.insert(0,sys.argv[2])",
    "import chronicle_research_ontology as model", "schema=json.load(open(sys.argv[1])); data=json.load(sys.stdin)",
    "validator=Draft202012Validator({'$ref':'#/$defs/SampledQuantityObservationRecord','$defs':schema['$defs']})",
    "for row in data['sampled_quantity_observations']:",
    " validator.validate(row)", " assert model.SampledQuantityObservationRecord(**row).model_dump(exclude_unset=True)==row",
    " assert not validator.is_valid(dict(row,invented_field=True))",
    " for link in row.get('sampled_observation_references') or []:",
    "  assert not validator.is_valid(dict(row,sampled_observation_references=[dict(link,invented_field=True)]))",
    "  assert not validator.is_valid(dict(row,sampled_observation_references=[dict(link,relationship_label='')]))",
    "print('S3-shapes-preserved')",
  ].join("\n");
  expect(execFileSync("uvx", ["--from", "linkml==1.10.0", "--with", "jsonschema", "python", "-c", script, schemaPath, pydanticPath], {
    input: JSON.stringify(input), encoding: "utf8", timeout: 180_000,
  }).trim()).toBe("S3-shapes-preserved");
});

function moodscopeInput() {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/2462456.2464449")!);
  return { profiles: [profile], sampled_quantity_observations: moodscopeObservationExample(profile) };
}
const moodscopeRootKeys = ["api.mood_state_schema", "api.current_and_past", "api.mood_correction"] as const;
const moodscopeRow = (input: ReturnType<typeof moodscopeInput>, suffix: string) =>
  input.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:moodscope-" + suffix)!;
const moodscopeQuantity = (input: ReturnType<typeof moodscopeInput>, suffix: string, property: string) =>
  moodscopeRow(input, suffix).quantities!.find(quantity => quantity.observed_property === property)!;
async function persistMoodScope(input: ReturnType<typeof moodscopeInput>) {
  const { profiles, ...records } = parseStudyMethodProfileLibrary(input);
  await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], selectedLevels: {}, ...records }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile; sampled_quantity_observations: typeof records.sampled_quantity_observations };
  expect(saved.profile).toEqual(input.profiles[0]);
  expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], sampled_quantity_observations: saved.sampled_quantity_observations }).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
}
itWithPrivateCorpus.each(moodscopeRootKeys)("accepts exact MoodScope %s API definition and rejects source/body/tuple/inner-body decoys", key => {
  const input = moodscopeInput(), local = (value: typeof input) => value.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === local(input).method_setting_id);
  input.sampled_quantity_observations.forEach(row => { delete row.sampled_observation_references; });
  expect(input.sampled_quantity_observations.length).toBeGreaterThan(0);
  expect(parseStudyMethodProfileLibrary(input).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  const wrapper = JSON.parse(String(local(input).method_value_json)) as Record<string, unknown>, definition = wrapper.definition;
  const bare = structuredClone(input); local(bare).method_value_json = JSON.stringify(definition);
  expect(parseStudyMethodProfileLibrary(bare).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  for (const body of [null, {}, "decoy", { ...wrapper, definition: null }, { ...wrapper, definition: 0 },
    { ...wrapper, definition: "decoy" }, { ...wrapper, source_facing_role: undefined }, { ...wrapper, source_facing_target: null },
    { ...wrapper, source_facing_role: "provenance" }, { ...wrapper, source_facing_target: "acquired_snapshot" },
    { ...(definition as Record<string, unknown>), source_facing_role: "provenance", source_facing_target: "acquired_snapshot" }]) {
    const invalid = structuredClone(input); local(invalid).method_value_json = JSON.stringify(body);
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  for (const [field, value] of [["method_setting_role", "reporting"], ["method_target_layer", "outcome"], ["source_work_id", "doi:foreign"]]) {
    const invalid = structuredClone(input); Reflect.set(local(invalid), field!, value);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
  const duplicate = structuredClone(input);
  duplicate.profiles[0]!.method_settings.push({ ...local(duplicate), method_setting_id: "constructed:moodscope-duplicate-definition" });
  duplicate.profiles[0]!.method_setting_count = duplicate.profiles[0]!.method_settings.length;
  duplicate.profiles[0]!.method_setting_ids = duplicate.profiles[0]!.method_settings.map(s => s.method_setting_id);
  expect(() => parseStudyMethodProfileLibrary({ profiles: duplicate.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(duplicate)).toThrow("sampled-quantity definition");
  const foreign = structuredClone(input); foreign.profiles[0]!.source_work_id = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = foreign.profiles[0]!.source_work_id; });
  foreign.sampled_quantity_observations.forEach(row => { row.source_work_id = foreign.profiles[0]!.source_work_id; });
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow("sampled-quantity definition");
});
itWithPrivateCorpus.each(["api.current_and_past", "api.mood_correction"])("requires exact two-float schema companion for MoodScope %s", key => {
  const input = moodscopeInput(), root = input.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === root.method_setting_id);
  input.sampled_quantity_observations.forEach(row => { delete row.sampled_observation_references; });
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  input.profiles[0]!.method_settings.find(s => s.method_parameter_key === "api.mood_state_schema")!.method_value_json = "{}";
  expect(() => parseStudyMethodProfileLibrary(input)).toThrow("sampled-quantity definition");
});
itWithPrivateCorpus("roundtrips MoodScope current/past two-float results and independent feedback without day ownership, scoring or cloud execution", async () => {
  const input = moodscopeInput(); await persistMoodScope(input);
  expect(input.profiles[0]!.method_settings).toHaveLength(39);
  expect(new Set(input.sampled_quantity_observations.map(row => input.profiles[0]!.method_settings.find(s => s.method_setting_id === row.method_setting_reference)!.method_parameter_key))).toEqual(new Set(moodscopeRootKeys));
  expect(moodscopeQuantity(input, "current-A", "pleasure").evidence_value_json).toBe(moodscopeQuantity(input, "past-A", "pleasure").evidence_value_json);
  expect(moodscopeQuantity(input, "current-A", "activeness").evidence_value_json).toBe("6.1250"); // API has no disclosed five-level range.
  expect(moodscopeQuantity(input, "argument-A", "activeness").evidence_value_json).toBe("-0.7500");
  expect(moodscopeRow(input, "feedback-A").sampled_observation_references![0]!.sampled_observation_reference).toBe("constructed:moodscope-argument-A");
  expect(moodscopeRow(input, "current-A").sampled_observation_id).not.toBe(moodscopeRow(input, "current-equal").sampled_observation_id);
  expect(moodscopeQuantity(input, "past-A", "past query time").evidence_value_json).toBe('"opaque-supplied-past-timestamp-A"');
  expect(moodscopeRow(input, "past-A").observation_instant).toBeUndefined();
  const changed = structuredClone(input); moodscopeQuantity(changed, "argument-A", "pleasure").evidence_value_json = "9.25000";
  await persistMoodScope(changed);
  expect(moodscopeQuantity(changed, "current-A", "pleasure").evidence_value_json).toBe("2.5000");
  expect(moodscopeQuantity(changed, "argument-A", "activeness").evidence_value_json).toBe("-0.7500");
  const reversed = structuredClone(changed); reversed.sampled_quantity_observations.reverse();
  reversed.sampled_quantity_observations.forEach(row => { row.quantities?.reverse(); row.sampled_observation_references?.reverse(); });
  await persistMoodScope(reversed);
  for (const token of [undefined, null, "null", "0.0000"]) {
    const value = structuredClone(input), quantity = moodscopeQuantity(value, "current-A", "pleasure");
    if (token === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = token;
    await persistMoodScope(value);
  }
  for (const field of ["quantities", "sampled_observation_references"] as const) for (const token of [undefined, null, []]) {
    const value = structuredClone(input);
    if (token === undefined) Reflect.deleteProperty(moodscopeRow(value, "feedback-A"), field); else Reflect.set(moodscopeRow(value, "feedback-A"), field, token);
    await persistMoodScope(value);
  }
  for (const token of [undefined, null]) {
    const value = structuredClone(input);
    if (token === undefined) delete moodscopeRow(value, "feedback-A").sampled_observation_references![0]!.sampled_observation_reference;
    else moodscopeRow(value, "feedback-A").sampled_observation_references![0]!.sampled_observation_reference = token;
    await persistMoodScope(value);
  }
  for (const token of ["null", "0.00", '"unreported timestamp encoding"']) {
    const value = structuredClone(input); moodscopeQuantity(value, "past-A", "past query time").evidence_value_json = token;
    await persistMoodScope(value);
  }
  const unknownDevice = structuredClone(input); delete moodscopeRow(unknownDevice, "argument-A").device_id;
  await persistMoodScope(unknownDevice);
  const noDevice = structuredClone(input); noDevice.sampled_quantity_observations.forEach(row => { delete row.device_id; });
  await persistMoodScope(noDevice);
});
itWithPrivateCorpus("rejects MoodScope incompatible float, API, query, owner and argument links before saved replacement", async () => {
  const input = moodscopeInput(); await persistMoodScope(input); const prior = await loadResearchMethodSelection();
  const invalids: Array<(value: typeof input) => void> = [
    value => { moodscopeQuantity(value, "current-A", "pleasure").evidence_value_json = '"happy"'; },
    value => { moodscopeQuantity(value, "current-A", "pleasure").evidence_value_json = '"2.5000"'; },
    value => { moodscopeQuantity(value, "current-A", "activeness").evidence_value_json = "1e400"; },
    value => { moodscopeQuantity(value, "argument-A", "activeness").evidence_value_json = "true"; },
    value => { moodscopeQuantity(value, "current-A", "activeness").evidence_value_json = "[2.5,3.5]"; },
    value => { moodscopeQuantity(value, "current-A", "activeness").evidence_value_json = "{}"; },
    value => { moodscopeQuantity(value, "current-A", "pleasure").evidence_unit = "score"; },
    value => { moodscopeQuantity(value, "current-A", "pleasure").quantity_qualifier = "day"; },
    value => { moodscopeQuantity(value, "current-A", "API operation").evidence_value_json = '"GetMood()"'; },
    value => { moodscopeQuantity(value, "feedback-A", "API operation").evidence_value_json = '"GetCurrentMood()"'; },
    value => { moodscopeRow(value, "current-A").quantities!.push({ observed_property: "past query time", evidence_value_json: '"known-past-token"' }); },
    value => { moodscopeQuantity(value, "past-A", "past query time").evidence_value_json = "[]"; },
    value => { moodscopeRow(value, "current-A").quantities!.push(structuredClone(moodscopeQuantity(value, "current-A", "pleasure"))); },
    value => { moodscopeRow(value, "argument-A").observed_entity_kind = "device"; },
    value => { moodscopeRow(value, "current-equal").sampled_observation_id = moodscopeRow(value, "current-A").sampled_observation_id; },
    value => { moodscopeRow(value, "current-A").sampled_observation_references = null; },
    value => { moodscopeRow(value, "argument-A").sampled_observation_references = []; },
    value => { moodscopeRow(value, "feedback-A").sampled_observation_references![0]!.relationship_label = "previous Get"; },
    value => { moodscopeRow(value, "feedback-A").sampled_observation_references![0]!.sampled_observation_reference = "unknown"; },
    value => { moodscopeRow(value, "feedback-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:moodscope-current-A"; },
    value => { moodscopeRow(value, "feedback-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:moodscope-feedback-A"; },
    value => { moodscopeRow(value, "feedback-A").sampled_observation_references!.push(structuredClone(moodscopeRow(value, "feedback-A").sampled_observation_references![0]!)); },
    value => { moodscopeRow(value, "argument-A").participant_id = "constructed:foreign-person"; },
    value => { moodscopeRow(value, "argument-A").device_id = "constructed:foreign-phone"; },
    value => { const duplicate = structuredClone(moodscopeRow(value, "argument-A")); duplicate.device_id = null; value.sampled_quantity_observations.push(duplicate); },
    value => { Reflect.set(moodscopeRow(value, "feedback-A").sampled_observation_references![0]!, "invented_field", true); },
    value => { moodscopeRow(value, "feedback-A").sampled_observation_references![0]!.source_locators = []; },
    value => { Reflect.set(moodscopeRow(value, "argument-A"), "entity_members", null); },
    value => { Reflect.set(moodscopeRow(value, "current-A"), "referenced_day_token", "invented-day"); },
  ];
  for (const mutate of invalids) {
    const invalid = structuredClone(input); mutate(invalid);
    await expect(persistMoodScope(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(prior);
  }
  const cleared = parseStudyMethodProfileLibrary({ profiles: input.profiles, sampled_quantity_observations: [] });
  await saveResearchMethodSelection(JSON.stringify({ profile: cleared.profiles[0], selectedLevels: {}, sampled_quantity_observations: cleared.sampled_quantity_observations }));
  expect((JSON.parse((await loadResearchMethodSelection())!) as { sampled_quantity_observations: unknown }).sampled_quantity_observations).toEqual([]);
  expect(Object.hasOwn(parseStudyMethodProfileLibrary({ profiles: input.profiles }), "sampled_quantity_observations")).toBe(false);
});
itWithPrivateCorpus("preserves MoodScope API records through existing generated JSON Schema/Pydantic without API/model execution", () => {
  const input = moodscopeInput(), schemaPath = resolve(import.meta.dirname, "../../schema/generated/json-schema/chronicle-research-ontology.schema.json");
  const pydanticPath = resolve(import.meta.dirname, "../../schema/generated/pydantic");
  const script = [
    "import json,sys", "from jsonschema import Draft202012Validator", "sys.path.insert(0,sys.argv[2])",
    "import chronicle_research_ontology as model", "schema=json.load(open(sys.argv[1])); data=json.load(sys.stdin)",
    "validator=Draft202012Validator({'$ref':'#/$defs/SampledQuantityObservationRecord','$defs':schema['$defs']})",
    "for row in data['sampled_quantity_observations']:",
    " validator.validate(row)", " assert model.SampledQuantityObservationRecord(**row).model_dump(exclude_unset=True)==row",
    " assert not validator.is_valid(dict(row,invented_field=True))",
    "print('MoodScope-shapes-preserved')",
  ].join("\n");
  expect(execFileSync("uvx", ["--from", "linkml==1.10.0", "--with", "jsonschema", "python", "-c", script, schemaPath, pydanticPath], {
    input: JSON.stringify(input), encoding: "utf8", timeout: 180_000,
  }).trim()).toBe("MoodScope-shapes-preserved");
});

function autosenInput() {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1109/jiot.2020.2975779")!);
  return { profiles: [profile], sampled_quantity_observations: autosenObservationExample(profile) };
}
const autosenRootKeys = ["schema.touch_semantics","schema.touch_dimension","schema.accelerometer","schema.gyroscope","schema.magnetometer","schema.elevation","preprocessing.temporal_alignment","missing.touch.zero","missing.elevation.locf","missing.other.previous_five_mean","normalization.formula","sequence.period_half_second","sequence.period_one_second","model.per_user_binary","model.output","temporal.window"] as const;
const autosenRow = (input: ReturnType<typeof autosenInput>, suffix: string) => input.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:autosen-" + suffix)!;
const autosenQuantity = (input: ReturnType<typeof autosenInput>, suffix: string, property: string) => autosenRow(input, suffix).quantities!.find(q => q.observed_property === property)!;
async function persistAutosen(input: ReturnType<typeof autosenInput>) {
  const parsed = parseStudyMethodProfileLibrary(input);
  const selection = { profile: parsed.profiles[0], selectedLevels: {}, sampled_quantity_observations: parsed.sampled_quantity_observations };
  await saveResearchMethodSelection(JSON.stringify(selection));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as typeof selection;
  expect(saved).toEqual(selection);
  expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], sampled_quantity_observations: saved.sampled_quantity_observations }).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
}
itWithPrivateCorpus.each(autosenRootKeys)("admits actual AUToSen %s before source/body/tuple and owner negatives", key => {
  const all = autosenInput(), local = (value: typeof all) => value.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  const input = { ...all, sampled_quantity_observations: all.sampled_quantity_observations.filter(row => row.method_setting_reference === local(all).method_setting_id).slice(0, 1) };
  input.sampled_quantity_observations.forEach(row => { delete row.sampled_observation_references; });
  expect(input.sampled_quantity_observations.length).toBeGreaterThan(0);
  const definition: unknown = JSON.parse(String(local(input).method_value_json));
  const wrapper = { definition, source_facing_role: local(input).method_setting_role, source_facing_target: local(input).method_target_layer };
  const wrongTarget = local(input).method_target_layer === "model" ? "raw_record" : "model";
  for (const body of [definition, wrapper]) {
    const valid = structuredClone(input); local(valid).method_value_json = JSON.stringify(body);
    expect(parseStudyMethodProfileLibrary(valid).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  }
  for (const body of [null, {}, { conceptual_observation_roles: ["process/application identity", "bytes sent", "bytes received"] },
    { ...wrapper, definition: null }, { ...wrapper, definition: {} }, { ...wrapper, source_facing_role: "provenance" },
    { ...wrapper, source_facing_target: wrongTarget }, { ...wrapper, source_facing_target: null }]) {
    const invalid = structuredClone(input); local(invalid).method_value_json = JSON.stringify(body);
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  for (const [field, value] of [["source_work_id", "doi:foreign"], ["method_setting_role", "provenance"], ["method_target_layer", "released_artifact"]]) {
    const invalid = structuredClone(input); Reflect.set(local(invalid), field!, value);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/local definition role\/target|sampled-quantity definition/);
  }
  const foreign = structuredClone(input), work = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.source_work_id = work; foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = work; });
  foreign.sampled_quantity_observations.forEach(row => { row.source_work_id = work; });
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow("sampled-quantity definition");
});
itWithPrivateCorpus("requires AUToSen exact axis/unit, selected-sensor, normalization and temporal companions", () => {
  for (const [root, companion] of [
    ["schema.accelerometer", "collector.timestamps"], ["preprocessing.temporal_alignment", "schema.magnetometer"],
    ["missing.touch.zero", "missing.touch.meaning"], ["normalization.formula", "normalization.range"],
    ["normalization.formula", "normalization.window_seconds"], ["sequence.period_half_second", "collector.sampling_rate_hz"],
    ["sequence.period_one_second", "dataset.two_sensor"], ["model.per_user_binary", "model.impostor_users"],
    ["model.output", "operation.client_server"], ["temporal.window", "temporal.confidence_threshold"],
  ]) {
    const input = autosenInput(), profile = input.profiles[0]!, id = profile.method_settings.find(s => s.method_parameter_key === root)!.method_setting_id;
    input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === id).slice(0, 1);
    input.sampled_quantity_observations.forEach(row => { delete row.sampled_observation_references; });
    expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
    profile.method_settings.find(s => s.method_parameter_key === companion)!.method_value_json = "{}";
    expect(() => parseStudyMethodProfileLibrary({ profiles: input.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(input)).toThrow("sampled-quantity definition");
  }
});
itWithPrivateCorpus("preserves AUToSen raw/imputed/normalized readings, ordered selected-sensor sequences and independent authentication", async () => {
  const input = autosenInput();
  await persistAutosen(input);
  expect(input.profiles[0]!.method_settings).toHaveLength(115);
  expect(new Set(input.sampled_quantity_observations.map(row => input.profiles[0]!.method_settings.find(s => s.method_setting_id === row.method_setting_reference)!.method_parameter_key))).toEqual(new Set(autosenRootKeys));
  expect(autosenRow(input, "ac-0").source_event_time_token).toBe(autosenRow(input, "ac-1").source_event_time_token);
  expect(autosenRow(input, "ac-0").sampled_observation_id).not.toBe(autosenRow(input, "ac-1").sampled_observation_id);
  expect(autosenRow(input, "ac-0").observation_instant).toBe("independent-collection-time");
  expect(autosenQuantity(input, "touch-missing", "touch frequency").evidence_value_json).toBeNull();
  expect(autosenQuantity(input, "touch-zero", "touch frequency").evidence_value_json).toBe("0.00");
  expect(autosenQuantity(input, "touch-imputed", "imputed touch frequency").evidence_value_json).toBe("0.00");
  expect(autosenRow(input, "sequence-ToAcGrMaEl").sampled_observation_references).toHaveLength(32);
  expect(autosenRow(input, "sequence-AcGrMaEl").sampled_observation_references).toHaveLength(64);
  expect(autosenRow(input, "sequence-AcGrMa").sampled_observation_references).toHaveLength(32);
  expect(autosenRow(input, "sequence-AcGr").sampled_observation_references).toHaveLength(64);
  expect(autosenRow(input, "output-B").participant_id).not.toBe(autosenRow(input, "model-A").participant_id);
  expect(autosenQuantity(input, "confidence-B", "confidence score").evidence_value_json).toBe("0.20");
  expect(autosenQuantity(input, "confidence-B", "authentication decision").evidence_value_json).toBeNull();
  const definition = (key: string) => JSON.parse(String(input.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!.method_value_json)) as unknown;
  expect(definition("collector.sampling_rate_hz")).toBe(64);
  expect(definition("normalization.window_seconds")).toBe(5);
  expect(definition("sequence.period_half_second")).toEqual({ seconds: 0.5, readings: 32 });
  expect(definition("sequence.period_one_second")).toEqual({ seconds: 1, readings: 64 });
  expect(definition("normalization.reading_count_inconsistency")).toBe("The text says a five-second normalization window observes five one-second or ten half-second readings, while the raw collection rate is 64 Hz; the aggregation level connecting those counts is not specified");
  const changed = structuredClone(input);
  autosenQuantity(changed, "output-A", "authentication probability").evidence_value_json = "0.1000";
  expect(autosenQuantity(changed, "output-A", "authentication decision")).toEqual(autosenQuantity(input, "output-A", "authentication decision"));
  expect(autosenRow(changed, "sequence-ToAcGrMaEl")).toEqual(autosenRow(input, "sequence-ToAcGrMaEl"));
  await persistAutosen(changed); // Supplied decision is not recalculated at 0.5.
  const reversed = structuredClone(input);
  reversed.sampled_quantity_observations.reverse();
  autosenRow(reversed, "sequence-ToAcGrMaEl").sampled_observation_references!.reverse();
  await persistAutosen(reversed); // No inferred clock sorting or sequence construction.
  const slide = structuredClone(input);
  autosenQuantity(slide, "touch-action", "touch action").evidence_value_json = '"slide"';
  await persistAutosen(slide);
  for (const token of [undefined, null, "null", '"unknown"', "0.00", '"1.000"']) {
    const value = structuredClone(input), quantity = autosenQuantity(value, "touch-missing", "touch frequency");
    if (token === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = token;
    await persistAutosen(value);
  }
  for (const token of [undefined, null, []]) {
    const value = structuredClone(input), sequence = autosenRow(value, "sequence-ToAcGrMaEl");
    if (token === undefined) delete sequence.sampled_observation_references; else sequence.sampled_observation_references = token;
    await persistAutosen(value);
  }
  const partial = structuredClone(input);
  autosenRow(partial, "sequence-ToAcGrMaEl").sampled_observation_references!.splice(1);
  autosenRow(partial, "sequence-ToAcGrMaEl").sampled_observation_references!.push({ relationship_label: "sequence member", sampled_observation_reference: null, source_locators: ["supplied unknown member"] });
  await persistAutosen(partial);
  const perSensor = structuredClone(input);
  autosenRow(perSensor, "motion-imputed").sampled_observation_references!.push({ relationship_label: "previous observed gyroscope", sampled_observation_reference: "constructed:autosen-gr", source_locators: ["six total antecedents but no more than five per sensor"] });
  await persistAutosen(perSensor);
});
itWithPrivateCorpus("keeps AUToSen known alignment supports inside its supplied selected-sensor set", async () => {
  const input = autosenInput(), aligned = autosenRow(input, "aligned");
  const excluded = aligned.sampled_observation_references!.filter(link => ["touch reading", "magnetometer reading", "elevation reading"].includes(link.relationship_label));
  aligned.quantities = aligned.quantities!.filter(q => !/touch|magnetometer|elevation/.test(q.observed_property));
  autosenQuantity(input, "aligned", "sensor set").evidence_value_json = '"AcGr"';
  aligned.sampled_observation_references = aligned.sampled_observation_references!.filter(link => !excluded.includes(link));
  await persistAutosen(input);
  const unknown = structuredClone(input);
  autosenRow(unknown, "aligned").sampled_observation_references!.push(...excluded.map(link => ({ ...link, sampled_observation_reference: null })));
  await persistAutosen(unknown);
  const invalid = structuredClone(input);
  autosenRow(invalid, "aligned").sampled_observation_references!.push(...excluded);
  expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("reading outside the supplied selected-sensor set");
});
itWithPrivateCorpus("checks only known AUToSen training/input sensor sets and periods, including temporal model context", async () => {
  const input = autosenInput(); await persistAutosen(input);
  const mutations: Array<[(value: typeof input) => void, RegExp]> = [
    [value => {
      const sequence = autosenRow(value, "impostor-sequence"); delete sequence.sampled_observation_references;
      autosenQuantity(value, "impostor-sequence", "sensor set").evidence_value_json = '"AcGr"';
    }, /model input configuration/],
    [value => {
      autosenRow(value, "impostor-sequence").method_setting_reference = value.profiles[0]!.method_settings.find(setting => setting.method_parameter_key === "sequence.period_one_second")!.method_setting_id;
    }, /model input configuration/],
    [value => { autosenRow(value, "output-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:autosen-sequence-AcGrMa"; }, /model input configuration/],
    [value => {
      const sequence = structuredClone(autosenRow(value, "sequence-ToAcGrMaEl"));
      sequence.sampled_observation_id += "-one-second";
      sequence.method_setting_reference = value.profiles[0]!.method_settings.find(setting => setting.method_parameter_key === "sequence.period_one_second")!.method_setting_id;
      value.sampled_quantity_observations.push(sequence);
      autosenRow(value, "output-A").sampled_observation_references![0]!.sampled_observation_reference = sequence.sampled_observation_id;
    }, /model input configuration/],
    [value => {
      autosenRow(value, "confidence-A").sampled_observation_references = [{ relationship_label: "authentication model", sampled_observation_reference: "constructed:autosen-model-A", source_locators: ["valid local model; incompatible known temporal configuration"] }];
    }, /temporal study's selected sensors or period/],
  ];
  for (const [mutate, message] of mutations) {
    const invalid = structuredClone(input); mutate(invalid);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(message);
  }
  for (const token of [undefined, null, []]) {
    const unknown = structuredClone(input), model = autosenRow(unknown, "model-A");
    if (token === undefined) delete model.sampled_observation_references; else model.sampled_observation_references = token;
    autosenRow(unknown, "output-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:autosen-sequence-AcGrMa";
    await persistAutosen(unknown); // No training configuration is manufactured from the model identity.
  }
});
itWithPrivateCorpus("allows ten distinct supplied AUToSen impostor users but not an eleventh, without requiring complete members", async () => {
  const input = autosenInput(), model = autosenRow(input, "model-A");
  model.sampled_observation_references = model.sampled_observation_references!.filter(link => link.relationship_label !== "impostor sequence");
  const add = (index: number) => {
    const sequence = structuredClone(autosenRow(input, "impostor-sequence"));
    sequence.sampled_observation_id = "constructed:autosen-impostor-member-" + index;
    sequence.participant_id = "constructed:autosen-impostor-user-" + index;
    sequence.device_id = "constructed:autosen-impostor-phone-" + index;
    sequence.sampled_observation_references = null;
    input.sampled_quantity_observations.push(sequence);
    model.sampled_observation_references!.push({ relationship_label: "impostor sequence", sampled_observation_reference: sequence.sampled_observation_id, source_locators: ["supplied distinct user; no random selection or five-times record-ratio claim"] });
  };
  for (let index = 0; index < 10; index++) add(index);
  await persistAutosen(input);
  const retained = await loadResearchMethodSelection();
  add(10);
  await expect(persistAutosen(input)).rejects.toThrow("ten supplied impostor users");
  expect(await loadResearchMethodSelection()).toBe(retained);
});
itWithPrivateCorpus("rejects AUToSen known membership excess, wrong sensor/role/owner/unit and malformed values before replacement", async () => {
  const input = autosenInput(); await persistAutosen(input); const retained = await loadResearchMethodSelection();
  const mutations: Array<[(value: typeof input) => void, RegExp]> = [
    [v => { autosenQuantity(v, "touch-action", "touch action").evidence_value_json = '"press"'; }, /AUToSen category/],
    [v => { autosenQuantity(v, "touch-imputed", "imputed touch frequency").evidence_value_json = "1"; }, /touch-zero/],
    [v => { autosenQuantity(v, "touch-missing", "touch frequency").observed_property = "touch x"; }, /observed_property/],
    [v => { autosenQuantity(v, "ac-0", "accelerometer x").evidence_unit = "radians/second"; }, /evidence_unit/],
    [v => { autosenQuantity(v, "el", "elevation").evidence_unit = "meters"; }, /evidence_unit/],
    [v => { autosenQuantity(v, "ma", "magnetometer component 1").observed_property = "magnetometer x"; }, /observed_property/],
    [v => { autosenQuantity(v, "normalized-AcGr-0", "normalized accelerometer x").evidence_value_json = "1.01"; }, /AUToSen range/],
    [v => { autosenQuantity(v, "output-A", "authentication probability").evidence_value_json = "{}"; }, /AUToSen scalar/],
    [v => { autosenQuantity(v, "output-A", "authentication decision").evidence_value_json = "2"; }, /binary decision/],
    [v => { autosenRow(v, "sequence-ToAcGrMaEl").sampled_observation_references![0]!.sampled_observation_reference = "constructed:autosen-normalized-AcGrMa-0"; }, /selected-sensor membership/],
    [v => { autosenRow(v, "aligned").sampled_observation_references![2]!.sampled_observation_reference = "constructed:autosen-motion-imputed"; }, /imputed-sensor family/],
    [v => { autosenRow(v, "temporal-sequence").method_setting_reference = v.profiles[0]!.method_settings.find(s => s.method_parameter_key === "sequence.period_half_second")!.method_setting_id; }, /compatible, distinct/],
    [v => { autosenRow(v, "model-A").sampled_observation_references![1]!.sampled_observation_reference = "constructed:autosen-sequence-ToAcGrMaEl"; }, /another supplied user's/],
    [v => { autosenRow(v, "model-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:autosen-sequence-AcGr"; }, /compatible, distinct/],
    [v => { autosenRow(v, "output-B").sampled_observation_references![0]!.sampled_observation_reference = "constructed:autosen-sequence-ToAcGrMaEl"; }, /compatible, distinct/],
    [v => { autosenRow(v, "sequence-ToAcGrMaEl").sampled_observation_references![0]!.sampled_observation_reference = "constructed:autosen-ac-0"; }, /compatible, distinct/],
    [v => { autosenRow(v, "ac-0").sampled_observation_references = null; }, /incompatible/],
    [v => { autosenRow(v, "ac-0").device_id = "different-known-device"; }, /compatible, distinct/],
    [v => { autosenRow(v, "sequence-ToAcGrMaEl").sampled_observation_references!.push(structuredClone(autosenRow(v, "sequence-ToAcGrMaEl").sampled_observation_references![0]!)); }, /duplicates/],
    [v => { const sequence = autosenRow(v, "sequence-ToAcGrMaEl"); sequence.sampled_observation_references![0]!.sampled_observation_reference = sequence.sampled_observation_id; }, /compatible, distinct/],
    [v => { autosenRow(v, "normalized-AcGr-0").quantities!.push({ observed_property: "normalized elevation", evidence_value_json: "0.25" }); }, /outside the supplied selected-sensor/],
  ];
  for (const [sequence, member] of [["sequence-ToAcGrMaEl", "normalized-ToAcGrMaEl-0"], ["sequence-AcGrMaEl", "normalized-AcGrMaEl-0"]]) {
    mutations.push([v => {
      const extra = structuredClone(autosenRow(v, member!)); extra.sampled_observation_id += "-extra"; delete extra.sampled_observation_references;
      v.sampled_quantity_observations.push(extra);
      autosenRow(v, sequence!).sampled_observation_references!.push({ relationship_label: "sequence member", sampled_observation_reference: extra.sampled_observation_id, source_locators: ["constructed valid local excess member"] });
    }, /sequence membership/]);
  }
  mutations.push([v => {
    const extra = structuredClone(autosenRow(v, "ac-4")); extra.sampled_observation_id = "constructed:autosen-ac-5"; v.sampled_quantity_observations.push(extra);
    autosenRow(v, "motion-imputed").sampled_observation_references!.push({ relationship_label: "previous observed accelerometer", sampled_observation_reference: extra.sampled_observation_id, source_locators: ["constructed sixth same-sensor antecedent"] });
  }, /five supplied antecedents/]);
  for (const [mutate, message] of mutations) {
    const invalid = structuredClone(input); mutate(invalid);
    await expect(persistAutosen(invalid)).rejects.toThrow(message);
    expect(await loadResearchMethodSelection()).toBe(retained);
  }
});

function wearableMoodInput() {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/2968219.2968302")!);
  return { profiles: [profile], ...wearableMoodObservationExample(profile) };
}
const wearableMoodSourceTuples: Record<string, readonly [string, string]> = {
  "location.schema": [
    "event_schema",
    "raw_event"
  ],
  "foreground.schema": [
    "event_schema",
    "raw_event"
  ],
  "microphone.schema": [
    "event_schema",
    "raw_event"
  ],
  "message.schema": [
    "event_schema",
    "raw_event"
  ],
  "call.schema": [
    "event_schema",
    "raw_event"
  ],
  "light.schema": [
    "event_schema",
    "raw_event"
  ],
  "connectivity.schema": [
    "event_schema",
    "raw_event"
  ],
  "calendar.schema": [
    "event_schema",
    "raw_event"
  ],
  "activity.schema": [
    "event_schema",
    "raw_event"
  ],
  "watch.cadence": [
    "acquisition",
    "raw_event"
  ],
  "ekg.cadence": [
    "acquisition",
    "raw_event"
  ],
  "time.features": [
    "preprocessing",
    "derived_feature"
  ],
  "light.factorization": [
    "preprocessing",
    "derived_feature"
  ],
  "activity.factorization": [
    "preprocessing",
    "derived_feature"
  ],
  "hr.factorization": [
    "preprocessing",
    "derived_feature"
  ],
  "hrv.features": [
    "event_schema",
    "derived_feature"
  ],
  "hrv.alignment": [
    "reconstruction",
    "derived_feature"
  ],
  "feature_ranking.method": [
    "modeling",
    "analysis"
  ],
  "prompt.time": [
    "acquisition",
    "diary_response"
  ],
  "prompt.calendar": [
    "acquisition",
    "diary_response"
  ],
  "prompt.connectivity": [
    "acquisition",
    "diary_response"
  ],
  "prompt.message": [
    "acquisition",
    "diary_response"
  ],
  "prompt.call": [
    "acquisition",
    "diary_response"
  ],
  "prompt.voluntary": [
    "acquisition",
    "diary_response"
  ]
};
const wearableRow = (input: ReturnType<typeof wearableMoodInput>, id: string) =>
  input.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:wearable-" + id)!;
const wearableQuantity = (input: ReturnType<typeof wearableMoodInput>, id: string, property: string) =>
  wearableRow(input, id).quantities!.find(q => q.observed_property === property)!;
async function persistTaskAndSampled(input: { profiles: StudyMethodProfile[]; task_occurrences: TaskOccurrenceRecord[]; sampled_quantity_observations: SampledQuantityObservationRecord[] }) {
  const { profiles, ...records } = parseStudyMethodProfileLibrary(input);
  await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], selectedLevels: {}, ...records }));
  const { profile, sampled_quantity_observations, task_occurrences } = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile } & typeof records;
  const reparsed = parseStudyMethodProfileLibrary({ profiles: [profile], sampled_quantity_observations, task_occurrences });
  expect(reparsed.sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  expect(reparsed.task_occurrences).toEqual(input.task_occurrences);
}
itWithPrivateCorpus.each(Object.keys(wearableMoodSourceTuples))("admits Wearable Mood %s only under its exact original source tuple/body", key => {
  const input = wearableMoodInput(), local = (v: typeof input) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === local(input).method_setting_id);
  input.sampled_quantity_observations.forEach(row => { delete row.sampled_observation_references; delete row.task_occurrence_reference; });
  input.task_occurrences = [];
  expect(input.sampled_quantity_observations.length).toBeGreaterThan(0);
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  const parsed: unknown = JSON.parse(String(local(input).method_value_json));
  const body = parsed !== null && typeof parsed === "object" && Object.hasOwn(parsed, "definition") ? (parsed as { definition: unknown }).definition : parsed;
  const [sourceRole, sourceTarget] = wearableMoodSourceTuples[key]!;
  local(input).method_value_json = JSON.stringify({ definition: body, source_facing_role: sourceRole, source_facing_target: sourceTarget });
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  for (const mutation of [
    (s: ReturnType<typeof local>) => { s.method_value_json = "{}"; },
    (s: ReturnType<typeof local>) => { s.method_value_json = JSON.stringify({ definition: { conceptual_observation_roles: ["process/application identity", "bytes sent", "bytes received"] }, source_facing_role: sourceRole, source_facing_target: sourceTarget }); },
    (s: ReturnType<typeof local>) => { s.method_value_json = JSON.stringify({ definition: body, source_facing_role: "reporting", source_facing_target: sourceTarget }); },
    (s: ReturnType<typeof local>) => { s.method_value_json = JSON.stringify({ definition: body, source_facing_role: sourceRole, source_facing_target: "outcome" }); },
    (s: ReturnType<typeof local>) => { s.method_setting_role = "reporting"; s.method_target_layer = "outcome"; },
  ]) {
    const invalid = structuredClone(input); mutation(local(invalid));
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/sampled-quantity definition|local definition role\/target|source-facing definition/);
  }
  const foreign = structuredClone(input), work = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.source_work_id = work;
  foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = work; });
  foreign.sampled_quantity_observations.forEach(row => { row.source_work_id = work; });
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow("sampled-quantity definition");
});
itWithPrivateCorpus.each([
  ["mdmq.instrument", "response", "acquisition", "diary_response"],
  ["mdmq.items", "response", "event_schema", "diary_response"],
  ["mdmq.dimensions", "criterion", "reconstruction", "diary_response"],
  ["valence.classes", "criterion", "preprocessing", "label"],
  ["procedure.final_feedback", "response", "outcome_instrument", "outcome"],
  ["procedure.final_feedback", "criterion", "outcome_instrument", "outcome"],
] as const)("accepts Wearable Mood %s as independent %s without scoring defaults", (key, kind, sourceRole, sourceTarget) => {
  const input = wearableMoodInput(), local = (v: typeof input) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  const id = local(input).method_setting_id;
  input.sampled_quantity_observations = [];
  input.task_occurrences = input.task_occurrences.flatMap(task => {
    const responses = kind === "response" ? task.task_questionnaire_responses?.filter(r => r.questionnaire_setting_reference === id) ?? [] : [];
    const criteria = kind === "criterion" ? task.criterion_assessments?.filter(r => r.criterion_setting_reference === id) ?? [] : [];
    return responses.length || criteria.length ? [{ ...task, task_actions: [], task_questionnaire_responses: responses, criterion_assessments: criteria }] : [];
  });
  expect(input.task_occurrences.length).toBeGreaterThan(0);
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  if (key === "mdmq.dimensions") {
    const bad = structuredClone(input);
    bad.task_occurrences[0]!.criterion_assessments![0]!.criterion_label = "undeclared dimension";
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow("independent MDMQ dimension");
  }
  const original: unknown = JSON.parse(String(local(input).method_value_json));
  const body = original !== null && typeof original === "object" && Object.hasOwn(original, "definition") ? (original as { definition: unknown }).definition : original;
  local(input).method_value_json = JSON.stringify({ definition: body, source_facing_role: sourceRole, source_facing_target: sourceTarget });
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  for (const value of [{}, null, { definition: null, source_facing_role: sourceRole, source_facing_target: sourceTarget },
    { definition: body, source_facing_role: local(input).method_setting_role, source_facing_target: local(input).method_target_layer }]) {
    const invalid = structuredClone(input); local(invalid).method_value_json = JSON.stringify(value);
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(new RegExp("compatible " + (kind === "response" ? "response-scale" : kind) + " definition"));
  }
  const foreign = structuredClone(input), work = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.source_work_id = work;
  foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = work; });
  foreign.task_occurrences.forEach(row => { row.source_work_id = work; });
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow(new RegExp("compatible " + (kind === "response" ? "response-scale" : kind) + " definition"));
});
itWithPrivateCorpus("requires the exact Wearable Mood cadence, hashing, HRV and prompt companions independently", () => {
  for (const [root, companion] of [
    ["foreground.schema", "phone.cadence"], ["message.schema", "privacy.peer_hash"], ["call.schema", "privacy.peer_hash"],
    ["hrv.features", "hrv.export"], ["hrv.features", "hrv.extractor"], ["hrv.features", "ekg.cadence"],
    ["hrv.alignment", "hrv.features"], ["hrv.alignment", "mdmq.dimensions"],
    ["prompt.time", "prompt.global_gap"], ["prompt.connectivity", "prompt.connectivity_guard"],
  ]) {
    const input = wearableMoodInput(), id = input.profiles[0]!.method_settings.find(s => s.method_parameter_key === root)!.method_setting_id;
    input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === id);
    input.sampled_quantity_observations.forEach(row => { delete row.sampled_observation_references; delete row.task_occurrence_reference; });
    input.task_occurrences = [];
    expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
    input.profiles[0]!.method_settings.find(s => s.method_parameter_key === companion)!.method_value_json = "{}";
    expect(() => parseStudyMethodProfileLibrary({ profiles: input.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(input)).toThrow("sampled-quantity definition");
  }
});
itWithPrivateCorpus("preserves Wearable Mood streams, partial reports, independent outcomes and explicit cross-device association", async () => {
  const source = wearableMoodInput(); await persistTaskAndSampled(source);
  expect(new Set(source.sampled_quantity_observations.map(row => source.profiles[0]!.method_settings.find(s => s.method_setting_id === row.method_setting_reference)!.method_parameter_key))).toEqual(new Set(Object.keys(wearableMoodSourceTuples)));
  expect(source.task_occurrences.slice(0, 2).map(t => t.task_questionnaire_responses!.length)).toEqual([6, 6]);
  expect(source.task_occurrences[2]!.task_questionnaire_responses).toHaveLength(1);
  expect(wearableRow(source, "HRV").quantities!.map(q => q.observed_property)).toEqual(["HrvHf", "HrvLf", "HrvLfHf", "HrvPnn50", "HrvRmssd", "HrvSd1", "HrvSd2", "HrvSd2Sd1", "HrvSdnn", "HrvSdsd"]);
  expect(wearableRow(source, "HRV").device_id).not.toBe(wearableRow(source, "association").device_id);
  expect(wearableRow(source, "association").task_occurrence_reference).not.toBe(wearableRow(source, "association-watch").task_occurrence_reference);
  expect(wearableQuantity(source, "locked", "foreground application").evidence_value_json).toBe('""');
  expect(wearableQuantity(source, "calendar-count", "number of calendar entries").evidence_value_json).toBe("3");
  const independent = structuredClone(source);
  independent.task_occurrences[0]!.criterion_assessments![0]!.assessment_value_json = "1.75"; // Printed class gap is not filled by a calculation.
  independent.task_occurrences[0]!.criterion_assessments!.at(-1)!.assessment_value_json = "null";
  wearableQuantity(independent, "HRV", "HrvHf").evidence_value_json = "7.50";
  wearableQuantity(independent, "calendar-count", "number of calendar entries").evidence_value_json = "0";
  expect(independent.task_occurrences[0]!.task_questionnaire_responses).toEqual(source.task_occurrences[0]!.task_questionnaire_responses);
  expect(wearableRow(independent, "HRV").sampled_observation_references).toEqual(wearableRow(source, "HRV").sampled_observation_references);
  expect(wearableRow(independent, "calendar")).toEqual(wearableRow(source, "calendar"));
  await persistTaskAndSampled(independent);
  for (const dimension of ["0", "6", "2.25", '"unreported numeric serialization"', "null", null, undefined]) {
    const value = structuredClone(source), criterion = value.task_occurrences[0]!.criterion_assessments![1]!;
    if (dimension === undefined) delete criterion.assessment_value_json; else criterion.assessment_value_json = dimension;
    await persistTaskAndSampled(value); // Dimension range does not imply half-step item coding.
  }
  const reverse = structuredClone(source); reverse.sampled_quantity_observations.reverse(); reverse.task_occurrences.reverse();
  await persistTaskAndSampled(reverse);
  for (const token of [undefined, null, "null", ' "" ']) {
    const unknown = structuredClone(source), quantity = wearableQuantity(unknown, "locked", "foreground application");
    if (token === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = token;
    await persistTaskAndSampled(unknown);
  }
  for (const refs of [undefined, null, []]) {
    const unknown = structuredClone(source);
    if (refs === undefined) delete wearableRow(unknown, "association").sampled_observation_references;
    else wearableRow(unknown, "association").sampled_observation_references = refs;
    await persistTaskAndSampled(unknown);
  }
  for (const ref of [undefined, null]) {
    const unknown = structuredClone(source), link = wearableRow(unknown, "association").sampled_observation_references![0]!;
    if (ref === undefined) delete link.sampled_observation_reference; else link.sampled_observation_reference = ref;
    await persistTaskAndSampled(unknown);
  }
});
itWithPrivateCorpus("rejects Wearable Mood known ownership/category/locked-empty contradictions while retaining the prior selection", async () => {
  const source = wearableMoodInput(); await persistTaskAndSampled(source); const prior = await loadResearchMethodSelection();
  const cases: [string, (v: typeof source) => void][] = [
    ["0–6 MDMQ dimension", v => { v.task_occurrences[0]!.criterion_assessments![1]!.assessment_value_json = "6.25"; }],
    ["0–6 MDMQ dimension", v => { v.task_occurrences[0]!.criterion_assessments![1]!.assessment_value_json = "-0.25"; }],
    ["supplied Wearable Mood valence class", v => { v.task_occurrences[0]!.criterion_assessments!.at(-1)!.assessment_value_json = '"rounded-high"'; }],
    ["locked-empty", v => { wearableQuantity(v, "locked", "foreground application").evidence_value_json = '"known app"'; }],
    ["application string", v => { wearableQuantity(v, "app", "foreground application").evidence_value_json = "0"; }],
    ["normalized lock condition", v => { wearableQuantity(v, "locked", "screen locked").evidence_value_json = '"LOCKED"'; }],
    ["Wearable Mood category", v => { wearableQuantity(v, "trigger-4", "trigger").evidence_value_json = '"missed call ended"'; }],
    ["Wearable Mood category", v => { wearableQuantity(v, "message", "folder").evidence_value_json = '"draft"'; }],
    ["evidence_unit must be omitted/null", v => { wearableQuantity(v, "call", "call duration").evidence_unit = "seconds"; }],
    ["invalid supplied nonnegative", v => { wearableQuantity(v, "calendar-count", "number of calendar entries").evidence_value_json = "1.5"; }],
    ["invalid supplied nonnegative", v => { wearableQuantity(v, "watch-HR", "heart rate").evidence_value_json = "-1"; }],
    ["compatible, distinct sampled observation", v => { wearableRow(v, "association").sampled_observation_references![0]!.sampled_observation_reference = "constructed:wearable-ECG-HR"; }],
    ["compatible, distinct sampled observation", v => { wearableRow(v, "HR-block").device_id = wearableRow(v, "ECG-HR").device_id; wearableRow(v, "HR-block").sampled_observation_references![0]!.sampled_observation_reference = "constructed:wearable-ECG-HR"; }],
    ["same supplied Wearable Mood participant", v => { wearableRow(v, "HRV").participant_id = "constructed:other-person"; delete wearableRow(v, "HRV").sampled_observation_references; }],
    ["compatible, distinct sampled observation", v => { wearableRow(v, "light").device_id = "constructed:foreign-phone"; }],
    ["matching task", v => { wearableRow(v, "association").task_occurrence_reference = source.task_occurrences[1]!.task_occurrence_id; }],
    ["supplied MDMQ completion/reported valence", v => { v.task_occurrences[0]!.criterion_assessments = v.task_occurrences[0]!.criterion_assessments!.filter(a => a.criterion_label !== "valence"); }],
    ["cannot assign this reading", v => { wearableRow(v, "app").task_occurrence_reference = null; }],
    ["incompatible with this observation definition", v => { wearableRow(v, "app").sampled_observation_references = null; }],
    ["incompatible with this observation definition", v => { wearableRow(v, "calendar").sampled_observation_references = []; }],
    ["duplicates a sampled-observation relationship", v => { const links = wearableRow(v, "association").sampled_observation_references!; links.push(structuredClone(links[0]!)); }],
  ];
  for (const [message, mutate] of cases) {
    const invalid = structuredClone(source); mutate(invalid);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(message);
    expect(await loadResearchMethodSelection()).toBe(prior);
  }
});

function depressionTrafficInput() {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1016/j.smhl.2020.100137")!);
  return { profiles: [profile], ...depressionTrafficObservationExample(profile) };
}
const depressionTrafficRoots = ["collector.android_screen_events","reconstruction.screen_interval_definition","reconstruction.screen_interval_cap","schema.packet_tuple","quality.android_screen_traffic_gate","quality.keepalive_predicate","quality.keepalive_removal","schema.aggregated_application_session","reconstruction.usage_session_gap_rules","reconstruction.on_off_definition","category.dbip_lookup","category.first_match_policy","reconstruction.category_overlap_merge","aggregation.phq9_feature_window","features.aggregate_usage","features.category_usage","features.volume","analysis.regression_models","analysis.classification_model"] as const;
itWithPrivateCorpus.each(depressionTrafficRoots)("accepts depression-traffic %s independently and rejects drift without generic fallback", key => {
  const input = depressionTrafficInput();
  const local = (v: typeof input) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === local(input).method_setting_id);
  input.sampled_quantity_observations.forEach(row => { delete row.sampled_observation_references; delete row.task_occurrence_reference; });
  input.task_occurrences = [];
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  const setting = local(input), parsed: unknown = JSON.parse(String(setting.method_value_json));
  const body = parsed !== null && typeof parsed === "object" && Object.hasOwn(parsed, "definition") ? (parsed as { definition: unknown }).definition : parsed;
  setting.method_value_json = JSON.stringify({ definition: body, source_facing_role: setting.method_setting_role, source_facing_target: setting.method_target_layer });
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  for (const mutation of [
    (s: typeof setting) => { s.method_value_json = "{}"; },
    (s: typeof setting) => { s.method_value_json = JSON.stringify({ definition: body, source_facing_role: "wrong", source_facing_target: s.method_target_layer }); },
    (s: typeof setting) => { s.method_value_json = JSON.stringify({ definition: body, source_facing_role: s.method_setting_role, source_facing_target: "wrong" }); },
    (s: typeof setting) => { s.method_setting_role = "analysis"; s.method_target_layer = "outcome"; },
  ]) {
    const invalid = structuredClone(input); mutation(local(invalid));
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/sampled-quantity definition|local definition role\/target|source-facing definition/);
  }
});
itWithPrivateCorpus.each([
  ["diary.phq9_instrument", "response"], ["diary.phq9_instrument", "criterion"],
  ["outcome.clinician_assessment", "criterion"], ["outcome.depressed_followup", "criterion"],
  ["validation.classification_ground_truth", "criterion"],
] as const)("admits depression-traffic %s %s without borrowing other PHQ instrument semantics", (key, kind) => {
  const input = depressionTrafficInput(), local = (v: typeof input) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  input.sampled_quantity_observations = [];
  input.task_occurrences = input.task_occurrences.filter(task => kind === "response"
    ? task.task_questionnaire_responses?.some(r => r.questionnaire_setting_reference === local(input).method_setting_id)
    : task.criterion_assessments?.some(a => a.criterion_setting_reference === local(input).method_setting_id));
  input.task_occurrences.forEach(task => {
    task.task_questionnaire_responses = kind === "response" ? task.task_questionnaire_responses!.filter(r => r.questionnaire_setting_reference === local(input).method_setting_id) : [];
    task.criterion_assessments = kind === "criterion" ? task.criterion_assessments!.filter(a => a.criterion_setting_reference === local(input).method_setting_id) : [];
  });
  expect(input.task_occurrences.length).toBeGreaterThan(0);
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  const actual: unknown = JSON.parse(String(local(input).method_value_json));
  const body = actual !== null && typeof actual === "object" && Object.hasOwn(actual, "definition") ? (actual as { definition: unknown }).definition : actual;
  local(input).method_value_json = JSON.stringify({ definition: body, source_facing_role: local(input).method_setting_role, source_facing_target: local(input).method_target_layer });
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  for (const mutation of [
    (s: ReturnType<typeof local>) => { s.method_value_json = "{}"; },
    (s: ReturnType<typeof local>) => { s.method_value_json = JSON.stringify({ definition: body, source_facing_role: "wrong", source_facing_target: s.method_target_layer }); },
    (s: ReturnType<typeof local>) => { s.method_setting_role = "participant_schema"; s.method_target_layer = "participant_measure";
      s.method_value_json = JSON.stringify({ definition: body, source_facing_role: "participant_schema", source_facing_target: "participant_measure", scale_endpoints: [0, 3] }); },
  ]) {
    const invalid = structuredClone(input); mutation(local(invalid));
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/compatible response-scale|compatible criterion/);
  }
});
itWithPrivateCorpus("roundtrips the supplied depression-traffic pipeline, separate PHQ completions and outputs without running reconstruction", async () => {
  const source = depressionTrafficInput(), row = (id: string) => source.sampled_quantity_observations.find(r => r.sampled_observation_id === "constructed:depression-traffic-" + id)!;
  const body = (key: string): unknown => {
    const value: unknown = JSON.parse(String(source.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!.method_value_json));
    return value !== null && typeof value === "object" && Object.hasOwn(value, "definition") ? (value as { definition: unknown }).definition : value;
  };
  expect(body("aggregation.dayparts")).toEqual({ morning: "6am-12pm", afternoon: "12pm–6pm", night: "6pm-12am", midnight: "12am–6am", endpoint_inclusion: null });
  expect(body("reconstruction.usage_session_gap_rules")).toEqual({
    within_external_ip: "same session when successive occupied-minute indices differ by <=1 minute",
    across_external_ips: "merge sessions when ending-to-beginning gap is <1 minute",
  });
  expect(row("packet-0").observation_instant).toBe("supplied:server-capture-0");
  expect(row("packet-0")).not.toHaveProperty("source_event_time_token");
  expect(row("screen-0").source_event_time_token).not.toBe(row("screen-0").observation_instant);
  expect(row("bin-A").sampled_observation_references!.map(r => r.sampled_observation_reference)).toEqual(["constructed:depression-traffic-decision-0", "constructed:depression-traffic-decision-1"]);
  expect(row("within-A").sampled_observation_references!.map(r => r.relationship_label)).toEqual(["minute-bin member", "minute-bin member"]);
  expect(row("across-A").sampled_observation_references!.map(r => r.relationship_label)).toEqual(["within-IP member", "within-IP member"]);
  expect(row("off").sampled_observation_references!.map(r => r.relationship_label)).toEqual(["preceding on-period", "following on-period"]);
  expect(row("iOS-independent")).not.toHaveProperty("sampled_observation_references");
  for (const id of ["A", "B"]) {
    for (const [key, count] of [["features.aggregate_usage", 11], ["features.category_usage", 14], ["features.volume", 5]] as const) {
      expect(row(key + "-" + id).quantities).toHaveLength(count);
      expect(row(key + "-" + id).task_occurrence_reference).toBe("constructed:depression-traffic-PHQ-" + id);
    }
  }
  expect(source.task_occurrences.map(t => t.task_questionnaire_responses!.length)).toEqual([9, 9]);
  expect(source.task_occurrences[0]!.task_questionnaire_responses![7]).not.toHaveProperty("response_value_json");
  expect(source.task_occurrences[0]!.task_questionnaire_responses![8]!.response_value_json).toBeNull();
  const parsed = parseStudyMethodProfileLibrary(source);
  expect(parsed.sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  expect(parsed.task_occurrences).toEqual(source.task_occurrences);
  const { profiles, ...records } = parsed;
  await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], selectedLevels: {}, ...records }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile } & typeof records;
  expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], sampled_quantity_observations: saved.sampled_quantity_observations,
    task_occurrences: saved.task_occurrences })).toEqual(parsed); // Include parser-provided library metadata, not a partial matcher.
});
itWithPrivateCorpus("preserves unknowns and Fig2's unresolved gap/membership discrepancy instead of certifying literal-rule execution", () => {
  const input = depressionTrafficInput(), row = (id: string) => input.sampled_quantity_observations.find(r => r.sampled_observation_id === "constructed:depression-traffic-" + id)!;
  row("within-A").quantities!.find(q => q.observed_property === "successive occupied-minute-index gap")!.evidence_value_json = "2";
  row("across-A").quantities!.find(q => q.observed_property === "ending-to-beginning gap")!.evidence_value_json = "1";
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  for (const unknown of [undefined, null] as const) {
    const variant = structuredClone(input), event = variant.sampled_quantity_observations[0]!;
    if (unknown === undefined) { delete event.source_event_time_token; delete event.observation_instant; delete event.quantities; }
    else { event.source_event_time_token = unknown; event.observation_instant = unknown; event.quantities = unknown; }
    const independent = variant.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith("across-B"))!;
    if (unknown === undefined) delete independent.sampled_observation_references; else independent.sampled_observation_references = unknown;
    // Remove the known opener reference when its categorical label is explicitly unknown; no opener is inferred.
    variant.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith("screen-original"))!.sampled_observation_references = null;
    expect(parseStudyMethodProfileLibrary(variant).sampled_quantity_observations).toEqual(variant.sampled_quantity_observations);
  }
});
itWithPrivateCorpus("rejects concrete depression-traffic ownership/stage/category/selection contradictions and retains the saved selection", async () => {
  const source = depressionTrafficInput();
  const parsed = parseStudyMethodProfileLibrary(source), { profiles, ...records } = parsed;
  await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], selectedLevels: {}, ...records }));
  const prior = await loadResearchMethodSelection();
  const row = (v: typeof source, id: string) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === "constructed:depression-traffic-" + id)!;
  const quantity = (v: typeof source, id: string, property: string, value: string) => { row(v, id).quantities!.find(q => q.observed_property === property)!.evidence_value_json = value; };
  const cases: [string, (v: typeof source) => void][] = [
    ["declared action family", v => { row(v, "screen-original").sampled_observation_references![0]!.sampled_observation_reference = "constructed:depression-traffic-screen-1"; }],
    ["known iOS packet", v => { row(v, "gate-0").sampled_observation_references![0]!.sampled_observation_reference = "constructed:depression-traffic-iOS-independent"; }],
    ["60-minute screen cap", v => { quantity(v, "screen-effective", "retained screen-on duration", "61"); }],
    ["keep-alive designation", v => { quantity(v, "decision-0", "disposition", '"removed"'); }],
    ["independent packet designations", v => { row(v, "decision-0").sampled_observation_references![0]!.sampled_observation_reference = "constructed:depression-traffic-gate-1"; }],
    ["known removed packet", v => { row(v, "bin-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:depression-traffic-decision-2"; }],
    ["known supplied external IP address a", v => { row(v, "within-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:depression-traffic-bin-C"; }],
    ["reconstruction stages", v => { row(v, "within-A").sampled_observation_references = [{ relationship_label: "within-IP member", sampled_observation_reference: "constructed:depression-traffic-within-C", source_locators: ["constructed supplied wrong stage"] }]; }],
    ["declared action family", v => { row(v, "across-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:depression-traffic-across-B"; }],
    ["known supplied external IP address a", v => { row(v, "category-A").sampled_observation_references![1]!.sampled_observation_reference = "constructed:depression-traffic-lookup-C"; }],
    ["known supplied category", v => { quantity(v, "category-merged", "category", '"game"'); }],
    ["known supplied category", v => { row(v, "category-merged").quantities = []; quantity(v, "category-C", "category", '"game"'); }],
    ["known supplied external IP address a", v => { row(v, "within-A").quantities = []; row(v, "within-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:depression-traffic-bin-C"; }],
    ["reconstruction stages", v => { row(v, "within-A").quantities = []; row(v, "within-A").sampled_observation_references!.push({ relationship_label: "within-IP member", sampled_observation_reference: "constructed:depression-traffic-within-C", source_locators: ["constructed supplied mixed stages"] }); }],
    ["on/off-period memberships", v => { row(v, "off").sampled_observation_references = [{ relationship_label: "merged usage session", sampled_observation_reference: "constructed:depression-traffic-across-A", source_locators: ["constructed supplied wrong period"] }]; }],
    ["independent PHQ completions", v => { row(v, "features.aggregate_usage-A").sampled_observation_references![0]!.sampled_observation_reference = "constructed:depression-traffic-window-B"; }],
    ["feature combination", v => { quantity(v, "predicted-class-A", "feature combination", '"category"'); }],
    ["independent PHQ completions", v => { delete row(v, "predicted-PHQ-A").task_occurrence_reference; row(v, "predicted-PHQ-A").sampled_observation_references![1]!.sampled_observation_reference = "constructed:depression-traffic-features.category_usage-B"; }],
    ["matching task", v => { row(v, "window-A").task_occurrence_reference = "missing"; }],
    ["PHQ-9 completion", v => { v.task_occurrences[0]!.task_questionnaire_responses = []; v.task_occurrences[0]!.criterion_assessments = []; }],
    ["cannot assign this traffic observation", v => { row(v, "packet-0").task_occurrence_reference = v.task_occurrences[0]!.task_occurrence_id; }],
    ["compatible, distinct sampled observation", v => { row(v, "bin-A").sampled_observation_references![0]!.sampled_observation_reference = row(v, "bin-A").sampled_observation_id; }],
    ["duplicates a sampled-observation relationship", v => { row(v, "bin-A").sampled_observation_references!.push(structuredClone(row(v, "bin-A").sampled_observation_references![0]!)); }],
    ["compatible, distinct sampled observation", v => { row(v, "decision-0").participant_id = "foreign-user"; }],
    ["compatible, distinct sampled observation", v => { row(v, "screen-0").device_id = "foreign-phone"; }],
    ["scalar number, text or null", v => { quantity(v, "packet-0", "source IP address", "{}"); }],
    ["disclosed categorical state", v => { quantity(v, "screen-0", "screen event", '"ON_LOCKED"'); }],
    ["scalar number, text or null", v => { quantity(v, "designation-0", "identified keep-alive", "{}"); }],
    ["evidence_unit must be bytes", v => { row(v, "packet-0").quantities!.find(q => q.observed_property === "payload size bytes")!.evidence_unit = "packets"; }],
    ["source_event_time_token must be a string or null", v => { Reflect.set(row(v, "screen-0"), "source_event_time_token", 0); }],
  ];
  for (const [message, mutation] of cases) {
    const invalid = structuredClone(source); mutation(invalid);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(message);
    expect(await loadResearchMethodSelection()).toBe(prior); // Failed parsing never writes the retained selection.
  }
});
itWithPrivateCorpus("rejects depression-traffic foreign-source transplants and mutated companion definitions independently", () => {
  const input = depressionTrafficInput();
  const foreign = structuredClone(input), foreignWork = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.source_work_id = foreignWork;
  foreign.profiles[0]!.method_settings.forEach(setting => { setting.source_work_id = foreignWork; });
  foreign.sampled_quantity_observations.forEach(row => { row.source_work_id = foreignWork; delete row.sampled_observation_references; delete row.task_occurrence_reference; });
  foreign.task_occurrences = [];
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow("sampled-quantity definition");
  for (const [root, companion] of [
    ["schema.aggregated_application_session", "aggregation.packet_bin_width"],
    ["schema.aggregated_application_session", "aggregation.packet_bin_grouping"],
    ["category.first_match_policy", "category.ordered_keyword_taxonomy"],
    ["features.aggregate_usage", "aggregation.dayparts"],
    ["aggregation.phq9_feature_window", "analysis.history_window_sweep"],
    ["analysis.regression_models", "analysis.feature_family_combinations"],
  ] as const) {
    const invalid = structuredClone(input), setting = invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === root)!;
    invalid.sampled_quantity_observations = invalid.sampled_quantity_observations.filter(r => r.method_setting_reference === setting.method_setting_id);
    invalid.sampled_quantity_observations.forEach(row => { delete row.sampled_observation_references; delete row.task_occurrence_reference; });
    invalid.task_occurrences = [];
    expect(() => parseStudyMethodProfileLibrary(invalid)).not.toThrow();
    invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === companion)!.method_value_json = "{}";
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("sampled-quantity definition");
  }
});

itWithPrivateCorpus.each(["collector.android_screen_events", "schema.packet_tuple", "category.dbip_lookup"] as const)("rejects null/empty sampled references on unsupported depression-traffic raw %s", key => {
  const input = depressionTrafficInput(), id = input.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!.method_setting_id;
  input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === id);
  input.task_occurrences = [];
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  for (const refs of [null, []] as const) {
    const invalid = structuredClone(input);
    invalid.sampled_quantity_observations[0]!.sampled_observation_references = refs === null ? null : [];
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("is incompatible with this observation definition");
  }
});

function mercatiInput() {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === "source-ref:22c0acbc687e7ae7f40e")!);
  return { profiles: [profile], sampled_quantity_observations: mercatiGovernorObservationExample(profile) };
}
const mercatiRow = (input: ReturnType<typeof mercatiInput>, suffix: string) =>
  input.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:mercati-" + suffix)!;
const mercatiQuantity = (input: ReturnType<typeof mercatiInput>, suffix: string, property: string) =>
  mercatiRow(input, suffix).quantities!.find(quantity => quantity.observed_property === property)!;
async function persistMercati(input: ReturnType<typeof mercatiInput>) {
  const { profiles, ...records } = parseStudyMethodProfileLibrary(input);
  await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], selectedLevels: {}, ...records }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile; sampled_quantity_observations: typeof records.sampled_quantity_observations };
  expect(saved.profile).toEqual(input.profiles[0]);
  expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], sampled_quantity_observations: saved.sampled_quantity_observations }).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
}
itWithPrivateCorpus.each(["reported.allocation_trace", "reported.experiment_branches"])("admits actual Mercati %s per-core definition, not foreign/body/tuple decoys", key => {
  const input = mercatiInput(), local = (value: typeof input) => value.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === local(input).method_setting_id);
  expect(input.sampled_quantity_observations.length).toBeGreaterThan(0);
  expect(parseStudyMethodProfileLibrary(input).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  const wrapper = JSON.parse(String(local(input).method_value_json)) as Record<string, unknown>, definition = wrapper.definition;
  const bare = structuredClone(input); local(bare).method_value_json = JSON.stringify(definition);
  expect(parseStudyMethodProfileLibrary(bare).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  for (const body of [null, {}, "decoy", { ...wrapper, definition: null }, { ...wrapper, definition: "decoy" },
    { ...wrapper, definition: 0 }, { ...wrapper, source_facing_role: undefined }, { ...wrapper, source_facing_target: null },
    { ...wrapper, source_facing_role: "reported_result" }, { ...wrapper, source_facing_target: "acquired_snapshot" },
    { ...(definition as Record<string, unknown>), source_facing_role: "provenance", source_facing_target: "collector" }]) {
    const invalid = structuredClone(input); local(invalid).method_value_json = JSON.stringify(body);
    expect(() => parseStudyMethodProfileLibrary({ profiles: invalid.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  for (const [field, value] of [["method_setting_role", "analysis"], ["method_target_layer", "raw_record"], ["source_work_id", "doi:foreign"]]) {
    const invalid = structuredClone(input); Reflect.set(local(invalid), field!, value);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow();
  }
  const duplicate = structuredClone(input);
  duplicate.profiles[0]!.method_settings.push({ ...local(duplicate), method_setting_id: "constructed:mercati-duplicate" });
  duplicate.profiles[0]!.method_setting_count = duplicate.profiles[0]!.method_settings.length;
  duplicate.profiles[0]!.method_setting_ids = duplicate.profiles[0]!.method_settings.map(s => s.method_setting_id);
  expect(() => parseStudyMethodProfileLibrary({ profiles: duplicate.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(duplicate)).toThrow("sampled-quantity definition");
  const foreign = structuredClone(input); foreign.profiles[0]!.source_work_id = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = foreign.profiles[0]!.source_work_id; });
  foreign.sampled_quantity_observations.forEach(row => { row.source_work_id = foreign.profiles[0]!.source_work_id; row.participant_id = "constructed:source-context"; });
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow("sampled-quantity definition");
});
itWithPrivateCorpus.each([
  ["reported.allocation_trace", "platform.per_core_operating_points"],
  ["reported.allocation_trace", "intervention.governor_control"],
  ["reported.experiment_branches", "validation.virtual_aging_clock"],
])("requires Mercati %s companion %s without borrowing canonical/source tuple", (root, companion) => {
  const input = mercatiInput(), profile = input.profiles[0]!;
  input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === profile.method_settings.find(s => s.method_parameter_key === root)!.method_setting_id);
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  const local = profile.method_settings.find(s => s.method_parameter_key === companion)!;
  const wrapper = JSON.parse(String(local.method_value_json)) as Record<string, unknown>;
  const bodies: unknown[] = [{ ...wrapper, definition: null }, {}];
  // The virtual clock's source target is study_window, not its canonical model target.
  if (companion === "validation.virtual_aging_clock") bodies.push({ ...wrapper, source_facing_target: local.method_target_layer });
  for (const body of bodies) {
    const invalid = structuredClone(input);
    invalid.profiles[0]!.method_settings.find(s => s.method_parameter_key === companion)!.method_value_json = JSON.stringify(body);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
});
itWithPrivateCorpus("persists Mercati hardware-only core H/L allocations and independent physical/virtual clocks without forced frequency or a participant", async () => {
  const input = mercatiInput(); await persistMercati(input);
  expect(input.profiles[0]!.source_work_id).toBe("source-ref:22c0acbc687e7ae7f40e");
  expect(input.profiles[0]!.method_settings).toHaveLength(15);
  expect(input.sampled_quantity_observations.every(row => !Object.hasOwn(row, "participant_id"))).toBe(true);
  expect(mercatiRow(input, "allocation-1").observed_entity_token).toBe("1");
  expect(mercatiQuantity(input, "allocation-1", "allocated task criticality").evidence_value_json).toBe('"H"');
  expect(mercatiRow(input, "allocation-1").sampled_observation_id).not.toBe(mercatiRow(input, "allocation-equal").sampled_observation_id);
  expect(mercatiRow(input, "allocation-1").quantities).toEqual(mercatiRow(input, "allocation-equal").quantities);
  const changed = structuredClone(input);
  mercatiQuantity(changed, "allocation-1", "allocated task criticality").evidence_value_json = '"L"';
  mercatiQuantity(changed, "trace-4", "virtual time").evidence_value_json = "4.12500";
  await persistMercati(changed);
  expect(mercatiQuantity(changed, "trace-1", "frequency").evidence_value_json).toBe("1670.000");
  expect(mercatiQuantity(changed, "trace-4", "experimental time").evidence_value_json).toBe("200.0000");
  expect(mercatiQuantity(changed, "trace-4", "frequency").evidence_value_json).toBe("380.000");
  const reversed = structuredClone(changed); reversed.sampled_quantity_observations.reverse();
  reversed.sampled_quantity_observations.forEach(row => { row.quantities?.reverse(); });
  await persistMercati(reversed);
  for (const token of [undefined, null, "null", "0.000", '"opaque source clock token"']) {
    const value = structuredClone(input), quantity = mercatiQuantity(value, "allocation-1", "experimental time");
    if (token === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = token;
    await persistMercati(value);
  }
  for (const token of [undefined, null, "null"]) {
    const value = structuredClone(input), quantity = mercatiQuantity(value, "allocation-1", "allocated task criticality");
    if (token === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = token;
    await persistMercati(value);
  }
  for (const token of [undefined, null, []]) {
    const value = structuredClone(input);
    if (token === undefined) delete mercatiRow(value, "allocation-1").quantities; else mercatiRow(value, "allocation-1").quantities = token;
    await persistMercati(value);
  }
  for (const token of [undefined, null]) {
    const value = structuredClone(input);
    if (token === undefined) delete mercatiQuantity(value, "trace-1", "frequency").evidence_unit; else mercatiQuantity(value, "trace-1", "frequency").evidence_unit = token;
    await persistMercati(value);
  }
  const nullContext = structuredClone(input); nullContext.sampled_quantity_observations.forEach(row => { row.participant_id = null; });
  await persistMercati(nullContext);
  const suppliedContext = structuredClone(input); suppliedContext.sampled_quantity_observations.forEach(row => { row.participant_id = "constructed:optional-context"; });
  await persistMercati(suppliedContext);
});
itWithPrivateCorpus("keeps Hush user-owned cpu_core participant required despite Mercati hardware-only compatibility", () => {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/2789168.2790107")!);
  const rows = scalarObservationExample().filter(r => r.source_work_id === profile.source_work_id && r.observed_entity_kind === "cpu_core");
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    const input = { profiles: [profile], sampled_quantity_observations: [row] };
    expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
    for (const token of [undefined, null]) {
      const invalid = structuredClone(input);
      if (token === undefined) delete invalid.sampled_quantity_observations[0]!.participant_id;
      else invalid.sampled_quantity_observations[0]!.participant_id = token;
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("participant_id");
    }
  }
});
itWithPrivateCorpus("rejects Mercati process/session/PID conflation, idle allocation, wrong clocks and unbound owners before replacement", async () => {
  const input = mercatiInput(); await persistMercati(input); const prior = await loadResearchMethodSelection();
  const mutations: Array<(value: typeof input) => void> = [
    v => { mercatiRow(v, "allocation-1").observed_entity_kind = "process"; },
    v => { delete mercatiRow(v, "allocation-1").device_id; },
    v => { mercatiRow(v, "allocation-1").device_id = null; },
    v => { delete mercatiRow(v, "allocation-1").observed_entity_token; },
    v => { mercatiRow(v, "allocation-1").observed_entity_token = " "; },
    v => { mercatiRow(v, "allocation-1").participant_id = " "; },
    v => { mercatiQuantity(v, "allocation-1", "allocated task criticality").evidence_value_json = '"Idle"'; },
    v => { mercatiQuantity(v, "allocation-1", "allocated task criticality").evidence_value_json = "1"; },
    v => { mercatiQuantity(v, "allocation-1", "allocated task criticality").observed_property = "PID"; },
    v => { mercatiQuantity(v, "allocation-1", "experimental time").evidence_unit = "years"; },
    v => { mercatiQuantity(v, "trace-4", "virtual time").evidence_unit = "seconds"; },
    v => { mercatiQuantity(v, "trace-4", "reliability").evidence_unit = "percent"; },
    v => { mercatiQuantity(v, "trace-4", "frequency").evidence_unit = "GHz"; },
    v => { mercatiQuantity(v, "trace-1", "frequency context").evidence_value_json = '"foreground"'; },
    v => { mercatiQuantity(v, "trace-1", "frequency").evidence_value_json = "{}"; },
    v => { mercatiQuantity(v, "trace-1", "frequency").evidence_value_json = "1e400"; },
    v => { mercatiRow(v, "allocation-1").quantities!.push(structuredClone(mercatiQuantity(v, "allocation-1", "allocated task criticality"))); },
    v => { mercatiRow(v, "allocation-1").sampled_observation_references = null; },
    v => { Reflect.set(mercatiRow(v, "allocation-1"), "entity_members", []); },
    v => { Reflect.set(mercatiRow(v, "allocation-1"), "referenced_day_token", "invented-day"); },
    v => { mercatiRow(v, "allocation-next").sampled_observation_id = mercatiRow(v, "allocation-1").sampled_observation_id; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(input); mutate(invalid);
    await expect(persistMercati(invalid)).rejects.toThrow(); expect(await loadResearchMethodSelection()).toBe(prior);
  }
  const cleared = parseStudyMethodProfileLibrary({ profiles: input.profiles, sampled_quantity_observations: [] });
  await saveResearchMethodSelection(JSON.stringify({ profile: cleared.profiles[0], selectedLevels: {}, sampled_quantity_observations: cleared.sampled_quantity_observations }));
  expect((JSON.parse((await loadResearchMethodSelection())!) as { sampled_quantity_observations: unknown }).sampled_quantity_observations).toEqual([]);
  expect(Object.hasOwn(parseStudyMethodProfileLibrary({ profiles: input.profiles }), "sampled_quantity_observations")).toBe(false);
});
itWithPrivateCorpus("preserves Mercati hardware core records through existing generated JSON Schema/Pydantic", () => {
  const input = mercatiInput(), schemaPath = resolve(import.meta.dirname, "../../schema/generated/json-schema/chronicle-research-ontology.schema.json");
  const pydanticPath = resolve(import.meta.dirname, "../../schema/generated/pydantic");
  const script = [
    "import json,sys", "from jsonschema import Draft202012Validator", "sys.path.insert(0,sys.argv[2])",
    "import chronicle_research_ontology as model", "schema=json.load(open(sys.argv[1])); data=json.load(sys.stdin)",
    "validator=Draft202012Validator({'$ref':'#/$defs/SampledQuantityObservationRecord','$defs':schema['$defs']})",
    "for row in data['sampled_quantity_observations']:",
    " validator.validate(row)", " assert model.SampledQuantityObservationRecord(**row).model_dump(exclude_unset=True)==row",
    " assert 'participant_id' not in row",
    " assert not validator.is_valid(dict(row,invented_field=True))",
    "print('Mercati-shapes-preserved')",
  ].join("\n");
  expect(execFileSync("uvx", ["--from", "linkml==1.10.0", "--with", "jsonschema", "python", "-c", script, schemaPath, pydanticPath], {
    input: JSON.stringify(input), encoding: "utf8", timeout: 180_000,
  }).trim()).toBe("Mercati-shapes-preserved");
});

itWithPrivateCorpus("rejects depression-traffic model PHQ contradictions through explicit feature windows without immediate feature task refs", () => {
  const source = depressionTrafficInput();
  const row = (input: typeof source, id: string) => input.sampled_quantity_observations.find(record => record.sampled_observation_id === "constructed:depression-traffic-" + id)!;
  delete row(source, "features.aggregate_usage-A").task_occurrence_reference;
  delete row(source, "features.category_usage-A").task_occurrence_reference;
  expect(() => parseStudyMethodProfileLibrary(source)).not.toThrow();
  const invalid = structuredClone(source);
  row(invalid, "predicted-PHQ-A").task_occurrence_reference = "constructed:depression-traffic-PHQ-B";
  invalid.sampled_quantity_observations.reverse(); // Referencing models precede their input features and windows.
  expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("independent PHQ completions");
  const unknownWindow = structuredClone(invalid);
  delete row(unknownWindow, "window-A").task_occurrence_reference;
  expect(() => parseStudyMethodProfileLibrary(unknownWindow)).not.toThrow(); // IDs and time tokens do not imply a completion.
});

itWithPrivateCorpus("rejects depression-traffic known model/window devices bridged by an unknown feature device", () => {
  const input = depressionTrafficInput();
  const row = (id: string) => input.sampled_quantity_observations.find(record => record.sampled_observation_id === "constructed:depression-traffic-" + id)!;
  const model = row("predicted-PHQ-A"), feature = row("features.aggregate_usage-A"), window = row("window-A");
  input.sampled_quantity_observations = [model, feature, window];
  model.sampled_observation_references = model.sampled_observation_references!.slice(0, 1);
  feature.device_id = null;
  delete feature.task_occurrence_reference;
  delete window.task_occurrence_reference;
  window.sampled_observation_references = [];
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  window.device_id = "constructed:other-phone";
  expect(() => parseStudyMethodProfileLibrary(input)).toThrow("known PHQ window device");
  window.device_id = null;
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
});

itWithPrivateCorpus.each([
  ["screen-original", "screen-on duration"], ["screen-effective", "retained screen-on duration"],
  ["screen-effective", "remaining screen-off duration"], ["within-A", "duration"],
  ["across-A", "duration"], ["on-A", "duration"], ["off", "duration"], ["category-merged", "duration"],
] as const)("rejects negative numeric depression-traffic duration %s/%s while preserving lexical and unknown values", (id, property) => {
  const source = depressionTrafficInput();
  const quantity = (input: typeof source) => input.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:depression-traffic-" + id)!.quantities!.find(value => value.observed_property === property)!;
  for (const value of ["-1", "-0.5"]) {
    const invalid = structuredClone(source);
    quantity(invalid).evidence_value_json = value;
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("negative supplied duration");
  }
  for (const value of [undefined, null, "null", '"-1.00"', "0", "0.5"] as const) {
    const valid = structuredClone(source);
    if (value === undefined) delete quantity(valid).evidence_value_json;
    else quantity(valid).evidence_value_json = value;
    expect(parseStudyMethodProfileLibrary(valid).sampled_quantity_observations).toEqual(valid.sampled_quantity_observations);
  }
});

itWithPrivateCorpus.each([["packet-0", "payload size bytes"], ["bin-A", "sum of payload sizes s"]] as const)("rejects negative or fractional numeric depression-traffic bytes %s/%s without coercing lexical values", (id, property) => {
  const source = depressionTrafficInput();
  const quantity = (input: typeof source) => input.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:depression-traffic-" + id)!.quantities!.find(value => value.observed_property === property)!;
  for (const value of ["-1", "0.5", "-0.5"]) {
    const invalid = structuredClone(source);
    quantity(invalid).evidence_value_json = value;
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("nonnegative integer supplied payload-byte count");
  }
  for (const value of [undefined, null, "null", '"-1"', '"0.5"', "0", "1"] as const) {
    const valid = structuredClone(source);
    if (value === undefined) delete quantity(valid).evidence_value_json;
    else quantity(valid).evidence_value_json = value;
    expect(parseStudyMethodProfileLibrary(valid).sampled_quantity_observations).toEqual(valid.sampled_quantity_observations);
  }
});

function signalPowerInput() {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/2465529.2466586")!);
  return { profiles: [profile], sampled_quantity_observations: signalPowerObservationExample(profile) };
}
const signalPowerRoots = ["trace.collector","trace.cellular_rssi","trace.wifi_rssi","trace.operator","trace.bytes","trace.location","trace.screen_state","trace.battery_level","trace.network_poll","trace.active_use","trace.traffic_class_proxy","trace.within_bin_allocation","trace.location_cycle","experiment.powermeter","wifi.link_capture","wifi.synchronization","wifi.frame_classification","wifi.frame_duration","wifi.frame_interval","wifi.energy_categories","wifi.scan_behavior","wifi.power_fit","g3.packet_capture","g3.synchronization","g3.state_replay","g3.energy_categories","g3.power_fit","systemcall.required_logs","systemcall.window_estimation","systemcall.window_duration","systemcall.window_power","systemcall.idle_tail","systemcall.concurrent.final_tail","systemcall.concurrent.windows","validation.workload_capture","validation.reference","whatif.flow_size","whatif.flow_start","whatif.rtt.wifi","whatif.rtt.3g","whatif.background_assignment","whatif.delay_rule","whatif.energy_comparison","wifi.rssi_logging","g3.rssi_logging"] as const;
const signalPowerRow = (input: ReturnType<typeof signalPowerInput>, key: string) =>
  input.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:signal-power-" + key)!;
const signalPowerQuantity = (input: ReturnType<typeof signalPowerInput>, key: string, property: string) =>
  signalPowerRow(input, key).quantities!.find(quantity => quantity.observed_property === property)!;
itWithPrivateCorpus("preserves an explicitly unknown signal-power synchronization support without inventing its nested frame", () => {
  const partial = signalPowerInput(); signalPowerRow(partial, "wifi.synchronization").sampled_observation_references![0]!.sampled_observation_reference = null;
  expect(parseStudyMethodProfileLibrary(partial).sampled_quantity_observations).toEqual(partial.sampled_quantity_observations);
});
async function persistSignalPower(input: ReturnType<typeof signalPowerInput>) {
  const parsed = parseStudyMethodProfileLibrary(input), { profiles, ...records } = parsed;
  await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], selectedLevels: {}, ...records }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile } & typeof records;
  const { profile, selectedLevels, ...savedRecords } = saved as typeof saved & { selectedLevels: unknown };
  expect(selectedLevels).toEqual({});
  expect(parseStudyMethodProfileLibrary({ profiles: [profile], ...savedRecords })).toEqual(parsed);
  return parsed;
}
itWithPrivateCorpus.each(signalPowerRoots)("accepts signal-power %s independently only with its source-exact body and tuple", key => {
  const source = signalPowerInput(), local = (input: typeof source) => input.profiles[0]!.method_settings.find(setting => setting.method_parameter_key === key)!;
  const input = structuredClone(source);
  input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === local(input).method_setting_id);
  for (const row of input.sampled_quantity_observations) delete row.sampled_observation_references;
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  const setting = local(input), value: unknown = JSON.parse(String(setting.method_value_json));
  const definition = value !== null && typeof value === "object" && Object.hasOwn(value, "definition") ? (value as { definition: unknown }).definition : value;
  const wrapped = structuredClone(input);
  local(wrapped).method_value_json = JSON.stringify({ definition, source_facing_role: setting.method_setting_role, source_facing_target: setting.method_target_layer });
  expect(() => parseStudyMethodProfileLibrary(wrapped)).not.toThrow();
  const variants = [
    (wrong: typeof input) => { local(wrong).method_value_json = JSON.stringify("invented source definition"); },
    (wrong: typeof input) => { local(wrong).method_setting_role = setting.method_setting_role === "analysis" ? "acquisition" : "analysis"; },
    (wrong: typeof input) => { local(wrong).method_target_layer = setting.method_target_layer === "model" ? "raw_record" : "model"; },
    (wrong: typeof input) => { local(wrong).method_value_json = JSON.stringify({ definition, source_facing_role: "quality_control", source_facing_target: "participant_day" }); },
    (wrong: typeof input) => {
      const profile = wrong.profiles[0]!;
      profile.method_settings.push({ ...local(wrong), method_setting_id: "constructed:signal-power-duplicate-definition" });
      profile.method_setting_count = profile.method_settings.length;
      profile.method_setting_ids = profile.method_settings.map(setting => setting.method_setting_id);
    },
  ];
  for (const mutate of variants) {
    const wrong = structuredClone(input); mutate(wrong);
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(/source-facing|role\/target|sampled-quantity definition/);
  }
  // A real foreign profile is valid by itself; transplanting a known signal key cannot enter a generic fallback.
  const foreign = structuredClone(canonical().profiles.find(profile => profile.source_work_id === "doi:10.1145/2858036.2858267")!);
  const foreignSetting = { ...setting, source_work_id: foreign.source_work_id };
  foreign.method_settings.push(foreignSetting);
  foreign.method_setting_count = foreign.method_settings.length;
  foreign.method_setting_ids = foreign.method_settings.map(setting => setting.method_setting_id);
  expect(() => parseStudyMethodProfileLibrary({ profiles: [foreign] })).not.toThrow();
  const transplanted = structuredClone(input);
  transplanted.profiles = [foreign];
  for (const row of transplanted.sampled_quantity_observations) {
    row.method_profile_id = foreign.method_profile_id; row.source_work_id = foreign.source_work_id; row.participant_id = "constructed:foreign-person";
  }
  expect(() => parseStudyMethodProfileLibrary(transplanted)).toThrow(/sampled-quantity definition/);
});
itWithPrivateCorpus.each(["trace.rssi_trigger", "trace.network_poll", "whatif.max_delay.2h", "whatif.max_delay.12h", "whatif.threshold.wifi", "whatif.threshold.3g"] as const)(
  "rejects signal-power companion %s drift at its owning observation", key => {
    const input = signalPowerInput(), setting = input.profiles[0]!.method_settings.find(local => local.method_parameter_key === key)!;
    setting.method_value_json = JSON.stringify("invented companion");
    expect(() => parseStudyMethodProfileLibrary(input)).toThrow(/sampled-quantity definition/);
  });
itWithPrivateCorpus("preserves the complete signal-power source-shaped families through actual import/save/reload without running a model", async () => {
  const input = signalPowerInput(), profile = input.profiles[0]!;
  expect(new Set(input.sampled_quantity_observations.map(row => profile.method_settings.find(setting => setting.method_setting_id === row.method_setting_reference)!.method_parameter_key)))
    .toEqual(new Set(signalPowerRoots));
  expect(input.sampled_quantity_observations).toHaveLength(63);
  expect(profile.method_settings).toHaveLength(117);
  const audit = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/source-completeness-audits/doi-10.1145-2465529.2466586.json"), "utf8")) as { disclosed_atoms: unknown[]; configuration_topology: { source_configuration_count: number } };
  expect(audit.disclosed_atoms).toHaveLength(120);
  expect(audit.configuration_topology.source_configuration_count).toBe(13);
  const body = JSON.parse(String(profile.method_settings.find(setting => setting.method_parameter_key === "trace.location_cycle")!.method_value_json)) as Record<string, unknown>;
  const location = (body.definition ?? body) as Record<string, unknown>;
  expect(location.figure7_dimensions).toEqual({
    location_views: ["all", "1", "2", "3"], hour_of_day_labels: Array.from({ length: 24 }, (_, hour) => hour),
    rssi_bin_labels: ["< -105 dBm", "-105 to -96 dBm", "-95 to -86 dBm", "-85 to -76 dBm", "-75 to -66 dBm", "-65 to -56 dBm", "> -56 dBm"],
    displayed_statistic: "frequency", frequency_denominator: null, bin_edge_inclusion_and_rssi_rounding: null,
  });
  const technologies = input.sampled_quantity_observations.filter(row => row.method_setting_reference === profile.method_settings.find(setting => setting.method_parameter_key === "trace.collector")!.method_setting_id);
  expect(new Set(technologies.map(row => JSON.parse(row.quantities![0]!.evidence_value_json!) as unknown))).toEqual(new Set(["None", "GPRS", "EDGE", "UMTS", "HSPA", "LTE", "WiFi"]));
  expect(signalPowerRow(input, "wifi.link_capture").source_event_time_token).not.toBe(signalPowerRow(input, "wifi.link_capture").observation_instant);
  expect(signalPowerRow(input, "systemcall.required_logs").observed_entity_kind).toBe("process");
  expect(signalPowerRow(input, "trace.battery_level").quantities![0]).not.toHaveProperty("evidence_unit");
  expect(signalPowerQuantity(input, "wifi.scan_behavior", "scan duration").evidence_value_json).toBe("1000.5"); // Reported typical range is not an absolute limit.
  expect(signalPowerRow(input, "wifi.power_fit").sampled_observation_references!.at(-1)!.sampled_observation_reference).toBe("constructed:signal-power-wifi.rssi_logging");
  expect(signalPowerRow(input, "g3.power_fit").sampled_observation_references!.at(-1)!.sampled_observation_reference).toBe("constructed:signal-power-g3.rssi_logging");
  const parsed = await persistSignalPower(input);
  expect(parsed.sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  const independent = structuredClone(input);
  signalPowerQuantity(independent, "wifi.frame_interval", "Tx/Rx energy").evidence_value_json = "123.000";
  signalPowerQuantity(independent, "systemcall.window_estimation", "TCP-window count").evidence_value_json = "7";
  expect(() => parseStudyMethodProfileLibrary(independent)).not.toThrow(); // No recomputation, sum or AIMD certification.
  expect(signalPowerQuantity(independent, "wifi.energy_categories", "ReTx ACK")).toEqual(signalPowerQuantity(input, "wifi.energy_categories", "ReTx ACK"));
});
itWithPrivateCorpus("preserves signal-power omitted/null/empty channels and explicit unknown values/units without creating hardware participants", () => {
  const source = signalPowerInput();
  for (const token of [undefined, null, "null"] as const) {
    const input = structuredClone(source), quantity = signalPowerQuantity(input, "experiment.powermeter", "reported current");
    if (token === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = token;
    const frame = signalPowerRow(input, "wifi.link_capture");
    if (token === undefined) { delete frame.observation_instant; delete frame.source_event_time_token; delete quantity.evidence_unit; }
    else if (token === null) { frame.observation_instant = null; frame.source_event_time_token = null; quantity.evidence_unit = null; }
    expect(parseStudyMethodProfileLibrary(input).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  }
  for (const token of [undefined, null, []] as const) {
    const input = structuredClone(source), row = signalPowerRow(input, "validation.reference");
    if (token === undefined) delete row.sampled_observation_references; else row.sampled_observation_references = token === null ? null : [];
    const quantityOwner = signalPowerRow(input, "wifi.synchronization");
    if (token === undefined) delete quantityOwner.quantities; else quantityOwner.quantities = token === null ? null : [];
    expect(parseStudyMethodProfileLibrary(input).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  }
  const hardware = structuredClone(source);
  signalPowerRow(hardware, "wifi.frame_interval").participant_id = null;
  delete signalPowerRow(hardware, "wifi.frame_classification").participant_id;
  expect(() => parseStudyMethodProfileLibrary(hardware)).not.toThrow();
  signalPowerQuantity(hardware, "wifi.frame_duration", "frame duration").evidence_value_json = '"unknown lexical duration"';
  expect(() => parseStudyMethodProfileLibrary(hardware)).not.toThrow();
});
itWithPrivateCorpus("rejects signal-power known owner, technology, proxy and physical contradictions before replacing saved records", async () => {
  const source = signalPowerInput(); await persistSignalPower(source); const prior = await loadResearchMethodSelection();
  const mutations: Array<[RegExp, (input: typeof source) => void]> = [
    [/requires a supplied device owner/, input => { delete signalPowerRow(input, "experiment.powermeter").device_id; }],
    [/requires a supplied device owner/, input => { signalPowerRow(input, "systemcall.required_logs").device_id = null; }],
    [/participant_id/, input => { delete signalPowerRow(input, "trace.cellular_rssi").participant_id; }],
    [/participant_id/, input => { signalPowerRow(input, "whatif.flow_size").participant_id = null; }],
    [/participant_id/, input => { signalPowerRow(input, "wifi.frame_interval").participant_id = " "; }],
    [/observed_entity_kind/, input => { signalPowerRow(input, "systemcall.required_logs").observed_entity_kind = "android_uid"; signalPowerRow(input, "systemcall.required_logs").participant_id = "constructed:person"; }],
    [/known supplied technology/, input => { signalPowerQuantity(input, "systemcall.window_power", "technology").evidence_value_json = '"3G"'; }],
    [/known screen-state proxy/, input => { signalPowerQuantity(input, "trace.active_use", "active device usage").evidence_value_json = "false"; }],
    [/known screen-state proxy/, input => { signalPowerQuantity(input, "trace.traffic_class_proxy", "traffic class").evidence_value_json = '"solely non-interactive background"'; }],
    [/supplied boolean/, input => { signalPowerQuantity(input, "whatif.background_assignment", "background flow").evidence_value_json = "0"; }],
    [/known foreground synthetic flow/, input => { signalPowerQuantity(input, "delay-B", "supplied delay").evidence_value_json = "0.50"; }],
    [/strict below-start/, input => { signalPowerQuantity(input, "WiFi-at-start", "Wi-Fi RSSI").evidence_value_json = "-80"; }],
    [/strict below-start/, input => { signalPowerQuantity(input, "WiFi-crossing", "Wi-Fi RSSI").evidence_value_json = "-80"; }],
    [/final-tail members/, input => { signalPowerRow(input, "systemcall.concurrent.final_tail").sampled_observation_references![0]!.sampled_observation_reference = "constructed:signal-power-inter-window-idle"; }],
    [/independent synthetic flows/, input => { signalPowerRow(input, "whatif.delay_rule").sampled_observation_references![1]!.sampled_observation_reference = "constructed:signal-power-start-B"; }],
    [/negative supplied physical quantity/, input => { signalPowerQuantity(input, "experiment.powermeter", "reported current").evidence_value_json = "-1"; }],
    [/integer supplied count/, input => { signalPowerQuantity(input, "trace.bytes", "bytes transferred").evidence_value_json = "1.5"; }],
    [/hour from 0 through 23/, input => { signalPowerQuantity(input, "trace.location_cycle", "hour of day").evidence_value_json = "24"; }],
    [/synthetic RTT range/, input => { signalPowerQuantity(input, "whatif.rtt.wifi", "synthetic RTT").evidence_value_json = "4.99"; }],
    [/synthetic RTT range/, input => { signalPowerQuantity(input, "whatif.rtt.3g", "synthetic RTT").evidence_value_json = "700.01"; }],
    [/maximum-delay configurations/, input => { signalPowerQuantity(input, "whatif.delay_rule", "maximum delay hours").evidence_value_json = "3"; }],
    [/exceeds its supplied maximum/, input => { signalPowerQuantity(input, "whatif.delay_rule", "supplied delay").evidence_value_json = "2.01"; }],
    [/evidence_unit disagrees/, input => { signalPowerQuantity(input, "trace.battery_level", "battery level").evidence_unit = "percent"; }],
    [/evidence_unit disagrees/, input => { signalPowerQuantity(input, "wifi.frame_interval", "Tx/Rx energy").evidence_unit = "joules"; }],
    [/observed_property/, input => { signalPowerRow(input, "wifi.energy_categories").quantities!.push(structuredClone(signalPowerQuantity(input, "wifi.energy_categories", "Idle"))); }],
    [/scalar number, text or null/, input => { signalPowerQuantity(input, "g3.packet_capture", "packet designation").evidence_value_json = "{}"; }],
    [/invalid numeric value/, input => { signalPowerQuantity(input, "experiment.powermeter", "reported current").evidence_value_json = "1e999"; }],
    [/compatible, distinct sampled observation/, input => { signalPowerRow(input, "wifi.synchronization").sampled_observation_references![0]!.sampled_observation_reference = "constructed:signal-power-g3.packet_capture"; }],
    [/compatible, distinct sampled observation/, input => { signalPowerRow(input, "wifi.link_capture").device_id = "constructed:other-lab-device"; }],
    [/compatible, distinct sampled observation/, input => { signalPowerRow(input, "trace.bytes").participant_id = "constructed:other-volunteer"; }],
    [/duplicates a sampled-observation relationship/, input => { const links = signalPowerRow(input, "validation.reference").sampled_observation_references!; links.push(structuredClone(links[0]!)); }],
    [/incompatible with this observation definition/, input => { signalPowerRow(input, "trace.battery_level").sampled_observation_references = null; }],
    [/incompatible with this observation definition/, input => { signalPowerRow(input, "wifi.rssi_logging").sampled_observation_references = []; }],
  ];
  for (const [message, mutate] of mutations) {
    const wrong = structuredClone(source); mutate(wrong);
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(message);
    expect(await loadResearchMethodSelection()).toBe(prior);
  }
});
itWithPrivateCorpus("rejects known signal-power end-owner conflicts through explicit unknown-context supports without inferring them", () => {
  const source = signalPowerInput(), participant = structuredClone(source);
  const root = signalPowerRow(participant, "wifi.frame_interval"), middle = signalPowerRow(participant, "wifi.frame_classification"), leaf = signalPowerRow(participant, "wifi.link_capture");
  root.participant_id = "constructed:assessed-person-A"; middle.participant_id = null; leaf.participant_id = "constructed:assessed-person-B";
  root.sampled_observation_references = root.sampled_observation_references!.filter(link => link.relationship_label === "frame class");
  expect(() => parseStudyMethodProfileLibrary(participant)).toThrow(/known participant owners/);
  leaf.participant_id = root.participant_id;
  expect(() => parseStudyMethodProfileLibrary(participant)).not.toThrow();
  const longChain = structuredClone(source);
  signalPowerRow(longChain, "validation.reference").participant_id = "constructed:person-A";
  signalPowerRow(longChain, "systemcall.required_logs").participant_id = "constructed:person-B";
  expect(() => parseStudyMethodProfileLibrary(longChain)).toThrow(/known participant owners/);
  signalPowerRow(longChain, "systemcall.required_logs").participant_id = "constructed:person-A";
  expect(() => parseStudyMethodProfileLibrary(longChain)).not.toThrow(); // Explicit validation→power→duration→window→call chain, unknown middle context.
  const devices = structuredClone(source);
  delete signalPowerRow(devices, "trace.network_poll").device_id;
  signalPowerRow(devices, "trace.bytes").device_id = "constructed:other-volunteer-phone";
  expect(() => parseStudyMethodProfileLibrary(devices)).toThrow(/known device owners/);
  const ambiguous = structuredClone(source), duplicate = structuredClone(signalPowerRow(ambiguous, "trace.cellular_rssi"));
  delete signalPowerRow(ambiguous, "trace.within_bin_allocation").device_id;
  duplicate.device_id = "constructed:another-phone"; ambiguous.sampled_quantity_observations.push(duplicate);
  expect(() => parseStudyMethodProfileLibrary(ambiguous)).toThrow(/unambiguously/);
});
itWithPrivateCorpus("rejects signal-power conflicting supplied flow supports even without a direct flow reference", () => {
  const input = signalPowerInput();
  input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.sampled_observation_id !== "constructed:signal-power-trace.location_cycle");
  const delay = signalPowerRow(input, "whatif.delay_rule");
  delay.sampled_observation_references = delay.sampled_observation_references!.filter(link => link.relationship_label !== "synthetic flow");
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  const background = structuredClone(signalPowerRow(input, "whatif.background_assignment"));
  background.sampled_observation_id = "constructed:signal-power-background-other-flow";
  background.sampled_observation_references![0]!.sampled_observation_reference = "constructed:signal-power-flow-B";
  input.sampled_quantity_observations.push(background);
  delay.sampled_observation_references.find(link => link.relationship_label === "background designation")!.sampled_observation_reference = background.sampled_observation_id;
  expect(() => parseStudyMethodProfileLibrary(input)).toThrow(/independent synthetic flows/);
});

itWithPrivateCorpus("preserves signal-power hardware context and raw event/collection tokens through generated descriptive models", () => {
  const input = signalPowerInput(), schemaPath = resolve(import.meta.dirname, "../../schema/generated/json-schema/chronicle-research-ontology.schema.json");
  const pydanticPath = resolve(import.meta.dirname, "../../schema/generated/pydantic");
  const script = [
    "import json,sys", "from jsonschema import Draft202012Validator", "sys.path.insert(0,sys.argv[2])",
    "import chronicle_research_ontology as model", "schema=json.load(open(sys.argv[1])); data=json.load(sys.stdin)",
    "validator=Draft202012Validator({'$ref':'#/$defs/SampledQuantityObservationRecord','$defs':schema['$defs']})",
    "for row in data['sampled_quantity_observations']:",
    " validator.validate(row)",
    " assert model.SampledQuantityObservationRecord(**row).model_dump(exclude_unset=True)==row",
    " assert not validator.is_valid(dict(row,invented_field=True))",
    "print('signal-power-shapes-preserved')",
  ].join("\n");
  expect(execFileSync("uvx", ["--from", "linkml==1.10.0", "--with", "jsonschema", "python", "-c", script, schemaPath, pydanticPath], {
    input: JSON.stringify(input), encoding: "utf8", timeout: 180_000,
  }).trim()).toBe("signal-power-shapes-preserved");
});

const windowSampleWorks = ["doi:10.3390/s20051396", "doi:10.1016/j.jbi.2019.103151"] as const;
function windowSampleInput(work: string) {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === work)!);
  const rows = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../e2e/fixtures/assessment-window-examples.json.fixture"), "utf8")) as {
    task_occurrences: TaskOccurrenceRecord[]; sampled_quantity_observations: SampledQuantityObservationRecord[];
  };
  return { profiles: [profile], task_occurrences: rows.task_occurrences.filter(r => r.source_work_id === work), sampled_quantity_observations: rows.sampled_quantity_observations.filter(r => r.source_work_id === work) };
}
const windowSampleRoutes = !privateCorpusAvailable ? [] : windowSampleWorks.flatMap(work => {
  const source = windowSampleInput(work);
  return [...new Set(source.sampled_quantity_observations.map(r => r.method_setting_reference))].map(ref => ({ work, ref, key: source.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!.method_parameter_key }));
});
itWithPrivateCorpus("requires actual supplied window-family completions but retains explicitly unknown completion owners", () => {
  const row = (v: ReturnType<typeof windowSampleInput>, id: string) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === id)!;
  const anxiety = windowSampleInput(windowSampleWorks[1]), score = row(anxiety, "example:anxiety-score-a");
  anxiety.task_occurrences.find(t => t.task_occurrence_id === score.task_occurrence_reference)!.task_questionnaire_responses = [];
  expect(() => parseStudyMethodProfileLibrary(anxiety)).toThrow(/actual supplied STAI completion/);
  const source = windowSampleInput(windowSampleWorks[0]);
  const byKey = (v: typeof source, key: string) => v.sampled_quantity_observations.find(r => r.method_setting_reference === v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!.method_setting_id)!;
  const wrongSleep = structuredClone(source); byKey(wrongSleep, "sleep.output").task_occurrence_reference = null;
  expect(() => parseStudyMethodProfileLibrary(wrongSleep)).toThrow(/task_occurrence_reference is incompatible with this supplied source observation/);
  const missingGroup = structuredClone(source), group = byKey(missingGroup, "depression.outcome");
  const task = missingGroup.task_occurrences.find(t => t.task_occurrence_id === group.task_occurrence_reference)!;
  const id = missingGroup.profiles[0]!.method_settings.find(s => s.method_parameter_key === "depression.outcome")!.method_setting_id;
  task.criterion_assessments = task.criterion_assessments!.filter(a => a.criterion_setting_reference !== id);
  expect(() => parseStudyMethodProfileLibrary(missingGroup)).toThrow(/must retain a supplied participant group assessment/);
  const partial = structuredClone(source); byKey(partial, "depression.input.final_vector").task_occurrence_reference = null;
  expect(parseStudyMethodProfileLibrary(partial).sampled_quantity_observations).toEqual(partial.sampled_quantity_observations);
});

itWithPrivateCorpus.each([
  [windowSampleWorks[0], "example:stdd-physical.sensor.step_detector", "step detected", "1", "supplied normalized condition"],
  [windowSampleWorks[0], "example:stdd-social.input.other_social_apps", "app name", "0", "supplied opaque string"],
  [windowSampleWorks[0], "example:stdd-social.input.call_duration", "call duration", "-1", "invalid supplied measurement/count"],
  [windowSampleWorks[1], "example:anxiety-score-a", "STAI state score", "19", "STAI state total in 20–80"],
] as const)("rejects source-specific supplied %s %s %s domain contradictions", (work, id, property, token, message) => {
  const input = windowSampleInput(work);
  input.sampled_quantity_observations.find(r => r.sampled_observation_id === id)!.quantities!.find(q => q.observed_property === property)!.evidence_value_json = token;
  expect(() => parseStudyMethodProfileLibrary(input)).toThrow(message);
});

itWithPrivateCorpus("retains STDD independent one-second channels and rejects contradictory feature values", () => {
  const source = windowSampleInput(windowSampleWorks[0]);
  const window = (v: typeof source, mood = false) => v.task_occurrences[1]!.task_observation_windows![mood ? 1 : 0]!;
  const quantity = (v: typeof source, property: string, mood = false) => window(v, mood).quantities!.find(q => q.observed_property === property)!;
  const cases: Array<[string, (v: typeof source) => void]> = [
    ["compatible source-window quantity", v => { quantity(v, "total number of steps").observed_property = "calculated distance"; }],
    ["phone/watch axis channel", v => { quantity(v, "accelerometer axis features").quantity_qualifier = "phone:w"; }],
    ["duplicates a supplied feature channel", v => { window(v).quantities!.push(structuredClone(window(v).quantities![0]!)); }],
    ["source-window unit", v => { quantity(v, "total number of steps").evidence_unit = "meters"; }],
    ["JSON string or null", v => Reflect.set(quantity(v, "total number of steps"), "evidence_value_json", 2)],
    ["must contain valid JSON", v => { quantity(v, "total number of steps").evidence_value_json = "["; }],
    ["17-feature axis vector", v => { quantity(v, "accelerometer axis features").evidence_value_json = "[0,null]"; }],
    ["17-feature axis vector", v => { quantity(v, "total number of steps").evidence_value_json = "1.5"; }],
    ["17-feature axis vector", v => { quantity(v, "total significant-motion triggers").evidence_value_json = "-1"; }],
    ["17-feature axis vector", v => { quantity(v, "heart-rate mean", true).evidence_value_json = "1e400"; }],
  ];
  for (const [message, mutate] of cases) {
    const invalid = structuredClone(source); mutate(invalid);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(message);
  }
  for (const token of ["null", '"unreported original count"', null, undefined]) {
    const partial = structuredClone(source), q = quantity(partial, "total number of steps");
    if (token === undefined) delete q.evidence_value_json; else q.evidence_value_json = token;
    expect(parseStudyMethodProfileLibrary(partial).task_occurrences).toEqual(partial.task_occurrences);
  }
});
itWithPrivateCorpus.each(windowSampleRoutes)("admits supplied window-family $work $key with exact source/body/tuple ownership", ({ work, ref }) => {
  const source = windowSampleInput(work);
  source.sampled_quantity_observations = source.sampled_quantity_observations.filter(r => r.method_setting_reference === ref);
  source.task_occurrences = [];
  for (const row of source.sampled_quantity_observations) { delete row.sampled_observation_references; delete row.task_occurrence_reference; }
  const local = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!;
  expect(source.sampled_quantity_observations.length).toBeGreaterThan(0);
  expect(parseStudyMethodProfileLibrary(source).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  const body = JSON.parse(String(local(source).method_value_json)) as unknown;
  const role = local(source).method_setting_role, target = local(source).method_target_layer;
  const wrapped = structuredClone(source); local(wrapped).method_value_json = JSON.stringify({ definition: body, source_facing_role: role, source_facing_target: target });
  expect(parseStudyMethodProfileLibrary(wrapped).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  for (const content of [null, {}, { conceptual_observation_roles: ["process/application identity", "bytes sent", "bytes received"] },
    { definition: body, source_facing_role: "invented", source_facing_target: target }, { definition: body, source_facing_role: role, source_facing_target: "invented" }]) {
    const bad = structuredClone(source); local(bad).method_value_json = JSON.stringify(content);
    expect(() => parseStudyMethodProfileLibrary({ profiles: bad.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  for (const [field, value] of [["method_setting_role", "reporting"], ["method_target_layer", target === "outcome" ? "raw_record" : "outcome"], ["source_work_id", "doi:foreign"]] as const) {
    const bad = structuredClone(source); local(bad)[field] = value;
    expect(() => parseStudyMethodProfileLibrary({ profiles: bad.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/local definition role\/target|sampled-quantity definition/);
  }
  const foreign = structuredClone(source); foreign.profiles[0]!.source_work_id = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = foreign.profiles[0]!.source_work_id; });
  foreign.sampled_quantity_observations.forEach(r => { r.source_work_id = foreign.profiles[0]!.source_work_id; });
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow(/local definition role\/target|sampled-quantity definition/);
});
itWithPrivateCorpus("preserves independent Anxiety day-label broadcast and distinct daily completion support without predicting within-day anxiety", () => {
  const source = windowSampleInput(windowSampleWorks[1]);
  const row = (v: typeof source, id: string) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === "example:anxiety-" + id)!;
  const q = (r: SampledQuantityObservationRecord, property: string) => r.quantities!.find(q => q.observed_property === property)!;
  expect(() => parseStudyMethodProfileLibrary(source)).not.toThrow();
  expect(row(source, "window-a1").sampled_observation_references).toEqual(row(source, "window-a2").sampled_observation_references);
  expect(row(source, "label-a").sampled_observation_references!.map(r => r.sampled_observation_reference)).toEqual(["example:anxiety-score-a", "example:anxiety-score-b"]);
  expect(row(source, "label-b").sampled_observation_references).toHaveLength(1); // Unknown next-day score is not fabricated.
  const changed = structuredClone(source); q(row(changed, "score-a"), "STAI state score").evidence_value_json = "55.00";
  q(row(changed, "feature.pattern_all_1"), "feature vector").evidence_value_json = JSON.stringify(Array(20).fill(7.25));
  expect(() => parseStudyMethodProfileLibrary(changed)).not.toThrow();
  expect(row(changed, "label-a")).toEqual(row(source, "label-a")); expect(row(changed, "window-a2")).toEqual(row(source, "window-a2"));
  for (const refs of [undefined, null, []]) {
    const unknown = structuredClone(source), window = row(unknown, "window-a1");
    if (refs === undefined) delete window.sampled_observation_references; else window.sampled_observation_references = refs;
    expect(() => parseStudyMethodProfileLibrary(unknown)).not.toThrow();
  }
  for (const mutate of [
    (v: typeof source) => { row(v, "window-a1").sampled_observation_references![0]!.sampled_observation_reference = "example:anxiety-label-b"; },
    (v: typeof source) => { row(v, "window-a1").sampled_observation_references!.push(structuredClone(row(v, "window-a1").sampled_observation_references![0]!)); },
    (v: typeof source) => { row(v, "label-a").sampled_observation_references![1]!.sampled_observation_reference = "example:anxiety-score-a"; },
    (v: typeof source) => { row(v, "window-a1").sampled_observation_references![0]!.sampled_observation_reference = "example:anxiety-score-a"; },
    (v: typeof source) => { row(v, "label-a").participant_id = "example:other-participant"; },
    (v: typeof source) => { q(row(v, "score-a"), "day token").evidence_value_json = '"example:wrong-completion-day"'; },
    (v: typeof source) => { q(row(v, "label-a"), "next-day label").evidence_value_json = "0"; },
    (v: typeof source) => { q(row(v, "window-a1"), "window duration").evidence_value_json = "45"; },
  ]) { const bad = structuredClone(source); mutate(bad); expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(); }
  const wrongDay = structuredClone(source); row(wrongDay, "window-a1").sampled_observation_references![0]!.sampled_observation_reference = "example:anxiety-label-b";
  expect(() => parseStudyMethodProfileLibrary(wrongDay)).toThrow("feature-day label owner");
});
itWithPrivateCorpus("preserves all eight Anxiety feature shapes and independent raw/category/integral/normalized values", () => {
  const source = windowSampleInput(windowSampleWorks[1]), profile = source.profiles[0]!;
  const dimensions: Record<string, number> = { feature_pattern_environment: 10, feature_pattern_real_world_acceleration: 10, feature_pattern_real_world_orientation: 10, feature_pattern_online_app: 11, feature_pattern_all_1: 20, feature_pattern_all_2: 115, feature_pattern_all_3: 38, feature_pattern_all_4: 14 };
  for (const [name, count] of Object.entries(dimensions)) {
    const key = name.replace("feature_pattern_", "feature.pattern_"), ref = profile.method_settings.find(s => s.method_parameter_key === key)!.method_setting_id;
    const original = source.sampled_quantity_observations.find(r => r.method_setting_reference === ref)!;
    expect(JSON.parse(original.quantities![0]!.evidence_value_json!)).toHaveLength(count);
    const bad = structuredClone(source), row = bad.sampled_quantity_observations.find(r => r.method_setting_reference === ref)!;
    row.quantities![0]!.evidence_value_json = JSON.stringify(Array(count - 1).fill(0));
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow("vector dimension/value");
  }
  const raw = source.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith("acquisition.illuminance_stream"))!;
  for (const value of [undefined, null, "null", "0.00", ' "unknown source value" ']) {
    const changed = structuredClone(source), row = changed.sampled_quantity_observations.find(r => r.sampled_observation_id === raw.sampled_observation_id)!;
    if (value === undefined) delete row.quantities![0]!.evidence_value_json; else row.quantities![0]!.evidence_value_json = value;
    expect(() => parseStudyMethodProfileLibrary(changed)).not.toThrow();
  }
  for (const value of ["{}", "[]", "true"]) {
    const bad = structuredClone(source); bad.sampled_quantity_observations.find(r => r.sampled_observation_id === raw.sampled_observation_id)!.quantities![0]!.evidence_value_json = value;
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow("scalar number, text or null");
  }
  for (const refs of [null, []]) {
    const bad = structuredClone(source); bad.sampled_quantity_observations.find(r => r.sampled_observation_id === raw.sampled_observation_id)!.sampled_observation_references = refs;
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow("incompatible with this observation definition");
  }
  const state = (v: typeof source, key: string, property: string) => v.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith(key))!.quantities!.find(q => q.observed_property === property)!;
  for (const value of ["[0,null,0]", "null"]) {
    const unknown = structuredClone(source); state(unknown, "feature.illuminance_thresholds", "BR state").evidence_value_json = value;
    expect(() => parseStudyMethodProfileLibrary(unknown)).not.toThrow();
  }
  for (const value of ["[0,0,0]", "[1,1,0]"]) {
    const bad = structuredClone(source); state(bad, "feature.illuminance_thresholds", "BR state").evidence_value_json = value;
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow("one-hot state");
  }
  const otherwise = structuredClone(source);
  state(otherwise, "feature.app_categories", "application category").evidence_value_json = '"otherwise"';
  state(otherwise, "feature.app_categories", "APP state").evidence_value_json = "[0,0,0,0]";
  expect(() => parseStudyMethodProfileLibrary(otherwise)).not.toThrow();
  const oldProfile = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/2634317.2634325")!);
  const old = hammerObservationExample(oldProfile);
  expect(() => parseStudyMethodProfileLibrary(old)).not.toThrow(); // Colliding feature.day_of_week remains its existing owner.
});
itWithPrivateCorpus("preserves STDD independent clinical/physical/mood/sleep/social/depression values and exact supplied relationships", () => {
  const source = windowSampleInput(windowSampleWorks[0]);
  const row = (v: typeof source, key: string) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === "example:stdd-" + key)!;
  expect(() => parseStudyMethodProfileLibrary(source)).not.toThrow();
  const moodWindow = source.task_occurrences[1]!.task_observation_windows![1]!;
  expect(source.task_occurrences[1]!.device_id).not.toBe(row(source, "mood.sensor.heart_rate").device_id);
  expect(moodWindow.quantities!.slice(-2).map(q => q.observed_property)).toEqual(["heart-rate mean", "heart-rate standard deviation"]);
  expect(row(source, "depression.input.final_vector-b").sampled_observation_references).toEqual(row(source, "depression.input.final_vector").sampled_observation_references);
  const changed = structuredClone(source); row(changed, "mood.sensor.heart_rate").quantities![0]!.evidence_value_json = "90.00";
  row(changed, "social.output").quantities![0]!.evidence_value_json = "9.50";
  expect(() => parseStudyMethodProfileLibrary(changed)).not.toThrow();
  expect(changed.task_occurrences[1]!.task_observation_windows![1]).toEqual(moodWindow);
  expect(row(changed, "depression.input.final_vector")).toEqual(row(source, "depression.input.final_vector"));
  for (const mutate of [
    (v: typeof source) => { row(v, "depression.outcome").participant_id = "example:foreign-participant"; delete row(v, "depression.outcome").task_occurrence_reference; },
    (v: typeof source) => { row(v, "depression.input.final_vector").task_occurrence_reference = "example:stdd-entry"; },
    (v: typeof source) => { row(v, "depression.input.final_vector").quantities!.at(-1)!.evidence_value_json = "8"; },
    (v: typeof source) => { row(v, "depression.outcome").quantities![0]!.evidence_value_json = '"PHQ10-is-mild"'; },
    (v: typeof source) => { row(v, "sleep.output").quantities![1]!.evidence_unit = "seconds"; },
    (v: typeof source) => { row(v, "social.input.other_social_apps").quantities![0]!.evidence_value_json = '"KakaoTalk"'; },
  ]) { const bad = structuredClone(source); mutate(bad); expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(); }
});

function assertTemporalGeneratedShapes(input: { sampled_quantity_observations: unknown[]; task_occurrences: unknown[]; participant_day_observations?: unknown[]; device_use_sessions?: unknown[] }) {
    const schemaPath = resolve(import.meta.dirname, "../../schema/generated/json-schema/chronicle-research-ontology.schema.json");
    const pydanticPath = resolve(import.meta.dirname, "../../schema/generated/pydantic");
    const script = [
      "import json,sys", "from jsonschema import Draft202012Validator", "sys.path.insert(0,sys.argv[2])",
      "import chronicle_research_ontology as model", "schema=json.load(open(sys.argv[1])); data=json.load(sys.stdin)",
      "for field,name in [('sampled_quantity_observations','SampledQuantityObservationRecord'),('participant_day_observations','ParticipantDayObservationRecord'),('task_occurrences','TaskOccurrenceRecord'),('device_use_sessions','DeviceUseSessionRecord')]:",
      " validator=Draft202012Validator({'$ref':'#/$defs/'+name,'$defs':schema['$defs']})",
      " for row in data.get(field,[]):",
      "  validator.validate(row); assert getattr(model,name)(**row).model_dump(exclude_unset=True)==row",
      "  assert not validator.is_valid(dict(row,invented_field=True))",
      "print('temporal-shapes-preserved')",
    ].join("\n");
    expect(execFileSync("uvx", ["--from","linkml==1.10.0","--with","jsonschema","python","-c",script,schemaPath,pydanticPath],
      { input: JSON.stringify(input), encoding: "utf8", timeout: 180_000 }).trim()).toBe("temporal-shapes-preserved");
}

const classroomWorks = ["doi:10.1016/j.compedu.2019.103611", "doi:10.1177/0956797620956613"] as const;
function classroomInput(work: string) {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === work)!);
  return { profiles: [profile], ...classroomContextExample(profile) };
}
itWithPrivateCorpus("rejects contradictory supplied classroom state, quantities and missing device ownership", () => {
  const row = (v: ReturnType<typeof classroomInput>, id: string) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === "constructed:classroom-" + id)!;
  const cases: Array<[RegExp, (v: ReturnType<typeof classroomInput>) => void]> = [
    [/no disclosed classroom categorical value/, v => { row(v, "ringer").quantities![0]!.evidence_value_json = '"Silent"'; }],
    [/must retain a supplied scalar quantity/, v => { row(v, "use-A").quantities![0]!.evidence_value_json = "{}"; }],
    [/requires a supplied device owner/, v => { delete row(v, "wifi").device_id; }],
  ];
  for (const [error, mutate] of cases) { const invalid = classroomInput(classroomWorks[0]); mutate(invalid); expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(error); }
});
itWithPrivateCorpus.each(classroomWorks)("admits the actual existing course-owned attendance/exposure definition without inventing a day: %s", work => {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === work)!);
  const key = work === classroomWorks[0] ? "attendance.wifi_primary" : "aggregation.in_class_screen_percent";
  const setting = profile.method_settings.find(s => s.method_parameter_key === key)!;
  const row = { sampled_observation_id: "constructed:isolated-class", method_profile_id: profile.method_profile_id, source_work_id: work,
    participant_id: "constructed:student", device_id: "constructed:phone", record_origin: "analyst_constructed_example",
    method_setting_reference: setting.method_setting_id, observed_entity_kind: "course", observed_entity_token: "supplied course",
    source_locators: ["Primary288:305–334 or preprint365:195–212; constructed supplied course owner, not a calendar day"], quantities: [] };
  expect(parseStudyMethodProfileLibrary({ profiles: [profile], sampled_quantity_observations: [row] }).sampled_quantity_observations).toEqual([row]);
});
for (const work of classroomWorks) {
  itWithPrivateCorpus("roundtrips complete source-shaped course, attendance, class/day usage, raw and questionnaire owners: " + work, async () => {
    const source = classroomInput(work);
    const persist = async (value: typeof source) => {
      const { profiles, ...records } = parseStudyMethodProfileLibrary(value);
      await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], selectedLevels: {}, ...records }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile } & typeof records;
      expect(saved.profile).toEqual(value.profiles[0]);
      expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], sampled_quantity_observations: saved.sampled_quantity_observations,
        participant_day_observations: saved.participant_day_observations, task_occurrences: saved.task_occurrences,
        device_use_sessions: saved.device_use_sessions })).toEqual(parseStudyMethodProfileLibrary(value));
    };
    await persist(source);
    const row = (value: typeof source, id: string) => value.sampled_quantity_observations.find(r => r.sampled_observation_id === "constructed:classroom-" + id)!;
    const same = work === classroomWorks[0] ? ["class-A", "class-A-second"] : ["attendance-A", "attendance-A-second"];
    expect(row(source, same[0]!).observed_entity_token).toBe(row(source, same[1]!).observed_entity_token);
    expect(row(source, same[0]!).quantities).toEqual(row(source, same[1]!).quantities);
    expect(row(source, same[0]!).sampled_observation_id).not.toBe(row(source, same[1]!).sampled_observation_id);
    const reversed = structuredClone(source); reversed.sampled_quantity_observations.reverse();
    reversed.sampled_quantity_observations.forEach(r => { r.quantities?.reverse(); r.sampled_observation_references?.reverse(); r.entity_members?.reverse(); });
    await persist(reversed);
    for (const value of [undefined, null, []]) {
      const unknown = structuredClone(source);
      if (value === undefined) delete row(unknown, "use-A").sampled_observation_references; else row(unknown, "use-A").sampled_observation_references = value;
      if (value === undefined) delete row(unknown, "use-A").quantities; else row(unknown, "use-A").quantities = value;
      await persist(unknown);
    }
    for (const value of [undefined, null, "null", ' "opaque lexical scalar" ']) {
      const unknown = structuredClone(source), q = row(unknown, "use-A").quantities![0]!;
      if (value === undefined) delete q.evidence_value_json; else q.evidence_value_json = value;
      await persist(unknown);
    }
    if (work === classroomWorks[0]) {
      expect(source.task_occurrences.map(t => t.task_questionnaire_responses!.length)).toEqual([4,4,3,6,3,1,0]);
      expect(row(source, "rhythm-A").quantities!.map(q => (JSON.parse(q.evidence_value_json!) as unknown[]).length)).toEqual([15,15]);
      expect(source.participant_day_observations.map(r => r.evidence_unit)).toEqual(["hours","sessions","seconds","seconds"]);
      expect(row(source,"ringer-A").observed_entity_kind).toBe("participant");
      expect(row(source,"fingerprint").observed_entity_kind).toBe("course");
      expect(row(source,"fingerprint").device_id).toBeNull();
      expect(source.device_use_sessions[0]!.session_actions!.map(a => a.app_identifier)).toEqual(["supplied app-A","supplied app-B","supplied app-A"]);
      expect(new Set(source.device_use_sessions[0]!.session_actions!.map(a => a.task_action_id)).size).toBe(3);
      expect(row(source, "unavailable-A").quantities!.at(-1)!.evidence_value_json).toBe("true"); // Unknown attendance is not absent attendance.
      expect(row(source, "monthly-context").task_occurrence_reference).toBe(source.task_occurrences[2]!.task_occurrence_id);
      expect(source.task_occurrences[6]!.criterion_assessments![0]!.criterion_label).toBe("course letter grade");
      for (const refs of [undefined, null]) {
        const unknown = structuredClone(source);
        if (refs === undefined) delete row(unknown, "course-A").task_occurrence_reference; else row(unknown, "course-A").task_occurrence_reference = refs;
        await persist(unknown);
      }
    } else {
      const independentlyChanged = structuredClone(source);
      row(independentlyChanged, "use-A").quantities!.find(q => q.observed_property === "attended class time")!.evidence_value_json = "1500.000";
      expect(row(independentlyChanged, "use-A").quantities!.find(q => q.observed_property === "in-class screen percent")!.evidence_value_json).toBe("5.00");
      expect(row(independentlyChanged, "attendance-A").quantities).toEqual(row(source, "attendance-A").quantities);
      await persist(independentlyChanged); // No denominator arithmetic or synchronized rewrite.
      for (const duration of ["34.99","35.00","35.01"]) {
        const supplied = structuredClone(source);
        row(supplied, "long-A").quantities![0]!.evidence_value_json = duration;
        row(supplied, "long-A").quantities![1]!.evidence_value_json = "null";
        await persist(supplied); // >=35 is the definition, not an importer classifier.
      }
    }
    await persist(source); const before = await loadResearchMethodSelection();
    const mutations: ((value: typeof source) => void)[] = [
      v => { Reflect.deleteProperty(row(v, "use-A"), "participant_id"); },
      v => { row(v, "use-A").observed_entity_kind = "participant"; },
      v => { row(v, "use-A").observed_entity_token = null; },
      v => { row(v, "use-A").observed_entity_token = " "; },
      v => { v.sampled_quantity_observations.push(structuredClone(row(v, "use-A"))); },
      v => { row(v, "use-A").sampled_observation_references![0]!.sampled_observation_reference = "unknown"; },
      v => { row(v, "use-A").sampled_observation_references![0]!.sampled_observation_reference = row(v, "use-A").sampled_observation_id; },
      v => { row(v, "use-A").sampled_observation_references![0]!.relationship_label = "inferred lecture"; },
      v => { row(v, "use-A").sampled_observation_references!.push(structuredClone(row(v, "use-A").sampled_observation_references![0]!)); },
      v => { row(v, "attendance-A").participant_id = "known other student"; },
      v => { row(v, "attendance-A").device_id = "known other phone"; },
      v => { row(v, "attendance-A").observed_entity_token = "known other course"; },
      v => { row(v, "use-A").entity_members = null; },
      v => { row(v, "use-A").quantities![0]!.evidence_unit = "days"; },
      v => { row(v, "use-A").quantities![0]!.evidence_value_json = "1e999"; },
    ];
    if (work === classroomWorks[0]) mutations.push(
      v => { row(v, "building-A").quantities![1]!.evidence_value_json = "false"; },
      v => { row(v, "unavailable-A").quantities![0]!.evidence_value_json = "true"; },
      v => { row(v, "unavailable-A").quantities![2]!.evidence_value_json = "false"; },
      v => { row(v, "building-A").quantities!.push({ observed_property: "classroom arrival", evidence_value_json: '"invented from GPS"' }); },
      v => { row(v, "rhythm-A").quantities![0]!.evidence_value_json = JSON.stringify(Array(16).fill(0)); },
      v => { row(v, "rhythm-A").quantities![0]!.evidence_value_json = "[true]"; },
      v => { row(v, "ringer-A").quantities![0]!.evidence_value_json = "1.1"; },
      v => { row(v, "wifi").entity_members![0]!.member_entity_kind = "cell"; },
      v => { row(v, "wifi").entity_members!.push(structuredClone(row(v, "wifi").entity_members![0]!)); },
      v => { row(v, "event-0").sampled_observation_references = null; },
      v => { row(v, "course-A").task_occurrence_reference = "unknown completion"; },
      v => { v.task_occurrences[0]!.participant_id = "known other student"; },
      v => { row(v, "course-A").task_occurrence_reference = " "; },
    );
    else mutations.push(
      v => { row(v, "attendance-A").sampled_observation_references![0]!.sampled_observation_reference = row(v, "scheduled-B").sampled_observation_id; },
      v => { row(v, "screen-A").quantities![0]!.evidence_value_json = ' "on" '; },
      v => { row(v, "use-A").quantities![2]!.evidence_value_json = "101"; },
      v => { row(v, "use-A").quantities!.push({ observed_property: "app name", evidence_value_json: '"not observed"' }); },
      v => { row(v, "use-A").quantities![1]!.observed_property = "scheduled class time"; },
    );
    for (const mutate of mutations) {
      const wrong = structuredClone(source); mutate(wrong);
      expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
      expect(await loadResearchMethodSelection()).toBe(before);
    }
  });
  itWithPrivateCorpus("binds every consumed classroom sampled root to exact source, body and wrapper tuples: " + work, () => {
    const source = classroomInput(work);
    const refs = [...new Set(source.sampled_quantity_observations.map(r => r.method_setting_reference))];
    for (const reference of refs) {
      const input = structuredClone(source);
      input.sampled_quantity_observations = input.sampled_quantity_observations.filter(r => r.method_setting_reference === reference);
      input.sampled_quantity_observations.forEach(r => { delete r.sampled_observation_references; delete r.task_occurrence_reference; });
      const local = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_setting_id === reference)!;
      const wrapper = JSON.parse(String(local(input).method_value_json)) as Record<string, unknown>;
      const body = Object.hasOwn(wrapper, "definition") ? wrapper.definition : wrapper;
      expect(parseStudyMethodProfileLibrary(input).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
      const bare = structuredClone(input); local(bare).method_value_json = JSON.stringify(body);
      expect(() => parseStudyMethodProfileLibrary(bare)).not.toThrow();
      for (const value of [null, {}, { ...wrapper, definition: null }, { ...wrapper, definition: "wrong body" },
        { ...wrapper, source_facing_role: "analysis" }, { ...wrapper, source_facing_target: "app_session" }]) {
        const wrong = structuredClone(input); local(wrong).method_value_json = JSON.stringify(value);
        expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
      }
      for (const [field, value] of [["source_work_id","doi:foreign"],["method_setting_role","provenance"],["method_target_layer","released_artifact"]]) {
        const wrong = structuredClone(input); Reflect.set(local(wrong), field!, value);
        expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
      }
      const foreign = structuredClone(input);
      foreign.profiles[0]!.source_work_id = "doi:10.1145/1879141.1879176";
      foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = foreign.profiles[0]!.source_work_id; });
      for (const r of foreign.sampled_quantity_observations) r.source_work_id = foreign.profiles[0]!.source_work_id;
      foreign.task_occurrences = []; foreign.device_use_sessions = []; foreign.participant_day_observations = [];
      expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
      expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow();
    }
  });
  itWithPrivateCorpus("preserves source classroom records through generated JSON Schema/Pydantic without constructing attendance: " + work, () => {
    assertTemporalGeneratedShapes(classroomInput(work));
  });
}
itWithPrivateCorpus("keeps Kim's actual course questionnaires source-bound without importing undisclosed item wording or codes", () => {
  const source = classroomInput(classroomWorks[0]);
  for (const key of ["diary.weekly_class_report","diary.monthly_course_report","diary.post_study_self_report","diary.post_study_sas_grades","diary.unanalyzed_psychological_battery"]) {
    const input = structuredClone(source), local = (v: typeof input) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
    input.sampled_quantity_observations = []; input.device_use_sessions = []; input.participant_day_observations = [];
    input.task_occurrences = input.task_occurrences.filter(t => [...t.task_questionnaire_responses ?? [], ...t.criterion_assessments ?? []]
      .some(r => ("questionnaire_setting_reference" in r ? r.questionnaire_setting_reference : r.criterion_setting_reference) === local(input).method_setting_id));
    expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
    const content = JSON.parse(String(local(input).method_value_json)) as Record<string, unknown>;
    for (const value of [null, {}, { ...content, definition: null }, { ...content, definition: 5 }, { ...content, source_facing_role: "analysis" },
      { ...content, source_facing_target: "participant_day" }]) {
      const wrong = structuredClone(input); local(wrong).method_value_json = JSON.stringify(value);
      expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
    }
  }
});
itWithPrivateCorpus.each(classroomWorks)("rejects foreign screen constructors while keeping supplied endpoints and duration independent: %s", work => {
  const input = classroomInput(work);
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  for (const mutate of [
    (v: typeof input) => { v.device_use_sessions[0]!.start_condition = "unlock"; },
    (v: typeof input) => { v.device_use_sessions[0]!.end_condition = "lock"; },
    (v: typeof input) => { v.device_use_sessions[0]!.method_setting_reference = v.profiles[0]!.method_settings.find(s => s.method_parameter_key === (work === classroomWorks[0] ? "session.duration" : "feature.long_screen_session_ge_35s"))!.method_setting_id; },
  ]) {
    const wrong = structuredClone(input); mutate(wrong); expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
  }
  const unknown = structuredClone(input); delete unknown.device_use_sessions[0]!.start_condition; unknown.device_use_sessions[0]!.end_condition = null;
  expect(() => parseStudyMethodProfileLibrary(unknown)).not.toThrow();
});

itWithPrivateCorpus("requires the exact local classroom processing companions, not compatible tuples alone", () => {
  const cases: [string,string,string][] = [
    ["doi:10.1016/j.compedu.2019.103611","attendance.wifi_primary","attendance.wifi_spatial_locality"],
    ...["attendance.gps_indoor_transition","attendance.manual_building_circles"].map(key => ["doi:10.1016/j.compedu.2019.103611","attendance.gps_fallback",key] as [string,string,string]),
    ...["arrival.class_window_before","arrival.class_window_after","arrival.stationary_threshold"].map(key => ["doi:10.1016/j.compedu.2019.103611","arrival.activity_transition",key] as [string,string,string]),
    ...["session.duration","session.inter_session","session.frequency","session.use_duration"].map(key => ["doi:10.1016/j.compedu.2019.103611","session.levels",key] as [string,string,string]),
    ...["rhythm.bin_width","rhythm.duration_boundary","rhythm.frequency_boundary"].map(key => ["doi:10.1016/j.compedu.2019.103611","rhythm.per_student_vectors",key] as [string,string,string]),
    ...["feature.long_screen_session_ge_35s","aggregation.average_long_session_in_class_percent"].map(key => ["doi:10.1177/0956797620956613","aggregation.in_class_screen_percent",key] as [string,string,string]),
  ];
  for (const [work,root,key] of cases) {
    const source = classroomInput(work);
    const rootSetting = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === root)!;
    source.sampled_quantity_observations = source.sampled_quantity_observations.filter(r => r.method_setting_reference === rootSetting.method_setting_id);
    source.sampled_quantity_observations.forEach(r => { delete r.sampled_observation_references; delete r.task_occurrence_reference; });
    source.task_occurrences = []; source.device_use_sessions = []; source.participant_day_observations = [];
    expect(() => parseStudyMethodProfileLibrary(source)).not.toThrow();
    const local = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
    const content = JSON.parse(String(local(source).method_value_json)) as Record<string,unknown>;
    for (const body of [{ ...content, definition: null }, { ...content, definition: "incompatible companion" },
      { ...content, source_facing_role: "reporting" }, { ...content, source_facing_target: "app_session" }]) {
      const wrong = structuredClone(source); local(wrong).method_value_json = JSON.stringify(body);
      expect(() => parseStudyMethodProfileLibrary({ profiles: wrong.profiles })).not.toThrow();
      expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
    }
    const duplicate = structuredClone(source), extra = structuredClone(local(duplicate));
    extra.method_setting_id += ":duplicate";
    duplicate.profiles[0]!.method_settings.push(extra);
    duplicate.profiles[0]!.method_setting_count = duplicate.profiles[0]!.method_settings.length;
    duplicate.profiles[0]!.method_setting_ids = duplicate.profiles[0]!.method_settings.map(s => s.method_setting_id);
    expect(() => parseStudyMethodProfileLibrary({ profiles: duplicate.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(duplicate)).toThrow();
  }
});
itWithPrivateCorpus("keeps Kim course questionnaire topics literal and distinct from unanalysed instrument inventories", () => {
  const source = classroomInput(classroomWorks[0]);
  for (const i of [0,2,3,4,5]) {
    const wrong = structuredClone(source);
    wrong.task_occurrences[i]!.task_questionnaire_responses![0]!.observed_property = "invented scored psychological item";
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow("disclosed classroom questionnaire topic");
  }
  const foreign = structuredClone(source), work = classroomWorks[1];
  foreign.profiles[0]!.source_work_id = work;
  foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = work; });
  foreign.sampled_quantity_observations = []; foreign.device_use_sessions = []; foreign.participant_day_observations = [];
  foreign.task_occurrences.forEach(t => { t.source_work_id = work; });
  expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow("compatible response-scale definition");
});
itWithPrivateCorpus("requires Kim's supplied screen-off companion and does not borrow an outer constructor body", () => {
  const source = classroomInput(classroomWorks[0]);
  const constructor = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === "session.screen_on_start")!;
  const end = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === "session.screen_off_end")!;
  for (const reference of [constructor.method_setting_id,end.method_setting_id]) {
    for (const body of [null,{}, { definition:null,source_facing_role:"reconstruction",source_facing_target:"device_session",start:"Screen On",end:"Screen Off" }]) {
      const wrong = structuredClone(source);
      wrong.profiles[0]!.method_settings.find(s => s.method_setting_id === reference)!.method_value_json = JSON.stringify(body);
      expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
    }
  }
});

const cohortAppWorks = ["doi:10.1145/2037373.2037383","doi:10.1016/j.compedu.2019.103611"] as const;
const cohortAppRootCases = [
  [
    "doi:10.1145/2037373.2037383",
    "analysis.daily_device_use_mean"
  ],
  [
    "doi:10.1145/2037373.2037383",
    "analysis.location_region_comparison"
  ],
  [
    "doi:10.1145/2037373.2037383",
    "analysis.hourly_category_launch_share"
  ],
  [
    "doi:10.1145/2037373.2037383",
    "analysis.application_chain_duration_metric"
  ],
  [
    "doi:10.1145/2037373.2037383",
    "analysis.chain_transition_probabilities"
  ],
  [
    "doi:10.1145/2037373.2037383",
    "analysis.location_motion_comparison"
  ],
  [
    "doi:10.1145/2037373.2037383",
    "analysis.chain_first_category"
  ],
  [
    "doi:10.1145/2037373.2037383",
    "analysis.application_session_mean"
  ],
  [
    "doi:10.1145/2037373.2037383",
    "analysis.chain_unique_app_distribution"
  ],
  [
    "doi:10.1145/2037373.2037383",
    "analysis.location_airport_comparison"
  ],
  [
    "doi:10.1145/2037373.2037383",
    "analysis.category_session_duration"
  ],
  [
    "doi:10.1145/2037373.2037383",
    "analysis.hourly_session_duration"
  ],
  [
    "doi:10.1145/2037373.2037383",
    "analysis.hourly_launch_counts"
  ],
  [
    "doi:10.1145/2037373.2037383",
    "analysis.chain_occurrence_distribution"
  ],
  [
    "doi:10.1145/2037373.2037383",
    "analysis.selected_app_hourly_usage"
  ],
  [
    "doi:10.1016/j.compedu.2019.103611",
    "apps.notifications"
  ],
  [
    "doi:10.1016/j.compedu.2019.103611",
    "apps.main_results"
  ],
  [
    "doi:10.1016/j.compedu.2019.103611",
    "apps.within_user_normalization"
  ],
  [
    "doi:10.1016/j.compedu.2019.103611",
    "apps.lms_comparator"
  ],
  [
    "doi:10.1016/j.compedu.2019.103611",
    "apps.top_five"
  ],
  [
    "doi:10.1016/j.compedu.2019.103611",
    "apps.top_five_share"
  ],
  [
    "doi:10.1016/j.compedu.2019.103611",
    "apps.multitasking"
  ],
  [
    "doi:10.1016/j.compedu.2019.103611",
    "apps.initial_support"
  ],
  [
    "doi:10.1016/j.compedu.2019.103611",
    "rq1.class_prevalence"
  ],
  [
    "doi:10.1016/j.compedu.2019.103611",
    "rq1.class_vs_overall_tests"
  ],
  [
    "doi:10.1016/j.compedu.2019.103611",
    "rq1.semester_halves"
  ],
  [
    "doi:10.1016/j.compedu.2019.103611",
    "rq1.weekday_weekend"
  ],
  [
    "doi:10.1016/j.compedu.2019.103611",
    "rq1.class_session_results"
  ],
  [
    "doi:10.1016/j.compedu.2019.103611",
    "validation.logged_vs_self_report"
  ]
] as [string,string][];
function cohortAppInput(work: string) {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === work)!);
  return { profiles: [profile], sampled_quantity_observations: cohortAppSummaryExample(profile) };
}
itWithPrivateCorpus.each(cohortAppRootCases)("preserves an actual local aggregate definition without caller/source/body fallback: %s %s", (work,key) => {
  const input = cohortAppInput(work), local = (v: typeof input) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  input.sampled_quantity_observations = input.sampled_quantity_observations.filter(r => r.method_setting_reference === local(input).method_setting_id);
  expect(input.sampled_quantity_observations.length).toBeGreaterThan(0);
  expect(parseStudyMethodProfileLibrary(input).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  const value: unknown = JSON.parse(String(local(input).method_value_json));
  const body = typeof value === "object" && value !== null && "definition" in value ? (value).definition : value;
  const sourceRole = work === cohortAppWorks[1] && local(input).method_setting_role === "reporting" ? "reported_result" : local(input).method_setting_role;
  const wrapped = structuredClone(input);
  local(wrapped).method_value_json = JSON.stringify({ definition:body,source_facing_role:sourceRole,source_facing_target:local(input).method_target_layer });
  expect(parseStudyMethodProfileLibrary(wrapped).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  const bare = structuredClone(input); local(bare).method_value_json = JSON.stringify(body);
  expect(() => parseStudyMethodProfileLibrary(bare)).not.toThrow();
  for (const bad of [null,{},999,{definition:null,source_facing_role:sourceRole,source_facing_target:local(input).method_target_layer},
    {definition:body,source_facing_role:"preprocessing",source_facing_target:local(input).method_target_layer},
    {definition:body,source_facing_role:sourceRole,source_facing_target:"raw_occurrence"}]) {
    const wrong = structuredClone(input); local(wrong).method_value_json = JSON.stringify(bad);
    expect(() => parseStudyMethodProfileLibrary({profiles:wrong.profiles})).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
  }
  const duplicate = structuredClone(input), extra = structuredClone(local(duplicate)); extra.method_setting_id += ":duplicate";
  duplicate.profiles[0]!.method_settings.push(extra); duplicate.profiles[0]!.method_setting_count = duplicate.profiles[0]!.method_settings.length;
  duplicate.profiles[0]!.method_setting_ids = duplicate.profiles[0]!.method_settings.map(s => s.method_setting_id);
  expect(() => parseStudyMethodProfileLibrary({profiles:duplicate.profiles})).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(duplicate)).toThrow();
  const foreign = structuredClone(input), foreignWork = "doi:10.2196/13209";
  foreign.profiles[0]!.source_work_id = foreignWork; foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = foreignWork; });
  foreign.sampled_quantity_observations.forEach(r => { r.source_work_id = foreignWork; r.participant_id = "constructed:person"; });
  expect(() => parseStudyMethodProfileLibrary({profiles:foreign.profiles})).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow();
});
itWithPrivateCorpus.each(cohortAppWorks)("roundtrips independent aggregate scopes, lexical values and identities through import/IndexedDB: %s", async work => {
  const source = cohortAppInput(work);
  const persist = async (input: typeof source) => {
    const parsed = parseStudyMethodProfileLibrary(input);
    await saveResearchMethodSelection(JSON.stringify({profile:parsed.profiles[0],selectedLevels:{},sampled_quantity_observations:parsed.sampled_quantity_observations}));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as {profile:StudyMethodProfile;sampled_quantity_observations:SampledQuantityObservationRecord[]};
    expect(saved.profile).toEqual(input.profiles[0]);
    expect(parseStudyMethodProfileLibrary({profiles:[saved.profile],sampled_quantity_observations:saved.sampled_quantity_observations}).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  };
  await persist(source);
  expect(source.sampled_quantity_observations.every(r => !Object.hasOwn(r,"participant_id") && !Object.hasOwn(r,"device_id"))).toBe(true);
  if (work === cohortAppWorks[0]) {
    const a = source.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith("hour-category"))!;
    const b = source.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith("hour-category-equal"))!;
    expect(a.observed_entity_token).toBe(b.observed_entity_token); expect(a.quantities).toEqual(b.quantities);
    expect(a.sampled_observation_id).not.toBe(b.sampled_observation_id);
    const transition = source.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith("transition"))!;
    expect(transition.observed_entity_token).toBe("Communication");
    expect(transition.quantities![1]!.evidence_value_json).toBe('"Communication"'); // Same category does not mean the same app.
    const changed = structuredClone(source);
    changed.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith("hour-app"))!.quantities![2]!.evidence_value_json = "50.00";
    expect(changed.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith("hour-category"))).toEqual(a);
    await persist(changed);
  } else {
    const subset = source.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith("subset"))!;
    expect(subset.quantities!.slice(1).map(q => q.evidence_value_json)).toEqual(["14.00","20.00","0.65"]); // Not a computed ratio.
    const changed = structuredClone(source); changed.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith("subset"))!.quantities![2]!.evidence_value_json = "30.00";
    expect(changed.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith("subset"))!.quantities![3]!.evidence_value_json).toBe("0.65");
    await persist(changed);
    expect(source.sampled_quantity_observations.filter(r => r.sampled_observation_id.includes("selected-")).map(r => r.observed_entity_token)).toEqual(["KakaoTalk","Facebook","Samsung web browser","Chrome web browser","Naver"]);
  }
  for (const value of [undefined,null,"null","0",'"unreported lexical numeric token"']) {
    const unknown = structuredClone(source), quantity = unknown.sampled_quantity_observations[0]!.quantities![1]!;
    if (value === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = value;
    await persist(unknown);
  }
  const reversed = structuredClone(source); reversed.sampled_quantity_observations.reverse();
  reversed.sampled_quantity_observations.forEach(r => r.quantities!.reverse()); await persist(reversed);
  for (const empty of [[],undefined]) {
    const input = {profiles:source.profiles,...(empty === undefined ? {} : {sampled_quantity_observations:empty})};
    expect(parseStudyMethodProfileLibrary(input).sampled_quantity_observations).toEqual(empty);
  }
});
itWithPrivateCorpus.each(cohortAppWorks)("rejects invented human ownership, scopes and unsupported members without losing valid aggregate rows: %s", work => {
  const source = cohortAppInput(work);
  const mutations = [
    (v: typeof source) => { v.sampled_quantity_observations[0]!.participant_id = "invented cohort person"; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.device_id = "invented cohort phone"; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.observed_entity_token = " "; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.observed_entity_kind = "application_category"; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.quantities![0]!.evidence_value_json = '"specific participant"'; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.quantities![0]!.quantity_qualifier = "other scope"; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.quantities!.push({...v.sampled_quantity_observations[0]!.quantities![0]!,quantity_qualifier:"duplicate scope"}); },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.quantities = null; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.entity_members = null; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.sampled_observation_references = null; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.quantities![1]!.observed_property = "computed output"; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.quantities![1]!.evidence_unit = "hours"; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.quantities![1]!.evidence_value_json = "1e999"; },
    (v: typeof source) => { v.sampled_quantity_observations[0]!.quantities![1]!.evidence_value_json = "{}"; },
  ];
  for (const mutate of mutations) { const wrong = structuredClone(source); mutate(wrong); expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(); }
  const duplicate = structuredClone(source); duplicate.sampled_quantity_observations.push(structuredClone(duplicate.sampled_quantity_observations[0]!));
  expect(() => parseStudyMethodProfileLibrary(duplicate)).toThrow("duplicated within profile/participant/device");
  const unknownPeople = structuredClone(source); unknownPeople.sampled_quantity_observations.forEach(r => {r.participant_id = null;r.device_id = null;});
  expect(parseStudyMethodProfileLibrary(unknownPeople).sampled_quantity_observations).toEqual(unknownPeople.sampled_quantity_observations);
});
itWithPrivateCorpus("rejects only known Angry Birds range/scope contradictions, not unknown lexical values or same-category transitions", () => {
  const source = cohortAppInput(cohortAppWorks[0]);
  for (const [id,property,value] of [
    ["hour-launch","hour of day","24"],["hour-launch","hour of day","1.5"],["hour-launch","application launch count","2.5"],
    ["hour-category","within-hour category launch percent","101"],["airport","relative usage-time likelihood","-1"],
    ["airport","comparison scope",'"Europe"'],["motion","comparison scope",'"travel speed >=25 kph"'],
    ["region","reference scope",'"Europe"'],
  ]) {
    const wrong = structuredClone(source), row = wrong.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith(id!))!;
    row.quantities!.find(q => q.observed_property === property)!.evidence_value_json = value!;
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
  }
  const partial = structuredClone(source);
  for (const row of partial.sampled_quantity_observations) row.quantities = row.quantities!.filter(q => q.observed_property === "population scope");
  expect(() => parseStudyMethodProfileLibrary(partial)).not.toThrow();
});

const tailFourWorks = [
  "doi:10.1016/j.chb.2024.108281",
  "doi:10.1038/s41597-026-07015-7",
  "doi:10.1145/3131901",
  "doi:10.5555/2442691.2442720"
] as const;
const tailFourRoutes = [
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "event_schema.screen_second_unit",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_record",
    "unique": true
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "event_schema.no_record_state",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_occurrence",
    "unique": true
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "event_schema.battery_status",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_record",
    "unique": true
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "event_schema.repaired_screen_states",
    "sourceRole": "quality_control",
    "sourceTarget": "acquired_snapshot",
    "unique": true
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "quality.unknown_to_off_policy",
    "sourceRole": "quality_control",
    "sourceTarget": "raw_occurrence",
    "unique": true
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "reconstruction.short_off_bridge",
    "sourceRole": "quality_control",
    "sourceTarget": "acquired_snapshot",
    "unique": true
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "event_schema.notification_presence",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_record",
    "unique": true
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "aggregation.daily_trace_window",
    "sourceRole": "aggregation",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "aggregation.typical_waking_day_missingness",
    "sourceRole": "aggregation",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "quality.missing_threshold_40",
    "sourceRole": "quality_control",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "quality.missing_threshold_10",
    "sourceRole": "quality_control",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "quality.missing_threshold_5",
    "sourceRole": "quality_control",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "aggregation.single_time_trace_window",
    "sourceRole": "aggregation",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "feature.typical_day_weighted_mean",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "aggregation.person_mean_daily",
    "sourceRole": "aggregation",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "feature.discrepancy_index",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "feature.overestimation_index",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "feature.underestimation_index",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1038/s41597-026-07015-7",
    "key": "acquisition.baseline_submission_unit",
    "sourceRole": "acquisition",
    "sourceTarget": "acquired_snapshot",
    "unique": true
  },
  {
    "work": "doi:10.1038/s41597-026-07015-7",
    "key": "acquisition.ema_submission_unit",
    "sourceRole": "acquisition",
    "sourceTarget": "acquired_snapshot",
    "unique": true
  },
  {
    "work": "doi:10.1038/s41597-026-07015-7",
    "key": "schema.active_use_interval_release",
    "sourceRole": "event_schema",
    "sourceTarget": "released_artifact",
    "unique": true
  },
  {
    "work": "doi:10.1038/s41597-026-07015-7",
    "key": "schema.inferred_inactivity_interval_release",
    "sourceRole": "event_schema",
    "sourceTarget": "released_artifact",
    "unique": true
  },
  {
    "work": "doi:10.1038/s41597-026-07015-7",
    "key": "aggregation.per_app_first_last_usage",
    "sourceRole": "aggregation",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1038/s41597-026-07015-7",
    "key": "acquisition.device_metadata",
    "sourceRole": "acquisition",
    "sourceTarget": "raw_record",
    "unique": true
  },
  {
    "work": "doi:10.1038/s41597-026-07015-7",
    "key": "schema.submission_location",
    "sourceRole": "event_schema",
    "sourceTarget": "released_artifact",
    "unique": true
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "schema.daily_activity",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_response",
    "unique": true
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "diary.routine_other_to_chores",
    "sourceRole": "feature_engineering",
    "sourceTarget": "diary_response",
    "unique": true
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "schema.location",
    "sourceRole": "event_schema",
    "sourceTarget": "acquired_snapshot",
    "unique": true
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "location.significant_place_output",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "location.top_places_for_coding",
    "sourceRole": "quality_control",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "place_type.vocabulary",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "place_type.four_coder_merge",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "place_characteristic.rating_scale",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "place_characteristic.coder_aggregation",
    "sourceRole": "aggregation",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "place_characteristic.center_rescale",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "place_characteristic.trichotomization",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "app_category.initial_categories",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "aggregation.per_user_context_average",
    "sourceRole": "aggregation",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "normalization.app_usage_by_activity_time",
    "sourceRole": "aggregation",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "normalization.app_usage_by_place_time",
    "sourceRole": "aggregation",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "reporting.point_and_bar_summary",
    "sourceRole": "reporting",
    "sourceTarget": "released_artifact",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "schema.sound.raw_summaries",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_record",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "feature.sound_db_formula",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "acquisition.location_gps",
    "sourceRole": "acquisition",
    "sourceTarget": "raw_occurrence",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "acquisition.location_wifi_assist",
    "sourceRole": "acquisition",
    "sourceTarget": "raw_occurrence",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "acquisition.light_strength",
    "sourceRole": "acquisition",
    "sourceTarget": "raw_occurrence",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "acquisition.accelerometer",
    "sourceRole": "acquisition",
    "sourceTarget": "raw_occurrence",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "acquisition.call_log",
    "sourceRole": "acquisition",
    "sourceTarget": "raw_occurrence",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "acquisition.sms_log",
    "sourceRole": "acquisition",
    "sourceTarget": "raw_occurrence",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "sleep_app.measurement",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_record",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "sleep_app.use",
    "sourceRole": "aggregation",
    "sourceTarget": "outcome",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "feature.daily_trajectory.definition",
    "sourceRole": "feature_engineering",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "feature.sound.daily_aggregation",
    "sourceRole": "aggregation",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "feature.light.daily_aggregation",
    "sourceRole": "aggregation",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "feature.activity.classes",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "feature.attribute_vector_scope",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "feature.social_edge.dimensions",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "feature.previous_day_sleep_quality",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "feature.daily_graph",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "outcome.prediction_target",
    "sourceRole": "analysis",
    "sourceTarget": "outcome",
    "unique": true
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "quality.daily_report",
    "sourceRole": "reporting",
    "sourceTarget": "released_artifact",
    "unique": true
  }
];
const tailFourTaskRoutes = [
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "diary.typical_screen_time_item",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "diary.typical_phone_check_item",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "diary.daily_screen_time_item",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "diary.daily_phone_check_item",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.1016/j.chb.2024.108281",
    "key": "diary.night_phone_profile_item",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_response"
  },
  {
    "work": "doi:10.1038/s41597-026-07015-7",
    "key": "diary.question_types",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "diary.activity_options",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "diary.other_free_text_allowed",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_response"
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "place_type.vocabulary",
    "kind": "criterion",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature"
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "place_type.four_coder_merge",
    "kind": "criterion",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature"
  },
  {
    "work": "doi:10.1145/3131901",
    "key": "place_characteristic.rating_scale",
    "kind": "criterion",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.item.bedtime",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.item.sleep_latency",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.item.wake_time",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.item.sleep_duration",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.item.sleep_efficiency",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.item.trouble_pain",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.item.trouble_waking",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.item.trouble_toilet",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.item.trouble_breathing",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.item.trouble_cough_snore",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.item.trouble_cold",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.item.trouble_hot",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.item.trouble_dreams",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.item.sleep_medicine",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.item.daytime_wakefulness_social_trouble",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.item.overall_quality",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.score.sleep_latency_bins",
    "kind": "criterion",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_response"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.score.wake_time_bins",
    "kind": "criterion",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_response"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.score.sleep_efficiency_bins",
    "kind": "criterion",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_response"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.score.trouble_item_encoding",
    "kind": "criterion",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_response"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.score.trouble_sum_bins",
    "kind": "criterion",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_response"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.score.sleep_medicine",
    "kind": "criterion",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_response"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.score.wakefulness_frequency",
    "kind": "criterion",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_response"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "diary.score.overall_quality",
    "kind": "criterion",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_response"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "outcome.questionnaire_score_range",
    "kind": "criterion",
    "sourceRole": "diary_schema",
    "sourceTarget": "outcome"
  },
  {
    "work": "doi:10.5555/2442691.2442720",
    "key": "quality.questionnaire_conflict_validation",
    "kind": "criterion",
    "sourceRole": "quality_control",
    "sourceTarget": "diary_response"
  }
];
function tailFourInput(work: string) {
  const profile = structuredClone(canonical().profiles.find(profile => profile.source_work_id === work)!);
  return { profiles: [profile], ...tailFourExample(profile) };
}
const tailFourRow = (input: ReturnType<typeof tailFourInput>, suffix: string) => input.sampled_quantity_observations.find(row => row.sampled_observation_id.endsWith("-" + suffix))!;
const tailFourQuantity = (row: SampledQuantityObservationRecord, property: string) => row.quantities!.find(quantity => quantity.observed_property === property)!;
itWithPrivateCorpus.each([
  [tailFourWorks[0], "on-before", "screen status", '"alien screen state"', /disclosed source category/],
  [tailFourWorks[3], "accelerometer", "channel identities", "[1,null]", /supplied component identities/],
  [tailFourWorks[3], "accelerometer", "channel readings", "[true,2.75]", /finite component values/],
  [tailFourWorks[0], "retained-40", "supplied admissible-day decision", "1", /independent normalized decision/],
  [tailFourWorks[0], "missing", "supplied second token", "1", /opaque token\/text/],
  [tailFourWorks[2], "top-place", "supplied place rank", "0", /top-ten coding selection/],
] as const)("rejects source-specific supplied tail-four %s %s %s domain contradictions", (work, suffix, property, token, error) => {
  const source = tailFourInput(work);
  expect(() => parseStudyMethodProfileLibrary(source)).not.toThrow();
  const invalid = structuredClone(source);
  tailFourQuantity(tailFourRow(invalid, suffix), property).evidence_value_json = token;
  expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(error);
});
itWithPrivateCorpus("rejects contradictory supplied tail-four membership, summaries and component links", () => {
  const cases: Array<[string, RegExp, (v: ReturnType<typeof tailFourInput>) => void]> = [
    [tailFourWorks[1], /package or unresolved serialized dailyValues token/, v => { v.sampled_quantity_observations.find(r => r.entity_members?.length)!.entity_members![0]!.quantities!.find(q => q.observed_property === "packageName")!.evidence_value_json = "12"; }],
    [tailFourWorks[1], /invalid supplied app block or duration/, v => { v.sampled_quantity_observations.find(r => r.entity_members?.length)!.entity_members![0]!.quantities!.find(q => q.observed_property === "block number")!.evidence_value_json = "0"; }],
    [tailFourWorks[0], /must not recast a supplied summary as a raw event/, v => { tailFourRow(v, "person-mean").source_event_time_token = "supplied raw clock"; }],
    [tailFourWorks[3], /duplicates a known supplied component identity/, v => { tailFourQuantity(tailFourRow(v, "accelerometer"), "channel identities").evidence_value_json = '["same channel","same channel"]'; }],
    [tailFourWorks[3], /unequal supplied component identity\/value lengths/, v => { tailFourQuantity(tailFourRow(v, "accelerometer"), "channel readings").evidence_value_json = "[1]"; }],
    [tailFourWorks[2], /known activity\/place\/characteristic context kind/, v => { tailFourQuantity(tailFourRow(v, "context-activity"), "context kind").evidence_value_json = '"place"'; }],
    [tailFourWorks[0], /must retain off members/, v => { tailFourRow(v, "bridge").sampled_observation_references![0]!.sampled_observation_reference = tailFourRow(v, "repaired").sampled_observation_id; }],
    [tailFourWorks[2], /four independent source coders/, v => { const extra = structuredClone(tailFourRow(v, "coder-0-rating")); extra.sampled_observation_id += ":fifth"; v.sampled_quantity_observations.push(extra); tailFourRow(v, "mean").sampled_observation_references!.push({ ...structuredClone(tailFourRow(v, "mean").sampled_observation_references![0]!), sampled_observation_reference: extra.sampled_observation_id }); }],
  ];
  for (const [work, error, mutate] of cases) { const invalid = tailFourInput(work); mutate(invalid); expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(error); }
});
function isolatedTailFourInput(work: string, key: string) {
  const input = tailFourInput(work), setting = input.profiles[0]!.method_settings.find(setting => setting.method_parameter_key === key)!;
  input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === setting.method_setting_id);
  input.sampled_quantity_observations.forEach(row => { delete row.task_occurrence_reference; delete row.sampled_observation_references; });
  input.task_occurrences = [];
  return input;
}
itWithPrivateCorpus.each(tailFourRoutes)("admits the actual tail-four sampled source and original tuple: $work $key", ({ work, key, sourceRole, sourceTarget, unique }) => {
  const input = isolatedTailFourInput(work, key), local = (value: typeof input) => value.profiles[0]!.method_settings.find(setting => setting.method_parameter_key === key)!;
  const syncMembers = (value: typeof input) => {
    for (const policy of value.profiles[0]!.session_construction_policies as Array<{ method_settings: Array<{ method_setting_id: string }> }>) {
      policy.method_settings = policy.method_settings.map(member => structuredClone(value.profiles[0]!.method_settings.find(setting => setting.method_setting_id === member.method_setting_id)!));
    }
  };
  expect(input.sampled_quantity_observations.length).toBeGreaterThan(0);
  expect(() => parseStudyMethodProfileLibrary({ profiles: input.profiles })).not.toThrow();
  expect(parseStudyMethodProfileLibrary(input).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  const content: unknown = JSON.parse(String(local(input).method_value_json));
  const body = content !== null && typeof content === "object" && Object.hasOwn(content, "definition") ? (content as { definition: unknown }).definition : content;
  const wrapper = { definition: body, source_facing_role: sourceRole, source_facing_target: sourceTarget };
  for (const value of [body, wrapper]) { const valid = structuredClone(input); local(valid).method_value_json = JSON.stringify(value); syncMembers(valid); expect(() => parseStudyMethodProfileLibrary(valid)).not.toThrow(); }
  for (const value of [null, {}, { ...wrapper, definition: null }, { ...wrapper, source_facing_role: "invented" }, { ...wrapper, source_facing_target: "invented" }]) {
    const bad = structuredClone(input); local(bad).method_value_json = JSON.stringify(value); syncMembers(bad);
    expect(() => parseStudyMethodProfileLibrary({ profiles: bad.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  if (unique) {
    const foreign = structuredClone(input), owner = foreign.profiles[0]!;
    owner.source_work_id = "doi:10.1145/1879141.1879176";
    owner.method_settings.forEach(setting => { setting.source_work_id = owner.source_work_id; });
    syncMembers(foreign);
    foreign.sampled_quantity_observations.forEach(row => { row.source_work_id = owner.source_work_id; if (row.participant_id == null) row.participant_id = "constructed:foreign-source-person"; });
    expect(() => parseStudyMethodProfileLibrary({ profiles: [owner] })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow(/matching sampled-quantity definition/);
  }
});
itWithPrivateCorpus.each(tailFourTaskRoutes)("admits the actual tail-four $work $key $kind instrument before rejecting source/body drift", ({ work, key, kind, sourceRole, sourceTarget }) => {
  const input = tailFourInput(work), local = (value: typeof input) => value.profiles[0]!.method_settings.find(setting => setting.method_parameter_key === key)!;
  const id = local(input).method_setting_id; input.sampled_quantity_observations = [];
  input.task_occurrences = input.task_occurrences.filter(task => kind === "response" ? task.task_questionnaire_responses?.some(response => response.questionnaire_setting_reference === id) : task.criterion_assessments?.some(assessment => assessment.criterion_setting_reference === id)).slice(0, 1);
  expect(input.task_occurrences).toHaveLength(1);
  const task = input.task_occurrences[0]!;
  task.task_questionnaire_responses = kind === "response" ? task.task_questionnaire_responses?.filter(response => response.questionnaire_setting_reference === id) : [];
  task.criterion_assessments = kind === "criterion" ? task.criterion_assessments?.filter(assessment => assessment.criterion_setting_reference === id) : [];
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  const invalidValues: Record<string, Array<[string, unknown, RegExp]>> = {
    "diary.question_types": [["observed_property", "invented response form", /questionnaire response form/]],
    "diary.daily_screen_time_item": [["observed_property", "school day screen time hours", /daily or school\/non-school typical report scope/], ["response_value_json", "-1", /phone-use estimate/]],
    "diary.typical_screen_time_item": [["observed_property", "screen time hours", /daily or school\/non-school typical report scope/]],
    "diary.daily_phone_check_item": [["response_value_json", "1.5", /phone-use estimate/]],
    "diary.typical_phone_check_item": [["response_value_json", "1.5", /phone-use estimate/]],
    "diary.activity_options": [["response_value_json", '"unoffered activity"', /disclosed offered activity/]],
    "diary.other_free_text_allowed": [["response_value_json", "true", /other-activity text/]],
    "place_type.vocabulary": [["assessment_value_json", "true", /supplied place type/]],
    "place_type.four_coder_merge": [["assessment_value_json", "true", /supplied place type/]],
    "place_characteristic.rating_scale": [["criterion_label", "undeclared dimension", /place-characteristic dimension/], ["assessment_value_json", "8", /seven-point coder rating/]],
    "quality.questionnaire_conflict_validation": [["assessment_value_json", "1", /questionnaire-validation decision/]],
  };
  if (work === tailFourWorks[3] && kind === "criterion" && key !== "quality.questionnaire_conflict_validation") {
    const maximum = key === "outcome.questionnaire_score_range" ? 18 : ["diary.score.sleep_medicine", "diary.score.trouble_item_encoding"].includes(key) ? 1 : key === "diary.score.wakefulness_frequency" ? 2 : 3;
    invalidValues[key] = [["assessment_value_json", String(maximum + 1), /SleepMiner component or total/]];
  }
  for (const [field, value, error] of invalidValues[key] ?? []) {
    const bad = structuredClone(input);
    const child = kind === "response" ? bad.task_occurrences[0]!.task_questionnaire_responses![0]! : bad.task_occurrences[0]!.criterion_assessments![0]!;
    Reflect.set(child, field, value);
    expect(() => parseStudyMethodProfileLibrary(bad), `${key}.${field}`).toThrow(error);
  }
  const content: unknown = JSON.parse(String(local(input).method_value_json));
  const body = content !== null && typeof content === "object" && Object.hasOwn(content, "definition") ? (content as { definition: unknown }).definition : content;
  const wrapper = { definition: body, source_facing_role: sourceRole, source_facing_target: sourceTarget };
  for (const value of [body, wrapper]) { const valid = structuredClone(input); local(valid).method_value_json = JSON.stringify(value); expect(() => parseStudyMethodProfileLibrary(valid)).not.toThrow(); }
  for (const value of [{ ...wrapper, definition: null }, { ...wrapper, source_facing_role: "invented" }, { ...wrapper, source_facing_target: "invented" }]) {
    const bad = structuredClone(input); local(bad).method_value_json = JSON.stringify(value);
    expect(() => parseStudyMethodProfileLibrary({ profiles: bad.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/compatible .*definition|local definition role\/target/);
  }
});
itWithPrivateCorpus.each(tailFourWorks)("preserves tail-four source records through existing IDB/reparse and generated owners: %s", async work => {
  const input = tailFourInput(work);
  await persistTaskAndSampled(input); assertTemporalGeneratedShapes(input);
  expect(new Set(input.sampled_quantity_observations.map(row => input.profiles[0]!.method_settings.find(setting => setting.method_setting_id === row.method_setting_reference)!.method_parameter_key)))
    .toEqual(new Set(tailFourRoutes.filter(route => route.work === work).map(route => route.key)));
  const reverse = structuredClone(input); reverse.sampled_quantity_observations.reverse(); reverse.task_occurrences.reverse();
  reverse.sampled_quantity_observations.forEach(row => row.sampled_observation_references?.reverse());
  await persistTaskAndSampled(reverse); // Supplied order retained, not interpreted as chronology.
});
itWithPrivateCorpus("requires tail source companions after profile metadata validation, without requiring optional GPS for app-only input", () => {
  for (const [work, key, companion] of [
    [tailFourWorks[0], "event_schema.repaired_screen_states", "quality.missing_gap_le_60_unequal_bounds"],
    [tailFourWorks[1], "acquisition.baseline_submission_unit", "schema.appdata_day_window_conflict"],
    [tailFourWorks[1], "schema.submission_location", "acquisition.submission_location"],
    [tailFourWorks[2], "aggregation.per_user_context_average", "place_characteristic.retained_dimensions"],
    [tailFourWorks[3], "feature.social_edge.dimensions", "feature.social_edge.direction"],
  ]) {
    const source = isolatedTailFourInput(work!, key!); expect(() => parseStudyMethodProfileLibrary(source)).not.toThrow();
    const bad = structuredClone(source); bad.profiles[0]!.method_settings.find(setting => setting.method_parameter_key === companion)!.method_value_json = "{}";
    expect(() => parseStudyMethodProfileLibrary({ profiles: bad.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/matching sampled-quantity definition/);
    const duplicate = structuredClone(source), profile = duplicate.profiles[0]!, setting = profile.method_settings.find(setting => setting.method_parameter_key === companion)!;
    profile.method_settings.push({ ...structuredClone(setting), method_setting_id: setting.method_setting_id + ":duplicate" });
    profile.method_setting_count = profile.method_settings.length; profile.method_setting_ids = profile.method_settings.map(setting => setting.method_setting_id);
    expect(() => parseStudyMethodProfileLibrary({ profiles: [profile] })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(duplicate)).toThrow(/matching sampled-quantity definition/);
  }
  const appOnly = isolatedTailFourInput(tailFourWorks[1], "acquisition.baseline_submission_unit");
  appOnly.profiles[0]!.method_settings.find(setting => setting.method_parameter_key === "acquisition.submission_location")!.method_value_json = "{}";
  expect(() => parseStudyMethodProfileLibrary(appOnly)).not.toThrow(); // Optional, separately permissioned sensing is not a compulsory app-usage companion.
});
itWithPrivateCorpus("keeps supplied CHB stage roles and unknown screen support separate from reconstructed states and independent estimates", async () => {
  const source = tailFourInput(tailFourWorks[0]), row = (value: typeof source, id: string) => tailFourRow(value, id);
  expect(() => parseStudyMethodProfileLibrary(source)).not.toThrow();
  for (const token of [undefined, null, "null"]) {
    const partial = structuredClone(source);
    for (const id of ["repaired", "on-before", "on-after"]) {
      const quantity = tailFourQuantity(row(partial, id), "screen status");
      if (token === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = token;
    }
    expect(() => parseStudyMethodProfileLibrary(partial)).not.toThrow();
  }
  await persistTaskAndSampled(source); const retained = await loadResearchMethodSelection();
  for (const [id, property, token, error] of [
    ["repaired", "screen status", '"screen-on"', /known supplied screen-state support/],
    ["on-after", "screen status", '"screen-off"', /known supplied screen-state support/],
    ["bridge", "supplied off-run duration", "3.01", /up-to-three-second bridge/],
  ] as const) {
    const bad = structuredClone(source); tailFourQuantity(row(bad, id), property).evidence_value_json = token;
    await expect(persistTaskAndSampled(bad)).rejects.toThrow(error); expect(await loadResearchMethodSelection()).toBe(retained);
  }
  const wrongStage = structuredClone(source); row(wrongStage, "off").sampled_observation_references![0]!.sampled_observation_reference = row(wrongStage, "bridge").sampled_observation_id;
  expect(() => parseStudyMethodProfileLibrary(wrongStage)).toThrow(/compatible, distinct sampled observation/);
  const wrongTask = structuredClone(source); row(wrongTask, "trace-A").task_occurrence_reference = source.task_occurrences.find(task => task.task_occurrence_id.endsWith("-typical"))!.task_occurrence_id;
  expect(() => parseStudyMethodProfileLibrary(wrongTask)).toThrow(/compatible source questionnaire/);
  const arrayAnswer = structuredClone(source); arrayAnswer.task_occurrences.find(task => task.task_occurrence_id.endsWith("-night"))!.task_questionnaire_responses![0]!.response_value_json = '["turned off"]';
  expect(() => parseStudyMethodProfileLibrary(arrayAnswer)).toThrow(/night-phone-profile answer/);
  const independent = structuredClone(source); tailFourQuantity(row(independent, "weighted"), "supplied weighted estimate").evidence_value_json = "99.75";
  expect(() => parseStudyMethodProfileLibrary(independent)).not.toThrow(); expect(row(independent, "discrepancy")).toEqual(row(source, "discrepancy"));
});
itWithPrivateCorpus("retains Corona submission scope, ordered five app blocks, optional GPS and independent interval endpoints", async () => {
  const source = tailFourInput(tailFourWorks[1]), row = (value: typeof source, id: string) => tailFourRow(value, id);
  expect(row(source, "baseline").sampled_observation_references).toBeUndefined();
  expect(tailFourQuantity(row(source, "baseline"), "appdata_beginTime").evidence_value_json).toBe('"1594911276"');
  expect(tailFourQuantity(row(source, "baseline"), "appdata_endTime").evidence_value_json).toBe('"1595516076"');
  expect(tailFourQuantity(row(source, "GPS"), "sensordata_collected_at").evidence_value_json).not.toBe(tailFourQuantity(row(source, "EMA-A"), "appdata_collected_at").evidence_value_json);
  expect(row(source, "active").denotes_interval).toEqual({ start_instant: "supplied-active-start", end_instant: null, duration_seconds: 17.25, end_status: null });
  expect(row(source, "inactive").denotes_interval).toBeNull(); expect(row(source, "active-unknown")).not.toHaveProperty("denotes_interval");
  await persistTaskAndSampled(source);
  for (const members of [undefined, null, []]) {
    const partial = structuredClone(source); if (members === undefined) delete row(partial, "baseline").entity_members; else row(partial, "baseline").entity_members = members;
    expect(() => parseStudyMethodProfileLibrary(partial)).not.toThrow();
  }
  for (const [mutate, error] of [
    [(value: typeof source) => { row(value, "GPS").task_occurrence_reference = value.task_occurrences[0]!.task_occurrence_id; }, /two explicitly supplied questionnaire submissions/],
    [(value: typeof source) => { row(value, "GPS").participant_id = "foreign-person"; delete row(value, "GPS").task_occurrence_reference; }, /compatible, distinct sampled observation/],
    [(value: typeof source) => { row(value, "baseline").entity_members!.push({ ...structuredClone(row(value, "baseline").entity_members![0]!), entity_member_id: "sixth" }); }, /five source app blocks/],
    [(value: typeof source) => { row(value, "baseline").entity_members![1]!.quantities![0]!.evidence_value_json = "1"; }, /duplicates a known app block/],
    [(value: typeof source) => { tailFourQuantity(row(value, "GPS"), "sensordata_latitude").evidence_unit = "meters"; }, /evidence_unit/],
    [(value: typeof source) => { row(value, "active").denotes_interval = { duration_seconds: -1 }; }, /nonnegative/],
    [(value: typeof source) => { Object.assign(row(value, "active").denotes_interval!, { invented: true }); }, /unknown/],
    [(value: typeof source) => { row(value, "baseline").denotes_interval = null; }, /denotes_interval is incompatible/],
  ] as const) { const bad = structuredClone(source); mutate(bad); expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(error); }
});
itWithPrivateCorpus("preserves activity intervals, individual coder identities and characteristic-specific person-to-pooled summaries", () => {
  const source = tailFourInput(tailFourWorks[2]), row = (value: typeof source, id: string) => tailFourRow(value, id);
  expect(() => parseStudyMethodProfileLibrary(source)).not.toThrow();
  expect(tailFourQuantity(row(source, "centered"), "supplied centered rating").evidence_value_json).toBe("0.50");
  expect(tailFourQuantity(row(source, "category"), "supplied characteristic category").evidence_value_json).toBe("null");
  expect(row(source, "context-category").sampled_observation_references![0]!.relationship_label).toBe("place characteristic context");
  expect(row(source, "pooled-category")).not.toHaveProperty("participant_id");
  const unknown = structuredClone(source); unknown.task_occurrences.filter(task => task.assessor_id).forEach(task => { task.assessor_id = null; });
  row(unknown, "activity").denotes_interval = null; expect(() => parseStudyMethodProfileLibrary(unknown)).not.toThrow();
  const independent = structuredClone(source); tailFourQuantity(row(independent, "mean"), "supplied mean rating").evidence_value_json = "6.25";
  expect(() => parseStudyMethodProfileLibrary(independent)).not.toThrow(); expect(row(independent, "centered")).toEqual(row(source, "centered"));
  for (const [mutate, error] of [
    [(value: typeof source) => { value.task_occurrences.find(task => task.task_occurrence_id.endsWith("-coder-1"))!.assessor_id = value.task_occurrences.find(task => task.task_occurrence_id.endsWith("-coder-0"))!.assessor_id; }, /repeats a known coder/],
    [(value: typeof source) => { row(value, "coder-1-rating").observed_entity_token = "different-place"; }, /same supplied place identity/],
    [(value: typeof source) => { tailFourQuantity(row(value, "pooled-category"), "dimension").evidence_value_json = '"natural-urban"'; }, /known supplied dimension/],
    [(value: typeof source) => { row(value, "context-category").sampled_observation_references![0]!.sampled_observation_reference = row(value, "mean").sampled_observation_id; }, /compatible, distinct sampled observation/],
    [(value: typeof source) => { tailFourQuantity(row(value, "pooled-category"), "standard deviation").evidence_value_json = "-0.25"; }, /invalid supplied source quantity/],
    [(value: typeof source) => { row(value, "pooled-category").participant_id = "not-a-group"; }, /group subject/],
    [(value: typeof source) => { row(value, "GPS").denotes_interval = {}; }, /denotes_interval is incompatible/],
  ] as const) { const bad = structuredClone(source); mutate(bad); expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(error); }
});
itWithPrivateCorpus("preserves independent Sleep components/total, own previous quality and directed peer-day edges without calendar joins", () => {
  const source = tailFourInput(tailFourWorks[3]), row = (value: typeof source, id: string) => tailFourRow(value, id);
  expect(() => parseStudyMethodProfileLibrary(source)).not.toThrow();
  expect(source.task_occurrences[0]!.task_questionnaire_responses).toHaveLength(16);
  expect(source.task_occurrences[1]).not.toHaveProperty("task_questionnaire_responses"); // A supplied total-only completion is legitimate.
  expect(source.task_occurrences[0]!.criterion_assessments!.at(-2)!.assessment_value_json).toBe("17");
  expect(row(source, "edge-A").participant_id).not.toBe(row(source, "edge-B").participant_id);
  expect(row(source, "edge-A").sampled_observation_references!.slice(0, 2).map(reference => reference.sampled_observation_reference)).toEqual([row(source, "attributes-A").sampled_observation_id, row(source, "attributes-B").sampled_observation_id]);
  const independent = structuredClone(source); independent.task_occurrences[0]!.criterion_assessments![0]!.assessment_value_json = "0";
  tailFourQuantity(row(independent, "previous-A"), "previous day token").evidence_value_json = '"an unrelated lexical calendar encoding"';
  expect(() => parseStudyMethodProfileLibrary(independent)).not.toThrow();
  expect(independent.task_occurrences[0]!.criterion_assessments!.at(-2)).toEqual(source.task_occurrences[0]!.criterion_assessments!.at(-2));
  expect(row(independent, "prediction-A")).toEqual(row(source, "prediction-A"));
  for (const [mutate, error] of [
    [(value: typeof source) => { row(value, "edge-A").sampled_observation_references![1]!.sampled_observation_reference = row(value, "attributes-A").sampled_observation_id; }, /must identify another supplied user's record/],
    [(value: typeof source) => { row(value, "previous-A").sampled_observation_references![0]!.sampled_observation_reference = row(value, "quality-B").sampled_observation_id; }, /compatible, distinct sampled observation/],
    [(value: typeof source) => { tailFourQuantity(row(value, "attributes-B"), "day token").evidence_value_json = '"wrong-known-day"'; }, /known supplied day token/],
    [(value: typeof source) => { row(value, "prediction-A").sampled_observation_references![1]!.sampled_observation_reference = row(value, "attributes-B").sampled_observation_id; }, /compatible, distinct sampled observation/],
    [(value: typeof source) => { row(value, "attributes-A").device_id = "foreign-known-device"; }, /compatible, distinct sampled observation/],
    [(value: typeof source) => { row(value, "graph").participant_id = "invented-group-as-person"; }, /group subject/],
    [(value: typeof source) => { row(value, "call").sampled_observation_references = []; }, /incompatible with this observation/],
    [(value: typeof source) => { row(value, "night-A").denotes_interval = null; }, /denotes_interval is incompatible/],
  ] as const) { const bad = structuredClone(source); mutate(bad); expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(error); }
});

const assessmentTrioWorks = [
  "doi:10.1177/2050157921993896",
  "doi:10.2196/26540",
  "doi:10.1109/mprv.2015.54"
] as const;
const assessmentTrioRoutes = [
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.collection.app_open_timestamp",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_occurrence",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.collection.app_close_timestamp",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_occurrence",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.collection.notification_timestamp",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_occurrence",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.outcome.aggregate",
    "sourceRole": "feature_engineering",
    "sourceTarget": "outcome",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.preprocess.interval_between_completed_surveys",
    "sourceRole": "aggregation",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.preprocess.total_duration",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.preprocess.social_media_duration",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.preprocess.messenger_duration",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.preprocess.video_streaming_duration",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.preprocess.browser_duration",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.preprocess.game_duration",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.preprocess.fragmentation_final_operator",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.preprocess.notifications_count",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.preprocess.normalize_per_hour",
    "sourceRole": "aggregation",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.preprocess.analysis_csv_schema",
    "sourceRole": "event_schema",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.dsem.tinterval_assignment",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.dsem.within_random_predictor_slope",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "pilot.preprocess.label_recode",
    "sourceRole": "feature_engineering",
    "sourceTarget": "diary_response",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "pilot.preprocess.add_date",
    "sourceRole": "feature_engineering",
    "sourceTarget": "diary_response",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "pilot.preprocess.add_unix_time",
    "sourceRole": "feature_engineering",
    "sourceTarget": "diary_response",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "pilot.preprocess.per_person_means",
    "sourceRole": "aggregation",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "pilot.preprocess.per_person_sd",
    "sourceRole": "aggregation",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.2196/26540",
    "key": "collector.battery_delta_trigger",
    "sourceRole": "acquisition",
    "sourceTarget": "collector",
    "unique": true
  },
  {
    "work": "doi:10.2196/26540",
    "key": "preprocess.hourly_daily_resolution",
    "sourceRole": "aggregation",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.2196/26540",
    "key": "feature.epoch_counts",
    "sourceRole": "aggregation",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.2196/26540",
    "key": "feature.regularity_pair",
    "sourceRole": "aggregation",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.2196/26540",
    "key": "preprocess.participant_day_merge",
    "sourceRole": "aggregation",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.2196/26540",
    "key": "qc.day_exclusion_rule",
    "sourceRole": "quality_control",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.2196/26540",
    "key": "analysis.pooling_window",
    "sourceRole": "aggregation",
    "sourceTarget": "study_window",
    "unique": true
  },
  {
    "work": "doi:10.2196/26540",
    "key": "analysis.pool_entropy_regularity",
    "sourceRole": "aggregation",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.2196/26540",
    "key": "analysis.pool_sd",
    "sourceRole": "aggregation",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.2196/26540",
    "key": "analysis.ml.predictor_set_features",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.2196/26540",
    "key": "analysis.ml.predictor_set_demographics",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.2196/26540",
    "key": "analysis.ml.one_hot_demographics",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.2196/26540",
    "key": "analysis.lmm_standardization",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "ground_truth.default_alignment_window_days",
    "sourceRole": "aggregation",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "ground_truth.self_assessment_window_modification",
    "sourceRole": "aggregation",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "ground_truth.unstable_self_assessment_exclusion",
    "sourceRole": "quality_control",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "collector.components",
    "sourceRole": "event_schema",
    "sourceTarget": "collector",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "acceleration.resample_hz",
    "sourceRole": "reconstruction",
    "sourceTarget": "raw_record",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "acceleration.orientation_invariant_magnitude",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "acceleration.window_features",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "acceleration.daily_aggregation",
    "sourceRole": "aggregation",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "activity.score_definition",
    "sourceRole": "feature_engineering",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "gps.source",
    "sourceRole": "acquisition",
    "sourceTarget": "raw_record",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "gps.privacy_transform",
    "sourceRole": "reconstruction",
    "sourceTarget": "raw_record",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "gps.feature.outdoor_stays",
    "sourceRole": "feature_engineering",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "gps.daily_feature_count",
    "sourceRole": "feature_engineering",
    "sourceTarget": "participant_day",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "state_recognition.scope",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "state_recognition.primary_classifier",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "state_recognition.fusion.combine",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "change_detection.density",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "change_detection.distance",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "change_detection.normalization",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "change_detection.decision",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "change_detection.variant.and",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "change_detection.variant.or",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "change_detection.variant.weighted",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  }
];
const assessmentTrioTaskRoutes = [
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.outcome.items_fixed_order",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.outcome.scale",
    "kind": "response",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "main.outcome.aggregate",
    "kind": "criterion",
    "sourceRole": "feature_engineering",
    "sourceTarget": "outcome"
  },
  {
    "work": "doi:10.1177/2050157921993896",
    "key": "pilot.preprocess.item_columns",
    "kind": "response",
    "sourceRole": "event_schema",
    "sourceTarget": "diary_response"
  },
  {
    "work": "doi:10.2196/26540",
    "key": "schema.demographics",
    "kind": "response",
    "sourceRole": "input_schema",
    "sourceTarget": "participant record"
  },
  {
    "work": "doi:10.2196/26540",
    "key": "phq8.item_scale",
    "kind": "response",
    "sourceRole": "input_schema",
    "sourceTarget": "participant PHQ-8 measure"
  },
  {
    "work": "doi:10.2196/26540",
    "key": "phq8.total_range",
    "kind": "criterion",
    "sourceRole": "input_schema",
    "sourceTarget": "participant PHQ-8 measure"
  },
  {
    "work": "doi:10.2196/26540",
    "key": "phq8.binary_threshold",
    "kind": "criterion",
    "sourceRole": "analysis",
    "sourceTarget": "outcome"
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "ground_truth.clinical_instruments",
    "kind": "criterion",
    "sourceRole": "diary_schema",
    "sourceTarget": "outcome"
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "ground_truth.state_scale",
    "kind": "criterion",
    "sourceRole": "diary_schema",
    "sourceTarget": "outcome"
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "ground_truth.examiner",
    "kind": "criterion",
    "sourceRole": "acquisition",
    "sourceTarget": "outcome"
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "collector.components",
    "kind": "response",
    "sourceRole": "event_schema",
    "sourceTarget": "collector"
  },
  {
    "work": "doi:10.1109/mprv.2015.54",
    "key": "collector.daily_retrospective_consent",
    "kind": "response",
    "sourceRole": "quality_control",
    "sourceTarget": "participant_day"
  }
];
function assessmentTrioInput(work: string) {
  const profile = structuredClone(canonical().profiles.find(profile => profile.source_work_id === work)!);
  return { profiles: [profile], ...assessmentTrioExample(profile) };
}
const assessmentTrioRow = (input: ReturnType<typeof assessmentTrioInput>, suffix: string) => input.sampled_quantity_observations.find(row => row.sampled_observation_id.endsWith("-" + suffix))!;
itWithPrivateCorpus.each([
  [1, "encoded", "supplied encoded identities", "[1,null]", /explicitly supplied component identities/],
  [1, "encoded", "supplied encoded values", "[1e400,0]", /finite component values/],
  [2, "prediction-accel", "class identities", "[-3.5,1]", /clinical state identities/],
  [2, "prediction-accel", "class probabilities", "[-0.1,0.75]", /invalid supplied class probability/],
  [1, "encoded", "supplied encoded values", "[2,0]", /one-hot values/],
  [1, "quality-A", "supplied retained-day decision", "0", /supplied normalized decision/],
  [1, "hour-A", "day token", "7", /opaque identity\/text/],
  [1, "hour-A", "distinct app count", "1.5", /count\/measurement/],
  [1, "hour-A", "hour of day", "24", /hour-of-day value in 0\.\.23/],
  [0, "pilot-recode", "column number", "7", /pilot column 8\.\.33/],
  [0, "outcome-A", "GPS-ESM mean", "0", /incompatible supplied GPS-ESM mean/],
  [2, "prediction-accel", "supplied predicted state", "0.25", /clinical state with possible half grades/],
] as const)("rejects source-owned supplied assessment component %s %s %s", (index, suffix, property, token, error) => {
  const source = assessmentTrioInput(assessmentTrioWorks[index]);
  expect(() => parseStudyMethodProfileLibrary(source)).not.toThrow();
  const bad = structuredClone(source);
  assessmentTrioQuantity(assessmentTrioRow(bad, suffix), property).evidence_value_json = token;
  expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(error);
});
itWithPrivateCorpus("rejects recast snapshots and duplicate or unequal supplied assessment component identities", () => {
  const source = assessmentTrioInput(assessmentTrioWorks[1]);
  const cases: Array<[RegExp, (v: typeof source) => void]> = [
    [/must not recast this supplied snapshot\/feature as an event/, v => { assessmentTrioRow(v, "hour-A").source_event_time_token = "invented raw-arrival token"; }],
    [/duplicates a known supplied component identity/, v => { assessmentTrioQuantity(assessmentTrioRow(v, "encoded"), "supplied encoded identities").evidence_value_json = '["same","same"]'; }],
    [/unequal supplied component identity\/value lengths/, v => { assessmentTrioQuantity(assessmentTrioRow(v, "encoded"), "supplied encoded values").evidence_value_json = "[1]"; }],
  ];
  for (const [error, mutate] of cases) {
    const bad = structuredClone(source); mutate(bad);
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(error);
  }
});
const assessmentTrioQuantity = (row: SampledQuantityObservationRecord, property: string) => row.quantities!.find(quantity => quantity.observed_property === property)!;
itWithPrivateCorpus("rejects contradictory supplied assessment completions and day pairs while preserving unknown completion owners", () => {
  const row = assessmentTrioRow, quantity = assessmentTrioQuantity;
  const cases: Array<[string, RegExp, (v: ReturnType<typeof assessmentTrioInput>) => void]> = [
    [assessmentTrioWorks[0], /unambiguous source assessment/, v => { const task = v.task_occurrences.find(t => t.task_occurrence_id === row(v, "outcome-A").task_occurrence_reference)!; const a = task.criterion_assessments![0]!; task.criterion_assessments!.push({ ...structuredClone(a), criterion_assessment_id: a.criterion_assessment_id + ":duplicate" }); }],
    [assessmentTrioWorks[0], /must not invent a questionnaire\/clinical task/, v => { row(v, "feature-0").task_occurrence_reference = null; }],
    [assessmentTrioWorks[0], /explicitly supplied completion mean/, v => { quantity(row(v, "outcome-A"), "GPS-ESM mean").evidence_value_json = "5.50"; }],
    [assessmentTrioWorks[2], /supplied questionnaire day/, v => { quantity(row(v, "self-rating-A"), "day token").evidence_value_json = '"another supplied day"'; }],
    [assessmentTrioWorks[1], /two distinct supplied days/, v => { quantity(row(v, "day-pair"), "second day token").evidence_value_json = quantity(row(v, "day-pair"), "first day token").evidence_value_json; }],
    [assessmentTrioWorks[1], /outside its supplied day pair/, v => { const day = row(v, "day-A"); day.sampled_observation_references = day.sampled_observation_references!.filter(ref => ref.relationship_label === "day-pair regularity"); quantity(day, "day token").evidence_value_json = '"outside supplied pair"'; }],
  ];
  for (const [work, error, mutate] of cases) { const invalid = assessmentTrioInput(work); mutate(invalid); expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(error); }
  for (const [work, id] of [[assessmentTrioWorks[0], "outcome-A"], [assessmentTrioWorks[2], "default-A"]] as const) {
    const partial = assessmentTrioInput(work); row(partial, id).task_occurrence_reference = null;
    expect(parseStudyMethodProfileLibrary(partial).sampled_quantity_observations).toEqual(partial.sampled_quantity_observations);
  }
});
function isolatedAssessmentTrioInput(work: string, key: string) {
  const input = assessmentTrioInput(work), setting = input.profiles[0]!.method_settings.find(setting => setting.method_parameter_key === key)!;
  input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === setting.method_setting_id);
  input.sampled_quantity_observations.forEach(row => { delete row.task_occurrence_reference; delete row.sampled_observation_references; });
  input.task_occurrences = [];
  return input;
}
itWithPrivateCorpus.each(assessmentTrioRoutes)("admits the actual assessment source $work $key before rejecting invalid bodies/tuples", ({ work, key, sourceRole, sourceTarget, unique }) => {
  const input = isolatedAssessmentTrioInput(work, key), local = (value: typeof input) => value.profiles[0]!.method_settings.find(setting => setting.method_parameter_key === key)!;
  expect(input.sampled_quantity_observations.length).toBeGreaterThan(0);
  expect(() => parseStudyMethodProfileLibrary({ profiles: input.profiles })).not.toThrow();
  expect(parseStudyMethodProfileLibrary(input).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  const content: unknown = JSON.parse(String(local(input).method_value_json));
  const body = content !== null && typeof content === "object" && Object.hasOwn(content, "definition") ? (content as { definition: unknown }).definition : content;
  const wrapper = { definition: body, source_facing_role: sourceRole, source_facing_target: sourceTarget };
  for (const value of [body, wrapper]) { const valid = structuredClone(input); local(valid).method_value_json = JSON.stringify(value); expect(() => parseStudyMethodProfileLibrary(valid)).not.toThrow(); }
  for (const value of [null, {}, { conceptual_observation_roles: ["process/application identity", "bytes sent", "bytes received"] }, { ...wrapper, definition: null }, { ...wrapper, source_facing_role: "invented" }, { ...wrapper, source_facing_target: "invented" }]) {
    const bad = structuredClone(input); local(bad).method_value_json = JSON.stringify(value);
    expect(() => parseStudyMethodProfileLibrary({ profiles: bad.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  if (unique) {
    const foreign = structuredClone(input), owner = foreign.profiles[0]!;
    owner.source_work_id = "doi:10.1145/1879141.1879176";
    owner.method_settings.forEach(setting => { setting.source_work_id = owner.source_work_id; });
    foreign.sampled_quantity_observations.forEach(row => { row.source_work_id = owner.source_work_id; });
    expect(() => parseStudyMethodProfileLibrary({ profiles: [owner] })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow(/matching sampled-quantity definition/);
  }
});
itWithPrivateCorpus.each(assessmentTrioTaskRoutes)("admits only the original $work $key $kind instrument/criterion tuple", ({ work, key, kind, sourceRole, sourceTarget }) => {
  const input = assessmentTrioInput(work), local = (value: typeof input) => value.profiles[0]!.method_settings.find(setting => setting.method_parameter_key === key)!;
  const settingId = local(input).method_setting_id;
  input.sampled_quantity_observations = [];
  input.task_occurrences = input.task_occurrences.filter(task => kind === "response" ? task.task_questionnaire_responses?.some(response => response.questionnaire_setting_reference === settingId) : task.criterion_assessments?.some(assessment => assessment.criterion_setting_reference === settingId)).slice(0, 1);
  expect(input.task_occurrences).toHaveLength(1);
  const task = input.task_occurrences[0]!;
  task.task_questionnaire_responses = kind === "response" ? task.task_questionnaire_responses?.filter(response => response.questionnaire_setting_reference === settingId) : [];
  task.criterion_assessments = kind === "criterion" ? task.criterion_assessments?.filter(assessment => assessment.criterion_setting_reference === settingId) : [];
  task.criterion_assessments?.forEach(assessment => { delete assessment.support_criterion_assessment_references; delete assessment.support_task_action_references; });
  expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  const invalidValues: Record<string, Array<[string, unknown, RegExp]>> = {
    "main.outcome.items_fixed_order": [["observed_property", "undeclared question", /three main GPS-ESM questions/], ["response_value_json", "8", /seven-point GPS-ESM answer/], ["response_value_json", "true", /finite scalar or lexical unknown/]],
    "main.outcome.scale": [["observed_property", "undeclared question", /three main GPS-ESM questions/], ["response_value_json", "8", /seven-point GPS-ESM answer/]],
    "main.outcome.aggregate": [["assessment_value_json", "8", /GPS-ESM mean/]],
    "pilot.preprocess.item_columns": [["observed_property", "pilot column 34", /pilot item column/]],
    "schema.demographics": [["observed_property", "undeclared intake field", /disclosed intake field/]],
    "phq8.item_scale": [["observed_property", "PHQ-8 item 9", /ordinal PHQ-8 item identity/], ["response_value_json", "4", /PHQ-8 item in 0..3/]],
    "phq8.total_range": [["assessment_value_json", "25", /PHQ-8 total in 0..24/]],
    "phq8.binary_threshold": [["assessment_value_json", "2", /PHQ-8 binary outcome/]],
    "collector.daily_retrospective_consent": [["observed_property", "inferred consent", /normalized consent answer/], ["response_value_json", "1", /normalized consent answer/]],
    "collector.components": [["observed_property", "invented questionnaire wording", /self-assessment input/]],
    "ground_truth.state_scale": [["assessment_value_json", "3.5", /clinical -3..\+3 state/]],
    "ground_truth.clinical_instruments": [["criterion_label", "unreported clinical instrument", /named disclosed clinical instrument/]],
  };
  for (const [field, value, error] of invalidValues[key] ?? []) {
    const bad = structuredClone(input);
    const child = kind === "response" ? bad.task_occurrences[0]!.task_questionnaire_responses![0]! : bad.task_occurrences[0]!.criterion_assessments![0]!;
    Reflect.set(child, field, value);
    expect(() => parseStudyMethodProfileLibrary(bad), `${key}.${field}`).toThrow(error);
  }
  const content: unknown = JSON.parse(String(local(input).method_value_json)), body = content !== null && typeof content === "object" && Object.hasOwn(content, "definition") ? (content as { definition: unknown }).definition : content;
  const wrapper = { definition: body, source_facing_role: sourceRole, source_facing_target: sourceTarget };
  for (const value of [body, wrapper]) { const valid = structuredClone(input); local(valid).method_value_json = JSON.stringify(value); expect(() => parseStudyMethodProfileLibrary(valid)).not.toThrow(); }
  for (const value of [null, {}, { ...wrapper, definition: null }, { ...wrapper, source_facing_role: "invented" }, { ...wrapper, source_facing_target: "invented" }]) {
    const bad = structuredClone(input); local(bad).method_value_json = JSON.stringify(value);
    expect(() => parseStudyMethodProfileLibrary({ profiles: bad.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/compatible .*definition|local definition role\/target/);
  }
});
itWithPrivateCorpus("requires the actual assessment source companions and rejects duplicate local definitions after metadata validation", () => {
  for (const [work, key, companion] of [
    [assessmentTrioWorks[0], "main.preprocess.interval_between_completed_surveys", "main.preprocess.cross_day_intervals"],
    [assessmentTrioWorks[0], "main.dsem.tinterval_assignment", "main.dsem.tinterval_hours"],
    [assessmentTrioWorks[1], "collector.battery_delta_trigger", "schema.screen"],
    [assessmentTrioWorks[1], "analysis.pooling_window", "qc.minimum_days_before_phq8"],
    [assessmentTrioWorks[2], "ground_truth.self_assessment_window_modification", "ground_truth.window_modification_algorithm"],
    [assessmentTrioWorks[2], "change_detection.variant.weighted", "change_detection.normalization"],
  ]) {
    const source = isolatedAssessmentTrioInput(work!, key!);
    expect(() => parseStudyMethodProfileLibrary(source)).not.toThrow();
    const bad = structuredClone(source); bad.profiles[0]!.method_settings.find(setting => setting.method_parameter_key === companion)!.method_value_json = "{}";
    expect(() => parseStudyMethodProfileLibrary({ profiles: bad.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/matching sampled-quantity definition/);
    const duplicate = structuredClone(source), profile = duplicate.profiles[0]!, setting = profile.method_settings.find(setting => setting.method_parameter_key === companion)!;
    profile.method_settings.push({ ...structuredClone(setting), method_setting_id: setting.method_setting_id + ":duplicate" });
    profile.method_setting_count = profile.method_settings.length; profile.method_setting_ids = profile.method_settings.map(setting => setting.method_setting_id);
    expect(() => parseStudyMethodProfileLibrary({ profiles: [profile] })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(duplicate)).toThrow(/matching sampled-quantity definition/);
  }
});
itWithPrivateCorpus.each(assessmentTrioWorks)("preserves assessment tasks and sampled relationships through existing IDB/reparse and generated owners: %s", async work => {
  const source = assessmentTrioInput(work);
  await persistTaskAndSampled(source);
  assertTemporalGeneratedShapes(source);
  const expected = new Set(assessmentTrioRoutes.filter(route => route.work === work).map(route => route.key));
  expect(new Set(source.sampled_quantity_observations.map(row => source.profiles[0]!.method_settings.find(setting => setting.method_setting_id === row.method_setting_reference)!.method_parameter_key))).toEqual(expected);
  const reverse = structuredClone(source); reverse.task_occurrences.reverse(); reverse.sampled_quantity_observations.reverse();
  reverse.sampled_quantity_observations.forEach(row => row.sampled_observation_references?.reverse());
  await persistTaskAndSampled(reverse); // Supplied order is preserved, not interpreted as chronology.
});
itWithPrivateCorpus("keeps consecutive completed-survey endpoints across days and misses separate from a three-hour model grid", async () => {
  const source = assessmentTrioInput(assessmentTrioWorks[0]), row = (value: typeof source, id: string) => assessmentTrioRow(value, id);
  expect(source.task_occurrences[0]!.referenced_day_token).not.toBe(source.task_occurrences[1]!.referenced_day_token);
  expect(row(source, "interval-AB").sampled_observation_references![1]!.sampled_observation_reference).toBe(row(source, "interval-BC").sampled_observation_references![0]!.sampled_observation_reference);
  expect(assessmentTrioQuantity(row(source, "interval-AB"), "elapsed hours").evidence_value_json).toBe("27.50");
  const differentEncoding = structuredClone(source); row(differentEncoding, "outcome-A").source_event_time_token = "independent-source-time-encoding";
  expect(() => parseStudyMethodProfileLibrary(differentEncoding)).not.toThrow();
  await persistTaskAndSampled(source); const retained = await loadResearchMethodSelection();
  for (const [mutate, error] of [
    [(value: typeof source) => { row(value, "interval-AB").sampled_observation_references![1]!.sampled_observation_reference = row(value, "outcome-A").sampled_observation_id; }, /distinct supplied completed surveys/],
    [(value: typeof source) => { row(value, "interval-AB").sampled_observation_references![1]!.sampled_observation_reference = row(value, "notification").sampled_observation_id; }, /compatible, distinct sampled observation/],
    [(value: typeof source) => { row(value, "analysis").sampled_observation_references![1]!.sampled_observation_reference = row(value, "outcome-C").sampled_observation_id; assessmentTrioQuantity(row(value, "analysis"), "p").evidence_value_json = "5.25"; }, /interval-ending completion/],
    [(value: typeof source) => { row(value, "outcome-A").task_occurrence_reference = source.task_occurrences.find(task => task.task_occurrence_id.endsWith("-pilot"))!.task_occurrence_id; }, /actual GPS-ESM completion/],
    [(value: typeof source) => { assessmentTrioQuantity(row(value, "per-hour"), "predictor family").evidence_value_json = '"fragmentation"'; }, /predictor family/],
    [(value: typeof source) => { assessmentTrioQuantity(row(value, "pilot-recode"), "column number").evidence_value_json = "8"; }, /ordinary\/special pilot column/],
    [(value: typeof source) => { row(value, "open").sampled_observation_references = null; }, /incompatible with this observation/],
  ] as const) { const bad = structuredClone(source); mutate(bad); await expect(persistTaskAndSampled(bad)).rejects.toThrow(error); expect(await loadResearchMethodSelection()).toBe(retained); }
  const independent = structuredClone(source); assessmentTrioQuantity(row(independent, "feature-0"), "supplied feature").evidence_value_json = "99.500";
  expect(() => parseStudyMethodProfileLibrary(independent)).not.toThrow(); expect(row(independent, "per-hour")).toEqual(row(source, "per-hour"));
});
itWithPrivateCorpus("retains PHQ8 battery snapshots, particular hours and independent 14-day pooling without transition/scoring inference", () => {
  const source = assessmentTrioInput(assessmentTrioWorks[1]), row = (value: typeof source, id: string) => assessmentTrioRow(value, id);
  expect(assessmentTrioQuantity(row(source, "snapshot-A"), "screen sample").evidence_value_json).toBe('"locked"');
  expect(assessmentTrioQuantity(row(source, "hour-A"), "screen modal state").evidence_value_json).toBe('"on"');
  expect(assessmentTrioQuantity(row(source, "hour-A"), "particular hour token").evidence_value_json).not.toBe(assessmentTrioQuantity(row(source, "hour-B"), "particular hour token").evidence_value_json);
  const totalOnly = structuredClone(source), completion = totalOnly.task_occurrences.find(task => task.task_occurrence_id.endsWith("-PHQ-A"))!;
  delete completion.task_questionnaire_responses; completion.criterion_assessments = completion.criterion_assessments!.slice(0, 1);
  expect(() => parseStudyMethodProfileLibrary(totalOnly)).not.toThrow();
  for (const [mutate, error] of [
    [(value: typeof source) => { row(value, "window-A").task_occurrence_reference = value.task_occurrences[0]!.task_occurrence_id; }, /actual source questionnaire completion/],
    [(value: typeof source) => { assessmentTrioQuantity(row(value, "window-A"), "window days").evidence_value_json = "7"; }, /two-week PHQ8/],
    [(value: typeof source) => { row(value, "SD").sampled_observation_references![0]!.sampled_observation_reference = row(value, "window-B").sampled_observation_id; }, /different known PHQ8 assessment windows/],
    [(value: typeof source) => { row(value, "features-only").sampled_observation_references!.push(structuredClone(row(value, "features-demographics").sampled_observation_references![3]!)); }, /incompatible sampled-observation relationship/],
    [(value: typeof source) => { assessmentTrioQuantity(row(value, "hour-A"), "day token").evidence_value_json = '"another-day"'; }, /day membership|day owner/],
    [(value: typeof source) => { assessmentTrioQuantity(row(value, "snapshot-A"), "screen sample").evidence_value_json = '"on"'; }, /source category/],
    [(value: typeof source) => { row(value, "snapshot-A").source_event_time_token = "invented-transition"; }, /recast this supplied snapshot/],
    [(value: typeof source) => { assessmentTrioQuantity(row(value, "SD"), "pooled SD").evidence_value_json = "-0.5"; }, /count\/measurement/],
  ] as const) { const bad = structuredClone(source); mutate(bad); expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(error); }
  const independent = structuredClone(source); independent.task_occurrences.find(task => task.task_occurrence_id.endsWith("-PHQ-A"))!.task_questionnaire_responses![0]!.response_value_json = "3";
  assessmentTrioQuantity(row(independent, "quality-A"), "supplied retained-day decision").evidence_value_json = "false";
  expect(() => parseStudyMethodProfileLibrary(independent)).not.toThrow();
  expect(row(independent, "window-A")).toEqual(row(source, "window-A")); // No missingness threshold or total recomputation.
});
itWithPrivateCorpus("preserves clinician role/identity, self-rating window modification and modality-specific decision stages", () => {
  const source = assessmentTrioInput(assessmentTrioWorks[2]), row = (value: typeof source, id: string) => assessmentTrioRow(value, id);
  const clinical = source.task_occurrences.find(task => task.task_occurrence_id.endsWith("-clinical-A"))!;
  expect(clinical.assessor_id).toBe("supplied-clinician-A");
  expect(clinical.criterion_assessments![0]!.assessment_value_json).toBe('"specifically trained clinical psychologist"');
  expect(assessmentTrioQuantity(row(source, "modified"), "days before assessment").evidence_value_json).toBe("5");
  expect(assessmentTrioQuantity(row(source, "self-rating-A"), "supplied self-assessment rating").evidence_value_json).toBe("2.25");
  expect(row(source, "weighted").sampled_observation_references!.map(reference => reference.relationship_label)).toEqual(["accelerometer normalized distance", "GPS normalized distance"]);
  for (const [mutate, error] of [
    [(value: typeof source) => {
      const task = value.task_occurrences.find(task => task.task_occurrence_id.endsWith("-clinical-A"))!;
      const stateId = value.profiles[0]!.method_settings.find(setting => setting.method_parameter_key === "ground_truth.state_scale")!.method_setting_id;
      const state = task.criterion_assessments!.find(assessment => assessment.criterion_setting_reference === stateId)!;
      const otherState = { ...structuredClone(state), criterion_assessment_id: state.criterion_assessment_id + ":other" };
      task.criterion_assessments!.push(otherState); state.support_criterion_assessment_references = [otherState.criterion_assessment_id];
    }, /clinical role\/instrument supports/],
    [(value: typeof source) => { value.task_occurrences.find(task => task.task_occurrence_id.endsWith("-clinical-A"))!.criterion_assessments![0]!.assessment_value_json = '"participant self-rater"'; }, /clinical assessor role/],
    [(value: typeof source) => { row(value, "default-A").task_occurrence_reference = value.task_occurrences.find(task => task.task_occurrence_id.endsWith("-diary-A"))!.task_occurrence_id; }, /actual clinical assessment/],
    [(value: typeof source) => { row(value, "modified").sampled_observation_references![0]!.sampled_observation_reference = row(value, "default-B").sampled_observation_id; }, /clinical assessment owner/],
    [(value: typeof source) => { assessmentTrioQuantity(row(value, "assigned-A"), "supplied assigned clinical state").evidence_value_json = "-2.0"; }, /clinical state assignment/],
    [(value: typeof source) => { assessmentTrioQuantity(row(value, "default-A"), "days before assessment").evidence_value_json = "6"; }, /default clinical/],
    [(value: typeof source) => { row(value, "resampled").sampled_observation_references![0]!.sampled_observation_reference = row(value, "magnitude").sampled_observation_id; }, /compatible, distinct sampled observation/],
    [(value: typeof source) => { assessmentTrioQuantity(row(value, "model-accel"), "modality").evidence_value_json = '"GPS"'; }, /model modality/],
    [(value: typeof source) => { row(value, "fusion").sampled_observation_references![1]!.sampled_observation_reference = row(value, "prediction-accel").sampled_observation_id; }, /fusion modality/],
    [(value: typeof source) => { row(value, "weighted").sampled_observation_references![0]!.sampled_observation_reference = row(value, "decision-accel").sampled_observation_id; }, /compatible, distinct sampled observation/],
    [(value: typeof source) => { row(value, "weighted").sampled_observation_references![1]!.sampled_observation_reference = row(value, "normalized-accel").sampled_observation_id; }, /weighted-distance modality/],
    [(value: typeof source) => { row(value, "and").sampled_observation_references![0]!.sampled_observation_reference = row(value, "normalized-accel").sampled_observation_id; }, /compatible, distinct sampled observation/],
    [(value: typeof source) => { row(value, "raw").sampled_observation_references = []; }, /raw signal/],
  ] as const) { const bad = structuredClone(source); mutate(bad); expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(error); }
  const partial = structuredClone(source); row(partial, "weighted").sampled_observation_references = [structuredClone(row(partial, "weighted").sampled_observation_references![0]!)];
  partial.task_occurrences.find(task => task.task_occurrence_id.endsWith("-clinical-A"))!.assessor_id = null;
  expect(() => parseStudyMethodProfileLibrary(partial)).not.toThrow();
  const independent = structuredClone(source); assessmentTrioQuantity(row(independent, "self-rating-A"), "supplied self-assessment rating").evidence_value_json = "-99.00";
  assessmentTrioQuantity(row(independent, "weighted"), "supplied weighted distance").evidence_value_json = "-7.25";
  expect(() => parseStudyMethodProfileLibrary(independent)).not.toThrow(); // Self-rating scale is unreported; the described weighted computation is not re-executed on independently supplied results.
  expect(row(independent, "modified")).toEqual(row(source, "modified"));
});
itWithPrivateCorpus("retains missing/null/JSON-null/lexical measurements and only supplied source-local assessment relationships", () => {
  for (const [work, suffix, property] of [[assessmentTrioWorks[0], "feature-0", "supplied feature"], [assessmentTrioWorks[1], "mean", "pooled mean"], [assessmentTrioWorks[2], "raw", "supplied acceleration reading"]]) {
    const source = assessmentTrioInput(work!);
    for (const value of [undefined, null, "null", "0.000", ' "unreported" ']) {
      const changed = structuredClone(source), quantity = assessmentTrioQuantity(assessmentTrioRow(changed, suffix!), property!);
      if (value === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = value;
      expect(parseStudyMethodProfileLibrary(changed).sampled_quantity_observations).toEqual(changed.sampled_quantity_observations);
    }
    const bad = structuredClone(source); assessmentTrioRow(bad, suffix!).device_id = "another known device";
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/compatible, distinct sampled observation/);
    const unknown = structuredClone(source); assessmentTrioRow(unknown, suffix!).device_id = null;
    expect(() => parseStudyMethodProfileLibrary(unknown)).not.toThrow();
  }
  const source = assessmentTrioInput(assessmentTrioWorks[2]);
  for (const refs of [undefined, null, []]) {
    const partial = structuredClone(source), row = assessmentTrioRow(partial, "weighted");
    if (refs === undefined) delete row.sampled_observation_references; else row.sampled_observation_references = refs;
    expect(() => parseStudyMethodProfileLibrary(partial)).not.toThrow();
  }
});
itWithPrivateCorpus("keeps Kim per-student normalizations strict and rejects known cohort selection/denominator/unit contradictions", () => {
  const source = cohortAppInput(cohortAppWorks[1]);
  expect(() => parseStudyMethodProfileLibrary(classroomInput(cohortAppWorks[1]))).not.toThrow();
  for (const [id,property,value] of [
    ["support","top-ten participant support","101"],["support","supporting participants","2.5"],
    ["selected-0","selected top-five membership","1"],["LMS","selected top-five membership","true"],
    ["subset","selected-app duration fraction","1.1"],["multitasking","mean apps per session","false"],
  ]) {
    const wrong = structuredClone(source), row = wrong.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith(id!))!;
    row.quantities!.find(q => q.observed_property === property)!.evidence_value_json = value!;
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
  }
  const outside = structuredClone(source); outside.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith("selected-0"))!.observed_entity_token = "not one of the printed selected apps";
  expect(() => parseStudyMethodProfileLibrary(outside)).toThrow("disclosed selected app set");
  const companion = structuredClone(source); companion.profiles[0]!.method_settings.find(s => s.method_parameter_key === "apps.support_search_step")!.method_value_json = "null";
  expect(() => parseStudyMethodProfileLibrary(companion)).toThrow();
});
itWithPrivateCorpus.each(cohortAppWorks)("preserves aggregate payloads through existing generated JSON Schema/Pydantic: %s", work => {
  const input = cohortAppInput(work), schemaPath = resolve(import.meta.dirname,"../../schema/generated/json-schema/chronicle-research-ontology.schema.json");
  const pydanticPath = resolve(import.meta.dirname,"../../schema/generated/pydantic");
  const script = [
    "import json,sys","from jsonschema import Draft202012Validator","sys.path.insert(0,sys.argv[2])",
    "import chronicle_research_ontology as model","schema=json.load(open(sys.argv[1])); data=json.load(sys.stdin)",
    "validator=Draft202012Validator({'$ref':'#/$defs/SampledQuantityObservationRecord','$defs':schema['$defs']})",
    "for row in data['sampled_quantity_observations']:",
    " validator.validate(row); assert model.SampledQuantityObservationRecord(**row).model_dump(exclude_unset=True)==row",
    " assert not validator.is_valid(dict(row,invented_owner=True))","print('cohort-app-shapes-preserved')",
  ].join("\n");
  expect(execFileSync("uvx",["--from","linkml==1.10.0","--with","jsonschema","python","-c",script,schemaPath,pydanticPath],
    {input:JSON.stringify(input),encoding:"utf8",timeout:180_000}).trim()).toBe("cohort-app-shapes-preserved");
});

itWithPrivateCorpus("keeps Kim means, SDs, prevalence, semester/day-type and measurement bases independent", () => {
  const source = cohortAppInput(cohortAppWorks[1]);
  const meanIds = ["notification-mean","multitasking","class-summary","prevalence","half-0","half-1","day-type-0","day-type-1","day-type-2","measurement-basis-0","measurement-basis-1","measurement-basis-2","measurement-basis-3"];
  const rows = source.sampled_quantity_observations.filter(r => meanIds.some(id => r.sampled_observation_id === "constructed:cohort-app-"+id));
  expect(rows).toHaveLength(meanIds.length);
  for (const row of rows) for (const sd of row.quantities!.filter(q => q.observed_property.startsWith("SD "))) {
    const wrong = structuredClone(source), changed = wrong.sampled_quantity_observations.find(r => r.sampled_observation_id === row.sampled_observation_id)!;
    const target = changed.quantities!.find(q => q.observed_property === sd.observed_property && q.quantity_qualifier === sd.quantity_qualifier)!;
    target.evidence_value_json = "-1.00";
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow("invalid supplied numeric cohort/app summary");
    for (const value of [undefined,null,"null","0",'"unreported SD token"']) {
      const unknown = structuredClone(source), q = unknown.sampled_quantity_observations.find(r => r.sampled_observation_id === row.sampled_observation_id)!.quantities!
        .find(q => q.observed_property === sd.observed_property && q.quantity_qualifier === sd.quantity_qualifier)!;
      if (value === undefined) delete q.evidence_value_json; else q.evidence_value_json = value;
      const parsed = parseStudyMethodProfileLibrary(unknown);
      expect(parsed.sampled_quantity_observations).toEqual(unknown.sampled_quantity_observations);
      expect(unknown.sampled_quantity_observations.find(r => r.sampled_observation_id === row.sampled_observation_id)!.quantities!.filter(q => q.observed_property.startsWith("mean ")))
        .toEqual(row.quantities!.filter(q => q.observed_property.startsWith("mean ")));
    }
  }
  for (const id of ["half-0","day-type-0","measurement-basis-0"]) {
    const wrong = structuredClone(source);
    wrong.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith(id))!.quantities![1]!.quantity_qualifier = "incompatible supplied basis";
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow("supplied summary basis");
  }
  expect(source.sampled_quantity_observations.filter(r => r.sampled_observation_id.includes("half-")).flatMap(r => r.quantities!.filter(q => q.quantity_qualifier).map(q => q.quantity_qualifier)))
    .toEqual([...Array<string>(4).fill("weeks 3-7"),...Array<string>(4).fill("weeks 9-15")]);
  expect(source.sampled_quantity_observations.every(r => !Object.hasOwn(r,"referenced_day_token") && !Object.hasOwn(r,"participant_id"))).toBe(true);
});
itWithPrivateCorpus("preserves finite signed normalization, heatmap encodings and explicitly supplied differences without allowing negative counts/durations/SD", () => {
  const kim = cohortAppInput(cohortAppWorks[1]), angry = cohortAppInput(cohortAppWorks[0]);
  kim.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith("rank"))!.quantities![1]!.evidence_value_json = "-0.25";
  kim.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith("rank"))!.quantities![2]!.evidence_value_json = "-1.50";
  angry.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith("hour-category"))!.quantities![3]!.evidence_value_json = "-0.50";
  for (const input of [kim,angry]) {
    expect(parseStudyMethodProfileLibrary(input).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
    const infinite = structuredClone(input); infinite.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith(input === kim ? "rank" : "hour-category"))!.quantities![input === kim ? 1 : 3]!.evidence_value_json = "1e999";
    expect(() => parseStudyMethodProfileLibrary(infinite)).toThrow("invalid supplied numeric cohort/app summary");
  }
  const difference = kim.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith("class-overall"))!;
  expect(difference.quantities!.find(q => q.observed_property === "comparison basis")!.evidence_value_json)
    .toBe('"in-class shorter than overall; subtraction convention unspecified"');
  const misleading = structuredClone(kim);
  misleading.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith("class-overall"))!.quantities!.find(q => q.observed_property === "comparison basis")!.evidence_value_json
    = '"in-class versus overall; reported direction unspecified"';
  expect(() => parseStudyMethodProfileLibrary(misleading)).toThrow("incompatible supplied cohort/app summary value");
  expect(difference.quantities!.find(q => q.observed_property === "reported session-duration difference")!.evidence_value_json).toBe("-2.00");
  const unrelated = structuredClone(kim);
  unrelated.sampled_quantity_observations.find(r => r.sampled_observation_id.endsWith("class-summary"))!.quantities![1]!.evidence_value_json = "-2.00";
  expect(() => parseStudyMethodProfileLibrary(unrelated)).toThrow("invalid supplied numeric cohort/app summary");
});

function backDeviceInput() {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === "doi:10.1145/2470654.2481330")!);
  return { profiles: [profile], ...backDeviceAuthenticationExample(profile) };
}
itWithPrivateCorpus("rejects contradictory rear/front roles and input encodings without decoding opaque coordinate series", () => {
  const source = backDeviceInput();
  const row = (v: typeof source, id: string) => v.sampled_quantity_observations.find(r => r.participant_id === "constructed:back-person-A" && r.sampled_observation_id === "constructed:back-" + id)!;
  const quantity = (v: typeof source, id: string, property: string) => row(v, id).quantities!.find(q => q.observed_property === property)!;
  for (const [id, property, token, error] of [["rear-points", "device role", '"side"', /supplied rear\/front device role/], ["password", "shape count", "false", /supplied count or opaque lexical encoding/], ["input", "digit input", "true", /independent supplied digit\/stroke input or opaque lexical encoding/]] as const) {
    const invalid = structuredClone(source); quantity(invalid, id, property).evidence_value_json = token; expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(error);
  }
  const opaque = structuredClone(source); quantity(opaque, "front-points", "coordinate point series").evidence_value_json = '"opaque coordinate serialization"';
  expect(parseStudyMethodProfileLibrary(opaque).sampled_quantity_observations).toEqual(opaque.sampled_quantity_observations);
  const wrongFront = structuredClone(source); quantity(wrongFront, "front-points", "device role").evidence_value_json = '"rear"'; delete row(wrongFront, "front-points").sampled_observation_references;
  expect(() => parseStudyMethodProfileLibrary(wrongFront)).toThrow(/requires the supplied front-coordinate point series/);
});
const backDeviceRoots = ["prototype.touch_forwarding", "shapes.finger_lift_segmentation", "shapes.shortstraw", "shapes.consecutive_duplicate_rule", "shapes.shape_storage", "shapes.password_shape_count", "main.input_logging"] as const;
const backDeviceTaskRoots = ["main.questionnaire", "pilot.error_definition", "shapes.authentication_decision", "main.session_termination", "error.basic_definition", "error.critical_definition", "security.outcome_categories", "speed.boundaries", "error.categories"] as const;
itWithPrivateCorpus.each(backDeviceRoots)("accepts actual Back-of-device %s and rejects altered definition/source/tuple without generic fallback", key => {
  const input = backDeviceInput(), local = (value: typeof input) => value.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  input.task_occurrences = [];
  input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === local(input).method_setting_id);
  for (const row of input.sampled_quantity_observations) { delete row.sampled_observation_references; delete row.task_occurrence_reference; }
  expect(input.sampled_quantity_observations.length).toBeGreaterThan(0);
  expect(parseStudyMethodProfileLibrary(input).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  const body: unknown = JSON.parse(String(local(input).method_value_json));
  const wrapped = { definition: body, source_facing_role: local(input).method_setting_role, source_facing_target: local(input).method_target_layer };
  const wrapper = structuredClone(input); local(wrapper).method_value_json = JSON.stringify(wrapped);
  expect(parseStudyMethodProfileLibrary(wrapper).sampled_quantity_observations).toEqual(wrapper.sampled_quantity_observations);
  for (const value of [null, {}, { conceptual_observation_roles: ["process/application identity", "bytes sent", "bytes received"] },
    { ...wrapped, definition: null }, { ...wrapped, definition: "wrong" }, { ...wrapped, source_facing_role: null }, { ...wrapped, source_facing_target: "acquired_snapshot" },
    { ...wrapped, source_facing_role: undefined }, { ...wrapped, source_facing_target: undefined }]) {
    const wrong = structuredClone(input); local(wrong).method_value_json = JSON.stringify(value);
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
  }
  for (const [field, value] of [["source_work_id", "doi:foreign"], ["method_setting_role", "reporting"], ["method_target_layer", "acquired_snapshot"]] as const) {
    const wrong = structuredClone(input); Reflect.set(local(wrong), field, value);
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
  }
  const foreign = structuredClone(input), work = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.source_work_id = work; foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = work; });
  foreign.sampled_quantity_observations.forEach(row => { row.source_work_id = work; });
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow();
});
itWithPrivateCorpus.each(backDeviceTaskRoots)("admits actual Back-of-device %s only through its source-bound response/criterion guard", key => {
  const source = backDeviceInput(), local = (value: typeof source) => value.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  source.sampled_quantity_observations = [];
  for (const task of source.task_occurrences) {
    task.task_questionnaire_responses = task.task_questionnaire_responses?.filter(r => r.questionnaire_setting_reference === local(source).method_setting_id);
    task.criterion_assessments = task.criterion_assessments?.filter(r => r.criterion_setting_reference === local(source).method_setting_id);
    for (const a of task.criterion_assessments ?? []) delete a.support_criterion_assessment_references;
  }
  source.task_occurrences = source.task_occurrences.filter(task => task.task_questionnaire_responses?.length || task.criterion_assessments?.length);
  expect(source.task_occurrences.length).toBeGreaterThan(0);
  expect(parseStudyMethodProfileLibrary(source).task_occurrences).toEqual(source.task_occurrences);
  if (key === "error.basic_definition" || key === "error.critical_definition") {
    const bad = structuredClone(source);
    bad.task_occurrences[0]!.criterion_assessments![0]!.assessment_value_json = "true";
    bad.profiles[0]!.method_settings.find(s => s.method_parameter_key === "error.mutual_exclusion")!.method_value_json = "{}";
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow("basic/critical mutual-exclusion definition");
  }
  const body: unknown = JSON.parse(String(local(source).method_value_json)), wrapper = {
    definition: body, source_facing_role: local(source).method_setting_role, source_facing_target: local(source).method_target_layer,
  };
  const correct = structuredClone(source); local(correct).method_value_json = JSON.stringify(wrapper);
  expect(parseStudyMethodProfileLibrary(correct).task_occurrences).toEqual(correct.task_occurrences);
  for (const value of [null, {}, { ...wrapper, definition: null }, { ...wrapper, definition: 3 }, { ...wrapper, source_facing_role: null },
    { ...wrapper, source_facing_target: null }, { ...wrapper, source_facing_role: "reporting" }, { ...wrapper, source_facing_target: "acquired_snapshot" },
    { ...wrapper, source_facing_role: undefined }, { ...wrapper, source_facing_target: undefined }]) {
    const wrong = structuredClone(source); local(wrong).method_value_json = JSON.stringify(value);
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
  }
  const foreign = structuredClone(source), work = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.source_work_id = work; foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = work; });
  foreign.task_occurrences.forEach(task => { task.source_work_id = work; });
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow();
});
itWithPrivateCorpus("roundtrips Back-of-device stage ownership, repeated equal shapes and actual assessment tasks through IndexedDB without executing source methods", async () => {
  const input = backDeviceInput(), parsed = parseStudyMethodProfileLibrary(input);
  expect(input.profiles[0]!.method_settings).toHaveLength(112);
  expect(parsed.sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  expect(parsed.task_occurrences).toEqual(input.task_occurrences);
  const byId = (id: string) => input.sampled_quantity_observations.filter(row => row.sampled_observation_id === "constructed:back-" + id);
  expect(byId("rear-points")).toHaveLength(2);
  expect(new Set(byId("rear-points").map(row => row.participant_id)).size).toBe(2);
  expect(new Set(byId("front-points").map(row => row.device_id)).size).toBe(2);
  expect(byId("raw-strokes")[0]!.quantities![0]!.evidence_value_json).toBe('["Up","Down","Down","Left"]');
  expect(byId("filtered-strokes")[0]!.quantities![0]!.evidence_value_json).toBe('["Up","Down","Left"]');
  const shapes = input.sampled_quantity_observations.filter(row => row.sampled_observation_id.startsWith("constructed:back-shape-"));
  expect(shapes).toHaveLength(6); expect(new Set(shapes.map(row => row.quantities![1]!.evidence_value_json)).size).toBe(1);
  expect(byId("password")[0]!.sampled_observation_references!.map(link => link.relationship_label)).toEqual(["shape 1", "shape 2", "shape 3"]);
  const changed = structuredClone(input), chars = changed.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:back-shape-2")!;
  chars.quantities![1]!.evidence_value_json = '"independently supplied character encoding"';
  expect(chars.quantities![0]).toEqual(shapes[0]!.quantities![0]);
  const persist = async (value: typeof input) => {
    const records = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: records.profiles[0], selectedLevels: {},
      sampled_quantity_observations: records.sampled_quantity_observations, task_occurrences: records.task_occurrences }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile } & ReturnType<typeof backDeviceAuthenticationExample>;
    expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], sampled_quantity_observations: saved.sampled_quantity_observations,
      task_occurrences: saved.task_occurrences }).sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
    expect(saved.task_occurrences).toEqual(value.task_occurrences);
  };
  await persist(input); await persist(changed);
  for (const membership of [undefined, null, []]) {
    const value = structuredClone(input);
    for (const row of value.sampled_quantity_observations) {
      if (membership === undefined) delete row.sampled_observation_references; else row.sampled_observation_references = membership;
    }
    await persist(value);
  }
  for (const value of [undefined, null, "null", "[]", '"opaque direction token"']) {
    const unknown = structuredClone(input), row = unknown.sampled_quantity_observations.find(r => r.sampled_observation_id === "constructed:back-shape-1")!;
    if (value === undefined) delete row.quantities![0]!.evidence_value_json; else row.quantities![0]!.evidence_value_json = value;
    await persist(unknown);
  }
});
itWithPrivateCorpus("rejects known Back-of-device ownership/stage/cardinality contradictions without globally uniquifying local IDs", () => {
  const input = backDeviceInput();
  const row = (v: typeof input, id: string) => v.sampled_quantity_observations.find(r => r.participant_id === "constructed:back-person-A" && r.sampled_observation_id === "constructed:back-" + id)!;
  const mutations: ((v: typeof input) => void)[] = [
    v => { row(v, "rear-points").participant_id = "constructed:foreign-person"; },
    v => { row(v, "rear-points").source_work_id = "doi:foreign"; },
    v => { row(v, "rear-points").device_id = row(v, "front-points").device_id; },
    v => { row(v, "rear-points").quantities![0]!.evidence_value_json = '"front"'; },
    v => { row(v, "front-points").quantities![0]!.evidence_value_json = '"rear"'; },
    v => { row(v, "front-points").sampled_observation_references![0]!.sampled_observation_reference = "constructed:back-shape-1"; },
    v => { row(v, "lift").sampled_observation_references![0]!.sampled_observation_reference = "constructed:back-rear-points"; },
    v => { row(v, "raw-strokes").sampled_observation_references![0]!.sampled_observation_reference = "constructed:back-shape-1"; },
    v => { row(v, "password").sampled_observation_references![1]!.sampled_observation_reference = "constructed:back-shape-1"; },
    v => { row(v, "password").sampled_observation_references!.push({ ...row(v, "password").sampled_observation_references![0]!, relationship_label: "shape 4" }); },
    v => { row(v, "password").quantities![0]!.evidence_value_json = "2"; },
    v => { row(v, "password").sampled_observation_references![0]!.sampled_observation_reference = "constructed:back-password"; },
    v => { row(v, "password").sampled_observation_references!.push({ ...row(v, "password").sampled_observation_references![0]! }); },
    v => { const duplicate = structuredClone(row(v, "rear-points")); duplicate.device_id = "constructed:second-rear-A"; v.sampled_quantity_observations.push(duplicate); },
    v => { row(v, "password").task_occurrence_reference = "constructed:back-attack"; row(v, "password").device_id = "constructed:other-front"; },
  ];
  for (const mutate of mutations) { const wrong = structuredClone(input); mutate(wrong); expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(); }
  const unknown = structuredClone(input);
  delete row(unknown, "rear-points").device_id;
  expect(parseStudyMethodProfileLibrary(unknown).sampled_quantity_observations).toEqual(unknown.sampled_quantity_observations);
  const partial = structuredClone(input); row(partial, "password").sampled_observation_references = [row(partial, "password").sampled_observation_references![2]!];
  expect(parseStudyMethodProfileLibrary(partial).sampled_quantity_observations).toEqual(partial.sampled_quantity_observations);
  const unknownRoles = structuredClone(input);
  row(unknownRoles, "rear-points").quantities![0]!.evidence_value_json = "null"; delete row(unknownRoles, "front-points").quantities![0]!.evidence_value_json;
  expect(parseStudyMethodProfileLibrary(unknownRoles).sampled_quantity_observations).toEqual(unknownRoles.sampled_quantity_observations);
  const shuffled = structuredClone(input); shuffled.sampled_quantity_observations.reverse();
  expect(parseStudyMethodProfileLibrary(shuffled).sampled_quantity_observations).toEqual(shuffled.sampled_quantity_observations);
});
itWithPrivateCorpus("keeps raw duplicate directions valid, rejects known final repeats and malformed values, and retains unknown/empty distinctions", () => {
  const input = backDeviceInput(), row = (v: typeof input, id: string) => v.sampled_quantity_observations.find(r => r.sampled_observation_id === "constructed:back-" + id)!;
  for (const [id, property, value] of [
    ["filtered-strokes", "stroke labels", '["Down","Down"]'], ["shape-1", "stroke labels", '["Down","Down"]'],
    ["shape-1", "stroke labels", '["Up","Down","Left","Right"]'], ["shape-1", "stroke labels", '["Up",null,"Down","Left","Right"]'],
    ["raw-strokes", "stroke labels", '["North"]'], ["raw-strokes", "stroke labels", "[1]"], ["front-points", "coordinate point series", '[[true]]'],
    ["front-points", "coordinate point series", '{"invented":1}'], ["front-points", "coordinate point series", "[[1e999]]"],
    ["shape-1", "stored direction characters", "0"], ["password", "shape count", "4"], ["password", "shape count", "1.5"],
    ["input", "system", '"unknown invented system"'], ["lift", "event", '"screen lock"'],
  ] as const) {
    const wrong = structuredClone(input); row(wrong, id).quantities!.find(q => q.observed_property === property)!.evidence_value_json = value;
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
  }
  for (const value of ['["Down","Down"]', '["Up","Down","Left","Right"]', "[null]", "[]", '"unrecovered raw encoding"', "null"]) {
    const knownRaw = structuredClone(input); row(knownRaw, "raw-strokes").quantities![0]!.evidence_value_json = value;
    expect(parseStudyMethodProfileLibrary(knownRaw).sampled_quantity_observations).toEqual(knownRaw.sampled_quantity_observations);
  }
  for (const value of ['["Up",null,"Down",null,"Left"]', "[null,null,null,null]", "[]", '"opaque completed-shape encoding"', "null"]) {
    const partial = structuredClone(input); row(partial, "shape-1").quantities![0]!.evidence_value_json = value;
    expect(parseStudyMethodProfileLibrary(partial).sampled_quantity_observations).toEqual(partial.sampled_quantity_observations);
  }
  for (const value of [undefined, null, []]) {
    const empty = structuredClone(input); for (const r of empty.sampled_quantity_observations) {
      if (value === undefined) delete r.quantities; else r.quantities = value;
    }
    expect(parseStudyMethodProfileLibrary(empty).sampled_quantity_observations).toEqual(empty.sampled_quantity_observations);
  }
  for (const key of ["prototype.device", "prototype.network", "shapes.no_repeated_direction", "shapes.strokes_per_shape"]) {
    const wrong = structuredClone(input); wrong.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!.method_value_json = "null";
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
  }
});
itWithPrivateCorpus("preserves independent authentication/error/attack outcomes and rejects only known contradictions or foreign task supports", () => {
  const input = backDeviceInput(), auth = (v: typeof input) => v.task_occurrences.find(t => t.task_occurrence_id === "constructed:back-authentication")!;
  const criterion = (v: typeof input, id: string) => auth(v).criterion_assessments!.find(a => a.criterion_assessment_id === id)!;
  const changed = structuredClone(input); criterion(changed, "authentication-time").assessment_value_json = "900.00";
  expect(auth(changed).task_actions).toEqual(auth(input).task_actions);
  expect(parseStudyMethodProfileLibrary(changed).task_occurrences).toEqual(changed.task_occurrences);
  for (const mutate of [
    (v: typeof input) => { criterion(v, "critical-error").assessment_value_json = " true "; },
    (v: typeof input) => { criterion(v, "basic-error").assessment_value_json = "1"; },
    (v: typeof input) => { criterion(v, "authentication-time").assessment_value_json = "-1"; },
    (v: typeof input) => { criterion(v, "termination").assessment_value_json = '"screen lock"'; },
    (v: typeof input) => { criterion(v, "authentication-outcome").assessment_value_json = '"accepted"'; },
    (v: typeof input) => { criterion(v, "error-category").assessment_value_json = '"invented error category"'; },
    (v: typeof input) => { criterion(v, "authentication-time").support_task_action_references = ["review-attack"]; },
    (v: typeof input) => { v.task_occurrences.find(t => t.task_occurrence_id === "constructed:back-exit")!.task_questionnaire_responses![0]!.observed_property = "invented full questionnaire item"; },
  ]) { const wrong = structuredClone(input); mutate(wrong); expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(); }
  for (const value of [undefined, null, "null"]) {
    const unknown = structuredClone(input); for (const task of unknown.task_occurrences) for (const a of task.criterion_assessments ?? []) {
      if (value === undefined) delete a.assessment_value_json; else a.assessment_value_json = value;
    }
    expect(parseStudyMethodProfileLibrary(unknown).task_occurrences).toEqual(unknown.task_occurrences);
  }
});
itWithPrivateCorpus("preserves Back-of-device existing shapes through generated JSON Schema/Pydantic without claiming cross-record execution", () => {
  const input = backDeviceInput(), schemaPath = resolve(import.meta.dirname, "../../schema/generated/json-schema/chronicle-research-ontology.schema.json");
  const pydanticPath = resolve(import.meta.dirname, "../../schema/generated/pydantic");
  const script = [
    "import json,sys", "from jsonschema import Draft202012Validator", "sys.path.insert(0,sys.argv[2])",
    "import chronicle_research_ontology as model", "schema=json.load(open(sys.argv[1])); data=json.load(sys.stdin)",
    "for name,rows in [('SampledQuantityObservationRecord',data['sampled_quantity_observations']),('TaskOccurrenceRecord',data['task_occurrences'])]:",
    " validator=Draft202012Validator({'$ref':'#/$defs/'+name,'$defs':schema['$defs']})",
    " for row in rows:",
    "  validator.validate(row); assert getattr(model,name)(**row).model_dump(exclude_unset=True)==row",
    "  assert not validator.is_valid(dict(row,invented_owner=True))",
    "print('back-device-existing-shapes-preserved')",
  ].join("\n");
  expect(execFileSync("uvx", ["--from", "linkml==1.10.0", "--with", "jsonschema", "python", "-c", script, schemaPath, pydanticPath],
    { input: JSON.stringify(input), encoding: "utf8", timeout: 180_000 }).trim()).toBe("back-device-existing-shapes-preserved");
});


function timeKillingInput() {
  const profile = structuredClone(canonical().profiles.find(p=>p.source_work_id === "doi:10.1145/3544548.3580689")!);
  return { profiles:[profile], ...timeKillingObservationExample(profile) };
}
const timeKillingSampleKeys = ["collector.sensor_streams","sequence.timestamp_pairing","sequence.lookback","sequence.padding","feature.transportation","feature.day_and_time","feature.battery","feature.screen_and_orientation","feature.foreground_app","feature.network","feature.audio_ringer_volume_call","feature.interaction_events","model.target","clustering.user_features","clustering.user_kmeans","correlation.method","app_distribution.method","evaluation.metrics"];
const timeKillingResponseKeys = ["study.final_questionnaires","study.optional_interviews","annotation.actual_activity_item","notification.esm_items"];
const timeKillingRow = (input:ReturnType<typeof timeKillingInput>,id:string) => input.sampled_quantity_observations.find(r=>r.sampled_observation_id === "constructed:time-killing-"+id)!;
const timeKillingQuantity = (input:ReturnType<typeof timeKillingInput>,id:string,property:string) => timeKillingRow(input,id).quantities!.find(q=>q.observed_property === property)!;
const timeKillingSetting = (input:ReturnType<typeof timeKillingInput>,key:string) => input.profiles[0]!.method_settings.find(s=>s.method_parameter_key === key)!;

itWithPrivateCorpus("rejects malformed TimeKilling supplied quantities, cohort scope and annotation dimensions", () => {
  const source = timeKillingInput();
  const cases: Array<[string, (v: typeof source) => void]> = [
    ["pooled outputs", v => { timeKillingRow(v, "evaluation").participant_id = "invented individual"; }],
    ["probability-coordinate pairs", v => { timeKillingQuantity(v, "evaluation", "ROC curve").evidence_value_json = "[[0,1,0]]"; }],
    ["independent supplied Boolean", v => { timeKillingQuantity(v, "battery", "charging status").evidence_value_json = "1"; }],
    ["scalar/lexical evidence", v => { timeKillingQuantity(v, "day-time", "day of week").evidence_value_json = "{}"; }],
    ["cohort/group scope", v => { timeKillingQuantity(v, "evaluation", "population scope").evidence_value_json = '"Group 5"'; }],
    ["cohort/category identity", v => { delete timeKillingRow(v, "evaluation").observed_entity_token; }],
    ["one supplied source-compatible population scope", v => { timeKillingRow(v, "evaluation").quantities = timeKillingRow(v, "evaluation").quantities!.filter(q => q.observed_property !== "population scope"); }],
    ["session-cluster designation", v => { timeKillingQuantity(v, "cluster-proportions", "session cluster proportion").quantity_qualifier = "Group 1"; }],
    ["quantity qualifier", v => { timeKillingQuantity(v, "evaluation", "accuracy").quantity_qualifier = "unreported axis"; }],
    ["nonblank supplied token", v => { timeKillingRow(v, "pair-A").screenshot_record_reference = " "; }],
    ["app period", v => { v.screenshot_sessions[0]!.app_identifier = null; }],
    ["matching source annotation definition", v => { v.screenshot_sessions[0]!.screenshot_range_annotations![0]!.method_setting_reference = timeKillingSetting(v, "annotation.actual_activity_item").method_setting_id; }],
    ["range_label_values_json must contain an object or JSON null", v => { v.screenshot_sessions[0]!.screenshot_range_annotations![0]!.range_label_values_json = "[]"; }],
    ["independent annotation value", v => { v.screenshot_sessions[0]!.screenshot_range_annotations![0]!.range_label_values_json = '{"time-killing and notification availability":"unreported category"}'; }],
    ["scope/unit/property", v => { v.device_use_sessions[0]!.session_quantities![0]!.quantity_scope = "app"; }],
    ["invalid independently supplied session feature", v => { v.device_use_sessions[0]!.session_quantities![0]!.evidence_value_json = "-1"; }],
    ["session cluster distinct", v => { v.device_use_sessions[0]!.session_labels![0]!.observed_property = "user group"; }],
    ["lexical JSON or field null", v => { Reflect.set(v.device_use_sessions[0]!.session_labels![0]!, "label_value_json", 1); }],
  ];
  for (const [message, mutate] of cases) {
    const invalid = structuredClone(source); mutate(invalid);
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(message);
  }
  for (const token of [undefined, null]) {
    const partial = structuredClone(source), quantity = partial.device_use_sessions[0]!.session_quantities![0]!, annotation = partial.screenshot_sessions[0]!.screenshot_range_annotations![0]!;
    if (token === undefined) { delete quantity.evidence_value_json; delete annotation.range_label_values_json; }
    else { quantity.evidence_value_json = token; annotation.range_label_values_json = token; }
    expect(parseStudyMethodProfileLibrary(partial).device_use_sessions).toEqual(partial.device_use_sessions);
    expect(parseStudyMethodProfileLibrary(partial).screenshot_sessions).toEqual(partial.screenshot_sessions);
  }
  const jsonNull = structuredClone(source); jsonNull.screenshot_sessions[0]!.screenshot_range_annotations![0]!.range_label_values_json = "null";
  expect(parseStudyMethodProfileLibrary(jsonNull).screenshot_sessions).toEqual(jsonNull.screenshot_sessions);
});

itWithPrivateCorpus("preserves all TimeKilling source families and supplied links through import, IndexedDB and reopen without model/tensor execution", async () => {
  const input=timeKillingInput();
  expect(input.profiles[0]!.method_settings).toHaveLength(150);
  const persist = async (value:ReturnType<typeof timeKillingInput>) => {
    const parsed=parseStudyMethodProfileLibrary(value);
    for (const channel of ["sampled_quantity_observations","screenshot_sessions","device_use_sessions","task_occurrences","notification_histories"] as const) {
      expect(parsed[channel]).toEqual(value[channel]);
    }
    await saveResearchMethodSelection(JSON.stringify({profile:parsed.profiles[0],
      sampled_quantity_observations:parsed.sampled_quantity_observations,screenshot_sessions:parsed.screenshot_sessions,
      device_use_sessions:parsed.device_use_sessions,task_occurrences:parsed.task_occurrences,notification_histories:parsed.notification_histories}));
    const saved=JSON.parse((await loadResearchMethodSelection())!) as {profile:StudyMethodProfile}&ReturnType<typeof timeKillingObservationExample>;
    const {profile,...records}=saved;
    const reopened=parseStudyMethodProfileLibrary({profiles:[profile],...records});
    for (const channel of ["sampled_quantity_observations","screenshot_sessions","device_use_sessions","task_occurrences","notification_histories"] as const) expect(reopened[channel]).toEqual(value[channel]);
  };
  await persist(input);
  const changed=structuredClone(input);
  timeKillingQuantity(changed,"battery","average phone-battery level").evidence_value_json="42.000";
  changed.device_use_sessions[0]!.session_quantities![0]!.evidence_value_json="900.00";
  expect(changed.screenshot_sessions).toEqual(input.screenshot_sessions);
  expect(changed.sampled_quantity_observations.filter(r=>r.sampled_observation_id.includes("sequence-"))).toEqual(input.sampled_quantity_observations.filter(r=>r.sampled_observation_id.includes("sequence-")));
  await persist(changed);
  for (const root of timeKillingSampleKeys) expect(input.sampled_quantity_observations.some(r=>r.method_setting_reference === timeKillingSetting(input,root).method_setting_id)).toBe(true);
  expect(input.device_use_sessions.map(s=>s.session_labels![0]!.label_value_json)).toEqual(['"A"','"E"']);
  expect(input.task_occurrences).toHaveLength(5); expect(input.notification_histories).toHaveLength(4);
  expect(timeKillingRow(input,"pad-0").quantities).toEqual(timeKillingRow(input,"pad-1").quantities);
  expect(timeKillingRow(input,"pad-0").sampled_observation_id).not.toBe(timeKillingRow(input,"pad-1").sampled_observation_id);
});

itWithPrivateCorpus.each([...timeKillingSampleKeys,...timeKillingResponseKeys,"reconstruction.phone_session_gap_retention","clustering.session_features","clustering.session_kmeans"])(
  "isolates TimeKilling %s actual-source ingress and rejects malformed body/wrappers/tuple before generic fallback",key=>{
    const input=timeKillingInput(),setting=timeKillingSetting(input,key);
    input.sampled_quantity_observations=input.sampled_quantity_observations.filter(r=>r.method_setting_reference===setting.method_setting_id);
    for (const row of input.sampled_quantity_observations) {
      delete row.sampled_observation_references; delete row.screenshot_session_reference; delete row.screenshot_record_reference;
    }
    input.task_occurrences=input.task_occurrences.filter(t=>t.task_questionnaire_responses?.some(r=>r.questionnaire_setting_reference===setting.method_setting_id));
    input.device_use_sessions=["reconstruction.phone_session_gap_retention","clustering.session_features","clustering.session_kmeans"].includes(key) ? input.device_use_sessions : [];
    input.screenshot_sessions=[]; input.notification_histories=[];
    expect(parseStudyMethodProfileLibrary(input).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
    const old=JSON.parse(String(setting.method_value_json)) as unknown;
    const bare=old!==null && typeof old==="object" && !Array.isArray(old) && Object.hasOwn(old,"definition")
      ? (old as {definition:unknown}).definition : old;
    const bodyOnly=structuredClone(input);timeKillingSetting(bodyOnly,key).method_value_json=JSON.stringify(bare);
    expect(()=>parseStudyMethodProfileLibrary(bodyOnly)).not.toThrow();
    for (const definition of [null,{},[],false,"wrong disclosed body"]) {
      const wrong=structuredClone(input);timeKillingSetting(wrong,key).method_value_json=JSON.stringify({source_facing_role:"foreign",source_facing_target:"foreign",definition});
      expect(()=>parseStudyMethodProfileLibrary(wrong)).toThrow();
    }
    for (const definition of [null,false,17,"wrong body"]) {
      const wrong=structuredClone(input);timeKillingSetting(wrong,key).method_value_json=JSON.stringify({
        ...(old!==null && typeof old==="object" && !Array.isArray(old) ? old : {}),definition});
      expect(()=>parseStudyMethodProfileLibrary(wrong)).toThrow();
    }
    for (const field of ["source_facing_role","source_facing_target"]) for (const value of [undefined,null,"foreign"]) {
      const wrong=structuredClone(input),content={...(old!==null&&typeof old==="object"&&!Array.isArray(old)?old:{}),definition:bare} as Record<string,unknown>;
      if(value===undefined)delete content[field];else content[field]=value;
      timeKillingSetting(wrong,key).method_value_json=JSON.stringify(content);expect(()=>parseStudyMethodProfileLibrary(wrong)).toThrow();
    }
  });

itWithPrivateCorpus("keeps supplied feature scope/axis/window combinations exact while retaining omitted/null qualifiers",()=>{
  const input=timeKillingInput(),current="current characteristics at screenshot capture",session="current phone-use-session characteristics accumulated through the screenshot";
  for(const [id,property,qualifier] of [
    ["battery","average phone-battery level",current],
    ["interaction","screen-on past-window count",current+"; window seconds: 90"],
    ["interaction","accessibility past-window count",current+"; event: swipe; window seconds: 30"],
    ["interaction","accessibility past-window count",current+"; event: click; window seconds: 90"],
    ["audio","stream volume",current+"; stream: alarms"],
    ["transportation","cumulative time per activity",session+"; activity: running"],
    ["apps","cumulative app-category usage time",session+"; app-category basis: top-15 category; category: "],
  ]) {const wrong=structuredClone(input);timeKillingQuantity(wrong,id!,property!).quantity_qualifier=qualifier;expect(()=>parseStudyMethodProfileLibrary(wrong)).toThrow(/property\/scope\/window\/activity\/stream/);}
  for(const qualifier of [undefined,null]) {
    // Remove one supplied axis at a time. Erasing all axes together would
    // collapse independently qualified, same-property quantities into duplicates.
    // One clone, each quantity edited then put back: cloning the whole library
    // per quantity made this test brush the 5 s timeout under load.
    const unknown=structuredClone(input);
    for (const row of unknown.sampled_quantity_observations) for (const quantity of row.quantities ?? []) {
      const had=Object.hasOwn(quantity,"quantity_qualifier"), original=quantity.quantity_qualifier;
      if(qualifier===undefined)delete quantity.quantity_qualifier;else quantity.quantity_qualifier=qualifier;
      expect(parseStudyMethodProfileLibrary(unknown).sampled_quantity_observations).toEqual(unknown.sampled_quantity_observations);
      if(had)quantity.quantity_qualifier=original;else delete quantity.quantity_qualifier;
    }
    const collapsed=structuredClone(input);
    for (const row of collapsed.sampled_quantity_observations) for (const quantity of row.quantities ?? []) {
      if (qualifier===undefined) delete quantity.quantity_qualifier; else quantity.quantity_qualifier=qualifier;
    }
    expect(()=>parseStudyMethodProfileLibrary(collapsed)).toThrow("unknown or duplicated within observation");
  }
  for(const [id,property,value] of [["day-time","day of week","7"],["day-time","hour of day","24"],["day-time","hour of day","1.5"],["battery","charging count","-1"],["transportation","physical activity",'"running"']]) {
    const wrong=structuredClone(input);timeKillingQuantity(wrong,id!,property!).evidence_value_json=value;expect(()=>parseStudyMethodProfileLibrary(wrong)).toThrow();
  }
  for(const value of [undefined,null,"null",'"0.000"']) {
    const lexical=structuredClone(input);if(value===undefined)delete timeKillingQuantity(lexical,"day-time","day of week").evidence_value_json;
    else timeKillingQuantity(lexical,"day-time","day of week").evidence_value_json=value;
    expect(parseStudyMethodProfileLibrary(lexical).sampled_quantity_observations).toEqual(lexical.sampled_quantity_observations);
  }
});

itWithPrivateCorpus("resolves supplied screenshot parent/child and paired-capture links without contradictory identities or guessed clock equality",()=>{
  const input=timeKillingInput();
  for(const mutate of [
    (v:ReturnType<typeof timeKillingInput>)=>{timeKillingRow(v,"pair-A").screenshot_session_reference="unknown-parent";},
    (v:ReturnType<typeof timeKillingInput>)=>{timeKillingRow(v,"pair-A").screenshot_record_reference="image-C";},
    (v:ReturnType<typeof timeKillingInput>)=>{delete timeKillingRow(v,"pair-A").screenshot_session_reference;},
    (v:ReturnType<typeof timeKillingInput>)=>{v.screenshot_sessions[0]!.participant_id="foreign-person";},
    (v:ReturnType<typeof timeKillingInput>)=>{v.screenshot_sessions[0]!.device_id="foreign-device";},
    (v:ReturnType<typeof timeKillingInput>)=>{const duplicate=structuredClone(v.screenshot_sessions[0]!);delete duplicate.device_id;v.screenshot_sessions.push(duplicate);delete timeKillingRow(v,"pair-A").device_id;},
    (v:ReturnType<typeof timeKillingInput>)=>{timeKillingRow(v,"battery").screenshot_record_reference="image-A";},
    (v:ReturnType<typeof timeKillingInput>)=>{timeKillingRow(v,"battery").screenshot_session_reference="constructed:time-killing-phone-use-B";timeKillingRow(v,"battery").screenshot_record_reference="image-C";},
    (v:ReturnType<typeof timeKillingInput>)=>{timeKillingRow(v,"pad-0").screenshot_session_reference=null;},
  ]) {const wrong=structuredClone(input);mutate(wrong);expect(()=>parseStudyMethodProfileLibrary(wrong)).toThrow();}
  for(const unknown of [undefined,null]) {
    const value=structuredClone(input);
    for(const row of value.sampled_quantity_observations) {
      if(unknown===undefined){delete row.screenshot_session_reference;delete row.screenshot_record_reference;}
      else if(row.screenshot_session_reference!==undefined){row.screenshot_session_reference=null;row.screenshot_record_reference=null;}
    }
    expect(parseStudyMethodProfileLibrary(value).sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
  }
  const parentOnly=structuredClone(input);delete timeKillingRow(parentOnly,"battery").screenshot_record_reference;
  expect(parseStudyMethodProfileLibrary(parentOnly).sampled_quantity_observations).toEqual(parentOnly.sampled_quantity_observations);
  const partial=structuredClone(input);timeKillingRow(partial,"pair-B").screenshot_record_reference=null;
  timeKillingRow(partial,"battery").screenshot_record_reference="image-A";
  expect(parseStudyMethodProfileLibrary(partial).sampled_quantity_observations).toEqual(partial.sampled_quantity_observations);
  const times=structuredClone(input);timeKillingRow(times,"pair-A").observation_instant="unrelated collector-time encoding";
  times.screenshot_sessions[0]!.screenshots[0]!.screenshot_instant="separate captured-image time encoding";
  expect(parseStudyMethodProfileLibrary(times).screenshot_sessions).toEqual(times.screenshot_sessions);
});

itWithPrivateCorpus("retains explicit padding, partial seven-pair membership and nonoverlap without demanding complete images or tensor arithmetic",()=>{
  const input=timeKillingInput();
  for(const mutate of [
    (v:ReturnType<typeof timeKillingInput>)=>{timeKillingRow(v,"sequence-A").sampled_observation_references![6]!.sampled_observation_reference="constructed:time-killing-pad-0";},
    (v:ReturnType<typeof timeKillingInput>)=>{timeKillingRow(v,"sequence-B").sampled_observation_references![1]!.sampled_observation_reference="constructed:time-killing-pair-A";},
    (v:ReturnType<typeof timeKillingInput>)=>{timeKillingRow(v,"sequence-A").sampled_observation_references![0]!.relationship_label="pair position 8";},
    (v:ReturnType<typeof timeKillingInput>)=>{timeKillingRow(v,"sequence-A").sampled_observation_references![0]!.sampled_observation_reference="unknown-pair";},
    (v:ReturnType<typeof timeKillingInput>)=>{timeKillingRow(v,"sequence-A").sampled_observation_references![1]!.relationship_label="pair position 1";},
    (v:ReturnType<typeof timeKillingInput>)=>{timeKillingQuantity(v,"pair-A","phone-sensor feature vector").evidence_value_json=JSON.stringify(Array.from({length:184},()=>0));},
    (v:ReturnType<typeof timeKillingInput>)=>{timeKillingQuantity(v,"pad-0","padding kind").evidence_value_json='"captured image"';},
    (v:ReturnType<typeof timeKillingInput>)=>{timeKillingRow(v,"sequence-A").sampled_observation_references!.push({relationship_label:"pair position 2",sampled_observation_reference:"constructed:time-killing-sequence-A",source_locators:["supplied self"]});},
  ]) {const wrong=structuredClone(input);mutate(wrong);expect(()=>parseStudyMethodProfileLibrary(wrong)).toThrow();}
  for(const membership of [undefined,null,[]]) {
    const partial=structuredClone(input);for(const row of partial.sampled_quantity_observations)if(Object.hasOwn(row,"sampled_observation_references")){
      if(membership===undefined)delete row.sampled_observation_references;else row.sampled_observation_references=membership;
    }
    expect(parseStudyMethodProfileLibrary(partial).sampled_quantity_observations).toEqual(partial.sampled_quantity_observations);
  }
  for(const value of ['[]','[null,0]','"opaque vector"',"null"]) {
    const partial=structuredClone(input);timeKillingQuantity(partial,"pair-A","phone-sensor feature vector").evidence_value_json=value;
    expect(parseStudyMethodProfileLibrary(partial).sampled_quantity_observations).toEqual(partial.sampled_quantity_observations);
  }
});

itWithPrivateCorpus("keeps source topics on required observed_property even when optional labels are omitted/null, and leaves coding unknown",()=>{
  const input=timeKillingInput();
  for(const task of input.task_occurrences)for(const response of task.task_questionnaire_responses??[]) {
    for(const label of [undefined,null]) {
      const wrong=structuredClone(input),target=wrong.task_occurrences.find(t=>t.task_occurrence_id===task.task_occurrence_id)!.task_questionnaire_responses!.find(r=>r.questionnaire_response_id===response.questionnaire_response_id)!;
      target.observed_property="unrelated known topic";if(label===undefined)delete target.questionnaire_item_label;else target.questionnaire_item_label=label;
      expect(()=>parseStudyMethodProfileLibrary(wrong)).toThrow(/disclosed topic|activity-report meaning/);
    }
  }
  for(const label of [undefined,null]) {
    const valid=structuredClone(input);for(const task of valid.task_occurrences)for(const r of task.task_questionnaire_responses??[]){
      if(label===undefined)delete r.questionnaire_item_label;else r.questionnaire_item_label=label;
    }
    expect(parseStudyMethodProfileLibrary(valid).task_occurrences).toEqual(valid.task_occurrences);
  }
  for(const value of [undefined,null,"null",'{"supplied response":"unknown coding"}']) {
    const valid=structuredClone(input);for(const task of valid.task_occurrences)for(const r of task.task_questionnaire_responses??[]){
      if(value===undefined)delete r.response_value_json;else r.response_value_json=value;
    }
    expect(parseStudyMethodProfileLibrary(valid).task_occurrences).toEqual(valid.task_occurrences);
  }
  const session=structuredClone(input);session.device_use_sessions[0]!.session_labels![0]!.label_value_json='"Group 1"';
  expect(()=>parseStudyMethodProfileLibrary(session)).toThrow();
  const classifier=structuredClone(input);classifier.screenshot_sessions[0]!.screenshot_range_annotations![0]!.assessor_id="invented coder";
  expect(()=>parseStudyMethodProfileLibrary(classifier)).toThrow();
});

itWithPrivateCorpus("preserves TimeKilling existing generated shapes and new optional screenshot references, not importer reference execution",()=>{
  const input=timeKillingInput(),schemaPath=resolve(import.meta.dirname,"../../schema/generated/json-schema/chronicle-research-ontology.schema.json");
  const pydanticPath=resolve(import.meta.dirname,"../../schema/generated/pydantic");
  const script=[
    "import json,sys","from jsonschema import Draft202012Validator","sys.path.insert(0,sys.argv[2])","import chronicle_research_ontology as model",
    "schema=json.load(open(sys.argv[1])); data=json.load(sys.stdin)",
    "for name,key in [('SampledQuantityObservationRecord','sampled_quantity_observations'),('ScreenshotSessionRecord','screenshot_sessions'),('DeviceUseSessionRecord','device_use_sessions'),('TaskOccurrenceRecord','task_occurrences'),('NotificationHistoryRecord','notification_histories')]:",
    " validator=Draft202012Validator({'$ref':'#/$defs/'+name,'$defs':schema['$defs']})",
    " for row in data[key]:",
    "  validator.validate(row); assert getattr(model,name)(**row).model_dump(exclude_unset=True)==row",
    "  assert not validator.is_valid(dict(row,invented_owner=True))",
    "print('time-killing-shapes-preserved')",
  ].join("\n");
  expect(execFileSync("uvx",["--from","linkml==1.10.0","--with","jsonschema","python","-c",script,schemaPath,pydanticPath],
    {input:JSON.stringify(input),encoding:"utf8",timeout:180_000}).trim()).toBe("time-killing-shapes-preserved");
});

const typingMotionWorks = [
  "doi:10.1007/978-3-319-23222-5_4",
  "doi:10.1007/s10916-020-1530-z",
  "doi:10.1109/tifs.2015.2506542"
] as const;
const typingMotionRoutes = [
  {
    "work": "doi:10.1007/978-3-319-23222-5_4",
    "key": "sensor.stream.raw_accelerometer",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_record",
    "unique": true
  },
  {
    "work": "doi:10.1007/978-3-319-23222-5_4",
    "key": "sensor.stream.low_pass_accelerometer",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_record",
    "unique": true
  },
  {
    "work": "doi:10.1007/978-3-319-23222-5_4",
    "key": "sensor.stream.high_pass_accelerometer",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_record",
    "unique": true
  },
  {
    "work": "doi:10.1007/978-3-319-23222-5_4",
    "key": "sensor.stream.gravity",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_record",
    "unique": true
  },
  {
    "work": "doi:10.1007/978-3-319-23222-5_4",
    "key": "sensor.stream.gyroscope",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_record",
    "unique": true
  },
  {
    "work": "doi:10.1007/978-3-319-23222-5_4",
    "key": "sensor.stream.magnetometer",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_record",
    "unique": true
  },
  {
    "work": "doi:10.1007/978-3-319-23222-5_4",
    "key": "sensor.stream.orientation",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_record",
    "unique": true
  },
  {
    "work": "doi:10.1007/978-3-319-23222-5_4",
    "key": "sensor.magnitude_formula",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1007/978-3-319-23222-5_4",
    "key": "feature.sensor.matrix_shape",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1007/978-3-319-23222-5_4",
    "key": "feature.touch.count",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1007/978-3-319-23222-5_4",
    "key": "fusion.input_pair",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1007/978-3-319-23222-5_4",
    "key": "study.authentication_task",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1007/s10916-020-1530-z",
    "key": "sensor.accelerometer",
    "sourceRole": "input_schema",
    "sourceTarget": "raw_row",
    "unique": true
  },
  {
    "work": "doi:10.1007/s10916-020-1530-z",
    "key": "sensor.gyroscope",
    "sourceRole": "input_schema",
    "sourceTarget": "raw_row",
    "unique": true
  },
  {
    "work": "doi:10.1007/s10916-020-1530-z",
    "key": "feature.control_fields",
    "sourceRole": "preprocessing",
    "sourceTarget": "window",
    "unique": true
  },
  {
    "work": "doi:10.1007/s10916-020-1530-z",
    "key": "preprocess.concatenate",
    "sourceRole": "preprocessing",
    "sourceTarget": "raw_rows",
    "unique": true
  },
  {
    "work": "doi:10.1007/s10916-020-1530-z",
    "key": "preprocess.windows",
    "sourceRole": "configuration",
    "sourceTarget": "dataset",
    "unique": true
  },
  {
    "work": "doi:10.1007/s10916-020-1530-z",
    "key": "feature.statistics",
    "sourceRole": "preprocessing",
    "sourceTarget": "signal_axis",
    "unique": true
  },
  {
    "work": "doi:10.1007/s10916-020-1530-z",
    "key": "feature.total",
    "sourceRole": "reported_result",
    "sourceTarget": "feature_vector",
    "unique": true
  },
  {
    "work": "doi:10.1007/s10916-020-1530-z",
    "key": "feature.rank",
    "sourceRole": "preprocessing",
    "sourceTarget": "dataset",
    "unique": true
  },
  {
    "work": "doi:10.1007/s10916-020-1530-z",
    "key": "feature.subsets",
    "sourceRole": "configuration",
    "sourceTarget": "classifier_run",
    "unique": true
  },
  {
    "work": "doi:10.1007/s10916-020-1530-z",
    "key": "label.class",
    "sourceRole": "classification",
    "sourceTarget": "typing_trial",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "schema.motion_sensors",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_record",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "schema.raw_touch",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_occurrence",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "schema.gesture_types",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_occurrence",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "schema.keyboard_latencies",
    "sourceRole": "event_schema",
    "sourceTarget": "raw_occurrence",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "feature.resistance.mean_during_tap",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "feature.resistance.sd_during_tap",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "feature.resistance.before_after_difference",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "feature.resistance.net_tap_change",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "feature.resistance.maximum_tap_change",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "feature.stability.time_to_stability",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "feature.stability.normalized_before_after_duration",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "feature.stability.normalized_max_after_duration",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "feature.tap_duration",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "feature.tap_contact_size",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "feature.tap_velocity",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "feature.key_hold",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "feature.digraph",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "authentication.vector_unit.touch",
    "sourceRole": "aggregation",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "authentication.vector_unit.keystroke",
    "sourceRole": "aggregation",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "mechanism.region.during",
    "sourceRole": "reconstruction",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "mechanism.region.between",
    "sourceRole": "reconstruction",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "authentication.sm_se_template",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "authentication.svm_template",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "authentication.scan_vector",
    "sourceRole": "aggregation",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "authentication.score_types",
    "sourceRole": "validation",
    "sourceTarget": "outcome",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "authentication.score_fusion",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "bkg.discretization",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "bkg.commitment",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "bkg.opening",
    "sourceRole": "analysis",
    "sourceTarget": "model",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "bkg.guessing_protocol",
    "sourceRole": "validation",
    "sourceTarget": "outcome",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "energy.baseline",
    "sourceRole": "analysis",
    "sourceTarget": "outcome",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "energy.modules",
    "sourceRole": "analysis",
    "sourceTarget": "outcome",
    "unique": true
  },
  {
    "work": "doi:10.1109/tifs.2015.2506542",
    "key": "energy.summary_statistics",
    "sourceRole": "reporting",
    "sourceTarget": "outcome",
    "unique": true
  }
];
function typingMotionInput(work: string) {
  const profile = structuredClone(canonical().profiles.find(p => p.source_work_id === work)!);
  return { profiles: [profile], ...typingMotionExample(profile) };
}
const typingMotionRow = (value: ReturnType<typeof typingMotionInput>, suffix: string) =>
  value.sampled_quantity_observations.find(row => row.sampled_observation_id.endsWith("-" + suffix))!;
const typingMotionQuantity = (row: SampledQuantityObservationRecord, property: string) => row.quantities!.find(q => q.observed_property === property)!;
itWithPrivateCorpus("rejects fusion of different known HMOG claimed users while preserving unknown template links", () => {
  const bad = typingMotionInput(typingMotionWorks[2]), row = (id: string) => typingMotionRow(bad, id), q = (id: string, property: string) => typingMotionQuantity(row(id), property);
  const extra = structuredClone(row("other-template")); extra.sampled_observation_id = "constructed:hmog-third-user-template"; extra.participant_id = "constructed:hmog-person-C"; delete extra.sampled_observation_references; bad.sampled_quantity_observations.push(extra);
  for (const id of ["score-HMOG", "score-tap"]) { q(id, "score type").evidence_value_json = '"impostor"'; const link = row(id).sampled_observation_references![1]!; link.relationship_label = "other-user template"; link.sampled_observation_reference = id === "score-HMOG" ? row("other-template").sampled_observation_id : extra.sampled_observation_id; }
  row("fusion").sampled_observation_references = row("fusion").sampled_observation_references!.slice(0, 2);
  expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/different known claimed users/);
  const partial = structuredClone(bad); typingMotionRow(partial, "score-tap").sampled_observation_references![1]!.sampled_observation_reference = null;
  expect(parseStudyMethodProfileLibrary(partial).sampled_quantity_observations).toEqual(partial.sampled_quantity_observations);
});
itWithPrivateCorpus.each([
  [typingMotionWorks[2], "accelerometer", "sensor", '"alien sensor"', /disclosed supplied typing\/motion category/],
  [typingMotionWorks[2], "discretized", "discretized feature values", "[-1,2,null,4]", /nonnegative discretized/],
  [typingMotionWorks[2], "opening", "opened", "1", /supplied normalized outcome/],
  [typingMotionWorks[2], "press-A", "key", "1", /supplied lexical field/],
  [typingMotionWorks[2], "accelerometer", "x", "true", /scalar number, text or null/],
] as const)("rejects supplied typing/motion %s %s %s domain contradictions", (work, suffix, property, token, error) => {
  const source = typingMotionInput(work);
  expect(() => parseStudyMethodProfileLibrary(source)).not.toThrow();
  const invalid = structuredClone(source);
  typingMotionQuantity(typingMotionRow(invalid, suffix), property).evidence_value_json = token;
  expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(error);
});
itWithPrivateCorpus("rejects contradictory supplied typing/motion owners, feature lengths and score relationships", () => {
  const cases: Array<[string, RegExp, (v: ReturnType<typeof typingMotionInput>) => void]> = [
    [typingMotionWorks[1], /must not invent a task owner/, v => { typingMotionRow(v, "DS-A").task_occurrence_reference = null; }],
    [typingMotionWorks[2], /unequal supplied feature identity\/value lengths/, v => { typingMotionQuantity(typingMotionRow(v, "tap-vector"), "feature values").evidence_value_json = "[1]"; }],
    [typingMotionWorks[0], /contradicts the supplied sensor stream/, v => { const row = typingMotionRow(v, "sensor-vector"); typingMotionQuantity(row, "sensor").evidence_value_json = '"sensor.stream.gyroscope"'; row.sampled_observation_references![0]!.sampled_observation_reference = "constructed:touchstroke-raw-gyroscope"; }],
    [typingMotionWorks[2], /supplied score family/, v => { typingMotionQuantity(typingMotionRow(v, "score-HMOG"), "feature family").evidence_value_json = '"tap"'; }],
    [typingMotionWorks[2], /genuine\/impostor ownership/, v => { typingMotionQuantity(typingMotionRow(v, "score-HMOG"), "score type").evidence_value_json = '"impostor"'; }],
  ];
  for (const [work, error, mutate] of cases) { const invalid = typingMotionInput(work); mutate(invalid); expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(error); }
});
itWithPrivateCorpus.each(typingMotionRoutes)("admits the actual $work $key source tuple/body before rejecting incompatible definitions", ({ work, key, sourceRole, sourceTarget, unique }) => {
  const source = typingMotionInput(work);
  const local = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  source.sampled_quantity_observations = source.sampled_quantity_observations.filter(row => row.method_setting_reference === local(source).method_setting_id);
  source.task_occurrences = [];
  source.sampled_quantity_observations.forEach(row => { delete row.task_occurrence_reference; delete row.sampled_observation_references; });
  expect(source.sampled_quantity_observations.length).toBeGreaterThan(0);
  expect(() => parseStudyMethodProfileLibrary({ profiles: source.profiles })).not.toThrow();
  expect(parseStudyMethodProfileLibrary(source).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  const content: unknown = JSON.parse(String(local(source).method_value_json));
  const sourceWrapped = content !== null && typeof content === "object" && Object.hasOwn(content, "source_facing_role") && Object.hasOwn(content, "source_facing_target");
  const body = sourceWrapped ? (content as { definition: unknown }).definition : content;
  const wrapper = { definition: body, source_facing_role: sourceRole, source_facing_target: sourceTarget };
  // HMOG's key-hold/digraph bodies contain a literal "definition" field,
  // which is not an envelope without the source-facing tuple metadata.
  for (const good of [body, wrapper]) { const valid = structuredClone(source); local(valid).method_value_json = JSON.stringify(good); expect(() => parseStudyMethodProfileLibrary(valid)).not.toThrow(); }
  for (const badBody of [null, {}, { conceptual_observation_roles: ["process/application identity", "bytes sent", "bytes received"] },
    { ...wrapper, definition: null }, { ...wrapper, source_facing_role: "invented" }, { ...wrapper, source_facing_target: "invented" }]) {
    const bad = structuredClone(source); local(bad).method_value_json = JSON.stringify(badBody);
    expect(() => parseStudyMethodProfileLibrary({ profiles: bad.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/sampled-quantity definition|source-facing definition/);
  }
  if (work === "doi:10.1109/tifs.2015.2506542" && ["feature.key_hold", "feature.digraph"].includes(key) && body !== null && typeof body === "object") {
    for (const changed of [{ ...body, feature_count: 0 }, { ...body, definition: "invented latency" }]) {
      const bad = structuredClone(source); local(bad).method_value_json = JSON.stringify(changed);
      expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/sampled-quantity definition|source-facing definition/);
    }
  }
  if (unique) {
    const foreign = structuredClone(source); foreign.profiles[0]!.source_work_id = "doi:10.1145/1879141.1879176";
    foreign.profiles[0]!.method_settings.forEach(s => { s.source_work_id = foreign.profiles[0]!.source_work_id; });
    foreign.sampled_quantity_observations.forEach(row => { row.source_work_id = foreign.profiles[0]!.source_work_id; });
    expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow(/matching sampled-quantity definition/);
  }
});
itWithPrivateCorpus.each(["survey.items", "survey.scale", "label.class", "stressor.arithmetic"])("admits KeyboardStress %s only as its actual questionnaire/criterion source definition", key => {
  const source = typingMotionInput(typingMotionWorks[1]);
  const local = (v: typeof source) => v.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
  source.sampled_quantity_observations = [];
  const id = local(source).method_setting_id;
  source.task_occurrences = source.task_occurrences.filter(task => task.task_questionnaire_responses?.some(r => r.questionnaire_setting_reference === id) || task.criterion_assessments?.some(a => a.criterion_setting_reference === id)).slice(0,1);
  expect(source.task_occurrences).toHaveLength(1);
  const task = source.task_occurrences[0]!;
  task.task_questionnaire_responses = task.task_questionnaire_responses?.filter(r => r.questionnaire_setting_reference === id);
  task.criterion_assessments = task.criterion_assessments?.filter(r => r.criterion_setting_reference === id);
  expect(() => parseStudyMethodProfileLibrary(source)).not.toThrow();
  if (key === "survey.items" || key === "survey.scale") {
    const bad = structuredClone(source);
    bad.task_occurrences[0]!.task_questionnaire_responses![0]!.observed_property = "undeclared mood item";
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow("disclosed KeyboardStress mood item");
  }
  if (key === "stressor.arithmetic") {
    const bad = structuredClone(source);
    bad.task_occurrences[0]!.criterion_assessments![0]!.assessment_value_json = "1.5";
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow("arithmetic net-point score");
  }
  const content: unknown = JSON.parse(String(local(source).method_value_json));
  const body = content !== null && typeof content === "object" && Object.hasOwn(content, "definition")
    ? (content as { definition: unknown }).definition : content;
  const [sourceRole, sourceTarget] = key === "stressor.arithmetic" ? ["study_protocol", "stressor"]
    : key === "label.class" ? ["classification", "typing_trial"] : ["input_schema", "self_report"];
  const wrapper = { definition: body, source_facing_role: sourceRole, source_facing_target: sourceTarget };
  for (const value of [body, wrapper]) { const valid = structuredClone(source); local(valid).method_value_json = JSON.stringify(value); expect(() => parseStudyMethodProfileLibrary(valid)).not.toThrow(); }
  for (const value of [null, {}, { ...wrapper, definition: {} }, { ...wrapper, source_facing_role: "invented" }, { ...wrapper, source_facing_target: "invented" },
    { ...wrapper, source_facing_role: local(source).method_setting_role, source_facing_target: local(source).method_target_layer }]) {
    const bad = structuredClone(source); local(bad).method_value_json = JSON.stringify(value);
    expect(() => parseStudyMethodProfileLibrary({ profiles: bad.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/compatible .*definition|local definition role\/target/);
  }
});
itWithPrivateCorpus("requires exact source companions and rejects ambiguous local typing/motion definitions without a metadata false positive", () => {
  for (const [work, root, companion] of [
    [typingMotionWorks[0], "sensor.stream.raw_accelerometer", "attempt.sensor_start_boundary"],
    [typingMotionWorks[0], "fusion.input_pair", "fusion.output_dimension"],
    [typingMotionWorks[1], "preprocess.windows", "preprocess.concatenate"],
    [typingMotionWorks[2], "mechanism.region.between", "mechanism.between_block_ms"],
    [typingMotionWorks[2], "energy.modules", "energy.sensor_sampling_rates_hz"],
  ]) {
    const source = typingMotionInput(work!), profile = source.profiles[0]!;
    const rootId = profile.method_settings.find(s => s.method_parameter_key === root)!.method_setting_id;
    source.sampled_quantity_observations = source.sampled_quantity_observations.filter(row => row.method_setting_reference === rootId);
    source.sampled_quantity_observations.forEach(row => { delete row.task_occurrence_reference; delete row.sampled_observation_references; });
    source.task_occurrences = [];
    expect(() => parseStudyMethodProfileLibrary(source)).not.toThrow();
    const bad = structuredClone(source); bad.profiles[0]!.method_settings.find(s => s.method_parameter_key === companion)!.method_value_json = "{}";
    expect(() => parseStudyMethodProfileLibrary({ profiles: bad.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/matching sampled-quantity definition/);
    const duplicate = structuredClone(source), owner = duplicate.profiles[0]!, original = owner.method_settings.find(s => s.method_parameter_key === companion)!;
    owner.method_settings.push({ ...structuredClone(original), method_setting_id: original.method_setting_id + ":duplicate" });
    owner.method_setting_count = owner.method_settings.length; owner.method_setting_ids = owner.method_settings.map(s => s.method_setting_id);
    expect(() => parseStudyMethodProfileLibrary({ profiles: [owner] })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(duplicate)).toThrow(/matching sampled-quantity definition/);
  }
});
itWithPrivateCorpus.each(typingMotionWorks)("persists supplied typing/motion values and relationships through existing Task/Sampled owners: %s", async work => {
  const source = typingMotionInput(work);
  await persistTaskAndSampled(source);
  const expected = new Set(typingMotionRoutes.filter(route => route.work === work).map(route => route.key));
  expect(new Set(source.sampled_quantity_observations.map(row => source.profiles[0]!.method_settings.find(s => s.method_setting_id === row.method_setting_reference)!.method_parameter_key))).toEqual(expected);
  const first = source.sampled_quantity_observations[0]!;
  for (const value of [undefined, null, "null", "0.000", ' "unreported" ']) {
    const changed = structuredClone(source);
    const numeric = changed.sampled_quantity_observations[0]!.quantities!.find(q => q.observed_property === "x")!;
    if (value === undefined) delete numeric.evidence_value_json; else numeric.evidence_value_json = value;
    await persistTaskAndSampled(changed);
  }
  const changed = structuredClone(source); changed.sampled_quantity_observations[0]!.quantities!.find(q => q.observed_property === "x")!.evidence_value_json = "99.500";
  await persistTaskAndSampled(changed);
  expect(changed.sampled_quantity_observations.slice(1)).toEqual(source.sampled_quantity_observations.slice(1));
  for (const value of [undefined, null]) {
    const unknown = structuredClone(source), row = unknown.sampled_quantity_observations.find(r => r.sampled_observation_id === first.sampled_observation_id)!;
    if (value === undefined) delete row.task_occurrence_reference; else row.task_occurrence_reference = value;
    expect(() => parseStudyMethodProfileLibrary(unknown)).not.toThrow();
  }
});
itWithPrivateCorpus("owns Touchstroke xyz samples by attempt, not a touch action or an inferred sensor timestamp", async () => {
  const source = typingMotionInput(typingMotionWorks[0]), row = (v: typeof source, id: string) => typingMotionRow(v,id);
  expect(row(source,"raw-raw_accelerometer").task_occurrence_reference).toBe("constructed:touchstroke-attempt-A");
  expect(row(source,"second-attempt").task_occurrence_reference).toBe("constructed:touchstroke-attempt-B");
  expect(row(source,"touch-vector").quantities![4]!.evidence_value_json).toBe("-2.50");
  await persistTaskAndSampled(source); const retained = await loadResearchMethodSelection();
  for (const [mutate, error] of [
    [(v: typeof source) => { row(v,"raw-raw_accelerometer").task_occurrence_reference = v.task_occurrences[0]!.task_actions![0]!.task_action_id; }, /matching task/],
    [(v: typeof source) => { row(v,"raw-raw_accelerometer").task_occurrence_reference = "constructed:touchstroke-attempt-B"; }, /attempt\/task membership/],
    [(v: typeof source) => { row(v,"raw-raw_accelerometer").task_occurrence_reference = "constructed:touchstroke-attempt-other"; }, /matching task/],
    [(v: typeof source) => { row(v,"magnitude").sampled_observation_references![0]!.sampled_observation_reference = "constructed:touchstroke-raw-gyroscope"; }, /typed raw sensor stream/],
    [(v: typeof source) => { row(v,"fused").task_occurrence_reference = "constructed:touchstroke-attempt-B"; delete row(v,"fused").sampled_observation_references; }, /attempt\/task membership/],
    [(v: typeof source) => { row(v,"fused").quantities![1]!.evidence_value_json = "[1,2]"; }, /feature vector/],
    [(v: typeof source) => { row(v,"raw-raw_accelerometer").sampled_observation_references = []; }, /incompatible with this observation/],
  ] as const) { const bad = structuredClone(source); mutate(bad); await expect(persistTaskAndSampled(bad)).rejects.toThrow(error); expect(await loadResearchMethodSelection()).toBe(retained); }
  const partial = structuredClone(source); row(partial,"sensor-vector").sampled_observation_references = [ { relationship_label:"sensor reading", sampled_observation_reference:null, source_locators:["explicit unknown member"] } ];
  row(partial,"raw-raw_accelerometer").source_event_time_token = "a different opaque token; no membership recomputed";
  expect(() => parseStudyMethodProfileLibrary(partial)).not.toThrow();
});
itWithPrivateCorpus("keeps KeyboardStress independent task counters/answers separate from pooled DS-A/B/C ownership and labels", () => {
  const source = typingMotionInput(typingMotionWorks[1]), row = (v: typeof source, id: string) => typingMotionRow(v,id);
  expect(row(source,"pool").sampled_observation_references!.map(r => r.sampled_observation_reference)).toContain("constructed:keyboard-stress-other-accel");
  expect(["DS-A","DS-B","DS-C"].map(id => typingMotionQuantity(row(source,id),"nominal row count").evidence_value_json)).toEqual(["100","200","300"]);
  expect(typingMotionQuantity(row(source,"vector"),"supplied class").evidence_value_json).not.toBe(typingMotionQuantity(row(source,"prediction"),"supplied class").evidence_value_json);
  expect(source.task_occurrences.find(t => t.task_occurrence_id.endsWith("-arithmetic"))!.criterion_assessments![0]!.assessment_value_json).toBe("-1");
  for (const [mutate, error] of [
    [(v: typeof source) => { row(v,"DS-A").participant_id = "constructed:keyboard-stress-person-A"; }, /all-participant pool/],
    [(v: typeof source) => { row(v,"DS-A").task_occurrence_reference = "constructed:keyboard-stress-calm-typing"; }, /matching task|must not invent a task/],
    [(v: typeof source) => { typingMotionQuantity(row(v,"DS-A"),"window duration").evidence_value_json = "10"; }, /DS-A\/B\/C/],
    [(v: typeof source) => { typingMotionQuantity(row(v,"statistics"),"accelerometer_x").evidence_value_json = "[1,2]"; }, /feature vector/],
    [(v: typeof source) => { typingMotionQuantity(row(v,"selected"),"subset size").evidence_value_json = "3"; }, /supplied subset size/],
    [(v: typeof source) => { typingMotionQuantity(row(v,"calm-typing-controls"),"touch_count").evidence_value_json = "-1"; }, /measurement\/count/],
    [(v: typeof source) => { row(v,"window-controls").sampled_observation_references![0]!.sampled_observation_reference = "constructed:keyboard-stress-DS-B"; }, /distinct pooled windows/],
    [(v: typeof source) => { v.task_occurrences[0]!.task_questionnaire_responses![0]!.response_value_json = "6"; }, /five-point mood response/],
    [(v: typeof source) => { v.task_occurrences.find(t => t.task_occurrence_id.endsWith("-calm-typing"))!.criterion_assessments![0]!.assessment_value_json = '"mood inferred calm"'; }, /typing condition/],
  ] as const) { const bad = structuredClone(source); mutate(bad); expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(error); }
  const unknown = structuredClone(source); row(unknown,"DS-A").sampled_observation_references = null; row(unknown,"statistics").sampled_observation_references = [];
  delete row(unknown,"window-controls").participant_id;
  expect(() => parseStudyMethodProfileLibrary(unknown)).not.toThrow();
});
itWithPrivateCorpus("retains HMOG during/between-tap membership, known sensor/key families and independent user comparisons", () => {
  const source = typingMotionInput(typingMotionWorks[2]), row = (v: typeof source, id: string) => typingMotionRow(v,id);
  expect(row(source,"between").sampled_observation_references!.map(r => r.relationship_label)).toEqual(["previous tap","next tap","motion member"]);
  expect(typingMotionQuantity(row(source,"between"),"block duration").evidence_value_json).toBe("91");
  for (const [mutate, error] of [
    [(v: typeof source) => { row(v,"during").sampled_observation_references![0]!.sampled_observation_reference = "constructed:hmog-scroll"; }, /tap rather than another gesture/],
    [(v: typeof source) => { row(v,"between").sampled_observation_references![1]!.sampled_observation_reference = "constructed:hmog-tap-A"; }, /distinct supplied occurrences/],
    [(v: typeof source) => { row(v,"between").sampled_observation_references![2]!.sampled_observation_reference = "constructed:hmog-magnetometer"; }, /two-sensor mechanism/],
    [(v: typeof source) => { typingMotionQuantity(row(v,"between"),"block duration").evidence_value_json = "600"; }, /91-ms block/],
    [(v: typeof source) => { row(v,"feature-0").sampled_observation_references![1]!.sampled_observation_reference = "constructed:hmog-gyroscope"; }, /sensor axis/],
    [(v: typeof source) => { row(v,"key-hold").sampled_observation_references![1]!.sampled_observation_reference = "constructed:hmog-press-A"; }, /key phase/],
    [(v: typeof source) => { typingMotionQuantity(row(v,"release-A"),"key").evidence_value_json = '"B"'; }, /held key/],
    [(v: typeof source) => { row(v,"tap-vector").sampled_observation_references![1]!.sampled_observation_reference = "constructed:hmog-tap-duration"; }, /vector feature family/],
    [(v: typeof source) => { row(v,"impostor-score").sampled_observation_references![1]!.sampled_observation_reference = "constructed:hmog-template"; }, /another supplied user/],
    [(v: typeof source) => { row(v,"fusion").sampled_observation_references![0]!.sampled_observation_reference = "constructed:hmog-impostor-score"; }, /genuine and impostor comparisons/],
    [(v: typeof source) => { row(v,"magnetometer").sampled_observation_references = null; }, /incompatible with this observation/],
  ] as const) { const bad = structuredClone(source); mutate(bad); expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(error); }
  for (const refs of [undefined, null, []]) { const partial = structuredClone(source); if (refs === undefined) delete row(partial,"between").sampled_observation_references; else row(partial,"between").sampled_observation_references = refs; expect(() => parseStudyMethodProfileLibrary(partial)).not.toThrow(); }
  const independent = structuredClone(source); typingMotionQuantity(row(independent,"accelerometer"),"x").evidence_value_json = "-19.75";
  expect(() => parseStudyMethodProfileLibrary(independent)).not.toThrow();
  expect(row(independent,"during")).toEqual(row(source,"during")); expect(row(independent,"fusion")).toEqual(row(source,"fusion"));
});
itWithPrivateCorpus("accepts only the source-bound HMOG controlled-device energy route without manufacturing a participant", () => {
  const source = typingMotionInput(typingMotionWorks[2]), row = (v: typeof source, id: string) => typingMotionRow(v,id);
  expect(row(source,"baseline").participant_id).toBeNull();
  expect([5,16,50,100].map(rate => typingMotionQuantity(row(source,"energy-"+rate),"sampling rate").evidence_value_json)).toEqual(["5","16","50","100"]);
  const omitted = structuredClone(source); delete row(omitted,"baseline").participant_id;
  expect(() => parseStudyMethodProfileLibrary(omitted)).not.toThrow();
  for (const [mutate, error] of [
    [(v: typeof source) => { row(v,"baseline").device_id = null; }, /supplied device owner/],
    [(v: typeof source) => { row(v,"baseline").device_id = "another controlled device"; }, /compatible, distinct sampled observation/],
    [(v: typeof source) => { delete row(v,"scan").participant_id; }, /participant_id/],
    [(v: typeof source) => { typingMotionQuantity(row(v,"energy-16"),"sampling rate").evidence_value_json = "16.666"; }, /collection rate/],
    [(v: typeof source) => { typingMotionQuantity(row(v,"energy-16"),"scan duration").evidence_value_json = "20"; }, /scan condition/],
    [(v: typeof source) => { typingMotionQuantity(row(v,"energy-summary"),"standard deviation energy").evidence_value_json = "-0.1"; }, /measurement\/count/],
    [(v: typeof source) => { typingMotionQuantity(row(v,"energy-5"),"energy").evidence_value_json = "1e999"; }, /measurement\/count/],
  ] as const) { const bad = structuredClone(source); mutate(bad); expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(error); }
});
itWithPrivateCorpus("preserves the typing-motion trio through the reused generated descriptive owner models", () => {
  const cases = typingMotionWorks.map(typingMotionInput);
  assertTemporalGeneratedShapes({ sampled_quantity_observations: cases.flatMap(value => value.sampled_quantity_observations), task_occurrences: cases.flatMap(value => value.task_occurrences) });
});
itWithPrivateCorpus.each([
  [typingMotionWorks[0], "sensor-vector", "statistic identities", ["x statistics", "y statistics", "z statistics", "magnitude statistics"]],
  [typingMotionWorks[0], "fused", "feature identities", ["fused values"]],
  [typingMotionWorks[1], "statistics", "statistic identities", ["accelerometer_x", "accelerometer_y", "accelerometer_z", "gyroscope_x", "gyroscope_y", "gyroscope_z"]],
  [typingMotionWorks[1], "vector", "feature identities", ["feature values"]],
  [typingMotionWorks[2], "during", "feature identities", ["HMOG feature values"]],
  [typingMotionWorks[2], "between", "feature identities", ["HMOG feature values"]],
] as const)("preserves explicit supplied identities without inventing vector order: %s %s", (work, suffix, property, valueProperties) => {
  const source = typingMotionInput(work);
  const record = (input: typeof source) => typingMotionRow(input, suffix);
  const names = (input: typeof source) => JSON.parse(typingMotionQuantity(record(input), property).evidence_value_json!) as (string | null)[];
  expect(parseStudyMethodProfileLibrary(source).sampled_quantity_observations).toEqual(source.sampled_quantity_observations);
  const suppliedNames = names(source);
  expect(new Set(suppliedNames).size).toBe(suppliedNames.length);
  for (const valueProperty of valueProperties) expect(JSON.parse(typingMotionQuantity(record(source), valueProperty).evidence_value_json!) as unknown[]).toHaveLength(suppliedNames.length);

  // A different explicitly supplied serialization order is retained, not recoded
  // into source prose order. Every value channel moves with its identity list.
  const reordered = structuredClone(source);
  typingMotionQuantity(record(reordered), property).evidence_value_json = JSON.stringify([...suppliedNames].reverse());
  for (const valueProperty of valueProperties) {
    const values = JSON.parse(typingMotionQuantity(record(reordered), valueProperty).evidence_value_json!) as unknown[];
    typingMotionQuantity(record(reordered), valueProperty).evidence_value_json = JSON.stringify(values.reverse());
  }
  expect(parseStudyMethodProfileLibrary(reordered).sampled_quantity_observations).toEqual(reordered.sampled_quantity_observations);

  for (const invalid of [
    ["invented statistic", ...suppliedNames.slice(1)],
    [suppliedNames[1], ...suppliedNames.slice(1)],
    suppliedNames.slice(1),
    [1, ...suppliedNames.slice(1)],
  ]) {
    const bad = structuredClone(source);
    typingMotionQuantity(record(bad), property).evidence_value_json = JSON.stringify(invalid);
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/supplied statistic\/feature identities|supplied feature identities/);
  }
  const sdIndex = suppliedNames.findIndex(name => name === "standard deviation" || name === "standard_deviation"
    || name?.endsWith(":standard deviation") || name?.endsWith(":standard_deviation") || name?.endsWith(":feature.resistance.sd_during_tap"));
  expect(sdIndex).toBeGreaterThanOrEqual(0);
  const negativeSd = structuredClone(source);
  const values = JSON.parse(typingMotionQuantity(record(negativeSd), valueProperties[0]).evidence_value_json!) as (number | null)[];
  values[sdIndex] = -0.25;
  typingMotionQuantity(record(negativeSd), valueProperties[0]).evidence_value_json = JSON.stringify(values);
  expect(() => parseStudyMethodProfileLibrary(negativeSd)).toThrow(/negative explicitly identified standard deviation/);

  // Without a known identity this position is not implicitly an SD slot.
  for (const unknown of [undefined, null, "null"]) {
    const partial = structuredClone(negativeSd), quantity = typingMotionQuantity(record(partial), property);
    if (unknown === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = unknown;
    expect(parseStudyMethodProfileLibrary(partial).sampled_quantity_observations).toEqual(partial.sampled_quantity_observations);
  }
  const omitted = structuredClone(negativeSd);
  record(omitted).quantities = record(omitted).quantities!.filter(quantity => quantity.observed_property !== property);
  expect(() => parseStudyMethodProfileLibrary(omitted)).not.toThrow();
  const partialNames = structuredClone(negativeSd), identityValues = names(partialNames);
  identityValues[sdIndex] = null;
  typingMotionQuantity(record(partialNames), property).evidence_value_json = JSON.stringify(identityValues);
  expect(() => parseStudyMethodProfileLibrary(partialNames)).not.toThrow();
});
itWithPrivateCorpus("keeps signed named skewness and overlapping flight timings independent of named nonnegative SD", () => {
  const touch = typingMotionInput(typingMotionWorks[0]), stress = typingMotionInput(typingMotionWorks[1]);
  expect(typingMotionQuantity(typingMotionRow(touch, "sensor-vector"), "statistic identities").evidence_value_json).toBe('["skewness","kurtosis","mean","standard deviation"]');
  expect(typingMotionQuantity(typingMotionRow(touch, "sensor-vector"), "x statistics").evidence_value_json).toBe("[-0.50,2.75,1.250,0.20]");
  expect(typingMotionQuantity(typingMotionRow(touch, "touch-vector"), "F1Type1").evidence_value_json).toBe("-2.50");
  const names = JSON.parse(typingMotionQuantity(typingMotionRow(stress, "statistics"), "statistic identities").evidence_value_json!) as string[];
  const values = JSON.parse(typingMotionQuantity(typingMotionRow(stress, "statistics"), "accelerometer_x").evidence_value_json!) as number[];
  expect(values[names.indexOf("skewness")]).toBe(-0.5);
  expect(() => parseStudyMethodProfileLibrary(touch)).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(stress)).not.toThrow();
});
itWithPrivateCorpus("rejects an alien selected identity only when its linked KeyboardStress source vector is fully identified", () => {
  const source = typingMotionInput(typingMotionWorks[1]);
  expect(() => parseStudyMethodProfileLibrary(source)).not.toThrow();
  const bad = structuredClone(source);
  typingMotionQuantity(typingMotionRow(bad, "selected"), "feature identities").evidence_value_json = '["alien feature","gyroscope_z:mean_energy"]';
  expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/fully identified source feature vector/);
  for (const value of [undefined, null, "null"]) {
    const partial = structuredClone(bad), identities = typingMotionQuantity(typingMotionRow(partial, "vector"), "feature identities");
    if (value === undefined) delete identities.evidence_value_json; else identities.evidence_value_json = value;
    expect(() => parseStudyMethodProfileLibrary(partial)).not.toThrow();
  }
  const partial = structuredClone(bad), identities = typingMotionQuantity(typingMotionRow(partial, "vector"), "feature identities");
  const values = JSON.parse(identities.evidence_value_json!) as (string | null)[];
  values[0] = null;
  identities.evidence_value_json = JSON.stringify(values);
  expect(() => parseStudyMethodProfileLibrary(partial)).not.toThrow();
});

const prefminerRoutes = [
  {
    "key": "notification.title_input_and_privacy_boundary",
    "sourceRole": "input_schema",
    "sourceTarget": "notification_title",
    "companions": []
  },
  {
    "key": "notification.response_state_boundary",
    "sourceRole": "event_schema",
    "sourceTarget": "notification_response",
    "companions": []
  },
  {
    "key": "text.clean_lowercase",
    "sourceRole": "cleaning",
    "sourceTarget": "notification_title",
    "companions": []
  },
  {
    "key": "text.clean_remove_punctuation_numbers",
    "sourceRole": "cleaning",
    "sourceTarget": "notification_title",
    "companions": []
  },
  {
    "key": "text.clean_stopwords",
    "sourceRole": "cleaning",
    "sourceTarget": "notification_title",
    "companions": []
  },
  {
    "key": "text.clean_sender_and_app_names",
    "sourceRole": "cleaning",
    "sourceTarget": "notification_title",
    "companions": []
  },
  {
    "key": "text.clean_stemming",
    "sourceRole": "cleaning",
    "sourceTarget": "notification_title",
    "companions": []
  },
  {
    "key": "text.document_term_matrix",
    "sourceRole": "feature_construction",
    "sourceTarget": "notification_type",
    "companions": []
  },
  {
    "key": "text.term_frequency_filter",
    "sourceRole": "feature_filter",
    "sourceTarget": "notification_type",
    "companions": []
  },
  {
    "key": "text.per_application_cluster_partition",
    "sourceRole": "classification",
    "sourceTarget": "notification_type",
    "companions": [
      "text.dbscan_title_clustering",
      "text.minimum_points_from_participation",
      "text.epsilon_one_nonmatching_word"
    ]
  },
  {
    "key": "notification.type_identity",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "companions": [
      "text.per_application_cluster_partition"
    ]
  },
  {
    "key": "analysis.activity_and_location_features",
    "sourceRole": "feature_construction",
    "sourceTarget": "notification_preference_rules",
    "companions": []
  },
  {
    "key": "analysis.arrival_time_categories",
    "sourceRole": "feature_construction",
    "sourceTarget": "notification_preference_rules",
    "companions": []
  },
  {
    "key": "association.rule_mining_algorithm",
    "sourceRole": "analysis",
    "sourceTarget": "notification_preference_rules",
    "companions": [
      "association.minimum_support_from_participation",
      "association.support_wording_boundary",
      "analysis.five_feature_combinations",
      "analysis.activity_and_location_features",
      "analysis.arrival_time_categories"
    ]
  },
  {
    "key": "library.rule_keyword_representation",
    "sourceRole": "feature_engineering",
    "sourceTarget": "derived_feature",
    "companions": []
  },
  {
    "key": "analysis.five_feature_combinations",
    "sourceRole": "analysis_variation",
    "sourceTarget": "notification_preference_rules",
    "companions": []
  },
  {
    "key": "deployment.user_acceptance_rule_lifecycle",
    "sourceRole": "intervention",
    "sourceTarget": "notification_filter_rule",
    "companions": []
  },
  {
    "key": "deployment.notification_filter_output",
    "sourceRole": "intervention",
    "sourceTarget": "inbound_notification_alert",
    "companions": [
      "deployment.user_acceptance_rule_lifecycle"
    ]
  },
  {
    "key": "analysis.online_daily_update",
    "sourceRole": "analysis",
    "sourceTarget": "notification_preference_rules",
    "companions": [
      "analysis.five_feature_combinations",
      "association.minimum_support_from_participation"
    ]
  },
  {
    "key": "analysis.cross_validation",
    "sourceRole": "analysis",
    "sourceTarget": "retrospective_notification_rows",
    "companions": [
      "analysis.notification_metric_definitions",
      "analysis.five_feature_combinations",
      "analysis.confidence_sensitivity"
    ]
  },
  {
    "key": "deployment.AR4_daily_charging_gate",
    "sourceRole": "acquisition_and_analysis",
    "sourceTarget": "deployed_rule_miner",
    "companions": []
  },
  {
    "key": "notification.reminder_zero_click_rate",
    "sourceRole": "cleaning",
    "sourceTarget": "retrospective_notification_rows",
    "companions": []
  },
  {
    "key": "analysis.notification_metric_definitions",
    "sourceRole": "analysis",
    "sourceTarget": "outcome",
    "companions": []
  },
  {
    "key": "analysis.cohort_and_complete_context_filter",
    "sourceRole": "cleaning",
    "sourceTarget": "retrospective_notification_rows",
    "companions": []
  },
  {
    "key": "deployment.evaluation_cohort",
    "sourceRole": "quality_control",
    "sourceTarget": "participant_record",
    "companions": []
  },
  {
    "key": "report.field_filter_results",
    "sourceRole": "reported_result",
    "sourceTarget": "outcome",
    "companions": []
  },
  {
    "key": "report.exit_questionnaire_results",
    "sourceRole": "reported_result",
    "sourceTarget": "outcome",
    "companions": [
      "diary.exit_questionnaire"
    ]
  },
  {
    "key": "report.library_resource_campaign",
    "sourceRole": "reported_result",
    "sourceTarget": "outcome",
    "companions": []
  }
];
const prefminerTaskRoutes = [
  {
    "key": "deployment.user_acceptance_rule_lifecycle",
    "sourceRole": "intervention",
    "sourceTarget": "notification_filter_rule"
  },
  {
    "key": "diary.exit_questionnaire",
    "sourceRole": "diary_schema",
    "sourceTarget": "diary_item"
  }
];
function prefminerInput() {
  const profile = structuredClone(canonical().profiles.find(profile => profile.source_work_id === "doi:10.1145/2971648.2971747")!);
  return { profiles: [profile], ...prefminerObservationExample(profile) };
}
const prefminerRow = (input: ReturnType<typeof prefminerInput>, id: string) => input.sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:prefminer-" + id)!;
const prefminerQuantity = (input: ReturnType<typeof prefminerInput>, id: string, property: string) => prefminerRow(input,id).quantities!.find(quantity => quantity.observed_property === property)!;
const prefminerLink = (input: ReturnType<typeof prefminerInput>, id: string, role: string) => prefminerRow(input,id).sampled_observation_references!.find(reference => reference.relationship_label === role)!;
itWithPrivateCorpus.each(prefminerRoutes)("admits the actual PrefMiner $key source body/tuple before rejecting counterfeits", ({key,sourceRole,sourceTarget}) => {
  const input = prefminerInput(), local = (value: typeof input) => value.profiles[0]!.method_settings.find(setting => setting.method_parameter_key === key)!;
  input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === local(input).method_setting_id);
  input.sampled_quantity_observations.forEach(row => { delete row.sampled_observation_references; delete row.task_occurrence_reference; });
  input.task_occurrences = [];
  expect(input.sampled_quantity_observations.length).toBeGreaterThan(0);
  expect(() => parseStudyMethodProfileLibrary({profiles:input.profiles})).not.toThrow();
  expect(parseStudyMethodProfileLibrary(input).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  // Every selected PrefMiner atom is a qualified envelope, not a literal object
  // whose scientific body happens to contain its own definition property.
  const body = (JSON.parse(String(local(input).method_value_json)) as {definition:unknown}).definition;
  for (const value of [body,{definition:body,source_facing_role:sourceRole,source_facing_target:sourceTarget}]) {
    const valid = structuredClone(input); local(valid).method_value_json = JSON.stringify(value);
    expect(parseStudyMethodProfileLibrary(valid).sampled_quantity_observations).toEqual(input.sampled_quantity_observations);
  }
  for (const value of [{}, {definition:body}, {definition:{},source_facing_role:sourceRole,source_facing_target:sourceTarget},
    {definition:body,source_facing_role:"invented role",source_facing_target:sourceTarget}, {definition:body,source_facing_role:sourceRole,source_facing_target:"invented target"}]) {
    const bad = structuredClone(input); local(bad).method_value_json = JSON.stringify(value);
    expect(() => parseStudyMethodProfileLibrary({profiles:bad.profiles})).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/sampled-quantity definition/);
  }
  for (const [field,value] of [["source_work_id","doi:foreign"],["method_setting_role",local(input).method_setting_role === "reporting" ? "acquisition" : "reporting"],["method_target_layer",local(input).method_target_layer === "outcome" ? "raw_record" : "outcome"]] as const) {
    const bad = structuredClone(input); Reflect.set(local(bad),field,value);
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/sampled-quantity definition|local definition role\/target/);
  }
  const foreign = structuredClone(input), work = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.source_work_id = work;
  foreign.profiles[0]!.method_settings.forEach(setting => { setting.source_work_id = work; });
  foreign.sampled_quantity_observations.forEach(row => { row.source_work_id = work; });
  expect(() => parseStudyMethodProfileLibrary({profiles:foreign.profiles})).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow(/sampled-quantity definition/);
});
itWithPrivateCorpus.each(prefminerTaskRoutes)("admits the actual PrefMiner $key completion without replacing its source tuple", ({key,sourceRole,sourceTarget}) => {
  const input = prefminerInput(), local = (value: typeof input) => value.profiles[0]!.method_settings.find(setting => setting.method_parameter_key === key)!;
  input.sampled_quantity_observations = [];
  input.task_occurrences = input.task_occurrences.filter(task => task.task_questionnaire_responses?.some(response => response.questionnaire_setting_reference === local(input).method_setting_id));
  expect(input.task_occurrences.length).toBeGreaterThan(0);
  expect(parseStudyMethodProfileLibrary(input).task_occurrences).toEqual(input.task_occurrences);
  for (const [field, value] of key === "deployment.user_acceptance_rule_lifecycle" ? [["observed_property", "invented proposal answer"]] : [["observed_property", "unreported exit question"], ["questionnaire_item_label", "invented printed wording"]]) {
    const bad = structuredClone(input);
    const child = bad.task_occurrences.flatMap(task => task.task_questionnaire_responses ?? []).find(response => response.questionnaire_setting_reference === local(bad).method_setting_id)!;
    Reflect.set(child, field!, value);
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(key === "deployment.user_acceptance_rule_lifecycle" ? "rule-proposal decision" : "three source exit questions");
  }
  const body = (JSON.parse(String(local(input).method_value_json)) as {definition:unknown}).definition;
  for (const value of [body,{definition:body,source_facing_role:sourceRole,source_facing_target:sourceTarget}]) {
    const valid = structuredClone(input); local(valid).method_value_json = JSON.stringify(value);
    expect(parseStudyMethodProfileLibrary(valid).task_occurrences).toEqual(input.task_occurrences);
  }
  for (const value of [{}, {definition:body}, {definition:body,source_facing_role:"invented role",source_facing_target:sourceTarget}]) {
    const bad = structuredClone(input); local(bad).method_value_json = JSON.stringify(value);
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/compatible response-scale definition/);
  }
  const foreign = structuredClone(input), work = "doi:10.1145/1879141.1879176";
  foreign.profiles[0]!.source_work_id = work; foreign.profiles[0]!.method_settings.forEach(setting => { setting.source_work_id = work; });
  foreign.task_occurrences.forEach(task => { task.source_work_id = work; });
  expect(() => parseStudyMethodProfileLibrary({profiles:foreign.profiles})).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow(/compatible response-scale definition/);
});
itWithPrivateCorpus("requires the exact PrefMiner source companions and rejects ambiguous local definitions", () => {
  for (const {key,companions} of prefminerRoutes) for (const companion of companions) {
    const input = prefminerInput(), profile = input.profiles[0]!, root = profile.method_settings.find(setting => setting.method_parameter_key === key)!;
    input.sampled_quantity_observations = input.sampled_quantity_observations.filter(row => row.method_setting_reference === root.method_setting_id);
    input.sampled_quantity_observations.forEach(row => { delete row.sampled_observation_references; delete row.task_occurrence_reference; }); input.task_occurrences = [];
    expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
    profile.method_settings.find(setting => setting.method_parameter_key === companion)!.method_value_json = "{}";
    expect(() => parseStudyMethodProfileLibrary({profiles:input.profiles})).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(input)).toThrow(/sampled-quantity definition/);
  }
  const input = prefminerInput(), profile = input.profiles[0]!, duplicate = structuredClone(profile.method_settings.find(setting => setting.method_parameter_key === "text.per_application_cluster_partition")!);
  duplicate.method_setting_id += ":constructed-duplicate"; profile.method_settings.push(duplicate);
  profile.method_setting_count = profile.method_settings.length; profile.method_setting_ids = profile.method_settings.map(setting => setting.method_setting_id);
  expect(() => parseStudyMethodProfileLibrary({profiles:input.profiles})).not.toThrow();
  expect(() => parseStudyMethodProfileLibrary(input)).toThrow(/sampled-quantity definition/);
});
itWithPrivateCorpus("roundtrips PrefMiner app partitions, repeated proposals, independent consent/state/results and device-only costs", async () => {
  const input = prefminerInput();
  await persistTaskAndSampled(input);
  expect(prefminerQuantity(input,"type-A","cluster identifier").evidence_value_json).toBe(prefminerQuantity(input,"type-B","cluster identifier").evidence_value_json);
  expect(prefminerRow(input,"type-A").observed_entity_token).not.toBe(prefminerRow(input,"type-B").observed_entity_token);
  expect(prefminerLink(input,"proposal-first","rule").sampled_observation_reference).toBe(prefminerLink(input,"proposal-again","rule").sampled_observation_reference);
  expect(prefminerRow(input,"proposal-first").task_occurrence_reference).not.toBe(prefminerRow(input,"proposal-again").task_occurrence_reference);
  expect(input.task_occurrences.slice(0,4).map(task => task.task_questionnaire_responses![0]!.response_value_json)).toEqual(['"Not Now"','"Yes"','"Never"','null']);
  expect(input.task_occurrences.at(-1)!.task_questionnaire_responses!.map(response => [response.observed_property,response.response_value_json])).toEqual([["Q1","5"],["Q2","3"],["Q3","1"]]);
  expect(prefminerRow(input,"notification-A").source_event_time_token).not.toBe(prefminerRow(input,"notification-A").observation_instant);
  expect(prefminerQuantity(input,"metric","ratio").evidence_value_json).toBe("0.90"); // Not recomputed from 3/10.
  expect(prefminerQuantity(input,"click-rate","click rate").evidence_value_json).toBe("60.00"); // Not recomputed from 1/3.
  expect(prefminerRow(input,"resource").participant_id).toBeUndefined();
  expect(prefminerRow(input,"pooled-field").device_id).toBeUndefined();
  const changed = structuredClone(input);
  changed.task_occurrences[1]!.task_questionnaire_responses![0]!.response_value_json = '"Never"';
  prefminerQuantity(changed,"metric","numerator").evidence_value_json = "9";
  expect(prefminerRow(changed,"state-active")).toEqual(prefminerRow(input,"state-active"));
  expect(prefminerRow(changed,"filter")).toEqual(prefminerRow(input,"filter"));
  expect(prefminerQuantity(changed,"metric","ratio")).toEqual(prefminerQuantity(input,"metric","ratio"));
  await persistTaskAndSampled(changed); // No inferred consent effect, blacklist matching or arithmetic.
  assertTemporalGeneratedShapes(input);
});
itWithPrivateCorpus("rejects known PrefMiner cross-app and conflicting supplied rules even without an own-rule link", () => {
  const input = prefminerInput(); expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  const crossApp = structuredClone(input); prefminerLink(crossApp,"type-A","classifier").sampled_observation_reference = "constructed:prefminer-classifier-B";
  expect(() => parseStudyMethodProfileLibrary(crossApp)).toThrow(/originating-app partition/);
  const noOwn = structuredClone(input);
  prefminerRow(noOwn,"proposal-again").sampled_observation_references = prefminerRow(noOwn,"proposal-again").sampled_observation_references!.filter(link => link.relationship_label !== "rule");
  expect(() => parseStudyMethodProfileLibrary(noOwn)).not.toThrow();
  prefminerLink(noOwn,"presentation-A","represented rule").sampled_observation_reference = "constructed:prefminer-rule-accept";
  expect(() => parseStudyMethodProfileLibrary(noOwn)).toThrow(/different supplied rules through its presentation or proposal/);
  const partial = structuredClone(noOwn);
  prefminerLink(partial,"proposal-first","rule").sampled_observation_reference = null;
  // The active state still explicitly names rule-A, so remove that independent
  // known relationship in this unknown-identity counterexample only.
  prefminerRow(partial,"state-active").sampled_observation_references = [];
  expect(() => parseStudyMethodProfileLibrary(partial)).not.toThrow();
});
itWithPrivateCorpus("rejects PrefMiner known target-app contradictions when its own app identity is unknown", () => {
  for (const token of [undefined, null]) {
    const bad = prefminerInput(), type = prefminerRow(bad,"type-A");
    if (token === undefined) delete type.observed_entity_token; else type.observed_entity_token = token;
    prefminerLink(bad,"type-A","classifier").sampled_observation_reference = "constructed:prefminer-classifier-B";
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/originating-app partition/);
    const unknown = structuredClone(bad);
    delete prefminerRow(unknown,"classifier-B").observed_entity_token;
    delete prefminerRow(unknown,"classifier-B").sampled_observation_references;
    expect(() => parseStudyMethodProfileLibrary(unknown)).not.toThrow();
  }
});
itWithPrivateCorpus("rejects PrefMiner explicit rule conflicts through unknown intermediate prior proposals", () => {
  for (const ownRule of ["constructed:prefminer-rule-accept", undefined, null]) {
    const bad = prefminerInput();
    prefminerLink(bad,"proposal-again","prior proposal").sampled_observation_reference = "constructed:prefminer-proposal-unknown";
    prefminerRow(bad,"proposal-unknown").sampled_observation_references = [{relationship_label:"prior proposal",sampled_observation_reference:"constructed:prefminer-proposal-first",source_locators:["Constructed explicit prior-proposal chain"]}];
    const first = prefminerLink(bad,"proposal-first","rule");
    if (ownRule === undefined) delete first.sampled_observation_reference; else first.sampled_observation_reference = ownRule;
    if (ownRule !== "constructed:prefminer-rule-accept") {
      const presentation = structuredClone(prefminerRow(bad,"presentation-A"));
      presentation.sampled_observation_id = "constructed:prefminer-presentation-first";
      presentation.sampled_observation_references![0]!.sampled_observation_reference = "constructed:prefminer-rule-accept";
      bad.sampled_quantity_observations.push(presentation);
      prefminerRow(bad,"proposal-first").sampled_observation_references!.push({relationship_label:"rule presentation",sampled_observation_reference:presentation.sampled_observation_id,source_locators:["Constructed explicit first-proposal presentation"]});
    }
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/different supplied rules through its presentation or proposal/);
    const unknown = structuredClone(bad);
    prefminerLink(unknown,"proposal-first","rule").sampled_observation_reference = null;
    prefminerRow(unknown,"proposal-first").sampled_observation_references = prefminerRow(unknown,"proposal-first").sampled_observation_references!.filter(link => link.relationship_label !== "rule presentation");
    expect(() => parseStudyMethodProfileLibrary(unknown)).not.toThrow();
  }
});
itWithPrivateCorpus("keeps PrefMiner proposal, consent, active state and filter reference roles distinct", () => {
  const input = prefminerInput(); expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  for (const [id,role,target,error] of [
    ["proposal-again","prior proposal","state-active",/known proposal target/],
    ["filter","supplied active state","proposal-again",/active-rule state distinct/],
    ["filter","rule","rule-accept",/another supplied rule/],
    ["prediction","actual response","response-A",/different supplied notifications/],
  ] as const) {
    const bad = structuredClone(input); prefminerLink(bad,id,role).sampled_observation_reference = "constructed:prefminer-" + target;
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(error);
  }
  const cycle = structuredClone(input);
  prefminerRow(cycle,"proposal-first").sampled_observation_references!.push({relationship_label:"prior proposal",sampled_observation_reference:"constructed:prefminer-proposal-again",source_locators:["Constructed explicit prior-proposal cycle counterexample"]});
  expect(() => parseStudyMethodProfileLibrary(cycle)).toThrow(/cycle in supplied prior-proposal/);
  const inactive = structuredClone(input); prefminerQuantity(inactive,"state-active","active").evidence_value_json = "false";
  expect(() => parseStudyMethodProfileLibrary(inactive)).toThrow(/known inactive rule/);
  const otherDevice = structuredClone(input); prefminerQuantity(otherDevice,"response-new","source response").evidence_value_json = '"handled on another device"';
  expect(() => parseStudyMethodProfileLibrary(otherDevice)).toThrow(/other-device response/);
  const notConsent = structuredClone(input); prefminerRow(notConsent,"proposal-again").task_occurrence_reference = "constructed:prefminer-exit";
  expect(() => parseStudyMethodProfileLibrary(notConsent)).toThrow(/one unambiguous supplied rule-consent response/);
  const ambiguous = structuredClone(input), task = ambiguous.task_occurrences[1]!;
  task.task_questionnaire_responses!.push({...structuredClone(task.task_questionnaire_responses![0]!),questionnaire_response_id:"other-decision"});
  expect(() => parseStudyMethodProfileLibrary(ambiguous)).toThrow(/one unambiguous supplied rule-consent response/);
});
itWithPrivateCorpus("preserves PrefMiner omission/null/JSON null and unknown identity without guessing matches or consent", async () => {
  const input = prefminerInput();
  for (const value of [undefined,null,"null"]) {
    const partial = structuredClone(input), quantity = prefminerQuantity(partial,"state-active","active");
    if (value === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = value;
    partial.task_occurrences[0]!.task_questionnaire_responses![0]!.response_value_json = value;
    if (value === undefined) delete partial.task_occurrences[0]!.task_questionnaire_responses![0]!.response_value_json;
    await persistTaskAndSampled(partial);
  }
  for (const links of [undefined,null,[]]) {
    const partial = structuredClone(input); prefminerRow(partial,"proposal-again").sampled_observation_references = links;
    if (links === undefined) delete prefminerRow(partial,"proposal-again").sampled_observation_references;
    expect(parseStudyMethodProfileLibrary(partial).sampled_quantity_observations).toEqual(partial.sampled_quantity_observations);
  }
  for (const reference of [undefined,null]) {
    const partial = structuredClone(input); prefminerLink(partial,"proposal-again","prior proposal").sampled_observation_reference = reference;
    if (reference === undefined) delete prefminerLink(partial,"proposal-again","prior proposal").sampled_observation_reference;
    expect(() => parseStudyMethodProfileLibrary(partial)).not.toThrow();
  }
  const lexical = structuredClone(input); prefminerQuantity(lexical,"metric","ratio").evidence_value_json = '"unreported"';
  await persistTaskAndSampled(lexical);
  for (const links of [null,[]]) {
    const invalid = structuredClone(input); prefminerRow(invalid,"notification-A").sampled_observation_references = links;
    expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(/sampled_observation_references/);
  }
});
itWithPrivateCorpus("rejects PrefMiner known source-shape contradictions without executing its algorithms", () => {
  const input = prefminerInput(); expect(() => parseStudyMethodProfileLibrary(input)).not.toThrow();
  for (const [id,property,value,error] of [
    ["response-A", "source response", '"invented response"', /disclosed PrefMiner category/],
    ["dtm-A", "terms", "[1]", /term\/keyword\/day identities/],
    ["dtm-A", "term frequencies", "[-1]", /finite nonnegative term frequencies/],
    ["notification-A", "notification title", "7", /supplied text, not an inferred encoding/],
    ["pooled-exit", "mean response", "0", /exit-scale mean in 1\.\.5/],
    ["manual-availability","manual rule creation allowed","true",/first-15-study-days/],
    ["mining-pass","phone in use","true",/charging\/nonuse/],
    ["rule-A","feature arm",'"AR1"',/antecedent outside/],
    ["dtm-A","term frequencies","[1,2]",/term\/frequency pairing/],
    ["dtm-A","terms",'["alice","alice"]',/term\/frequency pairing|duplicate known term/],
    ["state-active","active","0",/supplied boolean/],
    ["fold","precision standard error","-1",/invalid independently supplied/],
    ["metric","ratio","1.1",/invalid independently supplied/],
    ["term-filter","term frequency","1.1",/invalid independently supplied/],
  ] as const) {
    const bad = structuredClone(input); prefminerQuantity(bad,id,property).evidence_value_json = value;
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(error);
  }
  const semanticCases: Array<[RegExp, (v: typeof input) => void]> = [
    [/supplied population description/, v => { prefminerQuantity(v, "pooled-field", "population scope").evidence_value_json = '" "'; }],
    [/not a disclosed raw-arrival role/, v => { prefminerRow(v, "clean-A-0").source_event_time_token = "invented event"; }],
    [/task_occurrence_reference is incompatible/, v => { prefminerRow(v, "notification-A").task_occurrence_reference = null; }],
    [/consent completion on the proposal/, v => { prefminerQuantity(v, "proposal-first", "lifecycle stage").evidence_value_json = '"rule state"'; }],
    [/duplicate known term columns/, v => { prefminerQuantity(v, "dtm-A", "terms").evidence_value_json = '["alice","alice"]'; prefminerQuantity(v, "dtm-A", "term frequencies").evidence_value_json = "[1,2]"; }],
    [/mixes a known proposal/, v => { prefminerRow(v, "proposal-first").quantities!.push({ observed_property: "active", evidence_value_json: "true" }); }],
    [/application-level manual-rule restriction/, v => { prefminerRow(v, "manual-availability").sampled_observation_references = [{ relationship_label: "rule", sampled_observation_reference: "constructed:prefminer-rule-A", source_locators: ["Constructed explicit manual-availability counterexample"] }]; }],
    [/proposal relationship on an incompatible lifecycle stage/, v => { delete prefminerRow(v, "proposal-again").task_occurrence_reference; prefminerQuantity(v, "proposal-again", "lifecycle stage").evidence_value_json = '"rule state"'; }],
    [/supplied rule feature arm/, v => { prefminerQuantity(v, "prediction", "feature arm").evidence_value_json = '"AR5"'; }],
    [/deployed AR4 feature scope/, v => { prefminerQuantity(v, "rule-A", "feature arm").evidence_value_json = '"AR5"'; }],
    [/both training and test in the same fold/, v => { prefminerLink(v, "fold", "test notification").sampled_observation_reference = "constructed:prefminer-notification-A"; }],
  ];
  for (const [error, mutate] of semanticCases) {
    const bad = structuredClone(input); mutate(bad);
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(error);
  }
  const independentThreshold = structuredClone(input); prefminerQuantity(independentThreshold,"term-filter","threshold").evidence_value_json = "2.50";
  expect(() => parseStudyMethodProfileLibrary(independentThreshold)).not.toThrow(); // Eq3 is not Eq2's probability domain.
  const scopeUnknown = structuredClone(input); prefminerQuantity(scopeUnknown,"manual-availability","within first 15 study days").evidence_value_json = "null";
  prefminerQuantity(scopeUnknown,"manual-availability","manual rule creation allowed").evidence_value_json = "true";
  expect(() => parseStudyMethodProfileLibrary(scopeUnknown)).not.toThrow();
  for (const value of ['"Accept"','["Yes"]',"true","1"]) {
    const bad = structuredClone(input); bad.task_occurrences[0]!.task_questionnaire_responses![0]!.response_value_json = value;
    expect(() => parseStudyMethodProfileLibrary(bad)).toThrow(/Yes, Never or Not Now/);
  }
  const exit = structuredClone(input); exit.task_occurrences.at(-1)!.task_questionnaire_responses![0]!.response_value_json = "0";
  expect(() => parseStudyMethodProfileLibrary(exit)).toThrow(/1\.\.5 exit response/);
  const pooled = structuredClone(input); prefminerRow(pooled,"pooled-field").participant_id = "constructed:prefminer-person";
  expect(() => parseStudyMethodProfileLibrary(pooled)).toThrow(/pooled PrefMiner results/);
  const hardware = structuredClone(input); delete prefminerRow(hardware,"resource").device_id;
  expect(() => parseStudyMethodProfileLibrary(hardware)).toThrow(/device-only PrefMiner resource owner/);
  const noPerson = structuredClone(input); delete prefminerRow(noPerson,"type-A").participant_id;
  expect(() => parseStudyMethodProfileLibrary(noPerson)).toThrow(/participant_id/);
  const crossPerson = structuredClone(input); prefminerRow(crossPerson,"classifier-B").participant_id = "constructed:other-person";
  expect(() => parseStudyMethodProfileLibrary(crossPerson)).toThrow(/compatible, distinct sampled observation/);
  const crossDevice = structuredClone(input); prefminerRow(crossDevice,"classifier-B").device_id = "constructed:other-phone";
  expect(() => parseStudyMethodProfileLibrary(crossDevice)).toThrow(/compatible, distinct sampled observation/);
});
