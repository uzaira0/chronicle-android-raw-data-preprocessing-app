import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BROWSER_OPTIONS,
  OPENER_SET_VALUES,
  RESEARCH_AXIS_BROWSER_OPTION_KEYS,
  RESEARCH_AXIS_VALUES_BY_OPTION,
} from "@/lib/generatedContract";
import { MAXIMUM_DURATION_VECTOR_KEYS } from "@/lib/maximumDurationVector";
import { createSleepDiaryMethodProfileReceipt } from "@/lib/sleepDiaryReplication";
import { sourceArtifactDocumentaryBindingForSetting } from "@/lib/sourceArtifactProvenanceRegistry";
import {
  buildConfigExportBlob,
  hasPersistedOptions,
  loadMethodReceiptValidation,
  persistOptions,
  persistPresets,
  readConfigFile,
  readPersistedMethodProfileReceipt,
  readPersistedOptions,
  readPersistedPresets,
  readSharedConfig,
  sanitizeMethodProfileReceipt,
  sanitizeOptions,
  SETTINGS_SCHEMA_VERSION,
} from "@/lib/settingsPersistence";

// Receipt validation loads on demand in the app (see loadMethodReceiptValidation);
// these tests validate receipts synchronously, as App does once it has loaded.
beforeAll(async () => {
  await loadMethodReceiptValidation();
});

const METHOD_RECEIPT = {
  methodProfileId: "profile:paper:primary",
  sourceWorkId: "doi:paper",
  sourceMethodVariantId: "primary",
  sourceMethodVariantIds: ["primary"],
  methodProfileVersion: "v1",
  settingIds: ["setting:duration"],
  bindings: [{
    settingId: "setting:duration",
    slot: "minimum_usage_duration",
    value: 15,
    conformanceFixtureId: "fixture:paper:duration",
    conformanceResultDigest: `sha256:${"a".repeat(64)}`,
  }],
};

/** Minimal in-memory localStorage — same surface the module touches. */
function fakeLocalStorage(overrides: Partial<Storage> = {}) {
  const store = new Map<string, string>();
  return {
    store,
    storage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      ...overrides,
    } as unknown as Storage,
  };
}

