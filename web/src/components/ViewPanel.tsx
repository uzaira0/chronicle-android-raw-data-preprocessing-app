import { useEffect, useState } from "react";
import type { ReactElement } from "react";

import { Combobox } from "@/components/Combobox";
import { InteractiveScene, sanitizeDemoView } from "@/components/review/InteractiveScene";
import { ReviewParticipantRail } from "@/components/review/ReviewParticipantRail";
import { ReviewMetricsPanel } from "@/components/review/ReviewMetricsPanel";
import { ReviewSettingsSummary } from "@/components/review/ReviewSettingsSummary";
import { AppListsPanel } from "@/components/review/AppListsPanel";
import type { DemoDisplayMasker } from "@/lib/demoDisplay";
import type {
  BrowserProcessingOptions,
  ProcessedFileResult,
  ReviewParticipantSummary,
  TimelineParticipantView,
  TimelineViewData,
} from "@/lib/types";

type Props = {
  results: ProcessedFileResult[];
  options: BrowserProcessingOptions;
  displayMasker: DemoDisplayMasker;
  includeFilteredAppUsageInPlots: boolean;
};

type ViewType = "app" | "screen";
type SubView = "timeline" | "applists";

const HINT = "Shift scroll a row to zoom · drag zoomed rows · double click to reset";

function appViewsFor(
  data: TimelineViewData,
  includeFiltered: boolean,
): TimelineParticipantView[] {
  if (includeFiltered) return data.appFilteredIncluded ?? data.app;
  return data.appFilteredExcluded ?? data.app;
}

function hasAppViews(data: TimelineViewData): boolean {
  return (
    data.app.length > 0 ||
    !!data.appFilteredIncluded?.length ||
    !!data.appFilteredExcluded?.length
  );
}

/** A run is reviewable if it carries the per-participant review summary. */
function isReviewable(
  result: ProcessedFileResult,
): result is ProcessedFileResult & { reviewSummary: NonNullable<ProcessedFileResult["reviewSummary"]> } {
  return !!result.reviewSummary && result.reviewSummary.participants.length > 0;
}

