import type { Dispatch, SetStateAction, ReactElement } from "react";

import { SectionCard } from "@/components/SectionCard";
import { ToggleField } from "@/components/ToggleField";
import { Tooltip } from "@/components/Tooltip";
import { TOOLTIPS } from "@/lib/tooltipText";
import { anyOptionModified, isOptionDefault, type OptionKey } from "@/lib/optionDefaults";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/browserPipeline";
import type { BrowserProcessingOptions } from "@/lib/types";

const KEYS: readonly OptionKey[] = ["includeFilteredAppUsageInPlots"];

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
};

export function PlottingCard({ options, setOptions }: Props): ReactElement | null {
  const update = <K extends OptionKey>(key: K, value: BrowserProcessingOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };
  const reset = (key: OptionKey) => {
    setOptions((current) => ({ ...current, [key]: DEFAULT_BROWSER_OPTIONS[key] }));
  };

  if (!options.enablePlotting) return null;

  return (
    <SectionCard
      id="plotting"
      title="Plot output"
      accent="files"
      modified={anyOptionModified(options, KEYS)}
    >
      <p className="u-card-intro">
        Generates PNG timeline charts per participant and adds them to the output ZIP. App-usage plots are always included when plots are on; screen-usage plots are included when screen usage is also on.
      </p>

      <div className="settings-field">
        <div className="u-inline-cluster">
          <span className="settings-field__label">Include filtered apps in plots</span>
          <Tooltip
            content={TOOLTIPS.includeFilteredAppUsageInPlots}
            label="Help: Include filtered apps in plots"
          />
        </div>
        <ToggleField
          label="Enabled"
          checked={options.includeFilteredAppUsageInPlots}
          onChange={(value) => update("includeFilteredAppUsageInPlots", value)}
          testId="toggle-includeFilteredAppUsageInPlots"
          modified={!isOptionDefault("includeFilteredAppUsageInPlots", options.includeFilteredAppUsageInPlots)}
          onReset={() => reset("includeFilteredAppUsageInPlots")}
        />
      </div>
    </SectionCard>
  );
}
