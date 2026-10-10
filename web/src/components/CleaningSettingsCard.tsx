import type { Dispatch, SetStateAction } from "react";
import type { ReactElement } from "react";

import { CheckboxGroup } from "@/components/CheckboxGroup";
import { SectionCard } from "@/components/SectionCard";
import { SettingsField } from "@/components/SettingsField";
import { SupportFileRow } from "@/components/FilesAndInputsCard";
import { ToggleField } from "@/components/ToggleField";
import {
  INTERVAL_QUALITY_POLICIES,
  MAXIMUM_DURATION_DISPOSITIONS,
  MAXIMUM_DURATION_POLICIES,
  MAXIMUM_DURATION_THRESHOLD_SOURCES,
  MAXIMUM_DURATION_UNSELECTED_LABEL,
  MINIMUM_DURATION_COMPARATORS,
  MINIMUM_DURATION_DISPOSITIONS,
} from "@/components/SessionDetectionCard";
import defaultAppsToFilterUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?url";
import {
  DEFAULT_BROWSER_OPTIONS,
  FILTER_MATCH_FIELD_VALUES,
  INTERACTION_TYPE_REMOVAL_MODE_VALUES,
  PACKAGE_EXCLUSION_PRESET_VALUES,
  SCREEN_GATING_RULE_VALUES,
  SCREEN_SESSION_MAXIMUM_DURATION_DISPOSITION_VALUES,
  type FilterMatchField,
  type PackageExclusionPreset,
  type ScreenGatingRule,
  type ScreenSessionMaximumDurationDisposition,
} from "@/lib/generatedContract";
import { INTERACTION_TYPES_TO_REMOVE_OPTIONS } from "@/lib/processingUiContract";
import { TOOLTIPS } from "@/lib/tooltipText";
import { anyOptionModified, isOptionDefault, type OptionKey } from "@/lib/optionDefaults";
import { optionRangeError, SUPPORT_FILE_ACCEPT } from "@/lib/validation";
import {
  completeMaximumDurationVector,
  isCanonicalMaximumDurationThresholdNs,
  isExplicitMaximumDurationVector,
  withMaximumDurationVector,
  type MaximumDurationVectorKey,
} from "@/lib/maximumDurationVector";
import type { DemoDisplayMasker } from "@/lib/demoDisplay";
import type { BrowserProcessingOptions } from "@/lib/types";

