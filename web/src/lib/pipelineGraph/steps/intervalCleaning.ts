import {
  clearFilteredUsageTiming,
  filterZeroDurationUsage,
  removeSelectedInteractionTypes,
  type CanonicalRow,
} from "@/lib/browserPipeline";
import { episodeAnnotationsWiring } from "@/lib/pipelineGraph/steps/episodeAnnotations";
import { port, stepsOf, viewOptions, wireUnitWhole } from "@/lib/pipelineGraph/stepTypes";

const step = stepsOf("interval_cleaning");

export const blankJunkTiming = step({
  id: "blank_junk_timing",
  label: "Blank junk timing",
  description:
    "The SOLE blanking site: null start/stop/duration on 'Filtered App Usage' rows, after the engagement walk has read their real timing.",
  inputs: { rows: episodeAnnotationsWiring.wholePort },
  run: ({ rows }) => clearFilteredUsageTiming(rows),
  bypassedWhen: (options) => !viewOptions(options).useFilterFile,
});

export const dropSelectedTypes = step({
  id: "drop_selected_types",
  label: "Drop selected types",
  description:
    "Drop the event types selected for removal — kept when they witness a large data gap.",
  inputs: { rows: blankJunkTiming },
  run: ({ rows }, ctx) => removeSelectedInteractionTypes(rows, ctx.options),
  bypassedWhen: (options) =>
    (viewOptions(options).interactionTypesToRemove?.length ?? 0) === 0,
  lossy: true,
});

export const dropZeroDuration = step({
  id: "drop_zero_duration",
  label: "Drop zero-duration",
  description:
    "Optionally drop zero-duration usage episodes (null-duration rows are kept). Gated by filterZeroDurationSessions.",
  inputs: { rows: dropSelectedTypes },
  run: ({ rows }, ctx) =>
    ctx.options.filterZeroDurationSessions ? filterZeroDurationUsage(rows) : rows,
  bypassedWhen: (options) => !viewOptions(options).filterZeroDurationSessions,
  lossy: true,
});

export const intervalCleaningWiring = wireUnitWhole<CanonicalRow[]>(
  "interval_cleaning",
  [blankJunkTiming, dropSelectedTypes, dropZeroDuration],
  port(dropZeroDuration),
);
