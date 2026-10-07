import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect } from "vitest";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { privateCorpusAvailable, privateCorpusPath } from "@/testSupport/privateCorpus";
import { parseStudyMethodProfileLibrary, compileNativeMethodProfile, type StudyMethodProfileLibrary } from "./methodProfiles";
import { taskInstrumentExamples } from "../../e2e/fixtures/task-instrument-examples";

const root = resolve(import.meta.dirname, "../../..");
const records = JSON.parse(readFileSync(resolve(root, "web/e2e/fixtures/screen-text-example.json.fixture"), "utf8")) as Required<Pick<StudyMethodProfileLibrary, "screen_text_captures" | "sensor_control_occurrences">>;
// Assigned before the corpus-gated tests run; collection never reads the corpus.
let library: StudyMethodProfileLibrary;
let profile: StudyMethodProfileLibrary["profiles"][number];
let input: { profiles: StudyMethodProfileLibrary["profiles"] } & typeof records;
beforeAll(() => {
  if (!privateCorpusAvailable) return;
  library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as StudyMethodProfileLibrary;
  profile = library.profiles.find((p) => p.source_work_id === "doi:10.1145/3613904.3642347")!;
  input = { profiles: [profile], ...records };
});

describe("supplied text captures and independent sensor-control occurrences", () => {
  itWithPrivateCorpus.each([0, 1])("admits ScreenTK canonical capture %s with independent source event time", index => {
    const p = library.profiles.find(p => p.source_work_id === "doi:10.1145/3675094.3677547")!;
    const captures = [taskInstrumentExamples(p).screen_text_captures![index]!];
    expect(parseStudyMethodProfileLibrary({ profiles: [p], screen_text_captures: captures }).screen_text_captures).toEqual(captures);
  });
  itWithPrivateCorpus("preserves ScreenTK independent times, duplicate-content identities and exact source definitions", () => {
    const p = library.profiles.find(p => p.source_work_id === "doi:10.1145/3675094.3677547")!;
    const source = { profiles: [p], screen_text_captures: taskInstrumentExamples(p).screen_text_captures! };
    expect(parseStudyMethodProfileLibrary(source).screen_text_captures).toEqual(source.screen_text_captures);
    const jmir = library.profiles.find(p => p.source_work_id === "doi:10.2196/55999")!;
    const mixed = { profiles: [profile, jmir, p], screen_text_captures: [...records.screen_text_captures, ...taskInstrumentExamples(jmir).screen_text_captures!, ...source.screen_text_captures] };
    expect(parseStudyMethodProfileLibrary(mixed).screen_text_captures).toEqual(mixed.screen_text_captures);
    expect(source.screen_text_captures[1]!.text_capture_id).not.toBe(source.screen_text_captures[2]!.text_capture_id);
    expect(source.screen_text_captures[1]!.source_event_time_token).toBe(source.screen_text_captures[2]!.source_event_time_token);
    for (const field of ["capture_instant", "source_event_time_token"] as const) {
      for (const token of [undefined, null, "", "independently supplied token"]) {
        const value = structuredClone(source);
        if (token === undefined) delete value.screen_text_captures[3]![field]; else value.screen_text_captures[3]![field] = token;
        expect(parseStudyMethodProfileLibrary(value).screen_text_captures).toEqual(value.screen_text_captures);
      }
      for (const bad of [0, false, {}, []]) {
        const value = structuredClone(source); Reflect.set(value.screen_text_captures[0]!, field, bad);
        expect(() => parseStudyMethodProfileLibrary(value)).toThrow("string or null");
      }
    }
    const setting = (value: typeof source) => value.profiles[0]!.method_settings.find(s => s.method_parameter_key === "input.screen_text_observation_time_and_content")!;
    const original = JSON.parse(String(setting(source).method_value_json)) as Record<string, unknown>;
    const body = original.definition as Record<string, unknown>;
    const bare = structuredClone(source); setting(bare).method_value_json = JSON.stringify(body);
    expect(parseStudyMethodProfileLibrary(bare).screen_text_captures).toEqual(source.screen_text_captures);
    for (const content of [
      { ...original, definition: null }, { ...original, definition: {} },
      { ...original, definition: { ...body, timestamp_caption: "capture time" } },
      { ...original, definition: { unit: "one captured text-content snapshot" } },
      { ...original, source_facing_target: "raw_record" }, { ...original, source_facing_role: null },
    ]) {
      const value = structuredClone(source); setting(value).method_value_json = JSON.stringify(content);
      expect(() => parseStudyMethodProfileLibrary(value)).toThrow("text-capture definition");
    }
    const foreign = structuredClone(source);
    foreign.profiles[0]!.source_work_id = "doi:10.1145/3613904.3642347";
    foreign.screen_text_captures.forEach(row => { row.source_work_id = foreign.profiles[0]!.source_work_id; });
    expect(() => parseStudyMethodProfileLibrary({ profiles: foreign.profiles })).not.toThrow();
    expect(() => parseStudyMethodProfileLibrary(foreign)).toThrow("text-capture definition");
    const duplicate = structuredClone(source); duplicate.screen_text_captures.push(structuredClone(duplicate.screen_text_captures[0]!));
    expect(() => parseStudyMethodProfileLibrary(duplicate)).toThrow("duplicated within profile/participant/device");
  });
  itWithPrivateCorpus("preserves JMIR55999 screenshot-derived text without treating it as raw Accessibility text or running OCR", () => {
    const derived = library.profiles.find(p => p.source_work_id === "doi:10.2196/55999")!;
    const input = { profiles: [derived], screen_text_captures: taskInstrumentExamples(derived).screen_text_captures! };
    expect(parseStudyMethodProfileLibrary(input).screen_text_captures).toEqual(input.screen_text_captures);
    for (const value of [undefined, null, "", " equal supplied text token\n"]) {
      const changed = structuredClone(input);
      if (value === undefined) delete changed.screen_text_captures[0]!.screen_text; else changed.screen_text_captures[0]!.screen_text = value;
      expect(parseStudyMethodProfileLibrary(changed).screen_text_captures).toEqual(changed.screen_text_captures);
    }
    const setting = derived.method_settings.find(s => s.method_parameter_key === "text.ocr")!;
    const body = JSON.parse(String(setting.method_value_json)) as Record<string, unknown>;
    expect(body).toMatchObject({ unit: "text extracted from one screenshot", extractor: "EasyOCR",
      discard_text_confidence: { operator: "<", value: 0.7 }, normalization: ["lemmatization", "case reduction", "removal of punctuation and numbers"] });
    for (const wrapped of [false, true]) {
      const valid = structuredClone(input);
      valid.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!.method_value_json = JSON.stringify(wrapped
        ? { definition: body, source_facing_role: "feature_engineering", source_facing_target: "derived_feature" } : body);
      expect(parseStudyMethodProfileLibrary(valid).screen_text_captures).toEqual(input.screen_text_captures);
      for (const change of [{ unit: "one captured text-content snapshot" }, { extractor: "" }, { input: "raw event" },
        { discard_text_confidence: { operator: "<=", value: 0.7 } }, { discard_text_confidence: { operator: "<", value: 0.07 } },
        { normalization: ["case reduction"] }, { source_facing_role: "event_schema" }, { source_facing_target: "raw_record" }]) {
        const invalid = structuredClone(valid);
        invalid.profiles[0]!.method_settings.find(s => s.method_setting_id === setting.method_setting_id)!.method_value_json = JSON.stringify(wrapped
          ? { definition: { ...body, ...change }, source_facing_role: "feature_engineering", source_facing_target: "derived_feature", ...Object.fromEntries(Object.entries(change).filter(([key]) => key.startsWith("source_facing_"))) }
          : { ...body, ...change });
        expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("text-capture definition");
      }
    }
    for (const mutate of [
      (x: typeof input) => { x.screen_text_captures[0]!.source_work_id = "foreign"; },
      (x: typeof input) => { x.screen_text_captures[0]!.method_setting_reference = "foreign"; },
      (x: typeof input) => { x.screen_text_captures.push(structuredClone(x.screen_text_captures[0]!)); },
      (x: typeof input) => { Reflect.set(x.screen_text_captures[0]!, "screen_text", 0); },
    ]) { const invalid = structuredClone(input); mutate(invalid); expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(); }
    const mixed = { profiles: [profile, derived], screen_text_captures: [...records.screen_text_captures, ...input.screen_text_captures] };
    expect(parseStudyMethodProfileLibrary(mixed).screen_text_captures).toEqual(mixed.screen_text_captures);
  });

  itWithPrivateCorpus("preserves complete normalized data, equal text/bounds distinctions and null/empty/omitted values", () => {
    expect(profile).toBeDefined();
    const parsed = parseStudyMethodProfileLibrary(input);
    expect(parsed.screen_text_captures).toEqual(records.screen_text_captures);
    expect(parsed.sensor_control_occurrences).toEqual(records.sensor_control_occurrences);
    expect(parseStudyMethodProfileLibrary(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    const [a, b] = parsed.screen_text_captures![0]!.screen_phrases!;
    expect(a!.phrase_text).toBe(b!.phrase_text);
    expect(a!.phrase_left_px).not.toBe(b!.phrase_left_px);
    expect(parsed.screen_text_captures![0]!.screen_text).toBe(" Inbox || independent flat token\n");
    expect(parsed.screen_text_captures![0]!.capture_instant).toBe(parsed.screen_text_captures![1]!.capture_instant);
    expect(compileNativeMethodProfile(profile).ok).toBe(false);
  });
  itWithPrivateCorpus("retains child order and capture-local identities without using text or times as keys", () => {
    const x = structuredClone(input);
    x.screen_text_captures[0]!.screen_phrases!.reverse();
    x.screen_text_captures[1]!.screen_phrases = [structuredClone(x.screen_text_captures[0]!.screen_phrases![0]!)];
    expect(parseStudyMethodProfileLibrary(x).screen_text_captures).toEqual(x.screen_text_captures);
    expect(parseStudyMethodProfileLibrary({ profiles: [profile], screen_text_captures: [], sensor_control_occurrences: [] })).toMatchObject({ screen_text_captures: [], sensor_control_occurrences: [] });
    expect(parseStudyMethodProfileLibrary({ profiles: [profile] })).not.toHaveProperty("screen_text_captures");
  });
  itWithPrivateCorpus("does not accept a keyboard before/after transaction as one screen-text snapshot", () => {
    // Akpinar et al., TOCHI 2023, physical p12/Fig. 4: one action has both text states and deletion/password flags.
    const x = structuredClone(input);
    Object.assign(x.screen_text_captures[0]!, {
      before_text: "hello",
      current_text: "hell",
      is_deleted: true,
      is_password: false,
    });
    expect(() => parseStudyMethodProfileLibrary(x)).toThrow("unknown fields");
  });
  const mutations: Array<[(x: typeof input) => void, string]> = [
    [(x) => Reflect.set(x.screen_text_captures, 0, null), "screen_text_captures[0] must be an object"],
    [(x) => Reflect.set(x.screen_text_captures[0]!, "screen_phrases", {}), "screen_phrases must be an array or null"],
    [(x) => Reflect.set(x.screen_text_captures[0]!, "screen_phrases", [null]), "screen_phrases[0] must be an object"],
    [(x) => Reflect.set(x.screen_text_captures[0]!.screen_phrases![0]!, "phrase_text", false), "phrase_text must be a string or null"],
    [(x) => { x.screen_text_captures[0]!.screen_phrases![0]!.source_locators = []; }, "source_locators must be a non-empty string array"],
    [(x) => Reflect.set(x.sensor_control_occurrences, 0, null), "sensor_control_occurrences[0] must be an object"],
    [(x) => { x.sensor_control_occurrences[0]!.sensor_label = " "; }, "sensor_label must be nonblank"],
    [(x) => Reflect.set(x.sensor_control_occurrences[0]!, "occurrence_instant", false), "occurrence_instant must be a string or null"],
    [(x) => { x.screen_text_captures[0]!.source_work_id = "foreign"; }, "profile/source owner"],
    [(x) => { x.screen_text_captures[0]!.method_setting_reference = "foreign"; }, "local definition role/target"],
    [(x) => { x.screen_text_captures[0]!.method_setting_reference = "method-setting-e05cbf981cdb52c2f8a1eb94"; }, "text-capture definition"],
    [(x) => { x.sensor_control_occurrences[0]!.method_setting_reference = "method-setting-7388f44a069bb47d12f0ba37"; }, "logged sensor-control definition"],
    [(x) => { x.screen_text_captures.push(structuredClone(x.screen_text_captures[0]!)); }, "duplicated within profile/participant/device"],
    [(x) => { x.screen_text_captures[0]!.screen_phrases!.push(structuredClone(x.screen_text_captures[0]!.screen_phrases![0]!)); }, "duplicated within capture"],
    [(x) => { Reflect.set(x.screen_text_captures[0]!.screen_phrases![0]!, "phrase_left_px", "0"); }, "finite or null"],
    [(x) => { Reflect.set(x.screen_text_captures[0]!.screen_phrases![0]!, "phrase_left_px", Number.NaN); }, "finite or null"],
    [(x) => { Reflect.set(x.screen_text_captures[0]!.screen_phrases![0]!, "visible", true); }, "unknown fields"],
    [(x) => { Reflect.set(x.screen_text_captures[0]!, "screen_text", 0); }, "string or null"],
    [(x) => { Reflect.set(x.screen_text_captures[0]!, "record_origin", null); }, "record_origin is unknown"],
    [(x) => { Reflect.set(x.sensor_control_occurrences[0]!, "sensor_control_action", ["enable"]); }, "sensor_control_action is unknown"],
    [(x) => { Reflect.set(x.sensor_control_occurrences[0]!, "sensor_control_action", "ON"); }, "sensor_control_action is unknown"],
    [(x) => { x.sensor_control_occurrences.push(structuredClone(x.sensor_control_occurrences[0]!)); }, "duplicated within profile/participant/device"],
  ];
  itWithPrivateCorpus.each(mutations)("rejects malformed or semantically foreign supplied data %#", (mutate, message) => {
    const x = structuredClone(input); mutate(x);
    expect(() => parseStudyMethodProfileLibrary(x)).toThrow(message);
  });
  itWithPrivateCorpus("rejects a null root channel instead of coercing it to empty", () => {
    expect(() => parseStudyMethodProfileLibrary({ ...input, screen_text_captures: null })).toThrow("must be an array");
    expect(() => parseStudyMethodProfileLibrary({ ...input, sensor_control_occurrences: null })).toThrow("must be an array");
  });
});
