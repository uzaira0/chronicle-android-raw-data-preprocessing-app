import type { MatcherInput } from "@/lib/types";

export const sampleInput: MatcherInput = {
  appCodes: [0, 0, 1, 1, 0, 2, 2, 0],
  timestampNs: [
    0,
    60_000_000_000,
    120_000_000_000,
    180_000_000_000,
    240_000_000_000,
    300_000_000_000,
    360_000_000_000,
    420_000_000_000,
  ],
  resumed: [true, false, true, false, true, true, false, false],
  sameStop: [false, true, false, true, false, false, true, true],
  otherStop: [false, false, false, false, false, false, false, false],
  stopped: [false, false, false, false, false, false, false, false],
  options: {
    allowStopEventReuse: false,
    useActivityStoppedAsFallback: true,
    applyThresholdToFallback: true,
    longDurationThresholdNs: 8 * 60 * 60 * 1_000_000_000,
  },
};
