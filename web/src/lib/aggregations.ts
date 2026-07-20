/**
 * Phase-3 aggregation subsystem (#8 / #12 / #13 / #15 / #16 / #17).
 *
 * Pure, deterministic post-processing over the already-computed app-usage and
 * screen-usage session rows. Web-only — no parity surface. Emitted as extra CSV
 * outputs behind the opt-in `enableAggregates` option.
 *
 * ── Metric definitions (research judgment calls — documented so they're easy to
 *    correct) ───────────────────────────────────────────────────────────────
 * - **App session**: a row with `interaction_type === "App Usage"` AND a complete
 *   `start_timestamp_ns`/`stop_timestamp_ns` interval. Filtered-app rows and
 *   missing-end rows are excluded.
 * - **Screen session**: a row with `interaction_type === "Screen Usage"` and a
 *   complete interval.
 * - **Date attribution**: a session belongs to the day/week of its `date` field,
 *   which is derived from its start (`event_timestamp`). A session that crosses
 *   midnight is attributed wholly to its **start** date.
 * - **total_app_usage_minutes**: summed from integer-nanosecond intervals of app
 *   sessions whose `duration_minutes` is non-null (sub-`minimumUsageDuration`
 *   sessions are nulled upstream → contribute 0), divided once at the end. This is
 *   the **foreground** (primary-layer) total only — it is the device wall-clock
 *   timeline, so background-overlap (secondary) time is *not* added here (that
 *   would double-count an instant two apps share). Background time is reported
 *   beside it as **total_background_app_usage_minutes** (its own summed secondary
 *   minutes), kept a separate companion column and never folded into a device total.
 * - **app_session_count**: count of app sessions (incl. nulled-duration ones).
 * - **mean_app_session_minutes**: total_app_usage_minutes ÷ (count of app
 *   sessions with non-null duration); 0 when none.
 * - **longest_app_session_minutes**: max non-null `duration_minutes`.
 * - **app_switches**: number of adjacent app-session pairs (sorted by start) with
 *   a different `app_package_name`.
 * - **pickups**: number of screen sessions in the period (a pickup ≈ a screen-on
 *   episode). 0 when screen processing is disabled.
 * - **first_use / last_use**: earliest start / latest stop across BOTH app and
 *   screen sessions; **active_window_minutes** = last_use − first_use. These
 *   timestamps appear in the WIDE summaries only (see #12 note below).
 * - **timezone**: the (normalized) timezone of the period's first session.
 * - **top apps**: every app ranked by total session minutes (desc), ties broken
 *   by package name (asc). No cap — the full per-app breakdown. Foreground and
 *   background time are shown **separately** (`foreground_minutes`,
 *   `background_minutes`) plus their sum (`total_minutes`); per app the two layers
 *   are disjoint sub-intervals of its own timeline, so the sum is well-defined
 *   (unlike a cross-app device total). A background-only app (e.g. music) ranks on
 *   its background time instead of vanishing. Always long.
 * - **category budget**: foreground/background/total minutes + session count per
 *   `broad_app_category` per day (only when a codebook supplies the category),
 *   split into the same foreground/background columns as top apps. NOTE the
 *   per-category `total_minutes` is summed across apps, so unlike a single app
 *   (whose own layers are disjoint) a foreground app overlapping a *background*
 *   app of the same category can count a shared instant twice — read it as
 *   "total category engagement," not exclusive wall-clock. Always long.
 * - **co-usage**: overlapping app-session pairs. `co_usage_count` = number of
 *   overlapping pair-intervals; `total_overlap_minutes` = summed overlap. Only
 *   meaningful (non-empty) with concurrent-usage modeling, which can split a long
 *   overlap into sub-intervals. Always an edge list.
 * - **#12 long ⇄ wide**: the daily/weekly summaries reshape between WIDE (one row
 *   per period, metrics as columns + first/last-use timestamps) and LONG (one row
 *   per period per metric). LONG melts the **numeric scalar metrics only** — the
 *   first/last-use timestamp strings are wide-only by design.
 */

