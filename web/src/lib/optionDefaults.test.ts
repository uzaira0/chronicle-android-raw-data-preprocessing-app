import { describe, expect, it } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/browserPipeline";
import { anyOptionModified, isOptionDefault, resetOption } from "@/lib/optionDefaults";

describe("isOptionDefault", () => {
  it("matches scalar defaults exactly", () => {
    expect(isOptionDefault("processAppUsage", DEFAULT_BROWSER_OPTIONS.processAppUsage)).toBe(true);
    expect(isOptionDefault("processAppUsage", !DEFAULT_BROWSER_OPTIONS.processAppUsage)).toBe(false);
    expect(
      isOptionDefault("minimumUsageDuration", DEFAULT_BROWSER_OPTIONS.minimumUsageDuration),
    ).toBe(true);
    expect(
      isOptionDefault("minimumUsageDuration", DEFAULT_BROWSER_OPTIONS.minimumUsageDuration + 1),
    ).toBe(false);
  });

  it("compares array options element-wise, order-sensitive", () => {
    const key = "sameAppInteractionTypesToStopUsageAt" as const;
    const fallback = DEFAULT_BROWSER_OPTIONS[key];
    expect(isOptionDefault(key, [...fallback])).toBe(true);
    expect(isOptionDefault(key, [...fallback, "Extra"])).toBe(false);
    if (fallback.length > 1) {
      expect(isOptionDefault(key, [...fallback].reverse())).toBe(false);
    }
  });

  it("treats undefined/empty as default for optional fields", () => {
    expect(isOptionDefault("parallelMaxWorkers", undefined)).toBe(true);
    expect(isOptionDefault("parallelMaxWorkers", 4)).toBe(false);
  });
});

describe("anyOptionModified / resetOption", () => {
  it("detects a modified key and restores its default", () => {
    const modified = {
      ...DEFAULT_BROWSER_OPTIONS,
      minimumUsageDuration: DEFAULT_BROWSER_OPTIONS.minimumUsageDuration + 5,
    };
    expect(anyOptionModified(modified, ["minimumUsageDuration", "processAppUsage"])).toBe(true);
    expect(anyOptionModified(DEFAULT_BROWSER_OPTIONS, ["minimumUsageDuration"])).toBe(false);
    const reset = resetOption(modified, "minimumUsageDuration");
    expect(reset.minimumUsageDuration).toBe(DEFAULT_BROWSER_OPTIONS.minimumUsageDuration);
  });
});
