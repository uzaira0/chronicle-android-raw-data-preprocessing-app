import { afterEach, describe, expect, it, vi } from "vitest";

import contractJson from "../../schema/literature-input-adapter-contract.json" with { type: "json" };
import registryJson from "@/generated/literature-external-executor-registry.json" with { type: "json" };
import {
  literatureComponentExecutionForSettings,
  literatureComponentInputRole,
  literatureComponentTableMediaType,
  methodReceiptUsesPhoneStudyPsCommunication,
} from "@/lib/literatureInputAdapters";
import {
  literatureExternalExecutionForSelection,
  validateLiteratureExternalExecutionBinding,
} from "@/lib/literatureExternalExecutors";

/**
 * Both literature registries are read once at module load and every rule they
 * check there is a drift gate over a generated file:
 * `web/schema/literature-input-adapter-contract.json` and
 * `src/generated/literature-external-executor-registry.json`. A drifted file
 * has to fail the import, not reach the runtime, so each case substitutes one
 * changed field through `vi.doMock` and re-imports the module.
 */
const ADAPTER_CONTRACT = "../../schema/literature-input-adapter-contract.json";
const EXECUTOR_REGISTRY = "@/generated/literature-external-executor-registry.json";

type Json = Record<string, unknown>;

const contract = contractJson as unknown as { groups: Json[] };
const registry = registryJson as unknown as {
  executors: Array<Json & { configurations: Json[] }>;
};

function groupsClone(): Json[] {
  return structuredClone(contract.groups);
}

async function loadAdaptersWithGroups(groups: Json[]) {
  vi.doMock(ADAPTER_CONTRACT, () => ({
    default: { ...contract, groups },
  }));
  vi.resetModules();
  return import("@/lib/literatureInputAdapters");
}

async function loadExecutorsWithRegistry(executors: unknown[]) {
  vi.doMock(EXECUTOR_REGISTRY, () => ({
    default: { ...registryJson, executors },
  }));
  vi.resetModules();
  return import("@/lib/literatureExternalExecutors");
}

afterEach(() => {
  vi.doUnmock(ADAPTER_CONTRACT);
  vi.doUnmock(EXECUTOR_REGISTRY);
  vi.resetModules();
});

