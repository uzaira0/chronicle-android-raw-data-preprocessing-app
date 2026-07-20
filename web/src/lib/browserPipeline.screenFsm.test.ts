import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  FOREGROUND_EVENTS,
  LOCK_SCREEN_EVENTS,
  MEANINGFUL_ACTIVITY_EVENTS,
  SCREEN_START_EVENTS,
  SCREEN_STOP_EVENTS,
  UNLOCK_EVENTS,
  buildClassifiedScreenSessions,
  transitionScreenState,
  walkScreenStateMachine,
} from "@/lib/browserPipeline";
import type { CanonicalRow, ScreenState, ScreenSessionClose } from "@/lib/browserPipeline";
import type { BrowserProcessingOptions } from "@/lib/types";

/**
 * Model tests for the screen state machine (CLOSED —start→ OPEN —stop→ CLOSED
 * with OPEN-state accumulators) and the 8-way end-reason cascade:
 *
 *  1. A hand-enumerated event-effects table is pinned against the exported
 *     category sets — set-membership drift fails here, not silently.
 *  2. Exhaustive {CLOSED, OPEN} × event transition matrix for every event in
 *     the alphabet (including the two dual-category events and uncategorized
 *     passthrough events), asserted against the effects table.
 *  3. Decision-table test for buildClassifiedScreenSessions' end-reason
 *     cascade over tailGap × the four screen_usage_* threshold knobs.
 *  4. fast-check model-based walk: random event sequences through
 *     walkScreenStateMachine vs an independent reference accumulator built
 *     from the effects table.
 */

// ── 1. Hand-enumerated event effects (the spec, written independently) ──────

type EventEffects = {
  start?: true;
  stop?: true;
  lock?: true;
  unlock?: true;
  foreground?: true;
  meaningful?: true;
};

const EVENT_EFFECTS: Record<string, EventEffects> = {
  "Screen Interactive": { start: true },
  // Dual-category: opens the session AND is lock-screen evidence.
  "Screen Interactive/Keyguard Shown": { start: true, lock: true },
  "Screen Non-Interactive": { stop: true },
  "Device Screen Off": { stop: true },
  // Dual-category: closes the session AND is unlock evidence.
  "Screen Non-Interactive/Keyguard Hidden": { stop: true, unlock: true },
  "Keyguard Shown": { lock: true },
  "Keyguard Hidden": { unlock: true, meaningful: true },
  "User Unlocked": { unlock: true, meaningful: true },
  "Activity Resumed": { foreground: true, meaningful: true },
  "Filtered App Resumed": { foreground: true, meaningful: true },
  "User Interaction": { meaningful: true },
  "Shortcut Invocation": { meaningful: true },
  "Chooser Action": { meaningful: true },
  "App Component Used": { meaningful: true },
  // Uncategorized: the walker must pass these through with no effect.
  "Notification Seen": {},
  "Activity Paused": {},
};

const ALPHABET = Object.keys(EVENT_EFFECTS);

describe("event-effects table matches the exported category sets", () => {
  const CATEGORY_SETS: Array<[keyof EventEffects, ReadonlySet<string>]> = [
    ["start", SCREEN_START_EVENTS],
    ["stop", SCREEN_STOP_EVENTS],
    ["lock", LOCK_SCREEN_EVENTS],
    ["unlock", UNLOCK_EVENTS],
    ["foreground", FOREGROUND_EVENTS],
    ["meaningful", MEANINGFUL_ACTIVITY_EVENTS],
  ];

  it("every set member appears in the table with that effect, and vice versa", () => {
    for (const [effect, set] of CATEGORY_SETS) {
      for (const event of set) {
        expect(EVENT_EFFECTS[event]?.[effect], `${event} should have effect "${effect}"`).toBe(true);
      }
      for (const [event, effects] of Object.entries(EVENT_EFFECTS)) {
        expect(
          Boolean(effects[effect]),
          `${event}: table effect "${effect}" vs set membership`,
        ).toBe(set.has(event));
      }
    }
  });
});

// ── Row factory ──────────────────────────────────────────────────────────────

const NS = 1_000_000_000n;
const T0 = 1_772_000_000n * NS; // fixed epoch base; only relative gaps matter

