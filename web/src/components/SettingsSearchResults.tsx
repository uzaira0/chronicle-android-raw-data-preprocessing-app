import type { ReactElement } from "react";

type SettingSearchItem = {
  label: string;
  section: string;
  href: string;
  keywords: string;
};

const SETTINGS: SettingSearchItem[] = [
  { label: "Study name", section: "Core", href: "#settings", keywords: "study name id output metadata" },
  { label: "Output mode", section: "Core", href: "#settings", keywords: "app screen both usage session csv" },
  { label: "Filter file", section: "Support files", href: "#files", keywords: "support filter bundled default apps upload" },
  { label: "Keep-awake apps file", section: "Support files", href: "#files", keywords: "support keep awake screen upload bundled default" },
  { label: "App codebook file", section: "Support files", href: "#files", keywords: "support codebook genre category upload bundled default" },
  { label: "Timezone handling", section: "Timezone", href: "#timezone", keywords: "timezone selected primary filter convert conversion" },
  { label: "Selected timezone", section: "Timezone", href: "#timezone", keywords: "timezone america chicago conversion selected" },
  { label: "Max session duration threshold", section: "Session detection", href: "#session-detection", keywords: "duration threshold hours long usage session" },
  { label: "Custom app engagement duration", section: "Session detection", href: "#session-detection", keywords: "engagement seconds custom valid app" },
  { label: "Long-usage thresholds", section: "Session detection", href: "#session-detection", keywords: "long usage threshold hours flags" },
  { label: "Long data-gap thresholds", section: "Session detection", href: "#session-detection", keywords: "data gap threshold hours flags" },
  { label: "Correct duplicate event timestamps", section: "Session detection", href: "#session-detection", keywords: "duplicate timestamp correction" },
  { label: "Allow stop-event reuse", section: "Session detection", href: "#session-detection", keywords: "stop event reuse matching" },
  { label: "Use Activity Stopped fallback", section: "Session detection", href: "#session-detection", keywords: "activity stopped fallback matching" },
  { label: "Apply threshold to Activity Stopped fallback", section: "Session detection", href: "#session-detection", keywords: "activity stopped fallback threshold" },
  { label: "Auto-lock timeout", section: "Screen detection", href: "#screen-detection", keywords: "screen auto lock timeout seconds" },
  { label: "Auto-lock tolerance", section: "Screen detection", href: "#screen-detection", keywords: "screen auto lock tolerance seconds" },
  { label: "Manual-lock max tail gap", section: "Screen detection", href: "#screen-detection", keywords: "screen manual lock tail gap seconds" },
  { label: "Keyguard near-stop window", section: "Screen detection", href: "#screen-detection", keywords: "screen keyguard stop window seconds" },
  { label: "Same-app stop interaction types", section: "Interaction semantics", href: "#interaction-semantics", keywords: "same app stop interaction paused resumed destroyed" },
  { label: "Other-app stop interaction types", section: "Interaction semantics", href: "#interaction-semantics", keywords: "other app stop interaction screen keyguard shutdown filtered" },
  { label: "Interaction types to remove", section: "Interaction semantics", href: "#interaction-semantics", keywords: "remove interaction filter output cleanup" },
  { label: "Parallel processing", section: "Performance", href: "#performance", keywords: "parallel sequential workers processing mode" },
  { label: "Max parallel workers", section: "Performance", href: "#performance", keywords: "parallel workers cpu performance" },
];

type Props = {
  query: string;
  onNavigate?: (href: string) => void;
};

export function SettingsSearchResults({ query, onNavigate }: Props): ReactElement | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;

  const matches = SETTINGS.filter((item) =>
    `${item.label} ${item.section} ${item.keywords}`.toLowerCase().includes(normalized),
  );

  return (
    <div className="settings-search-results" aria-live="polite">
      <strong>
        {matches.length
          ? `${matches.length} setting${matches.length === 1 ? "" : "s"} found`
          : "No settings found"}
      </strong>
      {matches.length ? (
        <div className="settings-search-results__grid">
          {matches.map((item) => (
            <a
              key={`${item.section}-${item.label}`}
              href={item.href}
              onClick={() => onNavigate?.(item.href)}
            >
              <span>{item.label}</span>
              <small>{item.section}</small>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
