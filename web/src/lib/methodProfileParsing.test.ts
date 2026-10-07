import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  parseStudyMethodProfile,
  parseStudyMethodProfileLibrary,
  compileNativeMethodProfile,
} from "@/lib/methodProfiles";
import { loadResearchMethodSelection, saveResearchMethodSelection } from "@/lib/lastRunStore";
import { canonicalJson } from "@/lib/canonicalJson";
import { sourceArtifactProvenanceAssertionForSetting } from "@/lib/sourceArtifactProvenanceRegistry";
import { literatureComponentExecutionsForSettings } from "@/lib/literatureInputAdapters";

/**
 * `parseStudyMethodProfile` is the only door adjudicated study method profiles
 * enter the browser through, and every rule below is one of its fail-closed
 * guards. The allowed field names, the four status vocabularies and the
 * configuration structures it enforces are declared at the top of
 * `src/lib/methodProfiles.ts`; the source-artifact assertion rows it demands an
 * exact match against come from the generated registry read by
 * `src/lib/sourceArtifactProvenanceRegistry.ts`.
 *
 * Each case starts from the same minimally valid profile and changes exactly
 * one thing, so the asserted message names the guard the change reaches.
 */
type Json = Record<string, unknown>;

it("imports and reopens outside-freeze profiles with bounded component actions, without admitting or executing their whole parents", async () => {
  const input: unknown = JSON.parse(readFileSync(resolve(import.meta.dirname,
    "../../../docs/paper/android-app-usage-outside-freeze-profiles.json"), "utf8"));
  const library = parseStudyMethodProfileLibrary(input);
  expect(library.profiles.map(p => p.source_work_id)).toEqual([
    "doi:10.3758/s13428-021-01585-7", "doi:10.1007/978-3-319-11569-6_16", "doi:10.1016/j.chbr.2021.100164",
  ]);
  const canonical = JSON.parse(readFileSync(resolve(import.meta.dirname,
    "../generated/android-method-profile-runtime-registry.json"), "utf8")) as {
      summary: { profile_count: number }; profiles: Array<{ source_work_id: string }>;
    };
  expect(canonical.summary.profile_count).toBe(143);
  for (const profile of library.profiles) {
    expect(canonical.profiles.some(p => p.source_work_id === profile.source_work_id)).toBe(false);
    expect(profile.profile_implementation_status).toBe("blocked");
    expect(compileNativeMethodProfile(profile).ok).toBe(false);
    expect(profile.method_settings.every(s => s.method_implementation_status === "specification_only" && !s.contract_bindings.length)).toBe(true);
    const observations = profile.source_work_id.endsWith("100164") ? [
      { day_observation_id: "synthetic-duration", observed_property: "supplied screen duration", evidence_unit: "seconds", day_observation_value_json: "60" },
      { day_observation_id: "synthetic-activation-count", observed_property: "supplied screen activation count, not keyguard unlocks", evidence_unit: "count", day_observation_value_json: "2" },
    ].map(row => ({ ...row, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
      participant_id: "constructed-participant", device_id: "constructed-Android-device", referenced_hour_token: "opaque-supplied-hour",
      day_record_origin: "analyst_constructed_example", day_observation_kind: "objective_aggregate",
      source_locators: ["SDU §2.4.3; explicitly supplied example totals, not computed or original observations"] })) : [];
    const parsed = parseStudyMethodProfileLibrary({ profiles: [profile], participant_day_observations: observations });
    expect(parsed.participant_day_observations).toEqual(observations);
    await saveResearchMethodSelection(JSON.stringify({ profile: parsed.profiles[0], selectedLevels: {}, participant_day_observations: parsed.participant_day_observations }));
    const saved = JSON.parse((await loadResearchMethodSelection())!) as { profile: unknown; participant_day_observations: unknown };
    const restored = parseStudyMethodProfileLibrary({ profiles: [saved.profile], participant_day_observations: saved.participant_day_observations });
    expect(restored.profiles[0]).toEqual(profile);
    expect(restored.participant_day_observations).toEqual(observations);
    const actions=literatureComponentExecutionsForSettings(restored.profiles[0]!.method_settings.map(s=>s.method_setting_id));
    const expectedActions=profile.source_work_id.endsWith("01585-7") ? ["chronicle.usage-logger-released-numeric/v1"]
      : profile.source_work_id.endsWith("100164") ? ["chronicle.sdu-supplied-period-reductions/v1", "chronicle.sdu-supplied-validation-arithmetic/v1"] : [];
    expect(actions.map(c=>c.componentId)).toEqual(expectedActions);
    expect(actions.every(c=>c.parentMethodProfileId===profile.method_profile_id && c.sourceWorkId===profile.source_work_id)).toBe(true);
    if (observations.length) {
      const foreign = structuredClone(observations); foreign[0]!.source_work_id = library.profiles[0]!.source_work_id;
      expect(() => parseStudyMethodProfileLibrary({ profiles: [profile], participant_day_observations: foreign })).toThrow("matching profile/source owner");
      const ambiguous = observations.map(row => ({ ...row, referenced_day_token: "also-a-day" }));
      expect(() => parseStudyMethodProfileLibrary({ profiles: [profile], participant_day_observations: ambiguous })).toThrow("exactly one referenced");
      const resaved = JSON.parse((await loadResearchMethodSelection())!) as { participant_day_observations: unknown };
      expect(resaved.participant_day_observations).toEqual(observations);
    }
  }
  expect(library.profiles.reduce((n, p) => n + p.method_settings.length, 0)).toBe(50);
});

