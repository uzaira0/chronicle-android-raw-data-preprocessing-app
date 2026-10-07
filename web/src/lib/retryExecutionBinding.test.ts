import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  resolveRetryExecutionBinding,
  selectRetryExecutionBinding,
} from "@/lib/retryExecutionBinding";
import type { ResultExecutionBinding } from "@/lib/retryExecutionBinding";

function binding(
  strategy: "fused_matcher" | "schoedel_2026_app_within_screen_prose_v1",
  marker: number,
): ResultExecutionBinding {
  return {
    options: {
      ...DEFAULT_BROWSER_OPTIONS,
      episodeReconstructionStrategy: strategy,
    },
    supportFiles: {
      inputCapabilityEvidenceFile: {
        name: `capability-${marker}.json`,
        bytes: new Uint8Array([marker]).buffer,
      },
    },
    runtime: { datetimeOfPreprocessing: `2026-08-12 00:00:0${marker} UTC` },
  };
}

describe("retry execution binding", () => {
  it("keeps the exact prior A binding when live settings have changed to B", () => {
    const armA = binding("schoedel_2026_app_within_screen_prose_v1", 1);
    const liveB = binding("fused_matcher", 2);
    expect(
      selectRetryExecutionBinding(1, armA.options, armA, liveB),
    ).toBe(armA);
  });

  it("uses the current binding only when there are no results to merge", () => {
    const current = binding("fused_matcher", 2);
    expect(selectRetryExecutionBinding(0, null, null, current)).toBe(current);
  });

  it("refuses a first attempt whose live binding has not been resolved yet", () => {
    expect(() => selectRetryExecutionBinding(0, null, null, null)).toThrow(
      "The current retry binding has not been resolved.",
    );
  });

  it("keeps an all-refused A attempt without resolving edited live B", async () => {
    const armA = binding("schoedel_2026_app_within_screen_prose_v1", 1);
    const liveResolver = vi.fn(() => Promise.resolve(binding("fused_matcher", 2)));
    await expect(
      resolveRetryExecutionBinding(0, armA.options, armA, liveResolver),
    ).resolves.toBe(armA);
    expect(liveResolver).not.toHaveBeenCalled();
  });

  it("refuses to merge when a restored result has no exact in-memory binding", () => {
    const prior = binding("schoedel_2026_app_within_screen_prose_v1", 1);
    expect(() =>
      selectRetryExecutionBinding(
        1,
        prior.options,
        null,
        binding("fused_matcher", 2),
      ),
    ).toThrow("exact binding");
  });
});
