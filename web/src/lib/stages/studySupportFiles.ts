/**
 * Parsers for the Analyze-tier Study Inputs support files.
 *
 * All parsers take header-mapped SupportRows (the same shape the existing
 * support-file loader produces for CSV and XLSX) and FAIL LOUD on missing
 * required columns — a support file that parses to nothing silently would
 * mislabel everything downstream.
 */

export type SupportRows = Array<Record<string, string>>;

export interface StudyWindow {
  participantId: string;
  /** ISO local calendar dates, inclusive. */
  startDate: string;
  endDate: string;
}

export type SharingStatus = "Shared" | "Non-Shared";

export interface SharingEntry {
  participantId: string;
  status: SharingStatus;
}

export interface SurveyAnswer {
  participantId: string;
  eventTimestampNs: bigint;
  /** Raw survey answer; attribution appends " (From Survey)". */
  user: string;
}

export interface EnrolledDevice {
  participantId: string;
  deviceCount: number;
}

function headerLookup(rows: SupportRows, wanted: string[]): Record<string, string> {
  const available = rows.length > 0 ? Object.keys(rows[0]) : [];
  const map: Record<string, string> = {};
  for (const name of wanted) {
    const found = available.find((column) => column.trim().toLowerCase() === name);
    if (found !== undefined) map[name] = found;
  }
  return map;
}

function requireColumns(fileLabel: string, rows: SupportRows, required: string[]): Record<string, string> {
  const map = headerLookup(rows, required);
  const missing = required.filter((name) => !(name in map));
  if (missing.length > 0) {
    const available = rows.length > 0 ? Object.keys(rows[0]).join(", ") : "(no rows)";
    throw new Error(
      `${fileLabel}: missing required column(s) ${missing.join(", ")}. Found: ${available}`,
    );
  }
  return map;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

function normalizeDate(fileLabel: string, value: string): string {
  const match = ISO_DATE.exec(value.trim());
  if (!match) {
    // Accept M/D/YYYY (sheet exports) as a convenience.
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
    if (us) {
      return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
    }
    throw new Error(`${fileLabel}: unparseable date "${value}" (expected YYYY-MM-DD)`);
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseStudyDates(rows: SupportRows): StudyWindow[] {
  const col = requireColumns("Study dates file", rows, ["participant_id", "start_date", "end_date"]);
  const out: StudyWindow[] = [];
  for (const row of rows) {
    const pid = (row[col.participant_id] ?? "").trim();
    if (!pid) continue;
    const startDate = normalizeDate("Study dates file", row[col.start_date] ?? "");
    const endDate = normalizeDate("Study dates file", row[col.end_date] ?? "");
    if (endDate < startDate) {
      throw new Error(
        `Study dates file: window for ${pid} ends (${endDate}) before it starts (${startDate})`,
      );
    }
    out.push({ participantId: pid, startDate, endDate });
  }
  return out;
}

export function parseDeviceSharing(rows: SupportRows): SharingEntry[] {
  const col = requireColumns("Device sharing file", rows, ["participant_id", "sharing_status"]);
  const out: SharingEntry[] = [];
  for (const row of rows) {
    const pid = (row[col.participant_id] ?? "").trim();
    if (!pid) continue;
    const raw = (row[col.sharing_status] ?? "").trim().toLowerCase();
    let status: SharingStatus;
    if (raw === "shared") status = "Shared";
    else if (raw === "non-shared" || raw === "nonshared" || raw === "not shared") status = "Non-Shared";
    else {
      throw new Error(
        `Device sharing file: unknown sharing_status "${row[col.sharing_status]}" for ${pid} ` +
          '(expected "Shared" or "Non-Shared")',
      );
    }
    out.push({ participantId: pid, status });
  }
  return out;
}

function parseTimestampNs(fileLabel: string, value: string): bigint {
  const text = value.trim();
  if (/^\d{10,}$/.test(text)) {
    // Epoch: seconds (10), millis (13), or already nanos (19).
    if (text.length >= 19) return BigInt(text);
    if (text.length >= 13) return BigInt(text) * 1_000_000n;
    return BigInt(text) * 1_000_000_000n;
  }
  const isoish = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(" ", "T")}Z`;
  const ms = Date.parse(isoish);
  if (Number.isNaN(ms)) {
    throw new Error(`${fileLabel}: unparseable event_timestamp "${value}"`);
  }
  return BigInt(ms) * 1_000_000n;
}

export function parseSurveyAttribution(rows: SupportRows): SurveyAnswer[] {
  const col = requireColumns("Survey attribution file", rows, [
    "participant_id",
    "event_timestamp",
    "users",
  ]);
  const out: SurveyAnswer[] = [];
  for (const row of rows) {
    const pid = (row[col.participant_id] ?? "").trim();
    const rawTs = (row[col.event_timestamp] ?? "").trim();
    const user = (row[col.users] ?? "").trim().replace(/^[{"]+|[}"]+$/g, "");
    if (!pid || !rawTs || !user) continue;
    out.push({
      participantId: pid,
      eventTimestampNs: parseTimestampNs("Survey attribution file", rawTs),
      user,
    });
  }
  return out;
}

export function parseEnrolledDevices(rows: SupportRows): EnrolledDevice[] {
  const col = requireColumns("Enrolled devices file", rows, ["participant_id", "device_count"]);
  const out: EnrolledDevice[] = [];
  for (const row of rows) {
    const pid = (row[col.participant_id] ?? "").trim();
    if (!pid) continue;
    const count = Number((row[col.device_count] ?? "").trim());
    if (!Number.isFinite(count) || count < 0 || !Number.isInteger(count)) {
      throw new Error(
        `Enrolled devices file: invalid device_count "${row[col.device_count]}" for ${pid}`,
      );
    }
    out.push({ participantId: pid, deviceCount: count });
  }
  return out;
}

/** First run of >=3 digits — the cross-device numerical id. */
export function numericalId(participantId: string): string | null {
  const match = /(\d{3,})/.exec(participantId);
  return match ? match[1] : null;
}

/** -D<n> suffix; a bare id is device 1. */
export function deviceNumber(participantId: string): number {
  const match = /-D(\d+)/.exec(participantId);
  return match ? Number(match[1]) : 1;
}
