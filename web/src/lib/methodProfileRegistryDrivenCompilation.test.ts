import { afterEach, describe, expect, it, vi } from "vitest";

import adapterContractJson from "../../schema/literature-input-adapter-contract.json" with { type: "json" };
import androidRegistryJson from "@/generated/android-method-profile-runtime-registry.json" with { type: "json" };
import executorRegistryJson from "@/generated/literature-external-executor-registry.json" with { type: "json" };

/**
 * The output-mapping and external-executor halves of `compileNativeMethodProfile`.
 * The shipped `src/generated/android-method-profile-runtime-registry.json`
 * declares no output binding, and every configuration in
 * `src/generated/literature-external-executor-registry.json` is a
 * `campaign_internal_job_model_cell`, which registers no binding at all — so a
 * receipt that actually carries one of these can only be compiled against a
 * substituted registry, loaded through `vi.doMock`.
 */
const ANDROID_REGISTRY = "@/generated/android-method-profile-runtime-registry.json";
const EXECUTOR_REGISTRY = "@/generated/literature-external-executor-registry.json";
const ADAPTER_CONTRACT = "../../schema/literature-input-adapter-contract.json";

type Json = Record<string, unknown>;

const PROFILE_ID = "profile:paper";
const SOURCE_WORK_ID = "doi:paper";
const VARIANT_ID = "primary";
const PROFILE_VERSION = "v1";
const FIXTURE_ID = "fixture.registry.v1";
const RESULT_DIGEST = `sha256:${"d".repeat(64)}`;

const identity = {
  method_profile_id: PROFILE_ID,
  source_work_id: SOURCE_WORK_ID,
  source_method_variant_id: VARIANT_ID,
  method_profile_version: PROFILE_VERSION,
};

afterEach(() => {
  vi.doUnmock(ANDROID_REGISTRY);
  vi.doUnmock(EXECUTOR_REGISTRY);
  vi.doUnmock(ADAPTER_CONTRACT);
  vi.resetModules();
});

function androidProfile(overrides: Json): Json {
  return {
    ...identity,
    profile_implementation_status: "executable",
    configuration_count: 0,
    completed_configuration_count: 0,
    blocked_configuration_count: 0,
    completed_configurations: [],
    applicable_setting_ids: [],
    runtime_setting_ids: [],
    registered_components: [],
    protocol_documentary_bindings: [],
    typed_sections: {},
    output_bindings: [],
    not_applicable_setting_ids: [],
    invariant_setting_ids: [],
    documentary_setting_ids: [],
    unresolved_setting_ids: [],
    groups: [],
    combinations: [],
    ...overrides,
  };
}

async function loadMethodProfiles() {
  vi.resetModules();
  return import("@/lib/methodProfiles");
}

