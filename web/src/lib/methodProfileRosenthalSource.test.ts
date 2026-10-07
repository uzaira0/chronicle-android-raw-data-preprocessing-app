import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { lazyPrivateCorpusJson, privateCorpusPath } from "@/testSupport/privateCorpus";

import { loadResearchMethodSelection, saveResearchMethodSelection } from "@/lib/lastRunStore";
import { compileNativeMethodProfile, enumerateMethodConfigurations, parseStudyMethodProfileLibrary, requiresConfigurationSelection, selectMethodConfiguration } from "@/lib/methodProfiles";
import { finesseFeatureSessionExample } from "../../e2e/fixtures/finesse-feature-session";
import { appInterruptionSessionExample } from "../../e2e/fixtures/app-interruption-session";
import { hardLockStateExample } from "../../e2e/fixtures/hard-lock-state-example";
import { admittedAndroidCalculationReceipts, expectAdmittedAndroidCalculationReceipt } from "@/testSupport/admittedAndroidCalculationReceipts";
import { literatureComponentExecutionsForSettings } from "@/lib/literatureInputAdapters";

const root = privateCorpusPath("ontology-sublation-20260831");
const sourceWork = "doi:10.1007/978-3-642-21726-5_11";
type SourceAudit = {
  disclosed_atoms: Array<{ key: string; value: unknown; canonical_role: string; canonical_target: string; locator: string; projection_disposition: string; role: string }>;
  method_operations: Array<{ operation_id: string; configuration_dependencies: string[]; depends_on: string[] }>;
};
const audit = lazyPrivateCorpusJson<SourceAudit>("ontology-sublation-20260831/post-freeze-source-audits/rosenthal-decision-theoretic-esm.json");
const profile = (workId = sourceWork) => {
  const library = JSON.parse(readFileSync(resolve(root, "adjudicated-method-profile-library.json"), "utf8")) as { profiles: Array<{ source_work_id: string }> };
  const raw = library.profiles.find((p) => p.source_work_id === workId);
  expect(raw, `reviewed definition must be canonically admitted: ${workId}`).toBeDefined();
  return parseStudyMethodProfileLibrary({ profiles: [raw] }).profiles[0]!;
};

