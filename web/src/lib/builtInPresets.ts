import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { SETTINGS_SCHEMA_VERSION, type SettingsPreset } from "@/lib/settingsPersistence";
import type { BrowserProcessingOptions } from "@/lib/types";

/** Built-in presets ship with the app: always listed, never stored or deleted. */
export type BuiltInPreset = SettingsPreset & { description: string };

function builtIn(
  id: string,
  name: string,
  description: string,
  options: BrowserProcessingOptions,
): BuiltInPreset {
  return {
    id,
    name,
    description,
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    options,
  };
}

/**
 * The TECH / GNSM personal-phone configuration as `research-pipeline`'s
 * `v1_engine.py` (TECH_KNOBS / GNSM_KNOBS) runs it on the frozen July-16
 * engine: proximity 2 s, 60 s minimum usage, filter file on, no maximum
 * session length (1,000,000 h never fires) with the §14 screen-gated credit
 * truncating at 6 h, America/Chicago. Every other value is the default, which
 * already matches those knobs.
 */
export const TECH_GNSM_OPTIONS: BrowserProcessingOptions = {
  ...DEFAULT_BROWSER_OPTIONS,
  // v1_engine.py: usage_session_mode="app_usage", derive_screen_usage_sessions=False.
  // Screen-gated credit reads the raw screen events, not this output.
  processScreenUsage: false,
  selectedTimezone: "America/Chicago",
  useFilterFile: true,
  minimumUsageDuration: 60,
  longDurationThresholdHours: 1_000_000,
  enableScreenGatedCrediting: true,
  creditedSessionCapMinutes: 360,
};

export const BUILT_IN_PRESETS: readonly BuiltInPreset[] = [
  builtIn(
    "built-in:default-preprocessing",
    "Default Preprocessing (No Cleaning)",
    "The app defaults: preprocessing only, every cleaning step off.",
    DEFAULT_BROWSER_OPTIONS,
  ),
  builtIn(
    "built-in:tech-gnsm",
    "TECH/GNSM (personal phones)",
    "The TECH and GNSM studies' settings: 60 s minimum usage, filter file, no maximum session length, screen-gated credit truncated at 6 h, America/Chicago. Not yet checked against the studies' own credited minutes. GNSM study tablets used a 6 h maximum and no credit instead.",
    TECH_GNSM_OPTIONS,
  ),
];
