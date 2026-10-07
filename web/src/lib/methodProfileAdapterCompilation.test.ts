import { describe, expect, it } from "vitest";

import {
  compileNativeMethodProfile,
  parseStudyMethodProfile,
  type StudyMethodProfile,
} from "@/lib/methodProfiles";

/**
 * The input-adapter, output-mapping and external-executor routes of
 * `compileNativeMethodProfile`. The adapters are the ones registered in
 * `web/schema/literature-input-adapter-contract.json`; the external executions
 * are the ones registered in
 * `src/generated/literature-external-executor-registry.json`, which today
 * registers none, so an external-executor setting can only be refused.
 */
type Json = Record<string, unknown>;

/** `chronicle.raw-event-map`, a protocol-input adapter with no option binding. */
const RAW_EVENT_SETTING = "method-setting-0483653c3edaac4e21150447";
/** `chronicle.study-date-interior-exclusion`, whose adapter binds an option. */
const STUDY_WINDOW_SETTING = "method-setting-e5a87fa0f1a10d4184bfe018";
/** `chronicle.ethica-app-usage-stream`, whose adapter overrides a runtime slot. */
const ETHICA_SETTING = "method-setting-8a1d42e375008c6b34c79e60";

const FIXTURE_ID = "fixture.adapter.v1";
const RESULT_DIGEST = `sha256:${"c".repeat(64)}`;

function setting(overrides: Json = {}): Json {
  return {
    method_setting_id: RAW_EVENT_SETTING,
    source_extraction_id: "extraction:1",
    method_setting_role: "provenance",
    method_applicability_status: "applicable",
    method_disclosure_status: "declared",
    method_implementation_status: "native",
    method_execution_route: "protocol_input",
    method_value_json: '"raw_event"',
    conformance_fixture_id: FIXTURE_ID,
    conformance_result_digest: RESULT_DIGEST,
    contract_bindings: [],
    ...overrides,
  };
}

function profile(settings: Json[], overrides: Json = {}): StudyMethodProfile {
  return parseStudyMethodProfile({
    method_profile_id: "profile:paper",
    source_work_id: "doi:paper",
    source_method_variant_id: "primary",
    method_configuration_structure: "fixed",
    method_profile_version: "v1",
    profile_implementation_status: "executable",
    method_settings: settings,
    ...overrides,
  });
}

function blockersOf(compiled: ReturnType<typeof compileNativeMethodProfile>) {
  return compiled.ok ? [] : compiled.blockers;
}

