import { describe, expect, it } from "vitest";

import { SECTION_BY_KEY } from "@/components/SettingsSearchResults";
import { BROWSER_PROCESSING_OPTION_KEYS } from "@/lib/generatedContract";

describe("settings search routing", () => {
  it("routes every processing option to an explicit section", () => {
    // The search index is built from the contract key list, so every option is
    // searchable; this guards the OTHER half — that each option has an explicit
    // section so it jumps to the right card instead of silently falling back to
    // the overview. A new contract option will fail here until it's routed.
    const unrouted = BROWSER_PROCESSING_OPTION_KEYS.filter((key) => !(key in SECTION_BY_KEY));
    expect(unrouted).toEqual([]);
  });
});
