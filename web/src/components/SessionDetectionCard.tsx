import type { Dispatch, SetStateAction } from "react";
import type { ReactElement } from "react";

import { SectionCard } from "@/components/SectionCard";
import { SettingsField } from "@/components/SettingsField";
import { ToggleField } from "@/components/ToggleField";
import { ThresholdsInput } from "@/components/ThresholdsInput";
import {
  DEFAULT_BROWSER_OPTIONS,
  EPISODE_RECONSTRUCTION_STRATEGY_VALUES,
  EVENT_RETENTION_SET_VALUES,
  INTERVAL_QUALITY_POLICY_VALUES,
  MICRO_USE_CLASSIFICATION_POLICY_VALUES,
  MINIMUM_DURATION_COMPARATOR_VALUES,
  MAXIMUM_DURATION_DISPOSITION_VALUES,
  MAXIMUM_DURATION_POLICY_VALUES,
  MAXIMUM_DURATION_THRESHOLD_SOURCE_VALUES,
  MINIMUM_DURATION_DISPOSITION_VALUES,
  OPENER_SET_VALUES,
  SESSION_GROUPING_POLICY_VALUES,
  SESSION_GAP_BASIS_VALUES,
  SESSION_BOUNDARY_SCOPE_VALUES,
  type EpisodeReconstructionStrategy,
  type EventRetentionSet,
  type IntervalQualityPolicy,
  type MaximumDurationDisposition,
  type MaximumDurationPolicy,
  type MaximumDurationThresholdSource,
  type MicroUseClassificationPolicy,
  type MinimumDurationComparator,
  type MinimumDurationDisposition,
  type OpenerSet,
  type SessionGroupingPolicy,
  type SessionGapBasis,
  type SessionBoundaryScope,
} from "@/lib/generatedContract";
import { TOOLTIPS } from "@/lib/tooltipText";
import { anyOptionModified, isOptionDefault, type OptionKey } from "@/lib/optionDefaults";
import { optionRangeError } from "@/lib/validation";
import type { BrowserProcessingOptions } from "@/lib/types";

const KEYS: readonly OptionKey[] = [
  "longDurationThresholdHours",
  "microUseClassificationPolicy",
  "longDurationThresholdHoursExplicit",
  "customAppEngagementDuration",
  "longUsageDurationThresholds",
  "longDataTimeGapThresholds",
  "proximityIntervalSeconds",
  "correctDuplicateEventTimestamps",
  "deduplicateExactRows",
  "eventRetentionSet",
  "openerSet",
  "episodeReconstructionStrategy",
  "includeAppUsageEndReason",
  "sessionGroupingPolicy",
  "sessionGapBasis",
  "sessionBoundaryScope",
  "emitSessionBreakLineage",
  "allowStopEventReuse",
  "useActivityStoppedAsFallback",
  "applyThresholdToFallback",
  "addNoActivityPlaceholderDays",
];

/// Labels only. The VALUES come from the research ontology through the
/// generated contract, so this file can no longer disagree with the kernel
/// about which rules exist — it can only fail to name one, and `satisfies`
/// makes that a compile error.
///
/// It used to hold the values too, and said "the four published reconstruction
/// rules" while seven were implemented; three shipped arms could not be
/// selected at all.
/// Upstream of all downstream axes: this decides which raw interaction types
/// the reconstruction is allowed to see in the first place. Labels carry the
/// retained-type count because that count is the whole shape of the set.
const EVENT_RETENTION_LABELS = {
  none: "Retain every event type (default)",
  parry_toth_7: "Parry & Toth 7 types (no Activity Paused)",
  usage_logger_5: "Usage Logger 5 types (+ User Interaction)",
  toth_trifonova_app: "Toth & Trifonova 4 types",
  foreground_background_only: "Foreground/background pair only",
} satisfies Record<EventRetentionSet, string>;

/// Opener eligibility is deliberately factored from both retention and
/// reconstruction. The GESIS label names the adaptation so selecting it cannot
/// be mistaken for a verbatim implementation of the full tutorial method.
const OPENER_SET_LABELS = {
  strategy_defined: "Strategy-defined opener (default)",
  activity_resumed_only: "Activity Resumed only",
  gesis_app_scoped_starts: "GESIS app-scoped starts (adapter)",
} satisfies Record<OpenerSet, string>;

