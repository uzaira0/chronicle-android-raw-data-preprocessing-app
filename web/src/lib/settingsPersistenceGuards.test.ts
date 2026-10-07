import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  loadMethodReceiptValidation,
  readConfigFile,
  readPersistedMethodProfileReceipt,
  readPersistedMethodProfileReceipts,
  sanitizeMethodProfileReceipt,
  sanitizeOptions,
} from "@/lib/settingsPersistence";
import { createSleepDiaryMethodProfileReceipt } from "@/lib/sleepDiaryReplication";
import type { MethodProfileReceipt } from "@/lib/types";

// Receipt validation loads on demand in the app (see loadMethodReceiptValidation);
// these tests validate receipts synchronously, as App does once it has loaded.
beforeAll(async () => {
  await loadMethodReceiptValidation();
});

/**
 * `sanitizeMethodProfileReceipt` is the gate every persisted, imported or
 * shared method-profile receipt passes; it accepts only a receipt whose every
 * binding the closed registries in `src/lib/sourceArtifactProvenanceRegistry.ts`
 * and `src/lib/sleepDiaryReplication.ts` still vouch for, and returns
 * `undefined` otherwise. Each case starts from a receipt the runtime itself
 * builds and changes exactly one field.
 */
type Json = Record<string, unknown>;

let base: MethodProfileReceipt;

beforeEach(async () => {
  base = await createSleepDiaryMethodProfileReceipt();
});

function receipt(overrides: Json = {}): Json {
  return { ...(structuredClone(base) as unknown as Json), ...overrides };
}

describe("sanitizeMethodProfileReceipt", () => {
  it("returns the runtime's own sleep diary receipt unchanged", () => {
    expect(sanitizeMethodProfileReceipt(receipt())).toEqual(base);
  });

  it.each([
    ["a value that is not an object", "receipt"],
    ["an array", []],
    ["null", null],
    ["undefined", undefined],
  ])("drops %s", (_label, candidate) => {
    expect(sanitizeMethodProfileReceipt(candidate)).toBeUndefined();
  });

  it.each([
    ["a key the receipt contract does not declare", { smuggledField: 1 }],
    ["an empty method profile id", { methodProfileId: "" }],
    ["a non-string source work id", { sourceWorkId: 7 }],
    ["an empty method profile version", { methodProfileVersion: "" }],
    ["an empty source method combination id", { sourceMethodCombinationId: "" }],
    ["no source method variant id at all", { sourceMethodVariantIds: [] }],
    ["a non-string source method variant id", { sourceMethodVariantIds: [7] }],
    ["no setting id at all", { settingIds: [] }],
    ["a repeated setting id", { settingIds: ["a", "a"] }],
    ["a setting id nothing binds", { settingIds: ["setting:unbound"] }],
    ["documentary bindings that are not an array", { documentaryBindings: {} }],
    ["output bindings that are not an array", { outputBindings: {} }],
    ["external bindings that are not an array", { externalBindings: {} }],
    ["a diary replication binding the bridge disowns", {
      diaryReplicationBinding: { contractVersion: "forged" },
    }],
  ])("drops a receipt with %s", (_label, overrides) => {
    expect(sanitizeMethodProfileReceipt(receipt(overrides))).toBeUndefined();
  });

  it("drops a receipt whose repeated source method variant ids hide a second axis", () => {
    expect(
      sanitizeMethodProfileReceipt(
        receipt({
          sourceMethodVariantIds: [
            base.sourceMethodVariantId,
            base.sourceMethodVariantId,
          ],
        }),
      ),
    ).toBeUndefined();
  });

  it.each([
    ["a key the binding contract does not declare", { smuggledField: 1 }],
    ["an empty setting id", { settingId: "" }],
    ["an empty slot", { slot: "" }],
    ["no bound value", { value: undefined }],
    ["an empty conformance fixture id", { conformanceFixtureId: "" }],
    ["a conformance digest that is not a sha256", { conformanceResultDigest: "sha256:zz" }],
  ])("drops a receipt whose binding has %s", (_label, overrides) => {
    const binding = {
      settingId: base.settingIds[0]!,
      slot: "minimum_usage_duration",
      value: 60,
      conformanceFixtureId: "fixture.v1",
      conformanceResultDigest: `sha256:${"a".repeat(64)}`,
      ...overrides,
    };
    expect(sanitizeMethodProfileReceipt(receipt({ bindings: [binding] }))).toBeUndefined();
  });

  it("drops a diary receipt that also claims a configuration combination", () => {
    expect(
      sanitizeMethodProfileReceipt(receipt({ sourceMethodCombinationId: "combination:1" })),
    ).toBeUndefined();
  });

  it("drops a diary binding whose identity no longer matches the receipt", () => {
    expect(
      sanitizeMethodProfileReceipt(
        receipt({ methodProfileId: `${base.methodProfileId}-relabelled` }),
      ),
    ).toBeUndefined();
  });

  it("drops an android receipt whose configuration the registry does not call execution-eligible", () => {
    expect(
      sanitizeMethodProfileReceipt({
        methodProfileId: "method-profile:doi:10.1016/j.chb.2023.107977",
        sourceWorkId: "doi:10.1016/j.chb.2023.107977",
        sourceMethodVariantId: "source-configuration-space-8b14e63d69954819163df993",
        sourceMethodVariantIds: ["source-configuration-space-8b14e63d69954819163df993"],
        methodProfileVersion: "literature-sublation-v3-atomic",
        settingIds: ["setting:1"],
        bindings: [{
          settingId: "setting:1",
          slot: "minimum_usage_duration",
          value: 60,
          conformanceFixtureId: "fixture.v1",
          conformanceResultDigest: `sha256:${"a".repeat(64)}`,
        }],
      }),
    ).toBeUndefined();
  });

  it("drops more external bindings than one receipt can carry", () => {
    expect(
      sanitizeMethodProfileReceipt(receipt({ externalBindings: [{}, {}] })),
    ).toBeUndefined();
  });

  it("drops the one external binding the registry has no execution receipt for", () => {
    // Length one, so the rejection has to come from the per-binding check in
    // `literatureExternalExecutors.validateLiteratureExternalExecutionBinding`,
    // not from the arity rule above.
    expect(
      sanitizeMethodProfileReceipt(receipt({ externalBindings: [{}] })),
    ).toBeUndefined();
  });
});

