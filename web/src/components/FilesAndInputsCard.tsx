import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ReactElement } from "react";

import { SectionCard } from "@/components/SectionCard";
import { SettingsField } from "@/components/SettingsField";
import { ToggleField } from "@/components/ToggleField";
import { Tooltip } from "@/components/Tooltip";
import { TOOLTIPS } from "@/lib/tooltipText";
import { anyOptionModified, isOptionDefault, type OptionKey } from "@/lib/optionDefaults";
import {
  DEFAULT_BROWSER_OPTIONS,
  FILTER_MATCH_FIELD_VALUES,
  PACKAGE_EXCLUSION_PRESET_VALUES,
  type FilterMatchField,
  type PackageExclusionPreset,
} from "@/lib/generatedContract";
import { SUPPORT_FILE_ACCEPT } from "@/lib/validation";
import { createSupportFilePickHandler } from "@/components/supportFilePick";
import {
  createDemoDisplayMasker,
  type DemoDisplayMasker,
} from "@/lib/demoDisplay";
import type { BrowserProcessingOptions } from "@/lib/types";
import defaultAppCodebookUrl from "@/assets/defaults/unified_app_codebook.csv?url";
import defaultAppsToFilterUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?url";
import defaultAppsForcingScreenOpenUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?url";
import defaultBackgroundAppsUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?url";

const KEYS: readonly OptionKey[] = [
  "useFilterFile",
  "filterMatchField",
  "applicationLabelExclusions",
  "packageExclusionPreset",
  "useAppsForcingScreenOpenFile",
  "useBackgroundAppsFile",
  "useAppCodebook",
  "includeCategoryColumn",
];

const PACKAGE_EXCLUSION_PRESET_LABELS = {
  all_supplied_rows: "Every row in the file (default)",
  honor_filter_flag: "Only rows whose filter flag is on",
  system_scope_only: "Only system and system-defensive rows",
} satisfies Record<PackageExclusionPreset, string>;

const PACKAGE_EXCLUSION_PRESETS = PACKAGE_EXCLUSION_PRESET_VALUES.map((value) => ({
  value,
  label: PACKAGE_EXCLUSION_PRESET_LABELS[value],
}));

const FILTER_MATCH_FIELD_LABELS = {
  app_package_name: "Package name (default)",
  application_label: "Application label (exact case-sensitive match)",
} satisfies Record<FilterMatchField, string>;

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
  displayMasker?: DemoDisplayMasker;
};

