import type { Dispatch, SetStateAction } from "react";
import type { ReactElement } from "react";

import { SectionCard } from "@/components/SectionCard";
import { SettingsField } from "@/components/SettingsField";
import { ToggleField } from "@/components/ToggleField";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { TOOLTIPS } from "@/lib/tooltipText";
import { anyOptionModified, isOptionDefault, type OptionKey } from "@/lib/optionDefaults";
import { rangeError } from "@/lib/validation";
import type { BrowserProcessingOptions } from "@/lib/types";

const KEYS: readonly OptionKey[] = [
  "enableScreenGatedCrediting",
  "creditedSessionCapMinutes",
  "deviceLivenessGapToleranceMinutes",
  "autoLockBridgeSeconds",
  "noWitnessMinDayApps",
  "enableStudyWindowFilter",
  "enablePersonAttribution",
  "enableComplianceScoring",
  "complianceThresholdPercent",
  "enableDayCoverage",
];

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
  /** Whether the study-dates table is loaded in Study inputs. */
  studyDatesLoaded: boolean;
  /** Whether the device-sharing table is loaded in Study inputs. */
  deviceSharingLoaded: boolean;
};

export function AnalyzeSettingsCard(props: Props): ReactElement {
  const { options, setOptions, studyDatesLoaded, deviceSharingLoaded } = props;

  const update = <K extends OptionKey>(key: K, value: BrowserProcessingOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };
  const reset = (key: OptionKey) => {
    setOptions((current) => ({ ...current, [key]: DEFAULT_BROWSER_OPTIONS[key] }));
  };
  const isMod = <K extends OptionKey>(key: K) => !isOptionDefault(key, options[key]);

  return (
    <SectionCard
      id="study-analysis"
      title="Study analysis"
      accent="study"
      modified={anyOptionModified(options, KEYS)}
    >
      <p className="u-card-intro">
        Analysis steps that score participants against study structure. Every output here is
        side-by-side: the headline app-usage and screen-usage CSVs are never changed by these
        options.
      </p>
      {!options.processAppUsage ? (
        <p className="settings-dependency-note" role="note" data-testid="analyze-dependency-note">
          App usage output is off, so none of these analysis steps can run. Turn on “App usage
          output” in Output &amp; plots to use them.
        </p>
      ) : null}

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
        <div className="settings-grid-2 settings-overview__subfield">
          <SettingsField
            label="Credited-session cap (minutes)"
            tooltip={TOOLTIPS.creditedSessionCapMinutes}
            modified={isMod("creditedSessionCapMinutes")}
            onReset={() => reset("creditedSessionCapMinutes")}
            error={rangeError(options.creditedSessionCapMinutes, 1, 1440)}
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
            error={rangeError(options.deviceLivenessGapToleranceMinutes, 1, 1440)}
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
          <SettingsField
            label="Auto-lock bridge (seconds)"
            tooltip={TOOLTIPS.autoLockBridgeSeconds}
            modified={isMod("autoLockBridgeSeconds")}
            onReset={() => reset("autoLockBridgeSeconds")}
            error={rangeError(options.autoLockBridgeSeconds, 0, 3600)}
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
          <SettingsField
            label="No-witness fallback: min distinct apps per day"
            tooltip={TOOLTIPS.noWitnessMinDayApps}
            modified={isMod("noWitnessMinDayApps")}
            onReset={() => reset("noWitnessMinDayApps")}
            error={rangeError(options.noWitnessMinDayApps, 1, 100)}
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
      {options.enableStudyWindowFilter && !studyDatesLoaded ? (
        <p className="warning-text" role="note" data-testid="study-window-needs-input">
          Needs input: upload the study-dates table under Study inputs, or turn this off.
        </p>
      ) : null}

      <ToggleField
        label="Person attribution (shared devices)"
        tooltip={TOOLTIPS.enablePersonAttribution}
        checked={options.enablePersonAttribution}
        onChange={(value) => update("enablePersonAttribution", value)}
        testId="toggle-enablePersonAttribution"
        modified={isMod("enablePersonAttribution")}
        onReset={() => reset("enablePersonAttribution")}
      />
      {options.enablePersonAttribution && !deviceSharingLoaded ? (
        <p className="warning-text" role="note" data-testid="person-attribution-needs-input">
          Needs input: upload the device-sharing table under Study inputs, or turn this off.
        </p>
      ) : null}

      <ToggleField
        label="Compliance scoring"
        tooltip={TOOLTIPS.enableComplianceScoring}
        checked={options.enableComplianceScoring}
        onChange={(value) => update("enableComplianceScoring", value)}
        testId="toggle-enableComplianceScoring"
        modified={isMod("enableComplianceScoring")}
        onReset={() => reset("enableComplianceScoring")}
      />
      {options.enableComplianceScoring ? (
        <div className="settings-overview__subfield">
          <SettingsField
            label="Compliance threshold (%)"
            tooltip={TOOLTIPS.complianceThresholdPercent}
            modified={isMod("complianceThresholdPercent")}
            onReset={() => reset("complianceThresholdPercent")}
            error={rangeError(options.complianceThresholdPercent, 0, 100)}
          >
            <input
              type="number"
              className="input"
              data-testid="compliance-threshold-input"
              min={0}
              max={100}
              value={options.complianceThresholdPercent}
              onChange={(event) => update("complianceThresholdPercent", Number(event.target.value))}
            />
          </SettingsField>
          {!options.enablePersonAttribution ? (
            <p className="settings-dependency-note" role="note">
              Person attribution is off, so no device is known to be shared and every day scores
              100. Turn on person attribution (with the device-sharing table) for meaningful
              compliance.
            </p>
          ) : null}
        </div>
      ) : null}

      <ToggleField
        label="Day coverage report"
        tooltip={TOOLTIPS.enableDayCoverage}
        checked={options.enableDayCoverage}
        onChange={(value) => update("enableDayCoverage", value)}
        testId="toggle-enableDayCoverage"
        modified={isMod("enableDayCoverage")}
        onReset={() => reset("enableDayCoverage")}
      />
      {options.enableDayCoverage && !studyDatesLoaded ? (
        <p className="settings-dependency-note" role="note" data-testid="day-coverage-range-note">
          No study-dates table is loaded, so the day spine falls back to each participant's own
          observed date range instead of their study window.
        </p>
      ) : null}
    </SectionCard>
  );
}
