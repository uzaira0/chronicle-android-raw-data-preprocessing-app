import { useEffect, useState } from "react";
import type { ReactElement } from "react";

import { Combobox } from "@/components/Combobox";
import {
  InteractiveScene,
  sanitizeDemoView,
} from "@/components/review/InteractiveScene";
import { ReviewParticipantRail } from "@/components/review/ReviewParticipantRail";
import { ReviewMetricsPanel } from "@/components/review/ReviewMetricsPanel";
import { ReviewSettingsSummary } from "@/components/review/ReviewSettingsSummary";
import { AppListsPanel } from "@/components/review/AppListsPanel";
import { CompareConfigDrawer } from "@/components/review/CompareConfigDrawer";
import { buildComparisonWaterfallScene } from "@/lib/reviewCompareScene";
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
  /** Names of files still loaded in the Files tab — a comparison can only
   * re-run files whose bytes are still available. */
  uploadedFileNames?: string[];
  /** Warm the selected file while the researcher edits Arm B. */
  onPrepareComparison?: (fileName: string) => Promise<void>;
  /** Re-process every loaded review file under Arm-B options. The selected file
   * is prioritized, and completed files are reported as soon as they finish. */
  onRunComparison?: (
    fileName: string,
    overrides: Partial<BrowserProcessingOptions>,
    onResult?: (result: ProcessedFileResult) => void,
  ) => Promise<ProcessedFileResult[]>;
  displayMasker: DemoDisplayMasker;
  includeFilteredAppUsageInPlots: boolean;
};

type ViewType = "app" | "screen";
type SubView = "timeline" | "applists";

const HINT =
  "Shift scroll a row to zoom · drag zoomed rows · double click to reset";

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
): result is ProcessedFileResult & {
  reviewSummary: NonNullable<ProcessedFileResult["reviewSummary"]>;
} {
  return !!result.reviewSummary && result.reviewSummary.participants.length > 0;
}

