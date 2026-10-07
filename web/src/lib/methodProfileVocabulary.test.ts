import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { literatureFixturePath, privateCorpusPath } from "@/testSupport/privateCorpus";

import { loadResearchMethodSelection, saveResearchMethodSelection } from "@/lib/lastRunStore";
import { compileNativeMethodProfile, parseStudyMethodProfileLibrary } from "@/lib/methodProfiles";
import { boehmerCallActionExample } from "../../e2e/fixtures/notification-history";

const profile = {
  method_profile_id: "synthetic-vocabulary-check",
  source_work_id: "synthetic:test",
  source_method_variant_id: "v1",
  method_configuration_structure: "fixed",
  method_profile_version: "1",
  profile_implementation_status: "specification_only",
  method_settings: [{
    method_setting_id: "setting-1",
    source_extraction_id: "extraction-1",
    source_work_id: "synthetic:test",
    method_setting_role: "event_schema",
    method_target_layer: "raw_record",
    method_value_kind: "object",
    method_value_json: "{}",
    method_applicability_status: "applicable",
    method_disclosure_status: "declared",
    method_implementation_status: "specification_only",
    contract_bindings: [],
  }],
};

describe("method profile vocabulary", () => {
  it("persists repeated item-owned call actions, supplied order and unknowns without sorting or recoding", async () => {
    const input = boehmerCallActionExample();
    const imported = parseStudyMethodProfileLibrary(input);
    expect(imported.notification_histories).toEqual(input.notification_histories);
    expect(imported.notification_histories![0]!.notification_evidence.map((row) => row.occurrence_ordinal)).toEqual([8, 3, 0, null, undefined]);
    expect(imported.notification_histories![0]).not.toHaveProperty("acceptance_records");
    expect(imported.notification_histories![0]).not.toHaveProperty("app_package_name");
    await saveResearchMethodSelection(JSON.stringify({ profile: imported.profiles[0], selectedLevels: {}, notification_histories: imported.notification_histories }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; notification_histories: unknown };
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], notification_histories: saved.notification_histories });
    expect(restored.notification_histories).toEqual(input.notification_histories);
    const reversed = structuredClone(input);
    reversed.notification_histories[0]!.notification_evidence.reverse();
    expect(parseStudyMethodProfileLibrary(reversed).notification_histories).toEqual(reversed.notification_histories);
    expect(compileNativeMethodProfile(restored.profiles[0]!).ok).toBe(false);
  });

  it("rejects ambiguous action order and foreign supports without weakening other evidence kinds", () => {
    const mutate = (change: (input: ReturnType<typeof boehmerCallActionExample>) => void, message: string) => {
      const input = boehmerCallActionExample();
      change(input);
      expect(() => parseStudyMethodProfileLibrary(input)).toThrow(message);
    };
    for (const bad of [-1, 0.5, "0", Number.MAX_SAFE_INTEGER + 1, true, {}]) {
      mutate((input) => { Object.assign(input.notification_histories[0]!.notification_evidence[0]!, { occurrence_ordinal: bad }); }, "nonnegative safe integer");
    }
    for (const bad of [undefined, null, "", "   ", 1]) {
      mutate((input) => { Object.assign(input.notification_histories[0]!.notification_evidence[0]!, { action_kind: bad }); }, "action_kind");
    }
    mutate((input) => { input.notification_histories[0]!.notification_evidence[1]!.occurrence_ordinal = 8; }, "occurrence_ordinal is duplicated within history");
    for (const field of ["action_kind", "occurrence_ordinal"]) {
      mutate((input) => { const row = input.notification_histories[0]!.notification_evidence[0]!;
        row.evidence_kind = "arrival"; delete row.action_kind; delete row.occurrence_ordinal; row[field] = null; }, "action fields on non-action evidence");
    }
    mutate((input) => { input.notification_histories[0]!.notification_evidence[1]!.evidence_record_id = "p1"; }, "evidence_record_id is duplicated within history");
    mutate((input) => { input.notification_histories[1]!.notification_evidence[0]!.evidence_references = ["m1"]; }, "references within history");
    mutate((input) => { input.notification_histories[0]!.notification_evidence[0]!.evidence_kind = "unregistered_action" as never; }, "evidence_kind is unknown");
  });

  it("composes repeated Snooze actions and separate posting evidence on a supplied logical item", async () => {
    const input = boehmerCallActionExample();
    const work = "doi:10.1145/3229434.3229436";
    const locator = "Snooze PDF p.5 Snoozed Notifications; p.6 Figure5/repeated deferral; SHA256 b62eb1827c804822a7fd2db6aa05fa893b1a51c5e2be1535bce3a8af8c455a8a";
    const owner = input.profiles[0]!;
    Object.assign(owner, { method_profile_id: "example:snooze-actions", source_work_id: work,
      source_method_variant_id: "analyst-normalized-logical-item-example", source_locators: [locator] });
    Object.assign(owner.method_settings[0]!, { source_work_id: work, method_setting_id: "example:snooze-actions",
      source_extraction_id: "example:snooze:p5:repeated", method_parameter_key: "analysis.notification_vs_snooze_identity",
      method_value_json: JSON.stringify({ logical_item_has_repeated_snooze_actions: true, raw_object_keys: null,
        retrigger_copy_linkage: null, import_constructs_schedule_or_matching: false }), source_locators: [locator] });
    const history = input.notification_histories[0]!;
    Object.assign(history, { method_profile_id: owner.method_profile_id, source_work_id: work,
      notification_history_id: "example:snooze-history", notification_item_id: "example:logical-snoozed-item", source_locators: [locator] });
    const evidence = { evidence_role: "recorded" as const, source_locators: [locator] };
    history.notification_evidence = [
      { ...evidence, evidence_record_id: "initial-post", evidence_kind: "arrival", evidence_basis: "supplied initial posting; raw object key unknown" },
      { ...evidence, evidence_record_id: "snooze-1", evidence_kind: "action_occurrence", action_kind: "snooze", occurrence_ordinal: 0 },
      { ...evidence, evidence_record_id: "snooze-2", evidence_kind: "action_occurrence", action_kind: "snooze", occurrence_ordinal: 1 },
      { ...evidence, evidence_record_id: "retriggered-post", evidence_kind: "arrival", evidence_instant: null,
        evidence_basis: "supplied re-triggered posting linked to this logical item; raw copy key/matcher unknown", evidence_references: ["snooze-2"] },
    ];
    input.notification_histories = [history];
    const imported = parseStudyMethodProfileLibrary(input);
    expect(imported.notification_histories).toEqual(input.notification_histories);
    await saveResearchMethodSelection(JSON.stringify({ profile: imported.profiles[0], notification_histories: imported.notification_histories }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; notification_histories: unknown };
    expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile], notification_histories: saved.notification_histories }).notification_histories).toEqual(input.notification_histories);
    expect(compileNativeMethodProfile(imported.profiles[0]!).ok).toBe(false);
    expect(imported.notification_histories![0]).not.toHaveProperty("app_package_name");
    expect(imported.notification_histories![0]).not.toHaveProperty("acceptance_records");
  });

  it("preserves source-controlled call handling separately from tool availability and notification delivery", async () => {
    const raw = {
      ...profile,
      method_settings: [{ ...profile.method_settings[0], method_setting_role: "intervention", method_target_layer: "call_handling",
        method_value_json: JSON.stringify({ lab_postpone_seconds: 5, field_default_seconds: 5, field_user_changeable: true, actual_field_values: null }),
        source_locators: ["boehmer-2014-interrupted-phone-call.pdf: pp3–4 and p7"] }],
    };
    const imported = parseStudyMethodProfileLibrary(raw).profiles[0]!;
    expect(imported.method_settings[0]!.method_target_layer).toBe("call_handling");
    await saveResearchMethodSelection(JSON.stringify({ profile: imported }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
    expect(parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]).toEqual(imported);
    expect(compileNativeMethodProfile(imported).ok).toBe(false);
    expect(() => parseStudyMethodProfileLibrary({ ...raw,
      method_settings: [{ ...raw.method_settings[0], method_target_layer: "unregistered_call_handling" }] })).toThrow("method_target_layer is unknown");
  });

  it("preserves conditional device-setting actuation separately from observed occupancy", async () => {
    const raw = JSON.parse(readFileSync(resolve(import.meta.dirname,
      "../../e2e/fixtures/call-setting-actuation-example.json"), "utf8")) as { profiles: Array<typeof profile> };
    const imported = parseStudyMethodProfileLibrary(raw).profiles[0]!;
    expect(imported.method_settings.map((s) => s.method_target_layer)).toEqual([
      "device_setting_actuation", "device_setting_actuation",
    ]);
    expect(JSON.parse(String(imported.method_settings[0]!.method_value_json))).toMatchObject({
      calibration_duration_seconds: 2, ringer_mute_eligible_during_calibration: false,
      equality_boundary: null, exported_calibration_maximum: null,
    });
    expect(JSON.parse(String(imported.method_settings[1]!.method_value_json))).toMatchObject({
      comparator: ">", threshold: { factor: 1.5 },
      depends_on_availability_predictor: false, is_observed_setting_occupancy: false,
    });
    await saveResearchMethodSelection(JSON.stringify({ profile: imported, selectedLevels: {} }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
    expect(restored).toEqual(imported);
    expect(restored.method_operations).toEqual([
      expect.objectContaining({ operation_id: "call.calibrate_mute_eligibility", depends_on: [] }),
      expect.objectContaining({ operation_id: "call.conditionally_mute_ringer", depends_on: ["call.calibrate_mute_eligibility"] }),
    ]);
    expect(restored.method_settings.every((s) => s.method_implementation_status === "specification_only" && !s.contract_bindings?.length)).toBe(true);
    expect(compileNativeMethodProfile(restored).ok).toBe(false);
    const wrong = structuredClone(raw);
    wrong.profiles[0]!.method_settings[1]!.method_target_layer = "unregistered_device_actuation";
    expect(() => parseStudyMethodProfileLibrary(wrong)).toThrow("method_target_layer is unknown");
  });

  it("imports every source-backed Dismissed, Annotif and ODIM definition without draft-only labels", async () => {
    type Draft = { source_work_id: string; disclosed_atoms: Array<{ key: string; role: string; target: string; value: unknown; locator: string }> };
    for (const name of ["dismissed", "annotif", "odim"]) {
      const source = JSON.parse(readFileSync(literatureFixturePath(`ontology-sublation-20260831/work/new-source-audits/${name}.json`), "utf8")) as Draft;
      const imported = parseStudyMethodProfileLibrary({
        ...profile,
        method_profile_id: `source-backed-definitions:${source.source_work_id}`,
        source_work_id: source.source_work_id,
        method_settings: source.disclosed_atoms.map((atom) => ({
          ...profile.method_settings[0],
          method_setting_id: atom.key,
          source_extraction_id: atom.key,
          source_work_id: source.source_work_id,
          method_setting_role: atom.role,
          method_target_layer: atom.target,
          method_parameter_key: atom.key,
          method_value_json: JSON.stringify(atom.value),
          source_value_json: JSON.stringify(atom.value),
          source_locators: [atom.locator],
        })),
      }).profiles[0]!;
      await saveResearchMethodSelection(JSON.stringify({ profile: imported, selectedLevels: {} }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
      const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
      expect(restored.method_settings).toEqual(imported.method_settings);
      expect(restored.method_settings).toHaveLength(source.disclosed_atoms.length);
      const expected = name === "dismissed" ? [
        ["cleaning.same_second_burst_group", "reconstruction", "raw_record"],
        ["cleaning.burst_last_posted_retention", "reconstruction", "notification_alert"],
        ["attendance.removed_on_listener_callback", "feature_engineering", "notification_attendance"],
        ["attendance.already_foreground_excluded_from_consumption_inference", "quality_control", "analysis_record_set"],
        ["result.cleaned_notification_count", "reporting", "released_artifact"],
      ] : name === "annotif" ? [
        ["collector.android_platform", "participant_schema", "participant_record"],
        ["collector.background_service_claim", "provenance", "collector"],
        ["server.group_summary_disposition", "quality_control", "analysis_record_set"],
        ["server.content_duplicate_disposition", "quality_control", "analysis_record_set"],
        ["browser.required_controls", "quality_control", "diary_response"],
      ] : [
        ["collector.gesture_coordinates", "feature_engineering", "derived_feature"],
        ["collector.snapshot_gesture_pair", "reconstruction", "raw_record"],
        ["privacy.redaction_reason", "diary_schema", "diary_response"],
        ["evaluation.raw_capture_protocol", "validation", "analysis_record_set"],
        ["evaluation.usability_protocol", "validation", "participant_record"],
        ["evaluation.llm_baseline", "analysis", "model"],
      ];
      for (const [key, role, target] of expected) {
        const setting = restored.method_settings.find((candidate) => candidate.method_setting_id === key);
        expect([setting?.method_setting_role, setting?.method_target_layer], key).toEqual([role, target]);
      }
      expect(compileNativeMethodProfile(restored).ok).toBe(false);
    }
  });

  it("accepts ontology terms and refuses untyped draft labels", () => {
    expect(parseStudyMethodProfileLibrary(profile).profiles[0]?.method_settings[0]?.method_target_layer).toBe("raw_record");
    expect(() => parseStudyMethodProfileLibrary({
      ...profile,
      method_settings: [{ ...profile.method_settings[0], method_setting_role: "untyped_processing" }],
    })).toThrow("method_setting_role is unknown");
    expect(() => parseStudyMethodProfileLibrary({
      ...profile,
      method_settings: [{ ...profile.method_settings[0], method_setting_role: undefined }],
    })).toThrow("method_setting_role must be a non-empty string");
    expect(() => parseStudyMethodProfileLibrary({
      ...profile,
      method_settings: [{ ...profile.method_settings[0], method_target_layer: "notification_alert_unrepresented" }],
    })).toThrow("method_target_layer is unknown");
  });

  it("keeps ringer-mode occupancy separate from a device-use session", async () => {
    const draft = JSON.parse(readFileSync(literatureFixturePath("ontology-sublation-20260831/work/new-source-audits/chang-ringer-mode-usage.json"), "utf8")) as {
      source_work_id: string;
      disclosed_atoms: Array<{ key: string; role: string; target: string; value: unknown; locator: string }>;
    };
    const keys = [
      "reconstruction.ringer_mode_interval",
      "feature.within_ringer_interval_attendance",
      "limitation.power_off_duration_unknown",
    ];
    const raw = {
      ...profile,
      method_profile_id: "source-backed:chang-ringer-state",
      source_work_id: draft.source_work_id,
      method_settings: keys.map((key) => {
        const atom = draft.disclosed_atoms.find((candidate) => candidate.key === key)!;
        return {
          ...profile.method_settings[0],
          method_setting_id: key,
          source_extraction_id: key,
          source_work_id: draft.source_work_id,
          method_setting_role: atom.role,
          method_target_layer: atom.target,
          method_value_kind: "string",
          method_value_json: JSON.stringify(atom.value),
          source_value_json: JSON.stringify(atom.value),
          source_locators: [atom.locator],
        };
      }),
    };
    const imported = parseStudyMethodProfileLibrary(raw).profiles[0]!;
    await saveResearchMethodSelection(JSON.stringify({ profile: imported, selectedLevels: {} }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
    expect(restored.method_settings).toEqual(imported.method_settings);
    expect(restored.method_settings.map((setting) => setting.method_target_layer))
      .toEqual(["device_setting_state_interval", "device_setting_state_interval", "participant_measure"]);
    expect(restored.method_settings.map((setting) => setting.method_setting_role))
      .toEqual(["reconstruction", "feature_engineering", "reporting"]);
    for (const key of keys) {
      const atom = draft.disclosed_atoms.find((candidate) => candidate.key === key)!;
      const setting = restored.method_settings.find((candidate) => candidate.method_setting_id === key)!;
      expect(JSON.parse(String(setting.method_value_json))).toEqual(atom.value);
      expect(JSON.parse(String(setting.source_value_json))).toEqual(atom.value);
      expect(setting.source_locators).toEqual([atom.locator]);
    }
    expect(compileNativeMethodProfile(restored).ok).toBe(false);
  });

  it("preserves distinct inbound notification alert and inferred attendance targets", async () => {
    const raw = {
      ...profile,
      method_profile_id: "synthetic-notification-targets",
      source_work_id: "doi:10.1145/3229434.3229445",
      method_settings: [
        {
          ...profile.method_settings[0],
          method_setting_id: "dismissed-alert",
          source_extraction_id: "cleaning.callback_to_perceived_alert_boundary",
          source_work_id: "doi:10.1145/3229434.3229445",
          method_target_layer: "notification_alert",
          method_value_json: JSON.stringify({ input: "notification_posted_callback", retained_as: "analytic_alert_proxy", observed_perceptible_alert: false, one_to_one_with_alert: false }),
          source_locators: ["Dismissed! PDF pp. 3:3–3:4 §Filtering Notification-Posted Event Bursts"],
        },
        {
          ...profile.method_settings[0],
          method_setting_id: "dismissed-attendance",
          source_extraction_id: "attendance.seen_at_unlock",
          source_work_id: "doi:10.1145/3229434.3229445",
          method_setting_role: "feature_engineering",
          method_target_layer: "notification_attendance",
          method_value_json: JSON.stringify({ evidence: "device_unlock", inference: "seen", observed_read: false }),
          source_locators: ["Dismissed! PDF p. 3:6 §Definitions: Seen"],
        },
      ],
    };
    const imported = parseStudyMethodProfileLibrary(raw).profiles[0]!;
    await saveResearchMethodSelection(JSON.stringify({ profile: imported, selectedLevels: {} }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
    expect(restored.method_settings).toEqual(imported.method_settings);
    expect(restored.method_settings.map((setting) => setting.method_target_layer)).toEqual([
      "notification_alert", "notification_attendance",
    ]);
  });

  itWithPrivateCorpus("exposes the populated posted-callback to analytic-proxy boundary instead of claiming definition coverage", async () => {
    const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as {
      profiles: Array<{ source_work_id: string; method_profile_id: string }>;
    };
    const source = library.profiles.find((row) => row.source_work_id === "doi:10.1145/3229434.3229445")!;
    const locator = "Dismissed! physical PDF pp3–4 / printed pp3:3–3:4 Filtering Notification-Posted Event Bursts; SHA256 f839a5caed8527105f98be9cb7875a02e987c5326d442b79b428e243ad3185ee";
    const baseline = parseStudyMethodProfileLibrary({ profiles: [source] }).profiles[0]!;
    await saveResearchMethodSelection(JSON.stringify({ profile: baseline }));
    // An attempted mapping, not registered terms or recovered source rows.
    // Membership and selected callback are supplied; no clock, sort or perception is inferred.
    const candidate = { profiles: [baseline], notification_histories: [{
      method_profile_id: source.method_profile_id, source_work_id: source.source_work_id,
      participant_id: "example-participant", device_id: "example-device",
      notification_history_id: "example-burst", notification_item_id: "example-analytic-proxy",
      history_record_origin: "analyst_constructed_example", source_locators: [locator],
      notification_evidence: [
        ...["callback-a", "callback-b"].map((id) => ({ evidence_record_id: id,
          evidence_kind: "notification_posted_callback", evidence_role: "recorded", source_locators: [locator] })),
        { evidence_record_id: "analytic-proxy", evidence_kind: "analytic_alert_proxy", evidence_role: "inferred",
          evidence_references: ["callback-a", "callback-b"],
          evidence_value_json: JSON.stringify({ supplied_retained_callback: "callback-b", observed_perception: null }),
          source_locators: [locator] },
      ],
    }] };
    expect(() => parseStudyMethodProfileLibrary(candidate)).toThrow("evidence_kind is unknown");
    const ownerless = structuredClone(candidate);
    Reflect.deleteProperty(ownerless.notification_histories[0]!, "notification_item_id");
    expect(() => parseStudyMethodProfileLibrary(ownerless)).toThrow("notification_item_id must be a non-empty string");
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
    expect(saved.profile).toEqual(baseline);
    expect(compileNativeMethodProfile(baseline).ok).toBe(false);
  });

  it("round-trips Dismissed! keep-last and Annotif keep-first as different ordered methods", async () => {
    type Draft = { source_work_id: string; disclosed_atoms: Array<{ key: string; value: unknown; locator: string }> };
    const draft = (name: string): Draft => JSON.parse(readFileSync(literatureFixturePath(`ontology-sublation-20260831/work/new-source-audits/${name}.json`), "utf8")) as Draft;
    const makeSetting = (source: Draft, key: string, target: string, role: string) => {
      const atom = source.disclosed_atoms.find((candidate) => candidate.key === key)!;
      expect(atom?.locator, `${source.source_work_id}: ${key}`).toBeTruthy();
      return {
        ...profile.method_settings[0],
        method_setting_id: key,
        source_extraction_id: key,
        source_work_id: source.source_work_id,
        method_setting_role: role,
        method_target_layer: target,
        method_parameter_key: key,
        method_value_json: JSON.stringify(atom.value),
        source_value_json: JSON.stringify(atom.value),
        source_locators: [atom.locator],
      };
    };
    const cases = [
      {
        source: draft("dismissed"),
        keys: [
          ["cleaning.translated_two_unread_messages", "raw_record", "quality_control"],
          ["cleaning.same_second_burst_group", "raw_record", "reconstruction"],
          ["cleaning.burst_last_posted_retention", "notification_alert", "reconstruction"],
        ],
      },
      {
        source: draft("annotif"),
        keys: [
          ["server.cluster_app", "raw_record", "reconstruction"],
          ["server.cluster_day", "raw_record", "reconstruction"],
          ["server.group_summary_disposition", "raw_record", "quality_control"],
          ["server.content_duplicate_disposition", "raw_record", "quality_control"],
        ],
      },
    ] as const;
    for (const { source, keys } of cases) {
      const raw = {
        ...profile,
        method_profile_id: `source-backed-reduction:${source.source_work_id}`,
        source_work_id: source.source_work_id,
        method_settings: keys.map(([key, target, role]) => makeSetting(source, key, target, role)),
        method_operations: keys.map(([key], index) => ({
          operation_id: key,
          verb: "filter_or_reduce_records",
          consumes: [index ? keys[index - 1]![0] : "posted_callback"],
          produces: [key],
          ...(index ? { depends_on: [keys[index - 1]![0]] } : {}),
          configuration_dependencies: [key],
        })),
      };
      const imported = parseStudyMethodProfileLibrary(raw).profiles[0]!;
      await saveResearchMethodSelection(JSON.stringify({ profile: imported, selectedLevels: {} }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
      const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
      expect(restored.method_settings).toEqual(imported.method_settings);
      expect(restored.method_operations).toEqual(imported.method_operations);
      expect(compileNativeMethodProfile(restored).ok).toBe(false);
      for (const [key] of keys) {
        const atom = source.disclosed_atoms.find((candidate) => candidate.key === key)!;
        const setting = restored.method_settings.find((candidate) => candidate.method_setting_id === key)!;
        expect(JSON.parse(String(setting.method_value_json))).toEqual(atom.value);
        expect(setting.source_locators).toEqual([atom.locator]);
      }
    }
    expect((cases[0].source.disclosed_atoms.find((atom) => atom.key === "cleaning.burst_last_posted_retention")!.value as { retain: string }).retain)
      .toBe("last posted callback");
    expect(cases[1].source.disclosed_atoms.find((atom) => atom.key === "server.content_duplicate_disposition")!.value)
      .toContain("keep first");
  });

  it("keeps notification timing, item identity, and analysis-only selection distinct", async () => {
    type Draft = { source_work_id: string; disclosed_atoms: Array<{ key: string; value: unknown; locator: string }> };
    const cases = [
      { file: "snooze-user-defined-deferral", settings: [
        ["filter.ongoing_notification", "quality_control", "raw_record"],
        ["intervention.drawer_prompt_lifetime", "intervention", "notification_delivery"],
        ["analysis.notification_vs_snooze_identity", "reconstruction", "notification_item"],
        ["analysis.exclude_installation_day_snoozes", "quality_control", "analysis_record_set"],
        ["analysis.initial_vs_repeat", "analysis", "analysis_record_set"],
      ] },
      { file: "dismissed", settings: [
        ["cleaning.same_second_burst_group", "reconstruction", "raw_record"],
        ["analysis.flow_population_excludes_immediate", "quality_control", "analysis_record_set"],
      ] },
      { file: "multi-device-notifications", settings: [
        ["acquisition.android_touch_cap", "acquisition", "raw_record"],
        ["intervention.esm_schedule", "intervention", "notification_delivery"],
        ["intervention.esm_expiry", "intervention", "notification_delivery"],
      ] },
      { file: "clear-all-drawer-snapshots", settings: [
        ["acquisition.snapshot_schedule", "acquisition", "acquired_snapshot"],
        ["identity.paper_unique_item", "reconstruction", "notification_item"],
        ["identity.code_unique_item", "reconstruction", "notification_item"],
        ["analysis.notification_age_code", "feature_engineering", "derived_feature"],
      ] },
    ] as const;
    for (const { file, settings } of cases) {
      const audit = JSON.parse(readFileSync(literatureFixturePath(`ontology-sublation-20260831/work/new-source-audits/${file}.json`), "utf8")) as Draft;
      const raw = {
        ...profile, method_profile_id: `source-backed:${audit.source_work_id}`, source_work_id: audit.source_work_id,
        method_settings: settings.map(([key, role, target]) => {
          const atom = audit.disclosed_atoms.find((candidate) => candidate.key === key);
          expect(atom, `${audit.source_work_id}: ${key}`).toBeDefined();
          return {
            ...profile.method_settings[0], method_setting_id: key, source_extraction_id: key,
            source_work_id: audit.source_work_id, method_setting_role: role, method_target_layer: target,
            method_parameter_key: key, method_value_kind: typeof atom!.value === "string" ? "string" : "object",
            method_value_json: JSON.stringify(atom!.value), source_value_json: JSON.stringify(atom!.value),
            source_locators: [atom!.locator],
          };
        }),
      };
      const imported = parseStudyMethodProfileLibrary(raw).profiles[0]!;
      await saveResearchMethodSelection(JSON.stringify({ profile: imported, selectedLevels: {} }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
      const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
      expect(restored.method_settings).toEqual(imported.method_settings);
      expect(restored.method_settings.map((setting) => setting.method_target_layer))
        .toEqual(settings.map(([, , target]) => target));
      expect(compileNativeMethodProfile(restored).ok).toBe(false);
    }
    expect(() => parseStudyMethodProfileLibrary({ ...profile, method_settings: [
      { ...profile.method_settings[0], method_target_layer: "analysis_population" },
    ] })).toThrow("method_target_layer is unknown");
  });

  itWithPrivateCorpus("preserves reviewed claim, scoring, snapshot and analysis-subset roles as method definitions", async () => {
    const cases = [
      { file: "shin-2013-problematic-smartphone-use", settings: [
        ["acquisition.battery_impact_validation", "reporting", "collector"],
        ["assessment.score", "aggregation", "participant_measure"],
      ] },
      { file: "falaki-2010-diversity-smartphone-usage", settings: [
        ["acquisition.android_timer_start_semantics", "acquisition", "acquired_snapshot"],
        ["acquisition.android_timer_stop_semantics", "acquisition", "acquired_snapshot"],
        ["acquisition.android_counter_snapshot", "acquisition", "acquired_snapshot"],
        ["reconstruction.android_precise_app_session_unavailable", "provenance", "app_episode"],
        ["analysis.interaction_time_user_partition", "analysis", "analysis_record_set"],
        ["analysis.traffic_volume_user_partition", "analysis", "analysis_record_set"],
        ["quality.battery_discharge_analysis_gate", "quality_control", "analysis_record_set"],
      ] },
      { file: "van-berkel-2016-usage-gaps", settings: [
        ["model.similar_sets_basis", "analysis", "model"],
      ] },
      { file: "finesse", settings: [
        ["esm.timeline_view", "diary_schema", "diary_item"],
        ["cohort.android_users", "participant_schema", "participant_record"],
        ["classifier.avoid_component_size", "feature_engineering", "derived_feature"],
        ["feature.taxonomy", "event_schema", "derived_feature"],
        ["analysis.feature_use_probability", "aggregation", "participant_measure"],
      ] },
    ] as const;
    for (const { file, settings } of cases) {
      const audit = JSON.parse(readFileSync(privateCorpusPath(`ontology-sublation-20260831/work/new-source-audits/${file}.json`), "utf8")) as {
        source_work_id: string;
        disclosed_atoms: Array<{ key: string; role: string; target: string; value: unknown; locator: string }>;
      };
      const raw = {
        ...profile, method_profile_id: `source-backed:${audit.source_work_id}`, source_work_id: audit.source_work_id,
        method_settings: settings.map(([key, role, target]) => {
          const atom = audit.disclosed_atoms.find((candidate) => candidate.key === key)!;
          expect([atom.role, atom.target], key).toEqual([role, target]);
          if (key === "model.similar_sets_basis") {
            expect(atom.value).toMatchObject({
              decision: "close to continuous distance distribution -> new-continuous; otherwise -> new-new; exact closeness predicate not disclosed",
              distance_formula: null, distribution_estimator: null, tie_policy: null,
            });
          }
          if (key === "esm.timeline_view") {
            expect(atom.value).toMatchObject({ rows: "features used in the session", selectable_items: "feature-use instances" });
          }
          if (key === "feature.taxonomy") {
            const taxonomy = atom.value as { labels_by_app: Record<string, string[]> };
            expect(Object.values(taxonomy.labels_by_app).map((labels) => labels.length)).toEqual([5, 15, 13, 10]);
            expect(Object.values(taxonomy.labels_by_app).flat()).toHaveLength(43);
          }
          if (key === "cohort.android_users") expect(atom.value).toMatchObject({ eligibility_minimum_daily_target_apps: 3 });
          return {
            ...profile.method_settings[0], method_setting_id: key, source_extraction_id: key,
            source_work_id: audit.source_work_id, method_setting_role: atom.role, method_target_layer: atom.target,
            method_parameter_key: key, method_value_kind: "object",
            method_value_json: JSON.stringify(atom.value), source_value_json: JSON.stringify(atom.value),
            source_locators: [atom.locator],
          };
        }),
      };
      const imported = parseStudyMethodProfileLibrary(raw).profiles[0]!;
      await saveResearchMethodSelection(JSON.stringify({ profile: imported, selectedLevels: {} }));
      const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
      const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
      expect(restored.method_settings).toEqual(imported.method_settings);
      expect(compileNativeMethodProfile(restored).ok).toBe(false);
    }
  });

  itWithPrivateCorpus("preserves Back to the App's fixed partial-order interruption method without claiming execution", async () => {
    const audit = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/work/new-source-audits/back-to-the-app.json"), "utf8")) as {
      source_work_id: string;
      disclosed_atoms: Array<{ key: string; value: unknown; locator: string }>;
      method_operations: Array<{ operation_id: string; depends_on?: string[]; configuration_dependencies?: string[] }>;
    };
    const mapping = {
      "input.appsensor_android_provenance": ["acquisition", "collector"],
      "input.collapsed_activity_row": ["event_schema", "raw_record"],
      "sequence.user_day_partition": ["reconstruction", "raw_record"],
      "activity.same_user_day_app_gap_split": ["reconstruction", "app_session"],
      "interruption.core_x_y_x_motif": ["reconstruction", "derived_feature"],
      "interruption.subject_app_exclusions": ["reconstruction", "derived_feature"],
      "interruption.interrupting_app_exclusion": ["reconstruction", "derived_feature"],
      "interruption.type_internal": ["feature_engineering", "derived_feature"],
      "interruption.type_external": ["feature_engineering", "derived_feature"],
      "measure.interrupted_runtime_components": ["feature_engineering", "derived_feature"],
      "measure.normal_runtime_reference": ["analysis", "derived_feature"],
      "measure.signed_overhead": ["feature_engineering", "derived_feature"],
      "analysis.all_cases_frequency_then_paired_cases": ["analysis", "derived_feature"],
      "analysis.outlier_removal": ["quality_control", "derived_feature"],
      "analysis.macro_average": ["aggregation", "derived_feature"],
      "analysis.nonparametric_tests": ["analysis", "outcome"],
      "analysis.correlation_study": ["analysis", "outcome"],
      "analysis.effect_size_reporting": ["analysis", "outcome"],
    } as const;
    const atoms = new Map(audit.disclosed_atoms.map((atom) => [atom.key, atom]));
    const raw = {
      ...profile,
      method_profile_id: `source-backed-reduction:${audit.source_work_id}`,
      source_work_id: audit.source_work_id,
      method_settings: Object.entries(mapping).map(([key, [role, target]]) => {
        const atom = atoms.get(key)!;
        expect(atom, key).toBeDefined();
        return {
          ...profile.method_settings[0], method_setting_id: key, source_extraction_id: key,
          source_work_id: audit.source_work_id, method_setting_role: role, method_target_layer: target,
          method_parameter_key: key, method_value_json: JSON.stringify(atom.value), source_locators: [atom.locator],
        };
      }),
      method_operations: audit.method_operations,
    };
    expect(audit.disclosed_atoms).toHaveLength(27);
    expect(Object.keys(mapping)).toHaveLength(18);
    expect(audit.method_operations).toHaveLength(10);
    const imported = parseStudyMethodProfileLibrary(raw).profiles[0]!;
    await saveResearchMethodSelection(JSON.stringify({ profile: imported, selectedLevels: {} }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown };
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile] }).profiles[0]!;
    const restoredOperations = restored.method_operations as typeof audit.method_operations;
    expect(restored.method_configuration_structure).toBe("fixed");
    expect(restoredOperations).toEqual(audit.method_operations);
    expect(restored.method_settings.map((setting) => setting.method_parameter_key)).toEqual(Object.keys(mapping));
    for (const setting of restored.method_settings) {
      const atom = atoms.get(String(setting.method_parameter_key));
      expect(JSON.parse(String(setting.method_value_json))).toEqual(atom?.value);
      expect(setting.source_locators).toEqual([atom?.locator]);
    }
    expect(restoredOperations.find((operation) => operation.operation_id === "leiva.split_app_activities")?.configuration_dependencies)
      .toEqual(["activity.same_user_day_app_gap_split"]);
    expect(restoredOperations.find((operation) => operation.operation_id === "leiva.compute_signed_overhead")?.depends_on)
      .toEqual(["leiva.compute_interrupted_runtime", "leiva.separate_analysis_populations"]);
    expect(compileNativeMethodProfile(restored).ok).toBe(false);
  });
});