describe("literature input adapter contract drift", () => {
  const groupWithSupportRoles = () => {
    const index = contract.groups.findIndex(
      (group) => ((group.requiredSupportRoles as string[] | undefined) ?? []).length > 0,
    );
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
  };

  it("refuses a group that repeats a required support role", async () => {
    const groups = groupsClone();
    const index = groupWithSupportRoles();
    const roles = groups[index]!.requiredSupportRoles as string[];
    groups[index]!.requiredSupportRoles = [roles[0]!, roles[0]!];
    await expect(loadAdaptersWithGroups(groups)).rejects.toThrow(
      /^malformed literature adapter support roles: /,
    );
  });

  it("refuses a group naming a support role no browser support file carries", async () => {
    const groups = groupsClone();
    const index = groupWithSupportRoles();
    groups[index]!.requiredSupportRoles = ["not_a_support_file"];
    await expect(loadAdaptersWithGroups(groups)).rejects.toThrow(
      /^malformed literature adapter support roles: /,
    );
  });

  it("refuses a setting registered by two adapter groups", async () => {
    const groups = groupsClone();
    const settingId = (groups[0]!.methodSettingIds as string[])[0]!;
    const ordinary=groups.find((g) => g !== groups[0] && (g.componentExecution as Json | undefined)?.canonicalRegistrationStatus !== "outside_frozen143_extension")!;
    (ordinary.methodSettingIds as string[]).push(settingId);
    await expect(loadAdaptersWithGroups(groups)).rejects.toThrow(
      `duplicate literature input adapter registration: ${settingId}`,
    );
  });

  it("refuses forged outside-freeze authority and unknown registration statuses", async () => {
    const extensions=contract.groups.filter((g)=>(g.componentExecution as Json | undefined)?.canonicalRegistrationStatus === "outside_frozen143_extension");
    expect(extensions).toHaveLength(3);
    for (const extension of extensions) for (const field of ["componentId","parentMethodProfileId","sourceWorkId","sourceMethodVariantId","methodProfileVersion","derivedResultKind","sourceOracleId","tableFormat","adaptedResultKind"]) {
      const groups=groupsClone();
      const group=groups.find((g)=>g.adapterId===extension.adapterId)!;
      (group.componentExecution as Json)[field]="forged";
      await expect(loadAdaptersWithGroups(groups)).rejects.toThrow(/malformed.*component registration/);
    }
    const groups=groupsClone();
    (groups[componentIndex()]!.componentExecution as Json).canonicalRegistrationStatus="skip_all_checks";
    await expect(loadAdaptersWithGroups(groups)).rejects.toThrow(/unrecognized component registration status/);
  });

  it("refuses a contract that no longer registers exactly 825 settings", async () => {
    const groups = groupsClone();
    const ordinary=groups.find((g) => (g.componentExecution as Json | undefined)?.canonicalRegistrationStatus !== "outside_frozen143_extension")!;
    (ordinary.methodSettingIds as string[]).pop();
    await expect(loadAdaptersWithGroups(groups)).rejects.toThrow(
      /^literature input adapter contract must register exactly 825 settings, got 824$/,
    );
  });

  it("refuses a source schema whose setting the group does not own", async () => {
    const groups = groupsClone();
    const index = groups.findIndex(
      (group) => ((group.sourceSchemas as Json[] | undefined) ?? []).length > 0,
    );
    expect(index).toBeGreaterThanOrEqual(0);
    const schema = (groups[index]!.sourceSchemas as Json[])[0]!;
    schema.methodSettingId = "method-setting-not-in-this-group";
    await expect(loadAdaptersWithGroups(groups)).rejects.toThrow(
      "invalid literature source-schema registration: method-setting-not-in-this-group",
    );
  });

  it("refuses a source schema whose source value digest is not a sha256", async () => {
    const groups = groupsClone();
    const index = groups.findIndex(
      (group) => ((group.sourceSchemas as Json[] | undefined) ?? []).length > 0,
    );
    const schema = (groups[index]!.sourceSchemas as Json[])[0]!;
    schema.sourceValueSha256 = "not-a-digest";
    await expect(loadAdaptersWithGroups(groups)).rejects.toThrow(
      `malformed literature source-schema registration: ${String(schema.methodSettingId)}`,
    );
  });

  it("refuses a contract that no longer registers exactly 18 source schemas", async () => {
    const groups = groupsClone();
    const index = groups.findIndex(
      (group) => ((group.sourceSchemas as Json[] | undefined) ?? []).length > 0,
    );
    (groups[index]!.sourceSchemas as Json[]).pop();
    await expect(loadAdaptersWithGroups(groups)).rejects.toThrow(
      /^literature source-schema contract must register exactly 18 settings, got 17$/,
    );
  });

  const componentIndex = () => {
    const index = contract.groups.findIndex((group) => group.componentExecution &&
      (group.componentExecution as Json).canonicalRegistrationStatus !== "outside_frozen143_extension");
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
  };

  it.each([
    ["a blank component id", { componentId: " " }],
    ["a blank source oracle id", { sourceOracleId: "" }],
    ["a table format the runtime cannot read", { tableFormat: "parquet" }],
    [
      "a full-profile execution status other than blocked",
      { fullProfileExecutionStatus: "executable" },
    ],
  ])("refuses a component execution registered with %s", async (_label, overrides) => {
    const groups = groupsClone();
    const index = componentIndex();
    const group = groups[index]!;
    group.componentExecution = {
      ...(group.componentExecution as Json),
      ...overrides,
    };
    await expect(loadAdaptersWithGroups(groups)).rejects.toThrow(
      `malformed literature component registration: ${String(group.adapterId)}`,
    );
  });

  it("refuses a component that depends on a setting no adapter group registers", async () => {
    const groups = groupsClone();
    const index = componentIndex();
    const group = groups[index]!;
    const component = group.componentExecution as Json;
    group.componentExecution = {
      ...component,
      additionalMethodSettingIds: [
        ...((component.additionalMethodSettingIds as string[] | undefined) ?? []),
        "method-setting-unregistered",
      ],
    };
    await expect(loadAdaptersWithGroups(groups)).rejects.toThrow(
      `unregistered literature component dependency: ${String(
        (group.componentExecution as Json).componentId,
      )}`,
    );
  });
});

/**
 * A component execution carries its own `requiredSupportRoles`, which its
 * adapter group need not repeat. `chronicle.schoedel-screen-preprocessing` in
 * `web/schema/literature-input-adapter-contract.json` is exactly that case, so
 * its support role is reachable only through the component, and only when the
 * receipt selects every setting the component depends on.
 */
