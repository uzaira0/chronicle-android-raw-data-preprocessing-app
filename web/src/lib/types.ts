export type MatcherInput = {
  appCodes: number[];
  timestampNs: number[];
  resumed: boolean[];
  sameStop: boolean[];
  otherStop: boolean[];
  stopped: boolean[];
  options: {
    allowStopEventReuse: boolean;
    useActivityStoppedAsFallback: boolean;
    applyThresholdToFallback: boolean;
    longDurationThresholdNs: number;
  };
};

export type MatcherOutput = {
  startIndices: number[];
  stopStartIndices: number[];
  stopEventIndices: number[];
  missingIndices: number[];
};
