import { afterEach, describe, expect, it, vi } from "vitest";

import androidRegistryJson from "@/generated/android-method-profile-runtime-registry.json" with { type: "json" };
import registryJson from "@/generated/source-artifact-provenance-registry.json" with { type: "json" };
import {
  androidMethodProfileConfigurationIsExecutionEligible,
  androidMethodProfileRegisteredComponents,
  methodProfileOutputBindingsForReceipt,
  methodProfileTypedSectionMatchesRegistry,
  registerSourceArtifactProvenance,
  sourceArtifactProvenanceJcsDigest,
  validateMethodProfileOutputBindings,
} from "@/lib/sourceArtifactProvenanceRegistry";

/**
 * The reject codes and `false` verdicts of the closed registries in
 * `src/generated/source-artifact-provenance-registry.json` and
 * `src/generated/android-method-profile-runtime-registry.json`. The provenance
 * registry's own eleven `negative_fixtures` are replayed by
 * `sourceArtifactProvenanceRegistry.test.ts`; those eleven forgeries never
 * touch the contract-operation, non-string-id or provenance-identity arms, and
 * the shipped Android registry carries no output binding and completes no
 * configuration, so those rules are exercised here against a substituted
 * registry loaded through `vi.doMock`.
 */

const ANDROID_REGISTRY = "@/generated/android-method-profile-runtime-registry.json";
const PROVENANCE_REGISTRY = "@/generated/source-artifact-provenance-registry.json";

type Json = Record<string, unknown>;

const androidArtifact = androidRegistryJson as unknown as {
  profiles: Array<Json & {
    method_profile_id: string;
    source_work_id: string;
    source_method_variant_id: string;
    method_profile_version: string;
    typed_sections: Record<string, string>;
  }>;
};

const positiveFixtureInput = (registryJson as unknown as {
  positive_fixtures: Array<{ input: Json }>;
}).positive_fixtures[0]!.input;

function input(overrides: Json = {}): Json {
  return { ...structuredClone(positiveFixtureInput), ...overrides };
}

function identityOf(profile: {
  method_profile_id: string;
  source_work_id: string;
  source_method_variant_id: string;
  method_profile_version: string;
}) {
  return {
    method_profile_id: profile.method_profile_id,
    source_work_id: profile.source_work_id,
    source_method_variant_id: profile.source_method_variant_id,
    method_profile_version: profile.method_profile_version,
  };
}

function receiptOf(profile: {
  method_profile_id: string;
  source_work_id: string;
  source_method_variant_id: string;
  method_profile_version: string;
}) {
  return {
    methodProfileId: profile.method_profile_id,
    sourceWorkId: profile.source_work_id,
    sourceMethodVariantId: profile.source_method_variant_id,
    methodProfileVersion: profile.method_profile_version,
  };
}

async function loadWithAndroidProfiles(profiles: unknown[]) {
  vi.doMock(ANDROID_REGISTRY, () => ({
    default: { ...androidRegistryJson, profiles },
  }));
  vi.resetModules();
  return import("@/lib/sourceArtifactProvenanceRegistry");
}

afterEach(() => {
  vi.doUnmock(ANDROID_REGISTRY);
  vi.doUnmock(PROVENANCE_REGISTRY);
  vi.resetModules();
});

