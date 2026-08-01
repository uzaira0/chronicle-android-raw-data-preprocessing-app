import Papa from "papaparse";

export type SyntheticAppClass =
  | "catalog"
  | "filtered"
  | "background"
  | "forcing-screen-open"
  | "unknown";

export type SyntheticApp = {
  packageName: string;
  label: string;
  classes: SyntheticAppClass[];
};

type CsvRecord = Record<string, string>;

export type SyntheticCatalog = {
  apps: SyntheticApp[];
  codebookHeader: string[];
  codebookByPackage: Map<string, CsvRecord>;
  sourceCounts: {
    codebook: number;
    filter: number;
    background: number;
    forcingScreenOpen: number;
  };
};

export type SyntheticCorpusProfile = {
  id: string;
  seed: number;
  sessionCount: number;
  startUtc: string;
  timezones: string[];
  shuffleRows: boolean;
  injectExactDuplicates: boolean;
  injectDuplicateTimestamps: boolean;
  injectLongAndMissingStops: boolean;
  injectOverlaps: boolean;
  injectUnicodeAndQuotedLabels: boolean;
  injectInfluenceProbes?: boolean;
};

export type SyntheticChronicleCorpus = {
  id: string;
  seed: number;
  participantId: string;
  csv: string;
  rowCount: number;
  timezones: string[];
  usedPackages: string[];
  representedAppClasses: SyntheticAppClass[];
  injectedFeatures: string[];
};

export const SYNTHETIC_CORPUS_PROFILES: SyntheticCorpusProfile[] = [
  {
    id: "catalog-random",
    seed: 0x00c0ffee,
    sessionCount: 72,
    startUtc: "2026-02-16T06:00:00Z",
    timezones: ["America/Chicago", "America/New_York"],
    shuffleRows: false,
    injectExactDuplicates: false,
    injectDuplicateTimestamps: false,
    injectLongAndMissingStops: false,
    injectOverlaps: false,
    injectUnicodeAndQuotedLabels: false,
  },
  {
    id: "support-intersections",
    seed: 0x51a7e5aa,
    sessionCount: 64,
    startUtc: "2026-04-05T08:00:00Z",
    timezones: ["America/Chicago", "America/New_York"],
    shuffleRows: false,
    injectExactDuplicates: true,
    injectDuplicateTimestamps: false,
    injectLongAndMissingStops: false,
    injectOverlaps: true,
    injectUnicodeAndQuotedLabels: false,
  },
  {
    id: "temporal-pathologies",
    seed: 0xd1570f7e,
    sessionCount: 56,
    startUtc: "2026-03-08T00:30:00Z",
    timezones: ["America/Chicago", "America/New_York"],
    shuffleRows: true,
    injectExactDuplicates: true,
    injectDuplicateTimestamps: true,
    injectLongAndMissingStops: true,
    injectOverlaps: true,
    injectUnicodeAndQuotedLabels: false,
  },
  {
    id: "interaction-pathologies",
    seed: 0xbad5eed5,
    sessionCount: 60,
    startUtc: "2026-11-01T00:30:00Z",
    timezones: ["America/Chicago", "America/New_York"],
    shuffleRows: true,
    injectExactDuplicates: false,
    injectDuplicateTimestamps: true,
    injectLongAndMissingStops: true,
    injectOverlaps: true,
    injectUnicodeAndQuotedLabels: true,
  },
  {
    id: "threshold-boundaries",
    seed: 0x600dca5e,
    sessionCount: 68,
    startUtc: "2026-06-15T07:00:00Z",
    timezones: ["America/Chicago", "America/New_York"],
    shuffleRows: false,
    injectExactDuplicates: true,
    injectDuplicateTimestamps: true,
    injectLongAndMissingStops: true,
    injectOverlaps: false,
    injectUnicodeAndQuotedLabels: true,
  },
  {
    id: "configuration-influence-probes",
    seed: 0x1f1e7ce5,
    sessionCount: 20,
    startUtc: "2026-09-15T12:00:00Z",
    timezones: ["America/Chicago", "America/New_York"],
    shuffleRows: false,
    injectExactDuplicates: false,
    injectDuplicateTimestamps: false,
    injectLongAndMissingStops: false,
    injectOverlaps: false,
    injectUnicodeAndQuotedLabels: false,
    injectInfluenceProbes: true,
  },
];