export function ViewPanel({
  results,
  options,
  displayMasker,
  includeFilteredAppUsageInPlots,
}: Props): ReactElement {
  const reviewableFiles = results.filter(isReviewable);

  const [selectedFile, setSelectedFile] = useState<string>("");
  const [fileQuery, setFileQuery] = useState<string | null>(null);
  const [selectedParticipant, setSelectedParticipant] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<ViewType>("app");
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const [subView, setSubView] = useState<SubView>("timeline");
  const [showFilteredUsage, setShowFilteredUsage] = useState(includeFilteredAppUsageInPlots);

  useEffect(() => {
    setShowFilteredUsage(includeFilteredAppUsageInPlots);
  }, [includeFilteredAppUsageInPlots]);

  if (reviewableFiles.length === 0) {
    return (
      <section className="timeline-view" aria-label="Review" data-testid="timeline-view">
        <p className="timeline-view__empty" data-testid="timeline-view-empty">
          Nothing to review yet. Process a file and its review — participants, timeline, and
          per-day metrics — appears here.
        </p>
      </section>
    );
  }

  const activeFile =
    reviewableFiles.find((r) => r.inputFileName === selectedFile) ?? reviewableFiles[0]!;
  const participants: ReviewParticipantSummary[] = activeFile.reviewSummary.participants;
  const activeParticipant =
    participants.find((p) => p.participantId === selectedParticipant) ?? participants[0]!;

  // Reset the focused day whenever the participant or file context changes.
  const participantKey = `${activeFile.inputFileName}:${activeParticipant.participantId}`;

  const timeline = activeFile.timelineView;
  const availableTypes: ViewType[] = timeline
    ? [
        ...(hasAppViews(timeline) ? (["app"] as const) : []),
        ...(timeline.screen.length > 0 ? (["screen"] as const) : []),
      ]
    : [];
  const activeType: ViewType =
    availableTypes.includes(selectedType) ? selectedType : (availableTypes[0] ?? "app");

  const participantViews: TimelineParticipantView[] = !timeline
    ? []
    : activeType === "app"
      ? appViewsFor(timeline, showFilteredUsage)
      : timeline.screen;
  const rawView = participantViews.find(
    (v) => v.participantId === activeParticipant.participantId,
  );
  const view = rawView ? sanitizeDemoView(rawView, displayMasker) : null;

  const typeLabel: Record<ViewType, string> = { app: "App usage", screen: "Screen usage" };
  const filteredUsageLabel = showFilteredUsage ? "Filtered usage included" : "Filtered usage excluded";
  const contextLine = timeline
    ? `${typeLabel[activeType]} · ${filteredUsageLabel} · ${displayMasker.timezone(timeline.timezone)}`
    : "";

  const activeFileLabel = displayMasker.fileName(activeFile.inputFileName);
  const fileChoices = reviewableFiles.map((entry) => ({
    source: entry.inputFileName,
    label: displayMasker.fileName(entry.inputFileName),
  }));
  const fileInputValue = fileQuery ?? activeFileLabel;
  const onFileInputChange = (next: string): void => {
    setFileQuery(next);
    const match = fileChoices.find((entry) => entry.label === next);
    if (match) {
      setSelectedFile(match.source);
      setFileQuery(null);
      setSelectedParticipant(null);
      setFocusedDate(null);
    }
  };

  return (
    <section className="timeline-view review-view" aria-label="Review" data-testid="timeline-view">
      <div className="timeline-view__toolbar review-view__toolbar">
        <div className="timeline-view__controls review-view__controls">
          <label className="timeline-view__field timeline-view__field--file">
            <span>File</span>
            <Combobox
              testId="timeline-view-file"
              value={fileInputValue}
              onChange={onFileInputChange}
              options={fileChoices.map((entry) => entry.label)}
              placeholder="Search files"
              ariaLabel="Review file"
              maxResults={50}
              selectOnFocus
            />
          </label>
          <label className="timeline-view__field">
            <span>View</span>
            <select
              data-testid="timeline-view-type"
              value={activeType}
              onChange={(event) => setSelectedType(event.target.value as ViewType)}
              disabled={availableTypes.length === 0}
            >
              {availableTypes.map((type) => (
                <option key={type} value={type}>
                  {typeLabel[type]}
                </option>
              ))}
            </select>
          </label>
          {activeType === "app" ? (
            <label className="timeline-view__field timeline-view__field--toggle">
              <span>Filtered usage</span>
              <span className="timeline-view__toggle">
                <input
                  type="checkbox"
                  data-testid="timeline-view-filtered-toggle"
                  checked={showFilteredUsage}
                  onChange={(event) => setShowFilteredUsage(event.target.checked)}
                />
                <span>{showFilteredUsage ? "Shown" : "Hidden"}</span>
              </span>
            </label>
          ) : null}
          <div className="review-view__subtabs" role="tablist" aria-label="Review view">
            <button
              type="button"
              className={`review-view__subtab${subView === "timeline" ? " is-active" : ""}`}
              onClick={() => setSubView("timeline")}
              data-testid="review-subtab-timeline"
            >
              TIMELINE
            </button>
            <button
              type="button"
              className={`review-view__subtab${subView === "applists" ? " is-active" : ""}`}
              onClick={() => setSubView("applists")}
              data-testid="review-subtab-applists"
            >
              APP LISTS
            </button>
          </div>
        </div>
        <p className="timeline-view__hint">{HINT}</p>
      </div>

      {subView === "applists" ? (
        <AppListsPanel />
      ) : (
        <div className="review-view__body">
          <ReviewParticipantRail
            participants={participants}
            selectedId={activeParticipant.participantId}
            onSelect={(id) => {
              setSelectedParticipant(id);
              setFocusedDate(null);
            }}
            masker={displayMasker}
          />
          <div className="review-view__center">
            {view ? (
              <InteractiveScene key={participantKey} view={view} context={contextLine} />
            ) : (
              <p className="timeline-view__empty">
                No {typeLabel[activeType].toLowerCase()} timeline for this participant.
              </p>
            )}
            <ReviewSettingsSummary
              options={options}
              result={activeFile}
              masker={displayMasker}
            />
          </div>
          <ReviewMetricsPanel
            participant={activeParticipant}
            focusedDate={focusedDate}
            onFocusDate={(date) => setFocusedDate((current) => (current === date ? null : date))}
            masker={displayMasker}
          />
        </div>
      )}
    </section>
  );
}
