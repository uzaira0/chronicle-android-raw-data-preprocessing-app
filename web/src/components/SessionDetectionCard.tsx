import type { Dispatch, SetStateAction } from "react";
import type { ReactElement } from "react";

import { SectionCard } from "@/components/SectionCard";
import { SettingsField } from "@/components/SettingsField";
import { ToggleField } from "@/components/ToggleField";
import { ThresholdsInput } from "@/components/ThresholdsInput";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/browserPipeline";
import { TOOLTIPS } from "@/lib/tooltipText";
import { anyOptionModified, isOptionDefault, type OptionKey } from "@/lib/optionDefaults";
import type { BrowserProcessingOptions } from "@/lib/types";

const KEYS: readonly OptionKey[] = [
  "longDurationThresholdHours",
  "minimumUsageDuration",
  "filterZeroDurationSessions",
  "customAppEngagementDuration",
  "longUsageDurationThresholds",
  "longDataTimeGapThresholds",
  "proximityIntervalSeconds",
  "correctDuplicateEventTimestamps",
  "deduplicateExactRows",
  "allowStopEventReuse",
  "useActivityStoppedAsFallback",
  "applyThresholdToFallback",
  "addNoActivityPlaceholderDays",
];

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
};

export function SessionDetectionCard({ options, setOptions }: Props): ReactElement {
  const update = <K extends OptionKey>(key: K, value: BrowserProcessingOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };
  const reset = (key: OptionKey) => {
    setOptions((current) => ({ ...current, [key]: DEFAULT_BROWSER_OPTIONS[key] }));
  };
  const isMod = <K extends OptionKey>(key: K) => !isOptionDefault(key, options[key]);

  return (
    <SectionCard
      id="session-detection"
      title="Session detection"
      accent="session"
      modified={anyOptionModified(options, KEYS)}
    >
      <div className="settings-grid-2">
        <SettingsField
          label="Max session duration threshold (hours)"
          htmlFor="long-duration-threshold-input"
          tooltip={TOOLTIPS.longDurationThresholdHours}
          modified={isMod("longDurationThresholdHours")}
          onReset={() => reset("longDurationThresholdHours")}
        >
          <input
            id="long-duration-threshold-input"
            data-testid="long-duration-threshold-input"
            type="number"
            className="input"
            min={1}
            max={48}
            step={0.5}
            value={options.longDurationThresholdHours}
            onChange={(event) =>
              update("longDurationThresholdHours", Number(event.target.value))
            }
          />
        </SettingsField>

        <SettingsField
          label="Minimum usage duration (seconds)"
          htmlFor="minimum-usage-duration-input"
          tooltip={TOOLTIPS.minimumUsageDuration}
          modified={isMod("minimumUsageDuration")}
          onReset={() => reset("minimumUsageDuration")}
        >
          <input
            id="minimum-usage-duration-input"
            data-testid="minimum-usage-duration-input"
            type="number"
            className="input"
            min={0}
            max={3600}
            value={options.minimumUsageDuration}
            onChange={(event) =>
              update("minimumUsageDuration", Number(event.target.value))
            }
          />
        </SettingsField>

        <SettingsField
          label="Custom app engagement duration (seconds)"
          htmlFor="custom-engagement-duration-input"
          tooltip={TOOLTIPS.customAppEngagementDuration}
          modified={isMod("customAppEngagementDuration")}
          onReset={() => reset("customAppEngagementDuration")}
        >
          <input
            id="custom-engagement-duration-input"
            data-testid="custom-engagement-duration-input"
            type="number"
            className="input"
            min={1}
            max={3600}
            value={options.customAppEngagementDuration}
            onChange={(event) =>
              update("customAppEngagementDuration", Number(event.target.value))
            }
          />
        </SettingsField>

        <SettingsField
          label="Long usage thresholds (hours)"
          tooltip={TOOLTIPS.longUsageDurationThresholds}
          modified={isMod("longUsageDurationThresholds")}
          onReset={() => reset("longUsageDurationThresholds")}
        >
          <ThresholdsInput
            testId="long-usage-thresholds-input"
            value={options.longUsageDurationThresholds}
            fallback={DEFAULT_BROWSER_OPTIONS.longUsageDurationThresholds}
            onChange={(next) => update("longUsageDurationThresholds", next)}
            placeholder="1, 2, 3, …"
          />
        </SettingsField>

        <SettingsField
          label="Long data gap thresholds (hours)"
          tooltip={TOOLTIPS.longDataTimeGapThresholds}
          modified={isMod("longDataTimeGapThresholds")}
          onReset={() => reset("longDataTimeGapThresholds")}
        >
          <ThresholdsInput
            testId="long-gap-thresholds-input"
            value={options.longDataTimeGapThresholds}
            fallback={DEFAULT_BROWSER_OPTIONS.longDataTimeGapThresholds}
            onChange={(next) => update("longDataTimeGapThresholds", next)}
            placeholder="1, 2, 3, …"
          />
        </SettingsField>

        <SettingsField
          label="Intra-app teardown grace (seconds)"
          htmlFor="proximity-interval-input"
          tooltip={TOOLTIPS.proximityIntervalSeconds}
          modified={isMod("proximityIntervalSeconds")}
          onReset={() => reset("proximityIntervalSeconds")}
        >
          <input
            id="proximity-interval-input"
            data-testid="proximity-interval-input"
            type="number"
            className="input"
            min={0}
            max={3600}
            step={0.5}
            value={options.proximityIntervalSeconds}
            onChange={(event) =>
              update("proximityIntervalSeconds", Number(event.target.value))
            }
          />
        </SettingsField>
      </div>

      <div className="settings-grid-1">
        <ToggleField
          label="Correct duplicate event timestamps"
          tooltip={TOOLTIPS.correctDuplicateEventTimestamps}
          checked={options.correctDuplicateEventTimestamps}
          onChange={(value) => update("correctDuplicateEventTimestamps", value)}
          testId="toggle-correctDuplicateEventTimestamps"
          modified={isMod("correctDuplicateEventTimestamps")}
          onReset={() => reset("correctDuplicateEventTimestamps")}
        />
        <ToggleField
          label="Collapse exact duplicate rows"
          tooltip={TOOLTIPS.deduplicateExactRows}
          checked={options.deduplicateExactRows}
          onChange={(value) => update("deduplicateExactRows", value)}
          testId="toggle-deduplicateExactRows"
          modified={isMod("deduplicateExactRows")}
          onReset={() => reset("deduplicateExactRows")}
        />
        <ToggleField
          label="Allow stop event reuse"
          tooltip={TOOLTIPS.allowStopEventReuse}
          checked={options.allowStopEventReuse}
          onChange={(value) => update("allowStopEventReuse", value)}
          testId="toggle-allowStopEventReuse"
          modified={isMod("allowStopEventReuse")}
          onReset={() => reset("allowStopEventReuse")}
        />
        <ToggleField
          label="Use Activity Stopped fallback"
          tooltip={TOOLTIPS.useActivityStoppedAsFallback}
          checked={options.useActivityStoppedAsFallback}
          onChange={(value) => update("useActivityStoppedAsFallback", value)}
          testId="toggle-useActivityStoppedAsFallback"
          modified={isMod("useActivityStoppedAsFallback")}
          onReset={() => reset("useActivityStoppedAsFallback")}
        />
        <ToggleField
          label="Apply threshold to Activity Stopped fallback"
          tooltip={TOOLTIPS.applyThresholdToFallback}
          checked={options.applyThresholdToFallback}
          onChange={(value) => update("applyThresholdToFallback", value)}
          testId="toggle-applyThresholdToFallback"
          modified={isMod("applyThresholdToFallback")}
          onReset={() => reset("applyThresholdToFallback")}
        />
        <ToggleField
          label="Filter zero duration sessions"
          tooltip={TOOLTIPS.filterZeroDurationSessions}
          checked={options.filterZeroDurationSessions}
          onChange={(value) => update("filterZeroDurationSessions", value)}
          testId="toggle-filterZeroDurationSessions"
          modified={isMod("filterZeroDurationSessions")}
          onReset={() => reset("filterZeroDurationSessions")}
        />
        <ToggleField
          label="Add no-activity placeholder days"
          tooltip={TOOLTIPS.addNoActivityPlaceholderDays}
          checked={options.addNoActivityPlaceholderDays}
          onChange={(value) => update("addNoActivityPlaceholderDays", value)}
          testId="toggle-addNoActivityPlaceholderDays"
          modified={isMod("addNoActivityPlaceholderDays")}
          onReset={() => reset("addNoActivityPlaceholderDays")}
        />
      </div>
    </SectionCard>
  );
}