describe("sanitizeOptions", () => {
  it("keeps typed values and drops mistyped ones per key family", () => {
    const next = sanitizeOptions({
      processAppUsage: false, // boolean kept
      processScreenUsage: "yes", // mistyped → default
      minimumUsageDuration: 45, // number kept
      proximityIntervalSeconds: Number.NaN, // non-finite → default
      selectedTimezone: "America/Chicago", // string kept
      studyName: 7, // mistyped → default
      parallelMaxWorkers: "6", // optionalPositiveInteger coerces
    });
    expect(next.processAppUsage).toBe(false);
    expect(next.processScreenUsage).toBe(DEFAULT_BROWSER_OPTIONS.processScreenUsage);
    expect(next.minimumUsageDuration).toBe(45);
    expect(next.proximityIntervalSeconds).toBe(DEFAULT_BROWSER_OPTIONS.proximityIntervalSeconds);
    expect(next.selectedTimezone).toBe("America/Chicago");
    expect(next.studyName).toBe(DEFAULT_BROWSER_OPTIONS.studyName);
    expect(next.parallelMaxWorkers).toBe(6);
  });

  it("accepts the exact opener enum and defaults unknown, wrong-type, null, and missing", () => {
    expect(OPENER_SET_VALUES).toEqual([
      "strategy_defined",
      "activity_resumed_only",
      "gesis_app_scoped_starts",
    ]);
    expect(DEFAULT_BROWSER_OPTIONS.openerSet).toBe("strategy_defined");

    for (const openerSet of OPENER_SET_VALUES) {
      expect(sanitizeOptions({ openerSet }).openerSet).toBe(openerSet);
    }

    const invalidValues: unknown[] = [
      "unknown_opener",
      1,
      null,
    ];
    for (const openerSet of invalidValues) {
      expect(sanitizeOptions({ openerSet }).openerSet).toBe("strategy_defined");
    }
    expect(sanitizeOptions({}).openerSet).toBe("strategy_defined");
  });

  it("validates every ontology-backed axis and supplies old-envelope defaults", () => {
    for (const key of RESEARCH_AXIS_BROWSER_OPTION_KEYS) {
      // The B06 maximum-duration keys are optional and travel as one vector:
      // a lone value is not a legal shape and is sanitized to omission. They
      // are covered by the dedicated vector test below.
      if ((MAXIMUM_DURATION_VECTOR_KEYS as readonly string[]).includes(key)) continue;
      const allowed = RESEARCH_AXIS_VALUES_BY_OPTION[key] as readonly string[];
      for (const value of allowed) {
        expect(
          (sanitizeOptions({ [key]: value }) as Record<string, unknown>)[key],
          `${key} accepts ${value}`,
        ).toBe(value);
      }
      for (const value of ["unknown_axis_value", 1, null, [], {}]) {
        expect(
          (sanitizeOptions({ [key]: value }) as Record<string, unknown>)[key],
          `${key} rejects ${JSON.stringify(value)}`,
        ).toBe((DEFAULT_BROWSER_OPTIONS as Record<string, unknown>)[key]);
      }
      expect(
        (sanitizeOptions({}) as Record<string, unknown>)[key],
        `${key} defaults when absent from an old envelope`,
      ).toBe((DEFAULT_BROWSER_OPTIONS as Record<string, unknown>)[key]);
    }
  });

  it("keeps the five legal maximum-duration vectors and returns every other present vector to omission atomically", () => {
    const legal: Array<Record<string, unknown>> = [
      {},
      {
        maximumDurationPolicy: "strategy_native",
        maximumDurationDisposition: "not_applicable",
        maximumDurationThresholdSource: "strategy_native",
      },
      {
        maximumDurationPolicy: "chronicle_observed_close_rejection_v1",
        maximumDurationDisposition: "not_applicable",
        maximumDurationThresholdSource: "chronicle_legacy_config",
      },
      {
        maximumDurationPolicy: "post_reconstruction_strict_max_v1",
        maximumDurationDisposition: "truncate_to_threshold",
        maximumDurationThresholdSource: "fixed_parameter",
        maximumDurationThresholdNs: "3600000000000",
      },
      {
        maximumDurationPolicy: "post_reconstruction_strict_max_v1",
        maximumDurationDisposition: "drop_row",
        maximumDurationThresholdSource: "b12_adaptive_participant",
      },
    ];
    for (const vector of legal) {
      const sanitized = sanitizeOptions({ ...vector, longDurationThresholdHoursExplicit: true });
      for (const key of MAXIMUM_DURATION_VECTOR_KEYS) {
        expect(sanitized[key], `${JSON.stringify(vector)} keeps ${key}`).toBe(vector[key]);
        expect(key in sanitized, `${key} own-property presence`).toBe(vector[key] !== undefined);
      }
      expect(sanitized.longDurationThresholdHoursExplicit).toBe(true);
    }
    const invalid: Array<Record<string, unknown>> = [
      // a lone key, a missing sibling, a wrong pairing, a malformed threshold
      { maximumDurationPolicy: "strategy_native" },
      { maximumDurationDisposition: "drop_row" },
      { maximumDurationThresholdNs: "3600000000000" },
      {
        maximumDurationPolicy: "strategy_native",
        maximumDurationDisposition: "not_applicable",
        maximumDurationThresholdSource: "chronicle_legacy_config",
      },
      {
        maximumDurationPolicy: "post_reconstruction_strict_max_v1",
        maximumDurationDisposition: "not_applicable",
        maximumDurationThresholdSource: "fixed_parameter",
        maximumDurationThresholdNs: "3600000000000",
      },
      {
        maximumDurationPolicy: "post_reconstruction_strict_max_v1",
        maximumDurationDisposition: "drop_row",
        maximumDurationThresholdSource: "fixed_parameter",
        maximumDurationThresholdNs: "01",
      },
      {
        maximumDurationPolicy: "post_reconstruction_strict_max_v1",
        maximumDurationDisposition: "drop_row",
        maximumDurationThresholdSource: "fixed_parameter",
        maximumDurationThresholdNs: "9223372036854775808",
      },
      {
        maximumDurationPolicy: "post_reconstruction_strict_max_v1",
        maximumDurationDisposition: "drop_row",
        maximumDurationThresholdSource: "fixed_parameter",
        maximumDurationThresholdNs: 3600000000000,
      },
      {
        maximumDurationPolicy: "unknown_policy",
        maximumDurationDisposition: "not_applicable",
        maximumDurationThresholdSource: "strategy_native",
      },
    ];
    for (const vector of invalid) {
      const sanitized = sanitizeOptions({ ...vector, longDurationThresholdHoursExplicit: true });
      for (const key of MAXIMUM_DURATION_VECTOR_KEYS) {
        expect(key in sanitized, `${JSON.stringify(vector)} drops ${key}`).toBe(false);
      }
      // The legacy-origin marker leaves with the vector; it is never upgraded
      // to an explicit strategy_native selection.
      expect("longDurationThresholdHoursExplicit" in sanitized).toBe(false);
    }
    // The marker alone is legal (an explicit legacy hours choice, B06 omitted);
    // `false` is not a wire value.
    expect(sanitizeOptions({ longDurationThresholdHoursExplicit: true }).longDurationThresholdHoursExplicit).toBe(true);
    expect("longDurationThresholdHoursExplicit" in sanitizeOptions({ longDurationThresholdHoursExplicit: false })).toBe(false);
    // An old envelope stays omitted.
    for (const key of MAXIMUM_DURATION_VECTOR_KEYS) {
      expect(key in sanitizeOptions({ schemaVersion: 4, openerSet: "strategy_defined" })).toBe(false);
    }
  });

  it("repairs an out-of-contract minimum duration toward the saved value, not the default", () => {
    // The contract declares an integer in [0, 3600]. Repairing toward what was
    // saved keeps the settings panel, the presets, the last-run options and the
    // saved project pointing where the researcher pointed them; snapping a
    // 5000 back to the 60 s default did not.
    expect(sanitizeOptions({ minimumUsageDuration: 5000 }).minimumUsageDuration).toBe(3600);
    expect(sanitizeOptions({ minimumUsageDuration: -1 }).minimumUsageDuration).toBe(0);
    expect(sanitizeOptions({ minimumUsageDuration: 59.5 }).minimumUsageDuration).toBe(60);
    expect(sanitizeOptions({ minimumUsageDuration: 1.5 }).minimumUsageDuration).toBe(2);
    expect(sanitizeOptions({ minimumUsageDuration: 3601 }).minimumUsageDuration).toBe(3600);

    // A value that is not a number at all carries no intent to preserve.
    for (const minimumUsageDuration of [
      Number.POSITIVE_INFINITY,
      Number.NaN,
      "60",
      null,
    ]) {
      expect(sanitizeOptions({ minimumUsageDuration }).minimumUsageDuration).toBe(
        DEFAULT_BROWSER_OPTIONS.minimumUsageDuration,
      );
    }
  });

  it("floors positive parallelMaxWorkers, rejects zero/negative/empty", () => {
    expect(sanitizeOptions({ parallelMaxWorkers: 2.9 }).parallelMaxWorkers).toBe(2);
    expect(sanitizeOptions({ parallelMaxWorkers: 0 }).parallelMaxWorkers).toBeUndefined();
    expect(sanitizeOptions({ parallelMaxWorkers: -3 }).parallelMaxWorkers).toBeUndefined();
    expect(sanitizeOptions({ parallelMaxWorkers: "" }).parallelMaxWorkers).toBeUndefined();
  });

  it("converts the legacy usageSessionMode enum when the booleans are absent", () => {
    expect(sanitizeOptions({ usageSessionMode: "screen_usage" })).toMatchObject({
      processAppUsage: false,
      processScreenUsage: true,
    });
    expect(sanitizeOptions({ usageSessionMode: "app_usage" })).toMatchObject({
      processAppUsage: true,
      processScreenUsage: false,
    });
    // Explicit booleans win over the legacy enum.
    expect(
      sanitizeOptions({ usageSessionMode: "screen_usage", processAppUsage: true }),
    ).toMatchObject({ processAppUsage: true });
  });

  it("preserves remap entries for validation by the Rust authority", () => {
    const next = sanitizeOptions({
      interactionTypeRemap: [
        "Notification Interruption=>Activity Paused",
        "Whatever=>Not A Real Type",
      ],
    });
    expect(next.interactionTypeRemap).toEqual([
      "Notification Interruption=>Activity Paused",
      "Whatever=>Not A Real Type",
    ]);
  });

  it("returns pure defaults for a non-record input", () => {
    expect(sanitizeOptions(null)).toEqual({ ...DEFAULT_BROWSER_OPTIONS });
    expect(sanitizeOptions("junk")).toEqual({ ...DEFAULT_BROWSER_OPTIONS });
  });

  it("falls back to the default number-array when every entry is non-finite", () => {
    // A number-array key whose supplied entries all coerce to NaN yields an empty
    // filtered array, so sanitizeOptions restores the default rather than [].
    const next = sanitizeOptions({ longUsageDurationThresholds: ["x", "y", "z"] });
    expect(next.longUsageDurationThresholds).toEqual(
      DEFAULT_BROWSER_OPTIONS.longUsageDurationThresholds,
    );
    expect(next.longUsageDurationThresholds.length).toBeGreaterThan(0);
  });

  it("keeps only positive numeric thresholds (null is not 0)", () => {
    const next = sanitizeOptions({
      longUsageDurationThresholds: [-1, null, "NaN", "Infinity", {}, 1.5, 0, 3],
      longDataTimeGapThresholds: [null, -2, 2.5],
    });
    expect(next.longUsageDurationThresholds).toEqual([1.5, 3]);
    expect(next.longDataTimeGapThresholds).toEqual([2.5]);
    expect(sanitizeOptions({ longDataTimeGapThresholds: [null, -2] }).longDataTimeGapThresholds)
      .toEqual(DEFAULT_BROWSER_OPTIONS.longDataTimeGapThresholds);
  });

  it("repairs an unknown aggregate shape to the default", () => {
    expect(sanitizeOptions({ enableAggregates: true, aggregateShape: "evil" }).aggregateShape).toBe(
      DEFAULT_BROWSER_OPTIONS.aggregateShape,
    );
    expect(sanitizeOptions({ aggregateShape: "long" }).aggregateShape).toBe("long");
  });
});

