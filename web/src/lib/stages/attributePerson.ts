import type { CanonicalRow } from "@/lib/browserPipeline";
import {
  deviceNumber,
  numericalId,
  type SharingEntry,
  type SurveyAnswer,
} from "@/lib/stages/studySupportFiles";

/**
 * Person attribution for shared devices (Analyze tier).
 *
 * Faithful port of the consuming pipeline's attribution layer
 * (docs/pipeline-graph/03-port-semantics.md §4):
 *  - sharing lookup: exact participant match, then numerical id + device
 *    NUMBER match (bare id = device 1). NO first-numerical fallback — that
 *    is a known wrong-attribution bug class. A configured table that
 *    misses a device is a HARD ERROR.
 *  - Non-Shared: unlabeled usage belongs to the target child.
 *  - Shared: unlabeled kids-shell usage → Target Child; other unlabeled →
 *    "None" (unknown); survey answers relabel by exact event timestamp
 *    (suffix " (From Survey)", later rows win); then any App Usage row not
 *    attributed to the target child becomes "Non-Target Child App Usage"
 *    (kept for compliance accounting, excluded from screen time).
 */

export const APP_USAGE = "App Usage";
export const NON_TARGET = "Non-Target Child App Usage";
const TARGET_RX = /target child/i;

/** Kids-mode shell apps — unlabeled shell usage is the child's usage. */
export const KIDS_SHELL_PACKAGES = new Set([
  "com.amazon.tahoe",
  "com.sencatech.iwawa.iwawahome",
  "com.google.android.apps.kids.home",
  "com.kiddoware.kidsplace",
  "com.tcl.kidsmode",
]);

export interface AttributionReport {
  sharedParticipants: string[];
  nonSharedParticipants: string[];
  surveyRelabels: number;
  nonTargetRows: number;
  kidsShellAttributions: number;
  nullUsernamesFilled: number;
}

export interface AttributionResult {
  rows: CanonicalRow[];
  report: AttributionReport;
}

function isNullName(username: string | null | undefined): boolean {
  return username == null || username === "" || username === "nan";
}

/** Attribution status of a finalized row — the compliance denominator contract. */
export type AttributionStatus = "target" | "known_non_target" | "unresolved";

/**
 * Single source of truth for classifying a finalized username into its
 * attribution status. The finalized-username vocabulary is CLOSED and produced
 * entirely by `attributePerson` above — exactly:
 *   "None", "Target Child", "Other", "Target Child (From Survey)", "Other (From Survey)"
 * (plus blank/null on rows attribution never touched). A survey answer of "None"
 * is IMPOSSIBLE: the survey only ever names the target child or "Other", which
 * arrive suffixed "(From Survey)". "None" is solely the self-assigned unresolved
 * token this module writes for unlabeled shared-device usage. Because the
 * producer emits these canonical strings, the unresolved token is matched
 * EXACTLY (`=== "None"`); the target arm stays a case-insensitive test so both
 * "Target Child" and "Target Child (From Survey)" match:
 *  - matches /target child/i (with/without survey suffix) → `target`
 *  - blank/null, or exactly "None"                        → `unresolved`
 *  - otherwise ("Other"/"Other (From Survey)")            → `known_non_target`
 *
 * `scoreCompliance` consumes this instead of re-deriving the buckets itself,
 * keeping ONE definition aligned with the ontology's `AttributionStatus`
 * (docs/pipeline-graph/13-research-ontology-design.md).
 */
export function classifyAttribution(
  username: string | null | undefined,
): AttributionStatus {
  if (username != null && TARGET_RX.test(username)) return "target";
  if (isNullName(username) || username === "None") return "unresolved";
  return "known_non_target";
}

/**
 * Sharing status for one device id. Exact → numerical+device-number.
 * Empty table → "Non-Shared" (machinery not configured). Configured table
 * with no match → throws (the sheet gap must be fixed, never defaulted).
 */
export function lookupDeviceSharing(
  participantId: string,
  sharing: readonly SharingEntry[],
): "Shared" | "Non-Shared" {
  if (sharing.length === 0) return "Non-Shared";
  const exact = sharing.find((entry) => entry.participantId === participantId);
  if (exact) return exact.status;
  const numerical = numericalId(participantId);
  if (numerical) {
    const wanted = deviceNumber(participantId);
    const match = sharing.find(
      (entry) =>
        numericalId(entry.participantId) === numerical &&
        deviceNumber(entry.participantId) === wanted,
    );
    if (match) return match.status;
  }
  throw new Error(
    `Person attribution: no device-sharing status for "${participantId}" ` +
      `(numerical=${numerical ?? "none"}). The sharing table must cover every device ` +
      "when it is configured.",
  );
}

export function attributePerson(
  rows: readonly CanonicalRow[],
  sharing: readonly SharingEntry[],
  survey: readonly SurveyAnswer[],
): AttributionResult {
  const report: AttributionReport = {
    sharedParticipants: [],
    nonSharedParticipants: [],
    surveyRelabels: 0,
    nonTargetRows: 0,
    kidsShellAttributions: 0,
    nullUsernamesFilled: 0,
  };

  const statusByPid = new Map<string, "Shared" | "Non-Shared">();
  for (const pid of new Set(rows.map((row) => row.participant_id))) {
    statusByPid.set(pid, lookupDeviceSharing(pid, sharing));
  }
  report.sharedParticipants = [...statusByPid.entries()]
    .filter(([, status]) => status === "Shared")
    .map(([pid]) => pid)
    .sort();
  report.nonSharedParticipants = [...statusByPid.entries()]
    .filter(([, status]) => status === "Non-Shared")
    .map(([pid]) => pid)
    .sort();

  // Survey lookup: (participant, exact event timestamp) → user; later rows win.
  const surveyByKey = new Map<string, string>();
  for (const answer of survey) {
    surveyByKey.set(`${answer.participantId} ${answer.eventTimestampNs}`, answer.user);
  }

  const out: CanonicalRow[] = rows.map((row) => {
    const status = statusByPid.get(row.participant_id)!;
    let username = row.username;
    let interactionType = row.interaction_type;

    if (status === "Non-Shared") {
      if (isNullName(username)) {
        username = "Target Child";
        report.nullUsernamesFilled += 1;
      }
    } else {
      if (isNullName(username)) {
        if (KIDS_SHELL_PACKAGES.has(row.app_package_name)) {
          username = "Target Child";
          report.kidsShellAttributions += 1;
        } else {
          username = "None";
        }
        report.nullUsernamesFilled += 1;
      }
      const surveyUser = surveyByKey.get(`${row.participant_id} ${row.event_timestamp_ns}`);
      if (surveyUser !== undefined) {
        username = `${surveyUser} (From Survey)`;
        report.surveyRelabels += 1;
      }
      if (interactionType === APP_USAGE && !TARGET_RX.test(username)) {
        interactionType = NON_TARGET;
        report.nonTargetRows += 1;
      }
    }

    if (username === row.username && interactionType === row.interaction_type) {
      return row;
    }
    return { ...row, username, interaction_type: interactionType };
  });

  return { rows: out, report };
}
