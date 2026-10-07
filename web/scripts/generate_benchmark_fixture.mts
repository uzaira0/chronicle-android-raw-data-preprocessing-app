import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import Papa from "papaparse";

import {
  buildSyntheticCatalog,
  generateSyntheticChronicleCorpus,
  type SyntheticApp,
  type SyntheticCatalog,
} from "../src/testSupport/syntheticChronicleCorpus";

function positiveInteger(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]) {
  let output = path.resolve("../.tmp-benchmark/chronicle-synthetic.csv");
  let sessions = 200;
  let seed = 0x80c0ffee;
  // Overlong and unterminated sessions are the pathology the reconstruction
  // rules disagree about. It stays ON by default so every existing caller keeps
  // producing the same bytes; turning it off is what makes a controlled
  // one-pathology contrast possible (see measure_binding_multiverse.mts).
  let injectLongAndMissingStops = true;
  // --realistic: a dense day-bounded stream shaped like a real export (see
  // generateRealisticCorpus). The default corpus is the pathology corpus: it
  // is nearly all app events at ~24 rows a day, so its row count buys years
  // of calendar, never density.
  let realistic = false;
  let days = 30;
  let rowsPerDay = 1_000;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--output" && next) {
      output = path.resolve(next);
      index += 1;
    } else if (token === "--sessions" && next) {
      sessions = positiveInteger(token, next);
      index += 1;
    } else if (token === "--seed" && next) {
      seed = positiveInteger(token, next);
      index += 1;
    } else if (token === "--realistic") {
      realistic = true;
    } else if (token === "--days" && next) {
      days = positiveInteger(token, next);
      index += 1;
    } else if (token === "--rows-per-day" && next) {
      rowsPerDay = positiveInteger(token, next);
      index += 1;
    } else if (token === "--no-long-and-missing-stops") {
      injectLongAndMissingStops = false;
    } else {
      throw new Error(`unknown or incomplete argument: ${token ?? ""}`);
    }
  }
  return { output, sessions, seed, injectLongAndMissingStops, realistic, days, rowsPerDay };
}

// Measured 2026-09-30 over the 124 real TECH/GNSM personal-Android raw exports
// (1,347,103 events; aggregates only): median file 5,752 rows over 14 days,
// p90 30,018 rows / 30 days, max 73,568 rows / 84 days; 391 rows per day at the
// median, 6,131 at the max.
// Share of all events that are app transitions (Move to Foreground/Background,
// Activity Resumed/Paused/Stopped) and screen-on events.
const APP_TRANSITION_SHARE = 0.294;
const SCREEN_ON_SHARE = 0.0062;
// Activity Resumed per Move to Foreground (61,996 / 109,054).
const ACTIVITY_EVENTS_PER_SESSION = 0.57;
// Keyguard Shown or Hidden per screen-on (4,443 / 8,389).
const KEYGUARD_PER_BOUT = 0.53;
// Every other event type, weighted by thousands of events.
const NOISE_TYPES: Array<[string, number]> = [
  ["Unknown importance: 11", 377], ["Unknown importance: 12", 121],
  ["Unknown importance: 23", 95], ["Unknown importance: 19", 67],
  ["Unknown importance: 20", 67], ["Unknown importance: 10", 44],
  ["Configuration Change", 37], ["User Interaction", 22],
  ["Foreground Service Start", 20], ["Foreground Service Stop", 20],
  ["Unknown importance: 15", 18], ["Unknown importance: 16", 17],
  ["Unknown importance: 18", 8], ["Unknown importance: 17", 8],
  ["Unknown importance: 14", 1.4], ["Unknown importance: 28", 0.8],
  ["Shortcut Invocation", 0.5], ["Unknown importance: 26", 0.5],
  ["Unknown importance: 27", 0.4], ["Unknown importance: 9", 0.4],
];
// Share of events in each local hour, 00 to 23.
const HOUR_SHARES = [
  0.018, 0.013, 0.012, 0.011, 0.01, 0.014, 0.028, 0.042, 0.047, 0.052, 0.058, 0.06,
  0.061, 0.051, 0.06, 0.058, 0.067, 0.062, 0.063, 0.057, 0.05, 0.045, 0.036, 0.025,
];
// Move to Foreground -> Move to Background: median 4 s, p90 119 s, p99 2,226 s,
// which is log-normal with mu = ln 4 s and sigma = 2.65.
const SESSION_MEDIAN_MS = 4_000;
const SESSION_SIGMA = 2.65;

const HOUR_MS = 60 * 60 * 1_000;
const RAW_HEADERS = [
  "study_id", "participant_id", "possible_device_model", "username",
  "application_label", "interaction_type", "app_package_name", "event_timestamp",
  "start_timestamp", "stop_timestamp", "timezone",
];