export const QUALIFICATION_CORPUS_PROFILE: SyntheticCorpusProfile = {
  id: "qualification-chicago-only",
  seed: 0x0badc0de,
  sessionCount: 36,
  startUtc: "2026-08-10T07:00:00Z",
  timezones: ["America/Chicago"],
  shuffleRows: true,
  injectExactDuplicates: true,
  injectDuplicateTimestamps: false,
  injectLongAndMissingStops: false,
  injectOverlaps: true,
  injectUnicodeAndQuotedLabels: false,
};

const RAW_HEADERS = [
  "study_id",
  "participant_id",
  "possible_device_model",
  "username",
  "application_label",
  "interaction_type",
  "app_package_name",
  "event_timestamp",
  "start_timestamp",
  "stop_timestamp",
  "timezone",
];

function parseRecords(csv: string, label: string): { fields: string[]; rows: CsvRecord[] } {
  const parsed = Papa.parse<CsvRecord>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  const firstParseError = parsed.errors[0];
  if (firstParseError) {
    throw new Error(`${label}: ${firstParseError.message}`);
  }
  return {
    fields: parsed.meta.fields ?? [],
    rows: parsed.data,
  };
}

function packageColumn(record: CsvRecord): string {
  return (record.app_package_name || record.package_name || "").trim();
}

function labelColumn(record: CsvRecord, packageName: string): string {
  return (
    record.application_label ||
    record.known_application_labels?.split(",")[0] ||
    record.label_or_note?.split("(")[0] ||
    packageName
  ).trim();
}

export function buildSyntheticCatalog(input: {
  codebookCsv: string;
  filterCsv: string;
  backgroundCsv: string;
  forcingScreenOpenCsv: string;
}): SyntheticCatalog {
  const codebook = parseRecords(input.codebookCsv, "codebook");
  const filtered = parseRecords(input.filterCsv, "filter").rows;
  const background = parseRecords(input.backgroundCsv, "background").rows;
  const forcing = parseRecords(input.forcingScreenOpenCsv, "forcing-screen-open").rows;
  const codebookByPackage = new Map(
    codebook.rows
      .map((record) => [packageColumn(record), record] as const)
      .filter(([packageName]) => packageName.length > 0),
  );
  const filterPackages = new Set(filtered.map(packageColumn).filter(Boolean));
  const backgroundPackages = new Set(background.map(packageColumn).filter(Boolean));
  const forcingPackages = new Set(forcing.map(packageColumn).filter(Boolean));
  const supportPackages = new Set([
    ...filterPackages,
    ...backgroundPackages,
    ...forcingPackages,
  ]);
  const byPackage = new Map<string, SyntheticApp>();
  const add = (packageName: string, label: string, appClass: SyntheticAppClass) => {
    if (!packageName) return;
    const current = byPackage.get(packageName) ?? {
      packageName,
      label: label || packageName,
      classes: [],
    };
    if (!current.classes.includes(appClass)) current.classes.push(appClass);
    if (current.label === current.packageName && label) current.label = label;
    byPackage.set(packageName, current);
  };
  for (const [packageName, record] of codebookByPackage) {
    if (!supportPackages.has(packageName)) {
      add(packageName, labelColumn(record, packageName), "catalog");
    }
  }
  for (const record of filtered) {
    const packageName = packageColumn(record);
    add(packageName, labelColumn(codebookByPackage.get(packageName) ?? record, packageName), "filtered");
  }
  for (const record of background) {
    const packageName = packageColumn(record);
    add(packageName, labelColumn(codebookByPackage.get(packageName) ?? record, packageName), "background");
  }
  for (const record of forcing) {
    const packageName = packageColumn(record);
    add(
      packageName,
      labelColumn(codebookByPackage.get(packageName) ?? record, packageName),
      "forcing-screen-open",
    );
  }
  add("org.example.uncatalogued.research", "Uncatalogued Research App", "unknown");
  const apps = [...byPackage.values()].sort((left, right) =>
    left.packageName.localeCompare(right.packageName),
  );
  for (const required of [
    "catalog",
    "filtered",
    "background",
    "forcing-screen-open",
    "unknown",
  ] satisfies SyntheticAppClass[]) {
    if (!apps.some((app) => app.classes.includes(required))) {
      throw new Error(`support catalogs do not provide a ${required} application class`);
    }
  }
  return {
    apps,
    codebookHeader: codebook.fields,
    codebookByPackage,
    sourceCounts: {
      codebook: codebook.rows.length,
      filter: filtered.length,
      background: background.length,
      forcingScreenOpen: forcing.length,
    },
  };
}