describe("registerSourceArtifactProvenance rejects", () => {
  it("accepts the registry's own first positive fixture unchanged", async () => {
    await expect(registerSourceArtifactProvenance(input())).resolves.toMatchObject({
      accepted: true,
      registryStatus: "registered_documentary_provenance",
      executionEligible: false,
    });
  });

  it.each([
    [
      "an operation name the v1 contract does not define",
      { operation: "delete_source_artifact_provenance" },
      "unsupported_contract_operation",
    ],
    [
      "a public contract version the registry does not serve",
      { public_contract_version: "source-artifact-provenance-registry/v2" },
      "unsupported_contract_operation",
    ],
    [
      "a method setting id that is not a string",
      { method_setting_id: 7 },
      "unknown_setting_id",
    ],
  ])("rejects %s", async (_label, overrides, errorCode) => {
    await expect(registerSourceArtifactProvenance(input(overrides))).resolves.toEqual({
      accepted: false,
      registryStatus: "rejected",
      errorCode,
      artifactContentsAvailable: false,
      contentDigestVerified: false,
      executionEligible: false,
    });
  });

  it("rejects a provenance object whose id names a different setting", async () => {
    const candidate = input();
    (candidate.source_artifact_provenance as Json).source_artifact_provenance_id =
      "source-artifact-provenance:method-setting-ba42e53a2bb684a034aa67e0";
    await expect(registerSourceArtifactProvenance(candidate)).resolves.toMatchObject({
      accepted: false,
      errorCode: "provenance_setting_identity_mismatch",
    });
  });

  it("rejects every input once the registry artifact itself fails validation", async () => {
    vi.doMock(PROVENANCE_REGISTRY, () => ({
      default: { ...registryJson, schema_version: "drifted/v0" },
    }));
    vi.resetModules();
    const module = await import("@/lib/sourceArtifactProvenanceRegistry");
    await expect(module.registerSourceArtifactProvenance(input())).resolves.toMatchObject({
      accepted: false,
      errorCode: "registry_artifact_invalid",
    });
    await expect(module.validateSourceArtifactProvenanceRegistry()).rejects.toThrow(
      "source-artifact provenance registry content drift",
    );
  });

  it("reports row drift by the setting id whose provenance no longer hashes to its digest", async () => {
    const rows = structuredClone(registryJson.rows) as Array<Json & {
      method_setting_id: string;
      source_artifact_provenance_object_digest: string;
    }>;
    rows[0]!.source_artifact_provenance_object_digest = `sha256:${"0".repeat(64)}`;
    const payload = { ...(registryJson as unknown as Json) };
    delete payload.content_digest;
    // The row loop runs only after the packet-level content digest matches, so
    // the substituted artifact is re-sealed over its own mutated payload.
    const resealed = { ...payload, rows };
    const sealDigest = await sourceArtifactProvenanceJcsDigest(resealed);
    vi.doMock(PROVENANCE_REGISTRY, () => ({
      default: { ...resealed, content_digest: sealDigest },
    }));
    vi.resetModules();
    const module = await import("@/lib/sourceArtifactProvenanceRegistry");
    await expect(module.registerSourceArtifactProvenance(input())).resolves.toMatchObject({
      accepted: false,
      errorCode: "registry_artifact_invalid",
    });
    await expect(module.validateSourceArtifactProvenanceRegistry()).rejects.toThrow(
      `source-artifact provenance row drift: ${rows[0]!.method_setting_id}`,
    );
  });
});