describe("method profile receipt persistence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips only while its exact bindings still match the settings", () => {
    const { storage } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const options = { ...DEFAULT_BROWSER_OPTIONS, minimumUsageDuration: 15 };
    persistOptions(options, METHOD_RECEIPT);
    expect(readPersistedMethodProfileReceipt()).toEqual(METHOD_RECEIPT);
    persistOptions({ ...options, minimumUsageDuration: 16 }, METHOD_RECEIPT);
    expect(readPersistedMethodProfileReceipt()).toBeNull();
  });

  it("round-trips a typed input-only adapter receipt without inventing an option binding", () => {
    const { storage } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const receipt = {
      methodProfileId: "profile:paper:event-map",
      sourceWorkId: "doi:paper",
      sourceMethodVariantId: "primary",
      sourceMethodVariantIds: ["primary"],
      methodProfileVersion: "v1",
      settingIds: ["method-setting-0483653c3edaac4e21150447"],
      bindings: [],
      inputBindings: [{
        settingId: "method-setting-0483653c3edaac4e21150447",
        routeKind: "protocol_input" as const,
        inputRole: "raw_chronicle_csv",
        schemaId: "chronicle-raw-event-map/v1",
        adapterId: "chronicle.raw-event-map",
        adapterVersion: "v1",
        requiredFields: ["participant_id", "source_event_type", "source_event_type_map", "event_timestamp", "app_package_name when app-scoped"],
        sourceValue: "screen on/off",
        conformanceFixtureId: "literature-input.local-source-inventory.v1",
        conformanceResultDigest: `sha256:${"b".repeat(64)}`,
      }],
    };
    persistOptions(DEFAULT_BROWSER_OPTIONS, receipt);
    expect(readPersistedMethodProfileReceipt()).toEqual(receipt);
  });

  it("rejects a partial Android calendar receipt and an incomplete interval schema", () => {
    const { storage } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const requiredFields = [
      "participant_id",
      "start_date",
      "end_date",
      "exclusion_label",
      "exclusion_start_date",
      "exclusion_end_date",
    ];
    const settings = [
      ["method-setting-e5a87fa0f1a10d4184bfe018", "Remove holiday week 6"],
      ["method-setting-acbce6b9d05461111a8792b1", "exam weeks 8"],
      ["method-setting-0c549383fd539ac9ee4fa5f1", 16],
    ] as const;
    const receipt = {
      methodProfileId: "method-profile:doi:10.1016/j.compedu.2019.103611",
      sourceWorkId: "doi:10.1016/j.compedu.2019.103611",
      sourceMethodVariantId: "source-configuration-space-786d5a6f9db121084058ea05",
      sourceMethodVariantIds: ["source-configuration-space-786d5a6f9db121084058ea05"],
      methodProfileVersion: "literature-sublation-v3-atomic",
      settingIds: settings.map(([settingId]) => settingId),
      bindings: settings.map(([settingId]) => ({
        settingId,
        slot: "enable_study_window_filter",
        value: true,
        conformanceFixtureId: "study-window.explicit-interior-exclusions.v1",
        conformanceResultDigest: `sha256:${"c".repeat(64)}`,
      })),
      inputBindings: settings.map(([settingId, sourceValue]) => ({
        settingId,
        routeKind: "native_operator_parameter" as const,
        inputRole: "study_dates_file",
        schemaId: "chronicle-study-date-interior-exclusion/v1",
        adapterId: "chronicle.study-date-interior-exclusion",
        adapterVersion: "v1",
        requiredFields,
        sourceValue,
        conformanceFixtureId: "study-window.explicit-interior-exclusions.v1",
        conformanceResultDigest: `sha256:${"c".repeat(64)}`,
      })),
    };
    const options = { ...DEFAULT_BROWSER_OPTIONS, enableStudyWindowFilter: true };
    persistOptions(options, receipt);
    expect(readPersistedMethodProfileReceipt()).toBeNull();
    expect(sanitizeMethodProfileReceipt({
      ...receipt,
      inputBindings: receipt.inputBindings.map((binding) => ({
        ...binding,
        requiredFields: requiredFields.filter((field) => field !== "exclusion_end_date"),
      })),
    })).toBeUndefined();
  });

  it("persists the exact fixture-verified diary binding while its full profile remains blocked", async () => {
    const { storage } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const receipt = await createSleepDiaryMethodProfileReceipt();
    persistOptions(DEFAULT_BROWSER_OPTIONS, receipt);
    expect(readPersistedMethodProfileReceipt()).toEqual(receipt);
    expect(readPersistedMethodProfileReceipt()?.diaryReplicationBinding).toMatchObject({
      mappingProfileId: "sleepdiaries-v1-csv",
      profileExecutionStatus: "blocked",
      fixtureId: "sleepdiaries-v1-csv-basic",
    });
  });

  it("persists and reloads the exact blocked MiNap pairing receipt", async () => {
    const { storage } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const receipt = await createSleepDiaryMethodProfileReceipt(
      "version-zenodo-minap-v1.0",
      "minap-v1-event-sheet",
    );
    persistOptions(DEFAULT_BROWSER_OPTIONS, receipt);
    expect(readPersistedMethodProfileReceipt()).toEqual(receipt);
    expect(readPersistedMethodProfileReceipt()?.diaryReplicationBinding).toMatchObject({
      versionDefinitionId: "version-zenodo-minap-v1.0",
      sourceMethodVariantId: "version-zenodo-minap-v1.0",
      mappingProfileId: "minap-v1-event-sheet",
      profileExecutionStatus: "blocked",
      fixtureId: "minap-v1-event-pairing-basic",
      diaryItemCount: 16,
      formElementCount: 15,
      scheduleRuleCount: 3,
      administrationScheduleCount: 3,
      ruleDefinitionCount: 35,
    });
    expect(readPersistedMethodProfileReceipt()?.diaryReplicationBinding?.blockerCodes).toHaveLength(29);
  });

  it("rejects unknown outer receipt keys", () => {
    expect(sanitizeMethodProfileReceipt({ ...METHOD_RECEIPT, forged: true })).toBeUndefined();
  });

  it("persists only the closed source-schema binding and rejects inner, digest, and work mutations", () => {
    const sourceSchema = {
      methodSettingId: "method-setting-2749a0339e3c4bb4c3b0ba7e",
      sourceWorkId: "doi:10.1007/s00530-018-0601-1",
      sourceValue: "AppOpenEvent",
      sourceValueSha256: "e4951d31dcea641fbc0b49e2e10c55f616c33e4efea82184aea018fc81af079c",
      kind: "event_type" as const,
      sourceField: "source_event_type",
      sourceMatchValue: "AppOpenEvent",
      canonicalField: "interaction_type" as const,
      canonicalValue: "Activity Resumed",
      requiresPackage: true,
    };
    const receipt = {
      methodProfileId: "profile:source-schema",
      sourceWorkId: sourceSchema.sourceWorkId,
      sourceMethodVariantId: "fixed",
      sourceMethodVariantIds: ["fixed"],
      methodProfileVersion: "v1",
      settingIds: [sourceSchema.methodSettingId],
      bindings: [],
      inputBindings: [{
        settingId: sourceSchema.methodSettingId,
        routeKind: "protocol_input" as const,
        inputRole: "raw_chronicle_csv",
        schemaId: "chronicle-source-event-schema/v1",
        adapterId: "chronicle.source-event-schema",
        adapterVersion: "v1",
        requiredFields: ["participant_id", "source_event_type", "event_timestamp", "app_package_name when app-scoped"],
        sourceValue: "AppOpenEvent",
        sourceWorkId: sourceSchema.sourceWorkId,
        sourceValueSha256: sourceSchema.sourceValueSha256,
        sourceSchema,
        conformanceFixtureId: "event-schema-app-open-canonical-2749a033.v1",
        conformanceResultDigest: `sha256:${"c".repeat(64)}`,
      }],
    };
    expect(sanitizeMethodProfileReceipt(receipt)).toEqual(receipt);
    expect(sanitizeMethodProfileReceipt({ ...receipt, sourceWorkId: "doi:forged" })).toBeUndefined();
    expect(sanitizeMethodProfileReceipt({ ...receipt, inputBindings: [{ ...receipt.inputBindings[0], sourceValueSha256: "0".repeat(64) }] })).toBeUndefined();
    expect(sanitizeMethodProfileReceipt({ ...receipt, inputBindings: [{ ...receipt.inputBindings[0], forged: true }] })).toBeUndefined();
    expect(sanitizeMethodProfileReceipt({ ...receipt, inputBindings: [{
      ...receipt.inputBindings[0], sourceSchema: { ...sourceSchema, canonicalValue: "Screen Interactive" },
    }] })).toBeUndefined();
  });

  it("rejects forged diary outer profile identity and version", async () => {
    const receipt = await createSleepDiaryMethodProfileReceipt();
    expect(sanitizeMethodProfileReceipt({ ...receipt, methodProfileId: "forged" })).toBeUndefined();
    expect(sanitizeMethodProfileReceipt({ ...receipt, methodProfileVersion: "forged" })).toBeUndefined();
    expect(sanitizeMethodProfileReceipt({ ...receipt, sourceMethodVariantIds: [] })).toBeUndefined();
    expect(sanitizeMethodProfileReceipt({ ...receipt, sourceMethodVariantIds: [receipt.sourceMethodVariantId, receipt.sourceMethodVariantId] })).toBeUndefined();
    expect(sanitizeMethodProfileReceipt({ ...receipt, sourceMethodVariantIds: ["forged"] })).toBeUndefined();
    expect(sanitizeMethodProfileReceipt({ ...receipt, sourceMethodCombinationId: "combination:forged" })).toBeUndefined();
  });

  it("does not persist a documentary-only Android receipt as execution authority", () => {
    const settingId = "method-setting-0d4c2d71ec4c6dea11ac19b0";
    const documentary = sourceArtifactDocumentaryBindingForSetting(settingId)!;
    const receipt = {
      methodProfileId: "method-profile:doi:10.1016/j.chb.2023.107977",
      sourceWorkId: "doi:10.1016/j.chb.2023.107977",
      sourceMethodVariantId: "source-configuration-space-8b14e63d69954819163df993",
      sourceMethodVariantIds: ["source-method-variant-documentary"],
      methodProfileVersion: "literature-sublation-v3-atomic",
      settingIds: [settingId],
      bindings: [],
      documentaryBindings: [documentary],
    };
    expect(sanitizeMethodProfileReceipt(receipt)).toBeUndefined();
    expect(sanitizeMethodProfileReceipt({
      ...receipt,
      documentaryBindings: [{ ...documentary, conformanceResultDigest: `sha256:${"0".repeat(64)}` }],
    })).toBeUndefined();
    expect(sanitizeMethodProfileReceipt({
      ...receipt,
      documentaryBindings: [{ ...documentary, unknown: true }],
    })).toBeUndefined();
    for (const [key, forged] of [
      ["methodProfileId", "forged"], ["sourceWorkId", "doi:forged"],
      ["sourceMethodVariantId", "forged"], ["methodProfileVersion", "forged"],
    ] as const) {
      expect(sanitizeMethodProfileReceipt({ ...receipt, [key]: forged })).toBeUndefined();
    }
    const crossWork = sourceArtifactDocumentaryBindingForSetting("method-setting-193fe7441ca9f260300a2077")!;
    expect(sanitizeMethodProfileReceipt({
      ...receipt,
      settingIds: [settingId, crossWork.settingId],
      documentaryBindings: [documentary, crossWork],
    })).toBeUndefined();
  });
});