describe("support roles a component contributes", () => {
  const group = contract.groups.find(
    (candidate) => candidate.adapterId === "chronicle.schoedel-screen-preprocessing",
  )! as Json & { methodSettingIds: string[]; componentExecution: Json };
  const settingIds = group.methodSettingIds;

  it("registers the component's support role without repeating it on the group", () => {
    expect(group.requiredSupportRoles).toBeUndefined();
    expect(group.componentExecution.requiredSupportRoles).toEqual([
      "phonestudy_ps_communication_file",
    ]);
  });

  it("reports the role for a receipt that selects every setting the component needs", () => {
    expect(methodReceiptUsesPhoneStudyPsCommunication(settingIds)).toBe(true);
    expect(literatureComponentExecutionForSettings(settingIds)?.componentId).toBe(
      group.componentExecution.componentId,
    );
  });

  it("reports no role, and no component, when one of its settings is missing", () => {
    const partial = settingIds.slice(0, -1);
    expect(methodReceiptUsesPhoneStudyPsCommunication(partial)).toBe(false);
    expect(literatureComponentExecutionForSettings(partial)).toBeUndefined();
  });

  it("reports no component when the settings span more than one of them", () => {
    const other = contract.groups.find(
      (candidate) => candidate.adapterId === "chronicle.esm-timezone-window-correction",
    )! as Json & { methodSettingIds: string[] };
    expect(
      literatureComponentExecutionForSettings([
        ...settingIds,
        ...other.methodSettingIds,
      ]),
    ).toBeUndefined();
  });
});

describe("literature component media type and input role", () => {
  const componentGroups = contract.groups.filter((group) => group.componentExecution);

  it("has registered component executions to read", () => {
    expect(componentGroups.length).toBeGreaterThan(0);
  });

  it.each([
    ["arrow-ipc-file", "application/vnd.apache.arrow.file"],
    ["csv", "text/csv"],
  ])("serves a %s component table as %s", (tableFormat, mediaType) => {
    expect(
      literatureComponentTableMediaType({ tableFormat } as Parameters<
        typeof literatureComponentTableMediaType
      >[0]),
    ).toBe(mediaType);
  });

  it("treats a component that is not an arrow table as raw Chronicle CSV", () => {
    expect(
      literatureComponentInputRole({ tableFormat: "csv" } as unknown as Parameters<
        typeof literatureComponentInputRole
      >[0]),
    ).toBe("raw_chronicle_csv");
  });

  it("refuses an arrow component whose adapter identity the contract does not register", () => {
    expect(() =>
      literatureComponentInputRole({
        tableFormat: "arrow-ipc-file",
        adapterId: "adapter-absent",
        adapterVersion: "0",
      } as unknown as Parameters<typeof literatureComponentInputRole>[0]),
    ).toThrow("typed component input role is not registered");
  });

  it("returns the registered input role for an arrow component of a registered adapter", () => {
    const group = componentGroups[0]!;
    expect(
      literatureComponentInputRole({
        tableFormat: "arrow-ipc-file",
        adapterId: group.adapterId as string,
        adapterVersion: group.adapterVersion as string,
      } as unknown as Parameters<typeof literatureComponentInputRole>[0]),
    ).toBe(group.inputRole as string);
  });
});

