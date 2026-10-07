import { describe, expect, it } from "vitest";

import {
  compileNativeMethodProfile,
  summarizeMethodConfigurationGroups,
  compileNativeMethodProfileCampaign,
  enumerateMethodConfigurations,
  parseStudyMethodProfile,
  selectMethodConfiguration,
  type StudyMethodProfile,
} from "@/lib/methodProfiles";

/**
 * `compileNativeMethodProfile` turns an adjudicated study method profile into a
 * browser option patch plus a receipt, and refuses with a typed blocker for
 * every rule it cannot satisfy exactly. The option keys it accepts come from
 * `BROWSER_PROCESSING_OPTION_KEYS` in the generated LinkML contract
 * (`web/schema/chronicle-local-contract.linkml.yaml`), and the sanitizer it
 * checks its own patch against is `sanitizeOptions`. Every case below starts
 * from one minimal profile and changes exactly one thing, so the asserted
 * blocker names the rule the change reaches.
 */
type Json = Record<string, unknown>;

const FIXTURE_ID = "fixture.compilation.v1";
const RESULT_DIGEST = `sha256:${"b".repeat(64)}`;

function setting(overrides: Json = {}): Json {
  return {
    method_setting_id: "setting:1",
    source_extraction_id: "extraction:1",
    method_setting_role: "provenance",
    method_applicability_status: "applicable",
    method_disclosure_status: "declared",
    method_implementation_status: "native",
    method_execution_route: "native_option_binding",
    conformance_fixture_id: FIXTURE_ID,
    conformance_result_digest: RESULT_DIGEST,
    contract_bindings: [
      { contract_slot: "minimum_usage_duration", contract_value_json: "60" },
    ],
    ...overrides,
  };
}

function profile(overrides: Json = {}): StudyMethodProfile {
  return parseStudyMethodProfile({
    method_profile_id: "profile:paper",
    source_work_id: "doi:paper",
    source_method_variant_id: "primary",
    method_configuration_structure: "fixed",
    method_profile_version: "v1",
    profile_implementation_status: "executable",
    method_settings: [setting()],
    ...overrides,
  });
}

function withSettings(settings: Json[], overrides: Json = {}): StudyMethodProfile {
  return profile({ method_settings: settings, ...overrides });
}

type Compilation = ReturnType<typeof compileNativeMethodProfile>;

function expectCompiled(compiled: Compilation): Extract<Compilation, { ok: true }> {
  if (!compiled.ok) {
    throw new Error(`expected a compiled plan, got ${JSON.stringify(compiled.blockers)}`);
  }
  return compiled;
}

function blockersOf(compiled: Compilation) {
  return compiled.ok ? [] : compiled.blockers;
}