describe("android method profile configuration eligibility", () => {
  it("shows the registered full-profile explanation only for its exact identity", async () => {
    const profile = androidArtifact.profiles[0]!;
    const module = await loadWithAndroidProfiles([{ ...profile, full_profile_blocked_reason: "whole-profile execution unavailable" }]);
    expect(module.androidMethodProfileFullBlockedReason(identityOf(profile))).toBe("whole-profile execution unavailable");
    expect(module.androidMethodProfileFullBlockedReason({ ...identityOf(profile), method_profile_version: "unknown" })).toBeNull();
    const withoutReason = await loadWithAndroidProfiles([{ ...profile, full_profile_blocked_reason: null }]);
    expect(withoutReason.androidMethodProfileFullBlockedReason(identityOf(profile))).toBeNull();
  });
  const profile = androidArtifact.profiles[0]!;

  it("is false for a profile identity the android registry does not carry", () => {
    expect(
      androidMethodProfileConfigurationIsExecutionEligible({
        ...receiptOf(profile),
        methodProfileId: "method-profile:forged",
        sourceMethodVariantIds: [],
      }),
    ).toBe(false);
  });

  it("is false for every shipped profile, none of which completes a configuration", () => {
    expect(
      androidArtifact.profiles.every(
        (entry) =>
          (entry.completed_configurations as unknown[]).length === 0,
      ),
    ).toBe(true);
    for (const entry of androidArtifact.profiles) {
      expect(
        androidMethodProfileConfigurationIsExecutionEligible({
          ...receiptOf(entry),
          sourceMethodVariantIds: [entry.source_method_variant_id],
        }),
      ).toBe(false);
    }
  });

  it("matches only the eligible configuration whose combination and level set both agree", async () => {
    const module = await loadWithAndroidProfiles([
      {
        ...profile,
        completed_configurations: [
          {
            selected_combination_id: "combination:1",
            selected_level_ids: ["level:b", "level:a"],
            execution_eligible: true,
          },
          {
            selected_combination_id: "combination:2",
            selected_level_ids: ["level:a"],
            execution_eligible: true,
          },
          {
            selected_combination_id: "combination:3",
            selected_level_ids: ["level:a"],
            execution_eligible: false,
          },
        ],
      },
    ]);
    const receipt = {
      ...receiptOf(profile),
      sourceMethodVariantIds: ["level:a", "level:b"],
      sourceMethodCombinationId: "combination:1",
    };
    // The level ids are compared as sorted sets, so the receipt's order does
    // not matter but its membership does.
    expect(
      module.androidMethodProfileConfigurationIsExecutionEligible(receipt),
    ).toBe(true);
    expect(
      module.androidMethodProfileConfigurationIsExecutionEligible({
        ...receipt,
        sourceMethodVariantIds: ["level:b", "level:a"],
      }),
    ).toBe(true);
    expect(
      module.androidMethodProfileConfigurationIsExecutionEligible({
        ...receipt,
        sourceMethodVariantIds: ["level:a"],
      }),
    ).toBe(false);
    expect(
      module.androidMethodProfileConfigurationIsExecutionEligible({
        ...receipt,
        sourceMethodCombinationId: "combination:3",
        sourceMethodVariantIds: ["level:a"],
      }),
    ).toBe(false);
  });

  it("returns no registered components for an unregistered identity", () => {
    expect(
      androidMethodProfileRegisteredComponents({
        ...identityOf(profile),
        method_profile_version: "literature-sublation-v0-forged",
      }),
    ).toEqual([]);
  });
});

