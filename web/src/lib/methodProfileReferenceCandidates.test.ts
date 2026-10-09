import "fake-indexeddb/auto";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { privateCorpusPath } from "@/testSupport/privateCorpus";
import { linkmlPython } from "@/testSupport/linkmlPython";
import { loadResearchMethodSelection, saveResearchMethodSelection } from "@/lib/lastRunStore";
import { compileNativeMethodProfile, parseStudyMethodProfileLibrary, requiresConfigurationSelection } from "@/lib/methodProfiles";

const root = privateCorpusPath("ontology-sublation-20260831");
type Atom = { key: string; value: unknown; role: string; target: string; canonical_role: string; canonical_target: string; evidence: string; locator: string; unit?: string; comparator?: string; boundary?: string };
type Operation = { operation_id: string; stage: string; input: string; output: string; depends_on: string[]; atom_keys: string[]; locator: string; partial_order_qualification?: string };
type Draft = { source_work_id: string; source_method_variant: string; scope_decision: string; source_configuration_repairs: unknown[]; source_artifacts: Array<{ path: string; sha256: string }>; disclosed_atoms: Atom[]; ordered_operations: Operation[] };

for (const [file, pin, atomCount, operationCount] of [
  ["next-app-prediction.json", "fcc4dbbf0f572cd8b6318d6c85e25571eb2c507c9edec53c85846cd02c85a9de", 57, 18],
  ["moodscope-android-prototype.json", "b0ba7088491ac4cce8d12b0348ca218aaf1a57345d82c5adcb28a5632a9c70b0", 37, 9],
  ["momm2014-device-usage.json", "ee1c18c16ea5c64c82271c6dff40d847357ab029567f0bafcabbba5d4141e21f", 51, 19],
  ["kim2015-android-memory-habits.json", "f8050bdba2aac20772fd23c26b95bd4af12f9572f57c9902e3ff486ff1b1290f", 20, 7],
] as const) {
  itWithPrivateCorpus(`preserves the isolated ${file} definitions through the real parser and selection store without granting execution`, async () => {
    const bytes = readFileSync(resolve(root, "work/new-source-audits", file));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(pin);
    const draft = JSON.parse(bytes.toString()) as Draft;
    for (const artifact of draft.source_artifacts) {
      expect(createHash("sha256").update(readFileSync(resolve(root, "../..", artifact.path))).digest("hex")).toBe(artifact.sha256);
    }
    // Test-only normalized definition, not the canonical projector, campaign partition or a raw-data adapter.
    const raw = {
      method_profile_id: `isolated-definition:${draft.source_work_id}`,
      source_work_id: draft.source_work_id,
      source_method_variant_id: `isolated-definition:${pin}`,
      source_method_variant_label: draft.source_method_variant,
      method_profile_version: "isolated-definition-check-20260927",
      method_configuration_structure: "evidence_blocked",
      profile_implementation_status: "specification_only",
      source_locators: draft.source_artifacts.map((a) => `${a.path}#sha256=${a.sha256}`),
      method_settings: draft.disclosed_atoms.map((atom, index) => ({
        method_setting_id: `isolated-definition:${draft.source_work_id}:${atom.key}`,
        source_extraction_id: `isolated-draft:${pin}:${atom.key}`,
        source_work_id: draft.source_work_id,
        method_parameter_key: atom.key,
        method_setting_role: atom.canonical_role,
        method_target_layer: atom.canonical_target,
        method_value_kind: typeof atom.value === "string" ? "string" : "object",
        method_value_json: JSON.stringify(atom.value),
        ...(atom.unit ? { method_unit: atom.unit } : {}),
        ...(atom.comparator ? { method_comparator: atom.comparator } : {}),
        ...(atom.boundary ? { method_boundary_convention: atom.boundary } : {}),
        method_applicability_status: "undetermined",
        method_disclosure_status: "declared_partial",
        method_implementation_status: "specification_only",
        contract_bindings: [],
        source_locators: [atom.locator],
        evidence_layer: atom.evidence,
        method_configuration_json: JSON.stringify({
          source_role: atom.role, source_target: atom.target,
          operations: draft.ordered_operations.filter((o) => o.atom_keys.includes(atom.key)),
          ...(index === 0 ? { scope: draft.scope_decision, unadjudicated_source_groups: draft.source_configuration_repairs } : {}),
        }),
      })),
      method_operations: draft.ordered_operations.map((o) => ({
        operation_id: o.operation_id, operation_role: o.stage,
        consumes: [o.input], produces: [o.output],
        depends_on: o.depends_on, configuration_dependencies: o.atom_keys,
      })),
    };
    const input = parseStudyMethodProfileLibrary({ profiles: [raw] }).profiles[0]!;
    expect(input.method_settings).toHaveLength(atomCount);
    expect(input.method_operations).toHaveLength(operationCount);
    expect(input.method_operations).toEqual(raw.method_operations);
    await saveResearchMethodSelection(JSON.stringify({ profile: input }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
    expect(restored).toEqual(input);
    const context = JSON.parse(String(restored.method_settings[0]!.method_configuration_json)) as Record<string, unknown>;
    expect(context.scope).toBe(draft.scope_decision);
    expect(context.unadjudicated_source_groups).toEqual(draft.source_configuration_repairs);
    for (const [index, atom] of draft.disclosed_atoms.entries()) {
      const setting = restored.method_settings[index]!;
      expect(JSON.parse(String(setting.method_value_json))).toEqual(atom.value);
      expect(setting.method_setting_role).toBe(atom.canonical_role);
      expect(setting.method_target_layer).toBe(atom.canonical_target);
      expect(setting.source_locators).toEqual([atom.locator]);
      expect(setting.method_unit).toBe(atom.unit);
      expect(setting.method_comparator).toBe(atom.comparator);
      expect(setting.method_boundary_convention).toBe(atom.boundary);
      const metadata = JSON.parse(String(setting.method_configuration_json)) as Record<string, unknown>;
      expect(metadata.operations).toEqual(draft.ordered_operations.filter((o) => o.atom_keys.includes(atom.key)));
      expect(setting.contract_bindings).toEqual([]);
    }
    if (file === "moodscope-android-prototype.json") {
      const setting = (key: string) => restored.method_settings.find((s) => s.method_parameter_key === key)!;
      expect([setting("android.full_log_upload").method_setting_role, setting("android.full_log_upload").method_target_layer]).toEqual(["acquisition", "raw_record"]);
      expect([setting("android.model_download").method_setting_role, setting("android.model_download").method_target_layer]).toEqual(["analysis", "model"]);
      expect(JSON.parse(String(setting("result.Android_stage_measurements").method_value_json))).toMatchObject({
        logging_processing_power: { comparator: "<", value: 400, unit: "mW" },
        battery_capacity_fraction: { comparator: "<", value: 0.5, unit: "percent" },
      });
      expect(JSON.parse(String(setting("result.communication_size").method_value_json))).toMatchObject({
        uncompressed_plaintext_model_size: { comparator: "<", value: 5, unit: "KB" },
        compressed_model_size: { comparator: "<", value: 3, unit: "KB" },
      });
    }
    if (file === "momm2014-device-usage.json") {
      const setting = (key: string) => restored.method_settings.find((s) => s.method_parameter_key === key)!;
      const value = (key: string) => JSON.parse(String(setting(key).method_value_json)) as Record<string, unknown>;
      expect([setting("analysis.unlock_filter").method_setting_role, setting("analysis.unlock_filter").method_target_layer,
        setting("analysis.unlock_filter").method_comparator, setting("analysis.unlock_filter").method_unit])
        .toEqual(["quality_control", "analysis_record_set", "<", "second"]);
      expect(value("analysis.unlock_filter")).toMatchObject({ value: 10, disposition: "retain shorter unlocking sessions",
        scope: "separate authentication-duration analysis only", equality: "10 seconds not retained", not_a_device_session_gap_or_cap: true });
      expect(value("quality.minimum_days")).toMatchObject({ comparator: ">=", value: 7, at_least_one_valid_session_each_day: null });
      expect(value("schema.session_event_keys")).toMatchObject({ not_established_here: ["hf.locked", "startup", "pause"], raw_serialization: null });
      expect(value("session.call_aware_constructor").states).toEqual([
        "locked, display off", "locked, ringing", "locked, display on", "locked, active call", "unlocked", "unlocked, call",
      ]);
      const transitions = value("session.call_aware_constructor").transitions as Array<{ from: string; events: string[]; to: string; actions: string[] }>;
      expect(transitions).toHaveLength(13);
      expect(transitions.filter((t) => t.from === "locked, ringing" && t.events.includes("phone|idle")))
        .toEqual([{ from: "locked, ringing", events: ["phone|idle"], to: "locked, display off", actions: [] }]);
      expect(transitions.filter((t) => t.from === "locked, active call" && t.events.includes("phone|idle")))
        .toEqual([{ from: "locked, active call", events: ["phone|idle"], to: "locked, display on", actions: ["start authentication timer"] }]);
      expect(value("session.authentication_only_lock")).toMatchObject({ condition: "locked session length equals authentication time",
        if_equal: "discard locked session", otherwise: "end locked session" });
      expect(value("analysis.unlock_measure").figure_call_idle_start).toBe("authentication timer starts at locked active-call to phone idle");
      expect(value("session.terminal_marks")).toMatchObject({ other_state_terminal_censoring: null, inactivity_gap: null });
      expect(value("context.wifi_places")).toMatchObject({ transitive_expansion_not_stated: true, ties: null, whether_previously_assigned_AP_can_recur: null });
      expect(value("context.home_rule")).toMatchObject({ required: ["meaningful place", "not office"] });
      expect(value("quality.detected_home")).toMatchObject({ scope: "subsequent usage-session analysis" });
      expect(value("analysis.unlock_groups")).toMatchObject({ groups: ["Pattern", "Other"], Other_not_identified_as_PIN: true });
      expect(value("validation.context_accuracy")).toMatchObject({ ground_truth_available: false, current_study_accuracy: null });
      expect(value("results.interaction_context").section5_4_phone_interactions_per_day).toBe(57);
      expect(value("evidence.source_conflicts").Falaki_interaction_range).toEqual([
        { printed_range: "10-200", locator: "physical p2 section2" },
        { printed_range: "10-250", locator: "physical p10 Table1 reference2 row" },
      ]);
      const ownTable = value("results.own_study_table");
      expect(ownTable.units).toEqual({ interactions: "per day", session_length: "second", daily_usage: "minute per day" });
      expect(ownTable.smartphones).toMatchObject({ overall: { interactions: [58, 44] }, locked: { interactions: [37, 24] }, unlocked: { interactions: [25, 19] } });
      expect(ownTable.additivity_or_population_reconciliation).toBeNull();
      const comparators = value("results.comparative_table").rows as Array<{ printed_cells: string[] }>;
      expect(comparators).toHaveLength(6);
      for (const row of comparators) expect(row.printed_cells).toHaveLength(18);
      expect(comparators[0]!.printed_cells.slice(0, 2)).toEqual(["10-250", "-"]);
      const operations = new Map((restored.method_operations as Array<{ operation_id: string; depends_on: string[] }>).map((o) => [o.operation_id, o]));
      for (const id of ["scan_yield", "security_configuration", "locking_configuration", "unlock_measure"]) {
        expect(operations.get(id)!.depends_on).toEqual(["acquire_records"]);
      }
      expect(operations.get("assign_session_context")!.depends_on).toEqual(["extract_sessions"]);
      const assignmentMetadata = JSON.parse(String(setting("context.session_assignment").method_configuration_json)) as { operations: Operation[] };
      expect(assignmentMetadata.operations[0]!.partial_order_qualification).toContain("Do not encode AND dependency requiring both source branches");
      expect(value("evidence.future_multidevice_work")).toMatchObject({ not_an_attested_processing_operation: true, ownership_linkage: null });
      const canonical = JSON.parse(readFileSync(resolve(root, "adjudicated-method-profile-library.json"), "utf8")) as { profiles: Array<{ source_work_id: string }> };
      // Admission is checked independently below; this remains an isolated definition proof.
      expect(canonical.profiles.some((p) => p.source_work_id === draft.source_work_id)).toBe(true);
    }
    if (["momm2014-device-usage.json", "kim2015-android-memory-habits.json"].includes(file)) {
      // Existing generated ontology shape, not only the more permissive runtime parser.
      const schema = JSON.parse(readFileSync(resolve(import.meta.dirname,
        "../../schema/generated/json-schema/chronicle-research-ontology.schema.json"), "utf8")) as { $defs: Record<string, unknown> };
      const shapeCheck = execFileSync(linkmlPython(), ["-c", [
        "import json,sys",
        "from jsonschema import Draft202012Validator",
        "payload=json.load(sys.stdin)",
        "v=Draft202012Validator({'$ref':'#/$defs/StudyMethodProfile','$defs':payload['schema']['$defs']})",
        "v.validate(payload['profile'])",
        "bad=dict(payload['profile'],invented_call_constructor=True)",
        "assert not v.is_valid(bad)",
        "print('PASS existing generated profile shape and unknown-field rejection')",
      ].join("\n")], { input: JSON.stringify({ schema, profile: restored }), encoding: "utf8", timeout: 30_000 });
      expect(shapeCheck.trim()).toBe("PASS existing generated profile shape and unknown-field rejection");
    }
    if (file === "kim2015-android-memory-habits.json") {
      const setting = (key: string) => restored.method_settings.find((s) => s.method_parameter_key === key)!;
      const value = (key: string) => JSON.parse(String(setting(key).method_value_json)) as Record<string, unknown>;
      expect(setting("intervention.process_priority_adj").method_target_layer).toBe("device_setting_actuation");
      for (const key of ["feature.absolute_temporal_attributes", "feature.relative_temporal_attributes"]) {
        expect([setting(key).method_setting_role, setting(key).method_target_layer]).toEqual(["event_schema", "raw_record"]);
      }
      expect(value("intervention.process_priority_adj").adj_value_mapping).toBeNull();
      expect(value("code.partial_database_archiving")).toMatchObject({ SSID_is_not_asserted_app_identity: true, toptask_semantics: null });
      expect(value("result.naver_webtoon_example").longest_term_after_preceding_app).toBe("0:01:09");
      expect(value("acquisition.example_collection_horizon").duration).toBe("2 weeks");
      expect(value("validation.comparison_horizon").duration).toBe("1 month");
      const priority = (restored.method_operations as Array<{ operation_id: string; depends_on: string[] }>)
        .find((o) => o.operation_id === "apply_habit_priority_control")!;
      expect(priority.depends_on).not.toContain("displayed_conditional_database_insert");
    }
    expect(compileNativeMethodProfile(restored).ok).toBe(false);
    const invalid = structuredClone(raw);
    invalid.method_operations[0]!.configuration_dependencies = ["invented.source.parameter"];
    expect(() => parseStudyMethodProfileLibrary({ profiles: [invalid] })).toThrow("unknown configuration dependency");
    const cyclic = structuredClone(raw);
    cyclic.method_operations[0]!.depends_on = [cyclic.method_operations[0]!.operation_id];
    expect(() => parseStudyMethodProfileLibrary({ profiles: [cyclic] })).toThrow("dependency cycle");
    expect(await loadResearchMethodSelection()).toBe(JSON.stringify({ profile: input }));
  });
}

type PreparedAudit = {
  source_work_id: string;
  disclosed_atoms: Array<Atom & { projection_disposition: string; method_unit?: string; method_comparator?: string; method_boundary_convention?: string }>;
  method_operations: Array<Record<string, unknown>>;
  configuration_verdicts: Array<{ configuration_id: string; atom_keys: string[];
    configuration_kind?: string; configuration_unit_kind: string; branch_atom_keys?: string[] }>;
};

for (const [file, auditPin, assertionCount, operationCount] of [
  ["next-app-prediction.json", "6485bcff89ccead204bc458126d50e9d9027ca337f424c022e13f91b149198d3", 58, 19],
  ["moodscope-android-prototype.json", "80926e8ceae1774079c6e06f83ea0b851d896ba1772903c4f6e9159e3f0983af", 39, 9],
  ["momm2014-device-usage.json", "2247a709a16ae8c36d71f6791c1dd010a39a10cc0727a0a5d90751e5cb2181ba", 56, 19],
  ["kim2015-android-memory-habits.json", "ece3b41f30d4c9cb5dc17962bea0726ee0c9572c64b6c464fbef6c7cc67dc7cc", 20, 7],
  ["typing-context-2023.json", "3f395eceb0a300184b71f9e521a3071cbdf7f5aea0124fc0508d9946f5b37992", 37, 11],
] as const) {
  itWithPrivateCorpus(`preserves the canonically projected ${file} values, scoped campaigns and partial operations across selected-owner storage`, async () => {
    const bytes = readFileSync(resolve(root, "post-freeze-source-audits", file));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(auditPin);
    const audit = JSON.parse(bytes.toString()) as PreparedAudit;
    const parsed = parseStudyMethodProfileLibrary(JSON.parse(readFileSync(resolve(root, "adjudicated-method-profile-library.json"), "utf8")));
    const profile = parsed.profiles.find((p) => p.source_work_id === audit.source_work_id)!;
    expect(profile, "authoritative canonical projection is required; an isolated constructor is insufficient").toBeDefined();
    expect(profile.method_settings).toHaveLength(assertionCount);
    expect(profile.method_operations).toEqual(audit.method_operations);
    expect(profile.method_operations).toHaveLength(operationCount);
    const space = profile.method_configuration_space as {
      invariant_method_setting_ids: string[];
      method_configuration_groups: Array<{ method_configuration_group_kind: string; method_configuration_axis: string[];
        method_selection_semantics: string; source_locators: string[]; documentary_method_setting_ids: string[];
        method_configuration_levels: Array<{ included_method_setting_ids: string[]; branch_method_setting_ids: string[]; common_method_setting_ids: string[] }> }>;
    };
    const settings = new Map(profile.method_settings.map((s) => [s.method_parameter_key, s]));
    for (const atom of audit.disclosed_atoms) {
      if (atom.projection_disposition === "configuration_metadata") {
        const matches = space.method_configuration_groups.filter((g) => g.method_configuration_group_kind === "source_configuration_metadata"
          && g.method_configuration_axis.includes(atom.key));
        expect(matches).toHaveLength(1);
        expect(JSON.parse(matches[0]!.method_selection_semantics)).toEqual({ key: atom.key, value: atom.value });
        expect(matches[0]!.source_locators.map((l) => decodeURIComponent(l.split("#audit-locator=")[1]!))).toContain(atom.locator);
        expect(settings.has(atom.key)).toBe(false);
        continue;
      }
      const setting = settings.get(atom.key)!;
      expect(setting).toBeDefined();
      expect(JSON.parse(String(setting.method_value_json))).toEqual(atom.value);
      expect(setting.method_setting_role).toBe(atom.canonical_role);
      expect(setting.method_target_layer).toBe(atom.canonical_target);
      expect(setting.method_unit).toBe(atom.method_unit);
      expect(setting.method_comparator).toBe(atom.method_comparator);
      expect(setting.method_boundary_convention).toBe(atom.method_boundary_convention);
      expect((setting.source_locators as string[]).map((l) => decodeURIComponent(l.split("#audit-locator=")[1]!))).toContain(atom.locator);
    }
    const campaigns = space.method_configuration_groups.filter((g) => g.method_configuration_group_kind === "source_campaign_model_cell");
    const verdicts = audit.configuration_verdicts.filter((v) => v.branch_atom_keys?.length);
    expect(campaigns).toHaveLength(verdicts.length);
    for (const verdict of verdicts) {
      const matches = campaigns.filter((g) => g.method_configuration_axis.includes(verdict.configuration_id));
      expect(matches).toHaveLength(1);
      const group = matches[0]!;
      expect(requiresConfigurationSelection(group)).toBe(false);
      expect(group.method_selection_semantics).toBe("source_campaign_cell_no_user_selection");
      expect(group.method_configuration_levels).toHaveLength(1);
      const ids = verdict.branch_atom_keys!.map((k) => settings.get(k)!.method_setting_id);
      expect(group.method_configuration_levels[0]!.included_method_setting_ids).toEqual(ids);
      expect(group.method_configuration_levels[0]!.branch_method_setting_ids).toEqual(ids);
      for (const id of ids) expect(space.invariant_method_setting_ids).not.toContain(id);
    }
    expect(space.method_configuration_groups.some(requiresConfigurationSelection)).toBe(false);
    if (file === "next-app-prediction.json") {
      for (const key of ["model.ptan_structure", "model.ptan_parameters", "features.action_context_sampling"]) {
        expect(space.invariant_method_setting_ids).toContain(settings.get(key)!.method_setting_id);
      }
      const operations = new Map((profile.method_operations as Array<{ operation_id: string; depends_on: string[] }>).map((o) => [o.operation_id, o]));
      expect(operations.get("nextapp.surrogate_ptan_training")!.depends_on).toEqual(["nextapp.pseudo_history"]);
      expect(operations.get("nextapp.ptan_structure")!.depends_on).toEqual(["nextapp.event_feature_rows"]);
      expect(operations.get("nextapp.predict_cold_app")!.depends_on).toEqual(["nextapp.cold_app_prior"]);
    } else if (file === "moodscope-android-prototype.json") {
      const operations = new Map((profile.method_operations as Array<{ operation_id: string; configuration_dependencies: string[] }>).map((o) => [o.operation_id, o]));
      for (const [stage, key] of [["phone_logs", "android.logging_cadence"], ["maintain_histograms", "android.preprocessing_cadence"], ["local_inference", "android.inference_cadence"]]) {
        expect(operations.get(`moodscope.${stage}`)!.configuration_dependencies).toContain(key);
        expect(operations.get(`moodscope.${stage}`)!.configuration_dependencies).not.toContain("android.hourly_stage_cadences");
      }
    } else if (file === "momm2014-device-usage.json") {
      const value = (key: string) => (JSON.parse(String(settings.get(key)!.method_value_json)) as { definition: Record<string, unknown> }).definition;
      expect(value("session.call_aware_constructor").transitions).toHaveLength(13);
      expect(value("analysis.unlock_filter")).toMatchObject({ comparator: "<", value: 10, unit: "second", not_a_device_session_gap_or_cap: true });
      expect(value("quality.minimum_days")).toMatchObject({ comparator: ">=", value: 7, at_least_one_valid_session_each_day: null });
      expect(settings.get("validation.context_accuracy")!.method_setting_role).toBe("provenance");
      for (const key of ["validation.context_accuracy", "provenance.study_realization", "evidence.source_conflicts", "evidence.future_multidevice_work",
        ...audit.disclosed_atoms.filter(a => a.role === "reported_result").map(a => a.key)]) {
        expect(space.invariant_method_setting_ids).not.toContain(settings.get(key)!.method_setting_id);
      }
      expect(campaigns).toHaveLength(5);
      const membership = (id: string) => verdicts.find(v => v.configuration_id === `momm2014:${id}`)!.branch_atom_keys!;
      expect(membership("usage")).toContain("quality.detected_home");
      expect(membership("usage")).not.toContain("analysis.unlock_filter");
      expect(membership("unlock_duration")).toContain("analysis.unlock_filter");
      expect(membership("unlock_duration")).toContain("session.call_aware_constructor");
      for (const id of ["scan_yield", "security_configuration", "locking_configuration", "unlock_duration"]) {
        expect(membership(id)).not.toContain("quality.minimum_days");
        expect(membership(id)).not.toContain("quality.detected_home");
      }
      const operations = new Map((profile.method_operations as Array<{ operation_id: string; depends_on: string[]; data_effects: string[] }>).map(o => [o.operation_id, o]));
      for (const id of ["scan_yield", "security_configuration", "locking_configuration", "unlock_measure"]) {
        expect(operations.get(`momm2014.${id}`)!.depends_on).toEqual(["momm2014.acquire_records"]);
      }
      expect(operations.get("momm2014.assign_session_context")!.depends_on).toEqual(["momm2014.extract_sessions"]);
      expect(operations.get("momm2014.assign_session_context")!.data_effects.join(" ")).toContain("Do not encode AND dependency requiring both source branches");
    } else if (file === "typing-context-2023.json") {
      const definition = (key: string) => (JSON.parse(String(settings.get(key)!.method_value_json)) as { definition: Record<string, unknown> }).definition;
      const numeric = definition("result.context_effects").reported_numeric_results;
      const numericBytes = readFileSync(resolve(root, "work/typing-primary-http-20260927.m9gazI/typing-reported-numeric-results.json"));
      expect(createHash("sha256").update(numericBytes).digest("hex")).toBe("c29e1c494005c41a1acb0eb72dd84bef5736d607f5fd92e44c27af6841ba5e63");
      expect(numeric).toEqual(JSON.parse(numericBytes.toString()));
      const operations = new Map((profile.method_operations as Array<{ operation_id: string; configuration_dependencies: string[]; depends_on: string[]; data_effects: string[] }>).map(o => [o.operation_id, o]));
      expect(operations.get("typing.classify_initial_tokens_and_text_changes")!.configuration_dependencies).toEqual(["classification.prefeedback_edit_correction"]);
      expect(operations.get("typing.document_printed_classifier_mechanisms")!.configuration_dependencies).toEqual(["classification.lexical_resources", "classification.text_speak_transformations", "classification.typing_error_candidates", "classification.printed_edit_correction_rules"]);
      expect(operations.get("typing.document_printed_classifier_mechanisms")!.data_effects.join(" ")).toContain("initial/revised placement unbound");
      for (const key of ["result.context_effects", "result.printed_measurement_conflicts", "provenance.study_limits"]) {
        expect(space.invariant_method_setting_ids).not.toContain(settings.get(key)!.method_setting_id);
      }
      expect(settings.has("structure.source_scope_and_qualifications")).toBe(false);
      expect(verdicts[0]!.branch_atom_keys).toEqual(["analysis.context_group_recode", "analysis.context_join_and_eligibility", "analysis.metric_aggregation_tests", "analysis.app_category_followup", "analysis.language_device_followups"]);
    } else if (file === "kim2015-android-memory-habits.json") {
      const fixed = audit.configuration_verdicts.filter(v => v.configuration_kind === "fixed_source_method_unit");
      expect(fixed.map(v => v.atom_keys.length)).toEqual([6, 4]);
      const ids = (keys: string[]) => keys.map(k => settings.get(k)!.method_setting_id);
      expect([...space.invariant_method_setting_ids].sort()).toEqual(ids(fixed.flatMap(v => v.atom_keys)).sort());
      for (const verdict of fixed) {
        const group = space.method_configuration_groups.find(g => g.method_configuration_axis.includes(verdict.configuration_id))!;
        expect(group.method_configuration_group_kind).toBe("fixed_pipeline_stage_component");
        expect(group.method_configuration_levels[0]!.common_method_setting_ids).toEqual(ids(verdict.atom_keys));
        expect(group.method_configuration_levels[0]!.included_method_setting_ids).toEqual([]);
      }
      expect(verdicts.map(v => v.branch_atom_keys!.length)).toEqual([2, 2]);
      const evidence = audit.disclosed_atoms.filter(a => a.projection_disposition !== "configuration_metadata"
        && (a.role === "reported_result" || a.role === "provenance"));
      expect(evidence).toHaveLength(6);
      const evidenceGroup = space.method_configuration_groups.find(g => g.method_configuration_group_kind === "source_evidence_not_method_decision")!;
      expect([...evidenceGroup.documentary_method_setting_ids].sort()).toEqual(ids(evidence.map(a => a.key)).sort());
      for (const id of ids(evidence.map(a => a.key))) expect(space.invariant_method_setting_ids).not.toContain(id);
    }
    await saveResearchMethodSelection(JSON.stringify({ profile }));
    const restored = parseStudyMethodProfileLibrary({ profiles: [(JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown }).profile] }).profiles[0]!;
    expect(restored).toEqual(profile);
    expect((restored.method_configuration_space as typeof space).method_configuration_groups.some(requiresConfigurationSelection)).toBe(false);
    expect(compileNativeMethodProfile(restored).ok).toBe(false);
  });
}
