import type { Dispatch, SetStateAction } from "react";
import type { ReactElement } from "react";

import { SectionCard } from "@/components/SectionCard";
import { SettingsField } from "@/components/SettingsField";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/browserPipeline";
import { TOOLTIPS } from "@/lib/tooltipText";
import { anyOptionModified, isOptionDefault, type OptionKey } from "@/lib/optionDefaults";
import { rangeError } from "@/lib/validation";
import type { BrowserProcessingOptions } from "@/lib/types";

const KEYS: readonly OptionKey[] = [
  "screenUsageAutoLockTimeoutSeconds",
  "screenUsageAutoLockToleranceSeconds",
  "screenUsageManualLockMaxTailGapSeconds",
  "screenUsageKeyguardNearStopSeconds",
];

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
      {!options.processScreenUsage ? (
        <p className="settings-dependency-note" role="note" data-testid="screen-dependency-note">
          Screen usage output is off, so these screen-detection settings won’t change any output.
          Turn on “Screen usage output” in Output &amp; plots to use them.
        </p>
      ) : null}
      <div className="settings-grid-2">
        <SettingsField
          label="Auto lock timeout (seconds)"
          tooltip={TOOLTIPS.screenUsageAutoLockTimeoutSeconds}
          modified={isMod("screenUsageAutoLockTimeoutSeconds")}
          onReset={() => reset("screenUsageAutoLockTimeoutSeconds")}
          error={rangeError(options.screenUsageAutoLockTimeoutSeconds, 1, 3600)}
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
          error={rangeError(options.screenUsageAutoLockToleranceSeconds, 0, 600)}
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
          error={rangeError(options.screenUsageManualLockMaxTailGapSeconds, 0, 600)}
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
          error={rangeError(options.screenUsageKeyguardNearStopSeconds, 0, 60)}
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