describe("compileNativeMethodProfile native option bindings", () => {
  it("compiles one native setting into an option patch and a receipt binding", () => {
    const compiled = expectCompiled(compileNativeMethodProfile(profile()));
    expect(compiled.options.minimumUsageDuration).toBe(60);
    expect(compiled.receipt.bindings).toEqual([
      {
        settingId: "setting:1",
        slot: "minimum_usage_duration",
        value: 60,
        conformanceFixtureId: FIXTURE_ID,
        conformanceResultDigest: RESULT_DIGEST,
      },
    ]);
    expect(compiled.receipt.settingIds).toEqual(["setting:1"]);
    expect(compiled.readiness.disposition).toBe("fully_reproduced");
  });

  it.each([
    [
      "a route that is not a native option binding",
      setting({ method_execution_route: "native_operator_parameter" }),
      { settingId: "setting:1", code: "invalid_route", detail: "native_operator_parameter" },
    ],
    [
      "no declared route at all",
      setting({ method_execution_route: undefined }),
      { settingId: "setting:1", code: "invalid_route", detail: "missing" },
    ],
    [
      "no contract binding",
      setting({ contract_bindings: [] }),
      {
        settingId: "setting:1",
        code: "missing_binding",
        detail: "native setting has no exact contract binding",
      },
    ],
    [
      "no conformance fixture id",
      setting({ conformance_fixture_id: undefined }),
      {
        settingId: "setting:1",
        code: "missing_conformance",
        detail: "exact source-derived fixture result is required",
      },
    ],
    [
      "a conformance digest that is not a sha256",
      setting({ conformance_result_digest: "sha256:not-a-digest" }),
      {
        settingId: "setting:1",
        code: "missing_conformance",
        detail: "exact source-derived fixture result is required",
      },
    ],
    [
      "a contract slot the browser contract does not declare",
      setting({
        contract_bindings: [
          { contract_slot: "invented_slot", contract_value_json: "60" },
        ],
      }),
      { settingId: "setting:1", code: "unknown_slot", detail: "invented_slot" },
    ],
    [
      "a contract value that is not JSON",
      setting({
        contract_bindings: [
          { contract_slot: "minimum_usage_duration", contract_value_json: "sixty" },
        ],
      }),
      { settingId: "setting:1", code: "invalid_json", detail: "sixty" },
    ],
  ])("blocks %s", (_label, changed, blocker) => {
    const compiled = compileNativeMethodProfile(withSettings([changed]));
    expect(compiled.ok).toBe(false);
    expect(blockersOf(compiled)).toContainEqual(blocker);
  });

  it("blocks two settings that bind the same slot to different values", () => {
    const compiled = compileNativeMethodProfile(
      withSettings([
        setting(),
        setting({
          method_setting_id: "setting:2",
          contract_bindings: [
            { contract_slot: "minimum_usage_duration", contract_value_json: "120" },
          ],
        }),
      ]),
    );
    expect(compiled.ok).toBe(false);
    expect(blockersOf(compiled)).toContainEqual({
      settingId: "setting:2",
      code: "conflicting_binding",
      detail: "minimumUsageDuration",
    });
  });

  it("accepts two settings that bind the same slot to the same value", () => {
    const compiled = expectCompiled(compileNativeMethodProfile(
      withSettings([setting(), setting({ method_setting_id: "setting:2" })]),
    ));
    expect(compiled.receipt.settingIds).toEqual(["setting:1", "setting:2"]);
  });

  it("blocks a bound value the option sanitizer refuses to keep", () => {
    // `sanitizeOptions` clamps a negative duration floor, so the compiled
    // options no longer carry the source's value and the plan is not exact.
    const compiled = compileNativeMethodProfile(
      withSettings([
        setting({
          contract_bindings: [
            { contract_slot: "minimum_usage_duration", contract_value_json: "-5" },
          ],
        }),
      ]),
    );
    expect(compiled.ok).toBe(false);
    expect(blockersOf(compiled)).toContainEqual({
      settingId: "setting:1",
      code: "invalid_value",
      detail: "minimumUsageDuration",
    });
  });

  it("blocks a profile whose settings produce no executable binding at all", () => {
    const compiled = compileNativeMethodProfile(
      withSettings([
        setting({
          method_implementation_status: "unresolved",
          method_execution_route: "receipt_conformance",
        }),
      ]),
    );
    expect(compiled.ok).toBe(false);
    expect(blockersOf(compiled)).toContainEqual({
      settingId: "setting:1",
      code: "not_native",
      detail: "unresolved",
    });
    expect(compiled.readiness.evidence.status).toBe("blocked");
  });

  it("blocks an empty native plan when every setting is out of the selection", () => {
    const compiled = compileNativeMethodProfile(
      withSettings([setting({ method_applicability_status: "not_applicable" })]),
    );
    expect(compiled.ok).toBe(false);
    expect(blockersOf(compiled)).toContainEqual({
      settingId: "profile:paper",
      code: "empty_native_plan",
      detail: "the selected profile has no native preprocessing or input binding",
    });
  });

  it.each([
    [
      "a refused signal",
      { method_implementation_status: "refused_missing_signal" },
      "refused_missing_signal",
      "input",
    ],
    [
      "an external executor with no registered configuration receipt",
      {
        method_implementation_status: "unresolved",
        method_execution_route: "external_named_executor",
      },
      "unresolved",
      "downstream",
    ],
    [
      "a non-native operator parameter",
      {
        method_implementation_status: "unresolved",
        method_execution_route: "native_operator_parameter",
      },
      "unresolved",
      "preprocessing",
    ],
  ])("routes the not_native blocker for %s to its own readiness dimension", (
    _label,
    overrides,
    detail,
    dimension,
  ) => {
    const compiled = compileNativeMethodProfile(withSettings([setting(overrides)]));
    expect(compiled.ok).toBe(false);
    expect(
      compiled.readiness[dimension as "input" | "downstream" | "preprocessing"].blockers,
    ).toContainEqual({ settingId: "setting:1", code: "not_native", detail });
  });

  it("records the profile's own blocked implementation status as a legacy blocker", () => {
    const compiled = compileNativeMethodProfile(
      profile({ profile_implementation_status: "specification_only" }),
    );
    expect(compiled.legacyBlockers).toContainEqual({
      settingId: "profile:paper",
      code: "profile_blocked",
      detail: "specification_only",
    });
  });

  it("blocks a setting a protocol materialization blocker names", () => {
    const compiled = compileNativeMethodProfile(
      profile({
        protocol_materialization_blockers: [
          {
            protocol_materialization_blocker_id: "blocker:1",
            protocol_materialization_id: "materialization:1",
            protocol_ontology_class: "DiaryProtocol",
            protocol_profile_slot: "diary_protocols",
            protocol_object_attached: false,
            blocked_method_setting_ids: ["setting:1"],
            protocol_blocker_code: "missing_instrument",
            protocol_blocker_field: "diary_schedule",
            protocol_blocker_reason: "the source never published the schedule",
          },
        ],
      }),
    );
    expect(compiled.ok).toBe(false);
    expect(blockersOf(compiled)).toContainEqual({
      settingId: "setting:1",
      code: "missing_conformance",
      detail: "missing_instrument:diary_schedule: the source never published the schedule",
    });
  });

  it("blocks a typed profile section the closed registry does not carry", () => {
    const compiled = compileNativeMethodProfile(
      profile({
        duration_policies: [
          { duration_policy_id: "policy:1", duration_floor_seconds: 60 },
        ],
      }),
    );
    expect(compiled.ok).toBe(false);
    expect(blockersOf(compiled)).toContainEqual({
      settingId: "profile:paper",
      code: "uncompiled_profile_section",
      detail: "duration_policies",
    });
  });

  it("ignores a typed section whose every entry is outside the effective selection", () => {
    const compiled = compileNativeMethodProfile(
      profile({
        duration_policies: [
          {
            duration_policy_id: "policy:1",
            method_settings: [{ method_setting_id: "setting:absent" }],
          },
        ],
      }),
    );
    expect(compiled.ok).toBe(true);
    expect(blockersOf(compiled)).toEqual([]);
  });
});

