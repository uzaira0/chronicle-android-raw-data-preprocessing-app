import type { MatcherInput, MatcherOutput } from "@/lib/types";

/**
 * JavaScript app-usage matcher used only when the intra-app teardown grace
 * (`proximityIntervalSeconds` > 0) is enabled.
 *
 * Why this exists: the shared Rust→WASM matcher has no proximity parameter (it is
 * an optimized sweep over a sparse open-start structure). Rather than graft a new
 * behavior into that performance-critical, cross-surface algorithm, proximity is
 * implemented as a direct port of the reference matcher loop — the same decision
 * the (now-archived) desktop pipeline made (`_match_usage_updates_python`). With
 * proximity off the pipeline never calls this; it uses the WASM matcher unchanged,
 * so the default path and cross-surface parity are untouched.
 *
 * Fidelity: with `proximityNs === 0n` this function is a behavior-equivalent
 * reimplementation of the WASM `matchAppUsageUpdateIndices` (pinned by
 * `proximityMatcher.test.ts`, which fuzzes both against each other). The proximity
 * rule adds exactly one thing: an Activity-Stopped *fallback* close that lands
 * within the grace window of a *re-resumed* session's start is read as an intra-app
 * teardown artifact (the app was torn down and immediately re-resumed) rather than
 * a genuine close, so the session stays open for the next real stop event.
 */
export function matchAppUsageWithProximity(input: MatcherInput): MatcherOutput {
  const { appCodes, timestampNs, resumed, sameStop, otherStop, stopped, background } = input;
  const {
    allowStopEventReuse,
    useActivityStoppedAsFallback,
    applyThresholdToFallback,
    longDurationThresholdNs,
    proximityNs,
  } = input.options;
  const length = appCodes.length;

  let openStartIndices: number[] = [];
  const startIndices: number[] = [];
  const stopStartIndices: number[] = [];
  const stopEventIndices: number[] = [];
  const missingIndices: number[] = [];

  // Proximity bookkeeping — all inert when proximityNs === 0n. `lastEventNs` /
  // `lastWasSameStop` track the previous event per app code; `isReresume` marks,
  // per open-start index, whether that start was a re-resume of an app that had
  // just been same-stopped within the grace window.
  const lastEventNs = new Map<number, bigint>();
  const lastWasSameStop = new Map<number, boolean>();
  const isReresume = new Map<number, boolean>();

  const isValidDuration = (
    startIndex: number,
    stopIndex: number,
    enforceThreshold: boolean,
  ): boolean => {
    const durationNs = timestampNs[stopIndex] - timestampNs[startIndex];
    if (durationNs < 0n) {
      return false;
    }
    return !enforceThreshold || durationNs <= longDurationThresholdNs;
  };

  for (let index = 0; index < length; index += 1) {
    const currentApp = appCodes[index];
    const isNormalStop = sameStop[index] === 1 || otherStop[index] === 1;
    const isFallbackStop = stopped[index] === 1 && useActivityStoppedAsFallback;

    if (allowStopEventReuse && (isNormalStop || isFallbackStop)) {
      // Reuse mode: one stop event can close every compatible open start.
      // Proximity does not apply here (it only relaxes the single-close path).
      const stillOpen: number[] = [];
      for (const startIndex of openStartIndices) {
        const startApp = appCodes[startIndex];
        const sameAppCompatible = sameStop[index] === 1 && startApp === currentApp;
        const otherAppCompatible =
          otherStop[index] === 1 && startApp !== currentApp && background[startIndex] === 0;
        const fallbackCompatible = !isNormalStop && isFallbackStop && startApp === currentApp;
        if (!(sameAppCompatible || otherAppCompatible || fallbackCompatible)) {
          stillOpen.push(startIndex);
          continue;
        }
        const enforceThreshold = !fallbackCompatible || applyThresholdToFallback;
        if (isValidDuration(startIndex, index, enforceThreshold)) {
          stopStartIndices.push(startIndex);
          stopEventIndices.push(index);
        } else {
          stillOpen.push(startIndex);
        }
      }
      openStartIndices = stillOpen;
    } else if (isNormalStop || isFallbackStop) {
      // Single-close mode: the most recent compatible open start wins.
      let matchedPosition: number | null = null;
      for (let position = openStartIndices.length - 1; position >= 0; position -= 1) {
        const startIndex = openStartIndices[position];
        const startApp = appCodes[startIndex];
        const sameAppCompatible = sameStop[index] === 1 && startApp === currentApp;
        const otherAppCompatible =
          otherStop[index] === 1 && startApp !== currentApp && background[startIndex] === 0;
        const fallbackCompatible = !isNormalStop && isFallbackStop && startApp === currentApp;
        if (!(sameAppCompatible || otherAppCompatible || fallbackCompatible)) {
          continue;
        }
        const enforceThreshold = !fallbackCompatible || applyThresholdToFallback;
        if (isValidDuration(startIndex, index, enforceThreshold)) {
          if (
            proximityNs > 0n &&
            fallbackCompatible &&
            isReresume.get(startIndex) === true &&
            timestampNs[index] - timestampNs[startIndex] < proximityNs
          ) {
            // Intra-app teardown, not a real close: leave the start open for the
            // next genuine stop event.
            matchedPosition = null;
            break;
          }
          matchedPosition = position;
          break;
        }
      }
      if (matchedPosition !== null) {
        const startIndex = openStartIndices.splice(matchedPosition, 1)[0];
        stopStartIndices.push(startIndex);
        stopEventIndices.push(index);
      }
    }

    if (resumed[index] === 1) {
      if (proximityNs > 0n) {
        const last = lastEventNs.get(currentApp);
        isReresume.set(
          index,
          last !== undefined &&
            lastWasSameStop.get(currentApp) === true &&
            timestampNs[index] - last < proximityNs,
        );
      }
      startIndices.push(index);
      openStartIndices.push(index);
    }

    if (proximityNs > 0n) {
      lastEventNs.set(currentApp, timestampNs[index]);
      lastWasSameStop.set(currentApp, sameStop[index] === 1);
    }
  }

  // Any start still open at the end closes at the final event if that span is a
  // valid duration, otherwise it is reported as a missing end.
  if (openStartIndices.length > 0) {
    const lastIndex = length - 1;
    for (const startIndex of openStartIndices) {
      if (lastIndex > startIndex && isValidDuration(startIndex, lastIndex, true)) {
        stopStartIndices.push(startIndex);
        stopEventIndices.push(lastIndex);
      } else {
        missingIndices.push(startIndex);
      }
    }
  }

  return { startIndices, stopStartIndices, stopEventIndices, missingIndices };
}