itWithPrivateCorpus("round-trips all Rosenthal definitions, source locators, unknowns and partial order without authorizing scientific execution", async () => {
  const input = profile();
  expect(audit().disclosed_atoms).toHaveLength(76);
  expect(input.method_settings).toHaveLength(75);
  expect(input.method_operations).toEqual(audit().method_operations);
  expect(input.method_operations).toHaveLength(19);
  const space = input.method_configuration_space as {
    invariant_method_setting_ids: string[];
    method_configuration_groups: Array<{ method_configuration_axis: string[]; method_selection_semantics: string; source_locators: string[] }>;
  };
  for (const atom of audit().disclosed_atoms) {
    if (atom.projection_disposition === "configuration_metadata") {
      const group = space.method_configuration_groups.find((g) => g.method_configuration_axis.includes(atom.key))!;
      expect(JSON.parse(group.method_selection_semantics)).toEqual({ key: atom.key, value: atom.value });
      expect(group.source_locators.map((s) => decodeURIComponent(s.split("#audit-locator=")[1]!))).toContain(atom.locator);
      continue;
    }
    const members = input.method_settings.filter((s) => s.method_parameter_key === atom.key);
    expect(members).toHaveLength(1);
    const s = members[0]!;
    expect(JSON.parse(String(s.method_value_json))).toEqual(atom.value);
    expect(s.method_setting_role).toBe(atom.canonical_role);
    expect(s.method_target_layer).toBe(atom.canonical_target);
    expect((s.source_locators as string[]).map((l) => decodeURIComponent(l.split("#audit-locator=")[1]!))).toContain(atom.locator);
    expect(s.contract_bindings).toEqual([]);
    expect(s.method_implementation_status).toBe("specification_only");
    if (["reported_result", "evidence_gap"].includes(atom.role)) expect(space.invariant_method_setting_ids).not.toContain(s.method_setting_id);
  }
  expect(space.method_configuration_groups.filter(requiresConfigurationSelection)).toHaveLength(0);
  expect(enumerateMethodConfigurations(input)).toMatchObject({ ok: true, selections: [expect.anything()] });
  await saveResearchMethodSelection(JSON.stringify({ profile: input }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
  const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
  expect(restored).toEqual(input);
  expect(compileNativeMethodProfile(restored).ok).toBe(false);

  const definition = (key: string) => (JSON.parse(String(restored.method_settings.find((s) => s.method_parameter_key === key)!.method_value_json)) as { definition: Record<string, unknown> }).definition;
  expect(definition("collector.prealert_deadline")).toMatchObject({ approximate_response_budget_seconds: .5, hard_timeout_or_censor_rule: null });
  expect(restored.method_settings.find((s) => s.method_parameter_key === "collector.prealert_deadline")!.method_target_layer).toBe("device_setting_actuation");
  expect(definition("prompt.random_bernoulli")).toMatchObject({ ask_if: "p < 0.3", decision_cutoff: .3, draw_distribution: null, exact_prompt_probability: null });
  expect(definition("prompt.random_bernoulli")).not.toHaveProperty("probability");
  expect(definition("model.volume_prediction_threshold")).toMatchObject({ p5_rule: "p > 0.5 => LOUD; otherwise SILENT", p6_rule: "p < 0.5 => 0; otherwise 1", behavior_at_exactly_0_5: null });
  expect(definition("model.volume_probability_printed_equation")).toMatchObject({ exponent_sign_as_printed: "positive", sign_and_update_consistency_resolution: null });
  expect(definition("model.online_update").printed_loop_guard).toBe("sum_i Δ(w_i) > ε");
  expect(definition("survey.table2_linked_examples").rows).toHaveLength(8);
  expect((definition("survey.table2_linked_examples").rows as unknown[][]).map((row) => row[0])).toEqual(["Phone", "Phone", "Phone", "SMS", "SMS", "SMS", "Calendar", "Calendar"]);
  expect(definition("survey.partitions_optional_completion")).toMatchObject({ completion_of_all_twelve_required: false, actual_field_study_recruitment: "all twelve completed" });
  expect(definition("analysis.posthoc_asking_cost_group")).toMatchObject({ low: "participant average estimated asking cost <4 out of 7", high_comparator_and_equality_rule: null, not_prompt_eligibility_or_episode_threshold: true });
  expect(definition("diary.nightly_online_survey").study_scope).toBe("each night over all four weeks");
  expect(definition("result.accuracy_by_asking_cost")).toMatchObject({ pooled_dt_low_n: 6, pooled_dt_high_n: 4, figure3_low_cost_type_means: { phone: .99, SMS: .97, calendar: 1 }, figure3_error_bar_kind: null });
  expect(definition("analysis.survey_augmentation_counterfactual").deployed_training_arm).toBe(false);
  expect(definition("limits.preference_drift_and_controls").deployed_override_timer).toBeNull();
  const ops = new Map(audit().method_operations.map((o) => [o.operation_id, o]));
  expect(ops.get("rosenthal.select_random_prompt")!.depends_on).toEqual(["rosenthal.observe_incoming_notification"]);
  expect(ops.get("rosenthal.capture_arrival_context")!.depends_on).not.toContain("rosenthal.sample_motion_gated_gps");
  expect(ops.get("rosenthal.collect_training_preference")!.depends_on).toEqual(["rosenthal.capture_arrival_context"]);
  expect(ops.get("rosenthal.actuate_notification_volume")!.depends_on).toEqual(["rosenthal.enable_testing_mode", "rosenthal.evaluate_current_volume_model"]);
  expect(ops.get("rosenthal.collect_nightly_outcomes")!.depends_on).toEqual(["rosenthal.configure_assigned_app"]);
  for (const op of audit().method_operations) expect(op.configuration_dependencies.some((k) => k.startsWith("result."))).toBe(false);
});

itWithPrivateCorpus("rejects invented Rosenthal dependencies and static feedback cycles", () => {
  const input = profile();
  const missing = structuredClone(input);
  Reflect.set((missing.method_operations as Record<string, unknown>[])[0]!, "configuration_dependencies", ["invented.parameter"]);
  expect(() => parseStudyMethodProfileLibrary({ profiles: [missing] })).toThrow();
  const cyclic = structuredClone(input);
  const first = (cyclic.method_operations as Record<string, unknown>[])[0]!;
  Reflect.set(first, "depends_on", [first.operation_id]);
  expect(() => parseStudyMethodProfileLibrary({ profiles: [cyclic] })).toThrow();
});

itWithPrivateCorpus("round-trips supplied joint states and distinct bout/cost endpoints without reconstructing or executing them", async () => {
  const input = profile("usenix:soups2014:harbach-hard-lock-life");
  const example = hardLockStateExample(input.method_profile_id);
  expect(example.device_state_observations[1]!.observation_instant).toBe(example.device_state_observations[2]!.observation_instant);
  expect(example.device_state_observations[1]!.screen_state).not.toBe(example.device_state_observations[2]!.screen_state);
  expect(example.device_state_observations[2]).toMatchObject({ screen_state: "OFF", keyguard_state: "UNLOCKED" });
  expect(example.device_state_intervals[0]!.denotes_interval).toEqual(example.device_state_intervals[1]!.denotes_interval);
  expect(example.device_state_intervals[0]!.end_observation_ref).not.toBe(example.device_state_intervals[1]!.end_observation_ref);
  const persist = async (value: unknown) => {
    const library = parseStudyMethodProfileLibrary(value);
    await saveResearchMethodSelection(JSON.stringify({ profile: library.profiles[0],
      device_state_observations: library.device_state_observations, device_state_intervals: library.device_state_intervals }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; device_state_observations?: unknown; device_state_intervals?: unknown };
    return parseStudyMethodProfileLibrary({ profiles: [saved.profile],
      ...(saved.device_state_observations !== undefined ? { device_state_observations: saved.device_state_observations } : {}),
      ...(saved.device_state_intervals !== undefined ? { device_state_intervals: saved.device_state_intervals } : {}) });
  };
  const value = { profiles: [input], ...example };
  const expected = parseStudyMethodProfileLibrary(value);
  expect(expected.device_state_observations).toEqual(value.device_state_observations);
  expect(expected.device_state_intervals).toEqual(value.device_state_intervals);
  expect(await persist(value)).toEqual(expected);
  expect(parseStudyMethodProfileLibrary(JSON.parse(JSON.stringify(expected)))).toEqual(expected);
  expect(compileNativeMethodProfile(expected.profiles[0]!).ok).toBe(false);
  const partial = structuredClone(value);
  partial.device_state_observations.reverse();
  partial.device_state_intervals.reverse();
  Reflect.deleteProperty(partial.device_state_observations[0]!, "observation_instant");
  Reflect.set(partial.device_state_observations[1]!, "observation_instant", null);
  Reflect.set(partial.device_state_observations[2]!, "screen_state", null);
  Reflect.deleteProperty(partial.device_state_observations[2]!, "keyguard_state");
  Reflect.set(partial.device_state_intervals[0]!, "start_observation_ref", null);
  Reflect.deleteProperty(partial.device_state_intervals[1]!, "end_observation_ref");
  Reflect.set(partial.device_state_intervals[1]!.denotes_interval, "start_instant", null);
  Reflect.deleteProperty(partial.device_state_intervals[1]!.denotes_interval, "end_instant");
  Reflect.set(partial.device_state_intervals[1]!.denotes_interval, "start_status", null);
  Reflect.set(partial.device_state_intervals[1]!.denotes_interval, "end_status", null);
  for (const row of [...partial.device_state_observations, ...partial.device_state_intervals]) row.record_origin = "supplied_normalized_records";
  expect(await persist(partial)).toEqual(parseStudyMethodProfileLibrary(partial));
  expect((await persist(partial)).device_state_observations).toEqual(partial.device_state_observations);
  expect((await persist(partial)).device_state_intervals).toEqual(partial.device_state_intervals);
  for (const mutate of [
    (x: typeof value) => Reflect.set(x, "device_state_observations", {}),
    (x: typeof value) => Reflect.set(x.device_state_observations, 0, null),
    (x: typeof value) => Reflect.set(x.device_state_observations[0]!, "observation_instant", false),
    (x: typeof value) => Reflect.set(x, "device_state_intervals", {}),
    (x: typeof value) => Reflect.set(x.device_state_intervals, 0, null),
    (x: typeof value) => Reflect.set(x.device_state_intervals[0]!, "start_observation_ref", false),
    (x: typeof value) => { x.device_state_observations[0]!.source_work_id = "foreign"; },
    (x: typeof value) => { x.device_state_observations[0]!.method_profile_id = "foreign"; },
    (x: typeof value) => { x.device_state_observations[0]!.participant_id = "foreign"; },
    (x: typeof value) => { x.device_state_observations[0]!.device_id = "foreign"; },
    (x: typeof value) => Reflect.deleteProperty(x.device_state_intervals[0]!, "device_id"),
    (x: typeof value) => { x.device_state_intervals[0]!.end_observation_ref = "missing"; },
    (x: typeof value) => { x.device_state_intervals[0]!.end_observation_ref = "on-unlocked"; },
    (x: typeof value) => { x.device_state_intervals[1]!.end_observation_ref = "off-unlocked"; },
    (x: typeof value) => { x.device_state_intervals[1]!.method_setting_reference = x.device_state_intervals[0]!.method_setting_reference; },
    (x: typeof value) => { x.device_state_observations[0]!.method_setting_reference = x.device_state_intervals[0]!.method_setting_reference; },
    (x: typeof value) => { x.device_state_intervals[0]!.method_setting_reference = "missing"; },
    (x: typeof value) => { x.device_state_intervals[0]!.method_setting_reference = "method-setting-b1e69f7ba71ab1af4dbb14f6"; },
    (x: typeof value) => { x.device_state_intervals[1]!.method_setting_reference = "method-setting-b54f90dba8eb1c15e9d0bfc4"; },
    (x: typeof value) => { x.device_state_observations[0]!.method_setting_reference = "method-setting-cd8c5acdd62fa263e6ed2436"; },
    (x: typeof value) => { x.device_state_observations.push(structuredClone(x.device_state_observations[0]!)); },
    (x: typeof value) => { x.device_state_intervals.push(structuredClone(x.device_state_intervals[0]!)); },
    (x: typeof value) => Reflect.set(x.device_state_observations[0]!, "screen_state", 1),
    (x: typeof value) => Reflect.set(x.device_state_observations[0]!, "keyguard_state", "OFF"),
    (x: typeof value) => Reflect.set(x.device_state_intervals[0]!, "interval_kind", "authentication_duration"),
    (x: typeof value) => Reflect.set(x.device_state_intervals[0]!.denotes_interval, "duration_seconds", "1"),
    (x: typeof value) => Reflect.set(x.device_state_intervals[0]!.denotes_interval, "start_status", "invented"),
    (x: typeof value) => Reflect.set(x.device_state_observations[0]!, "observed_real_source_row", true),
    (x: typeof value) => { x.device_state_observations[0]!.source_locators = []; },
  ]) {
    const mutant = structuredClone(value);
    mutate(mutant);
    const before = await loadResearchMethodSelection();
    await expect(persist(mutant)).rejects.toThrow();
    expect(await loadResearchMethodSelection()).toEqual(before);
  }
  expect(await persist({ profiles: [input], device_state_observations: [], device_state_intervals: [] }))
    .toEqual(parseStudyMethodProfileLibrary({ profiles: [input], device_state_observations: [], device_state_intervals: [] }));
  expect(await persist({ profiles: [input] })).not.toHaveProperty("device_state_observations");
  expect(await persist({ profiles: [input] })).not.toHaveProperty("device_state_intervals");
});

itWithPrivateCorpus("preserves Finesse's complete definitions and supplied occurrence selections without inventing sampling or SKIP behavior", async () => {
  const input = profile("doi:10.1145/3479600");
  const source = JSON.parse(readFileSync(resolve(root, "post-freeze-source-audits/finesse.json"), "utf8")) as SourceAudit & {
    configuration_verdicts: Array<{ configuration_id: string; branch_atom_keys?: string[] }>;
  };
  expect(source.disclosed_atoms).toHaveLength(58);
  expect(input.method_settings).toHaveLength(57);
  expect(input.method_operations).toEqual(source.method_operations);
  expect(input.method_operations).toHaveLength(28);
  const space = input.method_configuration_space as {
    invariant_method_setting_ids: string[];
    method_configuration_groups: Array<{ method_configuration_axis: string[]; method_selection_semantics: string; source_locators: string[]; method_configuration_group_kind: string; method_configuration_levels: Array<{ branch_method_setting_ids: string[] }> }>;
  };
  for (const atom of source.disclosed_atoms) {
    if (atom.projection_disposition === "configuration_metadata") {
      const group = space.method_configuration_groups.find((g) => g.method_configuration_axis.includes(atom.key))!;
      expect(JSON.parse(group.method_selection_semantics)).toEqual({ key: atom.key, value: atom.value });
      expect(group.source_locators.map((s) => decodeURIComponent(s.split("#audit-locator=")[1]!))).toContain(atom.locator);
      continue;
    }
    const settings = input.method_settings.filter((s) => s.method_parameter_key === atom.key);
    expect(settings).toHaveLength(1);
    const setting = settings[0]!;
    expect(JSON.parse(String(setting.method_value_json))).toEqual(atom.value);
    expect(setting.method_setting_role).toBe(atom.canonical_role);
    expect(setting.method_target_layer).toBe(atom.canonical_target);
    expect((setting.source_locators as string[]).map((l) => decodeURIComponent(l.split("#audit-locator=")[1]!))).toContain(atom.locator);
    expect(setting.contract_bindings).toEqual([]);
    if (admittedAndroidCalculationReceipts[setting.method_setting_id]) {
      expectAdmittedAndroidCalculationReceipt(setting);
    } else expect(setting.method_implementation_status).toBe("specification_only");
    if (["reported_result", "evidence_gap", "evidence_conflict"].includes(atom.role)) expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
  }
  expect(space.method_configuration_groups.filter(requiresConfigurationSelection)).toHaveLength(0);
  expect(space.method_configuration_groups.some((g) => g.method_configuration_axis.includes("dependent_study_analysis"))).toBe(false);
  const campaigns = space.method_configuration_groups.filter((g) => g.method_configuration_group_kind === "source_campaign_model_cell");
  expect(campaigns).toHaveLength(1);
  const analysisKeys = source.configuration_verdicts.find((v) => v.configuration_id === "finesse:analysis")!.branch_atom_keys!;
  expect(analysisKeys).toHaveLength(9);
  const analysisIds = input.method_settings.filter((s) => analysisKeys.includes(String(s.method_parameter_key))).map((s) => s.method_setting_id).sort();
  expect(campaigns[0]!.method_configuration_levels.flatMap((l) => l.branch_method_setting_ids).sort()).toEqual(analysisIds);
  expect(analysisIds).not.toContain("method-setting-116fac65a8d5052c590bd5d8");
  expect(enumerateMethodConfigurations(input)).toMatchObject({ ok: true, selections: [expect.anything()] });

  const example = finesseFeatureSessionExample();
  example.app_feature_sessions[0]!.method_profile_id = input.method_profile_id;
  const library = parseStudyMethodProfileLibrary({ profiles: [input], app_feature_sessions: example.app_feature_sessions });
  await saveResearchMethodSelection(JSON.stringify({ profile: library.profiles[0], app_feature_sessions: library.app_feature_sessions }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; app_feature_sessions: unknown };
  const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], app_feature_sessions: saved.app_feature_sessions });
  expect(restored.profiles[0]).toEqual(input);
  expect(restored.app_feature_sessions).toEqual(example.app_feature_sessions);
  expect(compileNativeMethodProfile(restored.profiles[0]!).ok).toBe(false);
  const definition = (key: string) => (JSON.parse(String(input.method_settings.find((s) => s.method_parameter_key === key)!.method_value_json)) as { definition: Record<string, unknown> }).definition;
  expect(definition("feature.taxonomy").rows).toHaveLength(43);
  expect(definition("report.table1_session_esm_counts").rows).toHaveLength(5);
  const modelGroups = definition("report.table2_feature_regret_glmm").groups as Record<string, { rows: unknown[][] }>;
  expect(Object.values(modelGroups).flatMap((group) => group.rows)).toHaveLength(40);
  expect(definition("esm.exclude_short_session")).toMatchObject({ threshold_seconds: 5, comparator: "<", scope: "ESM sampling only", collected_sessions_deleted: false });
  expect(definition("esm.timeline_view")).toMatchObject({ maximum_visible_minutes: 5, navigation: "scroll full session timeline" });
  expect(definition("esm.expiration")).toEqual({ after_minutes: 5, action: "auto-dismiss unanswered prompt" });
  expect(definition("esm.response_semantics")).toHaveProperty("skip_stored_effect", null);
  expect(definition("evidence.figure4_watch_video_sign")).toMatchObject({ Figure4a_point_side_of_zero: "positive", Table2_estimate: -.34, reconciliation: null });
  const ops = new Map(source.method_operations.map((o) => [o.operation_id, o]));
  expect(ops.get("finesse.sample_session")!.depends_on).toEqual(["finesse.completed_session"]);
  expect(ops.get("finesse.sample_session")!.depends_on).not.toContain("finesse.cloud_upload");
  expect(ops.get("finesse.feature_occurrences")!.depends_on).toEqual(["finesse.classify", "finesse.session_boundaries"]);
  expect(ops.get("finesse.ongoing_triangulation")!.depends_on).toEqual([]);
});

itWithPrivateCorpus("preserves Böhmer's distinct lab/field timers, call/action units and printed conflicts without inventing execution", async () => {
  const input = profile("doi:10.1145/2556288.2557066");
  const source = JSON.parse(readFileSync(resolve(root, "post-freeze-source-audits/boehmer-interrupted-phone-call.json"), "utf8")) as SourceAudit & {
    configuration_verdicts: Array<{ configuration_id: string; branch_atom_keys?: string[] }>;
  };
  expect(source.disclosed_atoms).toHaveLength(62);
  expect(input.method_settings).toHaveLength(61);
  expect(input.method_operations).toEqual(source.method_operations);
  expect(input.method_operations).toHaveLength(19);
  const space = input.method_configuration_space as {
    invariant_method_setting_ids: string[];
    method_configuration_groups: Array<{ method_configuration_axis: string[]; method_selection_semantics: string; source_locators: string[]; method_configuration_group_kind: string; method_configuration_levels: Array<{ branch_method_setting_ids: string[] }> }>;
  };
  for (const atom of source.disclosed_atoms) {
    if (atom.projection_disposition === "configuration_metadata") {
      const group = space.method_configuration_groups.find((g) => g.method_configuration_axis.includes(atom.key))!;
      expect(JSON.parse(group.method_selection_semantics)).toEqual({ key: atom.key, value: atom.value });
      expect(group.source_locators.map((s) => decodeURIComponent(s.split("#audit-locator=")[1]!))).toContain(atom.locator);
      continue;
    }
    const members = input.method_settings.filter((s) => s.method_parameter_key === atom.key);
    expect(members).toHaveLength(1);
    const setting = members[0]!;
    expect(JSON.parse(String(setting.method_value_json))).toEqual(atom.value);
    expect(setting.method_setting_role).toBe(atom.canonical_role);
    expect(setting.method_target_layer).toBe(atom.canonical_target);
    expect((setting.source_locators as string[]).map((l) => decodeURIComponent(l.split("#audit-locator=")[1]!))).toContain(atom.locator);
    expect(setting.contract_bindings).toEqual([]);
    if (admittedAndroidCalculationReceipts[setting.method_setting_id]) {
      expectAdmittedAndroidCalculationReceipt(setting);
    } else expect(setting.method_implementation_status).toBe("specification_only");
    if (atom.role === "reported_result" || atom.role === "evidence_gap") expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
  }
  expect(space.method_configuration_groups.filter(requiresConfigurationSelection)).toHaveLength(0);
  expect(space.method_configuration_groups.some((g) => g.method_configuration_axis.includes("dependent_study_analysis"))).toBe(false);
  const campaigns = space.method_configuration_groups.filter((g) => g.method_configuration_group_kind === "source_campaign_model_cell");
  expect(campaigns).toHaveLength(2);
  for (const verdict of source.configuration_verdicts.filter((v) => v.branch_atom_keys?.length)) {
    const group = campaigns.find((g) => g.method_configuration_axis.includes(verdict.configuration_id))!;
    expect(group).toBeDefined();
    const expectedIds = input.method_settings.filter((s) => verdict.branch_atom_keys!.includes(String(s.method_parameter_key))).map((s) => s.method_setting_id).sort();
    expect(group.method_configuration_levels.flatMap((l) => l.branch_method_setting_ids).sort()).toEqual(expectedIds);
  }
  expect(enumerateMethodConfigurations(input)).toMatchObject({ ok: true, selections: [expect.anything()] });
  await saveResearchMethodSelection(JSON.stringify({ profile: input }));
  const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
  const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
  expect(restored).toEqual(input);
  expect(restored.profile_implementation_status).toBe("blocked");
  const compiled = compileNativeMethodProfile(restored);
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) throw new Error("the admitted twenty-trial calculation must compile");
  const meanSettingId = "method-setting-d5f9e5c2bbc0fcb4c222ee38";
  expect(compiled.receipt.settingIds).toEqual([meanSettingId]);
  expect(compiled.receipt.inputBindings).toHaveLength(1);
  expect(compiled.receipt.inputBindings![0]).toMatchObject({
    settingId: meanSettingId,
    adapterId: "chronicle.twenty-trial-time-mean",
    adapterVersion: "v1",
  });
  expect(compiled.receipt.bindings).toEqual([]);
  expect(compiled.receipt.externalBindings ?? []).toEqual([]);
  expect(compiled.receipt.outputBindings ?? []).toEqual([]);
  expect(compiled.receipt.documentaryBindings).toEqual([]);
  expect(compiled.legacyBlockers).toContainEqual(expect.objectContaining({
    settingId: restored.method_profile_id, code: "profile_blocked", detail: "blocked",
  }));
  expect(literatureComponentExecutionsForSettings([meanSettingId])[0]?.fullProfileExecutionStatus).toBe("blocked");
  for (const id of campaigns.flatMap((g) => g.method_configuration_levels.flatMap((l) => l.branch_method_setting_ids))) {
    expect(compiled.receipt.settingIds).not.toContain(id);
  }
  const value = (key: string) => JSON.parse(String(restored.method_settings.find((s) => s.method_parameter_key === key)!.method_value_json)) as Record<string, unknown>;
  expect(value("lab.postpone_duration")).toMatchObject({ duration_seconds: 5, status: "fixed in lab prototype" });
  expect(value("field.postpone_timer")).toMatchObject({ default_seconds: 5, user_changeable: true, observed_setting_values: "not reported" });
  expect(value("lab.call_trigger_after_task_start")).toMatchObject({ caller_initiation_anchor: "participant starts primary task", interruption_arrival_delay_seconds: 6, initiation_to_arrival_mechanism: null });
  expect(value("lab.random_caller_hangup_window")).toMatchObject({ lower_seconds: 20, upper_seconds: 30, selection: "random time; distribution and endpoint inclusivity unreported" });
  expect(value("field.minimum_contribution")).toMatchObject({ comparator: ">", unit: "days" });
  expect(value("field.remove_first_two_days")).toHaveProperty("exclude", "first two days of data for every user");
  expect(value("field.noninterruptive_call_ui_branch")).toMatchObject({ CallHeads_widget: "not shown", display: "default phone call UI" });
  expect(value("field.postpone_action_event")).toHaveProperty("same_call_can_have_multiple_actions", true);
  expect(value("result.field_interruptive_call_count_conflict")).toMatchObject({ table_1: 28908, prose: 28906, sum_of_three_table_outcomes: 28906 });
  expect(value("result.field_table1_complete").rows).toHaveLength(11);
  expect((value("result.field_table1_complete").rows as unknown[][])[7]).toEqual(["Interruptive calls unanswered", 10476, 468, 149]);
  expect(value("lab.post_condition_questionnaire")).toMatchObject({ scale_points: 20, paper_based: true, exact_wording: null, weighting: null, composite_score: null });
  expect(value("lab.task_time_segments").TOT1).toEqual({ p5: "primary-task time before interruption", p6: "primary-task time before call acceptance" });
  expect(value("result.lab_tn_tnv_printed_conflict")).toHaveProperty("corrected_values", null);
  const ops = new Map(source.method_operations.map((o) => [o.operation_id, o]));
  expect(ops.get("boehmer.field.UI")!.depends_on).toEqual(["boehmer.field.deploy"]);
  expect(ops.get("boehmer.field.UI")!.depends_on).not.toContain("boehmer.field.enroll");
  expect(ops.get("boehmer.field.paired")!.depends_on).toEqual(["boehmer.field.latency"]);
  expect(ops.get("boehmer.field.app_rates")!.depends_on).toEqual(["boehmer.field.unlock_subset"]);
});

