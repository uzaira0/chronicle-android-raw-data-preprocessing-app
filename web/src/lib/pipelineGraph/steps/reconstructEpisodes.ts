import {
  applyMatcherOutput,
  buildMatcherInput,
  computeFilteredPackagesFromRows,
  markJunkAppsDownstream,
  normalizePrefilteredEventTypes,
  relabelUsageWithMinimumFloor,
  runEpisodeMatcher,
  sortByEventThenIndex,
  splitConcurrentSessions,
  type CanonicalRow,
} from "@/lib/browserPipeline";
import { monotonicNonDecreasing } from "@/lib/pipelineGraph/executionRecords";
import { appPolicyWiring } from "@/lib/pipelineGraph/steps/appPolicy";
import { port, stepsOf, viewOptions, wireUnitWhole } from "@/lib/pipelineGraph/stepTypes";

const RESUMED = "Activity Resumed";
const PAUSED = "Activity Paused";
const USAGE = "App Usage";
const STOPPED = "Activity Stopped";

const step = stepsOf("reconstruct_episodes");

export const computeJunkPackages = step({
  id: "compute_junk_packages",
  label: "Compute junk packages",
  description:
    "The junk (filter-listed) package set, derived entirely from upstream rows carrying a Filtered-* event.",
  inputs: { rows: appPolicyWiring.ports.rows },
  run: ({ rows }) => computeFilteredPackagesFromRows(rows),
});

export const junkBlindFold = step({
  id: "junk_blind_fold",
  label: "Junk-blind fold",
  description:
    "Fold pre-relabeled junk events back to their Activity equivalents so the matcher sees every app identically (junk-BLIND matching).",
  inputs: { rows: appPolicyWiring.ports.rows, junk: computeJunkPackages },
  run: ({ rows, junk }) => (junk.size ? normalizePrefilteredEventTypes(rows, junk) : rows),
});

export const buildMatcherInputStep = step({
  id: "build_matcher_input",
  label: "Build matcher input",
  description:
    "Factorize app codes and build the resumed/stop/background masks the matcher consumes (throws when the file has no app events).",
  inputs: { rows: junkBlindFold },
  run: ({ rows }, ctx) => {
    if (
      !rows.some(
        (row) => row.interaction_type === RESUMED || row.interaction_type === PAUSED,
      )
    ) {
      throw new Error("No valid app usage data during the study period");
    }
    return buildMatcherInput(
      rows,
      RESUMED,
      STOPPED,
      new Set(ctx.options.sameAppInteractionTypesToStopUsageAt),
      new Set(ctx.options.otherInteractionTypesToStopUsageAt),
      ctx.options,
      ctx.support.backgroundAppsSet,
    );
  },
});

export const runMatcherStep = step({
  id: "run_matcher",
  label: "Run matcher",
  description:
    "Pair resumes with stops (WASM matcher; JS matcher when the proximity glue is on).",
  inputs: { matcherInput: buildMatcherInputStep },
  run: ({ matcherInput }, ctx) => runEpisodeMatcher(matcherInput, ctx.runMatcher),
});

export const applyMatcherOutputStep = step({
  id: "apply_matcher_output",
  label: "Apply matcher output",
  description:
    "Stamp episode start/stop timestamps from the matcher pairings; mark unmatched resumes 'End of Usage Missing'.",
  inputs: { rows: junkBlindFold, matcherOutput: runMatcherStep, junk: computeJunkPackages },
  run: ({ rows, matcherOutput, junk }) => applyMatcherOutput(rows, matcherOutput, junk),
});

export const relabelUsageWithFloor = step({
  id: "relabel_usage_with_floor",
  label: "Relabel usage + floor",
  description:
    "Drop pauses/unmatched resumes, relabel matched resumes as usage episodes, and apply the minimum-duration floor.",
  inputs: { rows: applyMatcherOutputStep },
  run: ({ rows }, ctx) =>
    relabelUsageWithMinimumFloor(rows, RESUMED, PAUSED, USAGE, ctx.options),
});

export const junkDownstreamMark = step({
  id: "junk_downstream_mark",
  label: "Junk downstream mark",
  description:
    "The ONE lossy filter decision, after matching: relabel junk apps' own episodes 'Filtered App Usage' (background junk keeps real timing).",
  inputs: { rows: relabelUsageWithFloor, junk: computeJunkPackages },
  run: ({ rows, junk }, ctx) =>
    markJunkAppsDownstream(rows, USAGE, STOPPED, junk, ctx.support.backgroundAppsSet),
});

export const sortEvents = step({
  id: "sort_episodes",
  label: "Sort episodes",
  description: "Re-sort rows by event timestamp after the relabels.",
  inputs: { rows: junkDownstreamMark },
  run: ({ rows }) => sortByEventThenIndex(rows),
  expectations: [
    monotonicNonDecreasing<CanonicalRow>({
      id: "sorted_by_event_time",
      describe: "event_timestamp_ns",
      value: (row) => row.event_timestamp_ns,
    }),
  ],
});

export const splitConcurrent = step({
  id: "split_concurrent",
  label: "Split concurrent sessions",
  description:
    "Phase 2 (concurrent modeling / background apps only): layer overlapping sessions into primary/secondary sub-intervals.",
  inputs: { rows: sortEvents },
  run: ({ rows }, ctx) =>
    splitConcurrentSessions(
      rows,
      USAGE,
      ctx.options,
      ctx.support.backgroundAppsSet,
      ctx.runSplitter,
    ),
  bypassedWhen: (options) =>
    !viewOptions(options).modelConcurrentUsage && !viewOptions(options).useBackgroundAppsFile,
});

export const reconstructEpisodesWiring = wireUnitWhole<CanonicalRow[]>(
  "reconstruct_episodes",
  [
    computeJunkPackages,
    junkBlindFold,
    buildMatcherInputStep,
    runMatcherStep,
    applyMatcherOutputStep,
    relabelUsageWithFloor,
    junkDownstreamMark,
    sortEvents,
    splitConcurrent,
  ],
  port(splitConcurrent),
);