describe("method profile output bindings", () => {
  const profile = androidArtifact.profiles[0]!;
  const binding = {
    setting_id: "method-setting-output-a",
    output_kind: "app-csv",
    source_field: "usage_seconds",
    source_position: 1,
    canonical_field: "duration_seconds",
    conformance_fixture_id: "fixture:output-a",
    conformance_result_digest: `sha256:${"a".repeat(64)}`,
  };
  const second = {
    ...binding,
    setting_id: "method-setting-output-b",
    source_field: "screen_seconds",
    source_position: 0,
    output_kind: "screen-csv",
    conformance_fixture_id: "fixture:output-b",
  };

  const loadBindings = (bindings: unknown[]) =>
    loadWithAndroidProfiles([{ ...profile, output_bindings: bindings }]);

  it("expects nothing from the shipped registry, which declares no output binding", () => {
    expect(
      androidArtifact.profiles.every(
        (entry) => ((entry.output_bindings as unknown[] | undefined) ?? []).length === 0,
      ),
    ).toBe(true);
    expect(
      methodProfileOutputBindingsForReceipt(receiptOf(profile), ["method-setting-output-a"]),
    ).toEqual([]);
    expect(
      validateMethodProfileOutputBindings([], receiptOf(profile), []),
    ).toBe(true);
  });

  it("returns the registered bindings ordered by source position", async () => {
    const module = await loadBindings([binding, second]);
    expect(
      module.methodProfileOutputBindingsForReceipt(receiptOf(profile), [
        binding.setting_id,
        second.setting_id,
        "method-setting-unbound",
      ]),
    ).toEqual([
      {
        settingId: second.setting_id,
        outputKind: "screen-csv",
        sourceField: second.source_field,
        sourcePosition: 0,
        canonicalField: second.canonical_field,
        conformanceFixtureId: second.conformance_fixture_id,
        conformanceResultDigest: second.conformance_result_digest,
      },
      {
        settingId: binding.setting_id,
        outputKind: "app-csv",
        sourceField: binding.source_field,
        sourcePosition: 1,
        canonicalField: binding.canonical_field,
        conformanceFixtureId: binding.conformance_fixture_id,
        conformanceResultDigest: binding.conformance_result_digest,
      },
    ]);
  });

  it("refuses to state an expectation when the receipt claims a different profile", async () => {
    const module = await loadBindings([binding]);
    expect(
      module.methodProfileOutputBindingsForReceipt(
        { ...receiptOf(profile), sourceWorkId: "doi:forged" },
        [binding.setting_id],
      ),
    ).toBeUndefined();
    expect(
      module.validateMethodProfileOutputBindings(
        [],
        { ...receiptOf(profile), sourceWorkId: "doi:forged" },
        [binding.setting_id],
      ),
    ).toBe(false);
  });

  it("accepts exactly the registered bindings, in any order", async () => {
    const module = await loadBindings([binding, second]);
    const ids = [binding.setting_id, second.setting_id];
    const expected = module.methodProfileOutputBindingsForReceipt(
      receiptOf(profile),
      ids,
    )!;
    expect(
      module.validateMethodProfileOutputBindings(
        [...expected].reverse(),
        receiptOf(profile),
        ids,
      ),
    ).toBe(true);
  });

  it.each([
    ["a value that is not an array", (expected: unknown[]) => expected[0]],
    ["an array of the wrong length", (expected: unknown[]) => expected.slice(1)],
    ["a non-object in a binding slot", () => ["method-setting-output-a", null]],
    [
      "a binding carrying a field the contract does not declare",
      (expected: unknown[]) => [
        { ...(expected[0] as Json), smuggledField: 1 },
        expected[1],
      ],
    ],
    [
      "a binding whose canonical field was rewritten",
      (expected: unknown[]) => [
        { ...(expected[0] as Json), canonicalField: "forged" },
        expected[1],
      ],
    ],
  ])("rejects %s", async (_label, mutate) => {
    const module = await loadBindings([binding, second]);
    const ids = [binding.setting_id, second.setting_id];
    const expected = module.methodProfileOutputBindingsForReceipt(
      receiptOf(profile),
      ids,
    )!;
    expect(
      module.validateMethodProfileOutputBindings(
        mutate(expected),
        receiptOf(profile),
        ids,
      ),
    ).toBe(false);
  });

  it.each([
    ["an undeclared key", { extra_field: 1 }],
    ["an empty setting id", { setting_id: "" }],
    ["an output kind outside app-csv/screen-csv", { output_kind: "pdf" }],
    ["an empty source field", { source_field: "" }],
    ["a negative source position", { source_position: -1 }],
    ["a fractional source position", { source_position: 1.5 }],
    ["an empty canonical field", { canonical_field: "" }],
    ["an empty conformance fixture id", { conformance_fixture_id: "" }],
    ["a malformed conformance result digest", { conformance_result_digest: "sha256:zz" }],
  ])("refuses to load a registry whose binding has %s", async (_label, overrides) => {
    await expect(loadBindings([{ ...binding, ...overrides }])).rejects.toThrow(
      /^invalid or duplicate method-profile output binding: /,
    );
  });

  it("refuses to load a registry that binds one setting twice", async () => {
    await expect(loadBindings([binding, { ...binding }])).rejects.toThrow(
      `invalid or duplicate method-profile output binding: ${binding.setting_id}`,
    );
  });
});