describe("persisted options round-trip (window stubbed)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips options through localStorage and unwraps the envelope", () => {
    const { storage } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    expect(hasPersistedOptions()).toBe(false);
    persistOptions({
      ...DEFAULT_BROWSER_OPTIONS,
      minimumUsageDuration: 77,
      openerSet: "activity_resumed_only",
    });
    expect(hasPersistedOptions()).toBe(true);
    expect(readPersistedOptions().minimumUsageDuration).toBe(77);
    expect(readPersistedOptions().openerSet).toBe("activity_resumed_only");
  });

  it("migrates a v1 settings envelope through the live option sanitizer", () => {
    const { storage, store } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    store.set(
      "chronicle.processingOptions.v1",
      JSON.stringify({
        schemaVersion: 1,
        savedAt: "2025-01-01T00:00:00.000Z",
        options: { minimumUsageDuration: 61, unknownOption: true },
      }),
    );

    expect(readPersistedOptions().minimumUsageDuration).toBe(61);
    const migrated = JSON.parse(
      store.get("chronicle.processingOptions.v1") ?? "null",
    ) as unknown;
    expect(migrated).toMatchObject({
      // The claim is that migration rewrites to whatever the current version
      // is, not to any particular number; pinning the literal made this test
      // fail on every version bump for no behavioural reason.
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      options: { minimumUsageDuration: 61 },
    });
    expect(JSON.stringify(migrated)).not.toContain("unknownOption");
  });

  it("adopts the current shipped default for options left at a superseded default", () => {
    const { storage, store } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    // Settings saved before the 2026-07-15 defaults change: these three values
    // WERE the shipped defaults then, so the user never chose them.
    store.set(
      "chronicle.processingOptions.v1",
      JSON.stringify({
        // v11 is what the previous migrations left behind: a full option set,
        // stale values included.
        schemaVersion: 11,
        savedAt: "2026-07-01T00:00:00.000Z",
        options: {
          ...DEFAULT_BROWSER_OPTIONS,
          useFilterFile: true,
          minimumUsageDuration: 0,
          proximityIntervalSeconds: 0,
        },
      }),
    );

    const options = readPersistedOptions();
    expect(options.useFilterFile).toBe(DEFAULT_BROWSER_OPTIONS.useFilterFile);
    expect(options.minimumUsageDuration).toBe(DEFAULT_BROWSER_OPTIONS.minimumUsageDuration);
    expect(options.proximityIntervalSeconds).toBe(
      DEFAULT_BROWSER_OPTIONS.proximityIntervalSeconds,
    );
    expect(
      (JSON.parse(store.get("chronicle.processingOptions.v1") ?? "null") as { schemaVersion: number })
        .schemaVersion,
    ).toBe(SETTINGS_SCHEMA_VERSION);
  });

  it("moves a pre-v12 save off the superseded selected-filter timezone default", () => {
    const { storage, store } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    store.set(
      "chronicle.processingOptions.v1",
      JSON.stringify({
        schemaVersion: 11,
        savedAt: "2026-07-01T00:00:00.000Z",
        options: { ...DEFAULT_BROWSER_OPTIONS, timezoneHandling: "selected-filter" },
      }),
    );

    expect(readPersistedOptions().timezoneHandling).toBe("selected-convert");
    expect(store.get("chronicle.processingOptions.v1")).not.toContain("selected-filter");
  });

  // A v12+ envelope stores only the diff from the defaults, so a key it holds
  // is one the researcher chose — even when the value equals a pre-v12 default.
  // A later schema bump must keep it, not strip it as a superseded default.
  it.each([12, SETTINGS_SCHEMA_VERSION - 1])(
    "keeps a deliberate choice of a superseded-default value saved under v%i across a schema bump",
    (schemaVersion) => {
      const { storage, store } = fakeLocalStorage();
      vi.stubGlobal("window", { localStorage: storage });
      // minimumUsageDuration is not here: its old default 0 is the current
      // default again (contract v6), so choosing it stores nothing.
      const chosen = {
        useFilterFile: true,
        proximityIntervalSeconds: 0,
        timezoneHandling: "selected-filter",
      } as const;
      store.set(
        "chronicle.processingOptions.v1",
        JSON.stringify({ schemaVersion, savedAt: "2026-09-01T00:00:00.000Z", options: chosen }),
      );

      expect(readPersistedOptions()).toEqual({ ...DEFAULT_BROWSER_OPTIONS, ...chosen });
      const rewritten = JSON.parse(store.get("chronicle.processingOptions.v1") ?? "null") as {
        schemaVersion: number;
        options: Record<string, unknown>;
      };
      expect(rewritten.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
      expect(rewritten.options).toEqual(chosen);
    },
  );

  it("keeps values the user actually chose while migrating", () => {
    const { storage, store } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    store.set(
      "chronicle.processingOptions.v1",
      JSON.stringify({
        schemaVersion: 2,
        savedAt: "2026-07-01T00:00:00.000Z",
        options: {
          ...DEFAULT_BROWSER_OPTIONS,
          minimumUsageDuration: 45,
          proximityIntervalSeconds: 5,
          studyName: "TECH",
        },
      }),
    );

    const options = readPersistedOptions();
    expect(options.minimumUsageDuration).toBe(45);
    expect(options.proximityIntervalSeconds).toBe(5);
    expect(options.studyName).toBe("TECH");
  });

  it("persists only the options that differ from the shipped defaults", () => {
    const { storage, store } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    persistOptions({ ...DEFAULT_BROWSER_OPTIONS, studyName: "GNSM" });

    const stored = JSON.parse(store.get("chronicle.processingOptions.v1") ?? "null") as {
      schemaVersion: number;
      options: Record<string, unknown>;
    };
    expect(stored.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(stored.options).toEqual({ studyName: "GNSM" });
    expect(readPersistedOptions()).toEqual({
      ...DEFAULT_BROWSER_OPTIONS,
      studyName: "GNSM",
    });
  });

  it("keeps readable v1 settings when the best-effort rewrite fails", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      savedAt: "2025-01-01T00:00:00.000Z",
      options: { minimumUsageDuration: 62, unknownOption: true },
    });
    const setItem = vi.fn(() => {
      throw new Error("read-only storage");
    });
    const storage = {
      getItem: vi.fn(() => raw),
      setItem,
    } as unknown as Storage;
    vi.stubGlobal("window", { localStorage: storage });

    expect(readPersistedOptions().minimumUsageDuration).toBe(62);
    expect(setItem).toHaveBeenCalledOnce();
  });

  it("falls back to defaults on corrupt JSON and on storage throws", () => {
    const { storage, store } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    store.set("chronicle.processingOptions.v1", "{not json");
    expect(readPersistedOptions()).toEqual({ ...DEFAULT_BROWSER_OPTIONS });

    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    vi.stubGlobal("window", { localStorage: throwing });
    expect(readPersistedOptions()).toEqual({ ...DEFAULT_BROWSER_OPTIONS });
    expect(hasPersistedOptions()).toBe(false);
    // A refused write is reported with the browser's reason, never thrown and
    // never reported as saved.
    expect(persistOptions(DEFAULT_BROWSER_OPTIONS)).toEqual({ ok: false, reason: "blocked" });
    expect(readPersistedPresets()).toEqual([]);
    expect(persistPresets([])).toEqual({ ok: false, reason: "blocked" });
  });

  it("reports a successful settings and presets write as ok", () => {
    const { storage } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    expect(persistOptions(DEFAULT_BROWSER_OPTIONS)).toEqual({ ok: true });
    expect(persistPresets([])).toEqual({ ok: true });
  });

  it("reads a legacy un-enveloped options object stored without the {options} wrapper", () => {
    const { storage, store } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    // A plain options object (no "options" key) is returned as-is by unwrapOptions.
    store.set("chronicle.processingOptions.v1", JSON.stringify({ minimumUsageDuration: 88 }));
    expect(readPersistedOptions().minimumUsageDuration).toBe(88);
  });

  it("returns defaults for a stored non-record payload (array/primitive)", () => {
    const { storage, store } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    // A stored JSON array is not a record → unwrapOptions returns it verbatim →
    // sanitizeOptions treats a non-record as {} → pure defaults.
    store.set("chronicle.processingOptions.v1", JSON.stringify([1, 2, 3]));
    expect(readPersistedOptions()).toEqual({ ...DEFAULT_BROWSER_OPTIONS });
  });

  it("returns defaults when nothing is persisted yet (present window, empty store)", () => {
    const { storage } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    // getItem returns null → the !raw guard short-circuits to defaults.
    expect(readPersistedOptions()).toEqual({ ...DEFAULT_BROWSER_OPTIONS });
    expect(readPersistedPresets()).toEqual([]);
  });

  it("mints ids/names/timestamps for persisted presets missing those fields", () => {
    const { storage, store } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    // A bare preset object (no id/name/createdAt/updatedAt) exercises every
    // fallback arm in readPersistedPresets' mapping.
    store.set(
      "chronicle.processingPresets.v1",
      JSON.stringify({ presets: [{ options: { minimumUsageDuration: 5 } }] }),
    );
    const read = readPersistedPresets();
    expect(read).toHaveLength(1);
    expect(read[0]?.id).toBeTruthy();
    expect(read[0]?.name).toBe("Imported preset");
    expect(read[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(read[0]?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("round-trips presets and sanitizes malformed entries", () => {
    const { storage } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    persistPresets([
      {
        id: "p1",
        name: "My preset",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        options: {
          ...DEFAULT_BROWSER_OPTIONS,
          minimumUsageDuration: 12,
          openerSet: "gesis_app_scoped_starts",
        },
      },
    ]);
    const read = readPersistedPresets();
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({ id: "p1", name: "My preset" });
    expect(read[0]?.options.openerSet).toBe("gesis_app_scoped_starts");

    const { storage: storage2, store: store2 } = fakeLocalStorage();
    vi.stubGlobal("window", { localStorage: storage2 });
    store2.set("chronicle.processingPresets.v1", JSON.stringify({ presets: "nope" }));
    expect(readPersistedPresets()).toEqual([]);
  });

  it("without a window, reads return defaults and writes report that nothing was saved", () => {
    // vitest node env has no window global by default.
    expect(readPersistedOptions()).toEqual({ ...DEFAULT_BROWSER_OPTIONS });
    expect(hasPersistedOptions()).toBe(false);
    expect(persistOptions(DEFAULT_BROWSER_OPTIONS).ok).toBe(false);
    expect(readPersistedPresets()).toEqual([]);
    expect(persistPresets([]).ok).toBe(false);
  });
});

describe("config export / import / shared URL", () => {
  it("exports an envelope readConfigFile can round-trip, sanitizing on the way in", async () => {
    const blob = buildConfigExportBlob(
      {
        ...DEFAULT_BROWSER_OPTIONS,
        minimumUsageDuration: 33,
        openerSet: "activity_resumed_only",
        microUseClassificationPolicy: "okoshi_lt_5s",
        minimumDurationComparator: "inclusive_le",
        minimumDurationDisposition: "retain_but_exclude",
        screenSessionConstructionStrategy: "zhu_2018_unlock_lock_v1",
      },
      [
        {
          id: "p1",
          name: "P",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          schemaVersion: SETTINGS_SCHEMA_VERSION,
          options: {
            ...DEFAULT_BROWSER_OPTIONS,
            proximityIntervalSeconds: 9,
            openerSet: "gesis_app_scoped_starts",
          },
        },
      ],
    );
    const file = new File([await blob.text()], "config.json", { type: "application/json" });
    const imported = await readConfigFile(file);
    expect(imported.options.minimumUsageDuration).toBe(33);
    expect(imported.options.openerSet).toBe("activity_resumed_only");
    expect(imported.options).toMatchObject({
      microUseClassificationPolicy: "okoshi_lt_5s",
      minimumDurationComparator: "inclusive_le",
      minimumDurationDisposition: "retain_but_exclude",
      screenSessionConstructionStrategy: "zhu_2018_unlock_lock_v1",
    });
    expect(imported.presets).toHaveLength(1);
    expect(imported.presets[0]?.options.proximityIntervalSeconds).toBe(9);
    expect(imported.presets[0]?.options.openerSet).toBe(
      "gesis_app_scoped_starts",
    );
  });

  it("imports malformed preset entries with generated ids and default names", async () => {
    const file = new File(
      [JSON.stringify({ currentSettings: {}, presets: [{ options: {} }, "junk"] })],
      "config.json",
    );
    const imported = await readConfigFile(file);
    expect(imported.presets).toHaveLength(1);
    expect(imported.presets[0]?.name).toBe("Imported preset");
    expect(imported.presets[0]?.id).toBeTruthy();
  });

  it("refuses a config whose presets field is not a list", async () => {
    // Importing it used to keep the settings and replace every preset with [].
    const file = new File(
      [JSON.stringify({ currentSettings: { minimumUsageDuration: 21 }, presets: "nope" })],
      "config.json",
    );
    await expect(readConfigFile(file)).rejects.toThrow(
      "This file is not a Chronicle config export",
    );
  });

  it.each([
    ["an array", [1, 2, 3]],
    ["an empty array", []],
    ["an empty object", {}],
    ["a method profile or other JSON", { methodProfileId: "x", settingIds: [] }],
    ["settings without presets", { currentSettings: { minimumUsageDuration: 5 } }],
  ])("refuses %s instead of resetting settings and erasing presets", async (_label, document) => {
    const file = new File([JSON.stringify(document)], "config.json");
    await expect(readConfigFile(file)).rejects.toThrow(
      'This file is not a Chronicle config export (it has no "currentSettings" object and "presets" list). Nothing was changed.',
    );
  });

  it("keeps every imported preset while making names and ids unique", async () => {
    const preset = (id: string, name: string) => ({ id, name, options: {} });
    const file = new File(
      [
        JSON.stringify({
          currentSettings: {},
          presets: [
            preset("p1", "Locked"),
            preset("p1", "locked"),
            preset("p3", "Locked"),
            preset("p4", "Other"),
          ],
        }),
      ],
      "config.json",
    );
    const imported = await readConfigFile(file);
    expect(imported.presets.map((entry) => entry.name)).toEqual([
      "Locked",
      "locked (2)",
      "Locked (3)",
      "Other",
    ]);
    const ids = imported.presets.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids[0]).toBe("p1");
    expect(ids[2]).toBe("p3");
  });

  it("rejects a non-JSON file with the friendly import message", async () => {
    const file = new File(["not json {"], "config.json");
    await expect(readConfigFile(file)).rejects.toThrow(
      "The selected file is not valid JSON. Make sure you're importing a Chronicle config file.",
    );
  });

  it("resets an unknown timezoneHandling value to the default", async () => {
    const file = new File(
      [
        JSON.stringify({
          currentSettings: {
            timezoneHandling: "bogus-mode",
            openerSet: "bogus-opener",
          },
          presets: [],
        }),
      ],
      "config.json",
    );
    const imported = await readConfigFile(file);
    expect(imported.options.timezoneHandling).toBe(
      DEFAULT_BROWSER_OPTIONS.timezoneHandling,
    );
    expect(imported.options.openerSet).toBe("strategy_defined");
  });

  it("round-trips non-default research axes through a shared URL payload", () => {
    const config = encodeURIComponent(
      JSON.stringify({
        openerSet: "gesis_app_scoped_starts",
        microUseClassificationPolicy: "okoshi_lt_5s",
        minimumDurationComparator: "inclusive_le",
        minimumDurationDisposition: "drop_row",
        screenSessionConstructionStrategy:
          "parry_toth_2025_session_glance_v1",
      }),
    );
    expect(readSharedConfig(`?config=${config}`)).toMatchObject({
      openerSet: "gesis_app_scoped_starts",
      microUseClassificationPolicy: "okoshi_lt_5s",
      minimumDurationComparator: "inclusive_le",
      minimumDurationDisposition: "drop_row",
      screenSessionConstructionStrategy:
        "parry_toth_2025_session_glance_v1",
    });
  });

  it("defaults malformed research axes from a shared URL payload", () => {
    const config = encodeURIComponent(
      JSON.stringify({
        microUseClassificationPolicy: "invented",
        minimumDurationComparator: null,
        minimumDurationDisposition: 2,
        screenSessionConstructionStrategy: [],
      }),
    );
    expect(readSharedConfig(`?config=${config}`)).toMatchObject({
      microUseClassificationPolicy: "none",
      minimumDurationComparator: "strict_lt",
      minimumDurationDisposition: "chronicle_blank_keep_row",
      screenSessionConstructionStrategy: "chronicle_screen_interactive_v1",
    });
  });

  it("readSharedConfig returns null for absent or invalid search params", () => {
    expect(readSharedConfig("")).toBeNull();
    expect(readSharedConfig("?cfg=%%%broken")).toBeNull();
  });

  it("readSharedConfig returns null when URL parsing throws", () => {
    // Force the parse step to throw so the defensive catch (return null) runs.
    vi.stubGlobal(
      "URLSearchParams",
      class {
        constructor() {
          throw new Error("boom");
        }
      },
    );
    expect(readSharedConfig("?config=anything")).toBeNull();
    vi.unstubAllGlobals();
  });
});
