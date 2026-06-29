// Standalone parity test for the Rust screen-usage kernel.
// Compares Rust derive_screen_usage_sessions against the TS reference
// (deriveScreenUsageSessions in browserPipeline.ts) on a fixture with
// real screen events.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const KERNEL_PKG = path.resolve(
  SCRIPT_DIR,
  "../src/wasm/chronicle_chrono_kernel_wasm/pkg",
);
const DEFAULTS_DIR = path.resolve(SCRIPT_DIR, "../src/assets/defaults");

type ScreenSessionRow = {
  start_index: number;
  start_timestamp_ns: bigint;
  stop_timestamp_ns: bigint;
  duration_seconds: number | null;
  foreground_app: string;
  end_reason: string;
  end_reason_confidence: number;
  stop_event_type: string;
  last_activity_ns: bigint;
  tail_gap_seconds: number | null;
  apps_forcing_label: string;
  lock_screen_only: number;
  timezone: string;
};

const NORMALIZE_INTERACTION_TYPE: Record<string, string> = {
  "Instance of Usage for an App": "App Usage",
  "Screen Usage": "Screen Usage",
  "Activity Resumed for a Filtered App": "Filtered App Resumed",
  "Activity Paused for a Filtered App": "Filtered App Paused",
  "Instance of Usage for a Filtered App": "Filtered App Usage",
  "Missing End of Usage after an App Starts Being Used": "End of Usage Missing",
  "Unknown importance: 1": "Activity Resumed",
  "Move to Foreground": "Activity Resumed",
  "Unknown importance: 2": "Activity Paused",
  "Move to Background": "Activity Paused",
  "Unknown importance: 3": "End of Day",
  "Unknown importance: 4": "Continue Previous Day",
  "Unknown importance: 5": "Configuration Change",
  "Unknown importance: 6": "System Interaction",
  "Unknown importance: 7": "User Interaction",
  "Unknown importance: 8": "Shortcut Invocation",
  "Unknown importance: 9": "Chooser Action",
  "Unknown importance: 10": "Notification Seen",
  "Unknown importance: 11": "Standby Bucket Changed",
  "Unknown importance: 12": "Notification Interruption",
  "Unknown importance: 13": "Slice Pinned Priv",
  "Unknown importance: 14": "Slice Pinned App",
  "Unknown importance: 15": "Screen Interactive",
  "Unknown importance: 16": "Screen Non-Interactive",
  "Unknown importance: 17": "Keyguard Shown",
  "Unknown importance: 18": "Keyguard Hidden",
  "Unknown importance: 19": "Foreground Service Start",
  "Unknown importance: 20": "Foreground Service Stop",
  "Unknown importance: 21": "Continuing Foreground Service",
  "Unknown importance: 22": "Rollover Foreground Service",
  "Unknown importance: 23": "Activity Stopped",
  "Unknown importance: 24": "Activity Destroyed",
  "Unknown importance: 25": "Flush to Disk",
  "Unknown importance: 26": "Device Shutdown",
  "Unknown importance: 27": "Device Startup",
  "Unknown importance: 28": "User Unlocked",
  "Unknown importance: 29": "User Stopped",
  "Unknown importance: 30": "Locus ID Set",
  "Unknown importance: 31": "App Component Used",
};
const normalize = (s: string) => NORMALIZE_INTERACTION_TYPE[s] ?? s;

const SCREEN_START_EVENTS = new Set(["Screen Interactive", "Screen Interactive/Keyguard Shown"]);
const SCREEN_STOP_EVENTS = new Set([
  "Screen Non-Interactive",
  "Device Screen Off",
  "Screen Non-Interactive/Keyguard Hidden",
]);
const LOCK_SCREEN_EVENTS = new Set(["Keyguard Shown", "Screen Interactive/Keyguard Shown"]);
const UNLOCK_EVENTS = new Set([
  "Keyguard Hidden",
  "User Unlocked",
  "Screen Non-Interactive/Keyguard Hidden",
]);
const FOREGROUND_EVENTS = new Set(["Activity Resumed", "Filtered App Resumed"]);
const MEANINGFUL_ACTIVITY_EVENTS = new Set([
  "Activity Resumed",
  "Filtered App Resumed",
  "User Interaction",
  "Shortcut Invocation",
  "Chooser Action",
  "App Component Used",
  "User Unlocked",
  "Keyguard Hidden",
]);