describe("selectMethodConfiguration", () => {
  const level = (id: string, overrides: Json = {}): Json => ({
    method_configuration_level_id: id,
    method_configuration_level_label: id,
    included_method_setting_ids: ["setting:1"],
    ...overrides,
  });
  const group = (id: string, levels: Json[], overrides: Json = {}): Json => ({
    method_configuration_group_id: id,
    method_configuration_group_kind: "axis",
    method_selection_semantics: "independently_selectable",
    method_cross_product_policy: "not_enumerated_no_cartesian_product",
    method_configuration_levels: levels,
    ...overrides,
  });
  const space = (groups: Json[], overrides: Json = {}): Json => ({
    method_configuration_space_id: "space:1",
    method_configuration_structure: "fixed",
    method_configuration_groups: groups,
    ...overrides,
  });

  const twoLevelProfile = (overrides: Json = {}) =>
    withSettings(
      [setting(), setting({ method_setting_id: "setting:2" })],
      {
        method_configuration_space: space([
          group("group:1", [
            level("level:a"),
            level("level:b", { included_method_setting_ids: ["setting:2"] }),
          ]),
        ]),
        ...overrides,
      },
    );

  it("returns the whole applicable inventory when the profile declares no configuration space", () => {
    expect(selectMethodConfiguration(profile(), {})).toEqual({
      ok: true,
      selection: {
        selectionId: "primary",
        selectedLevelIds: [],
        effectiveSettingIds: ["setting:1"],
      },
    });
  });

  it("blocks a requested group the space does not declare", () => {
    expect(
      selectMethodConfiguration(twoLevelProfile(), {
        "group:absent": "level:a",
        "group:1": "level:a",
      }),
    ).toEqual({
      ok: false,
      blockers: [{ groupId: "group:absent", code: "unknown_group", detail: "level:a" }],
    });
  });

  it("blocks a requested level the group does not declare", () => {
    expect(selectMethodConfiguration(twoLevelProfile(), { "group:1": "level:z" })).toEqual({
      ok: false,
      blockers: [{ groupId: "group:1", code: "unknown_level", detail: "level:z" }],
    });
  });

  it("blocks a multi-level group with nothing chosen", () => {
    expect(selectMethodConfiguration(twoLevelProfile(), {})).toEqual({
      ok: false,
      blockers: [{
        groupId: "group:1",
        code: "missing_level",
        detail: "choose one source-declared level",
      }],
    });
  });

  it("keeps only the chosen level's settings and drops the alternative's", () => {
    expect(selectMethodConfiguration(twoLevelProfile(), { "group:1": "level:a" })).toEqual({
      ok: true,
      selection: {
        selectionId: "space:1::group:1=level:a",
        selectedLevelIds: ["level:a"],
        effectiveSettingIds: ["setting:1"],
      },
    });
  });

  it("removes a setting the chosen level excludes even when the space declares it invariant", () => {
    const selected = selectMethodConfiguration(
      withSettings([setting(), setting({ method_setting_id: "setting:2" })], {
        method_configuration_space: space(
          [group("group:1", [
            level("level:a", {
              included_method_setting_ids: [],
              excluded_method_setting_ids: ["setting:2"],
            }),
            level("level:b"),
          ])],
          { invariant_method_setting_ids: ["setting:1", "setting:2"] },
        ),
      }),
      { "group:1": "level:a" },
    );
    expect(selected).toMatchObject({
      ok: true,
      selection: { effectiveSettingIds: ["setting:1"] },
    });
  });

  it("blocks two chosen axes the source never enumerated jointly", () => {
    const selected = selectMethodConfiguration(
      withSettings([setting(), setting({ method_setting_id: "setting:2" })], {
        method_configuration_space: space([
          group("group:1", [level("level:a"), level("level:b")], {
            method_selection_semantics: "mutually_exclusive",
          }),
          group("group:2", [
            level("level:c", { included_method_setting_ids: ["setting:2"] }),
            level("level:d", { included_method_setting_ids: ["setting:2"] }),
          ], { method_selection_semantics: "mutually_exclusive" }),
        ]),
      }),
      { "group:1": "level:a", "group:2": "level:c" },
    );
    expect(selected).toEqual({
      ok: false,
      blockers: [{
        groupId: "space:1",
        code: "cross_group_product_not_enumerated",
        detail: "the source did not enumerate an allowed combination of these levels",
      }],
    });
  });

  it("blocks a level pair outside the source's enumerated combinations", () => {
    const withCombinations = withSettings(
      [setting(), setting({ method_setting_id: "setting:2" })],
      {
        method_configuration_space: space(
          [
            group("group:1", [level("level:a"), level("level:b")], {
              method_selection_semantics: "mutually_exclusive",
            }),
            group("group:2", [
              level("level:c", { included_method_setting_ids: ["setting:2"] }),
              level("level:d", { included_method_setting_ids: ["setting:2"] }),
            ], { method_selection_semantics: "mutually_exclusive" }),
          ],
          {
            allowed_method_combinations: [
              {
                method_configuration_combination_id: "combination:1",
                method_configuration_combination_label: "combination:1",
                selected_method_configuration_level_ids: ["level:a", "level:c"],
              },
            ],
          },
        ),
      },
    );
    expect(
      selectMethodConfiguration(withCombinations, { "group:1": "level:b", "group:2": "level:d" }),
    ).toEqual({
      ok: false,
      blockers: [{
        groupId: "space:1",
        code: "combination_not_enumerated",
        detail: "the selected source levels are not an enumerated source combination",
      }],
    });
    expect(
      selectMethodConfiguration(withCombinations, { "group:1": "level:a", "group:2": "level:c" }),
    ).toMatchObject({
      ok: true,
      selection: {
        selectedCombinationId: "combination:1",
        selectedLevelIds: ["level:a", "level:c"],
      },
    });
  });

  it("keeps a space-level documentary setting that no level scopes", () => {
    // Documentary and unresolved settings declared on the space belong to every
    // selection unless a level claims them, which is what the level-scoped
    // filter in selectMethodConfiguration exists to decide.
    const selected = selectMethodConfiguration(
      withSettings([setting(), setting({ method_setting_id: "setting:2" })], {
        method_configuration_space: space(
          [group("group:1", [level("level:a"), level("level:b")])],
          {
            documentary_method_setting_ids: ["setting:2"],
            unresolved_method_setting_ids: [],
          },
        ),
      }),
      { "group:1": "level:a" },
    );
    expect(selected).toMatchObject({
      ok: true,
      selection: { effectiveSettingIds: ["setting:1", "setting:2"] },
    });
  });

  it("drops a space-level documentary setting that the chosen level does not include", () => {
    const selected = selectMethodConfiguration(
      withSettings([setting(), setting({ method_setting_id: "setting:2" })], {
        method_configuration_space: space(
          [group("group:1", [
            level("level:a"),
            level("level:b", { documentary_method_setting_ids: ["setting:2"] }),
          ])],
          { documentary_method_setting_ids: ["setting:2"] },
        ),
      }),
      { "group:1": "level:a" },
    );
    expect(selected).toMatchObject({
      ok: true,
      selection: { effectiveSettingIds: ["setting:1"] },
    });
  });

  it("adds the settings the enumerated combination itself includes", () => {
    const selected = selectMethodConfiguration(
      withSettings([setting(), setting({ method_setting_id: "setting:2" })], {
        method_configuration_space: space(
          [
            group("group:1", [level("level:a"), level("level:b")], {
              method_selection_semantics: "mutually_exclusive",
            }),
            group("group:2", [level("level:c"), level("level:d")], {
              method_selection_semantics: "mutually_exclusive",
            }),
          ],
          {
            allowed_method_combinations: [{
              method_configuration_combination_id: "combination:1",
              method_configuration_combination_label: "combination:1",
              selected_method_configuration_level_ids: ["level:a", "level:c"],
              included_method_setting_ids: ["setting:2"],
            }],
          },
        ),
      }),
      { "group:1": "level:a", "group:2": "level:c" },
    );
    expect(selected).toMatchObject({
      ok: true,
      selection: {
        selectedCombinationId: "combination:1",
        effectiveSettingIds: ["setting:1", "setting:2"],
      },
    });
  });

  it("allows one axis at a time when both axes forbid a Cartesian product", () => {
    const axisIsolated = withSettings(
      [setting(), setting({ method_setting_id: "setting:2" })],
      {
        method_configuration_space: space([
          group("group:1", [level("level:a"), level("level:b")]),
          group("group:2", [
            level("level:c", { included_method_setting_ids: ["setting:2"] }),
            level("level:d", { included_method_setting_ids: ["setting:2"] }),
          ]),
        ]),
      },
    );
    expect(selectMethodConfiguration(axisIsolated, { "group:1": "level:a" })).toMatchObject({
      ok: true,
      selection: { selectedLevelIds: ["level:a"], effectiveSettingIds: ["setting:1"] },
    });
    expect(selectMethodConfiguration(axisIsolated, {})).toMatchObject({ ok: false });
  });
});