function makeRow(overrides: Partial<CanonicalRow>): CanonicalRow {
  return {
    study_id: "Study",
    participant_id: "P01",
    possible_device_model: "model",
    username: "Target Child",
    application_label: "",
    interaction_type: "Screen Interactive",
    app_package_name: "",
    event_timestamp_ns: T0,
    timezone: "America/Chicago",
    data_time_gap_hours: 0,
    preprocessor_version: "test",
    datetime_of_preprocessing: "2026-01-01 00:00:00 UTC",
    date: "2026-03-07",
    day: 6,
    weekdayMF: 0,
    weekdayMTh: 0,
    weekdaySuTh: 0,
    hour: 10,
    quarter: 1,
    start_timestamp_ns: null,
    stop_timestamp_ns: null,
    duration_seconds: null,
    duration_minutes: null,
    screen_usage_end_reason: null,
    screen_usage_end_reason_confidence: null,
    screen_usage_stop_event_type: null,
    screen_usage_last_activity_timestamp_ns: null,
    screen_usage_tail_gap_seconds: null,
    screen_usage_foreground_app_package: null,
    screen_usage_apps_forcing_screen_open_label: null,
    screen_usage_lock_screen_only: null,
    any_app_usage_flags: "",
    valid_app_new_engage_30s: 0,
    valid_app_new_engage_custom: 0,
    valid_app_switched_app: 0,
    valid_app_usage_time_gap_hours: 0,
    any_app_new_engage_30s: 0,
    any_app_new_engage_custom: 0,
    any_app_switched_app: 0,
    any_app_usage_time_gap_hours: 0,
    genreId_scraped: null,
    __index: 0,
    ...overrides,
  };
}

function freshOpenState(): ScreenState {
  return {
    startIndex: 0,
    startTimestampNs: T0,
    startTimezone: "America/Chicago",
    lockScreenSeen: false,
    unlockedSeen: false,
    foregroundAppPackage: null,
    lastMeaningfulActivityTimestampNs: null,
    lastMeaningfulActivityPackage: null,
  };
}

// ── 2. Exhaustive {CLOSED, OPEN} × event transition matrix ──────────────────

describe("transitionScreenState: exhaustive state × event matrix", () => {
  const PKG = "com.example.app";

  for (const event of ALPHABET) {
    const effects = EVENT_EFFECTS[event];

    it(`CLOSED + "${event}"`, () => {
      const closes: ScreenSessionClose[] = [];
      const row = makeRow({ interaction_type: event, app_package_name: PKG, event_timestamp_ns: T0 + 5n * NS });
      const next = transitionScreenState(null, row, 3, closes);

      expect(closes).toEqual([]);
      if (effects.start) {
        // CLOSED —start→ OPEN; lock evidence only via the dual start+lock event.
        expect(next).toEqual({
          startIndex: 3,
          startTimestampNs: T0 + 5n * NS,
          startTimezone: "America/Chicago",
          lockScreenSeen: Boolean(effects.lock),
          unlockedSeen: false,
          foregroundAppPackage: null,
          lastMeaningfulActivityTimestampNs: null,
          lastMeaningfulActivityPackage: null,
        });
      } else {
        // Everything else is ignored while CLOSED — including stop/lock/unlock.
        expect(next).toBeNull();
      }
    });

    it(`OPEN + "${event}"`, () => {
      const closes: ScreenSessionClose[] = [];
      const state = freshOpenState();
      const before = { ...state };
      const ts = T0 + 9n * NS;
      const row = makeRow({ interaction_type: event, app_package_name: PKG, event_timestamp_ns: ts });
      const next = transitionScreenState(state, row, 7, closes);

      if (effects.start) {
        // Re-open while OPEN is a no-op: same state object, UNMUTATED — the
        // start branch returns before the accumulator checks, so even the
        // dual start+lock event does NOT set lockScreenSeen on an open state.
        expect(next).toBe(state);
        expect(state).toEqual(before);
        expect(closes).toEqual([]);
        return;
      }

      const expected: ScreenState = {
        ...before,
        lockScreenSeen: before.lockScreenSeen || Boolean(effects.lock),
        unlockedSeen: before.unlockedSeen || Boolean(effects.unlock),
        foregroundAppPackage: effects.foreground ? PKG : before.foregroundAppPackage,
        lastMeaningfulActivityTimestampNs: effects.meaningful
          ? ts
          : before.lastMeaningfulActivityTimestampNs,
        lastMeaningfulActivityPackage: effects.meaningful
          ? PKG
          : before.lastMeaningfulActivityPackage,
      };

      if (effects.stop) {
        // OPEN —stop→ CLOSED, emitting a close whose snapshot carries any
        // same-event accumulator updates (the dual stop+unlock event closes
        // with unlockedSeen already true).
        expect(next).toBeNull();
        expect(closes).toEqual([{ state: expected, stopTimestampNs: ts, stopEventType: event }]);
        expect(state).toEqual(expected);
      } else {
        expect(next).toBe(state);
        expect(state).toEqual(expected);
        expect(closes).toEqual([]);
      }
    });
  }

  it("OPEN + meaningful event with empty package falls back to the foreground package", () => {
    const closes: ScreenSessionClose[] = [];
    const state = freshOpenState();
    state.foregroundAppPackage = "com.fg.app";
    const row = makeRow({ interaction_type: "User Interaction", app_package_name: "", event_timestamp_ns: T0 + NS });
    transitionScreenState(state, row, 1, closes);
    expect(state.lastMeaningfulActivityPackage).toBe("com.fg.app");
    expect(state.lastMeaningfulActivityTimestampNs).toBe(T0 + NS);
  });
});

