import { populateTimeColumns, RECIP_60, type CanonicalRow } from "@/lib/browserPipeline";

/**
 * Effective usage — the screen-gated usage credit (Clean tier).
 *
 * Port of the consuming research pipeline's screen-gated credit
 * (docs/pipeline-graph/03-port-semantics.md §1), parity-tested against
 * golden fixtures generated from the Python original on synthetic data.
 *
 * One sentence: a credited minute = screen-ON, single-app-foreground
 * exposure on a live (held-open) device, app-agnostic, truncated at the
 * credited-session cap (never zeroed).
 *
 * The credit REWRITES each engine App-Usage session into one row per
 * credited interval (start/stop/duration overridden, calendar columns
 * recomputed from the new local start). It is emitted SIDE-BY-SIDE with
 * the headline output — never in place of it.
 */

/** Events impossible with the screen off — each witnesses screen ON. */
const ON_WITNESS = new Set([
  "Screen Interactive",
  "User Interaction",
  "Shortcut Invocation",
  "Keyguard Hidden",
  "User Unlocked",
  "Chooser Action",
]);

/** Explicit lock, or power-off (credit stops AT the shutdown). */
const OFF_WITNESS = new Set(["Screen Non-Interactive", "Device Shutdown"]);

const STARTUP = "Device Startup";
const SCREEN_ON = "Screen Interactive";
const SCREEN_OFF = "Screen Non-Interactive";

/** Casing variants the canonical map does not key on. */
const CASING_FIXUPS: Record<string, string> = {
  "Screen Non-interactive": "Screen Non-Interactive",
};

const NS_PER_SECOND = 1_000_000_000n;
/** A boot lands just after the event that closes its gap. */
const BOOT_EPSILON_NS = 10n * NS_PER_SECOND;

export interface CreditOptions {
  capMinutes: number;
  livenessToleranceMinutes: number;
  autoLockBridgeSeconds: number;
  noWitnessMinDayApps: number;
}

export interface CreditReport {
  sessions: number;
  creditedRows: number;
  creditedMinutes: number;
  rawSessionMinutes: number;
  truncatedSessions: number;
  fullyDeadSessions: number;
  noWitnessFallbacks: number;
  screenIncapableParticipants: string[];
}

export interface CreditResult {
  /** Credited-interval rows first, then untouched pass-through rows. */
  creditedRows: CanonicalRow[];
  report: CreditReport;
}

type ChangePoint = { t: bigint; state: "ON" | "OFF" };
type Interval = [bigint, bigint];

interface Substrate {
  pts: Map<string, ChangePoint[]>;
  boots: Map<string, bigint[]>;
  allTs: Map<string, bigint[]>;
  capable: Set<string>;
}

function canonicalType(raw: string): string {
  const fixed = CASING_FIXUPS[raw] ?? raw;
  if (/^Unknown importance:/.test(fixed) || /^n: \d/.test(fixed)) {
    throw new Error(
      `Screen-gated credit: unmapped interaction type "${fixed}" in the raw stream — ` +
        "extend the interaction-type mapping before crediting.",
    );
  }
  return fixed;
}

/** Screen-state change points for one participant's sorted typed events. */
function changepoints(typed: Array<{ t: bigint; type: string }>): ChangePoint[] {
  const out: ChangePoint[] = [];
  let last: "ON" | "OFF" | null = null;
  for (const { t, type } of typed) {
    const state = ON_WITNESS.has(type) ? "ON" : OFF_WITNESS.has(type) ? "OFF" : null;
    if (state === null || state === last) continue;
    out.push({ t, state });
    last = state;
  }
  return out;
}

