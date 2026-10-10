import { describe, expect, it } from "vitest";

import { BUILT_IN_PRESETS, TECH_GNSM_OPTIONS } from "@/lib/builtInPresets";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { collectOptionRangeViolations } from "@/lib/validation";

describe("built-in presets", () => {
  it("the default preset is the app defaults, with no cleaning", () => {
    const preset = BUILT_IN_PRESETS.find((entry) => entry.id === "built-in:default-preprocessing");
    expect(preset?.name).toBe("Default Preprocessing (No Cleaning)");
    expect(preset?.options).toEqual(DEFAULT_BROWSER_OPTIONS);
    expect(DEFAULT_BROWSER_OPTIONS.minimumUsageDuration).toBe(0);
    expect(DEFAULT_BROWSER_OPTIONS.useFilterFile).toBe(false);
    expect(DEFAULT_BROWSER_OPTIONS.filterZeroDurationSessions).toBe(false);
    expect(DEFAULT_BROWSER_OPTIONS.enableScreenGatedCrediting).toBe(false);
    expect(DEFAULT_BROWSER_OPTIONS.dropOutOfSourceOrderEvents).toBe(false);
  });

  it("TECH/GNSM differs from the defaults exactly where v1_engine.py's knobs do", () => {
    const changed = Object.keys(DEFAULT_BROWSER_OPTIONS)
      .filter((key) =>
        JSON.stringify(TECH_GNSM_OPTIONS[key as keyof typeof TECH_GNSM_OPTIONS])
        !== JSON.stringify(DEFAULT_BROWSER_OPTIONS[key as keyof typeof DEFAULT_BROWSER_OPTIONS]))
      .sort();
    expect(changed).toEqual([
      "bridgeScreenOffToSessionEnd",
      "enableScreenGatedCrediting",
      "longDurationThresholdHours",
      "minimumUsageDuration",
      "processScreenUsage",
      "selectedTimezone",
      "useFilterFile",
    ]);
    expect(TECH_GNSM_OPTIONS).toMatchObject({
      proximityIntervalSeconds: 2,
      minimumUsageDuration: 60,
      allowStopEventReuse: false,
      useActivityStoppedAsFallback: true,
      applyThresholdToFallback: true,
      correctDuplicateEventTimestamps: true,
      creditedSessionCapMinutes: 360,
    });
  });

  it("every built-in preset passes the app's own range checks", () => {
    for (const preset of BUILT_IN_PRESETS) {
      expect(collectOptionRangeViolations(preset.options), preset.name).toEqual([]);
    }
  });
});
