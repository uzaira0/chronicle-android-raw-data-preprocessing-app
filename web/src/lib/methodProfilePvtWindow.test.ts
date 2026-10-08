import "fake-indexeddb/auto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { privateCorpusPath } from "@/testSupport/privateCorpus";
import { loadResearchMethodSelection, saveResearchMethodSelection } from "./lastRunStore";
import { parseStudyMethodProfileLibrary, type StudyMethodProfile, type StudyMethodProfileLibrary } from "./methodProfiles";
import { linkmlPython } from "../testSupport/linkmlPython";

const input = () => {
  const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  const rows = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../e2e/fixtures/pvt-window-example.json.fixture"), "utf8")) as Required<Pick<StudyMethodProfileLibrary, "task_occurrences" | "participant_day_observations">>;
  return { profiles: [library.profiles.find(p => p.source_work_id === "doi:10.1145/2935334.2935383")!], ...rows };
};

itWithPrivateCorpus.each(["diary", "assessment", "window", "night-relation"])("accepts the actual Murnane %s source case", mode => {
  const source = input();
  if (mode !== "night-relation") source.participant_day_observations = [];
  source.task_occurrences = mode === "diary" ? [source.task_occurrences[0]!] : mode === "night-relation" ? [] : [source.task_occurrences[1]!];
  if (mode === "assessment") delete source.task_occurrences[0]!.task_observation_windows;
  if (mode === "window") delete source.task_occurrences[0]!.criterion_assessments;
  expect(parseStudyMethodProfileLibrary(source)).toMatchObject(source);
});

itWithPrivateCorpus("preserves PVT windows and explicit prior-night/following-day relationships through selection persistence", async () => {
  const source = input();
  const roundtrip = async (value: typeof source) => {
    const { profiles, ...rows } = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: profiles[0], ...rows }));
    const { profile, ...saved } = JSON.parse((await loadResearchMethodSelection())!) as { profile: StudyMethodProfile } & Omit<StudyMethodProfileLibrary, "profiles">;
    const parsed = parseStudyMethodProfileLibrary({ profiles: [profile], ...saved });
    expect(parsed.profiles).toEqual(value.profiles);
    expect(parsed.task_occurrences).toEqual(value.task_occurrences);
    expect(parsed.participant_day_observations).toEqual(value.participant_day_observations);
    return parsed;
  };
  await roundtrip(source);
  const changed = structuredClone(source);
  changed.participant_day_observations.push({ ...structuredClone(source.participant_day_observations[1]!), referenced_day_token: "example:day-C", day_observation_value_json: "0.00" });
  changed.participant_day_observations[0]!.cross_period_aggregate_references![0]!.referenced_day_token = "example:day-C";
  await roundtrip(changed);
  expect(changed.participant_day_observations[0]!.referenced_night_token).toBe(source.participant_day_observations[0]!.referenced_night_token);
  expect(changed.task_occurrences).toEqual(source.task_occurrences);
  // Equal token text across kinds still denotes independent periods.
  changed.participant_day_observations[0]!.cross_period_aggregate_references![0]!.referenced_day_token = "example:night-A";
  changed.participant_day_observations.at(-1)!.referenced_day_token = "example:night-A";
  await roundtrip(changed);
  for (const refs of [undefined, null, []]) {
    const value = structuredClone(source);
    value.participant_day_observations[0]!.cross_period_aggregate_references = refs;
    if (refs === undefined) delete value.participant_day_observations[0]!.cross_period_aggregate_references;
    await roundtrip(value);
  }
  for (const token of [undefined, null, "null", "0.00", ' "supplied unknown" ']) {
    const value = structuredClone(source);
    value.participant_day_observations[0]!.day_observation_value_json = token;
    value.task_occurrences[1]!.criterion_assessments![0]!.assessment_value_json = token;
    value.task_occurrences[1]!.task_observation_windows![0]!.quantities![0]!.evidence_value_json = token;
    if (token === undefined) {
      delete value.participant_day_observations[0]!.day_observation_value_json;
      delete value.task_occurrences[1]!.criterion_assessments![0]!.assessment_value_json;
      delete value.task_occurrences[1]!.task_observation_windows![0]!.quantities![0]!.evidence_value_json;
    }
    await roundtrip(value);
  }
  const retained = await roundtrip(source);
  const cross = (v: typeof source) => v.participant_day_observations[0]!.cross_period_aggregate_references![0]!;
  const window = (v: typeof source) => v.task_occurrences[1]!.task_observation_windows![0]!;
  const mutants: Array<(v: typeof source) => void> = [
    v => { cross(v).day_observation_id = "foreign"; },
    v => { cross(v).referenced_day_token = "unprovided-day"; },
    v => { cross(v).referenced_night_token = "example:night-A"; },
    v => { cross(v).relationship_label = " "; },
    v => { cross(v).source_locators = []; },
    v => { Reflect.set(cross(v), "inferred_adjacency", true); },
    v => { v.participant_day_observations[0]!.cross_period_aggregate_references!.push(structuredClone(cross(v))); },
    v => { v.participant_day_observations[1]!.participant_id = "other-participant"; },
    v => { v.participant_day_observations[1]!.day_observation_kind = "subjective_response"; },
    v => { v.participant_day_observations[1]!.cross_period_aggregate_references = []; },
    v => { v.participant_day_observations[0]!.aggregate_observation_references = ["example:productivity-use"]; },
    v => { delete cross(v).referenced_day_token; cross(v).referenced_night_token = "example:night-A"; cross(v).day_observation_id = "example:night-event-count"; },
    v => { v.participant_day_observations[0]!.referenced_day_token = "invented-day"; },
    v => { delete v.participant_day_observations[0]!.referenced_night_token; },
    v => { window(v).anchor_task_action_reference = "foreign"; },
    v => { window(v).window_setting_references.pop(); },
    v => { window(v).window_setting_references.push(window(v).window_setting_references[0]!); },
    v => { window(v).denotes_interval = { duration_seconds: 1800 }; },
    v => { window(v).questionnaire_response_references = [v.task_occurrences[0]!.task_questionnaire_responses![0]!.questionnaire_response_id]; },
    v => { v.task_occurrences[1]!.criterion_assessments![0]!.support_task_action_references = ["foreign"]; },
  ];
  for (const value of [null, "", " ", 3]) {
    mutants.push(v => { Reflect.set(v.participant_day_observations[0]!, "referenced_night_token", value); });
    mutants.push(v => { Reflect.set(cross(v), "referenced_day_token", value); });
  }
  const refs = ["method-setting-e92f2c21e6f7810af2b0343a", "method-setting-8cd1272f338147c84a96e957", ...window(source).window_setting_references];
  for (const ref of refs) {
    const setting = source.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!;
    const original = JSON.parse(String(setting.method_value_json)) as Record<string, unknown>;
    for (const [field, bads] of [
      ["definition", [undefined, null, {}, "foreign"]], ["source_interpretation_limits", [undefined, null, " "]],
      ["evidence_characterization", [null, "inferred", false]],
      ["source_facing_role", [null, "foreign"]], ["source_facing_target", [null, "foreign"]],
    ] as const) for (const bad of bads) {
      mutants.push(v => { v.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!.method_value_json = JSON.stringify({ ...original, [field]: bad }); });
    }
    for (const field of ["method_setting_role", "method_target_layer"]) mutants.push(v => {
      Reflect.set(v.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!, field, field === "method_setting_role" ? "reporting" : "outcome");
    });
    for (const characterization of [undefined, "explicit", "explicit_partial"]) {
      const value = structuredClone(source);
      value.profiles[0]!.method_settings.find(s => s.method_setting_id === ref)!.method_value_json = JSON.stringify({ ...original, evidence_characterization: characterization,
        source_facing_role: setting.method_setting_role, source_facing_target: setting.method_target_layer });
      await roundtrip(value);
    }
  }
  await roundtrip(source);
  for (const mutate of mutants) {
    const value = structuredClone(source); mutate(value);
    expect(() => parseStudyMethodProfileLibrary(value)).toThrow();
  }
  const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
  expect(saved.profile).toEqual(retained.profiles[0]);
  expect(saved.participant_day_observations).toEqual(source.participant_day_observations);
});

