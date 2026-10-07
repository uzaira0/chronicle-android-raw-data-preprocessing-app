import "fake-indexeddb/auto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { privateCorpusPath } from "@/testSupport/privateCorpus";
import { loadResearchMethodSelection, saveResearchMethodSelection } from "@/lib/lastRunStore";
import { compileNativeMethodProfile, parseStudyMethodProfileLibrary } from "@/lib/methodProfiles";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { humanScreenomeExample, pulseScreenshotRangeExample } from "../../e2e/fixtures/pulse-screenshot-ranges";
import { nestedSessionFamilyExample } from "../../e2e/fixtures/device-use-session";

describe("source-backed within-session screenshot range labels", () => {
  itWithPrivateCorpus("preserves Human Screenome app/topic/text-feature ownership through the existing singleton annotation path", async () => {
    const library = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")));
    const profile = library.profiles.find(p => p.source_work_id === "doi:10.1016/j.chb.2020.106570")!;
    expect(profile).toBeDefined();
    const input = humanScreenomeExample(profile);
    for (const moved of [false, true]) {
      const value = structuredClone(input);
      if (moved) {
        value.screenshot_sessions[0]!.screenshot_range_annotations[2]!.first_screenshot_reference = "capture-B";
        value.screenshot_sessions[0]!.screenshot_range_annotations[2]!.last_screenshot_reference = "capture-B";
      }
      const parsed = parseStudyMethodProfileLibrary(value);
      await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], screenshot_sessions: parsed.screenshot_sessions }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
      expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], screenshot_sessions: saved.screenshot_sessions }).screenshot_sessions).toEqual(value.screenshot_sessions);
      expect(value.screenshot_sessions[0]!.screenshots).toEqual(input.screenshot_sessions[0]!.screenshots);
      expect(value.screenshot_sessions[0]!.screenshot_range_annotations.map(a => a.range_label_values_json)).toEqual(input.screenshot_sessions[0]!.screenshot_range_annotations.map(a => a.range_label_values_json));
    }
    const foreign = structuredClone(input);
    foreign.screenshot_sessions[0]!.screenshot_range_annotations[0]!.first_screenshot_reference = "foreign-capture";
    expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow("within session");
    const result = execFileSync("uvx", ["--from", "linkml==1.10.0", "--with", "jsonschema", "python", "-c", [
      "import json,sys", "from jsonschema import Draft202012Validator", "sys.path.insert(0,sys.argv[2])",
      "from chronicle_research_ontology import ScreenshotSessionRecord", "schema=json.load(open(sys.argv[1]))",
      "validator=Draft202012Validator({'$ref':'#/$defs/ScreenshotSessionRecord','$defs':schema['$defs']})",
      "for row in json.load(sys.stdin):", " validator.validate(row)", " assert ScreenshotSessionRecord(**row).model_dump(exclude_unset=True)==row",
      "print('screenome-projections-preserve-records')",
    ].join("\n"), resolve(import.meta.dirname, "../../schema/generated/json-schema/chronicle-research-ontology.schema.json"),
    resolve(import.meta.dirname, "../../schema/generated/pydantic")], { input: JSON.stringify(input.screenshot_sessions), encoding: "utf8", timeout: 180_000 });
    expect(result.trim()).toBe("screenome-projections-preserve-records");
  });

  it("imports and persists two partial labels on different local ranges, not the whole session", async () => {
    const input = pulseScreenshotRangeExample();
    const library = parseStudyMethodProfileLibrary(input);
    await saveResearchMethodSelection(JSON.stringify({ profile: library.profiles[0], screenshot_sessions: library.screenshot_sessions }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], screenshot_sessions: saved.screenshot_sessions });
    expect(restored.screenshot_sessions).toEqual(input.screenshot_sessions);
    expect(restored.screenshot_sessions![0]!.screenshots).toHaveLength(6);
    expect(restored.screenshot_sessions![0]).not.toHaveProperty("usage_intent");
    expect(restored.screenshot_sessions![0]).not.toHaveProperty("app_name");
    expect(compileNativeMethodProfile(restored.profiles[0]!, DEFAULT_BROWSER_OPTIONS).ok).toBe(false);

    const changed = structuredClone(input);
    changed.screenshot_sessions[0]!.screenshot_range_annotations[0]!.last_screenshot_reference = "screen-3";
    const alternate = parseStudyMethodProfileLibrary(changed);
    expect(alternate.screenshot_sessions![0]!.screenshots).toEqual(restored.screenshot_sessions![0]!.screenshots);
    expect(alternate.screenshot_sessions![0]!.screenshot_range_annotations).not.toEqual(restored.screenshot_sessions![0]!.screenshot_range_annotations);
    await saveResearchMethodSelection(JSON.stringify({ profile: alternate.profiles[0], screenshot_sessions: alternate.screenshot_sessions }));
    const again = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    expect(parseStudyMethodProfileLibrary({ profiles: [again.profile], screenshot_sessions: again.screenshot_sessions }).screenshot_sessions).toEqual(changed.screenshot_sessions);
  });

  it("preserves equal-time captures, sparse order, overlapping/singleton ranges and supplied unknowns without expansion", async () => {
    const library = parseStudyMethodProfileLibrary(pulseScreenshotRangeExample());
    const session = library.screenshot_sessions![0]!;
    session.screenshots[1]!.screenshot_instant = session.screenshots[0]!.screenshot_instant;
    session.screenshots.reverse(); // Supplied array order is independent of the supplied semantic positions.
    session.screenshots[0]!.screenshot_instant = null;
    session.screenshots[0]!.screenshot_artifact_id = null;
    delete session.screenshots[1]!.screenshot_sequence_position;
    session.screenshots[2]!.screenshot_sequence_position = null;
    session.screenshot_range_annotations!.push(
      { range_annotation_id: "overlap", first_screenshot_reference: "screen-1", last_screenshot_reference: "screen-2", range_label_values_json: '{"unknown dimension":["value",0,false,""]}', source_locators: session.source_locators },
      { range_annotation_id: "singleton", first_screenshot_reference: "screen-2", last_screenshot_reference: "screen-2", range_label_values_json: "{}", source_locators: session.source_locators },
      { range_annotation_id: "omitted", source_locators: session.source_locators },
      { range_annotation_id: "null-fields", first_screenshot_reference: null, last_screenshot_reference: null, range_label_values_json: null, source_locators: session.source_locators },
      { range_annotation_id: "lexical-null", first_screenshot_reference: "screen-3", range_label_values_json: " null ", source_locators: session.source_locators },
    );
    for (const device of [undefined, null, "example-device"]) {
      session.device_id = device;
      if (device === undefined) delete session.device_id;
      const parsed = parseStudyMethodProfileLibrary(library);
      await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], screenshot_sessions: parsed.screenshot_sessions }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
      expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], screenshot_sessions: saved.screenshot_sessions }).screenshot_sessions).toEqual(library.screenshot_sessions);
    }
    for (const annotations of [undefined, null, []]) {
      session.screenshot_range_annotations = annotations;
      if (annotations === undefined) delete session.screenshot_range_annotations;
      expect(parseStudyMethodProfileLibrary(library).screenshot_sessions).toEqual(library.screenshot_sessions);
    }
    for (const interval of [undefined, null, {}]) {
      session.denotes_interval = interval;
      if (interval === undefined) delete session.denotes_interval;
      expect(parseStudyMethodProfileLibrary(library).screenshot_sessions).toEqual(library.screenshot_sessions);
    }
    expect(parseStudyMethodProfileLibrary({ profiles: library.profiles }).screenshot_sessions).toBeUndefined();
    expect(parseStudyMethodProfileLibrary({ profiles: library.profiles, screenshot_sessions: [] }).screenshot_sessions).toEqual([]);
  });

  it("rejects invalid local endpoints, identities and malformed values without replacing saved data", async () => {
    const input = pulseScreenshotRangeExample();
    await saveResearchMethodSelection(JSON.stringify(input));
    const mutations: Array<(x: typeof input) => void> = [
      (x) => Reflect.set(x, "screenshot_sessions", null),
      (x) => Reflect.set(x.screenshot_sessions, "0", null),
      (x) => { x.screenshot_sessions[0]!.method_profile_id = "foreign-profile"; },
      (x) => { x.screenshot_sessions[0]!.source_work_id = "foreign-work"; },
      (x) => { x.screenshot_sessions[0]!.participant_id = " "; },
      (x) => { x.screenshot_sessions[0]!.screenshot_session_id = " "; },
      (x) => Reflect.set(x.screenshot_sessions[0]!, "device_id", 0),
      (x) => { x.screenshot_sessions[0]!.session_record_origin = "authentic-paper-rows"; },
      (x) => Reflect.set(x.screenshot_sessions[0]!, "denotes_interval", false),
      (x) => Reflect.set(x.screenshot_sessions[0]!.denotes_interval, "duration_seconds", Infinity),
      (x) => Reflect.set(x.screenshot_sessions[0]!, "screenshots", null),
      (x) => Reflect.set(x.screenshot_sessions[0]!.screenshots, "0", []),
      (x) => { x.screenshot_sessions[0]!.screenshots[0]!.screenshot_record_id = " "; },
      (x) => { x.screenshot_sessions[0]!.screenshots.push(structuredClone(x.screenshot_sessions[0]!.screenshots[0]!)); },
      (x) => { x.screenshot_sessions[0]!.screenshots[0]!.screenshot_sequence_position = -1; },
      (x) => { x.screenshot_sessions[0]!.screenshots[0]!.screenshot_sequence_position = 0.5; },
      (x) => { x.screenshot_sessions[0]!.screenshots[0]!.screenshot_sequence_position = Number.MAX_SAFE_INTEGER + 1; },
      (x) => { x.screenshot_sessions[0]!.screenshots[0]!.screenshot_sequence_position = x.screenshot_sessions[0]!.screenshots[1]!.screenshot_sequence_position; },
      (x) => Reflect.set(x.screenshot_sessions[0]!.screenshots[0]!, "screenshot_instant", 0),
      (x) => Reflect.set(x.screenshot_sessions[0]!.screenshots[0]!, "screenshot_artifact_id", "no-catalog-image"),
      (x) => { x.screenshot_sessions[0]!.screenshots[0]!.source_locators = []; },
      (x) => Reflect.set(x.screenshot_sessions[0]!, "screenshot_range_annotations", {}),
      (x) => Reflect.set(x.screenshot_sessions[0]!.screenshot_range_annotations, "0", null),
      (x) => { x.screenshot_sessions[0]!.screenshot_range_annotations[0]!.range_annotation_id = " "; },
      (x) => { x.screenshot_sessions[0]!.screenshot_range_annotations.push(structuredClone(x.screenshot_sessions[0]!.screenshot_range_annotations[0]!)); },
      (x) => { x.screenshot_sessions[0]!.screenshot_range_annotations[0]!.first_screenshot_reference = "missing-image"; },
      (x) => { x.screenshot_sessions[0]!.screenshot_range_annotations[0]!.last_screenshot_reference = " "; },
      (x) => Reflect.set(x.screenshot_sessions[0]!.screenshot_range_annotations[0]!, "first_screenshot_reference", 0),
      (x) => { x.screenshot_sessions[0]!.screenshot_range_annotations[0]!.first_screenshot_reference = "screen-3"; },
      (x) => Reflect.set(x.screenshot_sessions[0]!.screenshot_range_annotations[0]!, "range_label_values_json", {}),
      (x) => { x.screenshot_sessions[0]!.screenshot_range_annotations[0]!.range_label_values_json = "undefined"; },
      (x) => { x.screenshot_sessions[0]!.screenshot_range_annotations[0]!.range_label_values_json = "[]"; },
      (x) => { x.screenshot_sessions[0]!.screenshot_range_annotations[0]!.source_locators = [" "]; },
      (x) => { x.screenshot_sessions[0]!.source_locators = []; },
      (x) => Reflect.set(x.screenshot_sessions[0]!, "whole_session_intent", "Information"),
      (x) => Reflect.set(x.screenshot_sessions[0]!.screenshots[0]!, "invented_hierarchy", true),
      (x) => Reflect.set(x.screenshot_sessions[0]!.screenshot_range_annotations[0]!, "computed_membership", ["screen-1", "screen-2"]),
      (x) => { x.screenshot_sessions.push(structuredClone(x.screenshot_sessions[0]!)); },
    ];
    for (const [i, mutate] of mutations.entries()) {
      const invalid = structuredClone(input);
      mutate(invalid);
      expect(() => parseStudyMethodProfileLibrary(invalid), `screenshot-range mutation ${i}`).toThrow();
    }
    expect(JSON.parse((await loadResearchMethodSelection())!)).toEqual(input);
  });

  it("resolves endpoints only within their owning session and optionally reuses the existing payload catalog", () => {
    const input = parseStudyMethodProfileLibrary(pulseScreenshotRangeExample());
    const second = structuredClone(input.screenshot_sessions![0]!);
    second.screenshot_session_id = "second-session";
    second.screenshots[0]!.screenshot_record_id = "only-in-second-session";
    second.screenshot_range_annotations![0]!.first_screenshot_reference = "only-in-second-session";
    input.screenshot_sessions!.push(second);
    const owner = structuredClone(input.profiles[0]!);
    owner.method_profile_id = "example:other-pulse-owner";
    input.profiles.push(owner);
    const other = structuredClone(input.screenshot_sessions![0]!);
    other.method_profile_id = owner.method_profile_id;
    input.screenshot_sessions!.push(other);
    expect(parseStudyMethodProfileLibrary(input).screenshot_sessions).toHaveLength(3);
    input.screenshot_sessions![0]!.screenshot_range_annotations![0]!.first_screenshot_reference = "only-in-second-session";
    expect(() => parseStudyMethodProfileLibrary(input)).toThrow("within session");
    input.screenshot_sessions![0]!.screenshot_range_annotations![0]!.first_screenshot_reference = "screen-1";
    input.referenced_artifacts = [{ artifact_id: "example-image", digest: `sha256:${"a".repeat(64)}`, size: 0, media_type: "image/png", derived_from: [], qualifiers: { origin: "constructed-metadata-not-image-proof" } }];
    input.screenshot_sessions![0]!.screenshots[0]!.screenshot_artifact_id = "example-image";
    input.screenshot_sessions![0]!.screenshots[1]!.screenshot_artifact_id = "example-image";
    const parsed = parseStudyMethodProfileLibrary(input);
    expect(parsed.screenshot_sessions).toEqual(input.screenshot_sessions);
    expect(parsed.referenced_artifacts).toEqual(input.referenced_artifacts);
    expect(parsed.screenshot_sessions![0]!.screenshots).toHaveLength(6);
  });
});