/** The subset of a processed session row the aggregations read. */
export type AggregateInputRow = {
  study_id: string;
  participant_id: string;
  date: string;
  timezone: string;
  app_package_name: string;
  application_label: string;
  broad_app_category?: string | null;
  interaction_type: string;
  /** Concurrent-usage split layer: "primary" (foreground), "secondary"
   * (background overlap), or null/absent when no split ran. */
  usage_layer?: string | null;
  start_timestamp_ns: bigint | null;
  stop_timestamp_ns: bigint | null;
  duration_minutes: number | null;
  day: number;
  weekdayMF: number;
  weekdayMTh: number;
  weekdaySuTh: number;
};

export type AggregateShape = "wide" | "long";

export type BuildAggregateOptions = {
  studyName: string;
  shape: AggregateShape;
  /** Emit the per-category budget output (requires a codebook category). */
  includeCategoryBudget: boolean;
  /** Emit the co-usage matrix (requires concurrent-usage modeling). */
  includeCoUsage: boolean;
  /** Formats a nanosecond instant to the output timestamp string. */
  formatTimestamp: (ns: bigint, timezone: string) => string;
};

export type AggregateOutput = {
  /** File-name suffix, e.g. " Daily Summary.csv". */
  suffix: string;
  csv: string;
  rowCount: number;
};

const APP_USAGE = "App Usage";
const SCREEN_USAGE = "Screen Usage";
const NS_PER_MINUTE = 60_000_000_000n;

/**
 * Collision-free composite group key from component strings — JSON-encoded so
 * spaces or special characters in any component (e.g. "Social & Communication")
 * can never merge distinct groups. Components are read back from the grouped
 * rows, never by parsing this key.
 */
function compositeKey(...parts: string[]): string {
  return JSON.stringify(parts);
}

/** Group rows into a Map keyed by `keyFn`, preserving insertion order. */
export function groupBy<T, K>(rows: readonly T[], keyFn: (row: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const bucket = result.get(key);
    if (bucket) bucket.push(row);
    else result.set(key, [row]);
  }
  return result;
}

function isAppSession(row: AggregateInputRow): boolean {
  return (
    row.interaction_type === APP_USAGE &&
    row.start_timestamp_ns !== null &&
    row.stop_timestamp_ns !== null
  );
}

/**
 * Foreground app session: an app session that is NOT a secondary
 * (background-overlap) concurrent-usage sub-interval. The period summary's
 * `total_app_usage_minutes` and the foreground/device metrics use this so a
 * secondary layer isn't double-counted against the primary it overlaps. With
 * concurrent modeling off there are no secondary rows, so this equals
 * `isAppSession` (no-op). Top apps and category budget instead group over BOTH
 * layers (`isAppSession`) and split the minutes into foreground vs background
 * columns; co-usage also uses `isAppSession` — it measures the overlap and needs
 * both layers.
 */
function isForegroundAppSession(row: AggregateInputRow): boolean {
  return isAppSession(row) && row.usage_layer !== "secondary";
}

/** Background app session: an app session that IS a secondary (background-overlap)
 * concurrent-usage sub-interval. Empty when no split ran. */
function isBackgroundAppSession(row: AggregateInputRow): boolean {
  return isAppSession(row) && row.usage_layer === "secondary";
}

/** Sum the integer-nanosecond intervals of app sessions with a non-null duration. */
function sumDurationNs(rows: readonly AggregateInputRow[]): bigint {
  let ns = 0n;
  for (const row of rows) {
    if (row.duration_minutes !== null) ns += row.stop_timestamp_ns! - row.start_timestamp_ns!;
  }
  return ns;
}

function isScreenSession(row: AggregateInputRow): boolean {
  return (
    row.interaction_type === SCREEN_USAGE &&
    row.start_timestamp_ns !== null &&
    row.stop_timestamp_ns !== null
  );
}

/** Round to 4 decimal places deterministically (display precision only). */
function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

function nsToMinutes(ns: bigint): number {
  return round4(Number(ns) / Number(NS_PER_MINUTE));
}

