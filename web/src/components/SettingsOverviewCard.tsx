import type { Dispatch, ReactElement, SetStateAction } from "react";

import { SettingsField } from "@/components/SettingsField";
import { DEFAULT_BROWSER_OPTIONS, USAGE_SESSION_MODE_OPTIONS } from "@/lib/browserPipeline";
import { TOOLTIPS } from "@/lib/tooltipText";
import { isOptionDefault } from "@/lib/optionDefaults";
import type { BrowserProcessingOptions } from "@/lib/types";

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
};

export function SettingsOverviewCard({ options, setOptions }: Props): ReactElement {
  return (
    <section className="settings-overview" aria-label="Core settings">
      <SettingsField
        label="Study name"
        tooltip={TOOLTIPS.studyName}
        modified={!isOptionDefault("studyName", options.studyName)}
        onReset={() =>
          setOptions((current) => ({ ...current, studyName: DEFAULT_BROWSER_OPTIONS.studyName }))
        }
      >
        <input
          data-testid="study-name-input"
          className="input"
          placeholder="optional"
          value={options.studyName}
          onChange={(event) =>
            setOptions((current) => ({ ...current, studyName: event.target.value }))
          }
        />
      </SettingsField>

      <SettingsField
        label="Output mode"
        tooltip={TOOLTIPS.usageSessionMode}
        modified={!isOptionDefault("usageSessionMode", options.usageSessionMode)}
        onReset={() =>
          setOptions((current) => ({
            ...current,
            usageSessionMode: DEFAULT_BROWSER_OPTIONS.usageSessionMode,
          }))
        }
      >
        <div className="segmented-control" role="group" aria-label="Output mode">
          {USAGE_SESSION_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={options.usageSessionMode === option.value ? "is-selected" : ""}
              data-testid={`usage-mode-${option.value}`}
              onClick={() =>
                setOptions((current) => ({
                  ...current,
                  usageSessionMode: option.value,
                }))
              }
            >
              {option.value === "app_usage"
                ? "App"
                : option.value === "screen_usage"
                  ? "Screen"
                  : "Both"}
            </button>
          ))}
        </div>
        <select
          data-testid="usage-mode-select"
          className="select u-visually-compatible-select"
          value={options.usageSessionMode}
          onChange={(event) =>
            setOptions((current) => ({
              ...current,
              usageSessionMode: event.target.value as BrowserProcessingOptions["usageSessionMode"],
            }))
          }
          aria-label="Output mode compatibility select"
        >
          {USAGE_SESSION_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </SettingsField>
    </section>
  );
}