type State = {
  startIndex: number;
  startTsNs: bigint;
  startTz: string;
  lockSeen: boolean;
  unlockedSeen: boolean;
  fgPkg: string | null;
  lastMeaningfulNs: bigint | null;
  lastMeaningfulPkg: string | null;
};

function parseTsTimestampNs(value: string): bigint | null {
  if (!value) return null;
  let n = value.replace("T", " ");
  if (n.endsWith("Z")) n = n.slice(0, -1) + "+00:00";
  if (!/[+-]\d{2}:?\d{2}$/.test(n)) {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(n);
    if (!m) return null;
    const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
    if (!Number.isFinite(ms)) return null;
    const fr = m[7] ? BigInt((m[7] + "000000000").slice(0, 9)) : 0n;
    return BigInt(ms) * 1_000_000n + fr;
  }
  const ms = Date.parse(n);
  if (!Number.isFinite(ms)) return null;
  const fm = /\.(\d+)([+-]\d{2}:?\d{2})$/.exec(n);
  const fr = fm ? BigInt((fm[1] + "000000000").slice(0, 9)) % 1_000_000n : 0n;
  return BigInt(ms) * 1_000_000n + fr;
}

const DEFAULTS = {
  autoLockTimeoutSeconds: 120,
  autoLockToleranceSeconds: 30,
  manualLockMaxTailSeconds: 30,
  keyguardNearStopSeconds: 2,
};