/** Demo mode off is the honest default for a card rendered without one. */
const IDENTITY_MASKER = createDemoDisplayMasker(false);

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
    displayMasker = IDENTITY_MASKER,
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
        displayMasker={displayMasker}
        title="Filter file"
        accept={SUPPORT_FILE_ACCEPT}
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
      <SettingsField
        label="Filter rows by"
        htmlFor="filter-match-field-select"
        tooltip={TOOLTIPS.filterMatchField}
        modified={!isOptionDefault("filterMatchField", options.filterMatchField)}
        onReset={() => reset("filterMatchField")}
      >
        <select
          id="filter-match-field-select"
          data-testid="filter-match-field-select"
          className="select"
          value={options.filterMatchField}
          onChange={(event) =>
            update(
              "filterMatchField",
              event.target.value as BrowserProcessingOptions["filterMatchField"],
            )
          }
        >
          {FILTER_MATCH_FIELD_VALUES.map((value) => (
            <option key={value} value={value}>{FILTER_MATCH_FIELD_LABELS[value]}</option>
          ))}
        </select>
      </SettingsField>
      <SettingsField
        label="Exact application labels to exclude"
        htmlFor="application-label-exclusions-input"
        tooltip={TOOLTIPS.applicationLabelExclusions}
        modified={!isOptionDefault(
          "applicationLabelExclusions",
          options.applicationLabelExclusions,
        )}
        onReset={() => reset("applicationLabelExclusions")}
      >
        <textarea
          id="application-label-exclusions-input"
          data-testid="application-label-exclusions-input"
          className="input"
          rows={4}
          value={options.applicationLabelExclusions.join("\n")}
          placeholder="One exact, case-sensitive application label per line"
          onChange={(event) =>
            update(
              "applicationLabelExclusions",
              event.target.value
                .split("\n")
                .map((label) => label.trim())
                .filter(Boolean),
            )
          }
        />
      </SettingsField>
      <SettingsField
        label="Which rows exclude a package"
        htmlFor="package-exclusion-preset-select"
        tooltip={TOOLTIPS.packageExclusionPreset}
        modified={!isOptionDefault("packageExclusionPreset", options.packageExclusionPreset)}
        onReset={() => reset("packageExclusionPreset")}
      >
        <select
          id="package-exclusion-preset-select"
          data-testid="package-exclusion-preset-select"
          className="select"
          value={options.packageExclusionPreset}
          disabled={!options.useFilterFile}
          onChange={(event) =>
            update(
              "packageExclusionPreset",
              event.target.value as BrowserProcessingOptions["packageExclusionPreset"],
            )
          }
        >
          {PACKAGE_EXCLUSION_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </SettingsField>
      <SupportFileRow
        displayMasker={displayMasker}
        title="Apps forcing the screen open"
        accept={SUPPORT_FILE_ACCEPT}
        file={appsForcingScreenOpenFile}
        onFileChange={setAppsForcingScreenOpenFile}
        toggleLabel="Use apps forcing screen open file"
        toggleKey="useAppsForcingScreenOpenFile"
        checked={options.useAppsForcingScreenOpenFile}
        modified={!isOptionDefault("useAppsForcingScreenOpenFile", options.useAppsForcingScreenOpenFile)}
        onToggle={(value) => update("useAppsForcingScreenOpenFile", value)}
        onResetToggle={() => reset("useAppsForcingScreenOpenFile")}
        testId="apps-forcing-screen-open-file-input"
        defaultUrl={defaultAppsForcingScreenOpenUrl}
      />
      <SupportFileRow
        displayMasker={displayMasker}
        title="Background apps"
        accept={SUPPORT_FILE_ACCEPT}
        file={backgroundAppsFile}
        onFileChange={setBackgroundAppsFile}
        toggleLabel="Use background apps file"
        toggleKey="useBackgroundAppsFile"
        checked={options.useBackgroundAppsFile}
        modified={!isOptionDefault("useBackgroundAppsFile", options.useBackgroundAppsFile)}
        onToggle={(value) => update("useBackgroundAppsFile", value)}
        onResetToggle={() => reset("useBackgroundAppsFile")}
        testId="background-apps-file-input"
        defaultUrl={defaultBackgroundAppsUrl}
      />
      <SupportFileRow
        displayMasker={displayMasker}
        title="App codebook file"
        accept={SUPPORT_FILE_ACCEPT}
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
  displayMasker: DemoDisplayMasker;
};

function SupportFileRow(props: SupportFileRowProps): ReactElement {
  // A format the runtime refuses must be refused here, while the user is still
  // looking at the picker. `accept` is only a dialog hint: drag-and-drop and
  // the "All files" filter walk straight past it, and the run would then fail
  // for the whole batch after the green "Enabled with uploaded file" state.
  const [formatError, setFormatError] = useState<string | null>(null);
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
    displayMasker,
  } = props;
  // Clear a standing rejection whenever the slot changes for any reason other
  // than this picker: a successful pick, a project load, a toggle-off. Without
  // it the red error outlived the state it described. A rejected pick changes
  // neither `file` nor `checked`, so its error survives on purpose.
  useEffect(() => {
    setFormatError(null);
  }, [file, checked]);
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
          onChange={createSupportFilePickHandler({
            accept,
            displayMasker,
            onFileChange,
            onFormatError: setFormatError,
          })}
        />
        {formatError ? (
          <span
            className="error-text"
            role="alert"
            data-testid={`${testId}-format-error`}
          >
            {formatError}
          </span>
        ) : null}
        {/* Never render the green line beside the red one: a rejected pick
            must not sit next to "Success: Enabled with …", which is exactly
            the contradictory pair the format check exists to prevent. */}
        {formatError ? null : (
          <span className={`support-file-state${checked ? " is-enabled" : ""}`}>
            {checked
              ? file
                ? `Success: Enabled with uploaded file: ${displayMasker.fileName(file.name)}`
                : "Success: Enabled with bundled default"
              : "Disabled: Not used"}
          </span>
        )}
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