function nativeSetting(overrides: Json = {}): Json {
  return {
    method_setting_id: "setting:native",
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

function profileWith(settings: Json[]): Json {
  return {
    method_profile_id: PROFILE_ID,
    source_work_id: SOURCE_WORK_ID,
    source_method_variant_id: VARIANT_ID,
    method_configuration_structure: "fixed",
    method_profile_version: PROFILE_VERSION,
    profile_implementation_status: "executable",
    method_settings: settings,
  };
}

describe("registered output mappings", () => {
  const registryBinding = (overrides: Json = {}): Json => ({
    setting_id: "setting:output-app",
    output_kind: "app-csv",
    source_field: "usage_seconds",
    source_position: 1,
    canonical_field: "duration_seconds",
    conformance_fixture_id: FIXTURE_ID,
    conformance_result_digest: RESULT_DIGEST,
    ...overrides,
  });

  const sourceSetting = (binding: Json): Json =>
    nativeSetting({
      method_setting_id: binding.setting_id,
      method_value_json: JSON.stringify(binding.source_field),
      chronicle_output_kind: binding.output_kind,
      chronicle_output_column: binding.canonical_field,
      source_output_position: binding.source_position,
    });

  it("keeps both registered output bindings, ordered by their source position", async () => {
    const app = registryBinding();
    const screen = registryBinding({
      setting_id: "setting:output-screen",
      output_kind: "screen-csv",
      source_field: "screen_seconds",
      source_position: 0,
      canonical_field: "screen_duration_seconds",
    });
    vi.doMock(ANDROID_REGISTRY, () => ({
      default: {
        ...androidRegistryJson,
        profiles: [androidProfile({ output_bindings: [app, screen] })],
      },
    }));
    const { compileNativeMethodProfile, parseStudyMethodProfile } =
      await loadMethodProfiles();

    const compiled = compileNativeMethodProfile(
      parseStudyMethodProfile(
        profileWith([sourceSetting(app), sourceSetting(screen)]),
      ),
    );
    expect(compiled.ok).toBe(true);
    expect(compiled.ok && compiled.receipt.outputBindings).toEqual([
      expect.objectContaining({
        settingId: "setting:output-screen",
        outputKind: "screen-csv",
        sourcePosition: 0,
      }),
      expect.objectContaining({
        settingId: "setting:output-app",
        outputKind: "app-csv",
        sourcePosition: 1,
      }),
    ]);
    expect(compiled.ok && compiled.receipt.settingIds).toEqual([
      "setting:output-app",
      "setting:output-screen",
    ]);
  });

  it("blocks a setting the registry binds as an output that the source never declares", async () => {
    // The setting declares no output fields, so the parser never looks at
    // `method_value_json` and it can be absent; the compiler still has to
    // resolve the registered binding, and an absent source field cannot match.
    const app = registryBinding();
    vi.doMock(ANDROID_REGISTRY, () => ({
      default: {
        ...androidRegistryJson,
        profiles: [androidProfile({ output_bindings: [app] })],
      },
    }));
    const { compileNativeMethodProfile, parseStudyMethodProfile } =
      await loadMethodProfiles();

    const compiled = compileNativeMethodProfile(
      parseStudyMethodProfile(
        profileWith([nativeSetting({ method_setting_id: "setting:output-app" })]),
      ),
    );
    expect(compiled.ok).toBe(false);
    expect(compiled.ok || compiled.blockers).toContainEqual({
      settingId: "setting:output-app",
      code: "missing_conformance",
      detail: "source output mapping does not exactly match the generated method-profile registry",
    });
  });

  it("blocks a source mapping whose canonical field disagrees with the registry", async () => {
    const app = registryBinding();
    vi.doMock(ANDROID_REGISTRY, () => ({
      default: {
        ...androidRegistryJson,
        profiles: [androidProfile({ output_bindings: [app] })],
      },
    }));
    const { compileNativeMethodProfile, parseStudyMethodProfile } =
      await loadMethodProfiles();

    const compiled = compileNativeMethodProfile(
      parseStudyMethodProfile(
        profileWith([
          {
            ...sourceSetting(app),
            chronicle_output_column: "total_seconds",
          },
        ]),
      ),
    );
    expect(compiled.ok).toBe(false);
    expect(compiled.ok || compiled.blockers).toContainEqual({
      settingId: "setting:output-app",
      code: "missing_conformance",
      detail: "source output mapping does not exactly match the generated method-profile registry",
    });
  });
});

describe("registered external executions", () => {
  const EXTERNAL_IDS = ["setting:external-a", "setting:external-b"];
  const shipped = (executorRegistryJson as unknown as {
    executors: Array<Json & { configurations: Json[] }>;
  }).executors[0]!;

  function mockExecutorRegistry() {
    vi.doMock(EXECUTOR_REGISTRY, () => ({
      default: {
        ...executorRegistryJson,
        executors: [{
          ...shipped,
          ...identity,
          configurations: [{
            ...structuredClone(shipped.configurations[0]!),
            configuration_unit_kind: "user_selectable_alternative",
            selected_level_ids: [],
            external_setting_ids: EXTERNAL_IDS,
            conformance_fixture_id: FIXTURE_ID,
            conformance_result_digest: RESULT_DIGEST,
          }],
        }],
      },
    }));
  }

  const externalSetting = (settingId: string, overrides: Json = {}): Json => ({
    method_setting_id: settingId,
    source_extraction_id: "extraction:1",
    method_setting_role: "provenance",
    method_applicability_status: "applicable",
    method_disclosure_status: "declared",
    method_implementation_status: "external_executor",
    method_execution_route: "external_named_executor",
    executor_id: shipped.executor_id,
    method_execution_destination_id: shipped.executor_id,
    conformance_fixture_id: FIXTURE_ID,
    conformance_result_digest: RESULT_DIGEST,
    contract_bindings: [],
    ...overrides,
  });

  it("carries the registered execution receipt and both of its settings", async () => {
    mockExecutorRegistry();
    const { compileNativeMethodProfile, parseStudyMethodProfile } =
      await loadMethodProfiles();

    const compiled = compileNativeMethodProfile(
      parseStudyMethodProfile(
        profileWith([
          nativeSetting(),
          ...EXTERNAL_IDS.map((settingId) => externalSetting(settingId)),
        ]),
      ),
    );
    expect(compiled.ok).toBe(true);
    expect(compiled.ok && compiled.receipt.externalBindings?.[0]?.settingIds)
      .toEqual(EXTERNAL_IDS);
    expect(compiled.ok && compiled.receipt.settingIds).toEqual([
      "setting:native",
      ...EXTERNAL_IDS,
    ]);
    expect(compiled.readiness.downstream.status).toBe("ready");
  });

  it("blocks a registered execution whose source settings carry a contract binding", async () => {
    mockExecutorRegistry();
    const { compileNativeMethodProfile, parseStudyMethodProfile } =
      await loadMethodProfiles();

    const compiled = compileNativeMethodProfile(
      parseStudyMethodProfile(
        profileWith([
          externalSetting(EXTERNAL_IDS[0]!, {
            contract_bindings: [
              { contract_slot: "minimum_usage_duration", contract_value_json: "60" },
            ],
          }),
          externalSetting(EXTERNAL_IDS[1]!),
        ]),
      ),
    );
    expect(compiled.ok).toBe(false);
    expect(compiled.ok || compiled.blockers).toContainEqual({
      settingId: PROFILE_ID,
      code: "missing_conformance",
      detail: "external executor settings do not exactly match a registered whole-configuration receipt",
    });
  });
});

/**
 * The adapter-supplied option rules in `compileNativeMethodProfile`. Every
 * group in `web/schema/literature-input-adapter-contract.json` binds slots the
 * generated LinkML contract declares, and only `chronicle.ethica-app-usage-stream`
 * overrides a runtime slot, so the unknown-slot and adapter-versus-adapter
 * conflict rules are reachable only against a substituted contract.
 */
describe("adapter option bindings the contract registers", () => {
  const contract = adapterContractJson as unknown as { groups: Json[] };
  const ETHICA = "chronicle.ethica-app-usage-stream";

  function withGroups(rewrite: (groups: Json[]) => Json[]) {
    vi.doMock(ADAPTER_CONTRACT, () => ({
      default: { ...contract, groups: rewrite(structuredClone(contract.groups)) },
    }));
  }

  const ethicaIndex = () =>
    contract.groups.findIndex((group) => group.adapterId === ETHICA);

  function adapterSetting(settingId: string, routeKind: string): Json {
    return {
      method_setting_id: settingId,
      source_extraction_id: "extraction:1",
      method_setting_role: "provenance",
      method_applicability_status: "applicable",
      method_disclosure_status: "declared",
      method_implementation_status: "native",
      method_execution_route: routeKind,
      method_value_json: '"raw_event"',
      conformance_fixture_id: FIXTURE_ID,
      conformance_result_digest: RESULT_DIGEST,
      contract_bindings: [],
    };
  }

  it("blocks a runtime override naming a slot the LinkML contract does not declare", async () => {
    const index = ethicaIndex();
    const settingId = (contract.groups[index]!.methodSettingIds as string[])[0]!;
    withGroups((groups) => {
      groups[index]!.runtimeOptionOverrides = { notAContractSlot: 1 };
      return groups;
    });
    const { compileNativeMethodProfile, parseStudyMethodProfile } =
      await loadMethodProfiles();

    const compiled = compileNativeMethodProfile(
      parseStudyMethodProfile(
        profileWith([adapterSetting(settingId, "protocol_input")]),
      ),
    );
    expect(compiled.ok).toBe(false);
    expect(compiled.ok || compiled.blockers).toContainEqual({
      settingId,
      code: "unknown_slot",
      detail: "notAContractSlot",
    });
  });

  it("blocks two adapters that override the same runtime slot differently", async () => {
    const index = ethicaIndex();
    const ids = contract.groups[index]!.methodSettingIds as string[];
    withGroups((groups) => {
      const original = groups[index]!;
      const settingIds = original.methodSettingIds as string[];
      groups[index] = { ...original, methodSettingIds: [settingIds[0]!] };
      groups.push({
        ...structuredClone(original),
        adapterId: "chronicle.ethica-app-usage-stream-alternate",
        runtimeOptionOverrides: { minimumUsageDuration: 60 },
        methodSettingIds: settingIds.slice(1),
      });
      return groups;
    });
    const { compileNativeMethodProfile, parseStudyMethodProfile } =
      await loadMethodProfiles();

    const compiled = compileNativeMethodProfile(
      parseStudyMethodProfile(
        profileWith([
          adapterSetting(ids[0]!, "protocol_input"),
          adapterSetting(ids[1]!, "protocol_input"),
        ]),
      ),
    );
    expect(compiled.ok).toBe(false);
    expect(compiled.ok || compiled.blockers).toContainEqual({
      settingId: ids[1],
      code: "conflicting_binding",
      detail: `minimumUsageDuration (${ETHICA}/v1 vs chronicle.ethica-app-usage-stream-alternate/v1)`,
    });
  });

  it("blocks an option binding naming a slot the LinkML contract does not declare", async () => {
    const index = ethicaIndex();
    const settingId = (contract.groups[index]!.methodSettingIds as string[])[0]!;
    withGroups((groups) => {
      groups[index]!.optionBindings = { not_a_contract_slot: true };
      delete groups[index]!.runtimeOptionOverrides;
      return groups;
    });
    const { compileNativeMethodProfile, parseStudyMethodProfile } =
      await loadMethodProfiles();

    const compiled = compileNativeMethodProfile(
      parseStudyMethodProfile(
        profileWith([adapterSetting(settingId, "protocol_input")]),
      ),
    );
    expect(compiled.ok).toBe(false);
    expect(compiled.ok || compiled.blockers).toContainEqual({
      settingId,
      code: "unknown_slot",
      detail: "not_a_contract_slot",
    });
  });
});
