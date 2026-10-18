import type { Dispatch, SetStateAction } from "react";
import type { ReactElement } from "react";

import { SectionCard } from "@/components/SectionCard";
import { SettingsField } from "@/components/SettingsField";
import { ToggleField } from "@/components/ToggleField";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { TOOLTIPS } from "@/lib/tooltipText";
import { anyOptionModified, isOptionDefault, type OptionKey } from "@/lib/optionDefaults";
import { optionRangeError } from "@/lib/validation";
import type { BrowserProcessingOptions } from "@/lib/types";

const KEYS: readonly OptionKey[] = ["parallelProcessing", "parallelMaxWorkers"];

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
  /** Local (not contract) setting: build optional provenance evidence files. */
  provenanceEvidence: boolean;
  onProvenanceEvidenceChange: (next: boolean) => void;
};

export function PerformanceCard({
  options,
  setOptions,
  provenanceEvidence,
  onProvenanceEvidenceChange,
}: Props): ReactElement {
  const update = <K extends OptionKey>(key: K, value: BrowserProcessingOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };
  const reset = (key: OptionKey) => {
    setOptions((current) => ({ ...current, [key]: DEFAULT_BROWSER_OPTIONS[key] }));
  };
  const isMod = <K extends OptionKey>(key: K) => !isOptionDefault(key, options[key]);

  return (
    <SectionCard
      id="performance"
      title="Performance"
      accent="performance"
      defaultExpanded={false}
      modified={
        anyOptionModified(options, KEYS) || provenanceEvidence
      }
    >
      <p className="u-card-intro">
        Use this for batches with more than one raw file. Parallel processing can finish a batch
        faster by working on several files at the same time. If the browser slows down or uses too
        much memory, turn it off or lower the number of files processed at once.
      </p>
      <ToggleField
        label="Process several files at once"
        tooltip={TOOLTIPS.parallelProcessing}
        checked={options.parallelProcessing}
        onChange={(value) => update("parallelProcessing", value)}
        testId="toggle-parallelProcessing"
        modified={isMod("parallelProcessing")}
        onReset={() => reset("parallelProcessing")}
      />
      <SettingsField
        label="Files processed at once"
        tooltip={TOOLTIPS.parallelMaxWorkers}
        modified={isMod("parallelMaxWorkers")}
        onReset={() => reset("parallelMaxWorkers")}
        error={
          options.parallelProcessing
            ? optionRangeError("parallelMaxWorkers", options.parallelMaxWorkers ?? 0)
            : undefined
        }
        hint="0 lets the app choose a safe limit based on your files and browser."
      >
        <input
          type="number"
          className="input"
          data-testid="parallel-max-workers-input"
          min={0}
          max={32}
          value={options.parallelMaxWorkers ?? 0}
          onChange={(event) => {
            const next = Number(event.target.value);
            update("parallelMaxWorkers", next > 0 ? next : undefined);
          }}
          disabled={!options.parallelProcessing}
        />
      </SettingsField>
      <ToggleField
        label="Save extra audit files"
        tooltip={{
          title: "Extra audit files",
          body:
            "Adds three more files to the audit files ZIP: one gives an address to every cell of your input files, one links every output cell back to its output row, and one records which input cells could change which output cells. Nothing in the app reads them; they are for checking the processing in detail. Off: those steps are skipped, so each run is faster. Your result files are the same either way.",
        }}
        checked={provenanceEvidence}
        onChange={onProvenanceEvidenceChange}
        testId="toggle-provenanceEvidence"
        modified={provenanceEvidence}
        onReset={() => onProvenanceEvidenceChange(false)}
      />
    </SectionCard>
  );
}