function generateRealisticCorpus(
  catalog: SyntheticCatalog,
  seed: number,
  days: number,
  rowsPerDay: number,
): { csv: string; rowCount: number } {
  let state = seed >>> 0;
  const random = () => {
    state = Math.imul(state ^ (state >>> 16), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state = (state ^ (state >>> 16)) >>> 0;
    return state / 0x1_0000_0000;
  };
  const weighted = <T,>(items: ReadonlyArray<readonly [T, number]>): T => {
    let left = random() * items.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [item, weight] of items) {
      left -= weight;
      if (left <= 0) return item;
    }
    return items[items.length - 1]![0];
  };
  const hours = HOUR_SHARES.map((share, hour) => [hour, share] as const);
  const atRandomHour = (dayStart: number) =>
    dayStart + weighted(hours) * HOUR_MS + random() * HOUR_MS;

  // A participant's repertoire: 30 catalog apps plus two video apps and one
  // filtered app (a launcher-like package), Zipf-weighted by rank.
  const pick = (appClass: SyntheticApp["classes"][number], count: number) => {
    const candidates = catalog.apps.filter((app) => app.classes.includes(appClass));
    return Array.from({ length: count }, () => candidates[Math.floor(random() * candidates.length)]!);
  };
  const repertoire = [...pick("filtered", 1), ...pick("catalog", 30), ...pick("forcing-screen-open", 2)];
  const apps = repertoire.map((app, rank) => [app, 1 / (rank + 1)] as const);
  const system: SyntheticApp = { packageName: "android", label: "System", classes: [] };

  const events: Array<[number, string, SyntheticApp]> = [];
  // 2026-01-05 00:00 America/Chicago. A window past 2026-03-08 crosses DST.
  const firstDay = Date.parse("2026-01-05T06:00:00Z");
  let cursor = firstDay;
  for (let day = 0; day < days; day += 1) {
    const dayStart = firstDay + day * 24 * HOUR_MS;
    const target = Math.round(rowsPerDay * (0.7 + 0.6 * random()));
    const dayFirst = events.length;
    const sessions = Math.max(1, Math.round(
      (target * APP_TRANSITION_SHARE) / (2 + 3 * ACTIVITY_EVENTS_PER_SESSION),
    ));
    const bouts = Math.max(2, Math.round(target * SCREEN_ON_SHARE));
    const boutStarts = Array.from({ length: bouts }, () => atRandomHour(dayStart)).sort((a, b) => a - b);
    boutStarts.forEach((boutStart, bout) => {
      let t = Math.max(boutStart, cursor + 5_000);
      events.push([t, "Screen Interactive", system]);
      if (random() < KEYGUARD_PER_BOUT) events.push([t + 300, "Keyguard Hidden", system]);
      t += 1_000;
      const count = Math.floor(sessions / bouts) + (bout < sessions % bouts ? 1 : 0);
      for (let session = 0; session < count; session += 1) {
        const app = weighted(apps);
        const normal = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
        const duration = Math.min(3 * HOUR_MS, Math.max(100, SESSION_MEDIAN_MS * Math.exp(SESSION_SIGMA * normal)));
        events.push([t, "Move to Foreground", app]);
        const activity = random() < ACTIVITY_EVENTS_PER_SESSION;
        if (activity) events.push([t + 20, "Activity Resumed", app]);
        if (activity) events.push([t + duration - 10, "Activity Paused", app]);
        events.push([t + duration, "Move to Background", app]);
        if (activity) events.push([t + duration + 400, "Activity Stopped", app]);
        t += duration + 100 + random() * 3_000;
      }
      if (random() < KEYGUARD_PER_BOUT) events.push([t, "Keyguard Shown", system]);
      events.push([t + 500, "Screen Non-interactive", system]);
      cursor = t + 500;
    });
    for (let noise = events.length - dayFirst; noise < target; noise += 1) {
      const type = weighted(NOISE_TYPES);
      events.push([atRandomHour(dayStart), type, type === "Configuration Change" ? system : weighted(apps)]);
    }
  }
  events.sort((left, right) => left[0] - right[0]);
  const participantId = `P-REAL-${seed.toString(16).padStart(8, "0")}`;
  const data = events.map(([ms, type, app]) => [
    "synthetic-realistic-benchmark", participantId, "Synthetic Android", "Target Child",
    app.label, type, app.packageName,
    `${new Date(Math.round(ms)).toISOString().slice(0, 23).replace("T", " ")}000`,
    "", "", "America/Chicago",
  ]);
  return { csv: `${Papa.unparse({ fields: RAW_HEADERS, data }, { newline: "\n" })}\n`, rowCount: data.length };
}

const args = parseArgs(process.argv.slice(2));
const defaults = path.resolve("src/assets/defaults");
const [codebookCsv, filterCsv, backgroundCsv, forcingScreenOpenCsv] = await Promise.all([
  readFile(path.join(defaults, "unified_app_codebook.csv"), "utf8"),
  readFile(
    path.join(defaults, "Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv"),
    "utf8",
  ),
  readFile(
    path.join(defaults, "Chronicle_Android_raw_data_preprocessor_background_apps.csv"),
    "utf8",
  ),
  readFile(
    path.join(defaults, "Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv"),
    "utf8",
  ),
]);
const catalog = buildSyntheticCatalog({
  codebookCsv,
  filterCsv,
  backgroundCsv,
  forcingScreenOpenCsv,
});
const corpus = args.realistic
  ? generateRealisticCorpus(catalog, args.seed, args.days, args.rowsPerDay)
  : generateSyntheticChronicleCorpus(
      {
        id: `performance-${args.sessions}`,
        seed: args.seed,
        sessionCount: args.sessions,
        startUtc: "2026-01-01T00:00:00Z",
        timezones: ["America/Chicago"],
        shuffleRows: false,
        injectExactDuplicates: true,
        injectDuplicateTimestamps: true,
        injectLongAndMissingStops: args.injectLongAndMissingStops,
        injectOverlaps: true,
        injectUnicodeAndQuotedLabels: true,
        injectInfluenceProbes: true,
      },
      catalog,
    );
await mkdir(path.dirname(args.output), { recursive: true });
await writeFile(args.output, corpus.csv);
const bytes = Buffer.byteLength(corpus.csv);
const sha256 = createHash("sha256").update(corpus.csv).digest("hex");
process.stdout.write(
  `${JSON.stringify({
    output: args.output,
    ...(args.realistic
      ? { realistic: true, days: args.days, rowsPerDay: args.rowsPerDay }
      : { sessions: args.sessions }),
    rows: corpus.rowCount,
    bytes,
    sha256: `sha256:${sha256}`,
  })}\n`,
);
