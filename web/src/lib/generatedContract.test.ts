import { describe, expect, it } from "vitest";
import { BROWSER_PROCESSING_OPTION_KEYS, BROWSER_OPTION_TOOLTIPS } from "@/lib/generatedContract";

describe("generatedContract", () => {
  it("every BrowserProcessingOptions key has tooltip copy in BROWSER_OPTION_TOOLTIPS", () => {
    const tooltipKeys = new Set(Object.keys(BROWSER_OPTION_TOOLTIPS));
    const missing = BROWSER_PROCESSING_OPTION_KEYS.filter((key) => !tooltipKeys.has(key));
    expect(missing).toEqual([]);
  });
});