function tsScreenUsage(
  ts: bigint[],
  inter: string[],
  pkg: string[],
  tz: string[],
  appsForcing: Map<string, string>,
): ScreenSessionRow[] {
  const n = ts.length;
  const anyStart = inter.some((it) => SCREEN_START_EVENTS.has(it));
  if (!anyStart) return [];
  const keyguardShown = ts
    .filter((_, i) => LOCK_SCREEN_EVENTS.has(inter[i]!))
    .slice()
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const sessions: ScreenSessionRow[] = [];
  let state: State | null = null;

  const buildSession = (
    s: State,
    stopTsNs: bigint | null,
    stopEventType: string | null,
  ) => {
    const fgPkg = s.fgPkg ?? "";
    const stopTs = stopTsNs ?? -1n;
    const durSecs =
      stopTsNs == null ? null : Number(stopTsNs - s.startTsNs) / 1_000_000_000;
    const tailGap =
      stopTsNs == null || s.lastMeaningfulNs == null
        ? null
        : Number(stopTsNs - s.lastMeaningfulNs) / 1_000_000_000;
    const lastPkg = s.lastMeaningfulPkg ?? s.fgPkg ?? "";
    const appsLabel = appsForcing.get(lastPkg) ?? "";

    let endReason: string;
    let confidence: number;
    let lockOnly = 0;

    if (stopTsNs == null) {
      endReason = "missing_stop";
      confidence = 1.0;
    } else if (s.lockSeen && !s.unlockedSeen && s.fgPkg == null) {
      endReason = "lock_screen_only";
      confidence = 0.95;
      lockOnly = 1;
    } else if (tailGap != null) {
      if (appsLabel && tailGap > DEFAULTS.autoLockTimeoutSeconds) {
        endReason = "app_kept_awake_or_extended";
        confidence = 0.9;
      } else if (tailGap <= DEFAULTS.manualLockMaxTailSeconds) {
        endReason = "probable_manual_lock";
        confidence = 0.85;
      } else if (
        Math.abs(tailGap - DEFAULTS.autoLockTimeoutSeconds) <=
        DEFAULTS.autoLockToleranceSeconds
      ) {
        endReason = "probable_auto_lock";
        confidence = 0.9;
      } else if (
        s.lockSeen &&
        keyguardShown.some(
          (kg) =>
            Math.abs(Number(kg - stopTs!) / 1_000_000_000) <=
            DEFAULTS.keyguardNearStopSeconds,
        )
      ) {
        endReason = "probable_manual_lock";
        confidence = 0.7;
      } else {
        endReason = "extended_idle_or_unknown";
        confidence = 0.5;
      }
    } else if (
      s.lockSeen &&
      keyguardShown.some(
        (kg) =>
          Math.abs(Number(kg - stopTs!) / 1_000_000_000) <=
          DEFAULTS.keyguardNearStopSeconds,
      )
    ) {
      endReason = "probable_manual_lock";
      confidence = 0.7;
    } else {
      endReason = "unknown";
      confidence = 0.25;
    }

    sessions.push({
      start_index: s.startIndex,
      start_timestamp_ns: s.startTsNs,
      stop_timestamp_ns: stopTs,
      duration_seconds: durSecs,
      foreground_app: fgPkg,
      end_reason: endReason,
      end_reason_confidence: confidence,
      stop_event_type: stopEventType ?? "",
      last_activity_ns: s.lastMeaningfulNs ?? -1n,
      tail_gap_seconds: tailGap,
      apps_forcing_label: appsLabel,
      lock_screen_only: lockOnly,
      timezone: s.startTz,
    });
  };

  for (let i = 0; i < n; i += 1) {
    const it = inter[i]!;
    const p = pkg[i] || null;
    if (SCREEN_START_EVENTS.has(it)) {
      if (state == null) {
        state = {
          startIndex: i,
          startTsNs: ts[i]!,
          startTz: tz[i]!,
          lockSeen: LOCK_SCREEN_EVENTS.has(it),
          unlockedSeen: false,
          fgPkg: null,
          lastMeaningfulNs: null,
          lastMeaningfulPkg: null,
        };
      }
      continue;
    }
    if (state == null) continue;
    if (LOCK_SCREEN_EVENTS.has(it)) state.lockSeen = true;
    if (UNLOCK_EVENTS.has(it)) state.unlockedSeen = true;
    if (FOREGROUND_EVENTS.has(it)) state.fgPkg = p;
    if (MEANINGFUL_ACTIVITY_EVENTS.has(it)) {
      state.lastMeaningfulNs = ts[i]!;
      state.lastMeaningfulPkg = p ?? state.fgPkg;
    }
    if (SCREEN_STOP_EVENTS.has(it)) {
      buildSession(state, ts[i]!, it);
      state = null;
    }
  }
  if (state != null) buildSession(state, null, null);
  return sessions;
}

async function loadKernel() {
  const m = await import(path.join(KERNEL_PKG, "chronicle_chrono_kernel_wasm.js"));
  const wasm = await readFile(path.join(KERNEL_PKG, "chronicle_chrono_kernel_wasm_bg.wasm"));
  await m.default({ module_or_path: wasm });
  return (
    ts: BigInt64Array,
    inter: string[],
    pkg: string[],
    tz: string[],
    appsKeys: string[],
    appsValues: string[],
  ) =>
    m.derive_screen_usage_sessions(
      ts, inter, pkg, tz, appsKeys, appsValues,
      DEFAULTS.autoLockTimeoutSeconds,
      DEFAULTS.autoLockToleranceSeconds,
      DEFAULTS.manualLockMaxTailSeconds,
      DEFAULTS.keyguardNearStopSeconds,
    ) as ScreenSessionRow[];
}

async function loadAppsForcing(): Promise<Map<string, string>> {
  const text = await readFile(
    path.join(DEFAULTS_DIR, "Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv"),
    "utf-8",
  );
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const m = new Map<string, string>();
  for (const row of parsed.data) {
    const k = row.app_package_name?.trim();
    const v = row.label?.trim() ?? "";
    if (k) m.set(k, v);
  }
  return m;
}

