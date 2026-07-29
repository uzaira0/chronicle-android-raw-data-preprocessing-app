import { memo, useEffect, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { CATEGORY_COLORS } from "@/lib/plotGenerator";
import type { DemoDisplayMasker } from "@/lib/demoDisplay";
import type { ReviewDayMetrics, ReviewParticipantSummary, ReviewTopApp } from "@/lib/types";

/** One app's A→B change on a focused day: the per-app delta breakdown. */
type AppDelta = {
  pkg: string;
  label: string;
  category: string | null;
  aMin: number;
  bMin: number;
  delta: number;
};

/** Diff a day's per-app minutes between arm A and arm B by package, so the
 * focused-day detail can show which apps actually drove the A→B difference. */
function buildAppDeltas(aApps?: ReviewTopApp[], bApps?: ReviewTopApp[]): AppDelta[] {
  const map = new Map<string, AppDelta>();
  for (const app of aApps ?? []) {
    map.set(app.appPackageName, {
      pkg: app.appPackageName,
      label: app.applicationLabel || app.appPackageName,
      category: app.category,
      aMin: app.minutes,
      bMin: 0,
      delta: 0,
    });
  }
  for (const app of bApps ?? []) {
    const existing = map.get(app.appPackageName);
    if (existing) {
      existing.bMin = app.minutes;
      if (!existing.label) existing.label = app.applicationLabel || app.appPackageName;
      if (existing.category == null) existing.category = app.category;
    } else {
      map.set(app.appPackageName, {
        pkg: app.appPackageName,
        label: app.applicationLabel || app.appPackageName,
        category: app.category,
        aMin: 0,
        bMin: app.minutes,
        delta: 0,
      });
    }
  }
  return [...map.values()]
    .map((entry) => ({ ...entry, delta: entry.bMin - entry.aMin }))
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || right.bMin - left.bMin);
}

type Props = {
  participant: ReviewParticipantSummary;
  compare?: ReviewParticipantSummary | null;
  /** Which usage the compare table's A/B/Δ reflect — matches the waterfall Δ strip. */
  activeType?: "app" | "screen";
  focusedDate: string | null;
  onFocusDate: (date: string) => void;
  masker: DemoDisplayMasker;
};

/** Minutes display: integers past 100, one decimal below (matches the reference). */
function fmtMin(value: number): string {
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
}

/** The day's usage minutes for the active view type — keeps the compare table in
 * lockstep with the waterfall Δ strip (which also switches on view type). */
function minutesFor(day: ReviewDayMetrics, type: "app" | "screen"): number {
  return type === "screen" ? day.screenUsageMinutes : day.appUsageMinutes;
}

function fmtDelta(value: number): string {
  const formatted = fmtMin(Math.abs(value));
  return value > 0 ? `+${formatted}` : value < 0 ? `−${formatted}` : "0";
}

function deltaClass(value: number): string {
  return value > 0.05 ? "is-pos" : value < -0.05 ? "is-neg" : "";
}

function categoryColor(category: string | null): string {
  return CATEGORY_COLORS[category ?? "Unknown"] ?? CATEGORY_COLORS.Uncategorised ?? "#555555";
}

/** Day-cell label: when demo masking is off, masker.text is identity so trim the
 * year to a compact MM-DD; when on, the masked token is shown whole (slicing it
 * would expose the sequential ordering it exists to hide). Mirrors
 * ViewPanel.formatRowDate. */
function formatDayLabel(masker: DemoDisplayMasker, iso: string): string {
  const masked = masker.text(iso);
  return masked === iso ? (iso.length >= 5 ? iso.slice(5) : iso) : masked;
}

function totalsRows(p: ReviewParticipantSummary): Array<[string, string]> {
  const t = p.totals;
  return [
    ["app usage min", fmtMin(t.appUsageMinutes)],
    ...(t.backgroundAppUsageMinutes > 0
      ? ([["background app min", fmtMin(t.backgroundAppUsageMinutes)]] as Array<[string, string]>)
      : []),
    ...(t.screenUsageMinutes > 0
      ? ([["screen usage min", fmtMin(t.screenUsageMinutes)]] as Array<[string, string]>)
      : []),
    ["app sessions", String(t.appSessionCount)],
    ...(t.screenSessionCount > 0
      ? ([["screen sessions", String(t.screenSessionCount)]] as Array<[string, string]>)
      : []),
    ["days w/ usage", `${t.daysWithUsage}/${t.totalDays}`],
  ];
}