describe("enumerateMethodConfigurations", () => {
  const level = (id: string, settingId: string): Json => ({
    method_configuration_level_id: id,
    method_configuration_level_label: id,
    included_method_setting_ids: [settingId],
  });
  const group = (id: string, levels: Json[], overrides: Json = {}): Json => ({
    method_configuration_group_id: id,
    method_configuration_group_kind: "axis",
    method_selection_semantics: "independently_selectable",
    method_cross_product_policy: "not_enumerated_no_cartesian_product",
    method_configuration_levels: levels,
    ...overrides,
  });

  it("returns the single unconfigured selection when there is no configuration space", () => {
    expect(enumerateMethodConfigurations(profile())).toEqual({
      ok: true,
      selections: [{
        selectionId: "primary",
        selectedLevelIds: [],
        effectiveSettingIds: ["setting:1"],
      }],
    });
  });

  it("enumerates one selection per level of the single selectable axis", () => {
    const enumeration = enumerateMethodConfigurations(
      withSettings([setting(), setting({ method_setting_id: "setting:2" })], {
        method_configuration_space: {
          method_configuration_space_id: "space:1",
          method_configuration_structure: "fixed",
          method_configuration_groups: [
            group("group:1", [
              level("level:a", "setting:1"),
              level("level:b", "setting:2"),
            ]),
          ],
        },
      }),
    );
    expect(enumeration).toMatchObject({ ok: true });
    expect(enumeration.ok && enumeration.selections.map((one) => one.selectedLevelIds)).toEqual([
      ["level:a"],
      ["level:b"],
    ]);
  });

  it("enumerates one selection per enumerated combination", () => {
    const enumeration = enumerateMethodConfigurations(
      withSettings([setting(), setting({ method_setting_id: "setting:2" })], {
        method_configuration_space: {
          method_configuration_space_id: "space:1",
          method_configuration_structure: "fixed",
          method_configuration_groups: [
            group("group:1", [level("level:a", "setting:1"), level("level:b", "setting:1")], {
              method_selection_semantics: "mutually_exclusive",
            }),
            group("group:2", [level("level:c", "setting:2"), level("level:d", "setting:2")], {
              method_selection_semantics: "mutually_exclusive",
            }),
          ],
          allowed_method_combinations: [
            {
              method_configuration_combination_id: "combination:1",
              method_configuration_combination_label: "combination:1",
              selected_method_configuration_level_ids: ["level:a", "level:c"],
            },
            {
              method_configuration_combination_id: "combination:2",
              method_configuration_combination_label: "combination:2",
              selected_method_configuration_level_ids: ["level:b", "level:d"],
            },
          ],
        },
      }),
    );
    expect(enumeration.ok && enumeration.selections.map((one) => one.selectedCombinationId)).toEqual([
      "combination:1",
      "combination:2",
    ]);
  });

  it("blocks an enumerated combination that leaves another axis unchosen", () => {
    expect(
      enumerateMethodConfigurations(
        withSettings([setting(), setting({ method_setting_id: "setting:2" })], {
          method_configuration_space: {
            method_configuration_space_id: "space:1",
            method_configuration_structure: "fixed",
            method_configuration_groups: [
              group("group:1", [level("level:a", "setting:1"), level("level:b", "setting:1")], {
                method_selection_semantics: "mutually_exclusive",
              }),
              group("group:2", [level("level:c", "setting:2"), level("level:d", "setting:2")], {
                method_selection_semantics: "mutually_exclusive",
              }),
            ],
            allowed_method_combinations: [{
              method_configuration_combination_id: "combination:1",
              method_configuration_combination_label: "combination:1",
              selected_method_configuration_level_ids: ["level:a"],
            }],
          },
        }),
      ),
    ).toEqual({
      ok: false,
      blockers: [{ groupId: "group:2", code: "missing_level", detail: "choose one source-declared level" }],
    });
  });

  it("refuses a space whose combinations enumerate the same selection twice", () => {
    expect(() =>
      enumerateMethodConfigurations(
        withSettings([setting(), setting({ method_setting_id: "setting:2" })], {
          method_configuration_space: {
            method_configuration_space_id: "space:1",
            method_configuration_structure: "fixed",
            method_configuration_groups: [
              group("group:1", [level("level:a", "setting:1"), level("level:b", "setting:2")], {
                method_selection_semantics: "mutually_exclusive",
              }),
            ],
            allowed_method_combinations: [
              {
                method_configuration_combination_id: "combination:1",
                method_configuration_combination_label: "combination:1",
                selected_method_configuration_level_ids: ["level:a"],
              },
              {
                method_configuration_combination_id: "combination:2",
                method_configuration_combination_label: "combination:2",
                selected_method_configuration_level_ids: ["level:a"],
              },
            ],
          },
        }),
      ),
    ).toThrow("doi:paper: duplicate enumerated method configuration");
  });

  it("enumerates one unconfigured selection when no group needs a choice", () => {
    // `requiresConfigurationSelection` is false for a single-level group, so a
    // space made only of those enumerates exactly one selection.
    expect(
      enumerateMethodConfigurations(
        withSettings([setting()], {
          method_configuration_space: {
            method_configuration_space_id: "space:1",
            method_configuration_structure: "fixed",
            method_configuration_groups: [
              group("group:1", [level("level:a", "setting:1")]),
            ],
          },
        }),
      ),
    ).toEqual({
      ok: true,
      selections: [{
        selectionId: "space:1::group:1=level:a",
        selectedLevelIds: ["level:a"],
        effectiveSettingIds: ["setting:1"],
      }],
    });
  });

  it("refuses a combination that names two levels of the same axis", () => {
    expect(
      enumerateMethodConfigurations(
        withSettings([setting()], {
          method_configuration_space: {
            method_configuration_space_id: "space:1",
            method_configuration_structure: "fixed",
            method_configuration_groups: [
              group("group:1", [level("level:a", "setting:1"), level("level:b", "setting:1")], {
                method_selection_semantics: "mutually_exclusive",
              }),
            ],
            allowed_method_combinations: [
              {
                method_configuration_combination_id: "combination:1",
                method_configuration_combination_label: "combination:1",
                selected_method_configuration_level_ids: ["level:a", "level:b"],
              },
            ],
          },
        }),
      ),
    ).toEqual({
      ok: false,
      blockers: [{
        groupId: "space:1",
        code: "combination_not_enumerated",
        detail: "invalid source combination combination:1",
      }],
    });
  });

  it("refuses multiple axes that neither enumerate combinations nor permit isolated runs", () => {
    expect(
      enumerateMethodConfigurations(
        withSettings([setting(), setting({ method_setting_id: "setting:2" })], {
          method_configuration_space: {
            method_configuration_space_id: "space:1",
            method_configuration_structure: "fixed",
            method_configuration_groups: [
              group("group:1", [level("level:a", "setting:1"), level("level:b", "setting:1")], {
                method_selection_semantics: "mutually_exclusive",
              }),
              group("group:2", [level("level:c", "setting:2"), level("level:d", "setting:2")], {
                method_selection_semantics: "mutually_exclusive",
              }),
            ],
          },
        }),
      ),
    ).toEqual({
      ok: false,
      blockers: [{
        groupId: "space:1",
        code: "cross_group_product_not_enumerated",
        detail: "multiple source axes exist, but the source did not declare joint combinations",
      }],
    });
  });
});

