import { describe, expect, it } from "vitest";

import {
  MICRO_USE_CLASSIFICATION_POLICY_VALUES,
  MINIMUM_DURATION_COMPARATOR_VALUES,
  MINIMUM_DURATION_DISPOSITION_VALUES,
  SCREEN_SESSION_CONSTRUCTION_STRATEGY_VALUES,
} from "@/lib/generatedContract";
import { configurationEquivalenceClasses } from "@/testSupport/configurationEquivalenceClasses";

describe("B03/B04/B05 configuration representatives", () => {
  it.each([
    ["microUseClassificationPolicy", MICRO_USE_CLASSIFICATION_POLICY_VALUES],
    ["minimumDurationComparator", MINIMUM_DURATION_COMPARATOR_VALUES],
    ["minimumDurationDisposition", MINIMUM_DURATION_DISPOSITION_VALUES],
    [
      "screenSessionConstructionStrategy",
      SCREEN_SESSION_CONSTRUCTION_STRATEGY_VALUES,
    ],
  ] as const)("keeps every %s arm independently represented", (key, domain) => {
    expect(
      configurationEquivalenceClasses(key).map(({ value }) => value),
    ).toEqual(domain);
  });

  it("keeps Schoedel as a distinct reconstruction representative", () => {
    expect(
      configurationEquivalenceClasses("episodeReconstructionStrategy").map(
        ({ value }) => value,
      ),
    ).toContain("schoedel_2026_app_within_screen_prose_v1");
  });
});
