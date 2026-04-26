import type { Dispatch, SetStateAction } from "react";
import type { ReactElement } from "react";

import { SectionCard } from "@/components/SectionCard";
import { ToggleField } from "@/components/ToggleField";
import { Tooltip } from "@/components/Tooltip";
import { TOOLTIPS } from "@/lib/tooltipText";
import { anyOptionModified, isOptionDefault, type OptionKey } from "@/lib/optionDefaults";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/browserPipeline";
import type { BrowserProcessingOptions } from "@/lib/types";
import defaultAppCodebookUrl from "@/assets/defaults/unified_app_codebook.csv?url";
import defaultAppsToFilterUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?url";
import defaultKeepAwakeAppsUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_keep_awake_apps.csv?url";

const KEYS: readonly OptionKey[] = ["useFilterFile", "useKeepAwakeAppsFile", "useAppCodebook"];

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
  filterFile: File | null;
  setFilterFile: (file: File | null) => void;
  keepAwakeFile: File | null;
  setKeepAwakeFile: (file: File | null) => void;
  appCodebookFile: File | null;
  setAppCodebookFile: (file: File | null) => void;
};

export function FilesAndInputsCard(props: Props): ReactElement {
  const {
    options,
    setOptions,
    filterFile,
    setFilterFile,
    keepAwakeFile,
    setKeepAwakeFile,
    appCodebookFile,
    setAppCodebookFile,
  } = props;

  const update = <K extends OptionKey>(key: K, value: BrowserProcessingOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };
  const reset = (key: OptionKey) => {
    setOptions((current) => ({ ...current, [key]: DEFAULT_BROWSER_OPTIONS[key] }));
  };

  return (
    <SectionCard
      id="files"
      title="Support files"
      accent="files"
      modified={anyOptionModified(options, KEYS)}
    >
      <p className="u-card-intro">
        Optional support files. Without an upload the bundled defaults are used. Toggle individual
        files on or off using the switch beside each input.
      </p>

      <SupportFileRow
        title="Filter file"
        accept=".csv,.xlsx,.xls"
        file={filterFile}
        onFileChange={setFilterFile}
        toggleLabel="Use filter file"
        toggleKey="useFilterFile"
        checked={options.useFilterFile}
        modified={!isOptionDefault("useFilterFile", options.useFilterFile)}
        onToggle={(value) => update("useFilterFile", value)}
        onResetToggle={() => reset("useFilterFile")}
        testId="filter-file-input"
        defaultUrl={defaultAppsToFilterUrl}
      />
      <SupportFileRow
        title="Keep-awake apps file"
        accept=".csv,.xlsx,.xls"
        file={keepAwakeFile}
        onFileChange={setKeepAwakeFile}
        toggleLabel="Use keep-awake apps file"
        toggleKey="useKeepAwakeAppsFile"
        checked={options.useKeepAwakeAppsFile}
        modified={!isOptionDefault("useKeepAwakeAppsFile", options.useKeepAwakeAppsFile)}
        onToggle={(value) => update("useKeepAwakeAppsFile", value)}
        onResetToggle={() => reset("useKeepAwakeAppsFile")}
        testId="keep-awake-file-input"
        defaultUrl={defaultKeepAwakeAppsUrl}
      />
      <SupportFileRow
        title="App codebook file"
        accept=".csv,.xlsx,.xls"
        file={appCodebookFile}
        onFileChange={setAppCodebookFile}
        toggleLabel="Use app codebook"
        toggleKey="useAppCodebook"
        checked={options.useAppCodebook}
        modified={!isOptionDefault("useAppCodebook", options.useAppCodebook)}
        onToggle={(value) => update("useAppCodebook", value)}
        onResetToggle={() => reset("useAppCodebook")}
        testId="app-codebook-file-input"
        defaultUrl={defaultAppCodebookUrl}
      />
    </SectionCard>
  );
}

type SupportFileRowProps = {
  title: string;
  accept: string;
  file: File | null;
  onFileChange: (next: File | null) => void;
  toggleLabel: string;
  toggleKey: "useFilterFile" | "useKeepAwakeAppsFile" | "useAppCodebook";
  checked: boolean;
  modified: boolean;
  onToggle: (value: boolean) => void;
  onResetToggle: () => void;
  testId: string;
  defaultUrl: string;
};

function SupportFileRow(props: SupportFileRowProps): ReactElement {
  const {
    title,
    accept,
    file,
    onFileChange,
    toggleKey,
    checked,
    modified,
    onToggle,
    onResetToggle,
    testId,
    defaultUrl,
  } = props;
  const tooltip = TOOLTIPS[toggleKey];
  return (
    <div className="support-file-row">
      <div className="support-file-row__main">
        <div className="u-inline-cluster">
          <span className="settings-field__label">{title}</span>
          <Tooltip content={tooltip} label={`Help: ${title}`} />
          <span className="text-faint u-meta-xs">.csv or .xlsx</span>
        </div>
        <input
          type="file"
          accept={accept}
          data-testid={testId}
          aria-label={`Upload ${title}`}
          onChange={(event) => {
            onFileChange(event.target.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
        <span className={`support-file-state${checked ? " is-enabled" : ""}`}>
          {checked
            ? file
              ? `Enabled with uploaded file: ${file.name}`
              : "Enabled with bundled default"
            : "Disabled"}
        </span>
        <a className="u-meta-xs" href={defaultUrl} download>
          Download bundled default
        </a>
      </div>
      <ToggleField
        label="Enabled"
        checked={checked}
        onChange={onToggle}
        testId={`toggle-${toggleKey}`}
        modified={modified}
        onReset={onResetToggle}
      />
    </div>
  );
}