const EPISODE_RECONSTRUCTION_LABELS = {
  fused_matcher: "Chronicle fused matcher (default)",
  parry_toth_forward_pairing: "Parry & Toth forward pairing (2025)",
  eyes_complement: "EYES complement segmentation",
  gesis_start_stop_repair: "GESIS start-stop repair (Zerrer et al.)",
  foreground_background_pairing: "Ahmed / Okoshi foreground-background pairing",
  draxler_interruption_aware: "Draxler interruption-aware (2021)",
  morrison_lock_tolerant: "Morrison lock-tolerant (2018)",
  schoedel_2026_app_within_screen_prose_v1:
    "Schoedel within-screen prose derivative (2026)",
} satisfies Record<EpisodeReconstructionStrategy, string>;

const MICRO_USE_CLASSIFICATION_LABELS = {
  none: "No micro-use classification (default)",
  okoshi_lt_5s: "Okoshi micro-use: raw duration < 5 s",
} satisfies Record<MicroUseClassificationPolicy, string>;

const MINIMUM_DURATION_COMPARATOR_LABELS = {
  strict_lt: "Strictly below threshold (<, default)",
  inclusive_le: "At or below threshold (≤)",
} satisfies Record<MinimumDurationComparator, string>;

const MINIMUM_DURATION_DISPOSITION_LABELS = {
  chronicle_blank_keep_row: "Blank duration, keep row (default)",
  retain_and_credit: "Retain and credit",
  retain_but_exclude: "Retain row, exclude from headline totals",
  drop_row: "Drop row, retain excluded lineage",
} satisfies Record<MinimumDurationDisposition, string>;

/// B06. The four selection keys travel as a set: the policy select below is
/// the one control that opens or closes the axis, and its "not selected"
/// entry (value "") removes all four keys together so the run returns to
/// Chronicle's legacy behaviour with no receipt. Explicit `strategy_native`
/// is a different thing from omission: it emits a receipt.
const MAXIMUM_DURATION_POLICY_LABELS = {
  strategy_native: "Adopt the strategy's native maximum (explicit, receipted)",
  chronicle_observed_close_rejection_v1:
    "Chronicle candidate-close rejection (fused matcher only)",
  post_reconstruction_strict_max_v1:
    "Post-reconstruction strict maximum (>, generic)",
} satisfies Record<MaximumDurationPolicy, string>;

const MAXIMUM_DURATION_DISPOSITION_LABELS = {
  not_applicable: "Not applicable (native policy owns the endpoint)",
  flag_and_retain: "Flag and retain",
  retain_but_exclude: "Retain row, exclude from headline totals",
  truncate_to_threshold: "Truncate to threshold, record trimmed time",
  drop_row: "Drop row, retain excluded lineage",
} satisfies Record<MaximumDurationDisposition, string>;

const MAXIMUM_DURATION_THRESHOLD_SOURCE_LABELS = {
  strategy_native: "Strategy-native threshold",
  chronicle_legacy_config: "Chronicle max session duration (hours above)",
  fixed_parameter: "Fixed nanosecond parameter",
  b12_adaptive_participant: "Adaptive per-participant (B12; refuses until it lands)",
} satisfies Record<MaximumDurationThresholdSource, string>;

export const MAXIMUM_DURATION_UNSELECTED_LABEL = "Not selected — Chronicle legacy behaviour (default)";

/// A different axis from the reconstruction rule above: Culverhouse never
/// redefines episodes, it bounds implausible ones.
const INTERVAL_QUALITY_LABELS = {
  none: "Chronicle interval cleaning (default)",
  culverhouse_trim_and_log: "Culverhouse trim-and-log",
} satisfies Record<IntervalQualityPolicy, string>;

/// A third axis again: reconstruction decides where an episode starts and ends,
/// interval quality bounds an implausible one, and this groups the finished
/// episodes into sessions. Labels carry the threshold because the threshold is
/// the whole difference between most of these; the operator differences are in
/// the tooltip.
const SESSION_GROUPING_LABELS = {
  none: "No session grouping (default)",
  church_5s: "Church 5 s",
  smartphone_wellbeing_strict_lt_5s: "Smartphone Wellbeing < 5 s",
  grosse_deters_10s: "grosse Deters 10 s",
  ross_15s: "Ross 15 s (+ app change)",
  van_berkel_45s: "App-episode gap ≤ 45 s (legacy ID)",
  zerrer_60s: "Zerrer 60 s",
  peng_zhu_2020_participant_median: "Peng & Zhu per-participant median",
} satisfies Record<SessionGroupingPolicy, string>;

