import { describe, expect, it } from "vitest";
import { matchAppUsageWithProximity } from "@/lib/proximityMatcher";
import type { MatcherInput } from "@/lib/types";

const TWELVE_HOURS_NS = 43_200_000_000_000n;

type Event = {
  app: number;
  /** seconds */
  t: number;
  resumed?: 0 | 1;
  sameStop?: 0 | 1;
  otherStop?: 0 | 1;
  stopped?: 0 | 1;
  background?: 0 | 1;
};

function makeInput(events: Event[], opts: Partial<MatcherInput["options"]> = {}): MatcherInput {
  return {
    appCodes: Int32Array.from(events.map((event) => event.app)),
    timestampNs: BigInt64Array.from(events.map((event) => BigInt(Math.round(event.t * 1e9)))),
    resumed: Uint8Array.from(events.map((event) => event.resumed ?? 0)),
    sameStop: Uint8Array.from(events.map((event) => event.sameStop ?? 0)),
    otherStop: Uint8Array.from(events.map((event) => event.otherStop ?? 0)),
    stopped: Uint8Array.from(events.map((event) => event.stopped ?? 0)),
    background: Uint8Array.from(events.map((event) => event.background ?? 0)),
    options: {
      allowStopEventReuse: false,
      useActivityStoppedAsFallback: true,
      applyThresholdToFallback: false,
      longDurationThresholdNs: TWELVE_HOURS_NS,
      proximityNs: 0n,
      ...opts,
    },
  };
}

describe("matchAppUsageWithProximity", () => {
  it("closes a simple same-app session (proximity off)", () => {
    const out = matchAppUsageWithProximity(
      makeInput([
        { app: 0, t: 0, resumed: 1 },
        { app: 0, t: 1, sameStop: 1 },
      ]),
    );
    expect(out.startIndices).toEqual([0]);
    expect(out.stopStartIndices).toEqual([0]);
    expect(out.stopEventIndices).toEqual([1]);
    expect(out.missingIndices).toEqual([]);
  });

  it("reports an unclosable open start as missing", () => {
    const out = matchAppUsageWithProximity(makeInput([{ app: 0, t: 0, resumed: 1 }]));
    expect(out.startIndices).toEqual([0]);
    expect(out.stopStartIndices).toEqual([]);
    expect(out.stopEventIndices).toEqual([]);
    expect(out.missingIndices).toEqual([0]);
  });

  // The defining behavior. Same event stream, two proximity settings:
  //   0  resume A         1  pause A (same-stop, closes #0)
  //   2  resume A again   3  Activity-Stopped A (fallback)   4  pause A (same-stop)
  // Event 2 is a re-resume of an app same-stopped 0.5 s earlier; event 3 is an
  // Activity-Stopped fallback landing 0.5 s after that re-resume.
  const teardownEvents: Event[] = [
    { app: 0, t: 0, resumed: 1 },
    { app: 0, t: 1, sameStop: 1 },
    { app: 0, t: 1.5, resumed: 1 },
    { app: 0, t: 2, stopped: 1 },
    { app: 0, t: 5, sameStop: 1 },
  ];

  it("without proximity, the fallback stop truncates the re-resumed session", () => {
    const out = matchAppUsageWithProximity(makeInput(teardownEvents, { proximityNs: 0n }));
    expect(out.startIndices).toEqual([0, 2]);
    // Session #2 is closed by the fallback at event 3 (truncated to 0.5 s)...
    expect(out.stopStartIndices).toEqual([0, 2]);
    expect(out.stopEventIndices).toEqual([1, 3]);
    expect(out.missingIndices).toEqual([]);
  });

  it("with proximity, the teardown fallback is skipped so a later genuine stop closes the session", () => {
    const out = matchAppUsageWithProximity(
      makeInput(teardownEvents, { proximityNs: 2_000_000_000n }),
    );
    expect(out.startIndices).toEqual([0, 2]);
    // ...but with a 2 s grace, event 3 is read as intra-app teardown and skipped,
    // so session #2 stays open and the real same-stop at event 4 closes it (3.5 s).
    expect(out.stopStartIndices).toEqual([0, 2]);
    expect(out.stopEventIndices).toEqual([1, 4]);
    expect(out.missingIndices).toEqual([]);
  });

  it("treats a stop earlier than its start as an invalid (negative) duration", () => {
    // Single-close path: the same-stop at t=5 lands before the resume at t=10, so
    // the duration is negative and the start cannot be closed — it stays missing.
    const out = matchAppUsageWithProximity(
      makeInput([
        { app: 0, t: 10, resumed: 1 },
        { app: 0, t: 5, sameStop: 1 },
      ]),
    );
    expect(out.stopStartIndices).toEqual([]);
    expect(out.stopEventIndices).toEqual([]);
    expect(out.missingIndices).toEqual([0]);
  });

  it("in reuse mode, keeps an open start when the candidate close is an invalid duration", () => {
    // allowStopEventReuse takes the reuse branch; the compatible same-stop has a
    // negative duration, so the start is pushed back onto the still-open set.
    const out = matchAppUsageWithProximity(
      makeInput(
        [
          { app: 0, t: 10, resumed: 1 },
          { app: 0, t: 5, sameStop: 1 },
        ],
        { allowStopEventReuse: true },
      ),
    );
    expect(out.stopStartIndices).toEqual([]);
    expect(out.stopEventIndices).toEqual([]);
    expect(out.missingIndices).toEqual([0]);
  });

  it("does not skip a fallback close when the start is not a re-resume", () => {
    // A first-time resume (not a re-resume) is closed by its fallback normally,
    // even with proximity on — the grace only protects re-resumed teardowns.
    const out = matchAppUsageWithProximity(
      makeInput(
        [
          { app: 0, t: 0, resumed: 1 },
          { app: 0, t: 0.5, stopped: 1 },
        ],
        { proximityNs: 2_000_000_000n },
      ),
    );
    expect(out.stopStartIndices).toEqual([0]);
    expect(out.stopEventIndices).toEqual([1]);
    expect(out.missingIndices).toEqual([]);
  });
});
