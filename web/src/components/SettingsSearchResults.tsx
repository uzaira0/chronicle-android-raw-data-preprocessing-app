import type { ReactElement } from "react";
import {
  BROWSER_OPTION_TOOLTIPS,
  BROWSER_PROCESSING_OPTION_KEYS,
} from "@/lib/generatedContract";

type SectionKey =
  | "overview"
  | "files"
  | "timezone"
  | "session"
  | "screen"
  | "interaction"
  | "performance"
  | "study"
  | "management";

type Section = { label: string; selector: string };

// `selector` is the element scrolled to within the Settings tab. SectionCards
// expose `data-section-id`; the two plain containers expose `data-settings-anchor`.
const SECTIONS: Record<SectionKey, Section> = {
  overview: { label: "Output & plots", selector: '[data-settings-anchor="overview"]' },
  files: { label: "Support files", selector: '[data-section-id="files"]' },
  timezone: { label: "Timezone", selector: '[data-section-id="timezone"]' },
  session: { label: "Session detection", selector: '[data-section-id="session-detection"]' },
  screen: { label: "Screen detection", selector: '[data-section-id="screen-detection"]' },
  interaction: { label: "Interaction semantics", selector: '[data-section-id="interaction-semantics"]' },
  performance: { label: "Performance", selector: '[data-section-id="performance"]' },
  study: { label: "Study analysis", selector: '[data-section-id="study-inputs"]' },
  management: { label: "Settings management", selector: '[data-settings-anchor="management"]' },
};

// Which card hosts each option. Derived once from the contract key list below so
// the search index can never drift out of sync with the real set of options;
// only the section routing is maintained here (a key with no entry still shows,
// routed to the overview card).
export const SECTION_BY_KEY: Record<string, SectionKey> = {
  studyName: "overview",
  processAppUsage: "overview",
  processScreenUsage: "overview",
  enablePlotting: "overview",
  includeFilteredAppUsageInPlots: "overview",
  enableActivityHeatmap: "overview",
  exportPlotsAsSvg: "overview",
  enableAggregates: "overview",
  aggregateShape: "overview",
  enableParquetExport: "overview",
  enableSpssExport: "overview",
  enableInteractiveTimeline: "overview",
  useFilterFile: "files",
  useAppsForcingScreenOpenFile: "files",
  useBackgroundAppsFile: "files",
  useAppCodebook: "files",
  includeCategoryColumn: "files",
  selectedTimezone: "timezone",
  timezoneHandling: "timezone",
  allowStopEventReuse: "session",
  useActivityStoppedAsFallback: "session",
  applyThresholdToFallback: "session",
  longDurationThresholdHours: "session",
  correctDuplicateEventTimestamps: "session",
  deduplicateExactRows: "session",
  minimumUsageDuration: "session",
  filterZeroDurationSessions: "session",
  customAppEngagementDuration: "session",
  longUsageDurationThresholds: "session",
  longDataTimeGapThresholds: "session",
  modelConcurrentUsage: "session",
  applyMinimumUsageDurationToConcurrentSubintervals: "session",
  proximityIntervalSeconds: "session",
  addNoActivityPlaceholderDays: "session",
  screenUsageAutoLockTimeoutSeconds: "screen",
  screenUsageAutoLockToleranceSeconds: "screen",
  screenUsageManualLockMaxTailGapSeconds: "screen",
  screenUsageKeyguardNearStopSeconds: "screen",
  sameAppInteractionTypesToStopUsageAt: "interaction",
  otherInteractionTypesToStopUsageAt: "interaction",
  interactionTypesToRemove: "interaction",
  interactionTypeRemap: "interaction",
  parallelProcessing: "performance",
  parallelMaxWorkers: "performance",
  enableScreenGatedCrediting: "study",
  creditedSessionCapMinutes: "study",
  deviceLivenessGapToleranceMinutes: "study",
  autoLockBridgeSeconds: "study",
  noWitnessMinDayApps: "study",
  enableStudyWindowFilter: "study",
  enablePersonAttribution: "study",
  enableComplianceScoring: "study",
  complianceThresholdPercent: "study",
  enableDayCoverage: "study",
};

type SearchItem = {
  key: string;
  label: string;
  sectionKey: SectionKey;
  keywords: string;
};

const TOOLTIPS = BROWSER_OPTION_TOOLTIPS as Record<
  string,
  { title?: string; body?: string; example?: string } | undefined
>;

function humanize(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}

// Index built FROM the contract key list, so every processing option is always
// searchable — the old hand-maintained list silently dropped ~5 options.
const ITEMS: SearchItem[] = [
  ...BROWSER_PROCESSING_OPTION_KEYS.map((key): SearchItem => {
    const tip = TOOLTIPS[key];
    const sectionKey = SECTION_BY_KEY[key] ?? "overview";
    const label = tip?.title ?? humanize(key);
    const keywords =
      `${label} ${SECTIONS[sectionKey].label} ${tip?.body ?? ""} ${key}`.toLowerCase();
    return { key, label, sectionKey, keywords };
  }),
  // UI-only controls that aren't processing options but live in the Settings tab.
  {
    key: "__demoMode",
    label: "Demo mode (hide labels)",
    sectionKey: "management",
    keywords: "demo mode hide file participant date labels pseudonymize privacy public screen",
  },
  {
    key: "__resetDefaults",
    label: "Reset all to defaults",
    sectionKey: "management",
    keywords: "reset defaults restore clear settings management",
  },
];

type Props = {
  query: string;
  /** Called with the CSS selector of the target section to scroll to + flash. */
  onNavigate?: (selector: string) => void;
};

export function SettingsSearchResults({ query, onNavigate }: Props): ReactElement | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;

  const matches = ITEMS.filter((item) => item.keywords.includes(normalized));

  return (
    <div
      className="settings-search-results"
      aria-live="polite"
      data-testid="settings-search-results"
    >
      <strong>
        {matches.length
          ? `${matches.length} setting${matches.length === 1 ? "" : "s"} found`
          : "No settings found"}
      </strong>
      {matches.length ? (
        <div className="settings-search-results__grid">
          {matches.map((item) => (
            <button
              type="button"
              key={item.key}
              className="settings-search-result"
              data-testid="settings-search-result"
              onClick={() => onNavigate?.(SECTIONS[item.sectionKey].selector)}
            >
              <span>{item.label}</span>
              <small>{SECTIONS[item.sectionKey].label}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