describe("typed section reconciliation", () => {
  const nested = androidArtifact.profiles.flatMap((profile) =>
    Object.entries(profile.typed_sections)
      .filter(([, projection]) => projection.includes('"method_settings"'))
      .map(([section, projection]) => ({
        profile,
        section,
        registered: JSON.parse(projection) as unknown,
      })),
  );
  const plain = androidArtifact.profiles.flatMap((profile) =>
    Object.entries(profile.typed_sections)
      .filter(([, projection]) => !projection.includes('"method_settings"'))
      .map(([section, projection]) => ({
        profile,
        section,
        registered: JSON.parse(projection) as unknown,
      })),
  );

  /**
   * A registered nested section already holds ids where the unprojected value
   * holds whole settings, so the unprojected value is rebuilt by expanding each
   * registered id back into a setting object.
   */
  function expand(registered: unknown, suffix = ""): {
    value: unknown;
    settings: Json[];
  } {
    const settings: Json[] = [];
    const expandEntry = (entry: unknown): unknown => {
      const ids = (entry as { method_settings?: unknown } | null)?.method_settings;
      if (!Array.isArray(ids)) return entry;
      return {
        ...(entry as Json),
        method_settings: ids.map((id) => {
          const setting: Json = {
            method_setting_id: id,
            setting_label: `${String(id)}${suffix}`,
          };
          settings.push(setting);
          return setting;
        }),
      };
    };
    const value = Array.isArray(registered)
      ? registered.map(expandEntry)
      : expandEntry(registered);
    return { value, settings };
  }

  it("has both nested and plain typed sections to reconcile", () => {
    expect(nested.length).toBeGreaterThan(0);
    expect(plain.length).toBeGreaterThan(0);
  });

  it("refuses a section name the profile does not register", () => {
    const { profile } = plain[0]!;
    expect(
      methodProfileTypedSectionMatchesRegistry(
        identityOf(profile),
        "section-absent",
        {},
        [],
      ),
    ).toBe(false);
  });

  it("refuses a profile identity the android registry does not carry", () => {
    const { profile, section, registered } = plain[0]!;
    expect(
      methodProfileTypedSectionMatchesRegistry(
        { ...identityOf(profile), source_work_id: "doi:forged" },
        section,
        registered,
        [],
      ),
    ).toBe(false);
  });

  it("accepts a section whose locators still carry the checkout's absolute path", () => {
    // A locator recorded on one machine reads
    // `/Users/<someone>/chronicle-android-raw-data-preprocessing-app/<path>`;
    // the registry stores the repository-relative `<path>`. The projection
    // strips the checkout prefix, once per occurrence, so a locator that packs
    // two references into one `"; "`-joined string normalizes on both halves.
    const marker = "/chronicle-android-raw-data-preprocessing-app/";
    const candidate = plain.find(({ registered }) =>
      (Array.isArray(registered) ? registered : [registered]).some((entry: unknown) =>
        entry !== null && typeof entry === "object"
        && Array.isArray((entry as Json).source_locators)
        && ((entry as Json).source_locators as unknown[]).some((locator) =>
          typeof locator === "string" && locator.includes(".tmp-literature-review-private/corrective-packet-07"))),
    );
    expect(candidate).toBeDefined();
    const { profile, section, registered } = candidate!;
    const relocateEntry = (entry: unknown): unknown => {
      if (entry === null || typeof entry !== "object"
        || !Array.isArray((entry as Json).source_locators)) return entry;
      return { ...entry, source_locators: ((entry as Json).source_locators as unknown[]).map((locator) =>
        typeof locator === "string" ? locator.replaceAll(".tmp-literature-review-private/",
          `/Users/example${marker}.tmp-literature-review-private/`) : locator) };
    };
    const relocated = Array.isArray(registered) ? registered.map(relocateEntry) : relocateEntry(registered);
    expect(JSON.stringify(relocated)).toContain(marker);
    expect(
      methodProfileTypedSectionMatchesRegistry(
        identityOf(profile),
        section,
        relocated,
        [],
      ),
    ).toBe(true);
  });

  it("refuses a list section holding an entry that is not an object", () => {
    const candidate = plain.find(({ registered }) => Array.isArray(registered));
    expect(candidate).toBeDefined();
    const { profile, section, registered } = candidate!;
    expect(
      methodProfileTypedSectionMatchesRegistry(
        identityOf(profile),
        section,
        [...(registered as unknown[]), "not-an-object"],
        [],
      ),
    ).toBe(false);
  });

  it("refuses a section whose locator list carries an entry that is not a string", () => {
    const candidate = plain.find(({ registered }) =>
      JSON.stringify(registered).includes('"source_locators"'),
    );
    expect(candidate).toBeDefined();
    const { profile, section, registered } = candidate!;
    const withNumericLocator = JSON.parse(JSON.stringify(registered)) as unknown;
    const entry = (Array.isArray(withNumericLocator)
      ? withNumericLocator[0]
      : withNumericLocator) as { source_locators: unknown[] };
    entry.source_locators = [...entry.source_locators, 7];
    expect(
      methodProfileTypedSectionMatchesRegistry(
        identityOf(profile),
        section,
        withNumericLocator,
        [],
      ),
    ).toBe(false);
  });

  it("accepts a plain section whose canonical projection equals the registered string", () => {
    const { profile, section, registered } = plain[0]!;
    expect(
      methodProfileTypedSectionMatchesRegistry(
        identityOf(profile),
        section,
        registered,
        [],
      ),
    ).toBe(true);
  });

  it.each([
    [
      "an inventory entry that is not an object",
      ["method-setting-ae367bcfa8a615ce33dc5781"],
    ],
    [
      "an inventory entry with no string id",
      [{ method_setting_id: 7 }],
    ],
    [
      "an inventory that repeats one id",
      [
        { method_setting_id: "method-setting-duplicate" },
        { method_setting_id: "method-setting-duplicate" },
      ],
    ],
  ])("refuses %s", (_label, methodSettings) => {
    const { profile, section, registered } = plain[0]!;
    expect(
      methodProfileTypedSectionMatchesRegistry(
        identityOf(profile),
        section,
        registered,
        methodSettings,
      ),
    ).toBe(false);
  });

  it("projects an embedded method setting back to its id when it equals the inventory entry", () => {
    // A section that embeds whole settings is registered with each embedded
    // object replaced by its id; the embedded object still has to be
    // byte-identical to the inventory entry carrying that id.
    const { profile, section, registered } = nested[0]!;
    const { value, settings } = expand(registered);
    expect(settings.length).toBeGreaterThan(0);
    expect(
      methodProfileTypedSectionMatchesRegistry(
        identityOf(profile),
        section,
        value,
        settings,
      ),
    ).toBe(true);
  });

  it("refuses an embedded method setting that differs from the inventory entry of the same id", () => {
    const { profile, section, registered } = nested[0]!;
    const { value } = expand(registered);
    const { settings } = expand(registered, "-divergent");
    expect(
      methodProfileTypedSectionMatchesRegistry(
        identityOf(profile),
        section,
        value,
        settings,
      ),
    ).toBe(false);
  });

  it("refuses an embedded method setting the inventory does not carry at all", () => {
    const { profile, section, registered } = nested[0]!;
    const { value } = expand(registered);
    expect(
      methodProfileTypedSectionMatchesRegistry(
        identityOf(profile),
        section,
        value,
        [],
      ),
    ).toBe(false);
  });

  it("refuses an embedded method setting that is not an identified object", () => {
    const { profile, section, registered } = nested[0]!;
    const { value, settings } = expand(registered);
    const entries: unknown[] = Array.isArray(value) ? value : [value];
    const tampered = entries.map((entry): unknown => {
      const listed = (entry as { method_settings?: unknown }).method_settings;
      if (!Array.isArray(listed)) return entry;
      return {
        ...(entry as Json),
        method_settings: (listed as unknown[]).map(() => "not-an-object"),
      };
    });
    expect(
      methodProfileTypedSectionMatchesRegistry(
        identityOf(profile),
        section,
        Array.isArray(value) ? tampered : tampered[0],
        settings,
      ),
    ).toBe(false);
  });

  it("refuses a method_settings field that is not an array", () => {
    const { profile, section } = nested[0]!;
    expect(
      methodProfileTypedSectionMatchesRegistry(
        identityOf(profile),
        section,
        [{ method_settings: "method-setting-a" }],
        [],
      ),
    ).toBe(false);
  });
});
