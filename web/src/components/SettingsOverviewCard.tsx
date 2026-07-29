import type { Dispatch, ReactElement, SetStateAction } from "react";

import { SettingsField } from "@/components/SettingsField";
import { ToggleField } from "@/components/ToggleField";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { TOOLTIPS } from "@/lib/tooltipText";
import { isOptionDefault } from "@/lib/optionDefaults";
import type { BrowserProcessingOptions } from "@/lib/types";

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
};

export function SettingsOverviewCard({ options, setOptions }: Props): ReactElement {
  return (
    <section className="settings-overview" aria-label="Core settings" data-settings-anchor="overview">
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
        {options.enablePlotting ? (
          <div className="settings-overview__subfield">
            <ToggleField
              label="Include filtered apps in plots"
              checked={options.includeFilteredAppUsageInPlots}
              onChange={(value) =>
                setOptions((current) => ({ ...current, includeFilteredAppUsageInPlots: value }))
              }
              testId="toggle-includeFilteredAppUsageInPlots"
              tooltip={TOOLTIPS.includeFilteredAppUsageInPlots}
              modified={!isOptionDefault("includeFilteredAppUsageInPlots", options.includeFilteredAppUsageInPlots)}
              onReset={() =>
                setOptions((current) => ({
                  ...current,
                  includeFilteredAppUsageInPlots: DEFAULT_BROWSER_OPTIONS.includeFilteredAppUsageInPlots,
                }))
              }
            />
            <ToggleField
              label="Generate activity heatmaps"
              checked={options.enableActivityHeatmap}
              onChange={(value) =>
                setOptions((current) => ({ ...current, enableActivityHeatmap: value }))
              }
              testId="toggle-enableActivityHeatmap"
              tooltip={TOOLTIPS.enableActivityHeatmap}
              modified={!isOptionDefault("enableActivityHeatmap", options.enableActivityHeatmap)}
              onReset={() =>
                setOptions((current) => ({
                  ...current,
                  enableActivityHeatmap: DEFAULT_BROWSER_OPTIONS.enableActivityHeatmap,
                }))
              }
            />
            <ToggleField
              label="Also export plots as SVG (vector)"
              checked={options.exportPlotsAsSvg}
              onChange={(value) =>
                setOptions((current) => ({ ...current, exportPlotsAsSvg: value }))
              }
              testId="toggle-exportPlotsAsSvg"
              tooltip={TOOLTIPS.exportPlotsAsSvg}
              modified={!isOptionDefault("exportPlotsAsSvg", options.exportPlotsAsSvg)}
              onReset={() =>
                setOptions((current) => ({
                  ...current,
                  exportPlotsAsSvg: DEFAULT_BROWSER_OPTIONS.exportPlotsAsSvg,
                }))
              }
            />
          </div>
        ) : null}
        <ToggleField
          label="Aggregate summaries"
          checked={options.enableAggregates}
          onChange={(value) => setOptions((current) => ({ ...current, enableAggregates: value }))}
          testId="toggle-enableAggregates"
          tooltip={TOOLTIPS.enableAggregates}
          modified={!isOptionDefault("enableAggregates", options.enableAggregates)}
          onReset={() =>
            setOptions((current) => ({
              ...current,
              enableAggregates: DEFAULT_BROWSER_OPTIONS.enableAggregates,
            }))
          }
        />
        {options.enableAggregates ? (
          <div className="settings-overview__subfield">
            <SettingsField
              label="Aggregate layout"
              htmlFor="aggregate-shape-select"
              tooltip={TOOLTIPS.aggregateShape}
              modified={!isOptionDefault("aggregateShape", options.aggregateShape)}
              onReset={() =>
                setOptions((current) => ({
                  ...current,
                  aggregateShape: DEFAULT_BROWSER_OPTIONS.aggregateShape,
                }))
              }
            >
              <select
                id="aggregate-shape-select"
                data-testid="select-aggregateShape"
                className="input"
                value={options.aggregateShape}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    aggregateShape: event.target.value as typeof current.aggregateShape,
                  }))
                }
              >
                <option value="wide">Wide (metrics as columns)</option>
                <option value="long">Long (tidy: one row per metric)</option>
              </select>
            </SettingsField>
          </div>
        ) : null}
        <ToggleField
          label="Also export Parquet"
          checked={options.enableParquetExport}
          onChange={(value) =>
            setOptions((current) => ({ ...current, enableParquetExport: value }))
          }
          testId="toggle-enableParquetExport"
          tooltip={TOOLTIPS.enableParquetExport}
          modified={!isOptionDefault("enableParquetExport", options.enableParquetExport)}
          onReset={() =>
            setOptions((current) => ({
              ...current,
              enableParquetExport: DEFAULT_BROWSER_OPTIONS.enableParquetExport,
            }))
          }
        />
        <ToggleField
          label="Also export SPSS (.sav)"
          checked={options.enableSpssExport}
          onChange={(value) => setOptions((current) => ({ ...current, enableSpssExport: value }))}
          testId="toggle-enableSpssExport"
          tooltip={TOOLTIPS.enableSpssExport}
          modified={!isOptionDefault("enableSpssExport", options.enableSpssExport)}
          onReset={() =>
            setOptions((current) => ({
              ...current,
              enableSpssExport: DEFAULT_BROWSER_OPTIONS.enableSpssExport,
            }))
          }
        />
        <ToggleField
          label="Timeline viewer (View tab + HTML export)"
          checked={options.enableInteractiveTimeline}
          onChange={(value) =>
            setOptions((current) => ({ ...current, enableInteractiveTimeline: value }))
          }
          testId="toggle-enableInteractiveTimeline"
          tooltip={TOOLTIPS.enableInteractiveTimeline}
          modified={
            !isOptionDefault("enableInteractiveTimeline", options.enableInteractiveTimeline)
          }
          onReset={() =>
            setOptions((current) => ({
              ...current,
              enableInteractiveTimeline: DEFAULT_BROWSER_OPTIONS.enableInteractiveTimeline,
            }))
          }
        />
      </SettingsField>
    </section>
  );
}