describe("profile sections outside the compiled plan", () => {
  const twoLevelSpace = {
    method_configuration_space_id: "space:1",
    method_configuration_structure: "fixed",
    method_configuration_groups: [{
      method_configuration_group_id: "group:1",
      method_configuration_group_kind: "axis",
      method_selection_semantics: "mutually_exclusive",
      method_cross_product_policy: "not_enumerated_no_cartesian_product",
      method_configuration_levels: [
        {
          method_configuration_level_id: "level:a",
          method_configuration_level_label: "a",
          included_method_setting_ids: ["setting:1"],
          excluded_method_setting_ids: ["setting:2"],
        },
        {
          method_configuration_level_id: "level:b",
          method_configuration_level_label: "b",
          included_method_setting_ids: ["setting:2"],
          excluded_method_setting_ids: ["setting:1"],
        },
      ],
    }],
  };
  const levelASelection = {
    selectionId: "space:1::group:1=level:a",
    selectedLevelIds: ["level:a"],
    effectiveSettingIds: ["setting:1"],
  };
  const twoSettings = [
    setting({ source_extraction_id: "extraction-a" }),
    setting({ method_setting_id: "setting:2", source_extraction_id: "extraction-b" }),
  ];

  it("ignores a protocol materialization blocker aimed outside the selected partition", () => {
    const compiled = compileNativeMethodProfile(
      withSettings(twoSettings, {
        method_configuration_space: twoLevelSpace,
        protocol_materialization_blockers: [{
          protocol_materialization_blocker_id: "blocker:1",
          protocol_materialization_id: "materialization:1",
          protocol_ontology_class: "MeasurementReleaseProfile",
          protocol_profile_slot: "design",
          protocol_blocker_code: "unmapped_parameter_semantics",
          protocol_blocker_field: "design",
          protocol_blocker_reason: "the candidate has no semantic slot",
          protocol_object_attached: false,
          blocked_method_setting_ids: ["setting:2"],
        }],
      }),
      undefined,
      levelASelection,
    );
    expect(blockersOf(compiled)).toEqual([]);
  });

  it("ignores a section whose only entry belongs to another extraction", () => {
    const compiled = compileNativeMethodProfile(
      withSettings(twoSettings, {
        method_configuration_space: twoLevelSpace,
        method_operations: [{
          operation_id: "operation:extraction-b",
        }],
      }),
      undefined,
      levelASelection,
    );
    expect(blockersOf(compiled)).toEqual([]);
  });

  it("refuses a section entry that names no extraction the registry can reconcile", () => {
    const compiled = compileNativeMethodProfile(
      withSettings(twoSettings, {
        method_configuration_space: twoLevelSpace,
        method_operations: [{ operation_id: "operation-1" }],
      }),
      undefined,
      levelASelection,
    );
    expect(blockersOf(compiled)).toContainEqual({
      settingId: "profile:paper",
      code: "uncompiled_profile_section",
      detail: "method_operations",
    });
  });

  it("refuses a section the source supplies as an object rather than a list", () => {
    const compiled = compileNativeMethodProfile(
      withSettings(twoSettings, {
        method_configuration_space: twoLevelSpace,
        release_profiles: { "release:1": { label: "primary" } },
      }),
      undefined,
      levelASelection,
    );
    expect(blockersOf(compiled)).toContainEqual({
      settingId: "profile:paper",
      code: "uncompiled_profile_section",
      detail: "release_profiles",
    });
  });

  it("rejects object-valued session construction policies before compilation", () => {
    expect(() => withSettings(twoSettings, {
      method_configuration_space: twoLevelSpace,
      session_construction_policies: { "policy:1": { label: "primary" } },
    })).toThrow("method_profile.session_construction_policies must be an array");
  });

  it("rejects a non-object method operation before compilation", () => {
    expect(() => withSettings(twoSettings, {
        method_configuration_space: twoLevelSpace,
        method_operations: ["operation-1"],
      })).toThrow("method_profile.method_operations[0] must be an object");
  });

  it("refuses a compiled selection whose level no configuration group declares", () => {
    const compiled = compileNativeMethodProfile(
      withSettings(twoSettings, { method_configuration_space: twoLevelSpace }),
      undefined,
      { ...levelASelection, selectedLevelIds: ["level:absent"] },
    );
    expect(blockersOf(compiled)).toContainEqual({
      settingId: "profile:paper",
      code: "configuration_selection_mismatch",
      detail:
        "selection identity or effective setting inventory does not match the source configuration space",
    });
  });
});

