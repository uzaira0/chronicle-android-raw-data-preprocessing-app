import type { Dispatch, ReactElement, SetStateAction } from "react";

import { SettingsField } from "@/components/SettingsField";
import { ToggleField } from "@/components/ToggleField";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/browserPipeline";
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

      <SettingsField label="Output mode">
        <ToggleField
          label="App usage"
          checked={options.processAppUsage}
          onChange={(value) => setOptions((current) => ({ ...current, processAppUsage: value }))}
          testId="toggle-processAppUsage"
          tooltip={TOOLTIPS.processAppUsage}
          modified={!isOptionDefault("processAppUsage", options.processAppUsage)}
          onReset={() => setOptions((current) => ({ ...current, processAppUsage: DEFAULT_BROWSER_OPTIONS.processAppUsage }))}
        />
        <ToggleField
          label="Screen usage"
          checked={options.processScreenUsage}
          onChange={(value) => setOptions((current) => ({ ...current, processScreenUsage: value }))}
          testId="toggle-processScreenUsage"
          tooltip={TOOLTIPS.processScreenUsage}
          modified={!isOptionDefault("processScreenUsage", options.processScreenUsage)}
          onReset={() => setOptions((current) => ({ ...current, processScreenUsage: DEFAULT_BROWSER_OPTIONS.processScreenUsage }))}
        />
        <ToggleField
          label="Plots"
          checked={options.enablePlotting}
          onChange={(value) => setOptions((current) => ({ ...current, enablePlotting: value }))}
          testId="toggle-enablePlotting"
          tooltip={TOOLTIPS.enablePlotting}
          modified={!isOptionDefault("enablePlotting", options.enablePlotting)}
          onReset={() => setOptions((current) => ({ ...current, enablePlotting: DEFAULT_BROWSER_OPTIONS.enablePlotting }))}
        />
      </SettingsField>
    </section>
  );
}
