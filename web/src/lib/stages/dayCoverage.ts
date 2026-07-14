import type { CanonicalRow } from "@/lib/browserPipeline";
import { windowDates, windowFor } from "@/lib/stages/observationWindow";
import type { StudyWindow } from "@/lib/stages/studySupportFiles";

/**
 * Day-coverage accounting (Analyze tier).
 *
 * For every (participant, study-day) distinguish:
 *   "usage"       — ≥1 App Usage row with positive duration that day
 *   "no_activity" — the device logged raw events that day but produced no usage
 *   "no_data"     — the device was silent all day
 *
 * When study windows are loaded the day spine is the participant's window;
 * otherwise it is the participant's own observed data range. The coverage
 * invariant is a HARD ERROR: every spine day must end with a status —
 * a silently dropped day is the failure mode this exists to prevent.
 */

export type CoverageStatus = "usage" | "no_activity" | "no_data";

export interface CoverageDay {
  participantId: string;
  date: string;
  status: CoverageStatus;
}

export interface DayCoverageResult {
  coverage: CoverageDay[];
  usageDays: number;
  noActivityDays: number;
  noDataDays: number;
}

export class CoverageInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoverageInvariantError";
  }
}

function dateRange(dates: ReadonlySet<string>): string[] {
  if (dates.size === 0) return [];
  const sorted = [...dates].sort();
  const start = Date.parse(`${sorted[0]}T00:00:00Z`);
  const end = Date.parse(`${sorted[sorted.length - 1]}T00:00:00Z`);
  const out: string[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function buildDayCoverage(
  usageRows: readonly CanonicalRow[],
  rawEventDatesByParticipant: ReadonlyMap<string, ReadonlySet<string>>,
  windows: readonly StudyWindow[],
): DayCoverageResult {
  const usageDates = new Map<string, Set<string>>();
  for (const row of usageRows) {
    if (row.interaction_type !== "App Usage") continue;
    if (row.duration_minutes === null || row.duration_minutes <= 0) continue;
    let set = usageDates.get(row.participant_id);
    if (!set) {
      set = new Set();
      usageDates.set(row.participant_id, set);
    }
    set.add(row.date);
  }

  const participants = new Set<string>([
    ...usageDates.keys(),
    ...rawEventDatesByParticipant.keys(),
  ]);

  const coverage: CoverageDay[] = [];
  for (const pid of [...participants].sort()) {
    const raw = rawEventDatesByParticipant.get(pid) ?? new Set<string>();
    const used = usageDates.get(pid) ?? new Set<string>();
    const window = windows.length > 0 ? windowFor(pid, windows) : null;
    const spine = window ? windowDates(window) : dateRange(new Set([...raw, ...used]));
    for (const date of spine) {
      const status: CoverageStatus = used.has(date)
        ? "usage"
        : raw.has(date)
          ? "no_activity"
          : "no_data";
      coverage.push({ participantId: pid, date, status });
    }
    // Coverage invariant: the spine must cover every day that has data.
    for (const date of [...used, ...raw]) {
      if (window && (date < window.startDate || date > window.endDate)) continue; // windowed out
      if (!spine.includes(date)) {
        throw new CoverageInvariantError(
          `Day coverage: ${pid} has data on ${date} but the day spine does not cover it.`,
        );
      }
    }
  }

  return {
    coverage,
    usageDays: coverage.filter((day) => day.status === "usage").length,
    noActivityDays: coverage.filter((day) => day.status === "no_activity").length,
    noDataDays: coverage.filter((day) => day.status === "no_data").length,
  };
}