function setting(overrides: Json = {}): Json {
  return {
    method_setting_id: "setting:1",
    source_extraction_id: "extraction:1",
    method_setting_role: "provenance",
    method_applicability_status: "applicable",
    method_disclosure_status: "declared",
    method_implementation_status: "unresolved",
    contract_bindings: [],
    ...overrides,
  };
}

function profile(overrides: Json = {}): Json {
  return {
    method_profile_id: "profile:paper",
    source_work_id: "doi:paper",
    source_method_variant_id: "primary",
    method_configuration_structure: "fixed",
    method_profile_version: "v1",
    profile_implementation_status: "blocked",
    method_settings: [setting()],
    ...overrides,
  };
}

function withSetting(overrides: Json): Json {
  return profile({ method_settings: [setting(overrides)] });
}
it.each(["session_association_databases", "sampled_quantity_observations", "monthly_app_use_cells", "ringer_state_intervals"])("rejects malformed %s outer carriers without assigning an owner", field => {
  for (const carrier of [{}, [null]]) {
    expect(() => parseStudyMethodProfileLibrary({ profiles: [profile()], [field]: carrier })).toThrow(field);
  }
});
it("rejects malformed policy objects, provenance lists and setting members", () => {
  const policy = { session_construction_policy_id: "policy:1", session_input_layer: "raw_record", session_output_layer: "device_session", method_settings: [], source_locators: ["source:1"] };
  for (const [invalid, error] of [[null, /must be an object/], [{ ...policy, source_locators: [" "] }, /source_locators must be a string array/], [{ ...policy, method_settings: [null] }, /invalid policy member/]] as const) {
    expect(() => parseStudyMethodProfileLibrary({ profiles: [profile({ session_construction_policies: [invalid] })] })).toThrow(error);
  }
});