describe("compileNativeMethodProfile configuration partition", () => {
  it("counts a space-level documentary setting as partitioned, not omitted", () => {
    // `applyConfigurationSpacePartition` indexes space-level documentary and
    // unresolved settings by status rather than by inclusion count, so such a
    // setting must not raise `configuration_selection_mismatch`.
    const compiled = compileNativeMethodProfile(
      withSettings(
        [
          setting(),
          setting({
            method_setting_id: "setting:2",
            contract_bindings: [
              { contract_slot: "proximity_interval_seconds", contract_value_json: "2" },
            ],
          }),
        ],
        {
          method_configuration_space: {
            method_configuration_space_id: "space:1",
            method_configuration_structure: "fixed",
            documentary_method_setting_ids: ["setting:2"],
            method_configuration_groups: [{
              method_configuration_group_id: "group:1",
              method_configuration_group_kind: "axis",
              method_selection_semantics: "independently_selectable",
              method_cross_product_policy: "not_enumerated_no_cartesian_product",
              method_configuration_levels: [{
                method_configuration_level_id: "level:a",
                method_configuration_level_label: "a",
                included_method_setting_ids: ["setting:1"],
              }],
            }],
          },
        },
      ),
    );
    expect(blockersOf(compiled)).toEqual([]);
    expect(expectCompiled(compiled).receipt.settingIds).toEqual([
      "setting:1",
      "setting:2",
    ]);
  });
});

