import { describe, expect, it } from "vitest";

import { deriveBroadAppCategory } from "@/lib/browserPipeline";

// These cases are the cross-surface contract for the optional broad_app_category
// output column (#10). The Python oracle's _normalized_broad_category_expr in
// polars_fast_path.py MUST produce identical results for the same candidate
// tuples (play_store, usc, babyemu, bcm) — see
// tests/test_broad_app_category_normalization.py and the deterministic parity
// harness scenario "category_app".
describe("deriveBroadAppCategory (#10 normalized category)", () => {
  const cases: Array<{ candidates: Array<string | null>; expected: string }> = [
    { candidates: ["Games", null, null, null], expected: "Games" }, // palette hit
    {
      candidates: ["Video Players & Editors", null, "KNOWLEDGE_AND_INFORMATION", null],
      expected: "Education", // unmapped play_store skipped → babyemu alias
    },
    { candidates: [null, null, null, null], expected: "Unknown" }, // nothing → Unknown
    { candidates: ["Other", null, "GAMING", null], expected: "Games" }, // specific beats earlier Uncategorised
    { candidates: [null, null, null, "Other"], expected: "Uncategorised" }, // only Uncategorised
    { candidates: ["  Education ", null, "SOCIAL", null], expected: "Education" }, // trims; first specific wins
    { candidates: [null, null, "COMMUNICATION", null], expected: "Social & Communication" },
    { candidates: [null, null, "UTILITIES", null], expected: "Productivity & Business" },
    { candidates: ["System/OEM", null, null, null], expected: "Uncategorised" },
  ];

  for (const { candidates, expected } of cases) {
    it(`maps ${JSON.stringify(candidates)} → ${expected}`, () => {
      expect(deriveBroadAppCategory(candidates)).toBe(expected);
    });
  }
});
