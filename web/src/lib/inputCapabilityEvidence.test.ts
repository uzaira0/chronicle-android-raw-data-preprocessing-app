import { describe, expect, it } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  hasSourceSensitiveScreenStrategy,
  requiresLiveScientificPreflight,
  usesInputCapabilityEvidence,
  validateInputCapabilityEvidenceFile,
} from "@/lib/inputCapabilityEvidence";

describe("input capability evidence activation", () => {
  it("is inactive for the Chronicle compatibility strategy", () => {
    expect(hasSourceSensitiveScreenStrategy(DEFAULT_BROWSER_OPTIONS)).toBe(
      false,
    );
    expect(usesInputCapabilityEvidence(DEFAULT_BROWSER_OPTIONS)).toBe(false);
  });

  it("activates for either source-sensitive requested screen product", () => {
    for (const screenSessionConstructionStrategy of [
      "parry_toth_2025_session_glance_v1",
      "zhu_2018_unlock_lock_v1",
      "unlock_to_lock_v1",
      "unlock_to_off_or_lock_v1",
    ] as const) {
      expect(
        usesInputCapabilityEvidence({
          ...DEFAULT_BROWSER_OPTIONS,
          screenSessionConstructionStrategy,
        }),
      ).toBe(true);
    }
  });

  it("stays active for Schoedel's internal B05 dependency when screen publication is off", () => {
    expect(
      usesInputCapabilityEvidence({
        ...DEFAULT_BROWSER_OPTIONS,
        processScreenUsage: false,
        processAppUsage: true,
        episodeReconstructionStrategy:
          "schoedel_2026_app_within_screen_prose_v1",
        screenSessionConstructionStrategy: "parry_toth_2025_session_glance_v1",
      }),
    ).toBe(true);
  });

  it("does not transport a retained upload when no output consumes B05", () => {
    expect(
      usesInputCapabilityEvidence({
        ...DEFAULT_BROWSER_OPTIONS,
        processScreenUsage: false,
        processAppUsage: false,
        screenSessionConstructionStrategy: "zhu_2018_unlock_lock_v1",
      }),
    ).toBe(false);
  });

  it("activates B05 and capability evidence for app-only screen policies", () => {
    for (const hiddenScreenPolicy of [
      { screenSessionMaximumDurationDisposition: "exclude_participant" },
      {
        lockedScreenAudioDisposition:
          "exclude_from_phone_and_app_sessions",
      },
    ] as const) {
      const options = {
        ...DEFAULT_BROWSER_OPTIONS,
        processScreenUsage: false,
        processAppUsage: true,
        episodeReconstructionStrategy: "fused_matcher" as const,
        screenSessionConstructionStrategy:
          "parry_toth_2025_session_glance_v1" as const,
        ...hiddenScreenPolicy,
      };
      expect(usesInputCapabilityEvidence(options)).toBe(true);
      expect(requiresLiveScientificPreflight(options)).toBe(true);
    }
  });

  it("requires live scientific preflight for every and only active browser arm", () => {
    expect(requiresLiveScientificPreflight(DEFAULT_BROWSER_OPTIONS)).toBe(true);
    expect(
      requiresLiveScientificPreflight({
        ...DEFAULT_BROWSER_OPTIONS,
        processScreenUsage: false,
        episodeReconstructionStrategy: "fused_matcher",
      }),
    ).toBe(false);
    expect(
      requiresLiveScientificPreflight({
        ...DEFAULT_BROWSER_OPTIONS,
        processScreenUsage: true,
      }),
    ).toBe(true);
    for (const episodeReconstructionStrategy of [
      "schoedel_2026_app_within_screen_prose_v1",
      "eyes_complement",
    ] as const) {
      expect(
        requiresLiveScientificPreflight({
          ...DEFAULT_BROWSER_OPTIONS,
          processAppUsage: true,
          episodeReconstructionStrategy,
        }),
      ).toBe(true);
      expect(
        requiresLiveScientificPreflight({
          ...DEFAULT_BROWSER_OPTIONS,
          processAppUsage: false,
          processScreenUsage: false,
          episodeReconstructionStrategy,
        }),
      ).toBe(false);
    }
  });

  it("rejects a wrong-format or empty upload before scientific preflight", () => {
    expect(() =>
      validateInputCapabilityEvidenceFile({
        name: "capabilities.xlsx",
        bytes: new Uint8Array([1]).buffer,
      }),
    ).toThrow(/\.csv format/);
    expect(() =>
      validateInputCapabilityEvidenceFile({
        name: "capabilities.csv",
        bytes: new ArrayBuffer(0),
      }),
    ).toThrow(/must not be empty/);
    expect(() =>
      validateInputCapabilityEvidenceFile({
        name: "CAPABILITIES.CSV",
        bytes: new Uint8Array([1]).buffer,
      }),
    ).not.toThrow();
  });
});