export function ViewPanel({
  results,
  options,
  uploadedFileNames = [],
  onPrepareComparison,
  onRunComparison,
  displayMasker,
  includeFilteredAppUsageInPlots,
}: Props): ReactElement {
  const reviewableFiles = results.filter(isReviewable);

  const [selectedFile, setSelectedFile] = useState<string>("");
  const [fileQuery, setFileQuery] = useState<string | null>(null);
  const [selectedParticipant, setSelectedParticipant] = useState<string | null>(
    null,
  );
  const [selectedType, setSelectedType] = useState<ViewType>("app");
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const [subView, setSubView] = useState<SubView>("timeline");
  const [showFilteredUsage, setShowFilteredUsage] = useState(
    includeFilteredAppUsageInPlots,
  );
  // Free-text app-name filter that spotlights matching sessions across the
  // whole timeline (#20).
  const [highlightQuery, setHighlightQuery] = useState("");

  // Arm-B results cover the loaded batch. As each worker finishes, its result
  // becomes available immediately; switching files does not discard the rest.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [compareOptions, setCompareOptions] =
    useState<BrowserProcessingOptions>(options);
  const [armBResults, setArmBResults] = useState<ProcessedFileResult[]>([]);
  const [running, setRunning] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  useEffect(() => {
    setShowFilteredUsage(includeFilteredAppUsageInPlots);
  }, [includeFilteredAppUsageInPlots]);

  useEffect(() => {
    setArmBResults([]);
    setCompareOptions(options);
    setCompareError(null);
  }, [results, options]);

  if (reviewableFiles.length === 0) {
    return (
      <section
        className="timeline-view"
        aria-label="Review"
        data-testid="timeline-view"
      >
        <p className="timeline-view__empty" data-testid="timeline-view-empty">
          Nothing to review yet. Process a file and its review — participants,
          timeline, and per-day metrics — appears here.
        </p>
      </section>
    );
  }

  const activeFile =
    reviewableFiles.find((r) => r.inputFileName === selectedFile) ??
    reviewableFiles[0];
  const participants: ReviewParticipantSummary[] =
    activeFile.reviewSummary.participants;
  const activeParticipant =
    participants.find((p) => p.participantId === selectedParticipant) ??
    participants[0];

  // Reset the focused day whenever the participant or file context changes.
  const participantKey = `${activeFile.inputFileName}:${activeParticipant.participantId}`;

  const timeline = activeFile.timelineView;
  const availableTypes: ViewType[] = timeline
    ? [
        ...(hasAppViews(timeline) ? (["app"] as const) : []),
        ...(timeline.screen.length > 0 ? (["screen"] as const) : []),
      ]
    : [];
  const activeType: ViewType = availableTypes.includes(selectedType)
    ? selectedType
    : (availableTypes[0] ?? "app");

  const participantViews: TimelineParticipantView[] = !timeline
    ? []
    : activeType === "app"
      ? appViewsFor(timeline, showFilteredUsage)
      : timeline.screen;
  const rawView = participantViews.find(
    (v) => v.participantId === activeParticipant.participantId,
  );
  const view = rawView ? sanitizeDemoView(rawView, displayMasker) : null;

  // Dates the active participant had raw data but no sessions on (no_usage_day),
  // masked the same way the scene row dates are, so the timeline can band them
  // (#18). A plain const (not useMemo) since this sits after ViewPanel's early
  // return — a hook here would violate the rules-of-hooks order.
  const gapDates = new Set(
    activeParticipant.perDay
      .filter((day) => day.flags.includes("no_usage_day"))
      .map((day) => displayMasker.text(day.date)),
  );

  const typeLabel: Record<ViewType, string> = {
    app: "App usage",
    screen: "Screen usage",
  };
  const filteredUsageLabel = showFilteredUsage
    ? "Filtered usage included"
    : "Filtered usage excluded";
  const contextLine = timeline
    ? `${typeLabel[activeType]} · ${filteredUsageLabel} · ${displayMasker.timezone(timeline.timezone)}`
    : "";

  const armB =
    armBResults.find(
      (result) => result.inputFileName === activeFile.inputFileName,
    ) ?? null;
  const compareParticipant: ReviewParticipantSummary | null =
    armB?.reviewSummary?.participants.find(
      (p) => p.participantId === activeParticipant.participantId,
    ) ?? null;
  const bTimeline = armB?.timelineView;
  const bParticipantViews: TimelineParticipantView[] = !bTimeline
    ? []
    : activeType === "app"
      ? appViewsFor(bTimeline, showFilteredUsage)
      : bTimeline.screen;
  const bRawView = bParticipantViews.find(
    (v) => v.participantId === activeParticipant.participantId,
  );

  // Interleaved A/B comparison: both arms woven into one waterfall (A lane over
  // B lane per date, with a Δ strip), built from the raw views then masked — so
  // its date keys line up with the per-day metrics that drive the Δ strip.
  const perDayMinutes = (
    summary: ReviewParticipantSummary | null,
    type: ViewType,
  ): Map<string, number> => {
    const map = new Map<string, number>();
    for (const day of summary?.perDay ?? []) {
      map.set(
        day.date,
        type === "screen" ? day.screenUsageMinutes : day.appUsageMinutes,
      );
    }
    return map;
  };
  // Gutter date label that honours demo masking: in demo mode the masker
  // rewrites the ISO date to a stable token; otherwise show the compact "MM-DD".
  // (The post-build text masker can't catch a year-less "MM-DD" on its own.)
  const formatRowDate = (iso: string): string => {
    const masked = displayMasker.text(iso);
    return masked === iso ? (iso.length >= 5 ? iso.slice(5) : iso) : masked;
  };
  const comparisonView: TimelineParticipantView | null =
    armB && rawView && bRawView
      ? sanitizeDemoView(
          buildComparisonWaterfallScene(
            rawView,
            bRawView,
            perDayMinutes(activeParticipant, activeType),
            perDayMinutes(compareParticipant, activeType),
            formatRowDate,
          ),
          displayMasker,
        )
      : null;
  const compareContextLine = `A vs B · ${typeLabel[activeType]} · ${filteredUsageLabel}${
    timeline ? ` · ${displayMasker.timezone(timeline.timezone)}` : ""
  }`;

  const canCompare =
    !!onRunComparison && uploadedFileNames.includes(activeFile.inputFileName);

  const openDrawer = (): void => {
    // First open seeds Arm B from the current run (A); reopening to edit keeps
    // the last Arm-B config instead of discarding it.
    if (!armB) setCompareOptions(options);
    setCompareError(null);
    setDrawerOpen(true);
    if (onPrepareComparison) {
      void onPrepareComparison(activeFile.inputFileName).catch((error) => {
        setCompareError(error instanceof Error ? error.message : String(error));
      });
    }
  };
  const runComparison = async (): Promise<void> => {
    if (!onRunComparison) return;
    setRunning(true);
    setCompareError(null);
    setArmBResults([]);
    try {
      const replaceResult = (result: ProcessedFileResult): void => {
        setArmBResults((current) => {
          const byName = new Map(
            current.map((entry) => [entry.inputFileName, entry]),
          );
          byName.set(result.inputFileName, result);
          return Array.from(byName.values());
        });
      };
      const compared = await onRunComparison(
        activeFile.inputFileName,
        compareOptions,
        replaceResult,
      );
      setArmBResults(compared);
      setDrawerOpen(false);
    } catch (error) {
      setCompareError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };
  const resetToA = (): void => {
    setCompareOptions(options);
    setArmBResults([]);
    setCompareError(null);
  };

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
      setDrawerOpen(false);
      setCompareError(null);
    }
  };

  return (
    <section
      className="timeline-view review-view"
      aria-label="Review"
      data-testid="timeline-view"
    >
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
              onChange={(event) =>
                setSelectedType(event.target.value as ViewType)
              }
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
                  onChange={(event) =>
                    setShowFilteredUsage(event.target.checked)
                  }
                />
                <span>{showFilteredUsage ? "Shown" : "Hidden"}</span>
              </span>
            </label>
          ) : null}
          {subView === "timeline" ? (
            <label className="timeline-view__field timeline-view__field--search">
              <span>Highlight app</span>
              <input
                type="search"
                className="input"
                data-testid="timeline-highlight-input"
                placeholder="e.g. youtube"
                value={highlightQuery}
                onChange={(event) => setHighlightQuery(event.target.value)}
              />
            </label>
          ) : null}
          <div
            className="review-view__subtabs"
            role="group"
            aria-label="Review view"
          >
            <button
              type="button"
              className={`review-view__subtab${subView === "timeline" ? " is-active" : ""}`}
              aria-pressed={subView === "timeline"}
              onClick={() => setSubView("timeline")}
              data-testid="review-subtab-timeline"
            >
              TIMELINE
            </button>
            <button
              type="button"
              className={`review-view__subtab${subView === "applists" ? " is-active" : ""}`}
              aria-pressed={subView === "applists"}
              onClick={() => setSubView("applists")}
              data-testid="review-subtab-applists"
            >
              APP LISTS
            </button>
          </div>
          {onRunComparison && subView === "timeline" ? (
            <button
              type="button"
              className="btn btn--secondary review-view__compare-btn"
              onClick={() => (drawerOpen ? setDrawerOpen(false) : openDrawer())}
              disabled={!canCompare && !drawerOpen}
              title={
                canCompare
                  ? "Re-process this file under a second config and compare"
                  : "Re-add this file in the Files tab to compare"
              }
              data-testid="review-compare-toggle"
            >
              {armBResults.length ? "Edit comparison" : "Compare ▾"}
            </button>
          ) : null}
        </div>
        <p className="timeline-view__hint">{HINT}</p>
      </div>

      {subView === "timeline" && drawerOpen ? (
        <CompareConfigDrawer
          options={compareOptions}
          setOptions={setCompareOptions}
          onRun={() => void runComparison()}
          onResetToA={resetToA}
          onClose={() => setDrawerOpen(false)}
          running={running}
          error={compareError}
          completedCount={armBResults.length}
          fileCount={reviewableFiles.filter((result) =>
            uploadedFileNames.includes(result.inputFileName),
          ).length}
        />
      ) : null}

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
            {comparisonView ? (
              <div
                className="review-compare-legend"
                data-testid="review-compare-legend"
              >
                <span className="review-compare-legend__item">
                  <span className="review-compare-legend__tick review-compare-legend__tick--a" />
                  A · current run
                </span>
                <span className="review-compare-legend__item">
                  <span className="review-compare-legend__tick review-compare-legend__tick--b" />
                  B · compared run
                </span>
                <span className="review-compare-legend__item">
                  <span className="review-compare-legend__bar review-compare-legend__bar--pos" />
                  <span className="review-compare-legend__bar review-compare-legend__bar--neg" />
                  Δ usage per day (B − A)
                </span>
              </div>
            ) : null}
            {comparisonView ? (
              <InteractiveScene
                key={`${participantKey}:AB`}
                view={comparisonView}
                context={compareContextLine}
                highlightQuery={highlightQuery}
                allowExport
              />
            ) : view ? (
              <InteractiveScene
                key={participantKey}
                view={view}
                context={contextLine}
                highlightQuery={highlightQuery}
                gapDates={gapDates}
                allowExport
              />
            ) : (
              <p className="timeline-view__empty">
                No {typeLabel[activeType].toLowerCase()} timeline for this
                participant.
              </p>
            )}
            {armB && !comparisonView ? (
              <p
                className="timeline-view__empty"
                data-testid="review-compare-no-overlap"
              >
                {armB.reviewOnly
                  ? "The fast comparison updated the Δ metrics at right. Detailed B timeline geometry was not generated."
                  : `No overlapping ${typeLabel[activeType].toLowerCase()} timeline to interleave for this participant — see the Δ metrics at right.`}
              </p>
            ) : null}
            <ReviewSettingsSummary
              options={options}
              result={activeFile}
              masker={displayMasker}
            />
          </div>
          <ReviewMetricsPanel
            participant={activeParticipant}
            compare={compareParticipant}
            activeType={activeType}
            focusedDate={focusedDate}
            onFocusDate={(date) =>
              setFocusedDate((current) => (current === date ? null : date))
            }
            masker={displayMasker}
          />
        </div>
      )}
    </section>
  );
}