/** Index of the last element <= target (bisect_right - 1). */
function bisectRightTs(ts: readonly bigint[], target: bigint): number {
  let lo = 0;
  let hi = ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function bisectLeftTs(ts: readonly bigint[], target: bigint): number {
  let lo = 0;
  let hi = ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Forward-filled screen state at time t. */
function stateAt(pts: readonly ChangePoint[], t: bigint): "ON" | "OFF" | null {
  const ts = pts.map((p) => p.t);
  const index = bisectRightTs(ts, t) - 1;
  return index >= 0 ? pts[index]!.state : null;
}

/** (start, end, state) segments over [s, e) from forward-filled change points. */
function segments(
  pts: readonly ChangePoint[],
  s: bigint,
  e: bigint,
): Array<{ a: bigint; b: bigint; state: "ON" | "OFF" | null }> {
  const ts = pts.map((p) => p.t);
  const startIndex = bisectRightTs(ts, s) - 1;
  let state: "ON" | "OFF" | null = startIndex >= 0 ? pts[startIndex]!.state : null;
  let j = bisectRightTs(ts, s);
  let cur = s;
  const out: Array<{ a: bigint; b: bigint; state: "ON" | "OFF" | null }> = [];
  while (cur < e) {
    const next = j < ts.length ? ts[j]! : e;
    const segEnd = next < e ? next : e;
    if (segEnd > cur) out.push({ a: cur, b: segEnd, state });
    cur = segEnd;
    if (j < ts.length) {
      state = pts[j]!.state;
      j += 1;
    } else {
      break;
    }
  }
  return out;
}

/**
 * Device-alive intervals over [s, e) by the cadence chain: alive across a
 * silence iff the next event arrives within `tol`, and no Device Startup
 * lands in the gap (a boot proves the device was OFF before it). Chains
 * over events in [s-tol, e+tol] so a bracketing heartbeat just outside the
 * window counts, then clips to [s, e].
 */
function aliveIntervals(
  eventTs: readonly bigint[],
  s: bigint,
  e: bigint,
  tolNs: bigint,
  boots: readonly bigint[],
): Interval[] {
  const lo = bisectLeftTs(eventTs, s - tolNs);
  const hi = bisectRightTs(eventTs, e + tolNs);
  const win = eventTs.slice(lo, hi);
  if (win.length === 0) return [];

  const booted = (a: bigint, b: bigint): boolean => {
    const index = bisectRightTs(boots, a);
    return index < boots.length && boots[index]! <= b + BOOT_EPSILON_NS;
  };

  const spans: Interval[] = [];
  let start = win[0]!;
  let last = win[0]!;
  for (let index = 1; index < win.length; index += 1) {
    const t = win[index]!;
    if (t - last <= tolNs && !booted(last, t)) {
      last = t;
    } else {
      spans.push([start, last]);
      start = t;
      last = t;
    }
  }
  spans.push([start, last]);

  const out: Interval[] = [];
  for (const [a, b] of spans) {
    const a2 = a > s ? a : s;
    const b2 = b < e ? b : e;
    if (b2 > a2) out.push([a2, b2]);
  }
  return out;
}

/** Intersection of two sorted interval lists. */
function intersect(A: readonly Interval[], B: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    const [a0, a1] = A[i]!;
    const [b0, b1] = B[j]!;
    const lo = a0 > b0 ? a0 : b0;
    const hi = a1 < b1 ? a1 : b1;
    if (hi > lo) out.push([lo, hi]);
    if (a1 < b1) i += 1;
    else j += 1;
  }
  return out;
}

/**
 * Screen-ON intervals within [s, e): ON segments, merging across any OFF
 * shorter than the auto-lock bridge (a sub-auto-lock off cannot be the
 * auto-lock — a blip, bridged).
 */
function creditableIntervals(
  pts: readonly ChangePoint[],
  s: bigint,
  e: bigint,
  autoLockNs: bigint,
): Interval[] {
  const out: Interval[] = [];
  let cur: Interval | null = null;
  for (const seg of segments(pts, s, e)) {
    const dur = seg.b - seg.a;
    if (seg.state === "ON") {
      cur = cur === null ? [seg.a, seg.b] : [cur[0], seg.b];
    } else {
      if (cur !== null && seg.state === "OFF" && dur < autoLockNs) {
        cur = [cur[0], seg.b]; // bridge the sub-auto-lock off; stays open
      } else if (cur !== null) {
        out.push(cur);
        cur = null;
      }
    }
  }
  if (cur !== null) out.push(cur);
  return out;
}

function buildSubstrate(rawEvents: readonly CanonicalRow[]): Substrate {
  const byPid = new Map<string, Array<{ t: bigint; type: string }>>();
  for (const row of rawEvents) {
    const pid = row.participant_id || "unknown";
    let list = byPid.get(pid);
    if (!list) {
      list = [];
      byPid.set(pid, list);
    }
    list.push({ t: row.event_timestamp_ns, type: canonicalType(row.interaction_type) });
  }
  const pts = new Map<string, ChangePoint[]>();
  const boots = new Map<string, bigint[]>();
  const allTs = new Map<string, bigint[]>();
  const capable = new Set<string>();
  for (const [pid, list] of byPid) {
    list.sort((left, right) => (left.t < right.t ? -1 : left.t > right.t ? 1 : 0));
    pts.set(pid, changepoints(list));
    allTs.set(
      pid,
      list.map((entry) => entry.t),
    );
    boots.set(
      pid,
      list.filter((entry) => entry.type === STARTUP).map((entry) => entry.t),
    );
    const hasOn = list.some((entry) => entry.type === SCREEN_ON);
    const hasOff = list.some((entry) => entry.type === SCREEN_OFF);
    if (hasOn && hasOff) capable.add(pid);
  }
  return { pts, boots, allTs, capable };
}

interface SessionCreditOutcome {
  intervals: Interval[];
  usedNoWitnessFallback: boolean;
}

function creditIntervalsForSession(
  pid: string,
  s: bigint,
  eRaw: bigint,
  sub: Substrate,
  dayAppCount: number,
  tolNs: bigint,
  capNs: bigint,
  autoLockNs: bigint,
  minDayApps: number,
): SessionCreditOutcome {
  const capped = s + capNs;
  const e = eRaw < capped ? eRaw : capped;
  const allTs = sub.allTs.get(pid) ?? [];
  const alive = aliveIntervals(allTs, s, e, tolNs, sub.boots.get(pid) ?? []);
  const pts = sub.pts.get(pid);
  if (!pts || pts.length === 0 || !sub.capable.has(pid)) {
    return { intervals: [[s, e]], usedNoWitnessFallback: false }; // screen-incapable
  }
  const onFull = creditableIntervals(pts, s, e, autoLockNs);
  const credit = intersect(onFull, alive);
  const st0 = stateAt(pts, s);
  const hasCp = pts.some((cp) => cp.t >= s && cp.t <= e);
  if (st0 === null && !hasCp) {
    if (dayAppCount >= minDayApps) {
      return { intervals: alive, usedNoWitnessFallback: true };
    }
    return { intervals: [], usedNoWitnessFallback: false };
  }
  return { intervals: credit, usedNoWitnessFallback: false };
}

/**
 * Rewrite every engine "App Usage" session (that passed the minimum-duration
 * floor) into one row per credited interval. All other rows pass through
 * untouched. A fully-dead session emits no rows.
 */
export function applyScreenGatedCredit(
  appRows: readonly CanonicalRow[],
  rawEvents: readonly CanonicalRow[],
  opts: CreditOptions,
): CreditResult {
  const tolNs = BigInt(Math.round(opts.livenessToleranceMinutes * 60)) * NS_PER_SECOND;
  const capNs = BigInt(Math.round(opts.capMinutes * 60)) * NS_PER_SECOND;
  const autoLockNs = BigInt(Math.round(opts.autoLockBridgeSeconds)) * NS_PER_SECOND;

  const eligible = (row: CanonicalRow): boolean =>
    row.interaction_type === "App Usage" &&
    row.duration_minutes !== null &&
    row.duration_minutes > 0;

  const sessions = appRows.filter(eligible);
  const rest = appRows.filter((row) => !eligible(row));

  const report: CreditReport = {
    sessions: sessions.length,
    creditedRows: 0,
    creditedMinutes: 0,
    rawSessionMinutes: sessions.reduce((sum, row) => sum + (row.duration_minutes ?? 0), 0),
    truncatedSessions: 0,
    fullyDeadSessions: 0,
    noWitnessFallbacks: 0,
    screenIncapableParticipants: [],
  };

  if (sessions.length === 0) {
    return { creditedRows: [...appRows], report };
  }

  const sub = buildSubstrate(rawEvents);
  report.screenIncapableParticipants = [
    ...new Set(sessions.map((row) => row.participant_id)),
  ].filter((pid) => {
    const pts = sub.pts.get(pid);
    return !pts || pts.length === 0 || !sub.capable.has(pid);
  });

  // Distinct apps per (participant, date) — the no-witness fallback gate.
  const dayApps = new Map<string, Set<string>>();
  for (const row of sessions) {
    const key = `${row.participant_id} ${row.date}`;
    let set = dayApps.get(key);
    if (!set) {
      set = new Set();
      dayApps.set(key, set);
    }
    set.add(row.app_package_name);
  }

  const credited: CanonicalRow[] = [];
  for (const row of sessions) {
    const s = row.start_timestamp_ns;
    const eRaw = row.stop_timestamp_ns;
    if (s === null || eRaw === null || eRaw <= s) {
      credited.push(row); // defensive: keep malformed rows verbatim
      continue;
    }
    if (eRaw > s + capNs) report.truncatedSessions += 1;
    const dayAppCount = dayApps.get(`${row.participant_id} ${row.date}`)?.size ?? 0;
    const outcome = creditIntervalsForSession(
      row.participant_id,
      s,
      eRaw,
      sub,
      dayAppCount,
      tolNs,
      capNs,
      autoLockNs,
      opts.noWitnessMinDayApps,
    );
    if (outcome.usedNoWitnessFallback) report.noWitnessFallbacks += 1;
    let emitted = 0;
    for (const [a, b] of outcome.intervals) {
      if (b <= a) continue;
      const durationSeconds = Number(b - a) / 1e9;
      const clone: CanonicalRow = {
        ...row,
        start_timestamp_ns: a,
        stop_timestamp_ns: b,
        event_timestamp_ns: a,
        duration_seconds: durationSeconds,
        // RECIP_60, not /60: credited rows are clones of app rows, whose
        // minutes are polars-reciprocal semantics everywhere else.
        duration_minutes: durationSeconds * RECIP_60,
      };
      populateTimeColumns(clone, a, row.timezone || "UTC");
      credited.push(clone);
      emitted += 1;
    }
    if (emitted === 0) report.fullyDeadSessions += 1;
  }

  report.creditedRows = credited.length;
  report.creditedMinutes = credited.reduce((sum, row) => sum + (row.duration_minutes ?? 0), 0);
  return { creditedRows: [...credited, ...rest], report };
}
