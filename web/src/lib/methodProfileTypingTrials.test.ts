import "fake-indexeddb/auto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { privateCorpusPath } from "@/testSupport/privateCorpus";
import { parseStudyMethodProfileLibrary } from "./methodProfiles";
import { loadResearchMethodSelection, saveResearchMethodSelection } from "./lastRunStore";
import { typingTransactionExample as input, typingCaseExample } from "../../e2e/fixtures/typing-transactions";
import { derivedTypingTrialExample } from "../../e2e/fixtures/derived-typing-trials";
import { createHash } from "node:crypto";
import { linkmlPython } from "../testSupport/linkmlPython";

it("rejects malformed keyboard and trial children at their exact supplied field", () => {
  const mutations: Array<[(source: typeof typingCaseExample) => void, string]> = [
    [s => Reflect.set(s, "keyboard_transactions", [null]), "keyboard_transactions[0]"],
    [s => Reflect.set(s.keyboard_transactions[0]!, "keyboard_transaction_id", " "), "keyboard_transactions[0].keyboard_transaction_id"],
    [s => Reflect.set(s.keyboard_transactions[0]!, "before_text", 3), "keyboard_transactions[0].before_text"],
    [s => Reflect.set(s, "typing_trials", [null]), "typing_trials[0]"],
    [s => Reflect.set(s.typing_trials[0]!, "keyboard_transaction_references", [" "]), "typing_trials[0].keyboard_transaction_references[0]"],
    [s => Reflect.set(s.typing_trials[0]!.text_change_cases[0]!, "support_keyboard_transaction_references", {}), "text_change_cases[0].support_keyboard_transaction_references"],
    [s => Reflect.set(s.typing_trials[0]!.text_change_cases[0]!, "system_verdicts", {}), "text_change_cases[0].system_verdicts"],
    [s => Reflect.set(s.typing_trials[0]!.text_change_cases[0]!, "system_verdicts", [null]), "text_change_cases[0].system_verdicts[0]"],
    [s => Reflect.set(s.typing_trials[0]!.text_change_cases[0]!.system_verdicts[0]!, "questionnaire_response_references", {}), "system_verdicts[0].questionnaire_response_references"],
  ];
  for (const [mutate, path] of mutations) {
    const source = structuredClone(typingCaseExample); mutate(source);
    expect(() => parseStudyMethodProfileLibrary(source), path).toThrow(path);
  }
});