/**
 * The documentary and output halves of a receipt. The shipped Android registry
 * (`src/generated/android-method-profile-runtime-registry.json`) declares no
 * output binding and completes no configuration, so a receipt carrying either
 * one can only be built against a substituted registry — the same `vi.doMock`
 * seam `sourceArtifactProvenanceRegistryGuards.test.ts` uses.
 */
describe("documentary and output bindings against a substituted Android registry", () => {
  const ANDROID_REGISTRY = "@/generated/android-method-profile-runtime-registry.json";
  /** A provenance row whose `candidate_status` is `ready_for_typed_registry`. */
  const DOCUMENTARY_SETTING = "method-setting-0d4c2d71ec4c6dea11ac19b0";
  const OUTPUT_SETTING = "method-setting-output-a";
  const outputBinding = {
    setting_id: OUTPUT_SETTING,
    output_kind: "app-csv",
    source_field: "usage_seconds",
    source_position: 0,
    canonical_field: "duration_seconds",
    conformance_fixture_id: "fixture:output-a",
    conformance_result_digest: `sha256:${"a".repeat(64)}`,
  };

  afterEach(() => {
    vi.doUnmock(ANDROID_REGISTRY);
    vi.resetModules();
  });

  async function loadWithCompletedConfiguration() {
    const registry = (await import(
      "@/generated/android-method-profile-runtime-registry.json"
    )).default as unknown as { profiles: Array<Record<string, unknown>> };
    const provenance = await import("@/lib/sourceArtifactProvenanceRegistry");
    const identity = provenance.sourceArtifactProfileIdentityForSetting(
      DOCUMENTARY_SETTING,
    )!;
    const profiles = registry.profiles.map((profile) =>
      profile.method_profile_id === identity.method_profile_id
        && profile.source_method_variant_id === identity.source_method_variant_id
        ? {
            ...profile,
            output_bindings: [outputBinding],
            completed_configurations: [{
              selected_level_ids: [identity.source_method_variant_id],
              execution_eligible: true,
            }],
          }
        : profile,
    );
    vi.doMock(ANDROID_REGISTRY, () => ({ default: { ...registry, profiles } }));
    vi.resetModules();
    const persistence = await import("@/lib/settingsPersistence");
    // A fresh module instance validates against the substituted registry.
    await persistence.loadMethodReceiptValidation();
    const substituted = await import("@/lib/sourceArtifactProvenanceRegistry");
    return { identity, persistence, substituted };
  }

  function receiptFor(
    identity: { method_profile_id: string; source_work_id: string; source_method_variant_id: string; method_profile_version: string },
    overrides: Json,
  ): Json {
    return {
      methodProfileId: identity.method_profile_id,
      sourceWorkId: identity.source_work_id,
      sourceMethodVariantId: identity.source_method_variant_id,
      sourceMethodVariantIds: [identity.source_method_variant_id],
      methodProfileVersion: identity.method_profile_version,
      bindings: [],
      ...overrides,
    };
  }

  it("keeps a documentary binding the provenance registry vouches for and counts its setting", async () => {
    const { identity, persistence, substituted } =
      await loadWithCompletedConfiguration();
    const documentary = substituted.sourceArtifactDocumentaryBindingForSetting(
      DOCUMENTARY_SETTING,
    )!;
    expect(
      persistence.sanitizeMethodProfileReceipt(
        receiptFor(identity, {
          settingIds: [DOCUMENTARY_SETTING],
          documentaryBindings: [documentary],
        }),
      ),
    ).toMatchObject({
      settingIds: [DOCUMENTARY_SETTING],
      documentaryBindings: [documentary],
    });
  });

  it("keeps an output binding the Android registry registers and counts its setting", async () => {
    const { identity, persistence, substituted } =
      await loadWithCompletedConfiguration();
    const registered = substituted.methodProfileOutputBindingForSetting(
      OUTPUT_SETTING,
    )!;
    expect(
      persistence.sanitizeMethodProfileReceipt(
        receiptFor(identity, {
          settingIds: [OUTPUT_SETTING],
          outputBindings: [registered],
        }),
      ),
    ).toMatchObject({
      settingIds: [OUTPUT_SETTING],
      outputBindings: [registered],
    });
  });

  it("keeps the one external execution binding the executor registry registers", async () => {
    // Both registries have to be substituted at once: the executor registry so
    // a `user_selectable_alternative` configuration exists to bind, and the
    // Android registry so that configuration is execution-eligible.
    const executors = (await import(
      "@/generated/literature-external-executor-registry.json"
    )).default as unknown as { executors: Array<Record<string, unknown>> };
    const provenance = await import("@/lib/sourceArtifactProvenanceRegistry");
    const identity = provenance.sourceArtifactProfileIdentityForSetting(
      DOCUMENTARY_SETTING,
    )!;
    const shipped = executors.executors[0]! as Record<string, unknown> & {
      configurations: Array<Record<string, unknown>>;
    };
    vi.doMock("@/generated/literature-external-executor-registry.json", () => ({
      default: {
        ...executors,
        executors: [{
          ...shipped,
          source_method_variant_id: identity.source_method_variant_id,
          method_profile_version: identity.method_profile_version,
          configurations: [{
            ...structuredClone(shipped.configurations[0]!),
            configuration_unit_kind: "user_selectable_alternative",
            selected_level_ids: [identity.source_method_variant_id],
          }],
        }],
      },
    }));
    const { persistence } = await loadWithCompletedConfiguration();
    const external = await import("@/lib/literatureExternalExecutors");
    const binding = external.literatureExternalExecutionForSelection({
      methodProfileId: identity.method_profile_id,
      sourceWorkId: identity.source_work_id,
      sourceMethodVariantId: identity.source_method_variant_id,
      sourceMethodVariantIds: [identity.source_method_variant_id],
      methodProfileVersion: identity.method_profile_version,
    })!;
    expect(binding.settingIds.length).toBeGreaterThan(0);

    expect(
      persistence.sanitizeMethodProfileReceipt(
        receiptFor(identity, {
          settingIds: binding.settingIds,
          externalBindings: [binding],
        }),
      ),
    ).toMatchObject({
      settingIds: binding.settingIds,
      externalBindings: [binding],
    });
    vi.doUnmock("@/generated/literature-external-executor-registry.json");
  });

  it("drops a receipt whose settings the documentary and output bindings do not cover", async () => {
    const { identity, persistence, substituted } =
      await loadWithCompletedConfiguration();
    const documentary = substituted.sourceArtifactDocumentaryBindingForSetting(
      DOCUMENTARY_SETTING,
    )!;
    expect(
      persistence.sanitizeMethodProfileReceipt(
        receiptFor(identity, {
          settingIds: [DOCUMENTARY_SETTING, OUTPUT_SETTING],
          documentaryBindings: [documentary],
        }),
      ),
    ).toBeUndefined();
  });
});

