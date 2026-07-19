import type { CanonicalRow } from "@/lib/browserPipeline";
import { APP_USAGE, NON_TARGET, classifyAttribution } from "@/lib/stages/attributePerson";

/**
 * Per-day compliance scoring (Analyze tier).
 *
 * Faithful port of the consuming pipeline's compliance layer
 * (docs/pipeline-graph/03-port-semantics.md §5):
 *   compliance = known / (known + unknown) × 100 per (participant, day),
 * where known = target-child + other attributed minutes and unknown =
 * unattributed ("None"/empty). Non-shared devices are 100 by definition.
 * A day with zero real usage stays at 100 but is FLAGGED (glance-only),
 * never silently counted as a perfect day.
 */

export interface ComplianceDay {
  participantId: string;
  date: string;
  sharingStatus: "Shared" | "Non-Shared";
  knownMinutes: number;
  unknownMinutes: number;
  compliancePercent: number;
  zeroRealUsage: boolean;
  isValid: boolean;
}

export interface ComplianceResult {
  days: ComplianceDay[];
  validDays: number;
  invalidDays: number;
  zeroUsageDays: number;
}

export function scoreCompliance(
  rows: readonly CanonicalRow[],
  sharedParticipants: ReadonlySet<string>,
  thresholdPercent: number,
): ComplianceResult {
  interface Bucket {
    known: number;
    unknown: number;
  }
  const buckets = new Map<string, Bucket>();
  const participantsSeen = new Map<string, Set<string>>(); // pid -> dates with ANY row

  for (const row of rows) {
    let dates = participantsSeen.get(row.participant_id);
    if (!dates) {
      dates = new Set();
      participantsSeen.set(row.participant_id, dates);
    }
    dates.add(row.date);

    if (row.interaction_type !== APP_USAGE && row.interaction_type !== NON_TARGET) continue;
    const minutes = row.duration_minutes ?? 0;

    const key = `${row.participant_id} ${row.date}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { known: 0, unknown: 0 };
      buckets.set(key, bucket);
    }
    // Attribution status is decided ONCE in attributePerson; consume it here
    // rather than re-deriving from username substrings. Only genuinely
    // unresolved usage ("None"/blank) is "unknown"; target child and "Other"
    // are both attributed = known.
    if (classifyAttribution(row.username) === "unresolved") bucket.unknown += minutes;
    else bucket.known += minutes;
  }

  const days: ComplianceDay[] = [];
  for (const [pid, dates] of participantsSeen) {
    const shared = sharedParticipants.has(pid);
    for (const date of [...dates].sort()) {
      const bucket = buckets.get(`${pid} ${date}`) ?? { known: 0, unknown: 0 };
      const total = bucket.known + bucket.unknown;
      const compliance = !shared
        ? 100
        : total <= 0
          ? 100
          : Math.round((bucket.known / total) * 10_000) / 100;
      days.push({
        participantId: pid,
        date,
        sharingStatus: shared ? "Shared" : "Non-Shared",
        knownMinutes: Math.round(bucket.known * 100) / 100,
        unknownMinutes: Math.round(bucket.unknown * 100) / 100,
        compliancePercent: compliance,
        zeroRealUsage: total <= 0,
        isValid: compliance >= thresholdPercent,
      });
    }
  }
  days.sort((a, b) =>
    a.participantId === b.participantId
      ? a.date.localeCompare(b.date)
      : a.participantId.localeCompare(b.participantId),
  );

  return {
    days,
    validDays: days.filter((day) => day.isValid).length,
    invalidDays: days.filter((day) => !day.isValid).length,
    zeroUsageDays: days.filter((day) => day.zeroRealUsage).length,
  };
}