export function buildCodebookSlice(catalog: SyntheticCatalog, packages: readonly string[]): string {
  const rows = [...new Set(packages)]
    .sort()
    .map((packageName) => catalog.codebookByPackage.get(packageName))
    .filter((record): record is CsvRecord => record !== undefined);
  return `${Papa.unparse({ fields: catalog.codebookHeader, data: rows })}\n`;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 16), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state = (state ^ (state >>> 16)) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function formatTimestamp(milliseconds: number): string {
  const date = new Date(milliseconds);
  const pad = (value: number) => String(value).padStart(2, "0");
  const micros = String(date.getUTCMilliseconds() * 1000).padStart(6, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${micros}`;
}

function encodeRow(values: readonly string[]): string {
  return values
    .map((value) => {
      if (!/[",\n\r]/.test(value)) return value;
      return `"${value.replaceAll('"', '""')}"`;
    })
    .join(",");
}

export function generateSyntheticChronicleCorpus(
  profile: SyntheticCorpusProfile,
  catalog: SyntheticCatalog,
): SyntheticChronicleCorpus {
  const primaryTimezone = profile.timezones[0];
  if (profile.sessionCount < 10 || primaryTimezone === undefined) {
    throw new Error("synthetic corpus profiles require at least ten sessions and one timezone");
  }
  const random = seededRandom(profile.seed);
  const participantId = `P-SYN-${profile.seed.toString(16).padStart(8, "0")}`;
  const byClass = new Map<SyntheticAppClass, SyntheticApp[]>();
  for (const appClass of [
    "catalog",
    "filtered",
    "background",
    "forcing-screen-open",
    "unknown",
  ] satisfies SyntheticAppClass[]) {
    byClass.set(
      appClass,
      catalog.apps.filter((app) => app.classes.includes(appClass)),
    );
  }
  const appClassCycle = [
    "catalog",
    "filtered",
    "background",
    "forcing-screen-open",
    "unknown",
  ] satisfies SyntheticAppClass[];
  const durationSeconds = [0, 1, 2, 29, 30, 59, 60, 61, 119, 120, 121, 299, 300, 301, 3_599, 3_600];
  const rows: string[][] = [];
  const usedPackages = new Set<string>();
  const represented = new Set<SyntheticAppClass>();
  const features = new Set<string>(["catalog-derived-apps", "screen-and-keyguard-events"]);
  let cursor = Date.parse(profile.startUtc);

  const emit = (
    app: SyntheticApp,
    interactionType: string,
    timezone: string,
    timestamp = cursor,
    label = app.label,
    startTimestamp = "",
    stopTimestamp = "",
    username = "Target Child",
  ) => {
    usedPackages.add(app.packageName);
    app.classes.forEach((appClass) => represented.add(appClass));
    rows.push([
      "synthetic-configuration-campaign",
      participantId,
      "Synthetic Android",
      username,
      label,
      interactionType,
      app.packageName,
      formatTimestamp(timestamp),
      startTimestamp,
      stopTimestamp,
      timezone,
    ]);
  };
  const system: SyntheticApp = { packageName: "android", label: "System", classes: [] };
  const pickClass = (appClass: SyntheticAppClass): SyntheticApp => {
    const candidates = byClass.get(appClass) ?? [];
    const candidate = candidates[Math.floor(random() * candidates.length)];
    if (candidate === undefined) throw new Error(`no app candidates for ${appClass}`);
    return candidate;
  };
  const cycleAt = <T,>(values: readonly T[], index: number): T => {
    const value = values[index % values.length];
    if (value === undefined) throw new Error("cannot cycle an empty array");
    return value;
  };

  // This session occurs before the participant's first screen-state event but
  // on a day with exactly one distinct app. The participant is nevertheless
  // screen-capable later in the file. It is therefore a deterministic witness
  // for the no-screen-witness qualification threshold: n=0 credits the alive
  // interval while n=2 rejects it.
  if (profile.injectInfluenceProbes) {
    const noWitnessApp = pickClass("catalog");
    const noWitnessStart = cursor - 24 * 60 * 60 * 1000;
    emit(noWitnessApp, "Activity Resumed", primaryTimezone, noWitnessStart);
    emit(noWitnessApp, "Activity Paused", primaryTimezone, noWitnessStart + 10 * 60_000);
    features.add("influence-probe:no-screen-witness-day");
  }

  emit(system, "Screen Interactive", primaryTimezone);
  for (let index = 0; index < profile.sessionCount; index += 1) {
    const appClass = cycleAt(appClassCycle, index);
    const app = pickClass(appClass);
    const timezone = cycleAt(profile.timezones, index);
    const duration = cycleAt(durationSeconds, index) * 1000;
    const resumed = index % 2 === 0 ? "Activity Resumed" : "Unknown importance: 1";
    const paused = index % 3 === 0 ? "Activity Paused" : "Unknown importance: 2";
    const label =
      profile.injectUnicodeAndQuotedLabels && index % 9 === 0
        ? `Research, "Kids" ☃ ${app.label}`
        : app.label;

    if (index % 8 === 0) emit(system, "Keyguard Hidden", timezone, cursor - 500);
    emit(app, resumed, timezone, cursor, label);

    if (profile.injectOverlaps && index % 7 === 0) {
      const overlapping = pickClass(cycleAt(appClassCycle, index + 1));
      emit(overlapping, "Activity Resumed", timezone, cursor + 500, overlapping.label);
      emit(overlapping, "Activity Paused", timezone, cursor + Math.max(1_000, duration / 2));
      features.add("overlapping-sessions");
    }

    const omitStop = profile.injectLongAndMissingStops && index % 13 === 0;
    const longDuration = profile.injectLongAndMissingStops && index % 17 === 0;
    const stoppedAt = cursor + (longDuration ? 13 * 60 * 60 * 1000 : duration);
    if (!omitStop) {
      const closeType = index % 5 === 0 ? "Activity Stopped" : paused;
      emit(
        app,
        closeType,
        timezone,
        stoppedAt,
        label,
        index % 10 === 0 ? formatTimestamp(cursor) : "",
        index % 10 === 0 ? formatTimestamp(stoppedAt) : "",
      );
    } else {
      features.add("missing-stop-events");
    }
    if (longDuration) features.add("long-duration-threshold-crossings");

    if (index % 11 === 0) {
      emit(app, "Custom Foreground", timezone, stoppedAt + 1_000, label);
      features.add("remappable-interaction-types");
    }
    if (index % 13 === 0) {
      emit(app, "Usage Stat", timezone, stoppedAt + 2_000, label);
      features.add("removable-interaction-types");
    }
    if (profile.injectExactDuplicates && index % 9 === 0) {
      const lastRow = rows[rows.length - 1];
      if (lastRow !== undefined) {
        rows.push([...lastRow]);
        features.add("exact-duplicate-rows");
      }
    }
    if (profile.injectDuplicateTimestamps && index % 6 === 0) {
      const duplicateTimeApp = pickClass("catalog");
      emit(duplicateTimeApp, "Notification Seen", timezone, stoppedAt, duplicateTimeApp.label);
      features.add("duplicate-event-timestamps");
    }
    if (index % 8 === 0) {
      emit(system, "Screen Non-Interactive", timezone, stoppedAt + 3_000);
      emit(system, "Screen Interactive", timezone, stoppedAt + 20_000);
    }
    cursor = stoppedAt + 30_000 + Math.floor(random() * 10 * 60_000);
  }

  if (profile.injectInfluenceProbes) {
    const probeApp = pickClass("catalog");
    const secondProbeApp = (byClass.get("catalog") ?? []).find(
      (candidate) => candidate.packageName !== probeApp.packageName,
    ) ?? pickClass("unknown");
    const timezone = primaryTimezone;
    let probeCursor = cursor + 60_000;

    // Two compatible starts and one stop expose stop-event reuse. Reuse closes
    // both starts at the pause; non-reuse closes only the nearest start.
    emit(probeApp, "Activity Resumed", timezone, probeCursor);
    emit(probeApp, "Activity Resumed", timezone, probeCursor + 60_000);
    emit(probeApp, "Activity Paused", timezone, probeCursor + 5 * 60_000);
    probeCursor += 10 * 60_000;
    features.add("influence-probe:stop-event-reuse");

    // A fallback Activity Stopped beyond the configured 12-hour duration
    // threshold is accepted only when fallback-threshold enforcement is off.
    emit(probeApp, "Activity Resumed", timezone, probeCursor);
    emit(probeApp, "Activity Stopped", timezone, probeCursor + 13 * 60 * 60_000);
    probeCursor += 13 * 60 * 60_000 + 10 * 60_000;
    features.add("influence-probe:fallback-threshold");

    // This mirrors the matcher's teardown-grace unit witness. The second
    // resume follows a same-app pause by one second; a fallback stop follows
    // one second later. Positive proximity leaves it open for the genuine
    // pause, while zero proximity accepts the teardown stop.
    emit(probeApp, "Activity Resumed", timezone, probeCursor);
    emit(probeApp, "Activity Paused", timezone, probeCursor + 10_000);
    emit(probeApp, "Activity Resumed", timezone, probeCursor + 11_000);
    emit(probeApp, "Activity Stopped", timezone, probeCursor + 12_000);
    emit(probeApp, "Activity Paused", timezone, probeCursor + 120_000);
    probeCursor += 5 * 60_000;
    features.add("influence-probe:teardown-proximity");

    // In non-concurrent mode, a different app's resume is a configurable
    // other-app stop. With an empty stop set the first app remains open.
    emit(probeApp, "Activity Resumed", timezone, probeCursor);
    emit(secondProbeApp, "Activity Resumed", timezone, probeCursor + 5 * 60_000);
    emit(secondProbeApp, "Activity Paused", timezone, probeCursor + 10 * 60_000);
    probeCursor += 15 * 60_000;
    features.add("influence-probe:other-app-stop");

    // When timestamp correction is explicitly disabled, these two different
    // events form a genuine zero-duration session for the output filter.
    emit(probeApp, "Activity Resumed", timezone, probeCursor);
    emit(probeApp, "Activity Paused", timezone, probeCursor);
    probeCursor += 5 * 60_000;
    features.add("influence-probe:zero-duration-session");

    // Keep the last meaningful activity far outside both manual-lock and
    // auto-lock windows, then place Keyguard Shown one second before screen
    // off. Only a non-zero keyguard-near-stop tolerance classifies it as a
    // probable manual lock.
    emit(system, "Screen Non-Interactive", timezone, probeCursor);
    emit(system, "Screen Interactive", timezone, probeCursor + 10_000);
    emit(probeApp, "Activity Resumed", timezone, probeCursor + 20_000);
    emit(system, "Keyguard Shown", timezone, probeCursor + 619_000);
    emit(system, "Screen Non-Interactive", timezone, probeCursor + 620_000);
    probeCursor += 15 * 60_000;
    features.add("influence-probe:keyguard-near-stop");

    // Shared-device compliance has two non-degenerate daily ratios: 80%
    // (separates 70 from 100) and 50% (separates 0 from 70). Empty usernames
    // become explicit unknown/None attribution under the shared-device rule.
    emit(probeApp, "Activity Resumed", timezone, probeCursor);
    emit(probeApp, "Activity Paused", timezone, probeCursor + 8 * 60_000);
    emit(secondProbeApp, "Activity Resumed", timezone, probeCursor + 9 * 60_000, secondProbeApp.label, "", "", "");
    emit(secondProbeApp, "Activity Paused", timezone, probeCursor + 11 * 60_000, secondProbeApp.label, "", "", "");
    probeCursor += 24 * 60 * 60_000;
    emit(probeApp, "Activity Resumed", timezone, probeCursor);
    emit(probeApp, "Activity Paused", timezone, probeCursor + 2 * 60_000);
    emit(secondProbeApp, "Activity Resumed", timezone, probeCursor + 3 * 60_000, secondProbeApp.label, "", "", "");
    emit(secondProbeApp, "Activity Paused", timezone, probeCursor + 5 * 60_000, secondProbeApp.label, "", "", "");
    probeCursor += 10 * 60_000;
    features.add("influence-probe:compliance-thresholds");

    cursor = probeCursor;
  }
  emit(system, "Device Shutdown", primaryTimezone, cursor);
  if (profile.injectUnicodeAndQuotedLabels) features.add("quoted-and-unicode-labels");
  if (profile.timezones.length > 1) features.add("mixed-timezone-rows");

  if (profile.shuffleRows) {
    for (let index = rows.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      const rowAtIndex = rows[index];
      const rowAtSwap = rows[swap];
      if (rowAtIndex !== undefined && rowAtSwap !== undefined) {
        rows[index] = rowAtSwap;
        rows[swap] = rowAtIndex;
      }
    }
    features.add("out-of-order-input");
  }
  const csv = `${[RAW_HEADERS, ...rows].map(encodeRow).join("\n")}\n`;
  return {
    id: profile.id,
    seed: profile.seed,
    participantId,
    csv,
    rowCount: rows.length,
    timezones: [...profile.timezones],
    usedPackages: [...usedPackages].sort(),
    representedAppClasses: [...represented].sort(),
    injectedFeatures: [...features].sort(),
  };
}
