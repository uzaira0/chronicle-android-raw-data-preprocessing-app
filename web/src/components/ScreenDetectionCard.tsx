import type { Dispatch, SetStateAction } from "react";
import type { ReactElement } from "react";

import { SectionCard } from "@/components/SectionCard";
import { SettingsField } from "@/components/SettingsField";
import {
  DEFAULT_BROWSER_OPTIONS,
  LOCKED_SCREEN_AUDIO_DISPOSITION_VALUES,
  SCREEN_SESSION_CLASSIFICATION_POLICY_VALUES,
  SCREEN_SESSION_CONSTRUCTION_STRATEGY_VALUES,
  type LockedScreenAudioDisposition,
  type ScreenSessionClassificationPolicy,
  type ScreenSessionConstructionStrategy,
} from "@/lib/generatedContract";
import { hasSourceSensitiveScreenStrategy } from "@/lib/inputCapabilityEvidence";
import { TOOLTIPS } from "@/lib/tooltipText";
import { anyOptionModified, isOptionDefault, type OptionKey } from "@/lib/optionDefaults";
import { optionRangeError } from "@/lib/validation";
import type { BrowserProcessingOptions } from "@/lib/types";

export { applyScreenMaximumDurationChange } from "@/components/CleaningSettingsCard";

const KEYS: readonly OptionKey[] = [
  "screenSessionConstructionStrategy",
  "screenSessionClassificationPolicy",
  "lockedScreenAudioDisposition",
  "screenUsageAutoLockTimeoutSeconds",
  "screenUsageAutoLockToleranceSeconds",
  "screenUsageManualLockMaxTailGapSeconds",
  "screenUsageKeyguardNearStopSeconds",
];

const SCREEN_SESSION_CONSTRUCTION_LABELS = {
  chronicle_screen_interactive_v1: "Chronicle screen interactive v1 (default)",
  parry_toth_2025_session_glance_v1:
    "Parry–Toth session/glance construction (2025)",
  zhu_2018_unlock_lock_v1: "Zhu unlock/lock construction (2018)",
  unlock_to_lock_v1: "Unlock to keyguard lock",
  unlock_to_off_or_lock_v1: "Unlock to first screen-off or keyguard lock",
} satisfies Record<ScreenSessionConstructionStrategy, string>;

export const SCREEN_SESSION_CONSTRUCTION_STRATEGIES =
  SCREEN_SESSION_CONSTRUCTION_STRATEGY_VALUES.map((value) => ({
    value,
    label: SCREEN_SESSION_CONSTRUCTION_LABELS[value],
  }));

const CLASSIFICATION_LABELS = {
  none: "No literature classification (default)",
  phone_check_inclusive_15s: "Phone check at or below 15 seconds",
  null_no_app_strict_gt15s_vs_app: "Null over 15 seconds vs app-evidenced",
} satisfies Record<ScreenSessionClassificationPolicy, string>;

const LOCKED_AUDIO_LABELS = {
  include: "Include under normal reconstruction (default)",
  exclude_from_phone_and_app_sessions: "Exclude without unlocked screen witness",
} satisfies Record<LockedScreenAudioDisposition, string>;

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
};

