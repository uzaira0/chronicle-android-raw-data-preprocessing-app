import { useState } from "react";
import type { ReactElement } from "react";

import type { DemoDisplayMasker } from "@/lib/demoDisplay";
import type { ReviewParticipantSummary } from "@/lib/types";

type Props = {
  participants: ReviewParticipantSummary[];
  selectedId: string | null;
  onSelect: (participantId: string) => void;
  masker: DemoDisplayMasker;
};

function fmtMin(value: number): string {
  return Math.abs(value) >= 100 ? `${value.toFixed(0)}m` : `${value.toFixed(1)}m`;
}

/** Left-rail participant navigator: live search plus a scrollable list, one row
 * per participant with its total app-usage minutes and gap-day count. */
export function ReviewParticipantRail({
  participants,
  selectedId,
  onSelect,
  masker,
}: Props): ReactElement {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = participants.filter((p) =>
    q ? masker.participantId(p.participantId).toLowerCase().includes(q) : true,
  );

  return (
    <aside className="review-rail" aria-label="Participants" data-testid="review-rail">
      <div className="review-rail__head">
        <input
          type="search"
          className="input review-rail__search"
          placeholder="search participants…"
          aria-label="Search participants"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          data-testid="review-rail-search"
        />
      </div>
      <div className="review-rail__list">
        {visible.length === 0 ? (
          <p className="review-rail__empty">No participants match.</p>
        ) : (
          visible.map((p) => {
            const gapDays = p.totals.totalDays - p.totals.daysWithUsage;
            return (
              <button
                type="button"
                key={p.participantId}
                className={`review-rail__row${p.participantId === selectedId ? " is-selected" : ""}`}
                onClick={() => onSelect(p.participantId)}
                data-testid="review-rail-row"
              >
                <span className="review-rail__pid">{masker.participantId(p.participantId)}</span>
                {gapDays > 0 ? (
                  <span className="review-rail__gap" title={`${gapDays} gap day(s)`}>
                    {gapDays}⌀
                  </span>
                ) : null}
                <span className="review-rail__min">{fmtMin(p.totals.appUsageMinutes)}</span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