describe("independent keyboard transactions and supplied typing-trial membership", () => {
  itWithPrivateCorpus("uses the admitted paper's complete definitions for supplied normalized records and retains them across storage", async () => {
    const canonical = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: Array<{ source_work_id: string; method_profile_id: string; method_settings: Array<{ method_parameter_key: string; method_setting_id: string }> }> };
    const profile = canonical.profiles.find(p => p.source_work_id === "doi:10.1145/3577013");
    expect(profile, "canonical admission is required; the isolated fixture is insufficient").toBeDefined();
    if (!profile) throw new Error("Typing profile absent");
    const setting = (key: string) => {
      const row = profile.method_settings.find(s => s.method_parameter_key === key);
      if (!row) throw new Error(`Missing source definition: ${key}`);
      return row.method_setting_id;
    };
    const owner = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id };
    // The rows remain analyst-constructed; this checks real source-definition ownership, not raw-row recovery.
    const rows = {
      profiles: [profile],
      keyboard_transactions: input.keyboard_transactions.map(row => ({ ...row, ...owner, keyboard_schema_setting_reference: setting("collector.keyboard_event_schema") })),
      typing_trials: typingCaseExample.typing_trials.map(row => ({ ...row, ...owner,
        trial_partition_setting_reference: setting("trial.partition_and_order"), trial_app_switch_setting_reference: setting("trial.app_switch_boundary"),
        trial_reset_setting_reference: setting("trial.empty_before_boundary"), trial_pause_setting_reference: setting("trial.pause_type_thresholds"),
        token_evaluation_cases: row.token_evaluation_cases.map(word => ({ ...word,
          system_verdicts: word.system_verdicts.map(verdict => ({ ...verdict, label_setting_reference: setting("classification.lexical_resources") })),
          followup_responses: word.followup_responses.map(response => ({ ...response, questionnaire_setting_reference: setting("evaluation.manual_followup_sampling") })),
        })),
        text_change_cases: row.text_change_cases.map(change => ({ ...change,
          system_verdicts: change.system_verdicts.map(verdict => ({ ...verdict, label_setting_reference: setting(verdict.label_record_id === "initial-verdict" ? "classification.prefeedback_edit_correction" : "classification.revised_after_followup") })),
          followup_responses: change.followup_responses.map(response => ({ ...response, questionnaire_setting_reference: setting("evaluation.manual_followup_sampling") })),
        })),
        trial_questionnaire_responses: row.trial_questionnaire_responses.map(response => ({ ...response, questionnaire_setting_reference: setting(response.questionnaire_response_id === "trial-location" ? "instrument.context_questions_and_options" : "instrument.subjective_error_branches") })),
      })),
    };
    const parsed = parseStudyMethodProfileLibrary(rows);
    expect(parsed.profiles[0]!.method_settings).toHaveLength(37);
    expect(parsed.profiles[0]!.method_operations).toHaveLength(11);
    expect(parsed.keyboard_transactions).toEqual(rows.keyboard_transactions);
    expect(parsed.typing_trials).toEqual(rows.typing_trials);
    const candidateDefinition = structuredClone(rows);
    candidateDefinition.typing_trials[0]!.token_evaluation_cases[0]!.system_verdicts[0]!.label_setting_reference = setting("classification.typing_error_candidates");
    expect(parseStudyMethodProfileLibrary(candidateDefinition).typing_trials).toEqual(candidateDefinition.typing_trials);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], keyboard_transactions: parsed.keyboard_transactions, typing_trials: parsed.typing_trials }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; keyboard_transactions: unknown; typing_trials: unknown };
    expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], keyboard_transactions: saved.keyboard_transactions, typing_trials: saved.typing_trials })).toEqual(parsed);
  });

  it("round-trips standalone actions and separately supplied membership without constructing trials", async () => {
    const parsed = parseStudyMethodProfileLibrary(input);
    expect(parsed.keyboard_transactions).toEqual(input.keyboard_transactions);
    expect(parsed.typing_trials).toEqual(input.typing_trials);
    expect(parseStudyMethodProfileLibrary({ profiles: input.profiles, keyboard_transactions: input.keyboard_transactions }).typing_trials).toBeUndefined();
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], selectedLevels: {}, keyboard_transactions: parsed.keyboard_transactions, typing_trials: parsed.typing_trials }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; keyboard_transactions: unknown; typing_trials: unknown };
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], keyboard_transactions: saved.keyboard_transactions, typing_trials: saved.typing_trials });
    expect(restored).toEqual(parsed);
    expect(restored.keyboard_transactions![0]!.before_text).toBe("Cony");
    expect(restored.keyboard_transactions![0]!.current_text).toBe("Con");
    expect(restored.keyboard_transactions![0]!.keyboard_timestamp).toBe(restored.keyboard_transactions![1]!.keyboard_timestamp);
    const pauseValue = restored.profiles[0]!.method_settings.find(setting => setting.method_setting_id === "setting:pauses")!.method_value_json;
    if (typeof pauseValue !== "string") throw new Error("Pause definition did not retain JSON text");
    expect(JSON.parse(pauseValue)).toEqual({
      estimator: "mean inter-key interval plus three SD, computed on48-participant dataset", types: [
        { transition: "same non-backspace or same backspace", mean_ms: 285, segmentation_ms: 2346 },
        { transition: "non-backspace after backspace", mean_ms: 742, segmentation_ms: 9867 },
        { transition: "backspace after non-backspace", mean_ms: 899, segmentation_ms: 23189 },
      ], comparison_operator: null, per_person_recalibration: false, reported_input_events: 938431, reported_trials_before_validation: 42018,
    });
    const unknownDevice = structuredClone(input);
    for (const record of [...unknownDevice.keyboard_transactions, ...unknownDevice.typing_trials]) Reflect.deleteProperty(record, "device_id");
    expect(parseStudyMethodProfileLibrary(unknownDevice).typing_trials).toEqual(unknownDevice.typing_trials);

    const schema = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../schema/generated/json-schema/chronicle-research-ontology.schema.json"), "utf8")) as { $defs: Record<string, unknown> };
    const checked = execFileSync(linkmlPython(), ["-c", [
      "import json,sys", "from jsonschema import Draft202012Validator", "x=json.load(sys.stdin)",
      "for name,rows in [('KeyboardTransactionRecord',x['actions']),('TypingTrialRecord',x['trials'])]:",
      " v=Draft202012Validator({'$ref':'#/$defs/'+name,'$defs':x['schema']['$defs']})",
      " for row in rows:", "  v.validate(row)", "  assert not v.is_valid(dict(row,invented_source_serializer=True))", "print('shape-ok')",
    ].join("\n")], { input: JSON.stringify({ schema, actions: parsed.keyboard_transactions, trials: parsed.typing_trials }), encoding: "utf8", timeout: 30_000 });
    expect(checked.trim()).toBe("shape-ok");
  });

  it("rejects incompatible definitions, foreign links and known trial-boundary contradictions", () => {
    const mutations: Array<(x: typeof input) => void> = [
      x => { x.keyboard_transactions[0]!.source_work_id = "foreign"; },
      x => { x.keyboard_transactions[0]!.keyboard_schema_setting_reference = "setting:sensor-inventory"; },
      x => { x.typing_trials[0]!.trial_pause_setting_reference = "setting:partition"; },
      x => { x.typing_trials[0]!.keyboard_transaction_references.push("figure-4b-deletion"); },
      x => { x.keyboard_transactions[0]!.device_id = "foreign-device"; },
      x => { x.keyboard_transactions[1]!.before_text = ""; },
      x => { Reflect.set(x.keyboard_transactions[1]!, "app_package_name", "com.foreign.app"); },
      x => { Reflect.set(x.keyboard_transactions[0]!, "is_deleted", "1"); },
      x => { Reflect.set(x.keyboard_transactions[0]!, "screen_text", "Con"); },
      x => { x.typing_trials[0]!.keyboard_transaction_references = []; },
      x => { x.typing_trials.push({ ...structuredClone(x.typing_trials[0]!), typing_trial_id: "other-trial" }); },
      x => {
        const definition = x.profiles[0]!.method_settings.find(setting => setting.method_setting_id === "setting:pauses")!;
        const value = JSON.parse(definition.method_value_json) as { types: Array<{ transition: string; segmentation_ms: number }> };
        value.types[1]!.transition = value.types[0]!.transition;
        definition.method_value_json = JSON.stringify(value);
      },
      x => {
        const definition = x.profiles[0]!.method_settings.find(setting => setting.method_setting_id === "setting:pauses")!;
        const value = JSON.parse(definition.method_value_json) as { types: Array<{ transition: string; segmentation_ms: number }> };
        value.types[1]!.segmentation_ms = 0;
        definition.method_value_json = JSON.stringify(value);
      },
      x => {
        const third = { ...structuredClone(x.keyboard_transactions[1]!), keyboard_transaction_id: "third-action" };
        Reflect.set(third, "app_package_name", "com.foreign.app");
        x.keyboard_transactions.push(third);
        x.typing_trials[0]!.keyboard_transaction_references.push(third.keyboard_transaction_id);
      },
    ];
    for (const mutate of mutations) { const wrong = structuredClone(input); mutate(wrong); expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(); }
    for (const channel of ["keyboard_transactions", "typing_trials"]) expect(() => parseStudyMethodProfileLibrary({ ...input, [channel]: null })).toThrow("must be an array");
  });
});