const KEYS: readonly OptionKey[] = [
  "minimumUsageDuration",
  "minimumDurationComparator",
  "minimumDurationDisposition",
  "maximumDurationPolicy",
  "maximumDurationDisposition",
  "maximumDurationThresholdSource",
  "maximumDurationThresholdNs",
  "intervalQualityPolicy",
  "dropOutOfSourceOrderEvents",
  "filterZeroDurationSessions",
  "screenSessionMaximumDurationDisposition",
  "screenSessionMaximumDurationMinutes",
  "useFilterFile",
  "filterMatchField",
  "applicationLabelExclusions",
  "packageExclusionPreset",
  "enableScreenGatedCrediting",
  "screenGatingRule",
  "creditedSessionCapMinutes",
  "deviceLivenessGapToleranceMinutes",
  "autoLockBridgeSeconds",
  "bridgeScreenOffToSessionEnd",
  "noWitnessMinDayApps",
  "enableStudyWindowFilter",
  "interactionTypesToRemove",
  "interactionTypeRemovalMode",
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

const SCREEN_GATING_RULE_LABELS = {
  screen_and_liveness_v1: "Screen on and device alive (default)",
  screen_witness_only: "Screen on only",
  strict_visual_only: "Strict visual only — no fallback",
  device_liveness_only: "Device alive only",
} satisfies Record<ScreenGatingRule, string>;

const SCREEN_GATING_RULES = SCREEN_GATING_RULE_VALUES.map((value) => ({
  value,
  label: SCREEN_GATING_RULE_LABELS[value],
}));

const MAXIMUM_DURATION_LABELS = {
  none: "No screen-session cap (default)",
  truncate: "Truncate strictly over the maximum",
  exclude_participant: "Exclude participant if any session is strictly over",
} satisfies Record<ScreenSessionMaximumDurationDisposition, string>;

type ScreenMaximumDurationChange =
  | { disposition: ScreenSessionMaximumDurationDisposition }
  | { minutes: number };

export function applyScreenMaximumDurationChange(
  current: BrowserProcessingOptions,
  change: ScreenMaximumDurationChange,
): BrowserProcessingOptions {
  if ("disposition" in change) {
    return {
      ...current,
      screenSessionMaximumDurationDisposition: change.disposition,
      screenSessionMaximumDurationMinutes:
        change.disposition === "none"
          ? 0
          : current.screenSessionMaximumDurationMinutes > 0
            ? current.screenSessionMaximumDurationMinutes
            : 60,
    };
  }
  const enabled = Number.isFinite(change.minutes) && change.minutes > 0;
  return {
    ...current,
    screenSessionMaximumDurationMinutes: enabled ? change.minutes : 0,
    screenSessionMaximumDurationDisposition: enabled
      ? current.screenSessionMaximumDurationDisposition === "none"
        ? "truncate"
        : current.screenSessionMaximumDurationDisposition
      : "none",
  };
}

/** The controls that need the Settings tab's uploaded support files. */
type SettingsTabInputs = {
  filterFile: File | null;
  setFilterFile: (file: File | null) => void;
  studyDatesLoaded: boolean;
  displayMasker: DemoDisplayMasker;
};

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
  /** Absent in the View tab's comparison drawer, which re-runs with Arm A's
   * support files: the filter, screen-gated credit and study-window controls
   * are shown only on the Settings tab, as before the cleaning card existed. */
  settingsTab?: SettingsTabInputs;
};