describe("literature external executor registry", () => {
  // The shipped registry declares only `campaign_internal_job_model_cell`
  // configurations, which register no binding at all; the selectable-alternative
  // rules are therefore exercised against a substituted registry built from the
  // shipped executor's own identity.
  const executorIdentity = structuredClone(registry.executors[0]!);
  const shippedConfiguration = executorIdentity.configurations[0]!;
  delete (executorIdentity as Json).configurations;

  const selectableConfiguration = (overrides: Json = {}): Json => ({
    ...structuredClone(shippedConfiguration),
    configuration_unit_kind: "user_selectable_alternative",
    selected_level_ids: ["level:a", "level:b"],
    ...overrides,
  });

  const identity = {
    methodProfileId: executorIdentity.method_profile_id as string,
    sourceWorkId: executorIdentity.source_work_id as string,
    sourceMethodVariantId: executorIdentity.source_method_variant_id as string,
    sourceMethodVariantIds: ["level:b", "level:a"],
    methodProfileVersion: executorIdentity.method_profile_version as string,
  };

  const loadWith = (configurations: Json[]) =>
    loadExecutorsWithRegistry([{ ...executorIdentity, configurations }]);

  it("registers no binding for the shipped campaign-internal configurations", () => {
    expect(
      registry.executors.every((executor) =>
        executor.configurations.every((configuration) =>
          configuration.configuration_unit_kind === "campaign_internal_job_model_cell")),
    ).toBe(true);
    expect(literatureExternalExecutionForSelection(identity)).toBeUndefined();
    expect(validateLiteratureExternalExecutionBinding(identity, {})).toBe(false);
  });

  it("binds a selectable model alternative under its sorted level identity", async () => {
    const module = await loadWith([selectableConfiguration()]);
    const registered = module.literatureExternalExecutionForSelection(identity);
    expect(registered).toMatchObject({
      executorId: executorIdentity.executor_id as string,
      destinationId: executorIdentity.executor_id as string,
      bindingKind: "model",
      modelName: shippedConfiguration.model_name as string,
      formula: shippedConfiguration.formula as string,
      observations: shippedConfiguration.observations as number,
      runtime: executorIdentity.runtime as string,
      runtimeVersion: executorIdentity.executor_version as string,
      conformanceResultDigest: shippedConfiguration.conformance_result_digest as string,
    });
    expect(
      module.validateLiteratureExternalExecutionBinding(identity, registered),
    ).toBe(true);
  });

  it("carries the campaign aggregate evidence for a campaign alternative", async () => {
    const aggregate = {
      method_execution_passed: true,
      published_numeric_oracle_passed: true,
      source_job_count: 4,
      executed_source_job_count: 4,
      generated_result_rows: 40,
      published_oracle_rows: 40,
      published_oracle_job_count: 4,
      numeric_oracle_cells_compared: 400,
      numeric_oracle_cells_mismatched: 0,
      jobs_without_published_numeric_oracles: 0,
      source_jobs_sha256: `sha256:${"1".repeat(64)}`,
      source_results_sha256: `sha256:${"2".repeat(64)}`,
      generated_result_manifest_sha256: `sha256:${"3".repeat(64)}`,
    };
    const module = await loadWith([
      selectableConfiguration({ binding_kind: "campaign", aggregate_evidence: aggregate }),
    ]);
    expect(module.literatureExternalExecutionForSelection(identity)).toMatchObject({
      bindingKind: "campaign",
      aggregateEvidence: {
        methodExecutionPassed: true,
        sourceJobCount: 4,
        numericOracleCellsMismatched: 0,
        generatedResultManifestSha256: aggregate.generated_result_manifest_sha256,
      },
    });
  });

  it.each([
    ["a binding with one field rewritten", (binding: Json) => ({ ...binding, executorId: "forged" })],
    ["a binding with a field removed", (binding: Json) => {
      const copy = { ...binding };
      delete copy.receiptId;
      return copy;
    }],
    ["something that is not a binding", () => "binding"],
  ])("refuses %s", async (_label, mutate) => {
    const module = await loadWith([selectableConfiguration()]);
    const registered = module.literatureExternalExecutionForSelection(identity)!;
    expect(
      module.validateLiteratureExternalExecutionBinding(
        identity,
        mutate(registered as unknown as Json),
      ),
    ).toBe(false);
  });

  it("refuses any binding for a level set the registry did not enumerate", async () => {
    const module = await loadWith([selectableConfiguration()]);
    const other = { ...identity, sourceMethodVariantIds: ["level:a"] };
    expect(module.literatureExternalExecutionForSelection(other)).toBeUndefined();
    expect(module.validateLiteratureExternalExecutionBinding(other, {})).toBe(false);
  });

  it("refuses to load a selectable configuration with no configuration levels", async () => {
    const configuration = selectableConfiguration();
    delete configuration.selected_level_ids;
    await expect(loadWith([configuration])).rejects.toThrow(
      "selectable literature external execution lacks configuration levels",
    );
  });

  it("refuses to load a campaign binding with no aggregate evidence", async () => {
    await expect(
      loadWith([selectableConfiguration({ binding_kind: "campaign" })]),
    ).rejects.toThrow("campaign binding lacks aggregate evidence");
  });

  it("refuses to load two executions registered under one selection identity", async () => {
    await expect(
      loadWith([selectableConfiguration(), selectableConfiguration()]),
    ).rejects.toThrow(/^duplicate literature external execution: /);
  });
});
