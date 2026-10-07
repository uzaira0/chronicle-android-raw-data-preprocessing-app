import { describe, expect, it } from "vitest";

import { SESSION_GROUPING_POLICIES } from "@/components/SessionDetectionCard";
import {
  DEFAULT_BROWSER_OPTIONS,
  SESSION_GROUPING_POLICY_VALUES,
} from "@/lib/generatedContract";
import { buildRustV2Options } from "@/lib/rustPipelineRuntime";

const POLICY = "smartphone_wellbeing_strict_lt_5s" as const;

describe("SmartphoneUsage_Wellbeing strict-less-than-five-second policy", () => {
  it("round-trips from the authoritative public enum through the GUI to the Rust wire", () => {
    expect(SESSION_GROUPING_POLICY_VALUES).toContain(POLICY);
    expect(SESSION_GROUPING_POLICIES).toContainEqual({
      value: POLICY,
      label: "Smartphone Wellbeing < 5 s",
    });
    const wire = buildRustV2Options(
      {
        ...DEFAULT_BROWSER_OPTIONS,
        selectedTimezone: "UTC",
        sessionGroupingPolicy: POLICY,
      },
      {
        datetimeOfPreprocessing: "2026-08-31 00:00:00 UTC",
        persistRustWorkspace: false,
      },
    );
    expect(wire.session_grouping_policy).toBe(POLICY);
  });
});