describe("compileNativeMethodProfileCampaign", () => {
  it("compiles one run per enumerated selection", () => {
    const campaign = compileNativeMethodProfileCampaign(profile());
    expect(campaign.ok).toBe(true);
    expect(campaign.runs).toHaveLength(1);
    expect(campaign.runs[0]?.compilation.ok).toBe(true);
    expect(campaign.blockers).toEqual([]);
  });

  it("returns the enumeration's blockers and no run when the space cannot be enumerated", () => {
    const campaign = compileNativeMethodProfileCampaign(
      withSettings([setting(), setting({ method_setting_id: "setting:2" })], {
        method_configuration_space: {
          method_configuration_space_id: "space:1",
          method_configuration_structure: "fixed",
          method_configuration_groups: [
            {
              method_configuration_group_id: "group:1",
              method_configuration_group_kind: "axis",
              method_selection_semantics: "mutually_exclusive",
              method_cross_product_policy: "not_enumerated_no_cartesian_product",
              method_configuration_levels: [
                {
                  method_configuration_level_id: "level:a",
                  method_configuration_level_label: "a",
                  included_method_setting_ids: ["setting:1"],
                },
                {
                  method_configuration_level_id: "level:b",
                  method_configuration_level_label: "b",
                  included_method_setting_ids: ["setting:1"],
                },
              ],
            },
            {
              method_configuration_group_id: "group:2",
              method_configuration_group_kind: "axis",
              method_selection_semantics: "mutually_exclusive",
              method_cross_product_policy: "not_enumerated_no_cartesian_product",
              method_configuration_levels: [
                {
                  method_configuration_level_id: "level:c",
                  method_configuration_level_label: "c",
                  included_method_setting_ids: ["setting:2"],
                },
                {
                  method_configuration_level_id: "level:d",
                  method_configuration_level_label: "d",
                  included_method_setting_ids: ["setting:2"],
                },
              ],
            },
          ],
        },
      }),
    );
    expect(campaign.ok).toBe(false);
    expect(campaign.runs).toEqual([]);
    expect(campaign.blockers).toEqual([{
      groupId: "space:1",
      code: "cross_group_product_not_enumerated",
      detail: "multiple source axes exist, but the source did not declare joint combinations",
    }]);
  });
});

describe("compileNativeMethodProfile selection verification", () => {
  it("blocks a selection whose effective inventory the configuration space does not produce", () => {
    const compiled = compileNativeMethodProfile(profile(), undefined, {
      selectionId: "primary",
      selectedLevelIds: [],
      effectiveSettingIds: ["setting:1", "setting:fabricated"],
    });
    expect(compiled.ok).toBe(false);
    expect(blockersOf(compiled)).toContainEqual({
      settingId: "profile:paper",
      code: "configuration_selection_mismatch",
      detail:
        "selection identity or effective setting inventory does not match the source configuration space",
    });
  });

  it("blocks a profile whose configuration space still needs a level chosen", () => {
    const compiled = compileNativeMethodProfile(
      withSettings([setting(), setting({ method_setting_id: "setting:2" })], {
        method_configuration_space: {
          method_configuration_space_id: "space:1",
          method_configuration_structure: "fixed",
          method_configuration_groups: [
            {
              method_configuration_group_id: "group:1",
              method_configuration_group_kind: "axis",
              method_selection_semantics: "mutually_exclusive",
              method_cross_product_policy: "not_enumerated_no_cartesian_product",
              method_configuration_levels: [
                {
                  method_configuration_level_id: "level:a",
                  method_configuration_level_label: "a",
                  included_method_setting_ids: ["setting:1"],
                },
                {
                  method_configuration_level_id: "level:b",
                  method_configuration_level_label: "b",
                  included_method_setting_ids: ["setting:2"],
                },
              ],
            },
          ],
        },
      }),
    );
    expect(compiled.ok).toBe(false);
    expect(blockersOf(compiled)).toContainEqual({
      settingId: "profile:paper",
      code: "configuration_selection_required",
      detail: "space:1",
    });
  });
});