const nestedSessionWorks = ["doi:10.2139/ssrn.4768783", "doi:10.1145/3706598.3713724", "doi:10.1145/2858036.2858267"];
let nestedCanonical: ReturnType<typeof parseStudyMethodProfileLibrary> | undefined;
const nestedExample = (work: string) => {
  nestedCanonical ??= parseStudyMethodProfileLibrary(JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")));
  const profile = nestedCanonical.profiles.find(p => p.source_work_id === work);
  if (!profile) throw new Error("Frozen nested-session profile missing: " + work);
  return nestedSessionFamilyExample(profile);
};
const nestedChannels = ["device_use_sessions", "sampled_quantity_observations", "task_occurrences", "screenshot_sessions", "participant_day_observations"] as const;

describe("source-bound supplied nested sessions, app visits, screenshots and unlock attempts", () => {
  itWithPrivateCorpus("retains unknown Regret screenshot analyses but refuses incompatible owners, definitions and supplied values", () => {
    const source = nestedExample(nestedSessionWorks[1]!);
    const annotation = (v: typeof source) => v.screenshot_sessions![0]!.screenshot_range_annotations![2]!;
    const cases: Array<[RegExp, (v: typeof source) => void]> = [
      [/contradicts a known parent app-period identity/, v => { v.screenshot_sessions![0]!.app_identifier = "known different app"; }],
      [/no compatible local screenshot-analysis definition/, v => { annotation(v).method_setting_reference = v.profiles[0]!.method_settings.find(s => s.method_parameter_key === "daily.regret_scale")!.method_setting_id; }],
      [/app_identifier must be a supplied nonblank app token/, v => { v.screenshot_sessions![0]!.app_identifier = " "; }],
      [/support_screenshot_references must be an array or null/, v => { Reflect.set(annotation(v), "support_screenshot_references", {}); }],
      [/must retain supplied textual description/, v => { annotation(v).range_label_values_json = '{"activity category":1}'; }],
    ];
    for (const [error, mutate] of cases) { const invalid = structuredClone(source); mutate(invalid); expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(error); }
    for (const token of [undefined, null, " null "]) {
      const partial = structuredClone(source);
      if (token === undefined) delete annotation(partial).range_label_values_json; else annotation(partial).range_label_values_json = token;
      expect(parseStudyMethodProfileLibrary(partial).screenshot_sessions).toEqual(partial.screenshot_sessions);
    }
    const deviation = structuredClone(source), label = structuredClone(deviation.device_use_sessions![0]!.session_labels![0]!);
    const setting = deviation.profiles[0]!.method_settings.find(s => s.method_parameter_key === "deviation.groups")!;
    const content = JSON.parse(String(setting.method_value_json)) as { definition?: Array<{ label: string }> } | Array<{ label: string }>;
    const groups = Array.isArray(content) ? content : content.definition!;
    label.label_record_id = "independent-deviation"; label.label_setting_reference = setting.method_setting_id;
    label.observed_property = "supplied intention/activity deviation group"; label.label_value_json = JSON.stringify(groups[0]!.label);
    deviation.device_use_sessions![0]!.session_labels!.push(label);
    expect(parseStudyMethodProfileLibrary(deviation).device_use_sessions).toEqual(deviation.device_use_sessions);
  });
  itWithPrivateCorpus("rejects contradictory supplied nested-session quantities and labels", () => {
    const tap = nestedExample(nestedSessionWorks[0]!);
    const quantity = (v: typeof tap, property: string) => v.device_use_sessions![0]!.session_quantities!.find(q => q.observed_property === property)!;
    const cases: Array<[string, (v: typeof tap) => void]> = [
      ["event/state designation", v => { v.sampled_quantity_observations![0]!.quantities![0]!.evidence_value_json = '"swipe"'; }],
      ["nonnegative count/quantity", v => { v.sampled_quantity_observations!.at(-1)!.quantities![0]!.evidence_value_json = "-2"; }],
      ["independently supplied scalar", v => { v.sampled_quantity_observations!.at(-1)!.quantities![0]!.evidence_value_json = "{}"; }],
      ["app identifiers or unknown members", v => { quantity(v, "apps used").evidence_value_json = "[1]"; }],
      ["independently supplied sequence", v => { quantity(v, "one-second tap counts").evidence_value_json = "[1.5]"; }],
      ["independently supplied sequence", v => { quantity(v, "normalized timestamps").evidence_value_json = "[1.01]"; }],
      ["independent supplied quantity", v => { quantity(v, "total tap count").evidence_value_json = "1.5"; }],
      ["label_value_json must be lexical JSON", v => Reflect.set(v.device_use_sessions![0]!.session_labels![0]!, "label_value_json", true)],
      ["distinct supplied app-period label owners", v => { v.device_use_sessions![0]!.session_labels![0]!.support_task_action_references = v.device_use_sessions![0]!.session_actions!.slice(0, 2).map(a => a.task_action_id); }],
      ["incompatible app-session label designation", v => { v.device_use_sessions![0]!.session_labels![0]!.observed_property = "phone session cluster"; }],
      ["no disclosed independent app-session label", v => { v.device_use_sessions![0]!.session_labels![0]!.label_value_json = '"unknown cluster"'; }],
    ];
    for (const [message, mutate] of cases) {
      const invalid = structuredClone(tap); mutate(invalid);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(message);
    }
    for (const token of [undefined, null, "null", '"opaque quantity encoding"']) {
      const partial = structuredClone(tap), q = quantity(partial, "one-second tap counts");
      if (token === undefined) delete q.evidence_value_json; else q.evidence_value_json = token;
      expect(parseStudyMethodProfileLibrary(partial).device_use_sessions).toEqual(partial.device_use_sessions);
    }
    for (const token of [undefined, null]) {
      const partial = structuredClone(tap), label = partial.device_use_sessions![0]!.session_labels![0]!;
      if (token === undefined) delete label.label_value_json; else label.label_value_json = token;
      expect(parseStudyMethodProfileLibrary(partial).device_use_sessions).toEqual(partial.device_use_sessions);
    }
    const regret = nestedExample(nestedSessionWorks[1]!);
    regret.device_use_sessions![0]!.session_quantities![0]!.evidence_value_json = "1.01";
    expect(() => parseStudyMethodProfileLibrary(regret)).toThrow("invalid independent supplied quantity");
    const unlocking = nestedExample(nestedSessionWorks[2]!);
    unlocking.sampled_quantity_observations!.at(-1)!.quantities!.find(q => q.observed_property === "pattern stealth mode")!.evidence_value_json = "0";
    expect(() => parseStudyMethodProfileLibrary(unlocking)).toThrow("independent supplied boolean");
  });

  itWithPrivateCorpus.each([
    ["clustering.input_sequence", "one-second tap counts", " [0,null,1,2] ", ["[1.5]", "[-1]", '["1"]', "[true]", "[1e400]", "1", "{}"]],
    ["clustering.timestamp_normalization", "normalized timestamps", "[0,null,0.50,1]", ["[1.01]", "[-0.01]", '["0.5"]', "[false]", "[1e400]", "0.5", "{}"]],
    ["clustering.length_normalization", "length-normalized tap counts", "[0,null,0.75,2]", ["[-0.01]", '["0.75"]', "[true]", "[1e400]", "2", "{}"]],
  ] as const)("preserves supplied sampled %s vectors, opaque encodings and unknowns without coercion", (key, property, valid, invalid) => {
    const source = nestedExample(nestedSessionWorks[0]!);
    const row = structuredClone(source.sampled_quantity_observations![0]!);
    delete row.device_use_session_reference;
    delete row.session_action_reference;
    row.method_setting_reference = source.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!.method_setting_id;
    row.quantities = [{ observed_property: property, evidence_value_json: valid }];
    const input = { profiles: source.profiles, sampled_quantity_observations: [row] };
    for (const token of [valid, '"unrecovered lexical vector"', "null", null, undefined]) {
      const value = structuredClone(input), quantity = value.sampled_quantity_observations[0]!.quantities![0]!;
      if (token === undefined) delete quantity.evidence_value_json; else quantity.evidence_value_json = token;
      expect(parseStudyMethodProfileLibrary(value).sampled_quantity_observations).toEqual(value.sampled_quantity_observations);
    }
    for (const token of invalid) {
      const value = structuredClone(input);
      value.sampled_quantity_observations[0]!.quantities![0]!.evidence_value_json = token;
      expect(() => parseStudyMethodProfileLibrary(value)).toThrow("count/normalized vector");
    }
  });

  for (const work of nestedSessionWorks) itWithPrivateCorpus("round-trips exact independent children and all generated owners for " + work, async () => {
    const input = nestedExample(work);
    const parsed = parseStudyMethodProfileLibrary(input);
    for (const channel of nestedChannels) expect(parsed[channel]).toEqual(input[channel]);
    const selection = { profile: parsed.profiles[0], ...Object.fromEntries(nestedChannels.map(channel => [channel, parsed[channel]])) };
    await saveResearchMethodSelection(JSON.stringify(selection));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as Record<string, unknown>;
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], ...Object.fromEntries(nestedChannels.map(channel => [channel, saved[channel]])) });
    for (const channel of nestedChannels) expect(restored[channel]).toEqual(input[channel]);
    const result = execFileSync("uvx", ["--from", "linkml==1.10.0", "--with", "jsonschema", "python", "-c", [
      "import json,sys", "from jsonschema import Draft202012Validator", "sys.path.insert(0,sys.argv[2])",
      "import chronicle_research_ontology as model", "schema=json.load(open(sys.argv[1]))",
      "for name,rows in json.load(sys.stdin).items():",
      " validator=Draft202012Validator({'$ref':'#/$defs/'+name,'$defs':schema['$defs']})",
      " for row in rows:",
      "  validator.validate(row)",
      "  assert getattr(model,name)(**row).model_dump(exclude_unset=True)==row",
      "print('nested-session-shapes-preserve-independent-records')",
    ].join("\n"), resolve(import.meta.dirname, "../../schema/generated/json-schema/chronicle-research-ontology.schema.json"),
    resolve(import.meta.dirname, "../../schema/generated/pydantic")], { input: JSON.stringify({
      DeviceUseSessionRecord: input.device_use_sessions, SampledQuantityObservationRecord: input.sampled_quantity_observations,
      TaskOccurrenceRecord: input.task_occurrences, ScreenshotSessionRecord: input.screenshot_sessions,
      ParticipantDayObservationRecord: input.participant_day_observations,
    }), encoding: "utf8", timeout: 180_000 });
    expect(result.trim()).toBe("nested-session-shapes-preserve-independent-records");
    // Projection preservation is not execution of cross-record ownership checks.
  }, 60_000);

  itWithPrivateCorpus("keeps A→B→A identities and equal taps without membership or clock reconstruction", () => {
    const input = nestedExample(nestedSessionWorks[0]!);
    const parsed = parseStudyMethodProfileLibrary(input);
    const periods = parsed.device_use_sessions![0]!.session_actions!.filter(action => action.assigned_role_labels?.includes("foreground app period"));
    expect(periods.map(a => a.app_identifier)).toEqual(["app-A", "app-B", "app-A"]);
    expect(new Set(periods.map(a => a.task_action_id)).size).toBe(3);
    const taps = parsed.sampled_quantity_observations!.slice(0, 3);
    expect(taps[0]!.source_event_time_token).toBe(taps[1]!.source_event_time_token);
    expect(taps[0]!.quantities).toEqual(taps[1]!.quantities);
    expect(taps[0]!.sampled_observation_id).not.toBe(taps[1]!.sampled_observation_id);
    expect(taps[0]!.session_action_reference).not.toBe(taps[2]!.session_action_reference);
    expect(taps[0]).not.toHaveProperty("observation_instant");
    const changed = structuredClone(input);
    changed.sampled_quantity_observations![0]!.session_action_reference = periods[2]!.task_action_id;
    expect(parseStudyMethodProfileLibrary(changed).sampled_quantity_observations![0]!.quantities).toEqual(taps[0]!.quantities);
    for (const mode of ["omitted", "null"] as const) {
      const unknown = structuredClone(input);
      if (mode === "omitted") {
        delete unknown.sampled_quantity_observations![0]!.device_use_session_reference;
        delete unknown.sampled_quantity_observations![0]!.session_action_reference;
      } else {
        unknown.sampled_quantity_observations![0]!.device_use_session_reference = null;
        unknown.sampled_quantity_observations![0]!.session_action_reference = null;
      }
      expect(parseStudyMethodProfileLibrary(unknown).sampled_quantity_observations).toEqual(unknown.sampled_quantity_observations);
    }
    const partial = structuredClone(input);
    partial.device_use_sessions![0]!.session_actions!.reverse();
    partial.device_use_sessions![0]!.session_quantities![0]!.evidence_value_json = "0";
    expect(parseStudyMethodProfileLibrary(partial).device_use_sessions).toEqual(partial.device_use_sessions);
  });

  for (const work of nestedSessionWorks) itWithPrivateCorpus("rejects foreign/ambiguous parents, missing/local-wrong actions and source transplants for " + work, () => {
    const input = nestedExample(work);
    const childOf = (value: typeof input): Record<string, unknown> => work === nestedSessionWorks[0]
      ? value.sampled_quantity_observations![0]! : work === nestedSessionWorks[1] ? value.screenshot_sessions![0]! : value.task_occurrences![0]!;
    const mutations: Array<(value: typeof input) => void> = [
      v => { childOf(v).device_use_session_reference = "foreign-parent"; },
      v => { childOf(v).session_action_reference = "foreign-action"; },
      v => { delete childOf(v).device_use_session_reference; },
      v => { childOf(v).device_use_session_reference = null; },
      v => { childOf(v).participant_id = "foreign-person"; },
      v => { childOf(v).device_id = "foreign-known-device"; },
      v => { childOf(v).session_action_reference = " "; },
      v => {
        const parent = structuredClone(v.device_use_sessions![0]!);
        parent.device_id = "example:other-device";
        v.device_use_sessions!.push(parent);
        delete childOf(v).device_id; // Unknown device cannot select either parent.
      },
      v => {
        const other = structuredClone(v.device_use_sessions![0]!);
        other.device_use_session_id = "example:other-parent";
        other.session_actions![0]!.task_action_id = "only-in-other-parent";
        v.device_use_sessions!.push(other);
        childOf(v).session_action_reference = "only-in-other-parent";
      },
      v => {
        const parent = v.device_use_sessions![0]!;
        parent.session_actions![0]!.assigned_role_labels = [work === nestedSessionWorks[2] ? "foreground app period" : "unlock attempt"];
      },
    ];
    if (work !== nestedSessionWorks[2]) mutations.push(v => { v.device_use_sessions![0]!.session_actions![0]!.app_identifier = "foreign-known-app"; });
    for (const mutate of mutations) { const changed = structuredClone(input); mutate(changed); expect(() => parseStudyMethodProfileLibrary(changed)).toThrow(); }
    const unknownDevice = structuredClone(input);
    delete childOf(unknownDevice).device_id;
    expect(parseStudyMethodProfileLibrary(unknownDevice)).toBeDefined();
    const transplant = pulseScreenshotRangeExample();
    Object.assign(transplant.screenshot_sessions[0]!, { device_use_session_reference: null, session_action_reference: null });
    expect(() => parseStudyMethodProfileLibrary(transplant)).toThrow("cross-carrier");
  });


  itWithPrivateCorpus("keeps Tapping screen-sleep ID generation separate from unlock-to-lock closure", () => {
    const input = nestedExample(nestedSessionWorks[0]!);
    const session = parseStudyMethodProfileLibrary(input).device_use_sessions![0]!;
    const reset = session.session_actions!.find(action => action.task_action_id === "example:tap-screen-sleep-reset")!;
    const generated = session.session_quantities!.find(quantity => quantity.quantity_record_id === "sleep-generated-ID")!;
    expect(session.end_condition).toBe("screen locked again");
    expect(reset.action_label).toBe("screen sleep");
    expect(reset).not.toHaveProperty("denotes_interval");
    expect(reset).not.toHaveProperty("app_identifier");
    expect(session).not.toHaveProperty("following_device_use_session_reference");
    expect(generated.evidence_value_json).toBe('"opaque:generated-at-screen-sleep"');
    expect(generated.support_task_action_references).toEqual([reset.task_action_id]);
    expect(generated.quantity_scope).toBe("session");
    const changedQuantity = (value: typeof input) => value.device_use_sessions![0]!.session_quantities!
      .find(quantity => quantity.quantity_record_id === "sleep-generated-ID")!;
    for (const mode of ["omitted", "null", "empty"] as const) {
      const changed = structuredClone(input), quantity = changedQuantity(changed);
      if (mode === "omitted") delete quantity.support_task_action_references;
      else quantity.support_task_action_references = mode === "null" ? null : [];
      expect(parseStudyMethodProfileLibrary(changed).device_use_sessions).toEqual(changed.device_use_sessions);
    }
    for (const value of [undefined, null, "null", "0", '"other opaque ID"'] as const) {
      const changed = structuredClone(input), quantity = changedQuantity(changed);
      if (value === undefined) delete quantity.evidence_value_json;
      else quantity.evidence_value_json = value;
      expect(parseStudyMethodProfileLibrary(changed).device_use_sessions).toEqual(changed.device_use_sessions);
    }
    const bad: Array<(value: typeof input) => void> = [
      value => { changedQuantity(value).support_task_action_references = ["tap-period-0"]; },
      value => { changedQuantity(value).support_task_action_references = ["foreign-reset"]; },
      value => { value.device_use_sessions![0]!.session_actions!.find(action => action.task_action_id === reset.task_action_id)!.action_label = "screen locked again"; },
      value => { value.device_use_sessions![0]!.end_condition = "screen sleep"; },
      value => { changedQuantity(value).quantity_scope = "app"; },
      value => { changedQuantity(value).evidence_unit = "seconds"; },
      value => { changedQuantity(value).source_locators = []; },
      value => {
        const definition = value.profiles[0]!.method_settings.find(setting => setting.method_setting_id === generated.quantity_setting_reference)!;
        definition.method_value_json = JSON.stringify({ source_facing_role: definition.method_setting_role,
          source_facing_target: definition.method_target_layer, definition: null });
      },
    ];
    for (const value of ["true", "false", "[]", "{}", '""']) bad.push(input => { changedQuantity(input).evidence_value_json = value; });
    for (const mutate of bad) { const changed = structuredClone(input); mutate(changed); expect(() => parseStudyMethodProfileLibrary(changed)).toThrow(); }
  });

  itWithPrivateCorpus("rejects only provably too-old Regret supports at the independent one/four-image context limits", () => {
    const input = nestedExample(nestedSessionWorks[1]!);
    for (const description of [true, false]) {
      const changed = structuredClone(input), session = changed.screenshot_sessions![0]!, images = session.screenshots;
      const annotation = session.screenshot_range_annotations![description ? 1 : 2]!;
      const currentIndex = description ? 4 : 5;
      annotation.first_screenshot_reference = images[currentIndex]!.screenshot_record_id;
      annotation.last_screenshot_reference = images[currentIndex]!.screenshot_record_id;
      annotation.support_screenshot_references = [images[0]!.screenshot_record_id];
      // Description has three known intervening images; classifier has four.
      // Equal opaque times and array order do not establish a join or completeness.
      expect(() => parseStudyMethodProfileLibrary(changed)).toThrow("known prior screenshot context limit");
      if (description) {
        const boundary = structuredClone(changed);
        boundary.screenshot_sessions![0]!.screenshot_range_annotations![1]!.support_screenshot_references = [images[2]!.screenshot_record_id];
        expect(() => parseStudyMethodProfileLibrary(boundary)).toThrow("known prior screenshot context limit");
      }
      for (const state of ["omitted", "null"] as const) {
        const unknown = structuredClone(changed), unknownImages = unknown.screenshot_sessions![0]!.screenshots;
        const hide = description ? [1, 2, 3] : [1];
        for (const index of hide) {
          if (state === "omitted") delete unknownImages[index]!.screenshot_sequence_position;
          else unknownImages[index]!.screenshot_sequence_position = null;
        }
        expect(parseStudyMethodProfileLibrary(unknown).screenshot_sessions).toEqual(unknown.screenshot_sessions);
        unknown.screenshot_sessions![0]!.screenshots.reverse();
        expect(parseStudyMethodProfileLibrary(unknown).screenshot_sessions).toEqual(unknown.screenshot_sessions);
      }
      for (const index of [0, currentIndex]) {
        const unknown = structuredClone(changed);
        unknown.screenshot_sessions![0]!.screenshots[index]!.screenshot_sequence_position = null;
        expect(parseStudyMethodProfileLibrary(unknown).screenshot_sessions).toEqual(unknown.screenshot_sessions);
      }
    }
  });

  itWithPrivateCorpus("keeps Regret description, classifier, two assessors, consensus and uncertain intention distinct", () => {
    const input = nestedExample(nestedSessionWorks[1]!);
    const parsed = parseStudyMethodProfileLibrary(input);
    const session = parsed.screenshot_sessions![0]!;
    const annotations = session.screenshot_range_annotations!;
    expect(annotations[1]!.support_screenshot_references).toHaveLength(1);
    expect(annotations[2]!.support_screenshot_references).toHaveLength(4);
    expect(annotations[3]!.assessor_id).not.toBe(annotations[4]!.assessor_id);
    expect(annotations[3]!.range_label_values_json).not.toBe(annotations[4]!.range_label_values_json);
    expect(annotations[5]!.support_screenshot_references).toBeNull();
    expect(parsed.device_use_sessions![0]!.session_questionnaire_responses!.map(r => r.response_value_json))
      .toContain('"I am not sure"');
    const otherVisit = structuredClone(input);
    otherVisit.screenshot_sessions![0]!.session_action_reference = input.device_use_sessions![0]!.session_actions![2]!.task_action_id;
    expect(parseStudyMethodProfileLibrary(otherVisit).screenshot_sessions![0]!.screenshots).toEqual(session.screenshots);
    const sameImages = structuredClone(input);
    sameImages.screenshot_sessions![0]!.screenshots.reverse();
    expect(parseStudyMethodProfileLibrary(sameImages).screenshot_sessions![0]!.screenshots).toEqual(sameImages.screenshot_sessions![0]!.screenshots);
    for (const state of ["omitted", "null", "empty"] as const) {
      const changed = structuredClone(input), annotation = changed.screenshot_sessions![0]!.screenshot_range_annotations![2]!;
      if (state === "omitted") delete annotation.support_screenshot_references;
      else annotation.support_screenshot_references = state === "null" ? null : [];
      expect(parseStudyMethodProfileLibrary(changed).screenshot_sessions).toEqual(changed.screenshot_sessions);
    }
    const bad: Array<(value: typeof input) => void> = [
      v => { v.screenshot_sessions![0]!.screenshot_range_annotations![1]!.support_screenshot_references = v.screenshot_sessions![0]!.screenshots.slice(0,2).map(s => s.screenshot_record_id); },
      v => { v.screenshot_sessions![0]!.screenshot_range_annotations![2]!.support_screenshot_references = v.screenshot_sessions![0]!.screenshots.slice(0,5).map(s => s.screenshot_record_id); },
      v => { v.screenshot_sessions![0]!.screenshot_range_annotations![2]!.support_screenshot_references = ["foreign-image"]; },
      v => { v.screenshot_sessions![0]!.screenshot_range_annotations![2]!.support_screenshot_references = [v.screenshot_sessions![0]!.screenshots[4]!.screenshot_record_id]; },
      v => { v.screenshot_sessions![0]!.screenshot_range_annotations![2]!.support_screenshot_references = [v.screenshot_sessions![0]!.screenshots[5]!.screenshot_record_id]; },
      v => { v.screenshot_sessions![0]!.screenshot_range_annotations![2]!.support_screenshot_references = [v.screenshot_sessions![0]!.screenshots[0]!.screenshot_record_id, v.screenshot_sessions![0]!.screenshots[0]!.screenshot_record_id]; },
      v => { v.screenshot_sessions![0]!.screenshot_range_annotations![2]!.last_screenshot_reference = v.screenshot_sessions![0]!.screenshots[5]!.screenshot_record_id; },
      v => { v.screenshot_sessions![0]!.screenshot_range_annotations![2]!.assessor_id = " "; },
      v => { v.screenshot_sessions![0]!.screenshot_range_annotations![2]!.range_label_values_json = '{"activity category":"No Specific Goal","justification":null}'; },
      v => { v.device_use_sessions![0]!.session_questionnaire_responses![0]!.response_value_json = '"Other"'; },
      v => { v.device_use_sessions![0]!.session_questionnaire_responses![1]!.response_value_json = "8"; },
      v => { v.device_use_sessions![0]!.session_questionnaire_responses![0]!.support_task_action_references = ["foreign-period"]; },
      v => { v.device_use_sessions![0]!.session_questionnaire_responses![0]!.source_locators = []; },
      v => { v.device_use_sessions![0]!.session_labels![0]!.source_locators = []; },
      v => { v.device_use_sessions![0]!.session_quantities![0]!.support_task_action_references = v.device_use_sessions![0]!.session_actions!.slice(0,2).map(a => a.task_action_id); },
    ];
    for (const mutate of bad) { const changed = structuredClone(input); mutate(changed); expect(() => parseStudyMethodProfileLibrary(changed)).toThrow(); }
  });

  itWithPrivateCorpus("retains Anatomy correct-code versus dismissal and Figure6 partial instrument labels without recoding", () => {
    const input = nestedExample(nestedSessionWorks[2]!);
    const parsed = parseStudyMethodProfileLibrary(input);
    const wrongTopic = structuredClone(input);
    wrongTopic.task_occurrences![3]!.task_questionnaire_responses![0]!.observed_property = "invented exit-survey question";
    expect(() => parseStudyMethodProfileLibrary(wrongTopic)).toThrow("exit-survey statement label or topic");
    expect(parsed.task_occurrences!.slice(0,3).map(t => t.criterion_assessments![0]!.assessment_value_json)).toEqual(['"incorrect"','"too short"','"correct"']);
    expect(parsed.task_occurrences![2]!.criterion_assessments![2]!.support_task_action_references).toEqual(["example:dismissed"]);
    expect(parsed.task_occurrences![0]!.criterion_assessments).toHaveLength(2);
    expect(parsed.task_occurrences![3]!.task_questionnaire_responses).toHaveLength(10);
    expect(parsed.task_occurrences![4]!.task_questionnaire_responses).toHaveLength(2);
    expect(parsed.task_occurrences![3]!.participant_id).not.toBe(parsed.task_occurrences![4]!.participant_id);
    expect(parsed.task_occurrences![5]!.criterion_assessments![0]!.support_task_action_references).toEqual(["example:abort-screen-off"]);
    expect(parsed.sampled_quantity_observations).toHaveLength(8);
    expect(parsed.sampled_quantity_observations![7]!.quantities![2]!.evidence_value_json).toBe("false");
    for (const value of ["0", "8", "1.5", "false"]) {
      const changed = structuredClone(input);
      changed.task_occurrences![3]!.task_questionnaire_responses![0]!.response_value_json = value;
      expect(() => parseStudyMethodProfileLibrary(changed)).toThrow();
    }
    const conflated = structuredClone(input);
    conflated.task_occurrences![2]!.criterion_assessments![0]!.assessment_value_json = '"Keyguard dismissed"';
    expect(() => parseStudyMethodProfileLibrary(conflated)).toThrow("unlock outcome");
  });

  for (const [work, key] of [[nestedSessionWorks[0]!, "phone_session.boundary"], [nestedSessionWorks[1]!, "activity.categories"], [nestedSessionWorks[2]!, "survey.instrument"]] as const) {
    itWithPrivateCorpus("rejects inner-body decoys and explicit wrong tuples for " + key, () => {
      const input = nestedExample(work), definition = input.profiles[0]!.method_settings.find(s => s.method_parameter_key === key)!;
      const raw: unknown = JSON.parse(String(definition.method_value_json));
      const body: unknown = typeof raw === "object" && raw !== null && Object.hasOwn(raw, "definition") ? (raw as { definition: unknown }).definition : raw;
      for (const inner of [null, false, 7, "invalid", [], {}]) {
        const changed = structuredClone(input), setting = changed.profiles[0]!.method_settings.find(s => s.method_setting_id === definition.method_setting_id)!;
        setting.method_value_json = JSON.stringify({ ...(typeof body === "object" && body !== null ? body : {}),
          source_facing_role: definition.method_setting_role, source_facing_target: definition.method_target_layer, definition: inner });
        expect(() => parseStudyMethodProfileLibrary(changed)).toThrow();
      }
      for (const field of ["source_facing_role", "source_facing_target"] as const) {
        const changed = structuredClone(input), setting = changed.profiles[0]!.method_settings.find(s => s.method_setting_id === definition.method_setting_id)!;
        setting.method_value_json = JSON.stringify({ definition: body, source_facing_role: definition.method_setting_role,
          source_facing_target: definition.method_target_layer, [field]: field === "source_facing_role" ? "aggregation" : "participant_day" });
        expect(() => parseStudyMethodProfileLibrary(changed)).toThrow();
      }
      const wrapped = structuredClone(input);
      wrapped.profiles[0]!.method_settings.find(s => s.method_setting_id === definition.method_setting_id)!.method_value_json = JSON.stringify({
        source_facing_role: definition.method_setting_role, source_facing_target: definition.method_target_layer, definition: body });
      expect(parseStudyMethodProfileLibrary(wrapped)).toBeDefined();
    });
  }
});