function configurationSpace(overrides: Json = {}): Json {
  return {
    method_configuration_space_id: "space:1",
    method_configuration_structure: "fixed",
    method_configuration_groups: [
      {
        method_configuration_group_id: "group:1",
        method_configuration_group_kind: "axis",
        method_selection_semantics: "independently_selectable",
        method_cross_product_policy: "not_enumerated_no_cartesian_product",
        method_configuration_levels: [
          {
            method_configuration_level_id: "level:1",
            method_configuration_level_label: "Level one",
            included_method_setting_ids: ["setting:1"],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function selection(overrides: Json = {}): Json {
  return {
    method_configuration_selection_id: "selection:1",
    method_configuration_space_reference: "space:1",
    selected_method_configuration_level_ids: ["level:1"],
    effective_method_setting_ids: ["setting:1"],
    method_configuration_selection_status: "exact",
    method_configuration_selection_blockers: [],
    ...overrides,
  };
}

describe("study method profile parsing", () => {
  it("enforces every generated operation field shape without normalizing valid source values", () => {
    const schema = JSON.parse(readFileSync(resolve(import.meta.dirname,
      "../../schema/generated/json-schema/chronicle-research-ontology.schema.json"), "utf8")) as {
      $defs: { OperationDefinition: {
        additionalProperties: boolean;
        properties: Record<string, { type?: string[]; items?: { type: string } }>;
      } };
    };
    const shape = schema.$defs.OperationDefinition;
    expect(shape.additionalProperties).toBe(false);
    // These optional fields form one conditional tuple, exercised in the real
    // Jones import/store test; individually nullable schema slots are not a tuple.
    const sequenceFields = ["sequence_encoding_rule", "sequence_scope_operation_ids", "sequence_identity_setting_ids",
      "sequence_first_symbol_setting_id", "sequence_repeat_symbol_setting_id"];
    const operation = Object.fromEntries(Object.entries(shape.properties).flatMap(([key, field]) =>
      !field.type || sequenceFields.includes(key) ? [] : [[key, key === "operation_id" ? "first"
        : ["group_scope_operation_ids", "equality_key_setting_ids", "concatenated_key_setting_ids", "empty_if_absent_key_setting_ids", "required_event_payload_roles", "optional_event_payload_roles"].includes(key) ? null
          : field.type.includes("array") ? [] : field.type.includes("boolean") ? false : ""]]));
    expect(parseStudyMethodProfile(profile({ method_operations: [operation] })).method_operations)
      .toEqual([operation]);
    const nullable = Object.fromEntries(Object.entries(shape.properties).flatMap<[string, unknown]>(([key, field]) =>
      key === "operation_id" ? [[key, "first"]] : !sequenceFields.includes(key) && field.type?.includes("null") ? [[key, null]] : []));
    expect(parseStudyMethodProfile(profile({ method_operations: [nullable] })).method_operations)
      .toEqual([nullable]);
    expect(parseStudyMethodProfile(profile({ method_operations: null })).method_operations).toBeNull();
    expect(() => parseStudyMethodProfile(profile({ method_operations: {} }))).toThrow("method_profile.method_operations must be an array");
    for (const [key, field] of Object.entries(shape.properties)) {
      expect(() => parseStudyMethodProfile(profile({ method_operations: [{ ...operation, [key]: 42 }] })))
        .toThrow(`method_profile.method_operations[0].${key}`);
      if (field.type?.includes("array")) {
        if (!["required_event_payload_roles", "optional_event_payload_roles"].includes(key)) expect(field.items?.type).toBe("string");
        expect(() => parseStudyMethodProfile(profile({
          method_operations: [{ ...operation, [key]: ["source-defined", 42] }],
        }))).toThrow(`method_profile.method_operations[0].${key}`);
      }
    }
    expect(parseStudyMethodProfile(profile({ method_operations: [{
      operation_id: "first", part_of_operation: "external-parent", consumes: ["a", "a"],
    }] })).method_operations).toEqual([{
      operation_id: "first", part_of_operation: "external-parent", consumes: ["a", "a"],
    }]);
  });

  it("preserves paired event payloads and independent gesture quality, rejecting malformed compositions", () => {
    const operation = { operation_id: "capture", required_event_payload_roles: ["screenshot", "view_hierarchy"],
      optional_event_payload_roles: ["gesture"], event_payload_association: "gesture_to_most_recent_paired_snapshot",
      missing_gesture_marks_incomplete: true, gesture_presence_implies_correctness: false };
    expect(parseStudyMethodProfile(profile({ method_operations: [operation] })).method_operations).toEqual([operation]);
    for (const [change, message] of [
      [{ required_event_payload_roles: ["screenshot"] }, "event_payload_association"],
      [{ optional_event_payload_roles: [] }, "event_payload_association"],
      [{ required_event_payload_roles: ["screenshot", "screenshot"] }, "required_event_payload_roles"],
      [{ optional_event_payload_roles: ["gesture", "gesture"] }, "optional_event_payload_roles"],
      [{ optional_event_payload_roles: ["screenshot"] }, "overlaps"],
      [{ optional_event_payload_roles: ["invented"] }, "optional_event_payload_roles"],
      [{ optional_event_payload_roles: [null] }, "string array"],
      [{ event_payload_association: "closest_timestamp" }, "event_payload_association"],
      [{ event_payload_association: null }, "event_payload_association"],
      [{ missing_gesture_marks_incomplete: "true" }, "missing_gesture_marks_incomplete"],
      [{ gesture_presence_implies_correctness: "false" }, "gesture_presence_implies_correctness"],
    ] as const) {
      expect(() => parseStudyMethodProfile(profile({ method_operations: [{ ...operation, ...change }] }))).toThrow(message);
    }
    // A source may omit an assessment: neither null nor omission means false.
    const unknown = { ...operation, missing_gesture_marks_incomplete: null, gesture_presence_implies_correctness: null };
    expect(parseStudyMethodProfile(profile({ method_operations: [unknown] })).method_operations).toEqual([unknown]);
  });

  it("validates grouped subset rules and their profile-local upstream and field references", () => {
    const policy = { group_scope_operation_ids: ["partition"], grouping_basis: "field_equality",
      equality_key_setting_ids: ["setting:1"], selection_rule: "FIRST" };
    const operations = [{ operation_id: "partition" },
      { operation_id: "summary", depends_on: ["partition"] },
      { operation_id: "subset", depends_on: ["summary"], ...policy }];
    const input = profile({ method_operations: operations });
    expect(parseStudyMethodProfile(input).method_operations).toEqual(operations);
    for (const selection_rule of ["FIRST", "LAST", "DISCARD_SUMMARY_IF_NON_SUMMARY_EXISTS"]) {
      const changed = structuredClone(input);
      Object.assign((changed.method_operations as Json[])[2]!, { selection_rule });
      expect(() => parseStudyMethodProfile(changed)).not.toThrow();
    }
    for (const [changedPolicy, message] of [
      [{ ...policy, extra: true }, "unknown fields"],
      [{ ...policy, grouping_basis: "timestamp_bucket" }, "grouping_basis"],
      [{ ...policy, grouping_basis: null }, "grouping_basis"],
      [{ ...policy, selection_rule: "KEEP_ONE_SUMMARY" }, "selection_rule"],
      [{ ...policy, selection_rule: null }, "selection_rule"],
      [{ ...policy, group_scope_operation_ids: [] }, "group_scope_operation_ids"],
      [{ ...policy, group_scope_operation_ids: ["missing"] }, "upstream"],
      [{ ...policy, group_scope_operation_ids: ["subset"] }, "upstream"],
      [{ ...policy, group_scope_operation_ids: ["unrelated"] }, "upstream"],
      [{ ...policy, equality_key_setting_ids: ["missing"] }, "unknown equality"],
      [{ ...policy, equality_key_setting_ids: [42] }, "string array"],
      [{ ...policy, equality_key_setting_ids: [] }, "requires equality"],
      [{ ...policy, grouping_basis: "declared_group_membership" }, "must not invent equality"],
    ] as const) {
      const changed = structuredClone(input);
      const changedOperations = changed.method_operations as Json[];
      changedOperations.push({ operation_id: "unrelated" });
      Object.assign(changedOperations[2]!, changedPolicy);
      expect(() => parseStudyMethodProfileLibrary({ profiles: [changed] })).toThrow(message);
    }
    const declared = structuredClone(input);
    Object.assign((declared.method_operations as Json[])[2]!, {
      grouping_basis: "declared_group_membership", equality_key_setting_ids: null,
    });
    expect(parseStudyMethodProfile(declared).method_operations).toEqual(declared.method_operations);
  });

  it("rejects undeclared operation fields at the common profile import boundary", () => {
    expect(() => parseStudyMethodProfileLibrary({ profiles: [profile({
      method_operations: [{ operation_id: "first", untyped_join_policy: "invented" }],
    })] })).toThrow("method_profile.method_operations[0] contains unknown fields: untyped_join_policy");
  });

  it("keeps valid operation order and rejects duplicate, missing, and cyclic dependencies", () => {
    const operations = [
      { operation_id: "first" },
      { operation_id: "second", depends_on: ["first"] },
    ];
    expect(parseStudyMethodProfile(profile({ method_operations: operations })).method_operations).toEqual(operations);
    expect(() => parseStudyMethodProfile(profile({ method_operations: [operations[0], operations[0]] })))
      .toThrow("method_profile.method_operations contains duplicate ID: first");
    expect(() => parseStudyMethodProfile(profile({ method_operations: [{ operation_id: "first", depends_on: ["missing"] }] })))
      .toThrow("method_profile.method_operations has unknown dependency: missing");
    expect(() => parseStudyMethodProfile(profile({ method_operations: [
      { operation_id: "first", depends_on: ["second"] },
      { operation_id: "second", depends_on: ["first"] },
    ] }))).toThrow("method_profile.method_operations contains dependency cycle at first");
  });

  it("preserves operation configuration links and rejects absent or malformed parameter keys", () => {
    const operations = [{ operation_id: "first", configuration_dependencies: ["source.threshold"] }];
    const input = profile({
      method_settings: [setting({ method_parameter_key: "source.threshold" })],
      method_operations: operations,
    });
    expect(parseStudyMethodProfile(input).method_operations).toEqual(operations);
    expect(() => parseStudyMethodProfile({ ...input, method_operations: [
      { ...operations[0], configuration_dependencies: ["missing"] },
    ] })).toThrow("method_profile.method_operations[0] has unknown configuration dependency: missing");
    expect(() => parseStudyMethodProfile({ ...input, method_operations: [
      { ...operations[0], configuration_dependencies: "source.threshold" },
    ] })).toThrow("method_profile.method_operations[0].configuration_dependencies must be a string array");
  });

  it("accepts the minimally valid profile and normalizes its empty collections", () => {
    expect(parseStudyMethodProfile(profile())).toMatchObject({
      method_profile_id: "profile:paper",
      source_work_id: "doi:paper",
      source_method_variant_id: "primary",
      method_configuration_structure: "fixed",
      method_profile_version: "v1",
      profile_implementation_status: "blocked",
      protocol_materialization_blockers: [],
      source_artifact_provenance_assertions: [],
    });
  });

  it.each([
    ["a non-object profile", "not-a-profile", "method profile must be an object"],
    [
      "an array in place of a profile",
      [],
      "method profile must be an object",
    ],
    [
      "an undeclared profile field",
      profile({ smuggled_field: 1 }),
      "method_profile contains unknown fields: smuggled_field",
    ],
    [
      "method_settings that is not an array",
      profile({ method_settings: {} }),
      "method_profile.method_settings must be an array",
    ],
    [
      "a non-object setting",
      profile({ method_settings: ["setting:1"] }),
      "method_profile.method_settings[0] must be an object",
    ],
    [
      "an undeclared setting field",
      withSetting({ smuggled_field: 1 }),
      "method_profile.method_settings[0] contains unknown fields: smuggled_field",
    ],
    [
      "an unknown implementation status",
      withSetting({ method_implementation_status: "invented" }),
      "method_profile.method_settings[0].method_implementation_status is unknown",
    ],
    [
      "an unknown execution route",
      withSetting({ method_execution_route: "invented" }),
      "method_profile.method_settings[0].method_execution_route is unknown",
    ],
    [
      "a non-string execution route",
      withSetting({ method_execution_route: 7 }),
      "method_profile.method_settings[0].method_execution_route is unknown",
    ],
    [
      "an unknown applicability status",
      withSetting({ method_applicability_status: "invented" }),
      "method_profile.method_settings[0].method_applicability_status is unknown",
    ],
    [
      "an unknown disclosure status",
      withSetting({ method_disclosure_status: "invented" }),
      "method_profile.method_settings[0].method_disclosure_status is unknown",
    ],
    [
      "a non-string method_value_json",
      withSetting({ method_value_json: 7 }),
      "method_profile.method_settings[0].method_value_json must be a JSON string",
    ],
    [
      "an unparseable source_value_json",
      withSetting({ source_value_json: "{" }),
      "method_profile.method_settings[0].source_value_json is invalid JSON",
    ],
    [
      "a partial output mapping",
      withSetting({ chronicle_output_kind: "app-csv" }),
      "method_profile.method_settings[0] output mapping must declare artifact kind, canonical column, and source position together",
    ],
    [
      "an unknown output artifact kind",
      withSetting({
        chronicle_output_kind: "diary-csv",
        chronicle_output_column: "duration_seconds",
        source_output_position: 0,
      }),
      "method_profile.method_settings[0].chronicle_output_kind is unknown",
    ],
    [
      "a blank canonical output column",
      withSetting({
        chronicle_output_kind: "app-csv",
        chronicle_output_column: "",
        source_output_position: 0,
      }),
      "method_profile.method_settings[0].chronicle_output_column must be a non-empty string",
    ],
    [
      "a negative source output position",
      withSetting({
        chronicle_output_kind: "app-csv",
        chronicle_output_column: "duration_seconds",
        source_output_position: -1,
      }),
      "method_profile.method_settings[0].source_output_position must be a non-negative integer",
    ],
    [
      "a fractional source output position",
      withSetting({
        chronicle_output_kind: "app-csv",
        chronicle_output_column: "duration_seconds",
        source_output_position: 1.5,
      }),
      "method_profile.method_settings[0].source_output_position must be a non-negative integer",
    ],
    [
      "an output mapping that carries no source field at all",
      withSetting({
        chronicle_output_kind: "app-csv",
        chronicle_output_column: "duration_seconds",
        source_output_position: 0,
        method_value_json: undefined,
      }),
      "method_profile.method_settings[0].method_value_json must contain the non-empty source output field",
    ],
    [
      "an output mapping whose source field is not a non-empty string",
      withSetting({
        chronicle_output_kind: "app-csv",
        chronicle_output_column: "duration_seconds",
        source_output_position: 0,
        method_value_json: "17",
      }),
      "method_profile.method_settings[0].method_value_json must contain the non-empty source output field",
    ],
    [
      "contract_bindings that is not an array",
      withSetting({ contract_bindings: {} }),
      "method_profile.method_settings[0].contract_bindings must be an array",
    ],
    [
      "a non-object contract binding",
      withSetting({ contract_bindings: ["slot"] }),
      "method_profile.method_settings[0].contract_bindings[0] must be an object",
    ],
    [
      "an undeclared contract binding field",
      withSetting({
        contract_bindings: [
          {
            contract_slot: "slot",
            contract_value_json: "1",
            smuggled_field: 1,
          },
        ],
      }),
      "method_profile.method_settings[0].contract_bindings[0] contains unknown fields: smuggled_field",
    ],
    [
      "duplicate setting ids",
      profile({ method_settings: [setting(), setting()] }),
      "method_profile.method_settings contains duplicate IDs",
    ],
    [
      "a setting count that disagrees with the embedded settings",
      profile({ method_setting_count: 2 }),
      "method_profile.method_setting_count does not match embedded settings",
    ],
    [
      "method_setting_ids that is not a string array",
      profile({ method_setting_ids: [1] }),
      "method_profile.method_setting_ids must be a string array",
    ],
    [
      "source_artifact_provenance_assertions that is not an array",
      profile({ source_artifact_provenance_assertions: {} }),
      "method_profile.source_artifact_provenance_assertions must be an array",
    ],
    [
      "a non-object provenance assertion",
      profile({ source_artifact_provenance_assertions: ["assertion"] }),
      "method_profile.source_artifact_provenance_assertions[0] must be an object",
    ],
    [
      "a provenance assertion for a setting outside the inventory",
      profile({
        source_artifact_provenance_assertions: [
          { method_setting_id: "setting:absent" },
        ],
      }),
      "method_profile.source_artifact_provenance_assertions[0].method_setting_id is not embedded in the profile",
    ],
    [
      "a provenance assertion for a setting that is not receipt-ready",
      profile({
        source_artifact_provenance_assertions: [
          { method_setting_id: "setting:1" },
        ],
      }),
      "method_profile.source_artifact_provenance_assertions[0].method_setting_id is not receipt-ready",
    ],
    [
      "an unknown profile implementation status",
      profile({ profile_implementation_status: "invented" }),
      "method_profile.profile_implementation_status is unknown",
    ],
    [
      "an unknown configuration structure",
      profile({ method_configuration_structure: "invented" }),
      "method_profile.method_configuration_structure is unknown",
    ],
    [
      "a configuration space whose structure disagrees with the profile",
      profile({
        method_configuration_structure: "ablation",
        method_configuration_space: configurationSpace(),
      }),
      "method_profile configuration structure does not match its configuration space",
    ],
  ])("rejects %s", (_label, candidate, message) => {
    expect(() => parseStudyMethodProfile(candidate)).toThrow(message);
  });
});

describe("protocol materialization blockers", () => {
  function withBlockers(blockers: unknown): Json {
    return profile({ protocol_materialization_blockers: blockers });
  }

  function blocker(overrides: Json = {}): Json {
    return {
      protocol_materialization_blocker_id: "blocker:1",
      protocol_materialization_id: "materialization:1",
      protocol_ontology_class: "class:1",
      protocol_profile_slot: "slot:1",
      protocol_blocker_code: "code:1",
      protocol_blocker_reason: "reason",
      protocol_object_attached: false,
      blocked_method_setting_ids: ["setting:1"],
      ...overrides,
    };
  }

  it("keeps a complete blocker row as declared", () => {
    expect(
      parseStudyMethodProfile(withBlockers([blocker()]))
        .protocol_materialization_blockers,
    ).toEqual([blocker()]);
  });

  it.each([
    [
      "a non-array blockers member",
      {},
      "method_profile.protocol_materialization_blockers must be an array",
    ],
    [
      "a non-object blocker",
      ["blocker:1"],
      "method_profile.protocol_materialization_blockers[0] must be an object",
    ],
    [
      "a non-boolean attachment claim",
      [blocker({ protocol_object_attached: "false" })],
      "method_profile.protocol_materialization_blockers[0].protocol_object_attached must be boolean",
    ],
    [
      "a blocked setting outside the profile inventory",
      [blocker({ blocked_method_setting_ids: ["setting:absent"] })],
      "method_profile.protocol_materialization_blockers[0] references a setting outside the profile inventory",
    ],
    [
      "a non-string partial protocol object",
      [blocker({ partial_protocol_object_json: {} })],
      "method_profile.protocol_materialization_blockers[0].partial_protocol_object_json must be a string",
    ],
    [
      "an unparseable partial protocol object",
      [blocker({ partial_protocol_object_json: "{" })],
      "method_profile.protocol_materialization_blockers[0].partial_protocol_object_json is invalid JSON",
    ],
  ])("rejects %s", (_label, blockers, message) => {
    expect(() => parseStudyMethodProfile(withBlockers(blockers))).toThrow(
      message,
    );
  });
});

describe("method configuration selection", () => {
  function withSelection(overrides: Json = {}, space: Json | null = configurationSpace()): Json {
    return profile({
      ...(space ? { method_configuration_space: space } : {}),
      method_configuration_selection: selection(overrides),
    });
  }

  it("keeps an exact selection that names only known levels and embedded settings", () => {
    expect(
      parseStudyMethodProfile(withSelection()).method_configuration_selection,
    ).toEqual(selection());
  });

  it("rejects a selection with no configuration space to select from", () => {
    expect(() => parseStudyMethodProfile(withSelection({}, null))).toThrow(
      "method configuration selection requires a configuration space",
    );
  });

  it.each([
    [
      "a reference to a different configuration space",
      { method_configuration_space_reference: "space:other" },
      "method configuration selection references the wrong space",
    ],
    [
      "an unknown configuration level",
      { selected_method_configuration_level_ids: ["level:absent"] },
      "method configuration selection references an unknown level",
    ],
    [
      "an effective setting outside the profile inventory",
      { effective_method_setting_ids: ["setting:absent"] },
      "method configuration selection references a setting outside the profile inventory",
    ],
    [
      "an unknown selection status",
      { method_configuration_selection_status: "invented" },
      "method configuration selection status is unknown",
    ],
    [
      "an undeclared selection field",
      { smuggled_field: 1 },
      "method_profile.method_configuration_selection contains unknown fields: smuggled_field",
    ],
  ])("rejects %s", (_label, overrides, message) => {
    expect(() => parseStudyMethodProfile(withSelection(overrides))).toThrow(
      message,
    );
  });
});

describe("study method profile library parsing", () => {
  it("wraps a bare profile in a single-profile library", () => {
    const library = parseStudyMethodProfileLibrary(profile());
    expect(library.schema_version).toBe("chronicle-method-profile-library-v1");
    expect(library.profiles).toHaveLength(1);
    expect(library.profiles[0]!.method_profile_id).toBe("profile:paper");
  });

  it("keeps a declared schema version and every distinct profile", () => {
    const library = parseStudyMethodProfileLibrary({
      schema_version: "chronicle-method-profile-library-v2",
      profiles: [profile(), profile({ method_profile_id: "profile:second" })],
    });
    expect(library.schema_version).toBe("chronicle-method-profile-library-v2");
    expect(library.profiles.map(({ method_profile_id }) => method_profile_id)).toEqual([
      "profile:paper",
      "profile:second",
    ]);
  });

  it("defaults the schema version when the library declares none", () => {
    expect(
      parseStudyMethodProfileLibrary({ profiles: [profile()] }).schema_version,
    ).toBe("chronicle-method-profile-library-v1");
  });

  it("rejects an undeclared library field", () => {
    expect(() =>
      parseStudyMethodProfileLibrary({
        profiles: [profile()],
        smuggled_field: 1,
      }),
    ).toThrow("method_profile_library contains unknown fields: smuggled_field");
  });

  it("rejects a library with no profiles", () => {
    expect(() => parseStudyMethodProfileLibrary({ profiles: [] })).toThrow(
      "method profile library contains no profiles",
    );
  });

  it("rejects a library that repeats a profile id", () => {
    expect(() =>
      parseStudyMethodProfileLibrary({ profiles: [profile(), profile()] }),
    ).toThrow("method profile library contains duplicate profile IDs");
  });
});

describe("method configuration space parsing", () => {
  function withSpace(overrides: Json): Json {
    return profile({ method_configuration_space: configurationSpace(overrides) });
  }

  function withGroup(overrides: Json): Json {
    const space = configurationSpace() as Json & { method_configuration_groups: Json[] };
    space.method_configuration_groups = [
      { ...space.method_configuration_groups[0]!, ...overrides },
    ];
    return profile({ method_configuration_space: space });
  }

  function withLevel(overrides: Json): Json {
    const space = configurationSpace() as Json & { method_configuration_groups: Json[] };
    const group = space.method_configuration_groups[0] as Json & {
      method_configuration_levels: Json[];
    };
    group.method_configuration_levels = [
      { ...group.method_configuration_levels[0]!, ...overrides },
    ];
    return profile({ method_configuration_space: space });
  }

  const combination = (overrides: Json = {}): Json => ({
    method_configuration_combination_id: "combination:1",
    method_configuration_combination_label: "Combination one",
    selected_method_configuration_level_ids: ["level:1"],
    ...overrides,
  });

  it.each([
    [
      "a configuration space that is not an object",
      profile({ method_configuration_space: "space:1" }),
      "method_profile.method_configuration_space must be an object",
    ],
    [
      "an undeclared configuration space field",
      withSpace({ smuggled_field: 1 }),
      "method_profile.method_configuration_space contains unknown fields: smuggled_field",
    ],
    [
      "a configuration space structure outside the vocabulary",
      withSpace({ method_configuration_structure: "invented" }),
      "method_profile.method_configuration_space has an unknown structure",
    ],
    [
      "groups that are not an array",
      withSpace({ method_configuration_groups: {} }),
      "method configuration groups/combinations must be arrays",
    ],
    [
      "combinations that are not an array",
      withSpace({ allowed_method_combinations: {} }),
      "method configuration groups/combinations must be arrays",
    ],
    [
      "an invariant setting outside the profile inventory",
      withSpace({ invariant_method_setting_ids: ["setting:absent"] }),
      "method configuration space references a setting outside the profile inventory",
    ],
    [
      "a group that is not an object",
      withSpace({ method_configuration_groups: ["group:1"] }),
      "method_profile.method_configuration_space.method_configuration_groups[0] must be an object",
    ],
    [
      "an undeclared group field",
      withGroup({ smuggled_field: 1 }),
      "method_profile.method_configuration_space.method_configuration_groups[0] contains unknown fields: smuggled_field",
    ],
    [
      "levels that are not an array",
      withGroup({ method_configuration_levels: {} }),
      "method_profile.method_configuration_space.method_configuration_groups[0].method_configuration_levels must be an array",
    ],
    [
      "a level that is not an object",
      withGroup({ method_configuration_levels: ["level:1"] }),
      "method_profile.method_configuration_space.method_configuration_groups[0].method_configuration_levels[0] must be an object",
    ],
    [
      "an undeclared level field",
      withLevel({ smuggled_field: 1 }),
      "method_profile.method_configuration_space.method_configuration_groups[0].method_configuration_levels[0] contains unknown fields: smuggled_field",
    ],
    [
      "a level with no label",
      withLevel({ method_configuration_level_label: "" }),
      "method_profile.method_configuration_space.method_configuration_groups[0].method_configuration_levels[0].method_configuration_level_label must be a non-empty string",
    ],
    [
      "a level setting list that is not a string array",
      withLevel({ included_method_setting_ids: [7] }),
      "method_profile.method_configuration_space.method_configuration_groups[0].method_configuration_levels[0].included_method_setting_ids must be a string array",
    ],
    [
      "a level setting outside the profile inventory",
      withLevel({ excluded_method_setting_ids: ["setting:absent"] }),
      "method configuration space references a setting outside the profile inventory",
    ],
    [
      "a group with no selection semantics",
      withGroup({ method_selection_semantics: "" }),
      "method_profile.method_configuration_space.method_configuration_groups[0].method_selection_semantics must be a non-empty string",
    ],
    [
      "a group with no cross-product policy",
      withGroup({ method_cross_product_policy: "" }),
      "method_profile.method_configuration_space.method_configuration_groups[0].method_cross_product_policy must be a non-empty string",
    ],
    [
      "a combination that is not an object",
      withSpace({ allowed_method_combinations: ["combination:1"] }),
      "method_profile.method_configuration_space.allowed_method_combinations[0] must be an object",
    ],
    [
      "an undeclared combination field",
      withSpace({ allowed_method_combinations: [combination({ smuggled_field: 1 })] }),
      "method_profile.method_configuration_space.allowed_method_combinations[0] contains unknown fields: smuggled_field",
    ],
    [
      "a combination with no label",
      withSpace({
        allowed_method_combinations: [
          combination({ method_configuration_combination_label: "" }),
        ],
      }),
      "method_profile.method_configuration_space.allowed_method_combinations[0].method_configuration_combination_label must be a non-empty string",
    ],
    [
      "a combination that repeats a level",
      withSpace({
        allowed_method_combinations: [
          combination({
            selected_method_configuration_level_ids: ["level:1", "level:1"],
          }),
        ],
      }),
      "method_profile.method_configuration_space.allowed_method_combinations[0] contains duplicate configuration levels",
    ],
    [
      "a combination naming an unknown level",
      withSpace({
        allowed_method_combinations: [
          combination({ selected_method_configuration_level_ids: ["level:absent"] }),
        ],
      }),
      "method_profile.method_configuration_space.allowed_method_combinations[0] references an unknown configuration level",
    ],
    [
      "two combinations under one id",
      withSpace({ allowed_method_combinations: [combination(), combination()] }),
      "duplicate method configuration combination: combination:1",
    ],
  ])("rejects %s", (_label, candidate, message) => {
    expect(() => parseStudyMethodProfile(candidate)).toThrow(message);
  });

  it("rejects two groups registered under one id", () => {
    const space = configurationSpace() as Json & { method_configuration_groups: Json[] };
    const group = space.method_configuration_groups[0]!;
    space.method_configuration_groups = [
      group,
      {
        ...(group),
        method_configuration_levels: [
          {
            method_configuration_level_id: "level:2",
            method_configuration_level_label: "Level two",
            included_method_setting_ids: ["setting:1"],
          },
        ],
      },
    ];
    expect(() =>
      parseStudyMethodProfile(profile({ method_configuration_space: space })),
    ).toThrow("duplicate method configuration group: group:1");
  });

  it("rejects two levels registered under one id", () => {
    const space = configurationSpace() as Json & { method_configuration_groups: Json[] };
    const group = space.method_configuration_groups[0] as Json & {
      method_configuration_levels: Json[];
    };
    group.method_configuration_levels = [
      group.method_configuration_levels[0]!,
      { ...(group.method_configuration_levels[0] as Json) },
    ];
    expect(() =>
      parseStudyMethodProfile(profile({ method_configuration_space: space })),
    ).toThrow("duplicate method configuration level: level:1");
  });

  it("keeps a combination whose levels the space declares", () => {
    const parsed = parseStudyMethodProfile(
      withSpace({ allowed_method_combinations: [combination()] }),
    );
    expect(
      (parsed.method_configuration_space as Json | undefined)
        ?.allowed_method_combinations,
    ).toEqual([combination()]);
  });
});

/**
 * The closed source-artifact provenance registry
 * (`src/generated/source-artifact-provenance-registry.json`) is the only shape
 * a documentary assertion may take, and one setting may claim it only once.
 */
describe("source artifact provenance assertions", () => {
  const SETTING_ID = "method-setting-0d4c2d71ec4c6dea11ac19b0";

  function registeredAssertion(): Json {
    const registered = sourceArtifactProvenanceAssertionForSetting(SETTING_ID)!;
    return {
      source_artifact_provenance_id: String(
        registered.source_artifact_provenance.source_artifact_provenance_id,
      ),
      method_setting_id: registered.method_setting_id,
      source_work_id: registered.source_work_id,
      source_extraction_id: registered.source_extraction_id,
      source_value_sha256: registered.source_value_sha256,
      source_artifact_provenance_object_json: canonicalJson(
        registered.source_artifact_provenance,
      ),
      source_artifact_provenance_object_digest:
        registered.source_artifact_provenance_object_digest,
      provenance_keys: registered.provenance_keys,
      candidate_status: registered.candidate_status,
      conformance_fixture_id: registered.conformance_fixture_id,
      conformance_result_digest: registered.conformance_result_digest,
      execution_eligibility: "documentary_only",
    };
  }

  function profileWithAssertions(assertions: Json[]): Json {
    const registered = sourceArtifactProvenanceAssertionForSetting(SETTING_ID)!;
    return profile({
      source_work_id: registered.source_work_id,
      method_settings: [
        setting({
          method_setting_id: SETTING_ID,
          source_extraction_id: registered.source_extraction_id,
          method_setting_role: "provenance",
        }),
      ],
      source_artifact_provenance_assertions: assertions,
    });
  }

  it("accepts the registry's own assertion for an embedded setting", () => {
    expect(
      parseStudyMethodProfile(profileWithAssertions([registeredAssertion()]))
        .source_artifact_provenance_assertions,
    ).toHaveLength(1);
  });

  it("rejects the same setting asserted twice", () => {
    expect(() =>
      parseStudyMethodProfile(
        profileWithAssertions([registeredAssertion(), registeredAssertion()]),
      ),
    ).toThrow(
      "method_profile.source_artifact_provenance_assertions contains duplicate setting IDs",
    );
  });

  it("rejects an assertion that disagrees with the registry row", () => {
    expect(() =>
      parseStudyMethodProfile(
        profileWithAssertions([
          { ...registeredAssertion(), candidate_status: "draft" },
        ]),
      ),
    ).toThrow(
      "method_profile.source_artifact_provenance_assertions[0] does not exactly match the closed registry",
    );
  });
});
