import { describe, expect, it } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/browserPipeline";
import { anyOptionModified, isOptionDefault, resetOption } from "@/lib/optionDefaults";
import type { BrowserProcessingOptions } from "@/lib/types";

describe("optionDefaults", () => {
  // ── DEFAULT_BROWSER_OPTIONS shape contracts ───────────────────────────────

  it("studyName default is an empty string", () => {
    expect(typeof DEFAULT_BROWSER_OPTIONS.studyName).toBe("string");
    expect(DEFAULT_BROWSER_OPTIONS.studyName).toBe("");
  });

  it("processAppUsage default is a boolean", () => {
    expect(typeof DEFAULT_BROWSER_OPTIONS.processAppUsage).toBe("boolean");
  });

  it("processScreenUsage default is a boolean", () => {
    expect(typeof DEFAULT_BROWSER_OPTIONS.processScreenUsage).toBe("boolean");
  });

  it("longDurationThresholdHours default is a positive number", () => {
    expect(typeof DEFAULT_BROWSER_OPTIONS.longDurationThresholdHours).toBe("number");
    expect(DEFAULT_BROWSER_OPTIONS.longDurationThresholdHours).toBeGreaterThan(0);
  });

  it("minimumUsageDuration default is a non-negative number", () => {
    expect(typeof DEFAULT_BROWSER_OPTIONS.minimumUsageDuration).toBe("number");
    expect(DEFAULT_BROWSER_OPTIONS.minimumUsageDuration).toBeGreaterThanOrEqual(0);
  });

  it("customAppEngagementDuration default is a positive number", () => {
    expect(typeof DEFAULT_BROWSER_OPTIONS.customAppEngagementDuration).toBe("number");
    expect(DEFAULT_BROWSER_OPTIONS.customAppEngagementDuration).toBeGreaterThan(0);
  });

  it("longUsageDurationThresholds default is a non-null non-empty array of numbers", () => {
    expect(Array.isArray(DEFAULT_BROWSER_OPTIONS.longUsageDurationThresholds)).toBe(true);
    expect(DEFAULT_BROWSER_OPTIONS.longUsageDurationThresholds.length).toBeGreaterThan(0);
    for (const v of DEFAULT_BROWSER_OPTIONS.longUsageDurationThresholds) {
      expect(typeof v).toBe("number");
    }
  });

  it("longDataTimeGapThresholds default is a non-null array of numbers", () => {
    expect(Array.isArray(DEFAULT_BROWSER_OPTIONS.longDataTimeGapThresholds)).toBe(true);
    for (const v of DEFAULT_BROWSER_OPTIONS.longDataTimeGapThresholds) {
      expect(typeof v).toBe("number");
    }
  });

  it("sameAppInteractionTypesToStopUsageAt default is a non-null array of strings", () => {
    expect(Array.isArray(DEFAULT_BROWSER_OPTIONS.sameAppInteractionTypesToStopUsageAt)).toBe(true);
    for (const v of DEFAULT_BROWSER_OPTIONS.sameAppInteractionTypesToStopUsageAt) {
      expect(typeof v).toBe("string");
    }
  });

  it("otherInteractionTypesToStopUsageAt default is a non-null array of strings", () => {
    expect(Array.isArray(DEFAULT_BROWSER_OPTIONS.otherInteractionTypesToStopUsageAt)).toBe(true);
    for (const v of DEFAULT_BROWSER_OPTIONS.otherInteractionTypesToStopUsageAt) {
      expect(typeof v).toBe("string");
    }
  });

  it("interactionTypesToRemove default is a non-null array", () => {
    expect(Array.isArray(DEFAULT_BROWSER_OPTIONS.interactionTypesToRemove)).toBe(true);
  });

  it("parallelProcessing default is a boolean", () => {
    expect(typeof DEFAULT_BROWSER_OPTIONS.parallelProcessing).toBe("boolean");
  });

  it("parallelMaxWorkers default is undefined (optional field)", () => {
    expect(DEFAULT_BROWSER_OPTIONS.parallelMaxWorkers).toBeUndefined();
  });

  it("timezoneHandling default is a valid TIMEZONE_HANDLING_VALUES entry", () => {
    const valid = ["selected-filter", "selected-convert", "primary-filter", "primary-convert"];
    expect(valid).toContain(DEFAULT_BROWSER_OPTIONS.timezoneHandling);
  });

  it("screen usage timeout/tolerance/gap/keyguard defaults are positive numbers", () => {
    expect(DEFAULT_BROWSER_OPTIONS.screenUsageAutoLockTimeoutSeconds).toBeGreaterThan(0);
    expect(DEFAULT_BROWSER_OPTIONS.screenUsageAutoLockToleranceSeconds).toBeGreaterThan(0);
    expect(DEFAULT_BROWSER_OPTIONS.screenUsageManualLockMaxTailGapSeconds).toBeGreaterThan(0);
    expect(DEFAULT_BROWSER_OPTIONS.screenUsageKeyguardNearStopSeconds).toBeGreaterThan(0);
  });

  // ── isOptionDefault ───────────────────────────────────────────────────────

  it("isOptionDefault returns true for a field set to its default value", () => {
    expect(isOptionDefault("studyName", DEFAULT_BROWSER_OPTIONS.studyName)).toBe(true);
    expect(isOptionDefault("processAppUsage", DEFAULT_BROWSER_OPTIONS.processAppUsage)).toBe(true);
    expect(isOptionDefault("longDurationThresholdHours", DEFAULT_BROWSER_OPTIONS.longDurationThresholdHours)).toBe(true);
    expect(isOptionDefault("timezoneHandling", DEFAULT_BROWSER_OPTIONS.timezoneHandling)).toBe(true);
  });

  it("isOptionDefault returns false for a field changed from its default", () => {
    expect(isOptionDefault("studyName", "Custom Study")).toBe(false);
    expect(isOptionDefault("processAppUsage", !DEFAULT_BROWSER_OPTIONS.processAppUsage)).toBe(false);
    expect(isOptionDefault("longDurationThresholdHours", DEFAULT_BROWSER_OPTIONS.longDurationThresholdHours + 1)).toBe(false);
  });

  it("isOptionDefault handles array defaults correctly (same elements = default)", () => {
    expect(isOptionDefault("longUsageDurationThresholds", [...DEFAULT_BROWSER_OPTIONS.longUsageDurationThresholds])).toBe(true);
    expect(isOptionDefault("longUsageDurationThresholds", [1, 2, 3])).toBe(false);
  });

  it("isOptionDefault handles empty array vs default array", () => {
    expect(isOptionDefault("interactionTypesToRemove", [])).toBe(true);
    expect(isOptionDefault("interactionTypesToRemove", ["SOMETHING"])).toBe(false);
  });

  it("isOptionDefault treats undefined parallelMaxWorkers as default", () => {
    expect(isOptionDefault("parallelMaxWorkers", undefined)).toBe(true);
    expect(isOptionDefault("parallelMaxWorkers", 4)).toBe(false);
  });

  // ── anyOptionModified ─────────────────────────────────────────────────────

  it("anyOptionModified returns false when all watched keys are at default", () => {
    expect(
      anyOptionModified(DEFAULT_BROWSER_OPTIONS, ["studyName", "processAppUsage", "timezoneHandling"]),
    ).toBe(false);
  });

  it("anyOptionModified returns true when at least one watched key differs from default", () => {
    const modified: BrowserProcessingOptions = { ...DEFAULT_BROWSER_OPTIONS, studyName: "Modified" };
    expect(anyOptionModified(modified, ["studyName", "processAppUsage"])).toBe(true);
  });

  it("anyOptionModified with empty key list returns false", () => {
    expect(anyOptionModified(DEFAULT_BROWSER_OPTIONS, [])).toBe(false);
  });

  // ── resetOption ───────────────────────────────────────────────────────────

  it("resetOption returns a new object with the specified key set back to default", () => {
    const modified: BrowserProcessingOptions = { ...DEFAULT_BROWSER_OPTIONS, studyName: "Custom" };
    const reset = resetOption(modified, "studyName");
    expect(reset.studyName).toBe(DEFAULT_BROWSER_OPTIONS.studyName);
    // other keys unchanged
    expect(reset.processAppUsage).toBe(modified.processAppUsage);
  });

  it("resetOption does not mutate the original options object", () => {
    const original: BrowserProcessingOptions = { ...DEFAULT_BROWSER_OPTIONS, studyName: "Kept" };
    resetOption(original, "studyName");
    expect(original.studyName).toBe("Kept");
  });

  it("resetOption on an array key restores the default array", () => {
    const modified: BrowserProcessingOptions = {
      ...DEFAULT_BROWSER_OPTIONS,
      longUsageDurationThresholds: [99, 100],
    };
    const reset = resetOption(modified, "longUsageDurationThresholds");
    expect(reset.longUsageDurationThresholds).toEqual(DEFAULT_BROWSER_OPTIONS.longUsageDurationThresholds);
  });
});