export function CleaningSettingsCard({
  options,
  setOptions,
  settingsTab,
}: Props): ReactElement {
  const update = <K extends OptionKey>(key: K, value: BrowserProcessingOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };
  const reset = (key: OptionKey) => {
    setOptions((current) => ({ ...current, [key]: DEFAULT_BROWSER_OPTIONS[key] }));
  };
  const isMod = <K extends OptionKey>(key: K) => !isOptionDefault(key, options[key]);
  const maximumDurationExplicit = isExplicitMaximumDurationVector(options);
  const maximumDurationGeneric =
    options.maximumDurationPolicy === "post_reconstruction_strict_max_v1";
  // One control edit rewrites the whole four-key vector so the browser never
  // holds a partial set (the kernel refuses `request_shape_invalid`).
  const updateMaximumDuration = (key: MaximumDurationVectorKey, value: unknown) => {
    setOptions((current) =>
      withMaximumDurationVector(
        current,
        completeMaximumDurationVector(current, key, value),
      ),
    );
  };
  const resetMaximumDuration = () =>
    updateMaximumDuration("maximumDurationPolicy", undefined);
  const updateScreenMaximumDuration = (change: ScreenMaximumDurationChange) => {
    setOptions((current) => applyScreenMaximumDurationChange(current, change));
  };

  return (
    <SectionCard
      id="optional-cleaning"
      title="Optional cleaning"
      accent="session"
      defaultExpanded={false}
      modified={anyOptionModified(options, KEYS)}
    >
      <p className="u-card-intro">
        Cleaning is optional and off by default. Each step removes, blanks or re-credits
        records based on a judgment about data quality. Turn a step on only when your study
        protocol calls for it, and report it.
      </p>
      {settingsTab ? (
        <>
      <SupportFileRow
        displayMasker={settingsTab.displayMasker}
        title="Filter file"
        accept={SUPPORT_FILE_ACCEPT}
        file={settingsTab.filterFile}
        onFileChange={settingsTab.setFilterFile}
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
        </>
      ) : null}
      <div className="settings-grid-2">
        <SettingsField
          label="Minimum usage duration (seconds)"
          htmlFor="minimum-usage-duration-input"
          tooltip={TOOLTIPS.minimumUsageDuration}
          modified={isMod("minimumUsageDuration")}
          onReset={() => reset("minimumUsageDuration")}
          error={optionRangeError("minimumUsageDuration", options.minimumUsageDuration)}
        >
          <input
            id="minimum-usage-duration-input"
            data-testid="minimum-usage-duration-input"
            type="number"
            className="input"
            min={0}
            max={3600}
            step={1}
            value={options.minimumUsageDuration}
            onChange={(event) =>
              update("minimumUsageDuration", Number(event.target.value))
            }
          />
        </SettingsField>

        <SettingsField
          label="Minimum-duration comparator"
          htmlFor="minimum-duration-comparator-select"
          tooltip={TOOLTIPS.minimumDurationComparator}
          modified={isMod("minimumDurationComparator")}
          onReset={() => reset("minimumDurationComparator")}
        >
          <select
            id="minimum-duration-comparator-select"
            data-testid="minimum-duration-comparator-select"
            className="select"
            value={options.minimumDurationComparator}
            onChange={(event) =>
              update(
                "minimumDurationComparator",
                event.target.value as BrowserProcessingOptions["minimumDurationComparator"],
              )
            }
          >
            {MINIMUM_DURATION_COMPARATORS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingsField>

        <SettingsField
          label="Minimum-duration disposition"
          htmlFor="minimum-duration-disposition-select"
          tooltip={TOOLTIPS.minimumDurationDisposition}
          modified={isMod("minimumDurationDisposition")}
          onReset={() => reset("minimumDurationDisposition")}
        >
          <select
            id="minimum-duration-disposition-select"
            data-testid="minimum-duration-disposition-select"
            className="select"
            value={options.minimumDurationDisposition}
            onChange={(event) =>
              update(
                "minimumDurationDisposition",
                event.target.value as BrowserProcessingOptions["minimumDurationDisposition"],
              )
            }
          >
            {MINIMUM_DURATION_DISPOSITIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingsField>

        <SettingsField
          label="Maximum-duration policy"
          htmlFor="maximum-duration-policy-select"
          tooltip={TOOLTIPS.maximumDurationPolicy}
          modified={maximumDurationExplicit}
          onReset={resetMaximumDuration}
        >
          <select
            id="maximum-duration-policy-select"
            data-testid="maximum-duration-policy-select"
            className="select"
            value={options.maximumDurationPolicy ?? ""}
            onChange={(event) =>
              updateMaximumDuration(
                "maximumDurationPolicy",
                event.target.value === ""
                  ? undefined
                  : (event.target.value),
              )
            }
          >
            <option value="">{MAXIMUM_DURATION_UNSELECTED_LABEL}</option>
            {MAXIMUM_DURATION_POLICIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingsField>

        {maximumDurationExplicit ? (
          <>
            <SettingsField
              label="Maximum-duration disposition"
              htmlFor="maximum-duration-disposition-select"
              tooltip={TOOLTIPS.maximumDurationDisposition}
              modified={options.maximumDurationDisposition !== undefined}
              onReset={resetMaximumDuration}
            >
              <select
                id="maximum-duration-disposition-select"
                data-testid="maximum-duration-disposition-select"
                className="select"
                disabled={!maximumDurationGeneric}
                value={options.maximumDurationDisposition ?? ""}
                onChange={(event) =>
                  updateMaximumDuration(
                    "maximumDurationDisposition",
                    event.target.value,
                  )
                }
              >
                {MAXIMUM_DURATION_DISPOSITIONS.filter((option) =>
                  maximumDurationGeneric
                    ? option.value !== "not_applicable"
                    : option.value === "not_applicable",
                ).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SettingsField>

            <SettingsField
              label="Maximum-duration threshold source"
              htmlFor="maximum-duration-threshold-source-select"
              tooltip={TOOLTIPS.maximumDurationThresholdSource}
              modified={options.maximumDurationThresholdSource !== undefined}
              onReset={resetMaximumDuration}
            >
              <select
                id="maximum-duration-threshold-source-select"
                data-testid="maximum-duration-threshold-source-select"
                className="select"
                disabled={!maximumDurationGeneric}
                value={options.maximumDurationThresholdSource ?? ""}
                onChange={(event) =>
                  updateMaximumDuration(
                    "maximumDurationThresholdSource",
                    event.target.value,
                  )
                }
              >
                {MAXIMUM_DURATION_THRESHOLD_SOURCES.filter((option) =>
                  maximumDurationGeneric
                    ? option.value === "fixed_parameter" ||
                      option.value === "b12_adaptive_participant"
                    : option.value === options.maximumDurationThresholdSource,
                ).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SettingsField>

            {options.maximumDurationThresholdSource === "fixed_parameter" ? (
              <SettingsField
                label="Maximum-duration threshold (nanoseconds)"
                htmlFor="maximum-duration-threshold-ns-input"
                tooltip={TOOLTIPS.maximumDurationThresholdNs}
                modified={options.maximumDurationThresholdNs !== undefined}
                onReset={resetMaximumDuration}
                error={
                  isCanonicalMaximumDurationThresholdNs(options.maximumDurationThresholdNs)
                    ? undefined
                    : "Enter whole nanoseconds: digits only, no leading zero, at most 9223372036854775807."
                }
              >
                <input
                  id="maximum-duration-threshold-ns-input"
                  data-testid="maximum-duration-threshold-ns-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={19}
                  className="input"
                  value={options.maximumDurationThresholdNs ?? ""}
                  onChange={(event) =>
                    update("maximumDurationThresholdNs", event.target.value)
                  }
                />
              </SettingsField>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="settings-grid-1">
        <SettingsField
          label="Interval quality policy"
          htmlFor="interval-quality-policy-select"
          tooltip={TOOLTIPS.intervalQualityPolicy}
          modified={isMod("intervalQualityPolicy")}
          onReset={() => reset("intervalQualityPolicy")}
        >
          <select
            id="interval-quality-policy-select"
            data-testid="interval-quality-policy-select"
            className="select"
            value={options.intervalQualityPolicy}
            onChange={(event) =>
              update(
                "intervalQualityPolicy",
                event.target.value as BrowserProcessingOptions["intervalQualityPolicy"],
              )
            }
          >
            {INTERVAL_QUALITY_POLICIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingsField>
      </div>
      <div className="settings-grid-1">
        <ToggleField
          label="Drop events written out of chronological order"
          tooltip={TOOLTIPS.dropOutOfSourceOrderEvents}
          checked={options.dropOutOfSourceOrderEvents}
          onChange={(value) => update("dropOutOfSourceOrderEvents", value)}
          testId="toggle-dropOutOfSourceOrderEvents"
          modified={isMod("dropOutOfSourceOrderEvents")}
          onReset={() => reset("dropOutOfSourceOrderEvents")}
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
      </div>
      <div className="settings-grid-2">
        <SettingsField
          label="Screen-session maximum-duration action"
          htmlFor="screen-session-cap-disposition-select"
          tooltip={TOOLTIPS.screenSessionMaximumDurationDisposition}
          modified={isMod("screenSessionMaximumDurationDisposition")}
          onReset={() =>
            updateScreenMaximumDuration({
              disposition: DEFAULT_BROWSER_OPTIONS.screenSessionMaximumDurationDisposition,
            })
          }
        >
          <select
            id="screen-session-cap-disposition-select"
            className="select"
            value={options.screenSessionMaximumDurationDisposition}
            onChange={(event) => {
              const value = event.target.value as BrowserProcessingOptions["screenSessionMaximumDurationDisposition"];
              updateScreenMaximumDuration({ disposition: value });
            }}
          >
            {SCREEN_SESSION_MAXIMUM_DURATION_DISPOSITION_VALUES.map((value) => (
              <option key={value} value={value}>{MAXIMUM_DURATION_LABELS[value]}</option>
            ))}
          </select>
        </SettingsField>
        <SettingsField
          label="Screen-session maximum duration (minutes)"
          tooltip={TOOLTIPS.screenSessionMaximumDurationMinutes}
          modified={isMod("screenSessionMaximumDurationMinutes")}
          onReset={() =>
            updateScreenMaximumDuration({
              minutes: DEFAULT_BROWSER_OPTIONS.screenSessionMaximumDurationMinutes,
            })
          }
          error={optionRangeError("screenSessionMaximumDurationMinutes", options.screenSessionMaximumDurationMinutes)}
        >
          <input
            type="number"
            className="input"
            data-testid="screen-session-cap-minutes-input"
            min={0}
            max={1440}
            disabled={options.screenSessionMaximumDurationDisposition === "none"}
            value={options.screenSessionMaximumDurationMinutes}
            onChange={(event) =>
              updateScreenMaximumDuration({ minutes: Number(event.target.value) })
            }
          />
        </SettingsField>
      </div>
      {settingsTab ? (
        <>
      <ToggleField
        label="Screen-gated usage credit"
        tooltip={TOOLTIPS.enableScreenGatedCrediting}
        checked={options.enableScreenGatedCrediting}
        onChange={(value) => update("enableScreenGatedCrediting", value)}
        testId="toggle-enableScreenGatedCrediting"
        modified={isMod("enableScreenGatedCrediting")}
        onReset={() => reset("enableScreenGatedCrediting")}
      />
      {options.enableScreenGatedCrediting ? (
        <div className="settings-grid-1 settings-overview__subfield">
          <SettingsField
            label="Screen-gating rule"
            htmlFor="screen-gating-rule-select"
            tooltip={TOOLTIPS.screenGatingRule}
            modified={isMod("screenGatingRule")}
            onReset={() => reset("screenGatingRule")}
          >
            <select
              id="screen-gating-rule-select"
              data-testid="screen-gating-rule-select"
              className="select"
              value={options.screenGatingRule}
              onChange={(event) =>
                update(
                  "screenGatingRule",
                  event.target.value as BrowserProcessingOptions["screenGatingRule"],
                )
              }
            >
              {SCREEN_GATING_RULES.map((rule) => (
                <option key={rule.value} value={rule.value}>
                  {rule.label}
                </option>
              ))}
            </select>
          </SettingsField>
        </div>
      ) : null}
      {options.enableScreenGatedCrediting ? (
        <div className="settings-grid-2 settings-overview__subfield">
          <SettingsField
            label="Credited-session cap (minutes)"
            tooltip={TOOLTIPS.creditedSessionCapMinutes}
            modified={isMod("creditedSessionCapMinutes")}
            onReset={() => reset("creditedSessionCapMinutes")}
            error={optionRangeError("creditedSessionCapMinutes", options.creditedSessionCapMinutes)}
          >
            <input
              type="number"
              className="input"
              data-testid="credited-session-cap-input"
              min={1}
              max={1440}
              value={options.creditedSessionCapMinutes}
              onChange={(event) => update("creditedSessionCapMinutes", Number(event.target.value))}
            />
          </SettingsField>
          <SettingsField
            label="Device-liveness gap tolerance (minutes)"
            tooltip={TOOLTIPS.deviceLivenessGapToleranceMinutes}
            modified={isMod("deviceLivenessGapToleranceMinutes")}
            onReset={() => reset("deviceLivenessGapToleranceMinutes")}
            error={optionRangeError("deviceLivenessGapToleranceMinutes", options.deviceLivenessGapToleranceMinutes)}
          >
            <input
              type="number"
              className="input"
              data-testid="device-liveness-gap-input"
              min={1}
              max={1440}
              value={options.deviceLivenessGapToleranceMinutes}
              onChange={(event) =>
                update("deviceLivenessGapToleranceMinutes", Number(event.target.value))
              }
            />
          </SettingsField>
          {options.screenGatingRule === "device_liveness_only" ? (
            <p
              className="settings-dependency-note"
              role="note"
              data-testid="screen-witness-dependency-note"
            >
              Auto-lock bridge and the no-witness fallback apply only to rules
              that read screen events; &ldquo;Device alive only&rdquo; credits
              the alive spans either way.
            </p>
          ) : (
            <>
          <SettingsField
            label="Auto-lock bridge (seconds)"
            tooltip={TOOLTIPS.autoLockBridgeSeconds}
            modified={isMod("autoLockBridgeSeconds")}
            onReset={() => reset("autoLockBridgeSeconds")}
            error={optionRangeError("autoLockBridgeSeconds", options.autoLockBridgeSeconds)}
          >
            <input
              type="number"
              className="input"
              data-testid="auto-lock-bridge-input"
              min={0}
              max={3600}
              value={options.autoLockBridgeSeconds}
              onChange={(event) => update("autoLockBridgeSeconds", Number(event.target.value))}
            />
          </SettingsField>
          <ToggleField
            label="Measure screen-off only up to the session end"
            tooltip={TOOLTIPS.bridgeScreenOffToSessionEnd}
            checked={options.bridgeScreenOffToSessionEnd}
            onChange={(value) => update("bridgeScreenOffToSessionEnd", value)}
            testId="toggle-bridgeScreenOffToSessionEnd"
            modified={isMod("bridgeScreenOffToSessionEnd")}
            onReset={() => reset("bridgeScreenOffToSessionEnd")}
          />
          <SettingsField
            label="No-witness fallback: min distinct apps per day"
            tooltip={TOOLTIPS.noWitnessMinDayApps}
            modified={isMod("noWitnessMinDayApps")}
            onReset={() => reset("noWitnessMinDayApps")}
            error={optionRangeError("noWitnessMinDayApps", options.noWitnessMinDayApps)}
          >
            <input
              type="number"
              className="input"
              data-testid="no-witness-min-day-apps-input"
              min={1}
              max={100}
              value={options.noWitnessMinDayApps}
              onChange={(event) => update("noWitnessMinDayApps", Number(event.target.value))}
            />
          </SettingsField>
            </>
          )}
        </div>
      ) : null}
      <ToggleField
        label="Study-window filter"
        tooltip={TOOLTIPS.enableStudyWindowFilter}
        checked={options.enableStudyWindowFilter}
        onChange={(value) => update("enableStudyWindowFilter", value)}
        testId="toggle-enableStudyWindowFilter"
        modified={isMod("enableStudyWindowFilter")}
        onReset={() => reset("enableStudyWindowFilter")}
      />
      {options.enableStudyWindowFilter && !settingsTab.studyDatesLoaded ? (
        <p className="warning-text" role="note" data-testid="study-window-needs-input">
          Needs input: upload the study-dates table under Study inputs, or turn this off.
        </p>
      ) : null}
        </>
      ) : null}
      <CheckboxGroup
        title="Interaction types to remove from final output"
        options={INTERACTION_TYPES_TO_REMOVE_OPTIONS.map((value) => ({ label: value, value }))}
        selected={options.interactionTypesToRemove}
        onChange={(next) => update("interactionTypesToRemove", next)}
        tooltip={TOOLTIPS.interactionTypesToRemove}
        modified={isMod("interactionTypesToRemove")}
        onReset={() => reset("interactionTypesToRemove")}
        searchable
      />
      <SettingsField
        label="Interaction-type removal mode"
        htmlFor="interaction-type-removal-mode"
        tooltip={TOOLTIPS.interactionTypeRemovalMode}
        modified={isMod("interactionTypeRemovalMode")}
        onReset={() => reset("interactionTypeRemovalMode")}
      >
        <select
          id="interaction-type-removal-mode"
          value={options.interactionTypeRemovalMode}
          onChange={(event) => update(
            "interactionTypeRemovalMode",
            event.target.value as BrowserProcessingOptions["interactionTypeRemovalMode"],
          )}
        >
          {INTERACTION_TYPE_REMOVAL_MODE_VALUES.map((value) => (
            <option key={value} value={value}>
              {value === "gap_preserving" ? "Preserve long-gap evidence (default)" : "Remove unconditionally"}
            </option>
          ))}
        </select>
      </SettingsField>
    </SectionCard>
  );
}