/// Which endpoint the gap is measured from. The default is what every
/// published rule ships; the alternative is a stated departure from them, and
/// the label says so rather than presenting the two as equal readings.
const SESSION_GAP_BASIS_LABELS = {
  previous_episode_stop_v1: "Previous episode's stop (as published, default)",
  session_running_maximum_stop_v1: "Session's furthest stop so far (departure)",
} satisfies Record<SessionGapBasis, string>;

/// Which rows are numbered as one sequence. The scopes nest, so the labels
/// read as additions rather than as three unrelated choices.
const SESSION_BOUNDARY_SCOPE_LABELS = {
  participant_v1: "Participant (default)",
  participant_and_study_v1: "Participant + study",
  participant_study_and_person_v1: "Participant + study + person",
} satisfies Record<SessionBoundaryScope, string>;

function optionsFor<Value extends string>(
  values: readonly Value[],
  labels: Record<Value, string>,
): readonly { value: Value; label: string }[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

export const EVENT_RETENTION_SETS = optionsFor(
  EVENT_RETENTION_SET_VALUES,
  EVENT_RETENTION_LABELS,
);
export const OPENER_SETS = optionsFor(OPENER_SET_VALUES, OPENER_SET_LABELS);
export const EPISODE_RECONSTRUCTION_STRATEGIES = optionsFor(
  EPISODE_RECONSTRUCTION_STRATEGY_VALUES,
  EPISODE_RECONSTRUCTION_LABELS,
);
export const MICRO_USE_CLASSIFICATION_POLICIES = optionsFor(
  MICRO_USE_CLASSIFICATION_POLICY_VALUES,
  MICRO_USE_CLASSIFICATION_LABELS,
);
export const MINIMUM_DURATION_COMPARATORS = optionsFor(
  MINIMUM_DURATION_COMPARATOR_VALUES,
  MINIMUM_DURATION_COMPARATOR_LABELS,
);
export const MINIMUM_DURATION_DISPOSITIONS = optionsFor(
  MINIMUM_DURATION_DISPOSITION_VALUES,
  MINIMUM_DURATION_DISPOSITION_LABELS,
);
export const MAXIMUM_DURATION_POLICIES = optionsFor(
  MAXIMUM_DURATION_POLICY_VALUES,
  MAXIMUM_DURATION_POLICY_LABELS,
);
export const MAXIMUM_DURATION_DISPOSITIONS = optionsFor(
  MAXIMUM_DURATION_DISPOSITION_VALUES,
  MAXIMUM_DURATION_DISPOSITION_LABELS,
);
export const MAXIMUM_DURATION_THRESHOLD_SOURCES = optionsFor(
  MAXIMUM_DURATION_THRESHOLD_SOURCE_VALUES,
  MAXIMUM_DURATION_THRESHOLD_SOURCE_LABELS,
);
export const INTERVAL_QUALITY_POLICIES = optionsFor(
  INTERVAL_QUALITY_POLICY_VALUES,
  INTERVAL_QUALITY_LABELS,
);
export const SESSION_GROUPING_POLICIES = optionsFor(
  SESSION_GROUPING_POLICY_VALUES,
  SESSION_GROUPING_LABELS,
);
const SESSION_GAP_BASES = optionsFor(
  SESSION_GAP_BASIS_VALUES,
  SESSION_GAP_BASIS_LABELS,
);
const SESSION_BOUNDARY_SCOPES = optionsFor(
  SESSION_BOUNDARY_SCOPE_VALUES,
  SESSION_BOUNDARY_SCOPE_LABELS,
);

type Props = {
  options: BrowserProcessingOptions;
  setOptions: Dispatch<SetStateAction<BrowserProcessingOptions>>;
};

export function SessionDetectionCard({ options, setOptions }: Props): ReactElement {
  const update = <K extends OptionKey>(key: K, value: BrowserProcessingOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };
  const reset = (key: OptionKey) => {
    setOptions((current) => ({ ...current, [key]: DEFAULT_BROWSER_OPTIONS[key] }));
  };
  const isMod = <K extends OptionKey>(key: K) => !isOptionDefault(key, options[key]);


  return (
    <SectionCard
      id="session-detection"
      title="Session detection"
      accent="session"
      modified={anyOptionModified(options, KEYS)}
    >
      {!options.processAppUsage ? (
        <p className="settings-dependency-note" role="note" data-testid="session-dependency-note">
          App usage output is off, so these session-detection settings won’t change any output.
          Turn on “App usage output” in Output &amp; plots to use them.
        </p>
      ) : null}
      <div className="settings-grid-2">
        <SettingsField
          label="Max session duration threshold (hours)"
          htmlFor="long-duration-threshold-input"
          tooltip={TOOLTIPS.longDurationThresholdHours}
          modified={isMod("longDurationThresholdHours")}
          onReset={() =>
            setOptions((current) => ({
              ...current,
              longDurationThresholdHours: DEFAULT_BROWSER_OPTIONS.longDurationThresholdHours,
              longDurationThresholdHoursExplicit: undefined,
            }))
          }
          error={optionRangeError("longDurationThresholdHours", options.longDurationThresholdHours)}
        >
          <input
            id="long-duration-threshold-input"
            data-testid="long-duration-threshold-input"
            type="number"
            className="input"
            min={1}
            max={1_000_000}
            step={0.5}
            value={options.longDurationThresholdHours}
            onChange={(event) =>
              setOptions((current) => ({
                ...current,
                longDurationThresholdHours: Number(event.target.value),
                // Origin marker for the maximum-duration receipt: a typed value
                // is an explicit choice even when it equals the default.
                longDurationThresholdHoursExplicit: true,
              }))
            }
          />
        </SettingsField>

        <SettingsField
          label="Custom app engagement duration (seconds)"
          htmlFor="custom-engagement-duration-input"
          tooltip={TOOLTIPS.customAppEngagementDuration}
          modified={isMod("customAppEngagementDuration")}
          onReset={() => reset("customAppEngagementDuration")}
          error={optionRangeError("customAppEngagementDuration", options.customAppEngagementDuration)}
        >
          <input
            id="custom-engagement-duration-input"
            data-testid="custom-engagement-duration-input"
            type="number"
            className="input"
            min={1}
            max={3600}
            value={options.customAppEngagementDuration}
            onChange={(event) =>
              update("customAppEngagementDuration", Number(event.target.value))
            }
          />
        </SettingsField>

        <SettingsField
          label="Long usage thresholds (hours)"
          tooltip={TOOLTIPS.longUsageDurationThresholds}
          modified={isMod("longUsageDurationThresholds")}
          onReset={() => reset("longUsageDurationThresholds")}
        >
          <ThresholdsInput
            testId="long-usage-thresholds-input"
            value={options.longUsageDurationThresholds}
            fallback={DEFAULT_BROWSER_OPTIONS.longUsageDurationThresholds}
            onChange={(next) => update("longUsageDurationThresholds", next)}
            placeholder="1, 2, 3, …"
          />
        </SettingsField>

        <SettingsField
          label="Long data gap thresholds (hours)"
          tooltip={TOOLTIPS.longDataTimeGapThresholds}
          modified={isMod("longDataTimeGapThresholds")}
          onReset={() => reset("longDataTimeGapThresholds")}
        >
          <ThresholdsInput
            testId="long-gap-thresholds-input"
            value={options.longDataTimeGapThresholds}
            fallback={DEFAULT_BROWSER_OPTIONS.longDataTimeGapThresholds}
            onChange={(next) => update("longDataTimeGapThresholds", next)}
            placeholder="1, 2, 3, …"
          />
        </SettingsField>

        <SettingsField
          label="Intra-app teardown grace (seconds)"
          htmlFor="proximity-interval-input"
          tooltip={TOOLTIPS.proximityIntervalSeconds}
          modified={isMod("proximityIntervalSeconds")}
          onReset={() => reset("proximityIntervalSeconds")}
          error={optionRangeError("proximityIntervalSeconds", options.proximityIntervalSeconds)}
        >
          <input
            id="proximity-interval-input"
            data-testid="proximity-interval-input"
            type="number"
            className="input"
            min={0}
            max={3600}
            step={0.5}
            value={options.proximityIntervalSeconds}
            onChange={(event) =>
              update("proximityIntervalSeconds", Number(event.target.value))
            }
          />
        </SettingsField>
      </div>

      <div className="settings-grid-1">
        <SettingsField
          label="Event retention set"
          htmlFor="event-retention-set-select"
          tooltip={TOOLTIPS.eventRetentionSet}
          modified={isMod("eventRetentionSet")}
          onReset={() => reset("eventRetentionSet")}
        >
          <select
            id="event-retention-set-select"
            data-testid="event-retention-set-select"
            className="select"
            value={options.eventRetentionSet}
            onChange={(event) =>
              update(
                "eventRetentionSet",
                event.target.value as BrowserProcessingOptions["eventRetentionSet"],
              )
            }
          >
            {EVENT_RETENTION_SETS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingsField>
      </div>

      <div className="settings-grid-1">
        <SettingsField
          label="App-episode opener set"
          htmlFor="opener-set-select"
          tooltip={TOOLTIPS.openerSet}
          modified={isMod("openerSet")}
          onReset={() => reset("openerSet")}
        >
          <select
            id="opener-set-select"
            data-testid="opener-set-select"
            className="select"
            value={options.openerSet}
            onChange={(event) =>
              update(
                "openerSet",
                event.target.value as BrowserProcessingOptions["openerSet"],
              )
            }
          >
            {OPENER_SETS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingsField>
      </div>

      <div className="settings-grid-1">
        <SettingsField
          label="Episode reconstruction rule"
          htmlFor="episode-reconstruction-strategy-select"
          tooltip={TOOLTIPS.episodeReconstructionStrategy}
          modified={isMod("episodeReconstructionStrategy")}
          onReset={() => reset("episodeReconstructionStrategy")}
        >
          <select
            id="episode-reconstruction-strategy-select"
            data-testid="episode-reconstruction-strategy-select"
            className="select"
            value={options.episodeReconstructionStrategy}
            onChange={(event) =>
              update(
                "episodeReconstructionStrategy",
                event.target.value as BrowserProcessingOptions["episodeReconstructionStrategy"],
              )
            }
          >
            {EPISODE_RECONSTRUCTION_STRATEGIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingsField>
      </div>

      <div className="settings-grid-1">
        <SettingsField
          label="Micro-use classification"
          htmlFor="micro-use-classification-policy-select"
          tooltip={TOOLTIPS.microUseClassificationPolicy}
          modified={isMod("microUseClassificationPolicy")}
          onReset={() => reset("microUseClassificationPolicy")}
        >
          <select
            id="micro-use-classification-policy-select"
            data-testid="micro-use-classification-policy-select"
            className="select"
            value={options.microUseClassificationPolicy}
            onChange={(event) =>
              update(
                "microUseClassificationPolicy",
                event.target.value as BrowserProcessingOptions["microUseClassificationPolicy"],
              )
            }
          >
            {MICRO_USE_CLASSIFICATION_POLICIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingsField>
      </div>

      <div className="settings-grid-1">
        <SettingsField
          label="Session grouping policy"
          htmlFor="session-grouping-policy-select"
          tooltip={TOOLTIPS.sessionGroupingPolicy}
          modified={isMod("sessionGroupingPolicy")}
          onReset={() => reset("sessionGroupingPolicy")}
        >
          <select
            id="session-grouping-policy-select"
            data-testid="session-grouping-policy-select"
            className="select"
            value={options.sessionGroupingPolicy}
            onChange={(event) =>
              update(
                "sessionGroupingPolicy",
                event.target.value as BrowserProcessingOptions["sessionGroupingPolicy"],
              )
            }
          >
            {SESSION_GROUPING_POLICIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingsField>
      </div>

      {options.sessionGroupingPolicy !== "none" && (
        <div className="settings-grid-2">
          <SettingsField
            label="Session gap measured from"
            htmlFor="session-gap-basis-select"
            tooltip={TOOLTIPS.sessionGapBasis}
            modified={isMod("sessionGapBasis")}
            onReset={() => reset("sessionGapBasis")}
          >
            <select
              id="session-gap-basis-select"
              data-testid="session-gap-basis-select"
              className="select"
              value={options.sessionGapBasis}
              onChange={(event) =>
                update(
                  "sessionGapBasis",
                  event.target.value as BrowserProcessingOptions["sessionGapBasis"],
                )
              }
            >
              {SESSION_GAP_BASES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </SettingsField>
          <SettingsField
            label="Session boundary scope"
            htmlFor="session-boundary-scope-select"
            tooltip={TOOLTIPS.sessionBoundaryScope}
            modified={isMod("sessionBoundaryScope")}
            onReset={() => reset("sessionBoundaryScope")}
          >
            <select
              id="session-boundary-scope-select"
              data-testid="session-boundary-scope-select"
              className="select"
              value={options.sessionBoundaryScope}
              onChange={(event) =>
                update(
                  "sessionBoundaryScope",
                  event.target
                    .value as BrowserProcessingOptions["sessionBoundaryScope"],
                )
              }
            >
              {SESSION_BOUNDARY_SCOPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </SettingsField>
        </div>
      )}

      {options.sessionGroupingPolicy !== "none" && (
        <div className="settings-grid-1">
          <ToggleField
            label="Record why each session broke"
            tooltip={TOOLTIPS.emitSessionBreakLineage}
            checked={options.emitSessionBreakLineage}
            onChange={(value) => update("emitSessionBreakLineage", value)}
            testId="toggle-emitSessionBreakLineage"
            modified={isMod("emitSessionBreakLineage")}
            onReset={() => reset("emitSessionBreakLineage")}
          />
        </div>
      )}

      <div className="settings-grid-1">
        <ToggleField
          label="Correct duplicate event timestamps"
          tooltip={TOOLTIPS.correctDuplicateEventTimestamps}
          checked={options.correctDuplicateEventTimestamps}
          onChange={(value) => update("correctDuplicateEventTimestamps", value)}
          testId="toggle-correctDuplicateEventTimestamps"
          modified={isMod("correctDuplicateEventTimestamps")}
          onReset={() => reset("correctDuplicateEventTimestamps")}
        />
        <ToggleField
          label="Collapse exact duplicate rows"
          tooltip={TOOLTIPS.deduplicateExactRows}
          checked={options.deduplicateExactRows}
          onChange={(value) => update("deduplicateExactRows", value)}
          testId="toggle-deduplicateExactRows"
          modified={isMod("deduplicateExactRows")}
          onReset={() => reset("deduplicateExactRows")}
        />
        <ToggleField
          label="Include app-usage end reason column"
          tooltip={TOOLTIPS.includeAppUsageEndReason}
          checked={options.includeAppUsageEndReason}
          onChange={(value) => update("includeAppUsageEndReason", value)}
          testId="toggle-includeAppUsageEndReason"
          modified={isMod("includeAppUsageEndReason")}
          onReset={() => reset("includeAppUsageEndReason")}
        />
        <ToggleField
          label="Allow stop event reuse"
          tooltip={TOOLTIPS.allowStopEventReuse}
          checked={options.allowStopEventReuse}
          onChange={(value) => update("allowStopEventReuse", value)}
          testId="toggle-allowStopEventReuse"
          modified={isMod("allowStopEventReuse")}
          onReset={() => reset("allowStopEventReuse")}
        />
        <ToggleField
          label="Use Activity Stopped fallback"
          tooltip={TOOLTIPS.useActivityStoppedAsFallback}
          checked={options.useActivityStoppedAsFallback}
          onChange={(value) => update("useActivityStoppedAsFallback", value)}
          testId="toggle-useActivityStoppedAsFallback"
          modified={isMod("useActivityStoppedAsFallback")}
          onReset={() => reset("useActivityStoppedAsFallback")}
        />
        <ToggleField
          label="Apply threshold to Activity Stopped fallback"
          tooltip={TOOLTIPS.applyThresholdToFallback}
          checked={options.applyThresholdToFallback}
          onChange={(value) => update("applyThresholdToFallback", value)}
          testId="toggle-applyThresholdToFallback"
          modified={isMod("applyThresholdToFallback")}
          onReset={() => reset("applyThresholdToFallback")}
        />
        <ToggleField
          label="Add no-activity placeholder days"
          tooltip={TOOLTIPS.addNoActivityPlaceholderDays}
          checked={options.addNoActivityPlaceholderDays}
          onChange={(value) => update("addNoActivityPlaceholderDays", value)}
          testId="toggle-addNoActivityPlaceholderDays"
          modified={isMod("addNoActivityPlaceholderDays")}
          onReset={() => reset("addNoActivityPlaceholderDays")}
        />
      </div>
    </SectionCard>
  );
}