describe("registered input adapter route", () => {
  it("compiles a registered protocol-input setting into a typed input binding", () => {
    const compiled = compileNativeMethodProfile(profile([setting()]));
    expect(compiled.ok).toBe(true);
    expect(compiled.ok && compiled.receipt.inputBindings).toEqual([
      expect.objectContaining({
        settingId: RAW_EVENT_SETTING,
        routeKind: "protocol_input",
        inputRole: "raw_chronicle_csv",
        sourceValue: "raw_event",
        conformanceFixtureId: FIXTURE_ID,
        conformanceResultDigest: RESULT_DIGEST,
      }),
    ]);
  });

  it("blocks a registered setting whose declared route is not the registered one", () => {
    const compiled = compileNativeMethodProfile(
      profile([setting({ method_execution_route: "native_option_binding" })]),
    );
    expect(blockersOf(compiled)).toContainEqual({
      settingId: RAW_EVENT_SETTING,
      code: "invalid_route",
      detail: "native_option_binding (registered: protocol_input)",
    });
  });

  it("blocks a registered setting that declares no route at all", () => {
    const compiled = compileNativeMethodProfile(
      profile([setting({ method_execution_route: undefined })]),
    );
    expect(blockersOf(compiled)).toContainEqual({
      settingId: RAW_EVENT_SETTING,
      code: "invalid_route",
      detail: "missing (registered: protocol_input)",
    });
  });

  it.each([
    ["no conformance fixture id", { conformance_fixture_id: undefined }],
    ["a conformance digest that is not a sha256", { conformance_result_digest: "sha256:zz" }],
  ])("blocks a registered adapter setting with %s", (_label, overrides) => {
    const compiled = compileNativeMethodProfile(profile([setting(overrides)]));
    expect(blockersOf(compiled)).toContainEqual({
      settingId: RAW_EVENT_SETTING,
      code: "missing_conformance",
      detail: "registered input adapter requires an executed source-derived fixture",
    });
  });

  it("blocks a registered adapter setting that carries no source value at all", () => {
    const compiled = compileNativeMethodProfile(
      profile([setting({ method_value_json: undefined })]),
    );
    expect(blockersOf(compiled)).toContainEqual({
      settingId: RAW_EVENT_SETTING,
      code: "invalid_json",
      detail: "undefined",
    });
  });

  it("applies the adapter's registered option binding to the compiled options", () => {
    const compiled = compileNativeMethodProfile(
      profile([
        setting({
          method_setting_id: STUDY_WINDOW_SETTING,
          method_execution_route: "native_operator_parameter",
        }),
      ]),
    );
    expect(compiled.ok).toBe(true);
    expect(compiled.ok && compiled.options.enableStudyWindowFilter).toBe(true);
    expect(compiled.ok && compiled.receipt.bindings).toEqual([
      {
        settingId: STUDY_WINDOW_SETTING,
        slot: "enable_study_window_filter",
        value: true,
        conformanceFixtureId: FIXTURE_ID,
        conformanceResultDigest: RESULT_DIGEST,
      },
    ]);
  });

  it("blocks a source method binding that contradicts the adapter's registered option", () => {
    const compiled = compileNativeMethodProfile(
      profile([
        setting({
          method_setting_id: STUDY_WINDOW_SETTING,
          method_execution_route: "native_operator_parameter",
        }),
        {
          ...setting({
            method_setting_id: "setting:native",
            method_execution_route: "native_option_binding",
            contract_bindings: [
              {
                contract_slot: "enable_study_window_filter",
                contract_value_json: "false",
              },
            ],
          }),
        },
      ]),
    );
    expect(blockersOf(compiled)).toContainEqual({
      settingId: "setting:native",
      code: "conflicting_binding",
      detail: "enableStudyWindowFilter",
    });
  });

  it("blocks the adapter's registered option when an earlier source binding already set it", () => {
    // Order decides which side reports the conflict: the native binding is
    // compiled first here, so the adapter is the one refused, and the detail is
    // the registered snake_case slot rather than the camelCase option key.
    const compiled = compileNativeMethodProfile(
      profile([
        setting({
          method_setting_id: "setting:native",
          method_execution_route: "native_option_binding",
          contract_bindings: [
            {
              contract_slot: "enable_study_window_filter",
              contract_value_json: "false",
            },
          ],
        }),
        setting({
          method_setting_id: STUDY_WINDOW_SETTING,
          method_execution_route: "native_operator_parameter",
        }),
      ]),
    );
    expect(blockersOf(compiled)).toContainEqual({
      settingId: STUDY_WINDOW_SETTING,
      code: "conflicting_binding",
      detail: "enable_study_window_filter",
    });
  });

  it("applies the adapter's runtime override and keeps it out of the receipt bindings", () => {
    const compiled = compileNativeMethodProfile(
      profile([setting({ method_setting_id: ETHICA_SETTING })]),
    );
    expect(compiled.ok).toBe(true);
    expect(compiled.ok && compiled.options.minimumUsageDuration).toBe(0);
    expect(compiled.ok && compiled.receipt.bindings).toEqual([]);
  });

  it("blocks a source method binding that contradicts the adapter's runtime override", () => {
    const compiled = compileNativeMethodProfile(
      profile([
        setting({ method_setting_id: ETHICA_SETTING }),
        setting({
          method_setting_id: "setting:native",
          method_execution_route: "native_option_binding",
          contract_bindings: [
            { contract_slot: "minimum_usage_duration", contract_value_json: "60" },
          ],
        }),
      ]),
    );
    expect(blockersOf(compiled)).toContainEqual({
      settingId: "profile:paper",
      code: "conflicting_binding",
      detail: "minimumUsageDuration (chronicle.ethica-app-usage-stream/v1 vs source method binding)",
    });
  });
});

describe("output mapping route", () => {
  it("blocks a declared output mapping the generated registry does not carry", () => {
    // The shipped android method-profile registry declares no output binding,
    // so any source-declared output mapping is unregistered by construction.
    const compiled = compileNativeMethodProfile(
      profile([
        setting({
          method_setting_id: "setting:output",
          method_execution_route: "native_option_binding",
          method_value_json: '"usage_seconds"',
          chronicle_output_kind: "app-csv",
          chronicle_output_column: "duration_seconds",
          source_output_position: 0,
          contract_bindings: [
            { contract_slot: "minimum_usage_duration", contract_value_json: "60" },
          ],
        }),
      ]),
    );
    expect(compiled.ok).toBe(false);
    expect(blockersOf(compiled)).toContainEqual({
      settingId: "setting:output",
      code: "missing_conformance",
      detail: "source output mapping does not exactly match the generated method-profile registry",
    });
  });
});

describe("external executor route", () => {
  const externalSetting = (overrides: Json = {}) =>
    setting({
      method_setting_id: "setting:external",
      method_implementation_status: "external_executor",
      method_execution_route: "external_named_executor",
      ...overrides,
    });

  it("blocks an external executor setting the registry has no receipt for", () => {
    const compiled = compileNativeMethodProfile(profile([externalSetting()]));
    expect(blockersOf(compiled)).toContainEqual({
      settingId: "profile:paper",
      code: "missing_conformance",
      detail: "external executor settings do not exactly match a registered whole-configuration receipt",
    });
    expect(compiled.readiness.downstream.status).toBe("blocked");
  });

  it("reports the external route as required even while it is blocked", () => {
    const compiled = compileNativeMethodProfile(
      profile([
        externalSetting(),
        setting({
          method_setting_id: "setting:native",
          method_execution_route: "native_option_binding",
          contract_bindings: [
            { contract_slot: "minimum_usage_duration", contract_value_json: "60" },
          ],
        }),
      ]),
    );
    expect(compiled.ok).toBe(false);
    expect(compiled.readiness.preprocessing.status).toBe("ready");
    expect(compiled.readiness.downstream.status).toBe("blocked");
    expect(compiled.readiness.disposition).toBe("preprocessing_reproduced");
  });
});
