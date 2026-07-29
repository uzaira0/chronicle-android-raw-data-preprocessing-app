import { useMemo, type Dispatch, type SetStateAction } from "react";
import type { ReactElement } from "react";

import { Combobox } from "@/components/Combobox";
import { SectionCard } from "@/components/SectionCard";
import { SettingsField } from "@/components/SettingsField";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { TIMEZONE_HANDLING_OPTIONS } from "@/lib/processingUiContract";
import { TOOLTIPS } from "@/lib/tooltipText";
import { anyOptionModified, isOptionDefault, type OptionKey } from "@/lib/optionDefaults";
import type { BrowserProcessingOptions } from "@/lib/types";

const KEYS: readonly OptionKey[] = ["timezoneHandling", "selectedTimezone"];

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
  discoveredTimezones: string[];
  hasFiles: boolean;
  isRunning: boolean;
  onDiscover: () => void;
};

export function TimezoneCard({
  options,
  setOptions,
  discoveredTimezones,
  hasFiles,
  isRunning,
  onDiscover,
}: Props): ReactElement {
  const update = <K extends OptionKey>(key: K, value: BrowserProcessingOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };
  const reset = (key: OptionKey) => {
    setOptions((current) => ({ ...current, [key]: DEFAULT_BROWSER_OPTIONS[key] }));
  };

  const timezoneSuggestions = useMemo(() => {
    const system =
      typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return Array.from(new Set([...system, ...discoveredTimezones])).sort((a, b) =>
      a.localeCompare(b),
    );
  }, [discoveredTimezones]);

  return (
    <SectionCard
      id="timezone"
      title="Timezone"
      accent="timezone"
      modified={anyOptionModified(options, KEYS)}
    >
      <div className="settings-grid-1">
        <SettingsField
          label="Timezone handling"
          htmlFor="timezone-handling-select"
          tooltip={TOOLTIPS.timezoneHandling}
          modified={!isOptionDefault("timezoneHandling", options.timezoneHandling)}
          onReset={() => reset("timezoneHandling")}
        >
          <select
            id="timezone-handling-select"
            data-testid="timezone-handling-select"
            className="select"
            value={options.timezoneHandling}
            onChange={(event) =>
              update(
                "timezoneHandling",
                event.target.value as BrowserProcessingOptions["timezoneHandling"],
              )
            }
          >
            {TIMEZONE_HANDLING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingsField>

        <SettingsField
          label="Selected timezone"
          tooltip={TOOLTIPS.selectedTimezone}
          modified={!isOptionDefault("selectedTimezone", options.selectedTimezone)}
          onReset={() => reset("selectedTimezone")}
        >
          <Combobox
            testId="selected-timezone-input"
            ariaLabel="Selected timezone"
            placeholder="America/Chicago"
            value={options.selectedTimezone ?? ""}
            onChange={(next) => update("selectedTimezone", next)}
            options={timezoneSuggestions}
          />
        </SettingsField>
      </div>
      <div className="button-row">
        <button
          type="button"
          className="btn btn--ghost"
          data-testid="discover-timezones-button"
          onClick={onDiscover}
          disabled={isRunning || !hasFiles}
        >
          Find timezones in selected files
        </button>
        {discoveredTimezones.length ? (
          <span className="text-faint u-meta-xs">
            Discovered: {discoveredTimezones.join(", ")}
          </span>
        ) : null}
      </div>
    </SectionCard>
  );
}