describe("supplied trial cases, independent verdicts and separately owned answers", () => {
  it("keeps token correctness and first-task answers distinct from text changes and trial ESM", async () => {
    type FollowupDefinition = {definition: {per_person_first_task?: string; participant_label_meanings_by_task: Record<string, {F: string; T: string}>}};
    const rows = structuredClone(typingCaseExample), word = rows.typing_trials[0]!.token_evaluation_cases[0]!;
    rows.typing_trials[0]!.token_evaluation_cases.push({ ...structuredClone(word), token_evaluation_case_id: "same-token-new-case" });
    const parsed = parseStudyMethodProfileLibrary(rows);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], keyboard_transactions: parsed.keyboard_transactions, typing_trials: parsed.typing_trials }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; keyboard_transactions: unknown; typing_trials: unknown };
    expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], keyboard_transactions: saved.keyboard_transactions, typing_trials: saved.typing_trials })).toEqual(parsed);
    for (const value of [undefined, null, []]) {
      const partial = structuredClone(rows);
      for (const field of ["system_verdicts", "followup_responses"]) Reflect.set(partial.typing_trials[0]!.token_evaluation_cases[0]!, field, value);
      for (const field of ["token_text", "overall_text"]) Reflect.set(partial.typing_trials[0]!.token_evaluation_cases[0]!, field, value == null ? value : "");
      expect(parseStudyMethodProfileLibrary(partial).typing_trials).toEqual(partial.typing_trials);
      Reflect.set(partial.typing_trials[0]!, "token_evaluation_cases", value);
      expect(parseStudyMethodProfileLibrary(partial).typing_trials).toEqual(partial.typing_trials);
    }
    const mutations: Array<(x: typeof rows) => void> = [
      x => { x.typing_trials[0]!.token_evaluation_cases[0]!.token_evaluation_case_id = " "; },
      x => { x.typing_trials[0]!.token_evaluation_cases.push(structuredClone(x.typing_trials[0]!.token_evaluation_cases[0]!)); },
      x => { Reflect.set(x.typing_trials[0]!.token_evaluation_cases[0]!, "removed_text", "teh"); },
      x => { Reflect.set(x.typing_trials[0]!.token_evaluation_cases[0]!, "token_text", 0); },
      x => { x.typing_trials[0]!.token_evaluation_cases[0]!.source_locators = []; },
      x => { x.typing_trials[0]!.token_evaluation_cases[0]!.system_verdicts[0]!.label_setting_reference = "setting:initial-verdict"; },
      x => { x.typing_trials[0]!.text_change_cases[0]!.system_verdicts[0]!.label_setting_reference = "setting:word-verdict"; },
      x => { x.typing_trials[0]!.token_evaluation_cases[0]!.system_verdicts[0]!.questionnaire_response_references = ["case-feedback"]; },
      x => { x.typing_trials[0]!.token_evaluation_cases[0]!.system_verdicts[0]!.questionnaire_response_references = ["trial-location"]; },
      x => { x.typing_trials[0]!.token_evaluation_cases[1]!.followup_responses[0]!.questionnaire_response_id = "sibling-answer"; x.typing_trials[0]!.token_evaluation_cases[1]!.system_verdicts[0]!.questionnaire_response_references = ["sibling-answer"]; x.typing_trials[0]!.token_evaluation_cases[0]!.system_verdicts[0]!.questionnaire_response_references = ["sibling-answer"]; },
      x => { const s = x.profiles[0]!.method_settings.find(s => s.method_setting_id === "setting:case-followup")!; const v = JSON.parse(s.method_value_json) as FollowupDefinition; delete v.definition.per_person_first_task; s.method_value_json = JSON.stringify(v); },
      x => { const s = x.profiles[0]!.method_settings.find(s => s.method_setting_id === "setting:case-followup")!; const v = JSON.parse(s.method_value_json) as FollowupDefinition; delete v.definition.participant_label_meanings_by_task["Uncorrected Error Detection Task"]; s.method_value_json = JSON.stringify(v); },
      x => { const s = x.profiles[0]!.method_settings.find(s => s.method_setting_id === "setting:case-followup")!; const v = JSON.parse(s.method_value_json) as FollowupDefinition; v.definition.participant_label_meanings_by_task["Uncorrected Error Detection Task"]!.F = "participant thinks they corrected an error"; s.method_value_json = JSON.stringify(v); },
    ];
    for (const mutate of mutations) { const invalid = structuredClone(rows); mutate(invalid); expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow(); }
    for (const value of [null, [], rows.typing_trials[0]!.token_evaluation_cases]) {
      const invalid = structuredClone(derivedTypingTrialExample); Reflect.set(invalid.typing_trials[0]!, "token_evaluation_cases", value);
      expect(() => parseStudyMethodProfileLibrary(invalid)).toThrow("derived-only trials");
    }
    expect(JSON.parse((await loadResearchMethodSelection())!)).toEqual(saved);
  });

  it("preserves repeated identities in separate owners, overlapping supports, lexical values and unknown membership without inference", async () => {
    const rows = structuredClone(typingCaseExample);
    const trial = rows.typing_trials[0]!;
    trial.text_change_cases.push({ ...structuredClone(trial.text_change_cases[0]!), text_change_case_id: "same-text-different-case" });
    const parsed = parseStudyMethodProfileLibrary(rows);
    expect(parsed.typing_trials).toEqual(rows.typing_trials);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], selectedLevels: {}, keyboard_transactions: parsed.keyboard_transactions, typing_trials: parsed.typing_trials }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; keyboard_transactions: unknown; typing_trials: unknown };
    expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], keyboard_transactions: saved.keyboard_transactions, typing_trials: saved.typing_trials })).toEqual(parsed);
    const schema = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../schema/generated/json-schema/chronicle-research-ontology.schema.json"), "utf8")) as { $defs: Record<string, unknown> };
    const variants: unknown[] = [trial];
    for (const value of [null, [], undefined]) {
      const variant = structuredClone(trial);
      for (const field of ["text_change_cases", "trial_questionnaire_responses"]) {
        if (value === undefined) Reflect.deleteProperty(variant, field); else Reflect.set(variant, field, value);
      }
      expect(parseStudyMethodProfileLibrary({ ...rows, typing_trials: [variant] }).typing_trials).toEqual([variant]);
      variants.push(variant);
      const nested = structuredClone(trial);
      for (const field of ["overall_text", "removed_text", "reentered_text"]) {
        if (value === undefined) Reflect.deleteProperty(nested.text_change_cases[0]!, field); else Reflect.set(nested.text_change_cases[0]!, field, value === null ? null : "");
      }
      for (const field of ["support_keyboard_transaction_references", "system_verdicts", "followup_responses"]) {
        if (value === undefined) Reflect.deleteProperty(nested.text_change_cases[0]!, field); else Reflect.set(nested.text_change_cases[0]!, field, value);
      }
      expect(parseStudyMethodProfileLibrary({ ...rows, typing_trials: [nested] }).typing_trials).toEqual([nested]);
      variants.push(nested);
    }
    for (const token of [null, "null", "false", "0.00", '"T"', undefined]) {
      const variant = structuredClone(trial);
      const verdict = variant.text_change_cases[0]!.system_verdicts[1]!;
      const response = variant.text_change_cases[0]!.followup_responses[0]!;
      if (token === undefined) Reflect.deleteProperty(verdict, "label_value_json"); else Reflect.set(verdict, "label_value_json", token);
      if (token === undefined) Reflect.deleteProperty(response, "response_value_json"); else Reflect.set(response, "response_value_json", token);
      expect(parseStudyMethodProfileLibrary({ ...rows, typing_trials: [variant] }).typing_trials).toEqual([variant]);
      variants.push(variant);
    }
    const checked = execFileSync(linkmlPython(), ["-c", [
      "import json,sys", "from jsonschema import Draft202012Validator", "sys.path.insert(0,sys.argv[1])",
      "from chronicle_research_ontology import TypingTrialRecord", "x=json.load(sys.stdin)",
      "v=Draft202012Validator({'$ref':'#/$defs/TypingTrialRecord','$defs':x['schema']['$defs']})",
      "for r in x['rows']:", " v.validate(r)", " assert TypingTrialRecord(**r).model_dump(exclude_unset=True)==r",
      "print('shape-ok')",
    ].join("\n"), resolve(import.meta.dirname, "../../schema/generated/pydantic")], { input: JSON.stringify({ schema, rows: variants }), encoding: "utf8", timeout: 30_000 });
    expect(checked.trim()).toBe("shape-ok");
  });

  it("rejects foreign supports, misplaced definitions, malformed children and derived-branch bypasses", () => {
    const mutations: Array<(x: typeof typingCaseExample) => void> = [
      x => { x.typing_trials[0]!.text_change_cases[0]!.text_change_case_id = " "; },
      x => { x.typing_trials[0]!.text_change_cases.push(structuredClone(x.typing_trials[0]!.text_change_cases[0]!)); },
      x => { Reflect.set(x.typing_trials[0]!.text_change_cases[0]!, "participant_id", "foreign"); },
      x => { Reflect.set(x.typing_trials[0]!.text_change_cases[0]!, "removed_text", false); },
      x => { x.typing_trials[0]!.text_change_cases[0]!.source_locators = []; },
      x => { x.typing_trials[0]!.text_change_cases[0]!.support_keyboard_transaction_references = ["unknown"]; },
      x => { x.typing_trials[0]!.text_change_cases[0]!.support_keyboard_transaction_references = ["figure-4b-deletion", "figure-4b-deletion"]; },
      x => { x.keyboard_transactions.push({ ...structuredClone(x.keyboard_transactions[0]!), keyboard_transaction_id: "standalone-same-owner" }); x.typing_trials[0]!.text_change_cases[0]!.support_keyboard_transaction_references = ["standalone-same-owner"]; },
      x => { x.typing_trials[0]!.text_change_cases[0]!.system_verdicts[1]!.questionnaire_response_references = ["trial-location"]; },
      x => { x.typing_trials[0]!.text_change_cases[0]!.system_verdicts[1]!.questionnaire_response_references = ["unknown-feedback"]; },
      x => { const sibling = structuredClone(x.typing_trials[0]!.text_change_cases[0]!); sibling.text_change_case_id = "sibling-case"; sibling.followup_responses[0]!.questionnaire_response_id = "sibling-feedback"; sibling.system_verdicts[1]!.questionnaire_response_references = ["sibling-feedback"]; x.typing_trials[0]!.text_change_cases.push(sibling); x.typing_trials[0]!.text_change_cases[0]!.system_verdicts[1]!.questionnaire_response_references = ["sibling-feedback"]; },
      x => { x.typing_trials[0]!.text_change_cases[0]!.system_verdicts[0]!.label_record_id = " "; },
      x => { x.typing_trials[0]!.text_change_cases[0]!.system_verdicts.push(structuredClone(x.typing_trials[0]!.text_change_cases[0]!.system_verdicts[0]!)); },
      x => { x.typing_trials[0]!.text_change_cases[0]!.system_verdicts[0]!.label_setting_reference = "setting:keyboard"; },
      x => { Reflect.set(x.typing_trials[0]!.text_change_cases[0]!.system_verdicts[0]!, "label_value_json", true); },
      x => { x.typing_trials[0]!.text_change_cases[0]!.followup_responses[0]!.questionnaire_response_id = " "; },
      x => { x.typing_trials[0]!.text_change_cases[0]!.followup_responses.push(structuredClone(x.typing_trials[0]!.text_change_cases[0]!.followup_responses[0]!)); },
      x => { x.typing_trials[0]!.text_change_cases[0]!.followup_responses[0]!.questionnaire_setting_reference = "setting:trial-context"; },
      x => { x.typing_trials[0]!.trial_questionnaire_responses[0]!.response_value_json = "not-json"; },
      x => { x.typing_trials[0]!.trial_questionnaire_responses[0]!.questionnaire_setting_reference = "setting:case-followup"; },
      x => { x.typing_trials[0]!.trial_questionnaire_responses.push(structuredClone(x.typing_trials[0]!.trial_questionnaire_responses[0]!)); },
      x => { const s = x.profiles[0]!.method_settings.find(s => s.method_setting_id === "setting:trial-context")!; s.method_value_json = JSON.stringify({ definition: { minimum_separation: "15 minutes" }, source_facing_role: "protocol", source_facing_target: "questionnaire" }); },
      x => { const s = x.profiles[0]!.method_settings.find(s => s.method_setting_id === "setting:initial-verdict")!; s.method_value_json = JSON.stringify({ definition: { initial_case_definition: "text change" }, source_facing_role: "analysis", source_facing_target: "token" }); },
      x => { const s = x.profiles[0]!.method_settings.find(s => s.method_setting_id === "setting:initial-verdict")!; s.method_value_json = JSON.stringify({ first_pass: "Hunspell" }); },
    ];
    for (const mutate of mutations) { const wrong = structuredClone(typingCaseExample); mutate(wrong); expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(); }
    for (const field of ["text_change_cases", "trial_questionnaire_responses"]) for (const value of [false, {}, [null]]) {
      const wrong = structuredClone(typingCaseExample); Reflect.set(wrong.typing_trials[0]!, field, value); expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow();
    }
    for (const field of ["text_change_cases", "trial_questionnaire_responses"] as const) for (const value of [null, [], typingCaseExample.typing_trials[0]![field]]) {
      const wrong = structuredClone(derivedTypingTrialExample); Reflect.set(wrong.typing_trials[0]!, field, value); expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow("derived-only trials");
    }
  });
});