function compareBigint(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * ISO-8601 year-week (e.g. "2026-W23") and the Monday that starts that week,
 * derived purely from the calendar date string (already in the participant's
 * timezone). UTC math is used only for arithmetic — no timezone shift.
 */
export function isoWeekInfo(dateStr: string): { key: string; weekStart: string } {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  const dayNr = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  // Monday of this week, for the week-start date.
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - dayNr);
  // Thursday of this week decides the ISO year.
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() - dayNr + 3);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  const key = `${isoYear}-W${String(week).padStart(2, "0")}`;
  const weekStart = `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
  return { key, weekStart };
}

type PeriodSummary = {
  study_id: string;
  participant_id: string;
  timezone: string;
  day: number;
  weekdayMF: number;
  weekdayMTh: number;
  weekdaySuTh: number;
  total_app_usage_minutes: number;
  total_background_app_usage_minutes: number;
  total_screen_usage_minutes: number;
  app_session_count: number;
  screen_session_count: number;
  app_switches: number;
  pickups: number;
  mean_app_session_minutes: number;
  longest_app_session_minutes: number;
  active_window_minutes: number;
  first_use_ns: bigint | null;
  last_use_ns: bigint | null;
};

/** Numeric scalar metrics, in stable order — the only fields the long-form melt emits. */
const NUMERIC_METRICS = [
  "total_app_usage_minutes",
  "total_background_app_usage_minutes",
  "total_screen_usage_minutes",
  "app_session_count",
  "screen_session_count",
  "app_switches",
  "pickups",
  "mean_app_session_minutes",
  "longest_app_session_minutes",
  "active_window_minutes",
] as const;

type ScalarMetrics = Omit<
  PeriodSummary,
  "study_id" | "participant_id" | "timezone" | "day" | "weekdayMF" | "weekdayMTh" | "weekdaySuTh"
>;

function summarizeGroup(
  appSessions: AggregateInputRow[],
  screenSessions: AggregateInputRow[],
  backgroundMinutes: number,
): ScalarMetrics {
  const sortedApp = [...appSessions].sort((a, b) =>
    compareBigint(a.start_timestamp_ns!, b.start_timestamp_ns!),
  );

  let totalAppNs = 0n;
  let appSessionsWithDuration = 0;
  let longestMinutes = 0;
  for (const row of sortedApp) {
    if (row.duration_minutes !== null) {
      totalAppNs += row.stop_timestamp_ns! - row.start_timestamp_ns!;
      appSessionsWithDuration += 1;
      if (row.duration_minutes > longestMinutes) longestMinutes = row.duration_minutes;
    }
  }

  let totalScreenNs = 0n;
  for (const row of screenSessions) {
    if (row.duration_minutes !== null) {
      totalScreenNs += row.stop_timestamp_ns! - row.start_timestamp_ns!;
    }
  }

  let appSwitches = 0;
  for (let index = 1; index < sortedApp.length; index += 1) {
    if (sortedApp[index].app_package_name !== sortedApp[index - 1].app_package_name) {
      appSwitches += 1;
    }
  }

  // first_use / last_use span both app and screen sessions.
  let firstUseNs: bigint | null = null;
  let lastUseNs: bigint | null = null;
  for (const row of [...sortedApp, ...screenSessions]) {
    const start = row.start_timestamp_ns!;
    const stop = row.stop_timestamp_ns!;
    if (firstUseNs === null || start < firstUseNs) firstUseNs = start;
    if (lastUseNs === null || stop > lastUseNs) lastUseNs = stop;
  }

  const totalAppMinutes = nsToMinutes(totalAppNs);
  const activeWindowMinutes =
    firstUseNs !== null && lastUseNs !== null && lastUseNs > firstUseNs
      ? nsToMinutes(lastUseNs - firstUseNs)
      : 0;

  return {
    total_app_usage_minutes: totalAppMinutes,
    total_background_app_usage_minutes: backgroundMinutes,
    total_screen_usage_minutes: nsToMinutes(totalScreenNs),
    app_session_count: sortedApp.length,
    screen_session_count: screenSessions.length,
    app_switches: appSwitches,
    pickups: screenSessions.length,
    mean_app_session_minutes:
      appSessionsWithDuration > 0 ? round4(totalAppMinutes / appSessionsWithDuration) : 0,
    longest_app_session_minutes: round4(longestMinutes),
    active_window_minutes: activeWindowMinutes,
    first_use_ns: firstUseNs,
    last_use_ns: lastUseNs,
  };
}

type SummaryEntry = { participant_id: string; period: string; summary: PeriodSummary };

/**
 * Per-(study, participant, period) summaries. `periodOf` maps a row's date to a
 * period key (the date itself for daily, the ISO week for weekly). Keying on
 * study_id keeps two studies that reuse a participant_id from merging. Sorted by
 * (study_id, participant_id, period).
 */
export function computePeriodSummaries(
  appRows: readonly AggregateInputRow[],
  screenRows: readonly AggregateInputRow[],
  periodOf: (dateStr: string) => string,
): SummaryEntry[] {
  const keyOf = (row: AggregateInputRow): string =>
    compositeKey(row.study_id, row.participant_id, periodOf(row.date));
  const appByKey = groupBy(appRows.filter(isForegroundAppSession), keyOf);
  // Background (secondary) minutes are summed per key in a parallel map and
  // attached as a companion column — the foreground group feeding summarizeGroup
  // is left untouched so every foreground metric stays byte-identical. Secondary
  // rows only exist overlapping a primary, so their keys ⊆ the foreground keys.
  const backgroundByKey = groupBy(appRows.filter(isBackgroundAppSession), keyOf);
  const screenByKey = groupBy(screenRows.filter(isScreenSession), keyOf);

  const out: SummaryEntry[] = [];
  // Usually background keys ⊆ foreground keys (a secondary overlaps a primary in
  // the same period), but an overlap that crosses midnight relative to its
  // foreground app lands the secondary on its own date — so include background
  // keys in the union (a no-op for normal data) rather than silently dropping
  // those minutes, and let `sample` fall back to a background row.
  for (const key of new Set<string>([
    ...appByKey.keys(),
    ...backgroundByKey.keys(),
    ...screenByKey.keys(),
  ])) {
    const appGroup = appByKey.get(key) ?? [];
    const screenGroup = screenByKey.get(key) ?? [];
    const backgroundGroup = backgroundByKey.get(key) ?? [];
    const sample = appGroup[0] ?? screenGroup[0] ?? backgroundGroup[0];
    const backgroundMinutes = nsToMinutes(sumDurationNs(backgroundGroup));
    const metrics = summarizeGroup(appGroup, screenGroup, backgroundMinutes);
    out.push({
      participant_id: sample.participant_id,
      period: periodOf(sample.date),
      summary: {
        study_id: sample.study_id,
        participant_id: sample.participant_id,
        timezone: sample.timezone,
        day: sample.day,
        weekdayMF: sample.weekdayMF,
        weekdayMTh: sample.weekdayMTh,
        weekdaySuTh: sample.weekdaySuTh,
        ...metrics,
      },
    });
  }
  out.sort(
    (a, b) =>
      a.summary.study_id.localeCompare(b.summary.study_id) ||
      a.participant_id.localeCompare(b.participant_id) ||
      a.period.localeCompare(b.period),
  );
  return out;
}

export type TopAppRow = {
  study_id: string;
  participant_id: string;
  period: string;
  app_package_name: string;
  application_label: string;
  rank: number;
  foreground_minutes: number;
  background_minutes: number;
  total_minutes: number;
  session_count: number;
};

/**
 * Every app ranked by total session minutes within each (study, participant,
 * period). Groups over both layers and reports foreground (primary/null) and
 * background (secondary) minutes separately; `total_minutes` is their sum (per
 * app the two layers are disjoint, so the sum is well-defined). Ranked by
 * `total_minutes` desc, ties by package name asc.
 */
export function computeTopApps(
  appRows: readonly AggregateInputRow[],
  periodOf: (dateStr: string) => string,
): TopAppRow[] {
  const byKey = groupBy(appRows.filter(isAppSession), (row) =>
    compositeKey(row.study_id, row.participant_id, periodOf(row.date)),
  );
  const out: TopAppRow[] = [];
  for (const group of byKey.values()) {
    const sample = group[0];
    const study_id = sample.study_id;
    const participant_id = sample.participant_id;
    const period = periodOf(sample.date);
    const byApp = groupBy(group, (row) => row.app_package_name);
    const apps = [...byApp.values()].map((rows) => {
      const fgNs = sumDurationNs(rows.filter((row) => row.usage_layer !== "secondary"));
      const bgNs = sumDurationNs(rows.filter((row) => row.usage_layer === "secondary"));
      return {
        app_package_name: rows[0].app_package_name,
        application_label: rows[0].application_label,
        foreground_minutes: nsToMinutes(fgNs),
        background_minutes: nsToMinutes(bgNs),
        total_minutes: nsToMinutes(fgNs + bgNs),
        session_count: rows.length,
      };
    });
    apps.sort(
      (a, b) =>
        b.total_minutes - a.total_minutes || a.app_package_name.localeCompare(b.app_package_name),
    );
    apps.forEach((app, index) =>
      out.push({ study_id, participant_id, period, rank: index + 1, ...app }),
    );
  }
  out.sort(
    (a, b) =>
      a.study_id.localeCompare(b.study_id) ||
      a.participant_id.localeCompare(b.participant_id) ||
      a.period.localeCompare(b.period) ||
      a.rank - b.rank,
  );
  return out;
}

export type CategoryBudgetRow = {
  study_id: string;
  participant_id: string;
  date: string;
  broad_app_category: string;
  foreground_minutes: number;
  background_minutes: number;
  total_minutes: number;
  session_count: number;
};

/**
 * Foreground/background/total minutes + session count per category per (study,
 * participant, day). Groups over both layers and splits minutes into foreground
 * vs background columns, so a background-only category (e.g. an audio app's
 * overlap time) is reported rather than dropped. Unlike top apps, `total_minutes`
 * here sums across apps in the category, so a foreground app overlapping a
 * background app of the same category can double-count a shared instant — it is a
 * "total category engagement" figure, not exclusive wall-clock.
 */
export function computeCategoryBudget(appRows: readonly AggregateInputRow[]): CategoryBudgetRow[] {
  const categoryOf = (row: AggregateInputRow): string =>
    (row.broad_app_category ?? "").trim() || "Unknown";
  const byKey = groupBy(appRows.filter(isAppSession), (row) =>
    compositeKey(row.study_id, row.participant_id, row.date, categoryOf(row)),
  );
  const out: CategoryBudgetRow[] = [];
  for (const rows of byKey.values()) {
    const sample = rows[0];
    const fgNs = sumDurationNs(rows.filter((row) => row.usage_layer !== "secondary"));
    const bgNs = sumDurationNs(rows.filter((row) => row.usage_layer === "secondary"));
    out.push({
      study_id: sample.study_id,
      participant_id: sample.participant_id,
      date: sample.date,
      broad_app_category: categoryOf(sample),
      foreground_minutes: nsToMinutes(fgNs),
      background_minutes: nsToMinutes(bgNs),
      total_minutes: nsToMinutes(fgNs + bgNs),
      session_count: rows.length,
    });
  }
  out.sort(
    (a, b) =>
      a.study_id.localeCompare(b.study_id) ||
      a.participant_id.localeCompare(b.participant_id) ||
      a.date.localeCompare(b.date) ||
      a.broad_app_category.localeCompare(b.broad_app_category),
  );
  return out;
}

export type CoUsageRow = {
  study_id: string;
  participant_id: string;
  app_a: string;
  app_b: string;
  co_usage_count: number;
  total_overlap_minutes: number;
};

/**
 * App co-usage edge list: pairs of app sessions whose intervals overlap, swept
 * per (study, participant) so sessions from different studies never form a pair.
 * The pair key is the two package names sorted, so (A,B) and (B,A) accumulate
 * together.
 */
export function computeCoUsage(appRows: readonly AggregateInputRow[]): CoUsageRow[] {
  const byParticipant = groupBy(appRows.filter(isAppSession), (row) =>
    compositeKey(row.study_id, row.participant_id),
  );
  const out: CoUsageRow[] = [];
  for (const sessionsUnsorted of byParticipant.values()) {
    const sessions = [...sessionsUnsorted].sort((a, b) =>
      compareBigint(a.start_timestamp_ns!, b.start_timestamp_ns!),
    );
    const pairs = new Map<string, { app_a: string; app_b: string; count: number; ns: bigint }>();
    let active: AggregateInputRow[] = [];
    for (const session of sessions) {
      active = active.filter((other) => other.stop_timestamp_ns! > session.start_timestamp_ns!);
      for (const other of active) {
        if (other.app_package_name === session.app_package_name) continue;
        // session.start >= other.start (sorted), so overlap begins at session.start.
        const overlapEnd =
          other.stop_timestamp_ns! < session.stop_timestamp_ns!
            ? other.stop_timestamp_ns!
            : session.stop_timestamp_ns!;
        const overlapNs = overlapEnd - session.start_timestamp_ns!;
        if (overlapNs <= 0n) continue;
        const [app_a, app_b] = [other.app_package_name, session.app_package_name].sort((x, y) =>
          x.localeCompare(y),
        ) as [string, string];
        const pairKey = compositeKey(app_a, app_b);
        const entry = pairs.get(pairKey);
        if (entry) {
          entry.count += 1;
          entry.ns += overlapNs;
        } else {
          pairs.set(pairKey, { app_a, app_b, count: 1, ns: overlapNs });
        }
      }
      active.push(session);
    }
    const study_id = sessions[0].study_id;
    const participant_id = sessions[0].participant_id;
    for (const entry of pairs.values()) {
      out.push({
        study_id,
        participant_id,
        app_a: entry.app_a,
        app_b: entry.app_b,
        co_usage_count: entry.count,
        total_overlap_minutes: nsToMinutes(entry.ns),
      });
    }
  }
  out.sort(
    (a, b) =>
      a.study_id.localeCompare(b.study_id) ||
      a.participant_id.localeCompare(b.participant_id) ||
      a.app_a.localeCompare(b.app_a) ||
      a.app_b.localeCompare(b.app_b),
  );
  return out;
}

// ── CSV serialization ───────────────────────────────────────────────────────

function escapeCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(
  columns: readonly string[],
  records: ReadonlyArray<Record<string, string | number>>,
): string {
  const lines = [columns.join(",")];
  for (const record of records) {
    lines.push(columns.map((column) => escapeCell(record[column] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function buildSummaryCsv(
  summaries: SummaryEntry[],
  options: BuildAggregateOptions,
  periodColumn: string,
  extraColumns: string[],
  extraOf: (entry: SummaryEntry) => Record<string, string | number>,
): string {
  if (options.shape === "long") {
    // Long/tidy: one row per (identity, metric). Numeric scalars only — the
    // first_use/last_use timestamp metrics stay wide-only by design.
    const columns = [
      "study_id",
      "study_name",
      "participant_id",
      periodColumn,
      "timezone",
      "metric",
      "value",
    ];
    const records: Array<Record<string, string | number>> = [];
    for (const entry of summaries) {
      const s = entry.summary;
      for (const metric of NUMERIC_METRICS) {
        records.push({
          study_id: s.study_id,
          study_name: options.studyName,
          participant_id: entry.participant_id,
          [periodColumn]: entry.period,
          timezone: s.timezone,
          metric,
          value: s[metric],
        });
      }
    }
    return toCsv(columns, records);
  }

  const columns = [
    "study_id",
    "study_name",
    "participant_id",
    periodColumn,
    ...extraColumns,
    "timezone",
    ...NUMERIC_METRICS,
    "first_use",
    "last_use",
  ];
  const records = summaries.map((entry) => {
    const s = entry.summary;
    return {
      study_id: s.study_id,
      study_name: options.studyName,
      participant_id: entry.participant_id,
      [periodColumn]: entry.period,
      ...extraOf(entry),
      timezone: s.timezone,
      total_app_usage_minutes: s.total_app_usage_minutes,
      total_background_app_usage_minutes: s.total_background_app_usage_minutes,
      total_screen_usage_minutes: s.total_screen_usage_minutes,
      app_session_count: s.app_session_count,
      screen_session_count: s.screen_session_count,
      app_switches: s.app_switches,
      pickups: s.pickups,
      mean_app_session_minutes: s.mean_app_session_minutes,
      longest_app_session_minutes: s.longest_app_session_minutes,
      active_window_minutes: s.active_window_minutes,
      first_use: s.first_use_ns !== null ? options.formatTimestamp(s.first_use_ns, s.timezone) : "",
      last_use: s.last_use_ns !== null ? options.formatTimestamp(s.last_use_ns, s.timezone) : "",
    };
  });
  return toCsv(columns, records);
}

/**
 * Build every aggregate output for one input file. Each entry is a file suffix +
 * CSV text + row count, ready to be wrapped as a `ProcessedOutputFileResult`.
 */
export function buildAggregateOutputs(
  appRows: readonly AggregateInputRow[],
  screenRows: readonly AggregateInputRow[],
  options: BuildAggregateOptions,
): AggregateOutput[] {
  const outputs: AggregateOutput[] = [];

  // Daily summary (#8/#13/#15) — shape toggle applies.
  const daily = computePeriodSummaries(appRows, screenRows, (date) => date);
  outputs.push({
    suffix: " Daily Summary.csv",
    csv: buildSummaryCsv(
      daily,
      options,
      "date",
      ["day", "weekdayMF", "weekdayMTh", "weekdaySuTh"],
      (entry) => ({
        day: entry.summary.day,
        weekdayMF: entry.summary.weekdayMF,
        weekdayMTh: entry.summary.weekdayMTh,
        weekdaySuTh: entry.summary.weekdaySuTh,
      }),
    ),
    rowCount: options.shape === "long" ? daily.length * NUMERIC_METRICS.length : daily.length,
  });

  // Weekly summary (#8) — shape toggle applies. Precompute each week key's Monday.
  const weekStartByKey = new Map<string, string>();
  for (const row of [...appRows, ...screenRows]) {
    const info = isoWeekInfo(row.date);
    if (!weekStartByKey.has(info.key)) weekStartByKey.set(info.key, info.weekStart);
  }
  const weekly = computePeriodSummaries(appRows, screenRows, (date) => isoWeekInfo(date).key);
  outputs.push({
    suffix: " Weekly Summary.csv",
    csv: buildSummaryCsv(weekly, options, "iso_year_week", ["week_start_date"], (entry) => ({
      week_start_date: weekStartByKey.get(entry.period) ?? "",
    })),
    rowCount: options.shape === "long" ? weekly.length * NUMERIC_METRICS.length : weekly.length,
  });

  // Top apps (#8 top-N) — always long.
  const topApps = computeTopApps(appRows, (date) => date);
  outputs.push({
    suffix: " Top Apps.csv",
    csv: toCsv(
      [
        "study_id",
        "study_name",
        "participant_id",
        "date",
        "rank",
        "app_package_name",
        "application_label",
        "foreground_minutes",
        "background_minutes",
        "total_minutes",
        "session_count",
      ],
      topApps.map((row) => ({
        study_id: row.study_id,
        study_name: options.studyName,
        participant_id: row.participant_id,
        date: row.period,
        rank: row.rank,
        app_package_name: row.app_package_name,
        application_label: row.application_label,
        foreground_minutes: row.foreground_minutes,
        background_minutes: row.background_minutes,
        total_minutes: row.total_minutes,
        session_count: row.session_count,
      })),
    ),
    rowCount: topApps.length,
  });

  // Category time budget (#17) — only when a codebook category is present.
  if (options.includeCategoryBudget) {
    const budget = computeCategoryBudget(appRows);
    outputs.push({
      suffix: " Category Time Budget.csv",
      csv: toCsv(
        [
          "study_id",
          "study_name",
          "participant_id",
          "date",
          "broad_app_category",
          "foreground_minutes",
          "background_minutes",
          "total_minutes",
          "session_count",
        ],
        budget.map((row) => ({ ...row, study_name: options.studyName })),
      ),
      rowCount: budget.length,
    });
  }

  // Co-usage matrix (#16) — only when concurrent usage is modeled.
  if (options.includeCoUsage) {
    const coUsage = computeCoUsage(appRows);
    outputs.push({
      suffix: " App Co-Usage.csv",
      csv: toCsv(
        [
          "study_id",
          "study_name",
          "participant_id",
          "app_a",
          "app_b",
          "co_usage_count",
          "total_overlap_minutes",
        ],
        coUsage.map((row) => ({ ...row, study_name: options.studyName })),
      ),
      rowCount: coUsage.length,
    });
  }

  return outputs;
}