// ── 3. End-reason cascade decision table ────────────────────────────────────

describe("buildClassifiedScreenSessions: 8-way end-reason decision table", () => {
  // Explicit knob values so every branch boundary in the table is legible.
  const KNOBS = {
    screenUsageAutoLockTimeoutSeconds: 60,
    screenUsageAutoLockToleranceSeconds: 5,
    screenUsageManualLockMaxTailGapSeconds: 10,
    screenUsageKeyguardNearStopSeconds: 3,
  };
  const FORCING_PKG = "com.player.video";
  const FORCING_LABEL = "Video Player";

  type Case = {
    name: string;
    /** Seconds from last meaningful activity to stop; null = no activity seen. */
    tailGapSeconds: number | null;
    stop: boolean;
    lockScreenSeen?: boolean;
    unlockedSeen?: boolean;
    foregroundAppPackage?: string | null;
    lastMeaningfulPackage?: string | null;
    /** Keyguard-shown timestamps expressed as seconds relative to the stop. */
    keyguardOffsetsSeconds?: number[];
    knobOverrides?: Partial<typeof KNOBS>;
    expected: { reason: string; confidence: number; lockScreenOnly?: 1 };
  };

  const CASES: Case[] = [
    {
      name: "1. no stop event → missing_stop @ 1.0",
      tailGapSeconds: null,
      stop: false,
      expected: { reason: "missing_stop", confidence: 1.0 },
    },
    {
      name: "2. lock seen, never unlocked, no foreground app → lock_screen_only @ 0.95",
      tailGapSeconds: null,
      stop: true,
      lockScreenSeen: true,
      foregroundAppPackage: null,
      expected: { reason: "lock_screen_only", confidence: 0.95, lockScreenOnly: 1 },
    },
    {
      name: "3. forcing app + tailGap > autoLockTimeout → app_kept_awake_or_extended @ 0.9",
      tailGapSeconds: 70,
      stop: true,
      foregroundAppPackage: FORCING_PKG,
      lastMeaningfulPackage: FORCING_PKG,
      expected: { reason: "app_kept_awake_or_extended", confidence: 0.9 },
    },
    {
      name: "3b. forcing app but tailGap ≤ timeout falls THROUGH to manual/auto checks",
      tailGapSeconds: 8,
      stop: true,
      foregroundAppPackage: FORCING_PKG,
      lastMeaningfulPackage: FORCING_PKG,
      expected: { reason: "probable_manual_lock", confidence: 0.85 },
    },
    {
      name: "4. tailGap ≤ manualLockMaxTailGap → probable_manual_lock @ 0.85",
      tailGapSeconds: 10,
      stop: true,
      foregroundAppPackage: "com.app.a",
      expected: { reason: "probable_manual_lock", confidence: 0.85 },
    },
    {
      name: "5. |tailGap − autoLockTimeout| ≤ tolerance → probable_auto_lock @ 0.9",
      tailGapSeconds: 57,
      stop: true,
      foregroundAppPackage: "com.app.a",
      expected: { reason: "probable_auto_lock", confidence: 0.9 },
    },
    {
      name: "5b. manual-lock check precedes auto-lock when knobs make both true",
      tailGapSeconds: 57,
      stop: true,
      foregroundAppPackage: "com.app.a",
      knobOverrides: { screenUsageManualLockMaxTailGapSeconds: 57 },
      expected: { reason: "probable_manual_lock", confidence: 0.85 },
    },
    {
      name: "6. mid gap + lock seen + keyguard within nearStop of the stop → probable_manual_lock @ 0.7",
      tailGapSeconds: 30,
      stop: true,
      lockScreenSeen: true,
      unlockedSeen: true, // not lock_screen_only
      foregroundAppPackage: "com.app.a",
      keyguardOffsetsSeconds: [-2],
      expected: { reason: "probable_manual_lock", confidence: 0.7 },
    },
    {
      name: "6b. keyguard OUTSIDE nearStop window does not rescue → extended_idle_or_unknown",
      tailGapSeconds: 30,
      stop: true,
      lockScreenSeen: true,
      unlockedSeen: true,
      foregroundAppPackage: "com.app.a",
      keyguardOffsetsSeconds: [-8],
      expected: { reason: "extended_idle_or_unknown", confidence: 0.5 },
    },
    {
      name: "7. mid gap, no lock evidence → extended_idle_or_unknown @ 0.5",
      tailGapSeconds: 30,
      stop: true,
      foregroundAppPackage: "com.app.a",
      expected: { reason: "extended_idle_or_unknown", confidence: 0.5 },
    },
    {
      name: "8. no meaningful activity, foreground app seen, no lock → unknown @ 0.25",
      tailGapSeconds: null,
      stop: true,
      foregroundAppPackage: "com.app.a",
      expected: { reason: "unknown", confidence: 0.25 },
    },
    {
      name: "8b. no activity, lock seen but unlocked (not lock_screen_only), keyguard near stop → probable_manual_lock @ 0.7",
      tailGapSeconds: null,
      stop: true,
      lockScreenSeen: true,
      unlockedSeen: true,
      foregroundAppPackage: null,
      keyguardOffsetsSeconds: [1],
      expected: { reason: "probable_manual_lock", confidence: 0.7 },
    },
    {
      name: "knob: larger manualLockMaxTailGap reclassifies a 30 s gap as manual",
      tailGapSeconds: 30,
      stop: true,
      foregroundAppPackage: "com.app.a",
      knobOverrides: { screenUsageManualLockMaxTailGapSeconds: 40 },
      expected: { reason: "probable_manual_lock", confidence: 0.85 },
    },
    {
      name: "knob: larger tolerance reclassifies a 30 s gap as auto-lock",
      tailGapSeconds: 30,
      stop: true,
      foregroundAppPackage: "com.app.a",
      knobOverrides: { screenUsageAutoLockToleranceSeconds: 30 },
      expected: { reason: "probable_auto_lock", confidence: 0.9 },
    },
    {
      name: "knob: smaller autoLockTimeout flips the forcing-app branch on at tailGap 30",
      tailGapSeconds: 30,
      stop: true,
      foregroundAppPackage: FORCING_PKG,
      lastMeaningfulPackage: FORCING_PKG,
      knobOverrides: { screenUsageAutoLockTimeoutSeconds: 20 },
      expected: { reason: "app_kept_awake_or_extended", confidence: 0.9 },
    },
  ];

  for (const testCase of CASES) {
    it(testCase.name, () => {
      const options: BrowserProcessingOptions = {
        ...DEFAULT_BROWSER_OPTIONS,
        ...KNOBS,
        ...testCase.knobOverrides,
      };
      const stopNs = T0 + 600n * NS;
      const state = freshOpenState();
      state.lockScreenSeen = testCase.lockScreenSeen ?? false;
      state.unlockedSeen = testCase.unlockedSeen ?? false;
      state.foregroundAppPackage = testCase.foregroundAppPackage ?? null;
      if (testCase.tailGapSeconds != null) {
        state.lastMeaningfulActivityTimestampNs =
          stopNs - BigInt(testCase.tailGapSeconds) * NS;
        state.lastMeaningfulActivityPackage =
          testCase.lastMeaningfulPackage ?? testCase.foregroundAppPackage ?? null;
      }
      const rows = [makeRow({ interaction_type: "Screen Interactive" })];
      const closes: ScreenSessionClose[] = [
        {
          state,
          stopTimestampNs: testCase.stop ? stopNs : null,
          stopEventType: testCase.stop ? "Screen Non-Interactive" : null,
        },
      ];
      const keyguard = (testCase.keyguardOffsetsSeconds ?? []).map(
        (offset) => stopNs + BigInt(offset) * NS,
      );

      const sessions = buildClassifiedScreenSessions(
        rows,
        closes,
        keyguard,
        options,
        new Map([[FORCING_PKG, FORCING_LABEL]]),
      );

      expect(sessions).toHaveLength(1);
      const session = sessions[0];
      expect(session.screen_usage_end_reason, testCase.name).toBe(testCase.expected.reason);
      expect(session.screen_usage_end_reason_confidence, testCase.name).toBe(
        testCase.expected.confidence,
      );
      expect(session.screen_usage_lock_screen_only).toBe(testCase.expected.lockScreenOnly ?? 0);
      if (testCase.stop) {
        expect(session.duration_seconds).toBe(600);
        expect(session.screen_usage_tail_gap_seconds).toBe(testCase.tailGapSeconds);
      } else {
        expect(session.stop_timestamp_ns).toBeNull();
        expect(session.duration_seconds).toBeNull();
      }
    });
  }
});

