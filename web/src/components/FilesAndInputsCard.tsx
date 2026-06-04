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
import defaultAppsForcingScreenOpenUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?url";
import defaultBackgroundAppsUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?url";

const KEYS: readonly OptionKey[] = [
  "useFilterFile",
  "useAppsForcingScreenOpenFile",
  "useBackgroundAppsFile",
  "useAppCodebook",
  "includeCategoryColumn",
];

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
  filterFile: File | null;
  setFilterFile: (file: File | null) => void;
  appsForcingScreenOpenFile: File | null;
  setAppsForcingScreenOpenFile: (file: File | null) => void;
  backgroundAppsFile: File | null;
  setBackgroundAppsFile: (file: File | null) => void;
  appCodebookFile: File | null;
  setAppCodebookFile: (file: File | null) => void;
};

export function FilesAndInputsCard(props: Props): ReactElement {
  const {
    options,
    setOptions,
    filterFile,
    setFilterFile,
    appsForcingScreenOpenFile,
    setAppsForcingScreenOpenFile,
    backgroundAppsFile,
    setBackgroundAppsFile,
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
        title="Apps forcing the screen open"
        accept=".csv,.xlsx,.xls"
        file={appsForcingScreenOpenFile}
        onFileChange={setAppsForcingScreenOpenFile}
        toggleLabel="Use apps-forcing-screen-open file"
        toggleKey="useAppsForcingScreenOpenFile"
        checked={options.useAppsForcingScreenOpenFile}
        modified={!isOptionDefault("useAppsForcingScreenOpenFile", options.useAppsForcingScreenOpenFile)}
        onToggle={(value) => update("useAppsForcingScreenOpenFile", value)}
        onResetToggle={() => reset("useAppsForcingScreenOpenFile")}
        testId="apps-forcing-screen-open-file-input"
        defaultUrl={defaultAppsForcingScreenOpenUrl}
      />
      <SupportFileRow
        title="Background apps"
        accept=".csv,.xlsx,.xls"
        file={backgroundAppsFile}
        onFileChange={setBackgroundAppsFile}
        toggleLabel="Use background-apps file"
        toggleKey="useBackgroundAppsFile"
        checked={options.useBackgroundAppsFile}
        modified={!isOptionDefault("useBackgroundAppsFile", options.useBackgroundAppsFile)}
        onToggle={(value) => update("useBackgroundAppsFile", value)}
        onResetToggle={() => reset("useBackgroundAppsFile")}
        testId="background-apps-file-input"
        defaultUrl={defaultBackgroundAppsUrl}
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
      {options.useAppCodebook ? (
        <div className="settings-overview__subfield">
          <ToggleField
            label="Include app category column"
            checked={options.includeCategoryColumn}
            onChange={(value) => update("includeCategoryColumn", value)}
            testId="toggle-includeCategoryColumn"
            tooltip={TOOLTIPS.includeCategoryColumn}
            modified={!isOptionDefault("includeCategoryColumn", options.includeCategoryColumn)}
            onReset={() => reset("includeCategoryColumn")}
          />
        </div>
      ) : null}
    </SectionCard>
  );
}

type SupportFileRowProps = {
  title: string;
  accept: string;
  file: File | null;
  onFileChange: (next: File | null) => void;
  toggleLabel: string;
  toggleKey: "useFilterFile" | "useAppsForcingScreenOpenFile" | "useBackgroundAppsFile" | "useAppCodebook";
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
              ? `Success: Enabled with uploaded file: ${file.name}`
              : "Success: Enabled with bundled default"
            : "Disabled: Not used"}
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
