import type { CanonicalRow } from "@/lib/browserPipeline";
import { deviceNumber, numericalId, type StudyWindow } from "@/lib/stages/studySupportFiles";

/**
 * Observation-window filtering (Analyze tier).
 *
 * Keeps rows whose LOCAL calendar date (the row's `date` column, already
 * derived in the row's own timezone) falls inside the participant's
 * [start, end] study window, inclusive. Participants with no window are
 * KEPT and reported — silently dropping a whole participant is the
 * fail-silent failure mode this port exists to avoid.
 */

export interface ObservationWindowResult {
  rows: CanonicalRow[];
  droppedRows: number;
  participantsWithoutWindow: string[];
}

/** Exact participant match first, then numerical id (windows are per person, devices share them). */
export function windowFor(
  participantId: string,
  windows: readonly StudyWindow[],
): StudyWindow | null {
  const exact = windows.find((window) => window.participantId === participantId);
  if (exact) return exact;
  const numerical = numericalId(participantId);
  if (!numerical) return null;
  return windows.find((window) => numericalId(window.participantId) === numerical) ?? null;
}

/**
 * Resolve each participant seen in the rows to their study window (or null),
 * in first-appearance order. Empty when no windows are configured.
 */
export function resolveParticipantWindows(
  rows: readonly CanonicalRow[],
  windows: readonly StudyWindow[],
): Map<string, StudyWindow | null> {
  const cache = new Map<string, StudyWindow | null>();
  if (windows.length === 0) return cache;
  for (const row of rows) {
    if (!cache.has(row.participant_id)) {
      cache.set(row.participant_id, windowFor(row.participant_id, windows));
    }
  }
  return cache;
}

/**
 * Keep rows whose local date falls inside their participant's window;
 * participants without a window are kept whole and reported.
 */
export function applyWindowFilter(
  rows: readonly CanonicalRow[],
  windows: readonly StudyWindow[],
  cache: ReadonlyMap<string, StudyWindow | null>,
): ObservationWindowResult {
  if (windows.length === 0) {
    return {
      rows: [...rows],
      droppedRows: 0,
      participantsWithoutWindow: [...new Set(rows.map((row) => row.participant_id))],
    };
  }
  const kept: CanonicalRow[] = [];
  let dropped = 0;
  const noWindow = new Set<string>();
  for (const row of rows) {
    const window = cache.get(row.participant_id) ?? null;
    if (window === null) {
      noWindow.add(row.participant_id);
      kept.push(row);
      continue;
    }
    if (row.date >= window.startDate && row.date <= window.endDate) {
      kept.push(row);
    } else {
      dropped += 1;
    }
  }
  return { rows: kept, droppedRows: dropped, participantsWithoutWindow: [...noWindow].sort() };
}

export function applyObservationWindow(
  rows: readonly CanonicalRow[],
  windows: readonly StudyWindow[],
): ObservationWindowResult {
  return applyWindowFilter(rows, windows, resolveParticipantWindows(rows, windows));
}

/** All ISO dates of a window, inclusive (UTC-midnight arithmetic on date-only values). */
export function windowDates(window: StudyWindow): string[] {
  const out: string[] = [];
  const start = Date.parse(`${window.startDate}T00:00:00Z`);
  const end = Date.parse(`${window.endDate}T00:00:00Z`);
  for (let t = start; t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export { deviceNumber, numericalId };
