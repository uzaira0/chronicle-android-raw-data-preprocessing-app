import {
  dominantTimezone,
  restampRowsToTimezone,
  selectTimezoneStrategy,
  summarizeTimezoneRowCounts,
} from "@/lib/browserPipeline";
import { parseEventsWiring } from "@/lib/pipelineGraph/steps/parseEvents";
import { port, stepsOf, wireUnit } from "@/lib/pipelineGraph/stepTypes";
import type { NormalizeTimezonesOutput } from "@/lib/pipelineGraph/unitContracts";

const step = stepsOf("normalize_timezones");

export const computeDominantTimezone = step({
  id: "compute_dominant_timezone",
  label: "Dominant timezone",
  description: "Find the most frequent timezone across the rows (the primary clock).",
  inputs: { rows: parseEventsWiring.ports.rows },
  run: ({ rows }) => dominantTimezone(rows),
});

export const selectStrategy = step({
  id: "select_timezone_strategy",
  label: "Select strategy",
  description:
    "Pick the target timezone and (for filter strategies) the surviving rows, per the timezone-handling setting.",
  inputs: { rows: parseEventsWiring.ports.rows, primary: computeDominantTimezone },
  run: ({ rows, primary }, ctx) => selectTimezoneStrategy(rows, primary, ctx.options),
  // The one place timezone handling loses rows (filter strategies). The
  // conservation law doubles as a check that the reported rowsBefore
  // counter matches the actual input row count.
  lossy: true,
  rowCount: (selection) => selection.nextRows.length,
  dropped: (selection) => selection.rowsBefore - selection.nextRows.length,
});

export const restampRows = step({
  id: "restamp_rows",
  label: "Restamp rows",
  description: "Restamp every surviving row onto the target timezone and recompute its calendar columns.",
  inputs: { selection: selectStrategy },
  run: ({ selection }) => restampRowsToTimezone(selection.nextRows, selection.targetTimezone),
});

export const rowCountReport = step({
  id: "row_count_report",
  label: "Row-count report",
  description: "Before/after/removed row counts for the timezone step's report.",
  inputs: { selection: selectStrategy, adjusted: restampRows },
  run: ({ selection, adjusted }) => summarizeTimezoneRowCounts(selection.rowsBefore, adjusted),
});

export const normalizeTimezonesWiring = wireUnit<NormalizeTimezonesOutput>(
  "normalize_timezones",
  [computeDominantTimezone, selectStrategy, restampRows, rowCountReport],
  {
    rows: port(restampRows),
    timezone: port(selectStrategy, (selection) => selection.targetTimezone),
    action: port(selectStrategy, (selection) => selection.action),
    rowsBefore: port(rowCountReport, (counts) => counts.rowsBefore),
    rowsAfter: port(rowCountReport, (counts) => counts.rowsAfter),
    rowsRemoved: port(rowCountReport, (counts) => counts.rowsRemoved),
  },
);