async function main() {
  const fixtures = process.argv.slice(2);
  if (fixtures.length === 0) {
    throw new Error("Usage: vite-node ... <csv> [csv...]");
  }
  const k = await loadKernel();
  const appsForcing = await loadAppsForcing();
  const appsKeys = [...appsForcing.keys()];
  const appsValues = appsKeys.map((kk) => appsForcing.get(kk)!);

  let totalRust = 0;
  let totalTs = 0;
  let totalSessions = 0;
  let firstDiff: string | null = null;

  for (const f of fixtures) {
    const csv = await readFile(f, "utf-8");
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
    // Sort by event_timestamp_ns first (the screen-usage stage runs after sort/dedup in the pipeline)
    const rows: Array<{ ts: bigint; inter: string; pkg: string; tz: string }> = [];
    for (const r of parsed.data) {
      const ev = (r.event_timestamp ?? "").trim();
      if (!ev) continue;
      const ns = parseTsTimestampNs(ev);
      if (ns === null) continue;
      rows.push({
        ts: ns,
        inter: normalize(r.interaction_type ?? ""),
        pkg: r.app_package_name ?? "",
        tz: r.timezone ?? "",
      });
    }
    rows.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    const ts: bigint[] = rows.map((r) => r.ts);
    const inter: string[] = rows.map((r) => r.inter);
    const pkg: string[] = rows.map((r) => r.pkg);
    const tz: string[] = rows.map((r) => r.tz);

    const t1 = performance.now();
    const tsResult = tsScreenUsage(ts, inter, pkg, tz, appsForcing);
    const tsMs = performance.now() - t1;

    const tsArr = BigInt64Array.from(ts);
    const t2 = performance.now();
    const rustResult = k(tsArr, inter, pkg, tz, appsKeys, appsValues);
    const rustMs = performance.now() - t2;

    let diff = 0;
    let firstDivergence: string | null = null;
    if (tsResult.length !== rustResult.length) {
      diff = Math.abs(tsResult.length - rustResult.length);
      firstDivergence = `length mismatch: ts=${tsResult.length} rust=${rustResult.length}`;
    } else {
      for (let i = 0; i < tsResult.length; i += 1) {
        const a = tsResult[i]!;
        const b = rustResult[i]!;
        const fields: (keyof ScreenSessionRow)[] = [
          "start_index", "start_timestamp_ns", "stop_timestamp_ns",
          "foreground_app", "end_reason", "end_reason_confidence",
          "stop_event_type", "last_activity_ns", "lock_screen_only", "timezone",
        ];
        for (const fld of fields) {
          const av = a[fld];
          const bv = b[fld];
          if (av !== bv) {
            diff += 1;
            if (firstDivergence == null) {
              firstDivergence = `session ${i} field ${String(fld)}: ts=${JSON.stringify(av)} rust=${JSON.stringify(bv)}`;
            }
          }
        }
        // duration/tail are floats; compare with epsilon
        const checkFloat = (af: number | null, bf: number | null, name: string) => {
          if (af == null && bf == null) return;
          if (af == null || bf == null) {
            diff += 1;
            if (firstDivergence == null) firstDivergence = `session ${i} field ${name}: ts=${af} rust=${bf}`;
            return;
          }
          if (Math.abs(af - bf) > 1e-6) {
            diff += 1;
            if (firstDivergence == null) firstDivergence = `session ${i} field ${name}: ts=${af} rust=${bf}`;
          }
        };
        checkFloat(a.duration_seconds, b.duration_seconds, "duration_seconds");
        checkFloat(a.tail_gap_seconds, b.tail_gap_seconds, "tail_gap_seconds");
      }
    }

    totalRust += rustMs;
    totalTs += tsMs;
    totalSessions += rustResult.length;
    if (firstDiff == null && firstDivergence) firstDiff = `${path.basename(f)}: ${firstDivergence}`;

    process.stderr.write(
      `[${path.basename(f)}] events=${rows.length} sessions=${rustResult.length} ts=${tsMs.toFixed(1)}ms rust=${rustMs.toFixed(1)}ms diff=${diff}\n`,
    );
  }

  process.stderr.write(`\nTotal: ts=${totalTs.toFixed(1)}ms rust=${totalRust.toFixed(1)}ms (x${(totalTs / totalRust).toFixed(2)}) sessions=${totalSessions}\n`);
  if (firstDiff) process.stderr.write(`First divergence: ${firstDiff}\n`);
}

await main();