export function ScreenDetectionCard({ options, setOptions }: Props): ReactElement {
  const update = <K extends OptionKey>(key: K, value: BrowserProcessingOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };
  const reset = (key: OptionKey) => {
    setOptions((current) => ({ ...current, [key]: DEFAULT_BROWSER_OPTIONS[key] }));
  };
  const isMod = <K extends OptionKey>(key: K) => !isOptionDefault(key, options[key]);
  const schoedelUsesScreenIntervals =
    options.processAppUsage &&
    options.episodeReconstructionStrategy ===
      "schoedel_2026_app_within_screen_prose_v1";
  const lockedAudioUsesScreenIntervals =
    options.processAppUsage &&
    options.lockedScreenAudioDisposition === "exclude_from_phone_and_app_sessions";
  const participantExclusionUsesScreenIntervals =
    options.screenSessionMaximumDurationDisposition === "exclude_participant";
  const screenIntervalsAffectAnalysis =
    schoedelUsesScreenIntervals ||
    lockedAudioUsesScreenIntervals ||
    participantExclusionUsesScreenIntervals;

  return (
    <SectionCard
      id="screen-detection"
      title="Screen detection"
      accent="screen"
      defaultExpanded={false}
      modified={anyOptionModified(options, KEYS)}
    >
      <p className="u-card-intro">
        Tunes how the screen usage derivation infers locks and unlocks. Defaults reflect the
        canonical desktop pipeline; only adjust if your traces have unusual lock behavior.
      </p>
      {!options.processScreenUsage && !screenIntervalsAffectAnalysis ? (
        <p className="settings-dependency-note" role="note" data-testid="screen-dependency-note">
          Screen usage output is off, so these screen-detection settings won’t change any output.
          Turn on “Screen usage output” in Output &amp; plots to use them.
        </p>
      ) : null}
      {!options.processScreenUsage && screenIntervalsAffectAnalysis ? (
        <p
          className="settings-dependency-note"
          role="note"
          data-testid="screen-internal-dependency-note"
        >
          Screen CSV publication is off, but the selected screen-session rule is still computed
          as an analytical input. Only the separate screen product is omitted.
        </p>
      ) : null}
      {hasSourceSensitiveScreenStrategy(options) ? (
        <p
          className="settings-dependency-note"
          role="note"
          data-testid="screen-capability-evidence-note"
        >
          This source-sensitive rule needs a digest-bound Input capability evidence CSV from
          Study inputs. Missing or insufficient evidence produces a typed scientific refusal;
          Chronicle never substitutes its default screen rule.
        </p>
      ) : null}
      <div className="settings-grid-1">
        <SettingsField
          label="Screen-session construction rule"
          htmlFor="screen-session-construction-strategy-select"
          tooltip={TOOLTIPS.screenSessionConstructionStrategy}
          modified={isMod("screenSessionConstructionStrategy")}
          onReset={() => reset("screenSessionConstructionStrategy")}
        >
          <select
            id="screen-session-construction-strategy-select"
            data-testid="screen-session-construction-strategy-select"
            className="select"
            value={options.screenSessionConstructionStrategy}
            onChange={(event) =>
              update(
                "screenSessionConstructionStrategy",
                event.target
                  .value as BrowserProcessingOptions["screenSessionConstructionStrategy"],
              )
            }
          >
            {SCREEN_SESSION_CONSTRUCTION_STRATEGIES.map((strategy) => (
              <option key={strategy.value} value={strategy.value}>
                {strategy.label}
              </option>
            ))}
          </select>
        </SettingsField>
      </div>
      <div className="settings-grid-2">
        <SettingsField
          label="Screen-session classification"
          htmlFor="screen-session-classification-select"
          tooltip={TOOLTIPS.screenSessionClassificationPolicy}
          modified={isMod("screenSessionClassificationPolicy")}
          onReset={() => reset("screenSessionClassificationPolicy")}
        >
          <select
            id="screen-session-classification-select"
            className="select"
            value={options.screenSessionClassificationPolicy}
            onChange={(event) =>
              update(
                "screenSessionClassificationPolicy",
                event.target.value as BrowserProcessingOptions["screenSessionClassificationPolicy"],
              )
            }
          >
            {SCREEN_SESSION_CLASSIFICATION_POLICY_VALUES.map((value) => (
              <option key={value} value={value}>{CLASSIFICATION_LABELS[value]}</option>
            ))}
          </select>
        </SettingsField>
        <SettingsField
          label="Locked-screen audio"
          htmlFor="locked-screen-audio-select"
          tooltip={TOOLTIPS.lockedScreenAudioDisposition}
          modified={isMod("lockedScreenAudioDisposition")}
          onReset={() => reset("lockedScreenAudioDisposition")}
        >
          <select
            id="locked-screen-audio-select"
            className="select"
            value={options.lockedScreenAudioDisposition}
            onChange={(event) =>
              update(
                "lockedScreenAudioDisposition",
                event.target.value as BrowserProcessingOptions["lockedScreenAudioDisposition"],
              )
            }
          >
            {LOCKED_SCREEN_AUDIO_DISPOSITION_VALUES.map((value) => (
              <option key={value} value={value}>{LOCKED_AUDIO_LABELS[value]}</option>
            ))}
          </select>
        </SettingsField>
      </div>
      <div className="settings-grid-2">
        <SettingsField
          label="Auto lock timeout (seconds)"
          tooltip={TOOLTIPS.screenUsageAutoLockTimeoutSeconds}
          modified={isMod("screenUsageAutoLockTimeoutSeconds")}
          onReset={() => reset("screenUsageAutoLockTimeoutSeconds")}
          error={optionRangeError("screenUsageAutoLockTimeoutSeconds", options.screenUsageAutoLockTimeoutSeconds)}
        >
          <input
            type="number"
            className="input"
            data-testid="screen-autolock-timeout-input"
            min={1}
            max={3600}
            value={options.screenUsageAutoLockTimeoutSeconds}
            onChange={(event) =>
              update("screenUsageAutoLockTimeoutSeconds", Number(event.target.value))
            }
          />
        </SettingsField>
        <SettingsField
          label="Auto lock tolerance (seconds)"
          tooltip={TOOLTIPS.screenUsageAutoLockToleranceSeconds}
          modified={isMod("screenUsageAutoLockToleranceSeconds")}
          onReset={() => reset("screenUsageAutoLockToleranceSeconds")}
          error={optionRangeError("screenUsageAutoLockToleranceSeconds", options.screenUsageAutoLockToleranceSeconds)}
        >
          <input
            type="number"
            className="input"
            data-testid="screen-autolock-tolerance-input"
            min={0}
            max={600}
            value={options.screenUsageAutoLockToleranceSeconds}
            onChange={(event) =>
              update("screenUsageAutoLockToleranceSeconds", Number(event.target.value))
            }
          />
        </SettingsField>
        <SettingsField
          label="Manual lock max tail gap (seconds)"
          tooltip={TOOLTIPS.screenUsageManualLockMaxTailGapSeconds}
          modified={isMod("screenUsageManualLockMaxTailGapSeconds")}
          onReset={() => reset("screenUsageManualLockMaxTailGapSeconds")}
          error={optionRangeError("screenUsageManualLockMaxTailGapSeconds", options.screenUsageManualLockMaxTailGapSeconds)}
        >
          <input
            type="number"
            className="input"
            data-testid="screen-manual-lock-gap-input"
            min={0}
            max={600}
            value={options.screenUsageManualLockMaxTailGapSeconds}
            onChange={(event) =>
              update("screenUsageManualLockMaxTailGapSeconds", Number(event.target.value))
            }
          />
        </SettingsField>
        <SettingsField
          label="Keyguard near stop window (seconds)"
          tooltip={TOOLTIPS.screenUsageKeyguardNearStopSeconds}
          modified={isMod("screenUsageKeyguardNearStopSeconds")}
          onReset={() => reset("screenUsageKeyguardNearStopSeconds")}
          error={optionRangeError("screenUsageKeyguardNearStopSeconds", options.screenUsageKeyguardNearStopSeconds)}
        >
          <input
            type="number"
            className="input"
            data-testid="screen-keyguard-window-input"
            min={0}
            max={60}
            value={options.screenUsageKeyguardNearStopSeconds}
            onChange={(event) =>
              update("screenUsageKeyguardNearStopSeconds", Number(event.target.value))
            }
          />
        </SettingsField>
      </div>
    </SectionCard>
  );
}