// ── 4. fast-check model-based walk vs a reference accumulator ───────────────

type CloseShape = {
  startTimestampNs: bigint;
  stopTimestampNs: bigint | null;
  stopEventType: string | null;
  lockScreenSeen: boolean;
  unlockedSeen: boolean;
  foregroundAppPackage: string | null;
  lastMeaningfulActivityTimestampNs: bigint | null;
  lastMeaningfulActivityPackage: string | null;
};

function shapeOf(close: ScreenSessionClose): CloseShape {
  return {
    startTimestampNs: close.state.startTimestampNs,
    stopTimestampNs: close.stopTimestampNs,
    stopEventType: close.stopEventType,
    lockScreenSeen: close.state.lockScreenSeen,
    unlockedSeen: close.state.unlockedSeen,
    foregroundAppPackage: close.state.foregroundAppPackage,
    lastMeaningfulActivityTimestampNs: close.state.lastMeaningfulActivityTimestampNs,
    lastMeaningfulActivityPackage: close.state.lastMeaningfulActivityPackage,
  };
}

/** Independent re-implementation of the walker from the EVENT_EFFECTS table. */
function referenceWalk(rows: CanonicalRow[]): CloseShape[] {
  const closes: CloseShape[] = [];
  let open: CloseShape | null = null;
  for (const row of rows) {
    const effects = EVENT_EFFECTS[row.interaction_type] ?? {};
    const pkg = row.app_package_name || null;
    if (effects.start) {
      open ??= {
        startTimestampNs: row.event_timestamp_ns,
        stopTimestampNs: null,
        stopEventType: null,
        lockScreenSeen: Boolean(effects.lock),
        unlockedSeen: false,
        foregroundAppPackage: null,
        lastMeaningfulActivityTimestampNs: null,
        lastMeaningfulActivityPackage: null,
      };
      continue;
    }
    if (!open) continue;
    if (effects.lock) open.lockScreenSeen = true;
    if (effects.unlock) open.unlockedSeen = true;
    if (effects.foreground) open.foregroundAppPackage = pkg;
    if (effects.meaningful) {
      open.lastMeaningfulActivityTimestampNs = row.event_timestamp_ns;
      open.lastMeaningfulActivityPackage = pkg ?? open.foregroundAppPackage;
    }
    if (effects.stop) {
      closes.push({ ...open, stopTimestampNs: row.event_timestamp_ns, stopEventType: row.interaction_type });
      open = null;
    }
  }
  if (open) closes.push(open);
  return closes;
}

describe("walkScreenStateMachine: model-based random walks", () => {
  const PACKAGES = ["", "com.app.a", "com.app.b"];

  it("matches the reference accumulator on arbitrary event sequences", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            event: fc.constantFrom(...ALPHABET),
            pkgIndex: fc.nat({ max: PACKAGES.length - 1 }),
            gapSeconds: fc.integer({ min: 0, max: 120 }),
          }),
          { maxLength: 80 },
        ),
        (steps) => {
          let ts = T0;
          const rows = steps.map((step, index) => {
            ts += BigInt(step.gapSeconds) * NS;
            return makeRow({
              interaction_type: step.event,
              app_package_name: PACKAGES[step.pkgIndex],
              event_timestamp_ns: ts,
              __index: index,
            });
          });
          expect(walkScreenStateMachine(rows).map(shapeOf)).toEqual(referenceWalk(rows));
        },
      ),
      { numRuns: 300 },
    );
  });
});
