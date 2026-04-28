/**
 * Browser plotting benchmark.
 *
 * Mocks OffscreenCanvas + the 2d context (no-op drawing),
 * generates synthetic PlotRow data, and times generateAllPlots.
 *
 * Usage:
 *   npx tsx scripts/bench_plotting.mts
 */

import { performance } from "node:perf_hooks";

// ── Mock OffscreenCanvas (must be installed before importing plotGenerator) ──

const mockCtx: Record<string, unknown> = {
  fillStyle: "",
  strokeStyle: "",
  globalAlpha: 1,
  lineWidth: 1,
  font: "",
  textAlign: "left",
  textBaseline: "alphabetic",
  fillRect: () => {},
  strokeRect: () => {},
  clearRect: () => {},
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  stroke: () => {},
  fill: () => {},
  fillText: () => {},
  setLineDash: () => {},
};

class MockOffscreenCanvas {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext(_type: string) {
    return mockCtx;
  }
  convertToBlob(_opts?: unknown): Promise<Blob> {
    return Promise.resolve(new Blob([]));
  }
}

// @ts-ignore
globalThis.OffscreenCanvas = MockOffscreenCanvas;

// ── Import after mock is in place ────────────────────────────────────────────

// Adjust relative import to match web/src layout when run from web/
const { generateAllPlots } = await import("../src/lib/plotGenerator.js");

// ── Synthetic data generation ─────────────────────────────────────────────────

const CATS = [
  "Games",
  "Social & Communication",
  "Entertainment",
  "Video Players (e.g. YouTube)",
  "Uncategorised",
];
const APPS = Array.from(
  { length: 20 },
  (_, i) => `com.example.app${String(i).padStart(3, "0")}`,
);

type SyntheticRow = {
  participant_id: string;
  date: string;
  start_timestamp_ns: bigint;
  stop_timestamp_ns: bigint;
  event_timestamp_ns: bigint;
  interaction_type: string;
  broad_app_category: string;
  app_package_name: string;
};

function makeSyntheticRows(
  nParticipants = 5,
  nDays = 90,
  sessionsPerDay = 30,
): SyntheticRow[] {
  const rows: SyntheticRow[] = [];
  const BASE_MS = 1_735_689_600_000; // 2025-01-01 UTC
  for (let p = 0; p < nParticipants; p++) {
    for (let d = 0; d < nDays; d++) {
      const dayMs = BASE_MS + d * 86_400_000;
      const isoDate = new Date(dayMs).toISOString().slice(0, 10);
      for (let s = 0; s < sessionsPerDay; s++) {
        const startMs = dayMs + s * 1_200_000; // every 20 min
        const stopMs = startMs + 120_000; // 2 min sessions
        const startNs = BigInt(startMs) * 1_000_000n;
        const stopNs = BigInt(stopMs) * 1_000_000n;
        rows.push({
          participant_id: `P${String(p + 1).padStart(3, "0")}`,
          date: isoDate,
          start_timestamp_ns: startNs,
          stop_timestamp_ns: stopNs,
          event_timestamp_ns: startNs,
          interaction_type: "App Usage",
          broad_app_category: CATS[s % CATS.length]!,
          app_package_name: APPS[s % APPS.length]!,
        });
      }
    }
  }
  return rows;
}

const N_PARTICIPANTS = 5;
const N_DAYS = 90;
const SESSIONS_PER_DAY = 30;
const rows = makeSyntheticRows(N_PARTICIPANTS, N_DAYS, SESSIONS_PER_DAY);
console.error(
  `Rows: ${rows.length}  participants: ${N_PARTICIPANTS}  days: ${N_DAYS}  sessions/day: ${SESSIONS_PER_DAY}`,
);

const opts = { includeFilteredAppUsageInPlots: false };
const TZ = "America/Chicago";

// ── Warmup ────────────────────────────────────────────────────────────────────
await generateAllPlots(rows as never, TZ, opts);

// ── Timed runs ────────────────────────────────────────────────────────────────
const N_RUNS = 5;
const times: number[] = [];
for (let i = 0; i < N_RUNS; i++) {
  const t0 = performance.now();
  await generateAllPlots(rows as never, TZ, opts);
  times.push(performance.now() - t0);
}

const mean = times.reduce((a, b) => a + b, 0) / N_RUNS;
const min = Math.min(...times);
const max = Math.max(...times);
console.log(
  `mean=${mean.toFixed(0)}ms  min=${min.toFixed(0)}ms  max=${max.toFixed(0)}ms  runs=[${times.map((t) => t.toFixed(0)).join(",")}]ms`,
);