describe("summarizeMethodConfigurationGroups", () => {
  const assertion = (overrides: Json = {}) =>
    ({
      method_setting_id: "setting:1",
      source_extraction_id: "extraction:1",
      method_setting_role: "provenance",
      method_applicability_status: "applicable",
      method_disclosure_status: "declared",
      method_implementation_status: "native",
      contract_bindings: [],
      ...overrides,
    }) as never;

  it("ignores settings that belong to no variant group", () => {
    expect(
      summarizeMethodConfigurationGroups([
        assertion(),
        assertion({ method_variant_group_id: "" }),
        assertion({ method_variant_group_id: 7 }),
      ]),
    ).toEqual([]);
  });

  it("collects each group's distinct kinds, relations, axes, and branches once", () => {
    expect(
      summarizeMethodConfigurationGroups([
        assertion({
          method_variant_group_id: "group:b",
          method_configuration_json: '{"kind":"variant_branch","axis":"threshold"}',
          method_variant_relation: "alternative",
          method_variant_branch_label: "Branch one",
        }),
        assertion({
          method_setting_id: "setting:2",
          method_variant_group_id: "group:b",
          method_configuration_json: '{"kind":"variant_branch","axis":"threshold"}',
          method_variant_relation: "alternative",
          method_variant_branch_id: "branch:2",
        }),
        assertion({
          method_setting_id: "setting:3",
          method_variant_group_id: "group:a",
          method_configuration_json: '{"kind":"documentary"}',
          method_variant_relation: "identical",
        }),
      ]),
    ).toEqual([
      {
        id: "group:a",
        kinds: ["documentary"],
        relations: ["identical"],
        axes: [],
        branches: [],
        settingCount: 1,
        partitionRequired: false,
      },
      {
        id: "group:b",
        kinds: ["variant_branch"],
        relations: ["alternative"],
        axes: ["threshold"],
        branches: ["Branch one", "branch:2"],
        settingCount: 2,
        partitionRequired: true,
      },
    ]);
  });

  it("keeps a group visible when its configuration metadata is malformed", () => {
    expect(
      summarizeMethodConfigurationGroups([
        assertion({
          method_variant_group_id: "group:a",
          method_configuration_json: "not-json",
        }),
        assertion({
          method_setting_id: "setting:2",
          method_variant_group_id: "group:a",
          method_configuration_json: "[1]",
        }),
      ]),
    ).toEqual([
      {
        id: "group:a",
        kinds: [],
        relations: [],
        axes: [],
        branches: [],
        settingCount: 2,
        partitionRequired: false,
      },
    ]);
  });

  it("requires a partition for a relation the source calls a sensitivity analysis", () => {
    expect(
      summarizeMethodConfigurationGroups([
        assertion({
          method_variant_group_id: "group:a",
          method_variant_relation: "Sensitivity check",
        }),
      ])[0]?.partitionRequired,
    ).toBe(true);
  });
});

/**
 * Fields the source profile may leave out entirely, and settings the partition
 * is not asked to place. `parseStudyMethodProfile` normalizes each absent
 * collection to an empty one rather than refusing the profile.
 */
describe("absent source fields and non-blocking settings", () => {
  it("accepts a configuration space that declares neither groups nor levels", () => {
    const parsed = parseStudyMethodProfile({
      method_profile_id: "profile:paper",
      source_work_id: "doi:paper",
      source_method_variant_id: "primary",
      method_configuration_structure: "fixed",
      method_profile_version: "v1",
      profile_implementation_status: "executable",
      method_settings: [setting()],
      method_configuration_space: {
        method_configuration_space_id: "space:1",
        method_configuration_structure: "fixed",
      },
    });
    expect(parsed.method_configuration_space).toMatchObject({
      method_configuration_groups: [],
      allowed_method_combinations: [],
    });
  });

  it("accepts a group that declares no levels", () => {
    const parsed = parseStudyMethodProfile({
      method_profile_id: "profile:paper",
      source_work_id: "doi:paper",
      source_method_variant_id: "primary",
      method_configuration_structure: "fixed",
      method_profile_version: "v1",
      profile_implementation_status: "executable",
      method_settings: [setting()],
      method_configuration_space: {
        method_configuration_space_id: "space:1",
        method_configuration_structure: "fixed",
        method_configuration_groups: [{
          method_configuration_group_id: "group:1",
          method_configuration_group_kind: "axis",
          method_selection_semantics: "independently_selectable",
          method_cross_product_policy: "not_enumerated_no_cartesian_product",
        }],
      },
    });
    expect(
      (parsed.method_configuration_space as Json).method_configuration_groups,
    ).toEqual([
      expect.objectContaining({ method_configuration_levels: [] }),
    ]);
  });

  it("accepts a setting that declares no contract binding at all", () => {
    const bare = { ...setting() };
    delete bare.contract_bindings;
    expect(
      parseStudyMethodProfile({
        method_profile_id: "profile:paper",
        source_work_id: "doi:paper",
        source_method_variant_id: "primary",
        method_configuration_structure: "fixed",
        method_profile_version: "v1",
        profile_implementation_status: "executable",
        method_settings: [bare],
      }).method_settings[0]?.contract_bindings,
    ).toEqual([]);
  });

  it("refuses a native setting whose conformance digest is not a string", () => {
    const compiled = compileNativeMethodProfile(
      withSettings([setting({ conformance_result_digest: undefined })]),
    );
    expect(blockersOf(compiled)).toContainEqual({
      settingId: "setting:1",
      code: "missing_conformance",
      detail: "exact source-derived fixture result is required",
    });
  });

  it("leaves a not-applicable setting out of the configuration partition entirely", () => {
    const compiled = compileNativeMethodProfile(
      withSettings(
        [
          setting(),
          setting({
            method_setting_id: "setting:2",
            method_applicability_status: "not_applicable",
          }),
        ],
        {
          method_configuration_space: {
            method_configuration_space_id: "space:1",
            method_configuration_structure: "fixed",
            method_configuration_groups: [{
              method_configuration_group_id: "group:1",
              method_configuration_group_kind: "axis",
              method_selection_semantics: "independently_selectable",
              method_cross_product_policy: "not_enumerated_no_cartesian_product",
              method_configuration_levels: [{
                method_configuration_level_id: "level:a",
                method_configuration_level_label: "a",
                included_method_setting_ids: ["setting:1"],
              }],
            }],
          },
        },
      ),
    );
    expect(blockersOf(compiled)).toEqual([]);
    expect(expectCompiled(compiled).receipt.settingIds).toEqual(["setting:1"]);
  });
});