describe("supplied derived-only typing trials", () => {
  it("preserves released lexical cells without inventing retained actions or CABAS boundaries", async () => {
    const parsed = parseStudyMethodProfileLibrary(derivedTypingTrialExample);
    expect(parsed.typing_trials).toEqual(derivedTypingTrialExample.typing_trials);
    expect(parsed.keyboard_transactions).toBeUndefined();
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], selectedLevels: {}, typing_trials: parsed.typing_trials }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; typing_trials: unknown };
    expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], typing_trials: saved.typing_trials })).toEqual(parsed);
    const schema = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../schema/generated/json-schema/chronicle-research-ontology.schema.json"), "utf8")) as { $defs: Record<string, unknown> };
    const result = execFileSync(linkmlPython(), ["-c", [
      "import json,sys", "from jsonschema import Draft202012Validator", "x=json.load(sys.stdin)",
      "v=Draft202012Validator({'$ref':'#/$defs/TypingTrialRecord','$defs':x['schema']['$defs']})",
      "for r in x['rows']:", " v.validate(r)",
      " for field in ('trial_lifecycle_setting_reference','trial_schema_setting_reference','released_values_json'):",
      "  assert not v.is_valid(dict(r,**{field:None}))", "  absent=dict(r);del absent[field];assert not v.is_valid(absent)",
      " for field in ('trial_partition_setting_reference','trial_app_switch_setting_reference','trial_reset_setting_reference','trial_pause_setting_reference','keyboard_transaction_references'):",
      "  assert not v.is_valid(dict(r,**{field:None}))",
      " for field in ('text_change_cases','token_evaluation_cases','trial_questionnaire_responses'):",
      "  for value in (None,[],x['new'][field]):assert not v.is_valid(dict(r,**{field:value}))",
      " legacy_fields=('trial_partition_setting_reference','trial_app_switch_setting_reference','trial_reset_setting_reference','trial_pause_setting_reference','keyboard_transaction_references')",
      " assert not v.is_valid(dict(r,**{field:x['legacy'][0][field] for field in legacy_fields}))",
      "for r in x['legacy']:", " v.validate(r)",
      " for field in ('trial_partition_setting_reference','trial_app_switch_setting_reference','trial_reset_setting_reference','trial_pause_setting_reference','keyboard_transaction_references'):",
      "  assert not v.is_valid(dict(r,**{field:None}))", "  absent=dict(r);del absent[field];assert not v.is_valid(absent)",
      " assert not v.is_valid(dict(r,keyboard_transaction_references=[]))", "print('shape-ok')",
    ].join("\n")], { input: JSON.stringify({ schema, rows: parsed.typing_trials, legacy: input.typing_trials, new: typingCaseExample.typing_trials[0] }), encoding: "utf8", timeout: 30_000 });
    expect(result.trim()).toBe("shape-ok");
    const prompted = structuredClone(derivedTypingTrialExample);
    prompted.profiles[0]!.method_settings[0]!.method_value_json = JSON.stringify({ trial: "each answer", complete_stimuli: null });
    expect(parseStudyMethodProfileLibrary(prompted).typing_trials).toEqual(prompted.typing_trials);
    const escaped = structuredClone(derivedTypingTrialExample);
    const cells = JSON.parse(escaped.typing_trials[0]!.released_values_json) as Record<string, string>;
    cells.timeSpent = ': "not a key": \\ \n';
    escaped.typing_trials[0]!.released_values_json = JSON.stringify(cells).replace('"P":', '"\\u0050":');
    expect(parseStudyMethodProfileLibrary(escaped).typing_trials).toEqual(escaped.typing_trials);
  });

  itWithPrivateCorpus("round-trips two actual repeated source tuples with distinct file/record lineage", async () => {
    const base = privateCorpusPath("ontology-sublation-20260831");
    const bytes = readFileSync(`${base}/work/new-source-audits/rodrigues-2022-text-entry.json`);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("f50cc276fe3f691a1d4268bdb08a3b3f707e558cb149ea46a1c58534fc3360b1");
    const audit = JSON.parse(bytes.toString()) as { disclosed_atoms: Array<{ key: string; value: unknown }> };
    const csvPath = `${base}/work/rodrigues-primary-http-20260927.54lzDO/dataset.csv`;
    const digest = createHash("sha256").update(readFileSync(csvPath)).digest("hex");
    expect(digest).toBe("6feea46c765aa90ad2b51b15f415b664ebec1061e4393ec61116588f87cfb968");
    // Stdlib CSV handles quoting and the pinned file's UTF-8 BOM. Cells never enter diagnostics.
    const data = JSON.parse(execFileSync("python3", ["-c", "import csv,json,sys\nwith open(sys.argv[1],newline='',encoding='utf-8-sig') as f:\n r=csv.DictReader(f); first=None; pair=[]\n for n,row in enumerate(r,1):\n  if row['Task']!='implicit':continue\n  key=tuple(row[k] for k in ('P','Task','Index'))\n  if first is None:first=key;pair.append({'ordinal':n,'cells':row})\n  elif key==first:pair.append({'ordinal':n,'cells':row});break\n if len(pair)!=2:raise ValueError('Repeated source tuple not found')\n print(json.dumps(pair))", csvPath], { encoding: "utf8", timeout: 30_000 })) as Array<{ ordinal: number; cells: Record<string, string> }>;
    const rows = structuredClone(derivedTypingTrialExample);
    for (const [id, key] of [["setting:trial-lifecycle", "trial.passive_keyboard_lifecycle"], ["setting:released-columns", "release.trial_metric_schema"]]) {
      rows.profiles[0]!.method_settings.find(s => s.method_setting_id === id)!.method_value_json = JSON.stringify({ definition: audit.disclosed_atoms.find(a => a.key === key)!.value });
    }
    rows.typing_trials = data.map(({ ordinal, cells }) => ({ ...rows.typing_trials[0]!, typing_trial_id: `sha256:${digest}:data-record:${ordinal}`, participant_id: `opaque-release-participant:${cells.P}`, record_origin: "supplied_normalized_records", released_values_json: JSON.stringify(cells), source_locators: [`sha256:${digest}:one-based-data-record-excluding-header:${ordinal}`] }));
    const parsed = parseStudyMethodProfileLibrary(rows);
    // Boolean comparisons prevent a failing check from printing participant data.
    expect(JSON.stringify(parsed.typing_trials) === JSON.stringify(rows.typing_trials)).toBe(true);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], selectedLevels: {}, typing_trials: parsed.typing_trials }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; typing_trials: unknown };
    expect(JSON.stringify(parseStudyMethodProfileLibrary({ profiles: [saved.profile], typing_trials: saved.typing_trials })) === JSON.stringify(parsed)).toBe(true);
  });

  it("rejects implicit branch switching, malformed payloads and foreign source definitions", () => {
    const mutations: Array<(x: typeof derivedTypingTrialExample) => void> = [
      x => { Reflect.deleteProperty(x.typing_trials[0]!, "trial_representation"); },
      x => { x.typing_trials[0]!.trial_representation = "unknown"; },
      x => { Reflect.set(x.typing_trials[0]!, "keyboard_transaction_references", []); },
      x => { Reflect.set(x.typing_trials[0]!, "trial_pause_setting_reference", "setting:trial-lifecycle"); },
      x => { x.typing_trials[0]!.source_work_id = "foreign"; },
      x => { x.typing_trials[0]!.trial_schema_setting_reference = "setting:trial-lifecycle"; },
      x => { x.typing_trials[0]!.typing_trial_id = x.typing_trials[1]!.typing_trial_id; },
      x => { x.typing_trials[0]!.released_values_json = "null"; },
      x => { x.typing_trials[0]!.released_values_json = "{"; },
      x => { x.typing_trials[0]!.released_values_json = "[]"; },
      x => { const cells = JSON.parse(x.typing_trials[0]!.released_values_json) as Record<string, unknown>; cells.timeSpent = 0; x.typing_trials[0]!.released_values_json = JSON.stringify(cells); },
      x => { const cells = JSON.parse(x.typing_trials[0]!.released_values_json) as Record<string, unknown>; delete cells.Task; x.typing_trials[0]!.released_values_json = JSON.stringify(cells); },
      x => { const cells = JSON.parse(x.typing_trials[0]!.released_values_json) as Record<string, unknown>; cells.invented = "0"; x.typing_trials[0]!.released_values_json = JSON.stringify(cells); },
      x => { x.typing_trials[0]!.released_values_json = '{"timeSpent":0,' + x.typing_trials[0]!.released_values_json.slice(1); },
      x => { x.typing_trials[0]!.released_values_json = '{"\\u0050":"duplicate",' + x.typing_trials[0]!.released_values_json.slice(1); },
      x => { x.profiles[0]!.method_settings[0]!.method_value_json = JSON.stringify({ start: "", end: "keyboard closure" }); },
      x => { x.profiles[0]!.method_settings[1]!.method_value_json = JSON.stringify({ columns: ["P", "P"] }); },
    ];
    for (const mutate of mutations) { const wrong = structuredClone(derivedTypingTrialExample); mutate(wrong); expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow(); }
  });
});
