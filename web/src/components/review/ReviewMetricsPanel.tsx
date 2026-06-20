import type { ReactElement } from "react";

import { CATEGORY_COLORS } from "@/lib/plotGenerator";
import type { DemoDisplayMasker } from "@/lib/demoDisplay";
import type { ReviewParticipantSummary } from "@/lib/types";

type Props = {
  participant: ReviewParticipantSummary;
  focusedDate: string | null;
  onFocusDate: (date: string) => void;
  masker: DemoDisplayMasker;
};

/** Minutes display: integers past 100, one decimal below (matches the reference). */
function fmtMin(value: number): string {
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function categoryColor(category: string | null): string {
  return CATEGORY_COLORS[category ?? "Unknown"] ?? CATEGORY_COLORS.Uncategorised ?? "#555555";
}

/** Right-rail metrics for one participant: a run-totals card, a per-day table,
 * and (when a day is focused) its top-apps breakdown. */
export function ReviewMetricsPanel({
  participant,
  focusedDate,
  onFocusDate,
  masker,
}: Props): ReactElement {
  const t = participant.totals;
  const rows: Array<[string, string]> = [
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

  const topApps = focusedDate ? participant.topAppsByDate[focusedDate] : undefined;

  return (
    <aside className="review-metrics" aria-label="Run metrics" data-testid="review-metrics">
      <div className="review-mcard review-mcard--a">
        <h3>Run totals</h3>
        <div className="review-mrows">
          {rows.map(([label, value]) => (
            <div className="review-mrow" key={label}>
              <span className="review-mrow__label">{label}</span>
              <span className="review-mrow__value">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="review-day-table-wrap">
        <table className="review-day-table" data-testid="review-day-table">
          <thead>
            <tr>
              <th>DAY</th>
              <th>APP</th>
              <th>SCRN</th>
              <th>SESS</th>
            </tr>
          </thead>
          <tbody>
            {participant.perDay.map((day) => {
              const isGap = day.flags.includes("no_usage_day");
              return (
                <tr
                  key={day.date}
                  className={
                    (focusedDate === day.date ? "is-focused " : "") + (isGap ? "is-gap" : "")
                  }
                  onClick={() => onFocusDate(day.date)}
                >
                  <td>{masker.text(day.date).slice(5)}</td>
                  <td>{fmtMin(day.appUsageMinutes)}</td>
                  <td>{day.screenUsageMinutes > 0 ? fmtMin(day.screenUsageMinutes) : "—"}</td>
                  <td>{day.appSessionCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {focusedDate ? (
        <div className="review-day-detail" data-testid="review-day-detail">
          <h4>{masker.text(focusedDate)}</h4>
          {topApps && topApps.length > 0 ? (
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
}