for (const [workId, auditFile, atomCount, operationCount, selectableCount] of [
  ["doi:10.1145/3229434.3229436", "snooze.json", 52, 27, 1],
  ["doi:10.1145/3130956", "beyond.json", 56, 33, 0],
  ["doi:10.1145/2493432.2493443", "shin-2013.json", 70, 28, 0],
  ["doi:10.1145/3714394.3754395", "pulse.json", 41, 23, 1],
  ["doi:10.3390/s24082612", "call-to-action.json", 48, 33, 0],
] as const) {
  itWithPrivateCorpus(`round-trips every ${auditFile} definition and campaign without inventing execution`, async () => {
    const input = profile(workId);
    const source = JSON.parse(readFileSync(resolve(root, "post-freeze-source-audits", auditFile), "utf8")) as SourceAudit & {
      configuration_verdicts: Array<{ configuration_id: string; configuration_unit_kind: string; atom_keys: string[]; branch_atom_keys?: string[] }>;
    };
    expect(source.disclosed_atoms).toHaveLength(atomCount);
    expect(input.method_settings).toHaveLength(atomCount - 1);
    expect(input.method_operations).toEqual(source.method_operations);
    expect(input.method_operations).toHaveLength(operationCount);
    const space = input.method_configuration_space as {
      invariant_method_setting_ids: string[];
      method_configuration_groups: Array<{ method_configuration_group_id: string; method_configuration_axis: string[]; method_selection_semantics: string; source_locators: string[]; method_configuration_group_kind: string;
        method_configuration_levels: Array<{ method_configuration_level_id: string; included_method_setting_ids: string[]; branch_method_setting_ids: string[]; documentary_method_setting_ids: string[] }> }>;
    };
    for (const atom of source.disclosed_atoms) {
      if (atom.projection_disposition === "configuration_metadata") {
        const group = space.method_configuration_groups.find((g) => g.method_configuration_axis.includes(atom.key))!;
        expect(JSON.parse(group.method_selection_semantics)).toEqual({ key: atom.key, value: atom.value });
        expect(group.source_locators.map((l) => decodeURIComponent(l.split("#audit-locator=")[1]!))).toContain(atom.locator);
        continue;
      }
      const settings = input.method_settings.filter((s) => s.method_parameter_key === atom.key);
      expect(settings).toHaveLength(1);
      const setting = settings[0]!;
      expect(JSON.parse(String(setting.method_value_json))).toEqual(atom.value);
      expect(setting.method_setting_role).toBe(atom.canonical_role);
      expect(setting.method_target_layer).toBe(atom.canonical_target);
      expect((setting.source_locators as string[]).map((l) => decodeURIComponent(l.split("#audit-locator=")[1]!))).toContain(atom.locator);
      expect(setting.contract_bindings).toEqual([]);
      if (admittedAndroidCalculationReceipts[setting.method_setting_id]) {
        expectAdmittedAndroidCalculationReceipt(setting);
      } else expect(setting.method_implementation_status).toBe("specification_only");
      if (["reported_result", "evidence_gap", "evidence_conflict"].includes(atom.role)) expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
    }
    expect(space.method_configuration_groups.filter(requiresConfigurationSelection)).toHaveLength(selectableCount);
    expect(space.method_configuration_groups.some((g) => g.method_configuration_axis.includes("dependent_study_analysis"))).toBe(false);
    const campaigns = space.method_configuration_groups.filter((g) => g.method_configuration_group_kind === "source_campaign_model_cell");
    expect(campaigns).toHaveLength(auditFile === "snooze.json" ? 2 : auditFile === "pulse.json" ? 0 : 1);
    for (const verdict of source.configuration_verdicts.filter((v) => v.configuration_unit_kind === "campaign_internal_job_model_cell")) {
      const group = campaigns.find((g) => g.method_configuration_axis.includes(verdict.configuration_id) || g.method_configuration_axis.includes("source_campaign_inventory"))!;
      const level = group.method_configuration_levels[0]!;
      const actual = [...level.included_method_setting_ids, ...level.documentary_method_setting_ids].sort();
      const expected = input.method_settings.filter((s) => verdict.atom_keys.includes(String(s.method_parameter_key))).map((s) => s.method_setting_id).sort();
      expect(actual).toEqual(expected);
      expect(level.branch_method_setting_ids).toEqual(verdict.branch_atom_keys ? level.included_method_setting_ids : []);
    }
    const enumeration = enumerateMethodConfigurations(input);
    expect(enumeration.ok).toBe(true);
    if (!enumeration.ok) throw new Error("source-declared configuration enumeration failed");
    expect(enumeration.selections).toHaveLength(selectableCount ? 2 : 1);
    for (const group of space.method_configuration_groups.filter(requiresConfigurationSelection)) {
      for (const level of group.method_configuration_levels) {
        const selectedLevels = { [group.method_configuration_group_id]: level.method_configuration_level_id };
        const selected = selectMethodConfiguration(input, selectedLevels);
        expect(selected.ok).toBe(true);
        await saveResearchMethodSelection(JSON.stringify({ profile: input, selectedLevels }));
        const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; selectedLevels: Record<string, string> };
        const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
        expect(restored).toEqual(input);
        expect(selectMethodConfiguration(restored, saved.selectedLevels)).toEqual(selected);
      }
    }
    if (auditFile === "snooze.json") {
      const campaignIds = new Set(campaigns.flatMap((g) => g.method_configuration_levels[0]!.included_method_setting_ids));
      expect(campaignIds.size).toBe(17);
      for (const id of campaignIds) {
        expect(space.invariant_method_setting_ids).not.toContain(id);
        for (const selection of enumeration.selections) expect(selection.effectiveSettingIds).not.toContain(id);
      }
      const shared = input.method_settings.filter((s) => ["analysis.notification_vs_snooze_identity", "analysis.initial_vs_repeat", "analysis.normalized_percentages", "analysis.app_categories"].includes(String(s.method_parameter_key)));
      expect(shared).toHaveLength(4);
      for (const setting of shared) {
        expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
        expect(campaigns.filter((g) => g.method_configuration_levels[0]!.included_method_setting_ids.includes(setting.method_setting_id))).toHaveLength(2);
        for (const selection of enumeration.selections) expect(selection.effectiveSettingIds).not.toContain(setting.method_setting_id);
      }
      const value = (key: string) => JSON.parse(String(input.method_settings.find((s) => s.method_parameter_key === key)!.method_value_json)) as Record<string, unknown>;
      expect(value("intervention.drawer_prompt_lifetime")).toMatchObject({ duration: 5, scope: "temporary follow-up snooze-action notification visibility after drawer dismissal", not_session_gap: true });
      expect(value("configuration.point_in_time_options")).toMatchObject({ choices_at_one_time: 8, pooled_labels_simultaneously_available: false, dynamic_selection_table: null });
      expect(value("analysis.notification_vs_snooze_identity")).toMatchObject({ identity_key: null, grouping_constructor: null });
      const ops = new Map(source.method_operations.map((o) => [o.operation_id, o]));
      expect(ops.get("snooze.notifications")!.configuration_dependencies).not.toContain("filter.ongoing_notification");
      expect(ops.get("snooze.history")!.configuration_dependencies).toContain("filter.ongoing_notification");
    } else if (auditFile === "beyond.json") {
      const value = (key: string) => (JSON.parse(String(input.method_settings.find((s) => s.method_parameter_key === key)!.method_value_json)) as { definition: Record<string, unknown> }).definition;
      expect(value("intervention.questionnaire_content_branch")).toMatchObject({ mood_completion_prerequisite_for_content_click: null, check_pass_prerequisite_for_content_click: null });
      expect(value("report.past_actions_performance")).toMatchObject({ actual_zero_conversion_participants: 80, actual_one_conversion_participants: 68, approximate_almost_never_predicted_fraction_percent: 15 });
      expect(value("report.past_actions_performance").roughly_one_third_never_or_only_once_predicted_open_claim).toMatchObject({ locator: "physical PDF p22 §8.2", quantity: "predicted openness count per participant", distinct_from_actual_conversions_and_almost_never_claim: true });
      const ops = new Map(source.method_operations.map((o) => [o.operation_id, o]));
      expect(ops.get("beyond.context_features")!.depends_on).toEqual(expect.arrayContaining(["beyond.broadcast", "beyond.duty_cycle", "beyond.unlocked_interaction"]));
      await saveResearchMethodSelection(JSON.stringify({ profile: input }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
      expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]).toEqual(input);
    } else if (auditFile === "shin-2013.json") {
      await saveResearchMethodSelection(JSON.stringify({ profile: input }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
      const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
      expect(restored).toEqual(input);
      const definition = (key: string) => (JSON.parse(String(restored.method_settings.find((s) => s.method_parameter_key === key)!.method_value_json)) as { definition: Record<string, unknown> }).definition;
      expect(definition("session.opener")).toMatchObject({ trigger: "screen turns on", literal_constant: null, lock_required: false });
      expect(definition("session.closer")).toMatchObject({ trigger: "screen turns off", app_episode_closure_claim: false });
      expect(definition("session.no_app_membership")).toMatchObject({ app_execution_not_required: true, exact_no_app_detector: null });
      expect(definition("app.use_within_session_collapse")).toMatchObject({ consecutive_only: false, app_identity_field: null });
      expect(definition("app.use_across_session_multiplicity")).toMatchObject({ daily_distinct_package_count: false, day_boundary_assignment: null });
      expect(definition("feature.sessionWithApp")).toMatchObject({ Table_1_quantity: "sessions with apps used", prose_quantity: "sessions without any events", equivalence_of_app_and_non_event_groups: null });
      expect(definition("feature.sessionTimeApp_alias_conflict")).toMatchObject({ same_quantity_or_alias_established: false, exact_final_binding: null });
      expect(definition("analysis.label_group_construction")).toMatchObject({ clustering_inputs: null, algorithm: null, numeric_score_boundary: null, one_dimensional_score_clustering_established: false, label_fit_nesting: null });
      expect(definition("feature.discretization_for_information_gain")).toMatchObject({ bins: 3, bin_edges: null, ties: null });
      expect(definition("feature.discretization_for_detection")).toMatchObject({ bins: 3, training_fold_only_fit: null, baseline_transform_binding: null });
      expect(definition("validation.per_user_folds")).toMatchObject({ folds: 48, sample_unit: "user", fold_assignments: null, group_label_fit_nesting: null });
      expect(definition("model.heavy_usage_comparator").general_features).toEqual(["activeHour", "session", "sms", "appUsed"]);
      for (const key of ["future.repeated_detection", "future.additional_features"]) {
        expect(definition(key).not_an_active_study_method).toBe(true);
        const setting = restored.method_settings.find((s) => s.method_parameter_key === key)!;
        expect(setting.method_setting_role).toBe("provenance");
        expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
        for (const selection of enumeration.selections) expect(selection.effectiveSettingIds).not.toContain(setting.method_setting_id);
      }
      expect(definition("reporting.descriptive_session_results").table2).toMatchObject({ per_cell_sample_size: null, participant_day_weighting: null });
      expect((definition("reporting.descriptive_session_results").table2 as { rows: unknown[][] }).rows).toHaveLength(21);
      expect((definition("reporting.descriptive_session_results").table2 as { rows: unknown[][] }).rows[12]).toEqual(["respTimeToEvent", 4.5, 3.5, "s"]);
      expect(definition("reporting.regression_results")).toMatchObject({ declared_remaining_features: 16, printed_table_rows: 11, selection_from_16_to_11: null, prose_table_reference: "Table 4", actual_table_label: "Table 3", locally_reproduced: false });
      expect((definition("reporting.regression_results").table3 as { rows: unknown[][] }).rows).toHaveLength(11);
      expect(definition("analysis.label_group_result").assessment_score_group_comparison).toMatchObject({ T: 5.999, df: 46, p_printed: "000", p_numeric_interpretation: null, not_phone_usage_feature_t_tests: true });
      const policies = restored.session_construction_policies as Array<{ session_construction_policy_id: string; session_input_layer: string; session_output_layer: string; method_settings: Array<{ method_parameter_key: string }> }>;
      expect(policies).toHaveLength(1);
      expect(policies[0]).toMatchObject({ session_construction_policy_id: "shin2013-screen-on-off-source-definition", session_input_layer: "raw_record", session_output_layer: "device_session" });
      expect(policies[0]!.method_settings.map((s) => s.method_parameter_key)).toEqual(["session.opener", "session.closer", "session.interval_definition", "session.no_app_membership"]);
      for (const member of policies[0]!.method_settings) expect(member).toEqual(restored.method_settings.find((s) => s.method_parameter_key === member.method_parameter_key));
      const ops = new Map(source.method_operations.map((o) => [o.operation_id, o]));
      expect(ops.get("shin.usage_summaries")!.depends_on).toContain("shin.session_app_reduction");
      expect(ops.get("shin.regression")!.depends_on).toEqual(["shin.regression_normality", "shin.regression_collinearity", "shin.assessment_sum"]);
      expect(ops.get("shin.selected_feature_cfs")!.depends_on).toEqual(["shin.detection_bins"]);
      expect(ops.get("shin.heavy_usage_job")!.depends_on).toEqual(["shin.usage_summaries", "shin.label_groups"]);
      expect(ops.get("shin.exit_interviews")!.depends_on).toEqual([]);
      expect(ops.get("shin.compare_assessment_groups")!.depends_on).toEqual(["shin.label_groups", "shin.assessment_sum"]);
      expect(ops.get("shin.report_regression")!.depends_on).toEqual(["shin.regression"]);
      const wrongPolicy = structuredClone(restored);
      Reflect.set((wrongPolicy.session_construction_policies as Array<Record<string, unknown>>)[0]!, "session_output_layer", "app_episode");
      expect(() => parseStudyMethodProfileLibrary({ profiles: [wrongPolicy] })).toThrow(/session_construction_policies/);
      for (const change of ["duplicate", "foreign", "changed"]) {
        const invalid = structuredClone(restored);
        const members = (invalid.session_construction_policies as Array<{ method_settings: Array<Record<string, unknown>> }>)[0]!.method_settings;
        if (change === "duplicate") members.push(structuredClone(members[0]!));
        else Reflect.set(members[0]!, change === "foreign" ? "method_setting_id" : "method_value_json", change === "foreign" ? "foreign.setting" : "{}" );
        expect(() => parseStudyMethodProfileLibrary({ profiles: [invalid] })).toThrow(/session_construction_policies/);
      }
      for (const change of ["unknown", "cycle"]) {
        const invalid = structuredClone(restored);
        const first = (invalid.method_operations as Array<Record<string, unknown>>)[0]!;
        Reflect.set(first, "depends_on", [change === "cycle" ? first.operation_id : "shin.unknown"]);
        expect(() => parseStudyMethodProfileLibrary({ profiles: [invalid] })).toThrow();
      }
    } else if (auditFile === "pulse.json") {
      const definition = (key: string) => (JSON.parse(String(input.method_settings.find((s) => s.method_parameter_key === key)!.method_value_json)) as { definition: Record<string, unknown> }).definition;
      expect(definition("session.end.screen_off")).toMatchObject({ comparator: ">", threshold_seconds: 30 });
      expect(definition("session.end.inactivity")).toMatchObject({ threshold_seconds: 30, comparator_at_equality: null, interaction_reset_event_set: null });
      expect(definition("session.end.composition")).toMatchObject({ logic: "OR", trigger_precedence_at_same_time: null });
      expect(definition("sampling.duration_strata")).toMatchObject({ shared_endpoint_assignment: null, role: "labeling_selection_not_session_construction" });
      expect(definition("labeling.range_selection")).toMatchObject({ gesture: "tap_first_and_last_screenshot_within_session", endpoint_inclusivity: null, overlap_or_relabel_resolution: null });
      const rangeSetting = input.method_settings.find((s) => s.method_parameter_key === "labeling.range_selection")!;
      const rangeValue = JSON.parse(String(rangeSetting.method_value_json)) as { qualifications: Record<string, unknown> };
      expect(rangeValue.qualifications).toMatchObject({
        populated_screenshot_endpoint_membership_import_proven: true,
        screenshot_identity_and_linkage: null,
        normalized_populated_import_boundary: {
          record_origin: "analyst_constructed_example",
          endpoint_inclusion_or_membership_expansion_proven: false,
          raw_serialization_or_participant_rows_recovered: false,
          session_constructor_or_label_propagation_executed: false,
        },
      });
      expect(rangeSetting.mapped_ontology_term).toEqual(["MethodSettingAssertion", "StudyMethodProfile",
        "ScreenshotSessionRecord", "SessionScreenshotRecord", "ScreenshotRangeAnnotationRecord"]);
      expect(definition("reporting.cohort_flow").reported_labeling_time_per_period).toMatchObject({ average_in_prose: 167, parenthesized_M: 111, reconciliation: null });
      expect(definition("study.orientation_protocol")).toMatchObject({ incentive_requirement_not_observed_per_participant_exclusion_or_exposure: true });
      for (const key of ["sampling.quota", "micro_esm.trigger_set", "micro_esm.prompt_spacing", "study.orientation_protocol"]) {
        const setting = input.method_settings.find((s) => s.method_parameter_key === key)!;
        expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
        for (const selection of enumeration.selections) expect(selection.effectiveSettingIds).not.toContain(setting.method_setting_id);
      }
      const policies = input.session_construction_policies as Array<{ session_construction_policy_id: string; session_input_layer: string; session_output_layer: string; method_settings: Array<{ method_parameter_key: string }> }>;
      expect(policies).toHaveLength(1);
      expect(policies[0]).toMatchObject({ session_construction_policy_id: "pulse-phone-use-session-source-definition", session_input_layer: "raw_record", session_output_layer: "device_session" });
      expect(policies[0]!.method_settings.map((s) => s.method_parameter_key)).toEqual(["session.entity", "session.end.screen_off", "session.end.inactivity", "session.end.enter_pulse", "session.end.composition"]);
      for (const member of policies[0]!.method_settings) expect(member).toEqual(input.method_settings.find((s) => s.method_parameter_key === member.method_parameter_key));
    } else {
      await saveResearchMethodSelection(JSON.stringify({ profile: input }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
      const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
      expect(restored).toEqual(input);
      const definition = (key: string) => (JSON.parse(String(restored.method_settings.find((s) => s.method_parameter_key === key)!.method_value_json)) as { definition: Record<string, unknown> }).definition;
      expect(definition("derive.idl_endpoints")).toMatchObject({ proxy_not_observed_click_dismissal_or_attention: true, removal_reason: null, matching_algorithm: null });
      expect(definition("derive.idl_precision")).toMatchObject({ unit: "seconds", output: "integer", rounding_or_truncation: null });
      expect(definition("join.battery_tolerance")).toMatchObject({ magnitude: 10, unit: "minutes", equality_at_boundary: null, notification_timestamp_used: null });
      expect(definition("analysis.nested_cohorts")).toMatchObject({ nesting: ["DS3 subset of DS2", "DS2 subset of DS1"], user_selectable: false });
      expect(definition("analysis.bfi_bins")).toMatchObject({ exact_equality_assignment: null, predictor_discretization_proven: false });
      expect(definition("analysis.hourly_z_scores")).toMatchObject({ quantities: ["mean IDL", "median IDL", "notification record count"], exact_reference_population: null, SD_convention: null });
      for (const [key, count] of [["result.Table3_descriptives", 48], ["result.Table4_app_rows", 10], ["result.Table5_regression_rows", 25], ["result.Table6_category_sex", 24]] as const) expect(definition(key).rows).toHaveLength(count);
      expect(definition("result.Table5_regression_rows")).toMatchObject({ response_unit: "minutes", internal_fitting_unit_and_seconds_to_minutes_conversion: null });
      expect(definition("evidence.printed_variants").DS2_age).toEqual({ p8_section3_3: { mean_years: 35.2, SD_years: 10.6 }, p20_discussion: { mean_years: 35.04, SD_years: 10.67 }, reconciliation: null });
      expect(definition("future.notification_recommendations").not_an_active_study_method).toBe(true);
      const future = restored.method_settings.find((s) => s.method_parameter_key === "future.notification_recommendations")!;
      expect(space.invariant_method_setting_ids).not.toContain(future.method_setting_id);
      for (const selection of enumeration.selections) expect(selection.effectiveSettingIds).not.toContain(future.method_setting_id);
    }
    for (const selection of enumeration.selections) expect(compileNativeMethodProfile(input, undefined, selection).ok).toBe(false);
  });
}

for (const [workId, auditFile, assertions, operations] of [
  ["doi:10.1145/2037373.2037402", "fischer-mobile-activity-notifications.json", 48, 19],
  ["doi:10.1007/s00779-011-0412-2", "oulasvirta-g1-habits.json", 36, 14],
  ["doi:10.1145/2556288.2556973", "didnt-you-see-my-message.json", 41, 13],
  ["doi:10.1145/2785830.2785840", "ill-be-there-for-you.json", 29, 11],
  ["doi:10.1145/2971648.2971732", "multi-device-notifications.json", 39, 15],
  ["doi:10.1145/3675094.3677547", "screentk.json", 31, 12],
  ["doi:10.1145/3473856.3473881", "why-did-you-stop.json", 58, 19],
  ["doi:10.1145/3613904.3642583", "real-world-winds.json", 89, 24],
  ["doi:10.1145/2750858.2804252", "pielot-2015-boredom.json", 133, 26],
  ["usenix:soups2014:harbach-hard-lock-life", "hard-lock-life.json", 56, 17],
  ["doi:10.1145/2371574.2371619", "alt-browser-bridging.json", 37, 11],
  ["doi:10.1109/mprv.2014.15", "poppinga-mooddiary-preprint.json", 41, 19],
  ["doi:10.1145/3613904.3642832", "s-adl.json", 52, 16],
  ["doi:10.1145/3613904.3642347", "screen-text-sensor.json", 48, 27],
  ["doi:10.1145/3447991", "habitual-smartphone-use.json", 71, 32],
  ["doi:10.1145/2493190.2493219", "oh-app.json", 42, 24],
] as const) {
  itWithPrivateCorpus(`preserves ${auditFile}'s source distinctions, evidence and nonselectable branches through actual storage`, async () => {
    const input = profile(workId);
    const source = JSON.parse(readFileSync(resolve(root, "post-freeze-source-audits", auditFile), "utf8")) as SourceAudit & {
      source_configuration_repairs: Array<{ conditional_atom_keys?: string[] }>;
      configuration_verdicts: Array<{ configuration_id: string; branch_atom_keys?: string[] }>;
    };
    expect(input.method_settings).toHaveLength(assertions);
    expect(input.method_operations).toEqual(source.method_operations);
    expect(input.method_operations).toHaveLength(operations);
    const space = input.method_configuration_space as {
      invariant_method_setting_ids: string[];
      method_configuration_groups: Array<{ method_configuration_axis: string[]; method_selection_semantics: string; source_locators: string[];
        method_configuration_group_kind: string; method_configuration_levels: Array<{ branch_method_setting_ids: string[]; included_method_setting_ids: string[] }> }>;
    };
    for (const atom of source.disclosed_atoms) {
      if (atom.projection_disposition === "configuration_metadata") {
        const group = space.method_configuration_groups.find((g) => g.method_configuration_axis.includes(atom.key))!;
        expect(JSON.parse(group.method_selection_semantics)).toEqual({ key: atom.key, value: atom.value });
        expect(group.source_locators.map((l) => decodeURIComponent(l.split("#audit-locator=")[1]!))).toContain(atom.locator);
      } else {
        const settings = input.method_settings.filter((s) => s.method_parameter_key === atom.key);
        expect(settings).toHaveLength(1);
        const setting = settings[0]!;
        expect(JSON.parse(String(setting.method_value_json))).toEqual(atom.value);
        expect(setting.method_setting_role).toBe(atom.canonical_role);
        expect(setting.method_target_layer).toBe(atom.canonical_target);
        expect((setting.source_locators as string[]).map((l) => decodeURIComponent(l.split("#audit-locator=")[1]!))).toContain(atom.locator);
        expect(setting.contract_bindings).toEqual([]);
        if (admittedAndroidCalculationReceipts[setting.method_setting_id]) {
          expectAdmittedAndroidCalculationReceipt(setting);
        } else expect(setting.method_implementation_status).toBe("specification_only");
        if (["reported_result", "evidence_gap", "evidence_conflict"].includes(atom.role)) expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
      }
    }
    expect(space.method_configuration_groups.filter(requiresConfigurationSelection)).toHaveLength(0);
    const enumeration = enumerateMethodConfigurations(input);
    expect(enumeration.ok).toBe(true);
    if (!enumeration.ok) throw new Error("fixed source configuration failed");
    expect(enumeration.selections).toHaveLength(1);
    const scopedKeys = [...source.source_configuration_repairs.flatMap((r) => r.conditional_atom_keys ?? []),
      ...source.configuration_verdicts.flatMap((v) => v.branch_atom_keys ?? [])];
    for (const setting of input.method_settings.filter((s) => scopedKeys.includes(String(s.method_parameter_key)))) {
      expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
      expect(enumeration.selections[0]!.effectiveSettingIds).not.toContain(setting.method_setting_id);
    }
    await saveResearchMethodSelection(JSON.stringify({ profile: input }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
    expect(restored).toEqual(input);
    expect(compileNativeMethodProfile(restored).ok).toBe(false);
    const definition = (key: string) => (JSON.parse(String(restored.method_settings.find((s) => s.method_parameter_key === key)!.method_value_json)) as { definition: Record<string, unknown> }).definition;
    const ops = new Map(source.method_operations.map((operation) => [operation.operation_id, operation]));
    if (auditFile === "oh-app.json") {
      expect(definition("feature.navigation_duration")).toMatchObject({ start: "navigation type opened (e.g. app drawer)", end: "app started", unit: "s", not_unlock_to_launch_session_gap_app_use_duration_or_last_touch_latency: true });
      expect(definition("analysis.origin_population")).toMatchObject({ participants: 13, missing_source_PID: "one reason for restriction", does_not_restrict_all_other_analyses: true });
      expect(definition("analysis.launcher_subtypes").participants).toBe(21);
      expect(definition("main.adaptation_period").first_two_days_deletion_or_censoring_not_disclosed).toBe(true);
      expect(definition("evidence.within_app_intention").not_a_cause_or_user_intent_label).toBe(true);
      expect(definition("result.navigation_means").by_type).toEqual({ dock: 2.24, homescreen_panels: 2.65, folders: 4.66, vertical_drawer: 5.55, horizontal_drawer: 7.21 });
      expect(ops.get("ohapp.store_and_conditionally_upload")!.depends_on).toEqual([]);
      expect(ops.get("ohapp.compare_navigation_self_reports")!.depends_on).toEqual(["ohapp.collect_self_assessment", "ohapp.summarize_navigation"]);
      expect(ops.get("ohapp.compare_arrangement_self_reports")!.depends_on).toEqual(["ohapp.collect_self_assessment", "ohapp.count_arrangement_changes"]);
      expect(ops.get("ohapp.collect_initial_demographics")!.depends_on).toEqual([]);
      for (const id of ["pilot_interview", "collect_initial_demographics", "collect_self_assessment"]) expect(ops.get(`ohapp.${id}`)).toMatchObject({ operation_role: "acquisition", epistemic_role: "observe" });
      const campaigns = space.method_configuration_groups.filter((g) => g.method_configuration_group_kind === "source_campaign_model_cell");
      for (const verdict of source.configuration_verdicts.filter((v) => v.branch_atom_keys?.length)) {
        const matches = campaigns.filter((g) => g.method_configuration_axis.includes(verdict.configuration_id));
        expect(matches).toHaveLength(1);
        const expectedIds = verdict.branch_atom_keys!.map((key) => input.method_settings.find((s) => s.method_parameter_key === key)!.method_setting_id);
        expect(matches[0]!.method_configuration_levels[0]!.included_method_setting_ids).toEqual(expectedIds);
        expect(matches[0]!.method_configuration_levels[0]!.branch_method_setting_ids).toEqual(expectedIds);
      }
      for (const setting of restored.method_settings.filter((s) => ["provenance", "reporting"].includes(String(s.method_setting_role)))) {
        expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
        expect(enumeration.selections[0]!.effectiveSettingIds).not.toContain(setting.method_setting_id);
      }
      const missing = structuredClone(restored);
      Reflect.set((missing.method_operations as Record<string, unknown>[])[0]!, "configuration_dependencies", ["invented.parameter"]);
      expect(() => parseStudyMethodProfileLibrary({ profiles: [missing] })).toThrow();
      const cyclic = structuredClone(restored);
      const first = (cyclic.method_operations as Record<string, unknown>[])[0]!;
      Reflect.set(first, "depends_on", [first.operation_id]);
      expect(() => parseStudyMethodProfileLibrary({ profiles: [cyclic] })).toThrow();
    }
    if (auditFile === "habitual-smartphone-use.json") {
      const campaigns = space.method_configuration_groups.filter((group) => group.method_configuration_group_kind === "source_campaign_model_cell");
      expect(campaigns).toHaveLength(2);
      for (const verdict of source.configuration_verdicts.filter((v) => v.branch_atom_keys?.length)) {
        const matches = campaigns.filter((group) => group.method_configuration_axis.includes(verdict.configuration_id));
        expect(matches).toHaveLength(1);
        const campaign = matches[0]!;
        expect(campaign.method_selection_semantics).toBe("source_campaign_cell_no_user_selection");
        expect(Reflect.get(campaign, "method_cross_product_policy")).toBe("single_source_campaign_no_cartesian_product");
        expect(campaign.method_configuration_levels).toHaveLength(1);
        const expectedIds = verdict.branch_atom_keys!.map((key) => restored.method_settings.find((s) => s.method_parameter_key === key)!.method_setting_id);
        expect(campaign.method_configuration_levels[0]!.included_method_setting_ids).toEqual(expectedIds);
        expect(campaign.method_configuration_levels[0]!.branch_method_setting_ids).toEqual(expectedIds);
      }
      expect(definition("historical.platform_status")).toContain("not named");
      for (const key of ["historical.screen_schema", "historical.app_schema", "historical.activity_schema", "historical.location_schema", "historical.notification_schema"]) {
        expect(restored.method_settings.find((s) => s.method_parameter_key === key)).toMatchObject({ method_setting_role: "event_schema", method_target_layer: "raw_record" });
      }
      for (const key of ["historical.session_concept", "historical.session_implementation", "historical.session_gap_policy"]) {
        expect(restored.method_settings.find((s) => s.method_parameter_key === key)!.method_target_layer).toBe("screen_bout");
      }
      expect(definition("historical.productivity_tools_cluster_exclusion").not_a_source_proven_gate_for_every_Apriori_run).toBe(true);
      expect(definition("historical.association_metric_definitions")).toMatchObject({ keep: { lift: { comparator: ">", value: 1 }, support: { comparator: ">", value: 1, unit: "percent" } }, confidence_threshold: null });
      expect(definition("historical.interview_measures").questions).toHaveLength(4);
      expect(definition("historical.result_inventory").Table5_U34).toHaveLength(10);
      expect(definition("historical.result_inventory").Table6_mean_SD).toMatchObject({ Perception: [[3.41, 1.53], [3.34, 4.59], [2.98, 1.32], [3.17, 1.33]] });
      expect(definition("socialize.analysis_window")).toMatchObject({ not_collection_censoring: true, phases: { silent_collection_days: 7, intervention_days: 14 } });
      expect(definition("socialize.reminder").disablement_not_required_successor_of_delivery).toBe(true);
      expect(definition("socialize.test")).toMatchObject({ prospective_success_selector: false, averaging_unit_zero_ties_and_multiple_testing: null });
      expect(definition("socialize.primary_results")).toMatchObject({ Figure9_printed_p: { successful_TSMH: ".00002" }, p_zero_not_inferred: true, TSC_All_and_Active_not_significant: true });
      expect(definition("socialize.category_analysis_and_results")).not.toHaveProperty("Table11");
      expect(definition("socialize.category_results").Table11).toHaveLength(3);
      expect(restored.method_settings.find((s) => s.method_parameter_key === "socialize.category_results")!.method_setting_role).toBe("reporting");
      expect(definition("socialize.feedback")).toMatchObject({ not_repeated_diary: true, one_time_after_study_closure: true });
      expect(ops.get("habitual.historical_validate_clusters")!.depends_on).toEqual(["habitual.historical_DBSCAN"]);
      expect(ops.get("habitual.historical_summarize_clusters")!.depends_on).toEqual(["habitual.historical_DBSCAN"]);
      expect(ops.get("habitual.historical_Apriori")!.depends_on).not.toContain("habitual.historical_summarize_clusters");
      expect(ops.get("habitual.socialize_disable_reminder")!.depends_on).toEqual(["habitual.socialize_author_intention"]);
      expect(ops.get("habitual.socialize_view_dashboard")!.depends_on).toEqual([]);
      expect(ops.get("habitual.socialize_final_feedback")!.depends_on).toEqual([]);
      for (const operation of source.method_operations) expect(operation.configuration_dependencies).not.toContain("socialize.category_results");
      const metadata = source.disclosed_atoms.find((a) => a.key === "source.scope_bibliography_and_campaign")!.value as { definition: { bibliography: Array<{ printed_number: number; raw_reference: string }>; artifact_footnotes: Array<{ physical_page: number }> } };
      expect(metadata.definition.bibliography.map((r) => r.printed_number)).toEqual(Array.from({ length: 85 }, (_, i) => i + 1));
      expect(metadata.definition.bibliography[84]!.raw_reference).not.toContain("Received ; revised ; accepted");
      expect(metadata.definition.artifact_footnotes.map((f) => f.physical_page)).toEqual([4, 4, 5, 11, 11, 13, 13, 19, 20]);
    }
    if (auditFile === "screen-text-sensor.json") {
      expect(definition("collector.accessibility_update_trigger")).toMatchObject({ trigger: "UI update notification", sampling_cadence: null });
      expect(definition("missingness.raw_text_only").OCR).toBe(false);
      expect(definition("missingness.hidden_text_included").visibility_filter).toBe("proposed future work, not implemented");
      expect(definition("missingness.bounding_box_not_glyph_location").bounds).toBe("text node rectangle");
      expect(definition("study.esm_schedule_and_window")).toMatchObject({ offered_location_count_including_Other: 7, offered_activity_categories: null, notification_valid_minutes: 15, illustrated_selection_not_a_study_default: true });
      expect(definition("study.esm_schedule_and_window").location_choices_Figure4).toHaveLength(7);
      expect(definition("analysis.esm_five_minute_lookback")).toMatchObject({ anchor: "receiving the questionnaire, not submitting response", lookback_minutes: 5, response_categories: 11, activity_categories_are_posthoc_not_offered_choices: true });
      expect(definition("analysis.esm_five_minute_lookback").categories_in_appendix_B).toHaveLength(11);
      expect(definition("analysis.esm_five_minute_lookback").Table5_source_checked_rows).toHaveLength(11);
      expect(definition("protocol.debrief_instruments")).toMatchObject({ repeated_diary: false, one_time_after_two_week_field_collection: true, C1_item_count: 5, C2_sensor_item_count: 12 });
      expect(restored.method_settings.find((s) => s.method_parameter_key === "protocol.debrief_instruments")).toMatchObject({ method_setting_role: "participant_schema", method_target_layer: "participant_measure" });
      expect(definition("protocol.debrief_instruments").source_checked_C1_items).toHaveLength(5);
      expect(definition("protocol.debrief_instruments").source_checked_C2_items).toHaveLength(12);
      expect(definition("protocol.debrief_instruments").source_checked_C3_items).toHaveLength(3);
      expect(definition("analysis.vader_sentiment").order).toEqual(["remove stop words from phrases", "concatenate phrases of one screen", "tokenize", "apply VADER"]);
      expect(definition("analysis.average_sentiment_classification")).toMatchObject({ not_a_declared_per_screen_class_label: true, neutral_endpoint_equality: null });
      expect(definition("analysis.connectivity_battery_binning")).toMatchObject({ figures_have_multiple_bins: true, not_three_binary_method_configurations: true, error_bars: "standard error (SE)" });
      const words = definition("reporting.top_words_table").source_checked_printed_word_count_pairs as Array<Array<[string, number]>>;
      expect(words.map((group) => group.length)).toEqual([10, 10, 10, 10]);
      expect(words[2]![1]).toEqual(["swift", 3248]);
      expect(definition("reporting.demographic_table").rows).toHaveLength(21);
      expect(definition("reporting.perception_and_sensor_tables").Table2_rows).toHaveLength(5);
      expect(definition("reporting.perception_and_sensor_tables").Table3_rows).toHaveLength(12);
      expect(definition("evidence.source_conflicts").education).toMatchObject({ reconciliation: null });
      for (const setting of restored.method_settings.filter((s) => ["provenance", "reporting"].includes(String(s.method_setting_role)))) {
        expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
        expect(enumeration.selections[0]!.effectiveSettingIds).not.toContain(setting.method_setting_id);
      }
      expect(ops.get("screen_text.extract_text_tree")!.depends_on).toEqual(["screen_text.observe_UI_updates"]);
      expect(ops.get("screen_text.observe_UI_updates")!.configuration_dependencies).not.toContain("privacy.app_allow_exclude");
      expect(ops.get("screen_text.retain_and_store_changed_snapshots")!.depends_on).toEqual(["screen_text.extract_text_tree"]);
      expect(ops.get("screen_text.analyze_top_words")!.depends_on).toEqual(["screen_text.group_app_categories"]);
      for (const [metric, producer] of [["count_density", "derive_count_and_density"], ["phrase_difference", "derive_phrase_difference"], ["sentiment", "derive_sentiment"]]) {
        expect(ops.get(`screen_text.analyze_ESM_${metric}_views`)!.depends_on).toEqual([`screen_text.${producer}`, "screen_text.collect_ESM"]);
        expect(ops.get(`screen_text.analyze_context_${metric}_views`)!.depends_on).toEqual([`screen_text.${producer}`, "screen_text.collect_auxiliary_streams"]);
      }
      expect(ops.get("screen_text.collect_debrief")!.depends_on).toEqual([]);
      expect(restored.session_construction_policies).toEqual([]);
      const metadata = source.disclosed_atoms.find((a) => a.key === "source.scope_bibliography_and_campaign")!.value as { definition: { bibliography: Array<Record<string, unknown>>; reference_feed_registration_pending: boolean } };
      expect(metadata.definition.bibliography.map((r) => r.printed_number)).toEqual(Array.from({ length: 129 }, (_, i) => i + 1));
      expect(metadata.definition.bibliography.every((r) => r.literal_printed_spacing_verified === false && r.target_review_not_promoted_by_transcription === true)).toBe(true);
      expect(metadata.definition.reference_feed_registration_pending).toBe(true);
    }
    if (auditFile === "s-adl.json") {
      const names = definition("features.fifty_seven_inventory").names as Record<string, unknown>;
      expect(["correctness_7", "completion_and_response_time_21", "transition_8", "typing_21"].map((key) => (names[key] as string[]).length)).toEqual([7, 21, 8, 21]);
      expect(names.completion_and_response_time_21).toContain("Total Phone R & R Time");
      expect(definition("features.completion_response_latency")).toMatchObject({ common_time_or_IT_unit_not_supplied: true, artifact_division_by_1000_not_study_unit_proof: true });
      expect(definition("features.typing_metric_applicability")).toMatchObject({ site_not_applicable: ["GPS", "TER", "UER"], not_applicable_is_not_zero_or_missing: true });
      expect(definition("features.task_relative_transition_excess").total_transition_excludes_unlock_attempts).toBe(true);
      expect(definition("protocol.phone_registration_chain").sequence).toHaveLength(14);
      expect(definition("protocol.other_task_chains")).toMatchObject({ excluded_table_rows: ["SMS Conversation*", "Location Search & Share*"], photo_script_retained_with_second_Camera_start_end_in_printed_chain: true });
      expect(definition("protocol.task_correctness_oracle")).toMatchObject({ correct_score: 1, partially_incorrect_score: 0, printed_table6_sum: 15, final_study_maximum: null });
      const stimulus = restored.method_settings.find((s) => s.method_parameter_key === "features.typing_task_sample_text")!;
      expect(stimulus).toMatchObject({ method_setting_role: "acquisition", method_target_layer: "collector" });
      expect(JSON.parse(String(stimulus.method_value_json))).toMatchObject({ source_facing_role: "task_input", source_facing_target: "typing_trial" });
      for (const key of ["protocol.prescreen_instruments", "protocol.followup_instruments"]) expect(restored.method_settings.find((s) => s.method_parameter_key === key)).toMatchObject({ method_setting_role: "participant_schema", method_target_layer: "participant_measure" });
      for (const id of ["prescreen", "collect_followup"]) expect(ops.get(`sadl.${id}`)).toMatchObject({ operation_role: "acquisition", epistemic_role: "observe" });
      expect(definition("reporting.model_matrices")).toMatchObject({ table5_GBM_baseline_AUC: .770, table3_4_GBM_baseline_AUC: .779, reported_feasibility_not_timeout_eligibility_or_executor_guarantee: true });
      expect(definition("reporting.model_matrices").IS_and_SMS_feasibility).toHaveLength(3);
      expect(definition("artifact.repository_version_conflict")).toMatchObject({ Version5: "sort timestamp then drop_duplicates(timestamp)", Version9: "sort timestamp without that drop_duplicates", deployed_version_unknown: true, no_default_selected: true });
      expect(definition("privacy.raw_typing_retention")).toMatchObject({ raw_typed_characters_not_stored: true, transient_logging_processing_storage_extent_and_disposal: null });
      expect(ops.get("sadl.collect_CNT")!.depends_on).toEqual(["sadl.train_and_counterbalance"]);
      expect(ops.get("sadl.collect_scripted_android_task_events")!.depends_on).toEqual(["sadl.train_and_counterbalance"]);
      expect(ops.get("sadl.measure_BAC_after_each_completed_battery")!.depends_on).toEqual(["sadl.train_and_counterbalance"]);
      expect(Reflect.get(ops.get("sadl.measure_BAC_after_each_completed_battery")!, "consumes")).toEqual(["completed CNT or S-ADL battery"]);
      expect(ops.get("sadl.evaluate_source_model_comparisons")!.depends_on).toEqual([]);
      expect(Reflect.get(ops.get("sadl.evaluate_source_model_comparisons")!, "produces")).toContain("trained outer-loop models for applicable branches");
      expect(ops.get("sadl.explain_models_with_SHAP")!.depends_on).toEqual(["sadl.evaluate_source_model_comparisons"]);
      for (const id of ["report_model_tables", "report_SHAP", "report_followup"]) expect(Reflect.get(ops.get(`sadl.${id}`)!, "epistemic_role")).toBe("present");
      expect(ops.get("sadl.collect_followup")!.depends_on).toEqual([]);
      for (const setting of restored.method_settings.filter((s) => ["provenance", "reporting"].includes(String(s.method_setting_role)))) {
        expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
        expect(enumeration.selections[0]!.effectiveSettingIds).not.toContain(setting.method_setting_id);
      }
      const metadata = source.disclosed_atoms.find((a) => a.key === "source.scope_artifacts_bibliography_and_campaign")!.value as { definition: { bibliography: Array<Record<string, unknown>>; existing_metadata_edges_already_registered: boolean; extracted_raw_occurrence_enrichment_pending: boolean } };
      expect(metadata.definition.bibliography.map((r) => r.printed_number)).toEqual(Array.from({ length: 124 }, (_, i) => i + 1));
      expect(metadata.definition.bibliography.every((r) => r.literal_printed_spacing_verified === false && r.target_review_not_promoted_by_transcription === true)).toBe(true);
      expect(metadata.definition.existing_metadata_edges_already_registered).toBe(true);
      expect(metadata.definition.extracted_raw_occurrence_enrichment_pending).toBe(true);
    }
    if (auditFile === "poppinga-mooddiary-preprint.json") {
      expect(definition("acquisition.prealert_15s_context_gathering")).toMatchObject({ duration_seconds: 15, sensor_sample_cadence: null, not_equivalent_to: "one instantaneous sensor sample at t-minus-15-seconds" });
      expect(definition("acquisition.snapshot_after_gathering").order).toEqual(["15-second context gathering", "context snapshot", "show MoodDiary notification"]);
      expect(definition("prompt.one_minute_auto_dismiss")).toMatchObject({ duration_minutes: 1, label_effect: null });
      expect(definition("quality.participant_low_use_filter")).toMatchObject({ operator: "AND", clauses: [{ comparator: "<", value: 1, unit: "day" }, { comparator: "<", value: 10, unit: "percent" }] });
      expect(definition("analysis.model_feature_and_evaluation_boundary").predictors).toHaveLength(8);
      expect(definition("analysis.model_feature_and_evaluation_boundary")).toMatchObject({ ninth_attribute: "whether inquiry answered", label_is_not_predictor: true, C45_evaluation: { cross_validation_folds: 10 }, nonselectable_comparison_campaign_not_four_app_configurations: true });
      expect(definition("analysis.model_feature_and_evaluation_boundary").compared_arms).toHaveLength(4);
      expect(definition("diary.two_five_point_dialogues").offered_scale_labels).toEqual(["Strongly Agree", "Agree", "Undecided", "Disagree", "Strongly Disagree"]);
      expect(definition("diary.supported_mood_types").offered_types).toHaveLength(6);
      expect(definition("schema.location_and_microphone_boundary").interpretation_of_location_information).toBeNull();
      expect(definition("schema.context_measure_semantics").raw_column_names_scalar_encodings_missing_values_and_proximity_boolean_polarity).toBeNull();
      expect(definition("reporting.model_results").C45).toMatchObject({ printed_correct: 5114, TP: 257, TN: 4866, accuracy_percent: 77.85 });
      expect(definition("reporting.time_distributions")).toMatchObject({ prose_rate_literals: [{ percent: .08 }, { percent: .31 }], Figure2_caption: { night_drop_percent: 8, evening_maximum_percent: "about 30" }, discrepancy_unreconciled: true });
      expect(definition("reporting.posture_results")).toMatchObject({ prose_tilt_literal: "about 60%", Figure3_pitch_endpoint_literals: [-.50, -55.93], printed_unit_anomaly_not_repaired: true });
      expect(definition("reporting.literal_C45_tree")).toMatchObject({ caption: { elements: 20, leaves: 11 }, trained_result_not_reconstruction_parameter_or_executable_classifier: true });
      expect(definition("evidence.version_and_realization_limits").final_version_comparison).toHaveProperty("status", "METHOD_LEVEL_DIFFERENCES_UNDETERMINED_FINAL_FULL_TEXT_UNAVAILABLE");
      for (const setting of restored.method_settings) {
        const value = JSON.parse(String(setting.method_value_json)) as Record<string, unknown>;
        expect(value).toMatchObject({ source_manifestation: "author_preprint", final_article_method_equivalence: "unverified" });
        if (["provenance", "reporting"].includes(String(setting.method_setting_role))) {
          expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
          expect(enumeration.selections[0]!.effectiveSettingIds).not.toContain(setting.method_setting_id);
        }
      }
      expect(ops.get("mooddiary.snapshot_context")!.depends_on).toEqual(["mooddiary.gather_prealert_context"]);
      expect(ops.get("mooddiary.show_own_prompt")!.depends_on).toEqual(["mooddiary.snapshot_context"]);
      expect(ops.get("mooddiary.log_inquiry_on_server")!.depends_on).toEqual(["mooddiary.show_own_prompt"]);
      expect(ops.get("mooddiary.remove_prompt_after_minute")!.depends_on).toEqual(["mooddiary.show_own_prompt"]);
      expect(ops.get("mooddiary.analyze_context_descriptives")!.depends_on).toEqual(["mooddiary.exclude_low_use_participants", "mooddiary.derive_provider_proxy"]);
      expect(ops.get("mooddiary.prepare_model_attributes")!.depends_on).not.toContain("mooddiary.exclude_low_use_participants");
      expect(ops.get("mooddiary.report_literal_tree")!.depends_on).toEqual(["mooddiary.evaluate_C45"]);
      const metadata = source.disclosed_atoms.find((a) => a.key === "source.manifestation_scope_and_campaign")!.value as { definition: { bibliography: Array<Record<string, unknown>>; reference_feed_registration_pending: boolean } };
      expect(metadata.definition.bibliography.map((r) => r.printed_number)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
      expect(metadata.definition.bibliography.every((r) => r.checked === false && r.followed === false && !String(r.raw_reference).includes("Short"))).toBe(true);
      expect(metadata.definition.reference_feed_registration_pending).toBe(true);
    }
    if (auditFile === "alt-browser-bridging.json") {
      expect(restored.method_settings.find((s) => s.method_parameter_key === "analysis.phone_only_focus")!.method_setting_role).toBe("analysis");
      expect(restored.method_settings.find((s) => s.method_parameter_key === "study.tablet_comparator")!.method_target_layer).toBe("collector");
      expect(definition("study.directed_task_window").duration_minutes_per_condition).toBe(5);
      expect(definition("prototype.content_shortening")).toMatchObject({ shortened_to_characters: 100, counting_representation_trimming_and_shortening_algorithm: null });
      expect(definition("study.subjective_instruments")).toMatchObject({ SUS: "questionnaire for each condition; citation4", semi_structured_interview: "Finally, a semi-structured interview was conducted", exact_SUS_timing_relative_to_each_condition_completion: null });
      expect(definition("prototype.content_creator_and_injection")).toMatchObject({ extended_implementation: "UsaProxy, named in acknowledgments", logger_emitter_transport_storage_and_deployed_version: null });
      expect(definition("result.extra_visibility_and_tablet_actions")).toMatchObject({ extra_visibility_seconds: { phone: 2.43, tablet: 2.27 }, relation_to_simple_subtraction_of_other_reported_means: null });
      expect(definition("result.extra_visibility_and_tablet_actions").printed_comparison).toContain("baseline condition");
      expect(definition("result.phone_loading_time")).toMatchObject({ mean_seconds: 4.5, tablet_mean_seconds: 1.9 });
      expect(definition("result.phone_scroll_away_time")).toMatchObject({ mean_seconds: 5.05, tablet_mean_seconds: 2.9 });
      for (const setting of restored.method_settings.filter((s) => ["prototype.supported_content", "prototype.admin_preferences", "prototype.implemented_loading_approach"].includes(String(s.method_parameter_key)) || String(s.method_parameter_key).startsWith("result.") || String(s.method_parameter_key).startsWith("future."))) {
        expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
        expect(enumeration.selections[0]!.effectiveSettingIds).not.toContain(setting.method_setting_id);
      }
      const conditional = space.method_configuration_groups.filter((g) => g.method_configuration_group_kind === "conditional_joint_protocol");
      expect(conditional).toHaveLength(1);
      expect(conditional[0]!.method_configuration_axis).toEqual(["presentation_condition"]);
      expect(conditional[0]!.method_configuration_levels[0]!.branch_method_setting_ids).toHaveLength(11);
      expect(ops.get("alt_browser.observe_loading")!.depends_on).toEqual(["alt_browser.conduct_condition_tasks"]);
      expect(ops.get("alt_browser.analyze_loading_and_SUS")!.depends_on).toEqual(["alt_browser.observe_loading", "alt_browser.observe_condition_SUS"]);
      expect(ops.get("alt_browser.conduct_final_interview")!.depends_on).toEqual(["alt_browser.observe_condition_SUS"]);
      expect(ops.get("alt_browser.summarize_space_visibility")!.depends_on).toEqual(["alt_browser.observe_scroll_away"]);
      expect(ops.get("alt_browser.summarize_time_actions")!.depends_on).toEqual(["alt_browser.observe_close_and_redisplay"]);
      const metadata = source.disclosed_atoms.find((a) => a.key === "source.campaign_and_scope")!.value as { definition: { printed_references: Array<Record<string, unknown>>; manufacturer_web_bytes_unpinned: boolean; reference_feed_registration_pending: boolean } };
      expect(metadata.definition.printed_references.map((r) => r.printed_number)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
      expect(metadata.definition.printed_references.every((r) => r.identifier_resolution === "pending" && r.target_reading === "not_asserted_by_this_transcription")).toBe(true);
      expect(metadata.definition.manufacturer_web_bytes_unpinned).toBe(true);
      expect(metadata.definition.reference_feed_registration_pending).toBe(true);
      for (const operation of source.method_operations) expect(operation.configuration_dependencies.some((key) => key.startsWith("result.") || key.startsWith("future."))).toBe(false);
    }
    if (auditFile === "hard-lock-life.json") {
      expect(definition("state.four_joint_values")).toMatchObject({ joint_states: ["OFF_UNLOCKED", "ON_UNLOCKED", "OFF_LOCKED", "ON_LOCKED"], occupied_joint_state_not_unlock_to_lock_session: true });
      expect(definition("state.figure1_seven_transitions").edges).toHaveLength(7);
      expect(definition("state.screen_toggle_independent_of_keyguard")).toMatchObject({ OFF_UNLOCKED_is_possible: true, screen_off_does_not_necessarily_mean_locked: true });
      expect(restored.method_settings.find((s) => s.method_parameter_key === "session.screen_on_to_off")!.method_target_layer).toBe("screen_bout");
      expect(definition("measure.unlock_time_worst_case")).toMatchObject({ start_state: "ON_LOCKED", end_state: "ON_UNLOCKED", includes_possible_notification_or_clock_viewing: true, not_authentication_input_time_alone: true });
      expect(definition("analysis.posthoc_heavy_group")).toMatchObject({ threshold_unlocks_per_hour: 3, comparator: ">", distinct_from_sampling_strata_9_and_4_to_8: true });
      expect(definition("esm.adaptive_rate")).toMatchObject({ target_forms_per_day: [5, 6], heavy: { probability_percent: 10 }, medium: { probability_percent: 15 }, not_guaranteed_daily_counts: true });
      for (const instrument of ["C1", "C2"]) expect(definition(`esm.${instrument}_full_instrument`).items).toHaveLength(7);
      expect(definition("result.questionnaire_volume_and_time")).toMatchObject({ figure5: { y: "Number of Completed Data Mini-Questionnaires", literal_axis_not_silently_reassigned: true }, sensitivity_majority: { not_a_filter_or_runtime_threshold: true } });
      expect(definition("evidence.printed_disagreements")).toMatchObject({ Table10: { printed_sum: 45, prose: 44, resolution: null }, lock_groups: { Table5: [35, 17], debrief: [37, 15], resolution: null }, Figure8: { AppendixD_prose_and_legend: "completed questionnaires", caption: "mini-questionnaires shown", reconciliation: null } });
      expect(definition("analysis.guessed_vs_measured_unlock_frequency").exact_underestimation_formula_and_reducer).toBeNull();
      expect(definition("analysis.sampling_time_of_day_summary")).toMatchObject({ cross_participant_counts_not_average_user_proportions: true, exact_timezone_hour_boundaries_and_bin_constructor: null, not_a_collection_schedule: true });
      const conditional = space.method_configuration_groups.filter((g) => g.method_configuration_group_kind === "conditional_joint_protocol");
      expect(conditional.map((g) => g.method_configuration_axis[0]).sort()).toEqual(["random_selected_form", "sampling_phase"]);
      for (const group of conditional) {
        expect(group.method_selection_semantics).toBe("condition_driven_joint_protocol_no_user_selection");
        expect(group.method_configuration_levels).toHaveLength(1);
        expect(group.method_configuration_levels[0]!.included_method_setting_ids).toEqual([]);
        expect(group.method_configuration_levels[0]!.branch_method_setting_ids).toHaveLength(2);
      }
      expect(ops.get("hard_lock.compare_debrief_sensitivity")!.depends_on).toEqual(["hard_lock.collect_debrief"]);
      expect(ops.get("hard_lock.compare_guessed_measured_frequency")!.depends_on).toEqual(["hard_lock.observe_recruitment_guess", "hard_lock.aggregate_counts_and_times"]);
      expect(ops.get("hard_lock.summarize_sampling_time_of_day")!.depends_on).toContain("hard_lock.collect_selected_form");
      expect(ops.get("hard_lock.aggregate_counts_and_times")!.depends_on).not.toContain("hard_lock.collect_selected_form");
      expect(ops.get("hard_lock.compare_user_lock_groups")!.depends_on).not.toContain("hard_lock.collect_debrief");
      const future = restored.method_settings.find((s) => s.method_parameter_key === "future.context_sensitive_unlocking")!;
      expect(space.invariant_method_setting_ids).not.toContain(future.method_setting_id);
      expect(enumeration.selections[0]!.effectiveSettingIds).not.toContain(future.method_setting_id);
      for (const operation of source.method_operations) expect(operation.configuration_dependencies.some((key) => key.startsWith("result.") || key.startsWith("future."))).toBe(false);
    }
    if (auditFile === "fischer-mobile-activity-notifications.json") {
      expect(definition("schedule.random_arm_spacing")).toMatchObject({ requested_random_messages_per_day: 3, minimum_spacing: "at least one hour", realized_count_guaranteed: false });
      expect(definition("schedule.history_based_balance_defer").input).toContain("previous days");
      expect(definition("schedule.notification_timeout")).toMatchObject({ duration_minutes: 30, partial_response_policy: null });
      expect(definition("design.task_duration_aim")).toMatchObject({ runtime_time_limit: null });
      const table = definition("result.table2_printed_cells").rows as Record<string, unknown[][]>;
      expect(table.random![2]).toEqual([271, 201, 54.2]);
      expect(table.SMS![1]).toEqual([134, 101, 74.5]);
      expect(definition("result.table3_lmm").rows).toHaveLength(12);
      expect(definition("evidence.behavior_and_interview_conflicts").decision_time).toMatchObject({ values_called_means: { MC: 4, PH: 3 }, resolution: null });
      expect(ops.get("fischer.recognize_sms_open")!.depends_on).not.toContain("fischer.observe_broadcasts");
      expect(ops.get("fischer.deliver_prompt")!.depends_on).toEqual(["fischer.provide_phone"]);
      expect(ops.get("fischer.expire_unanswered_prompt")!.depends_on).toEqual(["fischer.deliver_prompt"]);
      expect(space.method_configuration_groups.filter((g) => g.method_configuration_group_kind === "conditional_joint_protocol")).toHaveLength(2);
    } else if (auditFile === "oulasvirta-g1-habits.json") {
      expect(definition("collector.approx_three_second_active_cadence")).toMatchObject({ nominal_cadence_seconds: 3, qualifier: "approximately" });
      expect(definition("sirb.android_24_second_footnote")).toMatchObject({ threshold_seconds: 24, boundary_at_exactly_24_seconds: null });
      expect(definition("sirb.isolation_from_preceding_session")).toMatchObject({ minimum_separation_minutes: 10, gap_endpoint_definition: null, not_a_usage_session_constructor: true });
      expect(definition("analysis.daily_use_duration")).not.toHaveProperty("reported_smartphone_median_minutes");
      expect(definition("analysis.comparison_distribution_tests")).toMatchObject({ daily_use_duration_test: null, no_adjacent_test_label_inference: true });
      expect(definition("result.reward_use_vs_sirb")).toMatchObject({ reported_r_squared: .031, reported_p: .0397, direction: "slightly positive" });
      const policies = restored.session_construction_policies as Array<{ session_input_layer: string; session_output_layer: string; method_settings: Array<{ method_parameter_key: string }> }>;
      expect(policies).toHaveLength(1);
      expect(policies[0]).toMatchObject({ session_input_layer: "acquired_snapshot", session_output_layer: "device_session" });
      expect(policies[0]!.method_settings.map((s) => s.method_parameter_key)).toEqual(["session.device_activation_opener", "session.next_idle_or_lock_closer", "session.actions_between_open_and_close"]);
      for (const member of policies[0]!.method_settings) expect(member).toEqual(restored.method_settings.find((s) => s.method_parameter_key === member.method_parameter_key));
      expect(ops.get("oulasvirta.construct_sessions")!.depends_on).toEqual(["oulasvirta.sample_g1"]);
      expect(ops.get("oulasvirta.classify_sirb")!.depends_on).toEqual(["oulasvirta.derive_session_characteristics"]);
      expect(ops.get("oulasvirta.reward_use_association")!.depends_on).not.toContain("oulasvirta.daily_entropy");
      expect(ops.get("oulasvirta.interviews")!.depends_on).toEqual([]);
      expect(ops.get("oulasvirta.postsurvey")!.depends_on).toEqual(["oulasvirta.sample_g1"]);
      const invalid = structuredClone(restored);
      Reflect.set((invalid.session_construction_policies as Array<Record<string, unknown>>)[0]!, "session_output_layer", "app_episode");
      expect(() => parseStudyMethodProfileLibrary({ profiles: [invalid] })).toThrow(/session_construction_policies/);
    } else if (auditFile === "didnt-you-see-my-message.json") {
      expect(definition("features.location_omitted")).toMatchObject({ location_logged: false, not_merely_a_predictor_omission: true });
      expect(definition("model.train_test_split")).not.toHaveProperty("all_17_feature_accuracy_percent");
      expect(definition("result.all_17_feature_model")).toMatchObject({ all_17_feature_accuracy_percent: 68.71, high_precision_percent: 74.5 });
      expect(definition("model.asymmetric_error_penalty").applies_during).toEqual(["training", "testing"]);
      expect(definition("result.figure4_feature_ranking_performance").rows).toHaveLength(17);
      expect(definition("evidence.source_reply_claim_conflict")).toMatchObject({ reply_or_nonreply_observed: false, unresolved_measurement_claim_conflict: true });
      expect(definition("variant.whatsapp_last_seen_baseline")).toMatchObject({ threshold_minutes: null, median_population: null, same_as_main_6_15_minute_pivot: null });
      const mainPivot = restored.method_settings.find((s) => s.method_parameter_key === "label.binary_median_pivot")!;
      expect(space.invariant_method_setting_ids).not.toContain(mainPivot.method_setting_id);
      const future = restored.method_settings.find((s) => s.method_parameter_key === "design.future_service_not_deployed")!;
      expect(enumeration.selections[0]!.effectiveSettingIds).not.toContain(future.method_setting_id);
      expect(space.method_configuration_groups.filter((g) => g.method_configuration_group_kind === "source_campaign_model_cell")).toHaveLength(2);
      const split = restored.method_settings.find((s) => s.method_parameter_key === "model.train_test_split")!;
      expect(space.invariant_method_setting_ids).toContain(split.method_setting_id);
      for (const setting of restored.method_settings.filter((s) => String(s.method_parameter_key).startsWith("features.") && !["features.location_omitted"].includes(String(s.method_parameter_key)))) {
        expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
      }
      expect(ops.get("message_monitor.app_attendance")!.depends_on).not.toContain("message_monitor.drawer_attendance");
      expect(ops.get("message_monitor.derive_attendance_delay")!.depends_on).toEqual(["message_monitor.acquire_notifications"]);
    } else if (auditFile === "ill-be-there-for-you.json") {
      expect(definition("reconstruction.first_attendance_route")).toMatchObject({
        removal_includes_other_device_reading: true, every_removal_proves_other_device_reading: false,
        matching_precedence_competing_events_and_censoring: null, predecessor_bulk_all_unread_convention_transferred: false,
      });
      expect(definition("feature.sixteen_phone_context_features")).toMatchObject({
        declared_count: 16, complete16_column_inventory_and_functions: null, when_last_changed_timestamp_vs_elapsed_quantity: null,
      });
      expect(definition("result.observed_attendance_delay_distribution").rows).toEqual([
        [25, 12, "seconds"], [50, 2.08, "minutes"], [75, 12.3, "minutes"], [95, 80, "minutes"],
      ]);
      expect(definition("result.message_volume_and_app_mix").figure2_printed_rounded_percent_rows).toEqual([
        ["WhatsApp", 77], ["Telegram", 7], ["Facebook Messenger", 5], ["Text Messages / SMS", 2], ["Other", 9],
      ]);
      expect(definition("analysis.weekday_hour_comparisons")).toMatchObject({
        weekday_pairwise: "Bonferroni-corrected t-tests",
        hour_pairwise: "Bonferroni-corrected pairwise comparisons; test name not explicitly supplied in hour paragraphs",
      });
      expect(definition("analysis.predicted_state_summaries")).toMatchObject({
        directly_observed_notification_or_sleep_intervals: false,
        run_boundary_censoring_day_assignment_weighting_and_exact_grouping: null,
        alternating_predictions_may_underestimate_inattentive_duration: true,
      });
      expect(definition("evidence.awake_share_conflict")).toMatchObject({
        results_awake_share_percent: 75.8, conclusion_awake_share_percent: 73.5, resolution: null,
      });
      expect(definition("provenance.prediction_limits_and_deferral").deployed_deferral_system).toBe(false);
      expect(ops.get("dingler.summarize_predicted_states")!.depends_on).toEqual(["dingler.predict_time_grid"]);
      expect(ops.get("dingler.compare_weekdays_hours")!.depends_on).toEqual(["dingler.predict_time_grid"]);
      expect(ops.get("dingler.compare_route_latencies")!.depends_on).toEqual(["dingler.derive_attendance_delay"]);
      for (const operation of source.method_operations) {
        expect(operation.configuration_dependencies.some((key) => key.startsWith("result."))).toBe(false);
      }
    } else if (auditFile === "multi-device-notifications.json") {
      expect(definition("intervention.esm_expiry")).toMatchObject({
        unclicked_prompt_removal_minutes: 10, clicked_unfinished_or_partial_expiry: null,
        not_a_natural_notification_attendance_window: true,
      });
      expect(definition("protocol.esm_q1_location")).toMatchObject({ cardinality: "multiple", minimum_required_selections: null });
      expect(definition("protocol.esm_q2_people")).toMatchObject({ cardinality: "one", figure2_final_choice_label: ">50" });
      expect(definition("protocol.esm_q3_q4_device_ratings")).toMatchObject({
        target_devices: ["smartphone", "tablet", "PC", "smartwatch"],
        Figure2_displayed_instruction: "Please answer all the questions!", exact_storage_requiredness_and_partial_handling: null,
      });
      expect(definition("study.excluded_participants")).toMatchObject({
        recruited: 18, analyzed: 16, universal_ESM_less_than_or_equal1_gate_or_complete_device_rule_not_disclosed: true,
      });
      expect(definition("evidence.correlation_report_boundary")).toMatchObject({
        printed_criterion: "r > ±0.1", reported_phone_at_home_r: -.09, reported_phone_with11_to50_r: .10,
        filtering_or_comparator_repair: false, resolution: null,
      });
      expect((definition("result.correlations").Q2_alone as unknown[])[3]).toEqual({ mean: .26, unlabeled_companion: .15 });
      expect(definition("result.daily_device_usage").active_mean_sd_hour_minute).toEqual([
        ["1:50", "1:38"], ["0:17", "0:14"], ["0:39", "1:03"], ["4:32", "3:48"],
      ]);
      expect(definition("collector.windows_distinct").foreground_process_effect_on_idle_subtraction).toBeNull();
      expect(ops.get("multidevice.answer_ESM")!.depends_on).toEqual(["multidevice.trigger_ESM"]);
      expect(ops.get("multidevice.remove_unclicked_prompt")!.depends_on).toEqual(["multidevice.trigger_ESM"]);
      expect(ops.get("multidevice.derive_android_active")!.depends_on).toEqual(["multidevice.collect_android_events"]);
      expect(ops.get("multidevice.derive_windows_active")!.depends_on).toEqual(["multidevice.collect_windows"]);
    }
    if (auditFile === "screentk.json") {
      expect(definition("result.screen_text_record_counts")).toMatchObject({
        explicit: { records: 535, total_minutes_printed: 11, mean_records_printed: 178, mean_minutes_printed: 4 },
        implicit: { records: 499, mean_records_printed: 100, mean_minutes_printed: 11, total_minutes: null },
      });
      expect(definition("prompt.complete_figure2_contract")).toMatchObject({
        response_placeholder: "{#answer}", executed_answer_supplied: false, system_prompt_and_serialization: null,
      });
      expect(definition("prompt.emit_time_killing_ranges_and_summary")).toMatchObject({
        actual_generated_outputs_and_output_parser: null, range_boundaries_overlap_and_duration_arithmetic: null,
      });
      expect(definition("aggregation.requested_range_summaries")).toMatchObject({
        output_values_supplied: false, count_membership_overlap_censoring_and_weighting: null,
      });
      expect(definition("comparison.screenshot_every_five_seconds").screen_on_only_gate).toContain("cited KTL");
      expect(definition("input.figure_examples_and_time_representations")).toMatchObject({
        units_timezone_date_rollover_and_cross_representation_conversion: null,
        equality_of_event_and_capture_times_not_inferred: true,
        Figure1_first_explicit_example: { source_time_token: "13:47:16.454", screen_text: "Click here.||", origin: "published_figure_example_not_recovered_participant_CSV" },
      });
      expect(ops.get("screentk.requested_summaries")!.depends_on).toEqual(["screentk.requested_ranges"]);
      expect(ops.get("screentk.compare_capture")!.depends_on).toEqual(["screentk.manual_reference", "screentk.capture_text", "screentk.comparison_frames"]);
      expect(ops.get("screentk.record_phone_use")!.depends_on).not.toContain("screentk.requested_block_classification");
      for (const setting of restored.method_settings.filter((s) => String(s.method_parameter_key).startsWith("future."))) {
        expect(space.invariant_method_setting_ids).not.toContain(setting.method_setting_id);
        expect(enumeration.selections[0]!.effectiveSettingIds).not.toContain(setting.method_setting_id);
      }
    }
    if (auditFile === "why-did-you-stop.json") {
      expect(definition("notification.collector")).toMatchObject({ fields: ["app name", "priority", "sound occurred", "vibration occurred"], app_name_to_package_identity_and_storage_correspondence: null });
      expect(restored.method_settings.find((s) => s.method_parameter_key === "session.foreground_target")!.method_target_layer).toBe("app_session");
      expect(definition("interruptions.individual_event_multiplicity")).toMatchObject({ multiple_per_session: true, each_registered_separately: true, local_key_and_storage_layout: null });
      expect(definition("esm.library_and_trigger")).toMatchObject({ delay_minutes: 10, anchor: "last recorded interaction with a learning app" });
      expect(definition("esm.expiry")).toMatchObject({ discarded_object: "ESQ; storage of previously supplied partial answers unreported" });
      expect(definition("input.figure1_literal_session_subset")).toMatchObject({
        source_tokens: [["05:48:56", "SESSION_START"], ["05:48:56", "MOVEMENT", "STILL"], ["05:49:03", "INTERRUPTION_START", "APP_SWITCH"], ["05:50:43", "INTERRUPTION_END", ["Google", "Google Play Store", "Google", "Activity Recognition"]], ["05:50:43", "SESSION_END"], ["05:50:43", "ESM_SENT"]],
        local_ids_date_timezone_package_identity_and_return_or_termination_outcome: null,
      });
      expect(definition("evidence.source_conflicts")).toMatchObject({ no_silent_numeric_or_semantic_repairs: true });
      expect(definition("result.table2_cells").cells).toEqual([[0, 15, 6], [0, 18, 3], [1, 14, 5], [1, 47, 14]]);
      expect(ops.get("why_stop.logged_hypothesis_analyses")!.depends_on).toEqual(["why_stop.derive_session_measures", "why_stop.infer_automatic_type"]);
      expect(ops.get("why_stop.termination_risk_analysis")!.depends_on).toContain("why_stop.collect_optional_answers");
      expect(ops.get("why_stop.contextual_models")!.depends_on).toContain("why_stop.observe_notifications");
      expect(ops.get("why_stop.contextual_models")!.depends_on).not.toContain("why_stop.observe_movement");
      expect(ops.get("why_stop.collect_initial_survey")!.depends_on).toEqual([]);
      expect(ops.get("why_stop.collect_final_survey_and_stop_logging")!.depends_on).toEqual([]);
      for (const operation of source.method_operations) expect(operation.configuration_dependencies.some((key) => key.startsWith("result.") || key.startsWith("future."))).toBe(false);
      const future = restored.method_settings.find((s) => s.method_parameter_key === "future.mitigation_proposals")!;
      expect(space.invariant_method_setting_ids).not.toContain(future.method_setting_id);
      expect(enumeration.selections[0]!.effectiveSettingIds).not.toContain(future.method_setting_id);
      const example = appInterruptionSessionExample();
      example.app_interruption_sessions[0]!.method_profile_id = restored.method_profile_id;
      const populated = parseStudyMethodProfileLibrary({ profiles: [restored], app_interruption_sessions: example.app_interruption_sessions });
      await saveResearchMethodSelection(JSON.stringify({ profile: populated.profiles[0], app_interruption_sessions: populated.app_interruption_sessions }));
      const savedPopulated = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; app_interruption_sessions: unknown };
      const reloaded = parseStudyMethodProfileLibrary({ profiles: [savedPopulated.profile], app_interruption_sessions: savedPopulated.app_interruption_sessions });
      expect(reloaded.profiles[0]).toEqual(restored);
      expect(reloaded.app_interruption_sessions).toEqual(example.app_interruption_sessions);
    }
    if (auditFile === "pielot-2015-boredom.json") {
      expect(definition("borapp.result.aucroc_comparison")).toMatchObject({
        Figure3_p6: { absolute_without_proneness: 82.9, absolute_with_proneness: 82.5 },
        Discussion_RQ1_p9: { absolute_with_proneness: 82.9 },
        absolute_proneness_assignment_conflicts: true, resolution: null,
      });
      expect(definition("borapp.diary.boredom_item")).toMatchObject({ displayed_prefix: "(3)", prefix_is_recovered_raw_item_id: false, stored_min: 0, stored_max: 4, control: "slider", submit_button: "Submit" });
      expect(definition("borapp.protocol.answer_volume")).toMatchObject({ procedure_p4: { average_answers_per_day: 6 }, limitations_p9: { dismissal_allowed_if_total_answers: 84 }, six_answers_each_calendar_day: false });
      expect(definition("borapp.result.table5_printed_rows").rows).toHaveLength(20);
      expect(definition("borapp.result.table5_printed_rows")).toMatchObject({ Correlation_not_proven_Pearson: true, battery_Table4_description: "change during last session" });
      expect(definition("borapp.result.precision_recall_curve").rows).toHaveLength(10);
      expect(definition("borapp2.outcome.engagement_ratio")).toMatchObject({ denominator: "notifications presented in condition", minimum_open_seconds: 30, comparator: ">=" });
      expect(definition("borapp2.intervention.ignored_expiration")).toMatchObject({ ignored_duration_minutes: 5, comparator: ">" });
      expect(definition("borapp.feature.reported_window_choice")).toMatchObject({ length: 5, unit: "minutes" });
      for (const truth of ["absolute", "normalized"]) for (const proneness of ["with", "without"]) {
        expect(definition(`borapp.dataset.${truth}_${proneness}_proneness`)).toMatchObject({ ground_truth: truth, proneness_predictor: proneness === "with", Figure3_reported_classifier: "RF", LR_SVM_dataset_membership: null });
      }
      expect(ops.get("boredom.derive_primary_features")!.depends_on).not.toContain("boredom.select_valid_primary_cohort");
      expect(ops.get("boredom.train_pilot_RF")!.depends_on).toEqual([]);
      expect(ops.get("boredom.compute_pilot_online_features")!.depends_on).not.toContain("boredom.schedule_pilot_delay");
      expect(ops.get("boredom.observe_pilot_click_and_open")!.depends_on).toEqual(["boredom.post_pilot_content"]);
      expect(ops.get("boredom.derive_pilot_ratios")!.depends_on).not.toContain("boredom.expire_ignored_pilot_notification");
      for (const id of ["collect_primary_ESM", "collect_optional_poststudy_BPS"]) expect(Reflect.get(ops.get(`boredom.${id}`)!, "epistemic_role")).toBe("observe");
      for (const id of ["check_pilot_eligibility", "schedule_pilot_delay", "post_pilot_content", "expire_ignored_pilot_notification", "select_valid_primary_cohort", "clean_features"]) expect(Reflect.get(ops.get(`boredom.${id}`)!, "epistemic_role")).toBe("apply_policy");
      expect(Reflect.get(ops.get("boredom.infer_pilot_boredom")!, "epistemic_role")).toBe("infer");
      for (const operation of source.method_operations) expect(operation.configuration_dependencies.some((key) => key.includes(".result.") || key.startsWith("future."))).toBe(false);
      const future = restored.method_settings.find((s) => s.method_parameter_key === "future.boredom_recommendations")!;
      expect(space.invariant_method_setting_ids).not.toContain(future.method_setting_id);
      expect(enumeration.selections[0]!.effectiveSettingIds).not.toContain(future.method_setting_id);
    }
    if (auditFile === "real-world-winds.json") {
      const catalogue = definition("challenge.appendix_catalogue");
      const categories = catalogue.categories as Array<[string, string, Array<[number, number, string]>]>;
      expect(categories.map((c) => c[2].length)).toEqual([15, 22, 20, 12, 18]);
      expect(categories.flatMap((c) => c[2])).toHaveLength(87);
      expect(categories.map((c) => c[0])).toEqual(["Relaxation", "Mental", "Physical", "Social Activities", "Organizing Task"]);
      for (const category of categories) expect(category[2].map((row) => row[0])).toEqual(Array.from({ length: category[2].length }, (_, i) => i + 1));
      expect(categories[2]![2][4]).toEqual([5, 15, "Stand up and keep walking for one minute. Do not look at your smartphone. How many steps did you make?"]);
      expect(categories[1]![2][3]).toEqual([4, 15, "Look around in your room and find 3 things that have the colour green. What things did you see?"]);
      expect(catalogue).toMatchObject({ prompt_durations_are_challenge_content_not_screen_or_session_thresholds: true, source_catalogue_IDs_storage_keys_response_schema_and_actual_execution: null });
      expect(definition("challenge.figure2_creation_vocabulary")).toMatchObject({ offered_radio_labels: ["Relaxation", "Mental Exercise", "Physical Exercise", "Socializing", "Organization", "Misc"], five_study_categories_to_six_creation_options_mapping: null });
      expect(definition("survey.pre_post_LSB_items").rows).toHaveLength(7);
      expect(definition("survey.post_effectiveness_items").rows).toHaveLength(5);
      expect(definition("survey.post_enjoyment_items").rows).toHaveLength(5);
      expect(definition("study.prepost_lsb_score")).toMatchObject({ score: "sum", strongly_disagree: 1, strongly_agree: 7, reversed: ["Q1", "Q5"], missing_item_handling: null });
      expect(definition("survey.Complete_ES_items")).toMatchObject({ points: 5, exact_full_wording_endpoints_intermediate_labels_codes_requiredness_and_missingness: null });
      expect(definition("survey.balance_four_point_statement")).toMatchObject({ points: 4, endpoints: ["very unbalanced", "very balanced"], relationship_to_Q32_and_five_point_form: null });
      expect(definition("study.sus_and_timing")).toMatchObject({ SUS_printed_item_range: "Q18–Q28", exact_SUS_items_and_item_count: null, standard_SUS_defaults_not_imported: true });
      expect(definition("trigger.duration_threshold")).toMatchObject({ number: 12, unit: "minutes", exact_equality: null });
      expect(definition("trigger.unlock_count")).toMatchObject({ comparator: ">", count: 5, later_statement: "six unlocks" });
      expect(definition("trigger.unlock_window")).toMatchObject({ span: 30, unit: "minutes", rolling_or_tumbling_anchor_and_endpoint_equality: null });
      expect(definition("result.table3_per_participant").rows).toEqual([["Completed", 17.96, 10.67, 4, 13, 15, 21, 44], ["Cancelled", 4.76, 5.27, 0, 0, 3, 9, 17], ["Exchanged", 4.04, 4.49, 0, 1, 3, 5, 17]]);
      expect(definition("result.figure3_action_category_counts")).toMatchObject({ completed: [136, 105, 98, 84, 26], exchanged: [23, 7, 22, 15, 34], canceled: [26, 21, 37, 18, 17], social_exchanged_percent_in_prose: 37 });
      expect(definition("result.completion_locations")).toMatchObject({ home: { count: 279, printed_percent: 62.1 }, work: 67, outside: 70, remaining_university_or_public_transport: 42, completed_total_elsewhere: 449, overlap_storage_cardinality_and_count_reconciliation: null });
      expect(definition("evidence.source_conflicts")).toMatchObject({ no_silent_numeric_reconciliation: true });
      expect(ops.get("rww.manual_challenge_path")!.depends_on).not.toContain("rww.infer_potential_overload");
      expect(ops.get("rww.manual_challenge_path")!.depends_on).not.toContain("rww.set_snooze");
      expect(ops.get("rww.set_snooze")!.depends_on).toEqual([]);
      expect(ops.get("rww.collect_action_feedback")!.depends_on).toEqual([]);
      for (const action of ["complete_challenge", "cancel_challenge", "exchange_challenge"]) expect(ops.get(`rww.${action}`)!.depends_on).toEqual(["rww.select_random_challenge"]);
      for (const operation of source.method_operations) expect(operation.configuration_dependencies.some((key) => key.startsWith("result.") || key.startsWith("future."))).toBe(false);
      const future = restored.method_settings.find((s) => s.method_parameter_key === "future.context_and_personalization_proposals")!;
      expect(space.invariant_method_setting_ids).not.toContain(future.method_setting_id);
      expect(enumeration.selections[0]!.effectiveSettingIds).not.toContain(future.method_setting_id);
      const metadata = source.disclosed_atoms.find((a) => a.key === "structure.source_scope_and_qualifications")!.value as { definition: { bibliography: Record<string, unknown> } };
      expect(metadata.definition.bibliography).toMatchObject({ printed_reference_count: 76, existing_complete_occurrence_ledger_path: null, resolved_identity_count: null, checked_count: null });
    }
    const invalid = structuredClone(restored);
    Reflect.set((invalid.method_operations as Array<Record<string, unknown>>)[0]!, "configuration_dependencies", ["invented.parameter"]);
    expect(() => parseStudyMethodProfileLibrary({ profiles: [invalid] })).toThrow();
  });
}