itWithPrivateCorpus("validates night identity and cross-period reference structure with generated contracts", () => {
  const source = input();
  const result = execFileSync(linkmlPython(), ["-c", [
    "import json,sys", "from jsonschema import Draft202012Validator", "sys.path.insert(0,sys.argv[2])",
    "import chronicle_research_ontology as models", "schema=json.load(open(sys.argv[1]))", "source=json.load(sys.stdin)",
    "groups={'TaskOccurrenceRecord':source['task_occurrences'],'ParticipantDayObservationRecord':source['participant_day_observations'],'CrossPeriodAggregateReference':source['participant_day_observations'][0]['cross_period_aggregate_references']}",
    "tokens=['referenced_day_token','referenced_hour_token','referenced_night_token']",
    "for name,rows in groups.items():",
    " validator=Draft202012Validator({'$ref':'#/$defs/'+name,'$defs':schema['$defs']})",
    " for row in rows:", "  validator.validate(row)", "  assert getattr(models,name)(**row).model_dump(exclude_unset=True)==row",
    "  assert not validator.is_valid(dict(row,invented_field=True))",
    "  if name=='TaskOccurrenceRecord': continue",
    "  selected=next(t for t in tokens if t in row)",
    "  assert not validator.is_valid({k:v for k,v in row.items() if k!=selected})",
    "  for token in tokens:",
    "   for value in [None,'',' ',3] + ([] if token==selected else ['other']):",
    "    assert not validator.is_valid(dict(row,**{token:value}))",
    "print('pvt-night-records-preserved')",
  ].join("\n"), resolve(import.meta.dirname, "../../schema/generated/json-schema/chronicle-research-ontology.schema.json"),
  resolve(import.meta.dirname, "../../schema/generated/pydantic")], { input: JSON.stringify(source), encoding: "utf8", timeout: 180_000 });
  expect(result.trim()).toBe("pvt-night-records-preserved");
});