/** Right-rail metrics for one participant: run-totals card (plus B + Δ cards when
 * comparing), a per-day table, and the focused day's top-apps breakdown. */
export const ReviewMetricsPanel = memo(function ReviewMetricsPanel({
  participant,
  compare,
  activeType = "app",
  focusedDate,
  onFocusDate,
  masker,
}: Props): ReactElement {
  const comparing = !!compare;
  const aByDate = useMemo(
    () => new Map(participant.perDay.map((day) => [day.date, day])),
    [participant.perDay],
  );
  const bByDate = useMemo(
    () => new Map((compare?.perDay ?? []).map((day) => [day.date, day])),
    [compare?.perDay],
  );
  // Union of both arms' dates so a day present only in arm B (which the waterfall
  // shows) still gets a table row instead of silently vanishing.
  const compareDates = useMemo(
    () =>
      comparing
        ? [...new Set([...aByDate.keys(), ...bByDate.keys()])].sort()
        : [],
    [aByDate, bByDate, comparing],
  );
  const tableDates = useMemo(
    () =>
      comparing
        ? compareDates
        : participant.perDay.map((day) => day.date),
    [compareDates, comparing, participant.perDay],
  );
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: tableDates.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 24,
    overscan: 8,
    getItemKey: (index) => tableDates[index] ?? index,
  });
  const shouldVirtualize = tableDates.length > 100;
  const virtualRows = shouldVirtualize
    ? rowVirtualizer.getVirtualItems()
    : tableDates.map((_, index) => ({
        index,
        key: tableDates[index],
        start: index * 24,
        end: (index + 1) * 24,
        size: 24,
        lane: 0,
      }));
  const paddingTop = shouldVirtualize && virtualRows.length
    ? virtualRows[0].start
    : 0;
  const paddingBottom = shouldVirtualize && virtualRows.length
    ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
    : 0;

  useEffect(() => {
    if (!focusedDate || !shouldVirtualize) return;
    const index = tableDates.indexOf(focusedDate);
    if (index >= 0) rowVirtualizer.scrollToIndex(index, { align: "auto" });
  }, [focusedDate, rowVirtualizer, shouldVirtualize, tableDates]);
  const topApps = focusedDate ? participant.topAppsByDate[focusedDate] : undefined;
  // When comparing, diff the focused day's apps A↔B so the detail panel can show
  // which apps drove the change (the per-app delta breakdown).
  const focusedAppDeltas =
    comparing && focusedDate
      ? buildAppDeltas(
          participant.topAppsByDate[focusedDate],
          compare?.topAppsByDate[focusedDate],
        )
      : null;

  const deltaTotals = compare
    ? {
        appUsageMinutes: compare.totals.appUsageMinutes - participant.totals.appUsageMinutes,
        appSessionCount: compare.totals.appSessionCount - participant.totals.appSessionCount,
        screenUsageMinutes:
          compare.totals.screenUsageMinutes - participant.totals.screenUsageMinutes,
      }
    : null;

  return (
    <aside className="review-metrics" aria-label="Run metrics" data-testid="review-metrics">
      <div className="review-mcard review-mcard--a">
        <h3>{comparing ? "A — current run" : "Run totals"}</h3>
        <div className="review-mrows">
          {totalsRows(participant).map(([label, value]) => (
            <div className="review-mrow" key={label}>
              <span className="review-mrow__label">{label}</span>
              <span className="review-mrow__value">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {compare ? (
        <div className="review-mcard review-mcard--b" data-testid="review-mcard-b">
          <h3>B — compared run</h3>
          <div className="review-mrows">
            {totalsRows(compare).map(([label, value]) => (
              <div className="review-mrow" key={label}>
                <span className="review-mrow__label">{label}</span>
                <span className="review-mrow__value">{value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {deltaTotals ? (
        <div className="review-mcard review-mcard--d" data-testid="review-mcard-delta">
          <h3>Δ (B − A)</h3>
          <div className="review-mrows">
            {(
              [
                ["app usage min", deltaTotals.appUsageMinutes],
                ["app sessions", deltaTotals.appSessionCount],
                ...(participant.totals.screenUsageMinutes > 0 ||
                (compare?.totals.screenUsageMinutes ?? 0) > 0
                  ? ([["screen usage min", deltaTotals.screenUsageMinutes]] as Array<
                      [string, number]
                    >)
                  : []),
              ] as Array<[string, number]>
            ).map(([label, value]) => (
              <div className="review-mrow" key={label}>
                <span className="review-mrow__label">{label}</span>
                <span className={`review-mrow__value ${deltaClass(value)}`}>{fmtDelta(value)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="review-day-table-wrap" ref={tableScrollRef}>
        <table
          className="review-day-table"
          data-testid="review-day-table"
          data-total-rows={tableDates.length}
          data-rendered-rows={virtualRows.length}
        >
          <thead>
            <tr>
              <th>DAY</th>
              {comparing ? (
                <>
                  <th>A</th>
                  <th>B</th>
                  <th>Δ</th>
                </>
              ) : (
                <>
                  <th>APP</th>
                  <th>SCRN</th>
                  <th>SESS</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 ? (
              <tr className="review-day-table__spacer" aria-hidden="true">
                <td colSpan={4} style={{ height: paddingTop }} />
              </tr>
            ) : null}
            {virtualRows.map((virtualRow) => {
              const date = tableDates[virtualRow.index];
              if (comparing) {
                  const a = aByDate.get(date);
                  const b = bByDate.get(date);
                  const aMin = a ? minutesFor(a, activeType) : 0;
                  const bMin = b ? minutesFor(b, activeType) : 0;
                  const delta = bMin - aMin;
                  const isGap = a?.flags.includes("no_usage_day") ?? false;
                  const rowClass =
                    (focusedDate === date ? "is-focused " : "") + (isGap ? "is-gap" : "");
                  return (
                    <tr key={date} className={rowClass} onClick={() => onFocusDate(date)}>
                      <td>{formatDayLabel(masker, date)}</td>
                      <td>{fmtMin(aMin)}</td>
                      <td>{fmtMin(bMin)}</td>
                      <td className={deltaClass(delta)}>{fmtDelta(delta)}</td>
                    </tr>
                  );
              }
              const day = participant.perDay[virtualRow.index];
                  const isGap = day.flags.includes("no_usage_day");
                  const rowClass =
                    (focusedDate === day.date ? "is-focused " : "") + (isGap ? "is-gap" : "");
                  return (
                    <tr key={day.date} className={rowClass} onClick={() => onFocusDate(day.date)}>
                      <td>{formatDayLabel(masker, day.date)}</td>
                      <td>{fmtMin(day.appUsageMinutes)}</td>
                      <td>{day.screenUsageMinutes > 0 ? fmtMin(day.screenUsageMinutes) : "—"}</td>
                      <td>{day.appSessionCount}</td>
                    </tr>
                  );
            })}
            {paddingBottom > 0 ? (
              <tr className="review-day-table__spacer" aria-hidden="true">
                <td colSpan={4} style={{ height: paddingBottom }} />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {focusedDate ? (
        <div className="review-day-detail" data-testid="review-day-detail">
          <h4>{masker.text(focusedDate)}</h4>
          {comparing ? (
            <>
              <p className="review-day-detail__sub">Per-app change (A → B)</p>
              {focusedAppDeltas && focusedAppDeltas.length > 0 ? (
                <div data-testid="review-app-deltas">
                  {focusedAppDeltas.map((entry) => (
                    <div className="review-app-line" key={entry.pkg}>
                      <span className="review-app-line__name">
                        <span
                          className="review-app-line__swatch"
                          style={{ background: categoryColor(entry.category) }}
                        />
                        {masker.text(entry.label)}
                      </span>
                      <span className="review-app-line__delta">
                        <span className="review-app-line__ab">
                          {fmtMin(entry.aMin)}→{fmtMin(entry.bMin)}m
                        </span>
                        <span className={`review-app-line__min ${deltaClass(entry.delta)}`}>
                          {fmtDelta(entry.delta)}m
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="review-app-line">
                  <span className="review-app-line__name">no app activity either run</span>
                </div>
              )}
            </>
          ) : topApps && topApps.length > 0 ? (
            topApps.map((app) => (
              <div className="review-app-line" key={app.appPackageName}>
                <span className="review-app-line__name">
                  <span
                    className="review-app-line__swatch"
                    style={{ background: categoryColor(app.category) }}
                  />
                  {masker.text(app.applicationLabel || app.appPackageName)}
                </span>
                <span className="review-app-line__min">{fmtMin(app.minutes)}m</span>
              </div>
            ))
          ) : (
            <div className="review-app-line">
              <span className="review-app-line__name">no sessions</span>
            </div>
          )}
        </div>
      ) : null}
    </aside>
  );
});
