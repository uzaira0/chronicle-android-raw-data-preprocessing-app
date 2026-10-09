import type { Dispatch, SetStateAction } from "react";
import type { ReactElement } from "react";

import { SectionCard } from "@/components/SectionCard";
import { SettingsField } from "@/components/SettingsField";
import { ToggleField } from "@/components/ToggleField";
import {
  DEFAULT_BROWSER_OPTIONS,
  INTERVAL_EXPANSION_METHOD_VALUES,
  NOTIFICATION_PROXY_RULE_VALUES,
  POLLED_EMULATION_METHOD_VALUES,
  type IntervalExpansionMethod,
  type NotificationProxyRule,
  type PolledEmulationMethod,
} from "@/lib/generatedContract";
import { TOOLTIPS } from "@/lib/tooltipText";
import { anyOptionModified, isOptionDefault, type OptionKey } from "@/lib/optionDefaults";
import { optionRangeError } from "@/lib/validation";
import type { BrowserProcessingOptions } from "@/lib/types";

const KEYS: readonly OptionKey[] = [
  "notificationProxyRule",
  "polledEmulationMethod",
  "polledEmulationIntervalSeconds",
  "polledEmulationGapSeconds",
  "intervalExpansionMethod",
  "enablePersonAttribution",
  "enableComplianceScoring",
  "complianceThresholdPercent",
  "enableDayCoverage",
];

// `satisfies Record<NotificationProxyRule, string>` is the point: a new arm in
// the contract becomes a compile error here until it is named for a reader.
const NOTIFICATION_PROXY_RULE_LABELS = {
  none: "Off — notifications are not measured (default)",
  seen_contact_v1: "Notification Seen only",
  interruption_contact_v1: "Notification Interruption only",
  any_notification_contact_v1: "Both notification types",
} satisfies Record<NotificationProxyRule, string>;

const NOTIFICATION_PROXY_RULES = NOTIFICATION_PROXY_RULE_VALUES.map((value) => ({
  value,
  label: NOTIFICATION_PROXY_RULE_LABELS[value],
}));

const POLLED_EMULATION_METHOD_LABELS = {
  none: "Off — no polled emulation (default)",
  ross_2025_sampled_gap_v1: "Ross et al. 2025 — sample gap closes a session",
  cerit_2025_sample_count_v1: "Cerit et al. 2025 — duration from sample count",
} satisfies Record<PolledEmulationMethod, string>;

const POLLED_EMULATION_METHODS = POLLED_EMULATION_METHOD_VALUES.map((value) => ({
  value,
  label: POLLED_EMULATION_METHOD_LABELS[value],
}));

const INTERVAL_EXPANSION_METHOD_LABELS = {
  none: "Off — no interval expansion (default)",
  behapp_start_anchored_half_open_1s_v1: "Behapp — start-anchored half-open 1 s rows",
} satisfies Record<IntervalExpansionMethod, string>;

const INTERVAL_EXPANSION_METHODS = INTERVAL_EXPANSION_METHOD_VALUES.map((value) => ({
  value,
  label: INTERVAL_EXPANSION_METHOD_LABELS[value],
}));

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
        Analysis steps that score participants against study structure.
      </p>
      {!options.processAppUsage ? (
        <p className="settings-dependency-note" role="note" data-testid="analyze-dependency-note">
          App usage output is off, so none of these analysis steps can run. Turn on “App usage
          output” in Output &amp; plots to use them.
        </p>
      ) : null}

      <div className="settings-grid-1">
        <SettingsField
          label="Notification proxy rule"
          htmlFor="notification-proxy-rule-select"
          tooltip={TOOLTIPS.notificationProxyRule}
          modified={isMod("notificationProxyRule")}
          onReset={() => reset("notificationProxyRule")}
        >
          <select
            id="notification-proxy-rule-select"
            data-testid="notification-proxy-rule-select"
            className="select"
            value={options.notificationProxyRule}
            onChange={(event) =>
              update(
                "notificationProxyRule",
                event.target.value as BrowserProcessingOptions["notificationProxyRule"],
              )
            }
          >
            {NOTIFICATION_PROXY_RULES.map((rule) => (
              <option key={rule.value} value={rule.value}>
                {rule.label}
              </option>
            ))}
          </select>
        </SettingsField>
      </div>

      <div className="settings-grid-1">
        <SettingsField
          label="Polled-method emulation"
          htmlFor="polled-emulation-method-select"
          tooltip={TOOLTIPS.polledEmulationMethod}
          modified={isMod("polledEmulationMethod")}
          onReset={() => reset("polledEmulationMethod")}
        >
          <select
            id="polled-emulation-method-select"
            data-testid="polled-emulation-method-select"
            className="select"
            value={options.polledEmulationMethod}
            onChange={(event) =>
              update(
                "polledEmulationMethod",
                event.target.value as BrowserProcessingOptions["polledEmulationMethod"],
              )
            }
          >
            {POLLED_EMULATION_METHODS.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </select>
        </SettingsField>
      </div>
      {options.polledEmulationMethod !== "none" ? (
        <div className="settings-grid-2 settings-overview__subfield">
          <SettingsField
            label="Sampling cadence (seconds)"
            tooltip={TOOLTIPS.polledEmulationIntervalSeconds}
            modified={isMod("polledEmulationIntervalSeconds")}
            onReset={() => reset("polledEmulationIntervalSeconds")}
            error={optionRangeError("polledEmulationIntervalSeconds", options.polledEmulationIntervalSeconds)}
          >
            <input
              type="number"
              className="input"
              data-testid="polled-emulation-interval-input"
              min={1}
              max={3600}
              value={options.polledEmulationIntervalSeconds}
              onChange={(event) =>
                update("polledEmulationIntervalSeconds", Number(event.target.value))
              }
            />
          </SettingsField>
          {options.polledEmulationMethod === "ross_2025_sampled_gap_v1" ? (
            <SettingsField
              label="Session-break gap (seconds)"
              tooltip={TOOLTIPS.polledEmulationGapSeconds}
              modified={isMod("polledEmulationGapSeconds")}
              onReset={() => reset("polledEmulationGapSeconds")}
              error={optionRangeError("polledEmulationGapSeconds", options.polledEmulationGapSeconds)}
            >
              <input
                type="number"
                className="input"
                data-testid="polled-emulation-gap-input"
                min={0}
                max={3600}
                value={options.polledEmulationGapSeconds}
                onChange={(event) =>
                  update("polledEmulationGapSeconds", Number(event.target.value))
                }
              />
            </SettingsField>
          ) : null}
        </div>
      ) : null}

      <div className="settings-grid-1">
        <SettingsField
          label="Interval expansion output"
          htmlFor="interval-expansion-method-select"
          tooltip={TOOLTIPS.intervalExpansionMethod}
          modified={isMod("intervalExpansionMethod")}
          onReset={() => reset("intervalExpansionMethod")}
        >
          <select
            id="interval-expansion-method-select"
            data-testid="interval-expansion-method-select"
            className="select"
            value={options.intervalExpansionMethod}
            onChange={(event) =>
              update(
                "intervalExpansionMethod",
                event.target.value as BrowserProcessingOptions["intervalExpansionMethod"],
              )
            }
          >
            {INTERVAL_EXPANSION_METHODS.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </select>
        </SettingsField>
      </div>

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
            error={optionRangeError("complianceThresholdPercent", options.complianceThresholdPercent)}
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