describe("sanitizeOptions numeric repair", () => {
  it.each([
    ["a string", "sixty"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("restores the contract default for a duration floor that is %s", (_label, saved) => {
    expect(sanitizeOptions({ minimumUsageDuration: saved }).minimumUsageDuration)
      .toBe(DEFAULT_BROWSER_OPTIONS.minimumUsageDuration);
  });

  it.each([
    ["a value above the contract ceiling", 5000, 3600],
    ["a negative value", -5, 0],
    ["a fractional value", 60.4, 60],
  ])("repairs %s toward what was saved rather than the default", (_label, saved, expected) => {
    expect(sanitizeOptions({ minimumUsageDuration: saved }).minimumUsageDuration).toBe(expected);
  });

  it.each([
    ["polledEmulationIntervalSeconds", 7200, 3600],
    ["polledEmulationIntervalSeconds", 0, 1],
    ["polledEmulationGapSeconds", 7200, 3600],
    ["polledEmulationGapSeconds", -1, 0],
  ])("clamps %s into its declared range", (key, saved, expected) => {
    const options = sanitizeOptions({ [key]: saved }) as unknown as Record<string, number>;
    expect(options[key]).toBe(expected);
  });

  it.each([
    ["polledEmulationIntervalSeconds", "fast"],
    ["polledEmulationIntervalSeconds", Number.NaN],
    ["polledEmulationGapSeconds", "fast"],
    ["polledEmulationGapSeconds", Number.POSITIVE_INFINITY],
  ])(
    "restores the contract default for a %s that is not a finite number",
    (key, saved) => {
      const options = sanitizeOptions({ [key]: saved }) as unknown as Record<string, number>;
      expect(options[key]).toBe(
        (DEFAULT_BROWSER_OPTIONS as unknown as Record<string, number>)[key],
      );
    },
  );
});

describe("persisted receipt reads", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  } as unknown as Storage;

  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it("returns no receipts when there is no window to read from", () => {
    expect(readPersistedMethodProfileReceipts()).toEqual({});
    expect(readPersistedMethodProfileReceipt()).toBeNull();
  });

  it("returns no receipts when storage holds text that is not JSON", () => {
    store.set("chronicle.processingOptions.v1", "{not json");
    vi.stubGlobal("window", { localStorage: storage });
    expect(readPersistedMethodProfileReceipts()).toEqual({});
    expect(readPersistedMethodProfileReceipt()).toBeNull();
  });

  it("returns no receipts when nothing has been persisted", () => {
    vi.stubGlobal("window", { localStorage: storage });
    expect(readPersistedMethodProfileReceipts()).toEqual({});
    expect(readPersistedMethodProfileReceipt()).toBeNull();
  });
});

describe("readConfigFile", () => {
  it("refuses a file that is not JSON by name", async () => {
    await expect(
      readConfigFile(new File(["{not json"], "config.json", { type: "application/json" })),
    ).rejects.toThrow(
      "The selected file is not valid JSON. Make sure you're importing a Chronicle config file.",
    );
  });

  it("refuses a JSON file that carries no settings envelope", async () => {
    await expect(
      readConfigFile(new File(["{}"], "config.json", { type: "application/json" })),
    ).rejects.toThrow("This file is not a Chronicle config export");
  });

  it("keeps the contract defaults for an envelope whose settings are empty", async () => {
    const imported = await readConfigFile(
      new File([JSON.stringify({ currentSettings: {}, presets: [] })], "config.json", {
        type: "application/json",
      }),
    );
    expect(imported.options).toEqual(sanitizeOptions(undefined));
    expect(imported.presets).toEqual([]);
    expect(imported.methodProfileReceipt).toBeUndefined();
  });

  it("drops an imported receipt whose bindings the imported options do not satisfy", async () => {
    const envelope = JSON.stringify({
      currentSettings: { minimumUsageDuration: 60 },
      currentMethodProfileReceipt: {
        ...(structuredClone(base) as unknown as Json),
        bindings: [{
          settingId: base.settingIds[0]!,
          slot: "minimum_usage_duration",
          value: 999,
          conformanceFixtureId: "fixture.v1",
          conformanceResultDigest: `sha256:${"a".repeat(64)}`,
        }],
      },
      presets: [],
    });
    const imported = await readConfigFile(
      new File([envelope], "config.json", { type: "application/json" }),
    );
    expect(imported.methodProfileReceipt).toBeUndefined();
  });
});
