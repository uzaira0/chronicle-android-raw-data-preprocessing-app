import type { BrowserProcessingOptions, BrowserSupportFile } from "@/lib/types";

const SOURCE_SENSITIVE_SCREEN_STRATEGIES = new Set<
  BrowserProcessingOptions["screenSessionConstructionStrategy"]
>([
  "parry_toth_2025_session_glance_v1",
  "zhu_2018_unlock_lock_v1",
  "unlock_to_lock_v1",
  "unlock_to_off_or_lock_v1",
]);

export function hasSourceSensitiveScreenStrategy(
  options: BrowserProcessingOptions,
): boolean {
  return SOURCE_SENSITIVE_SCREEN_STRATEGIES.has(
    options.screenSessionConstructionStrategy,
  );
}

function requiresB05ScreenConstruction(
  options: BrowserProcessingOptions,
): boolean {
  return (
    options.processScreenUsage ||
    (options.processAppUsage &&
      options.episodeReconstructionStrategy ===
        "schoedel_2026_app_within_screen_prose_v1") ||
    options.screenSessionMaximumDurationDisposition === "exclude_participant" ||
    options.lockedScreenAudioDisposition ===
      "exclude_from_phone_and_app_sessions"
  );
}

/**
 * Whether capability evidence is an active scientific input for this vector.
 *
 * The upload may remain in project/UI state while inactive. It crosses the
 * worker boundary only when a source-sensitive B05 strategy feeds an active
 * screen timeline, or the Schoedel app arm consumes its own capability facts.
 */
export function usesInputCapabilityEvidence(
  options: BrowserProcessingOptions,
): boolean {
  return (
    (requiresB05ScreenConstruction(options) &&
      hasSourceSensitiveScreenStrategy(options)) ||
    (options.processAppUsage &&
      options.episodeReconstructionStrategy ===
        "schoedel_2026_app_within_screen_prose_v1")
  );
}

/** Exact browser mirror of the kernel's input-dependent preflight activation. */
export function requiresLiveScientificPreflight(
  options: BrowserProcessingOptions,
): boolean {
  return (
    requiresB05ScreenConstruction(options) ||
    (options.processAppUsage &&
      options.episodeReconstructionStrategy === "eyes_complement")
  );
}

/** Reject malformed uploaded artifacts before scientific applicability runs. */
export function validateInputCapabilityEvidenceFile(
  file: BrowserSupportFile,
): void {
  if (!file.name.toLocaleLowerCase().endsWith(".csv")) {
    throw new Error("inputCapabilityEvidenceFile must use the .csv format");
  }
  if (file.bytes.byteLength === 0) {
    throw new Error("inputCapabilityEvidenceFile must not be empty");
  }
}
