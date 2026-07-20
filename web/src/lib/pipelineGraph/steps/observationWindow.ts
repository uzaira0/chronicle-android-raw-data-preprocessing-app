import {
  applyWindowFilter,
  resolveParticipantWindows,
  type ObservationWindowResult,
} from "@/lib/stages/observationWindow";
import type { StudyWindow } from "@/lib/stages/studySupportFiles";
import { intervalCleaningWiring } from "@/lib/pipelineGraph/steps/intervalCleaning";
import { port, stepsOf, wireUnit } from "@/lib/pipelineGraph/stepTypes";
import type { PipelineCtx } from "@/lib/pipelineGraph/unitContracts";

const step = stepsOf("observation_window");

/** The wrapper validated presence before running the unit (requireStudyFile). */
function windows(ctx: PipelineCtx): StudyWindow[] {
  return ctx.support.studyWindows ?? [];
}

export const resolveWindows = step({
  id: "resolve_participant_windows",
  label: "Resolve participant windows",
  description:
    "Resolve each participant to their study window (exact id, then numerical id) from the study-dates file.",
  inputs: { rows: intervalCleaningWiring.wholePort },
  run: ({ rows }, ctx) => resolveParticipantWindows(rows, windows(ctx)),
});

export const filterRowsToWindow = step({
  id: "filter_rows_to_window",
  label: "Filter rows to window",
  description:
    "Keep rows whose local date falls inside the participant's [start, end] window; participants without a window are kept whole and reported.",
  inputs: { rows: intervalCleaningWiring.wholePort, lookup: resolveWindows },
  run: ({ rows, lookup }, ctx) => applyWindowFilter(rows, windows(ctx), lookup),
  lossy: true,
  dropped: (result) => result.droppedRows,
});

export const observationWindowWiring = wireUnit<ObservationWindowResult>(
  "observation_window",
  [resolveWindows, filterRowsToWindow],
  {
    rows: port(filterRowsToWindow, (result) => result.rows),
    droppedRows: port(filterRowsToWindow, (result) => result.droppedRows),
    participantsWithoutWindow: port(
      filterRowsToWindow,
      (result) => result.participantsWithoutWindow,
    ),
  },
);
