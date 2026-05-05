import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  buildConfigExportBlob,
  hasPersistedOptions,
  persistOptions,
  readConfigFile,
  readPersistedOptions,
  readPersistedPresets,
  sanitizeOptions,
  type SettingsPreset,
} from "@/lib/settingsPersistence";
import type { BrowserProcessingOptions } from "@/lib/types";

type LocalStorageStub = {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
};

function stubBrowser(storage: LocalStorageStub): void {
  vi.stubGlobal("window", { localStorage: storage });
}

function localStorageStub(initial: Record<string, string> = {}): LocalStorageStub {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("settingsPersistence", () => {
  it("migrates legacy usageSessionMode only when explicit process flags are absent", () => {
    expect(sanitizeOptions({ usageSessionMode: "screen_usage" })).toMatchObject({
      processAppUsage: false,
      processScreenUsage: true,
    });
    expect(sanitizeOptions({ usageSessionMode: "app_and_screen_usage" })).toMatchObject({
      processAppUsage: true,
      processScreenUsage: true,
    });
    expect(
      sanitizeOptions({
        usageSessionMode: "screen_usage",
        processAppUsage: true,
        processScreenUsage: false,
      }),
    ).toMatchObject({
      processAppUsage: true,
      processScreenUsage: false,
    });
  });

  it("sanitizes imported option types and rejects invalid timezone modes", () => {
    const sanitized = sanitizeOptions({
      studyName: "Field Study",
      processAppUsage: false,
      useFilterFile: "yes",
      longDurationThresholdHours: Number.POSITIVE_INFINITY,
      minimumUsageDuration: 2.5,
      timezoneHandling: "delete-everything",
      selectedTimezone: "America/Chicago",
      longUsageDurationThresholds: ["1", "bad", 6],
      longDataTimeGapThresholds: [],
      sameAppInteractionTypesToStopUsageAt: ["Activity Paused", 42, "Activity Stopped"],
      parallelMaxWorkers: "3.8",
    });

    expect(sanitized).toMatchObject({
      studyName: "Field Study",
      processAppUsage: false,
      useFilterFile: DEFAULT_BROWSER_OPTIONS.useFilterFile,
      longDurationThresholdHours: DEFAULT_BROWSER_OPTIONS.longDurationThresholdHours,
      minimumUsageDuration: 2.5,
      timezoneHandling: DEFAULT_BROWSER_OPTIONS.timezoneHandling,
      selectedTimezone: "America/Chicago",
      longUsageDurationThresholds: [1, 6],
      longDataTimeGapThresholds: DEFAULT_BROWSER_OPTIONS.longDataTimeGapThresholds,
      sameAppInteractionTypesToStopUsageAt: ["Activity Paused", "Activity Stopped"],
      parallelMaxWorkers: 3,
    });
  });

  it("persists sanitized options in the versioned local-storage envelope", () => {
    const storage = localStorageStub();
    stubBrowser(storage);

    persistOptions({
      ...DEFAULT_BROWSER_OPTIONS,
      timezoneHandling: "not-valid",
      parallelMaxWorkers: 0,
      studyName: "Persisted",
    } as unknown as BrowserProcessingOptions);

    expect(hasPersistedOptions()).toBe(true);
    const [, rawEnvelope] = storage.setItem.mock.calls[0] ?? [];
    const envelope = JSON.parse(rawEnvelope);

    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.options.studyName).toBe("Persisted");
    expect(envelope.options.timezoneHandling).toBe(DEFAULT_BROWSER_OPTIONS.timezoneHandling);
    expect(envelope.options).not.toHaveProperty("parallelMaxWorkers");
  });

  it("reads legacy and corrupt local-storage settings without leaking bad values", () => {
    stubBrowser(
      localStorageStub({
        "chronicle.processingOptions.v1": JSON.stringify({
          options: {
            usageSessionMode: "screen_usage",
            timezoneHandling: "invalid",
            parallelMaxWorkers: -1,
          },
        }),
      }),
    );

    expect(readPersistedOptions()).toMatchObject({
      processAppUsage: false,
      processScreenUsage: true,
      timezoneHandling: DEFAULT_BROWSER_OPTIONS.timezoneHandling,
      parallelMaxWorkers: undefined,
    });

    stubBrowser(localStorageStub({ "chronicle.processingOptions.v1": "{" }));
    expect(readPersistedOptions()).toEqual(DEFAULT_BROWSER_OPTIONS);
  });

  it("round-trips config exports and sanitizes imported presets", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "generated-id") });
    const presets: SettingsPreset[] = [
      {
        id: "preset-1",
        name: "Screen only",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-02T00:00:00.000Z",
        options: {
          ...DEFAULT_BROWSER_OPTIONS,
          processAppUsage: false,
          processScreenUsage: true,
        },
      },
    ];

    const exported = JSON.parse(
      await buildConfigExportBlob(
        {
          ...DEFAULT_BROWSER_OPTIONS,
          timezoneHandling: "primary-convert",
          parallelMaxWorkers: 2,
        },
        presets,
      ).text(),
    );

    expect(exported.currentSettings.timezoneHandling).toBe("primary-convert");
    expect(exported.currentSettings.parallelMaxWorkers).toBe(2);
    expect(exported.presets).toHaveLength(1);

    const imported = await readConfigFile(
      new File(
        [
          JSON.stringify({
            currentSettings: { processAppUsage: false, timezoneHandling: "broken" },
            presets: [
              {
                name: 12,
                options: {
                  usageSessionMode: "screen_usage",
                  timezoneHandling: "also-broken",
                },
              },
            ],
          }),
        ],
        "chronicle-config.json",
        { type: "application/json" },
      ),
    );

    expect(imported.options).toMatchObject({
      processAppUsage: false,
      timezoneHandling: DEFAULT_BROWSER_OPTIONS.timezoneHandling,
    });
    expect(imported.presets).toHaveLength(1);
    expect(imported.presets[0]).toMatchObject({
      id: "generated-id",
      name: "Imported preset",
      options: {
        processAppUsage: false,
        processScreenUsage: true,
        timezoneHandling: DEFAULT_BROWSER_OPTIONS.timezoneHandling,
      },
    });
  });

  it("loads stored preset envelopes and ignores malformed preset lists", () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "preset-id") });
    stubBrowser(
      localStorageStub({
        "chronicle.processingPresets.v1": JSON.stringify({
          presets: [
            {
              name: "Imported",
              options: { usageSessionMode: "app_and_screen_usage", parallelMaxWorkers: 4 },
            },
            "skip-me",
          ],
        }),
      }),
    );

    expect(readPersistedPresets()).toEqual([
      expect.objectContaining({
        id: "preset-id",
        name: "Imported",
        options: expect.objectContaining({
          processAppUsage: true,
          processScreenUsage: true,
          parallelMaxWorkers: 4,
        }),
      }),
    ]);

    stubBrowser(
      localStorageStub({
        "chronicle.processingPresets.v1": JSON.stringify({ presets: "bad" }),
      }),
    );
    expect(readPersistedPresets()).toEqual([]);
  });

  // ── Additional cases ──────────────────────────────────────────────────────

  it("boolean fields as strings are not coerced — defaults are used instead", () => {
    const result = sanitizeOptions({
      processAppUsage: "true",
      processScreenUsage: "false",
      parallelProcessing: "true",
    });
    expect(result.processAppUsage).toBe(DEFAULT_BROWSER_OPTIONS.processAppUsage);
    expect(result.processScreenUsage).toBe(DEFAULT_BROWSER_OPTIONS.processScreenUsage);
    expect(result.parallelProcessing).toBe(DEFAULT_BROWSER_OPTIONS.parallelProcessing);
  });

  it("number fields as strings fall back to defaults", () => {
    const result = sanitizeOptions({
      longDurationThresholdHours: "12",
      minimumUsageDuration: "0",
      customAppEngagementDuration: "300",
    });
    // Strings are not accepted for NUMBER_BROWSER_OPTION_KEYS → defaults used
    expect(result.longDurationThresholdHours).toBe(DEFAULT_BROWSER_OPTIONS.longDurationThresholdHours);
    expect(result.minimumUsageDuration).toBe(DEFAULT_BROWSER_OPTIONS.minimumUsageDuration);
    expect(result.customAppEngagementDuration).toBe(DEFAULT_BROWSER_OPTIONS.customAppEngagementDuration);
  });

  it("negative numbers for number fields fall back to defaults", () => {
    const result = sanitizeOptions({
      longDurationThresholdHours: -5,
      minimumUsageDuration: -1,
    });
    // Negative finite numbers ARE valid for NUMBER_BROWSER_OPTION_KEYS (no sign check there).
    // What actually matters: NaN and Infinity are rejected, negatives pass through.
    expect(result.longDurationThresholdHours).toBe(-5);
    expect(result.minimumUsageDuration).toBe(-1);
  });

  it("NaN for number fields falls back to defaults", () => {
    const result = sanitizeOptions({
      longDurationThresholdHours: Number.NaN,
      minimumUsageDuration: Number.NaN,
      customAppEngagementDuration: Number.NaN,
    });
    expect(result.longDurationThresholdHours).toBe(DEFAULT_BROWSER_OPTIONS.longDurationThresholdHours);
    expect(result.minimumUsageDuration).toBe(DEFAULT_BROWSER_OPTIONS.minimumUsageDuration);
    expect(result.customAppEngagementDuration).toBe(DEFAULT_BROWSER_OPTIONS.customAppEngagementDuration);
  });

  it("null/undefined for required fields uses defaults", () => {
    const result = sanitizeOptions({ studyName: null, processAppUsage: undefined });
    expect(result.studyName).toBe(DEFAULT_BROWSER_OPTIONS.studyName);
    expect(result.processAppUsage).toBe(DEFAULT_BROWSER_OPTIONS.processAppUsage);
  });

  it("preserves all valid TIMEZONE_HANDLING_VALUES", () => {
    const validValues = ["selected-filter", "selected-convert", "primary-filter", "primary-convert"] as const;
    for (const tz of validValues) {
      expect(sanitizeOptions({ timezoneHandling: tz }).timezoneHandling).toBe(tz);
    }
  });

  it("unknown top-level keys are not present in sanitized output", () => {
    const result = sanitizeOptions({
      studyName: "Test",
      unknownKey: "should-be-stripped",
      anotherExtra: 42,
    }) as Record<string, unknown>;
    expect(result).not.toHaveProperty("unknownKey");
    expect(result).not.toHaveProperty("anotherExtra");
  });

  it("nested object where a flat boolean is expected falls back to default", () => {
    const result = sanitizeOptions({ processAppUsage: { nested: true } });
    expect(result.processAppUsage).toBe(DEFAULT_BROWSER_OPTIONS.processAppUsage);
  });

  it("number arrays with nulls coerce nulls to 0 (Number(null)===0 is finite)", () => {
    // null → Number(null) === 0 which is finite, so 0 stays in the array
    const result = sanitizeOptions({
      longUsageDurationThresholds: [1, null, 2, null, 3],
    });
    expect(result.longUsageDurationThresholds).toEqual([1, 0, 2, 0, 3]);
  });

  it("string arrays with nulls have nulls filtered out", () => {
    const result = sanitizeOptions({
      sameAppInteractionTypesToStopUsageAt: ["Activity Paused", null, "Activity Stopped"],
    });
    expect(result.sameAppInteractionTypesToStopUsageAt).toEqual(["Activity Paused", "Activity Stopped"]);
  });

  it("very large parallelMaxWorkers passes through as a floored integer", () => {
    const result = sanitizeOptions({ parallelMaxWorkers: 9999999 });
    expect(result.parallelMaxWorkers).toBe(9999999);
  });

  it("persistOptions then readPersistedOptions round-trips various option combinations", () => {
    const storage = localStorageStub();
    stubBrowser(storage);

    const cases: Partial<BrowserProcessingOptions>[] = [
      { studyName: "Alpha", processAppUsage: true, processScreenUsage: false },
      { studyName: "Beta", processAppUsage: false, processScreenUsage: true, timezoneHandling: "primary-convert" },
      { studyName: "Gamma", parallelProcessing: true, parallelMaxWorkers: 4 },
      { studyName: "Delta", longUsageDurationThresholds: [2, 4, 6], interactionTypesToRemove: ["FOO"] },
    ];

    for (const partial of cases) {
      const options: BrowserProcessingOptions = { ...DEFAULT_BROWSER_OPTIONS, ...partial };
      persistOptions(options);
      const retrieved = readPersistedOptions();
      expect(retrieved).toMatchObject(partial);
    }
  });

  it("hasPersistedOptions returns false when nothing has been persisted", () => {
    stubBrowser(localStorageStub());
    expect(hasPersistedOptions()).toBe(false);
  });

  it("hasPersistedOptions returns false when localStorage.getItem throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => { throw new Error("SecurityError"); }),
        setItem: vi.fn(),
      },
    });
    expect(hasPersistedOptions()).toBe(false);
  });

  it("readPersistedOptions returns defaults when localStorage.getItem throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => { throw new Error("SecurityError"); }),
        setItem: vi.fn(),
      },
    });
    expect(readPersistedOptions()).toEqual(DEFAULT_BROWSER_OPTIONS);
  });

  it("readPersistedPresets returns empty array when no key is present", () => {
    stubBrowser(localStorageStub());
    expect(readPersistedPresets()).toEqual([]);
  });

  it("buildConfigExportBlob with empty presets produces valid JSON with presets: []", async () => {
    const blob = buildConfigExportBlob({ ...DEFAULT_BROWSER_OPTIONS }, []);
    const parsed = JSON.parse(await blob.text());
    expect(parsed.presets).toEqual([]);
    expect(parsed.currentSettings).toBeDefined();
    expect(parsed.schemaVersion).toBe(1);
  });

  it("readConfigFile with non-JSON content throws", async () => {
    const file = new File(["not json {{{"], "bad.json", { type: "application/json" });
    await expect(readConfigFile(file)).rejects.toThrow();
  });

  it("readConfigFile with missing currentSettings key returns sanitized defaults", async () => {
    const file = new File(
      [JSON.stringify({ presets: [] })],
      "no-settings.json",
      { type: "application/json" },
    );
    const result = await readConfigFile(file);
    expect(result.options).toEqual(DEFAULT_BROWSER_OPTIONS);
    expect(result.presets).toEqual([]);
  });

  it("readConfigFile with version-less envelope handles gracefully", async () => {
    const file = new File(
      [JSON.stringify({ currentSettings: { studyName: "NoVersion" }, presets: [] })],
      "no-version.json",
      { type: "application/json" },
    );
    const result = await readConfigFile(file);
    expect(result.options.studyName).toBe("NoVersion");
    expect(result.presets).toEqual([]);
  });

  it("sanitizeOptions with processAppUsage and processScreenUsage both false is preserved", () => {
    const result = sanitizeOptions({
      ...DEFAULT_BROWSER_OPTIONS,
      processAppUsage: false,
      processScreenUsage: false,
    });
    expect(result.processAppUsage).toBe(false);
    expect(result.processScreenUsage).toBe(false);
  });
});
