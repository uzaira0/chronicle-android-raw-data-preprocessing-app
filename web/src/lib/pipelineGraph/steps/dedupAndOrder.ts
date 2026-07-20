import {
  countDuplicateTimestampGroups,
  dedupeExactRows,
  markDataTimeGaps,
  unalignDuplicateTimestamps,
} from "@/lib/browserPipeline";
import { normalizeTimezonesWiring } from "@/lib/pipelineGraph/steps/normalizeTimezones";
import { port, stepsOf, viewOptions, wireUnit } from "@/lib/pipelineGraph/stepTypes";
import type { DedupAndOrderOutput } from "@/lib/pipelineGraph/unitContracts";

const step = stepsOf("dedup_and_order");

export const exactDedupe = step({
  id: "exact_dedupe",
  label: "Exact dedupe",
  description:
    "Collapse exact-duplicate raw rows (same participant, timestamp, app, interaction type), keeping the first. Gated by deduplicateExactRows.",
  inputs: { rows: normalizeTimezonesWiring.ports.rows },
  run: ({ rows }, ctx) =>
    ctx.options.deduplicateExactRows ? dedupeExactRows(rows) : { rows, removed: 0 },
  bypassedWhen: (options) => !viewOptions(options).deduplicateExactRows,
  lossy: true,
  dropped: (dedupe) => dedupe.removed,
});

export const countDupGroups = step({
  id: "count_dup_groups",
  label: "Count duplicate groups",
  description: "Count same-timestamp event groups before correction, for the run report.",
  inputs: { dedupe: exactDedupe },
  run: ({ dedupe }) => countDuplicateTimestampGroups(dedupe.rows),
});

export const nudgeDuplicateTimestamps = step({
  id: "nudge_duplicate_timestamps",
  label: "Nudge duplicate timestamps",
  description:
    "Nudge same-timestamp events apart (resume-first priority order) so event ordering is deterministic. Gated by correctDuplicateEventTimestamps.",
  inputs: { dedupe: exactDedupe },
  run: ({ dedupe }, ctx) =>
    ctx.options.correctDuplicateEventTimestamps
      ? unalignDuplicateTimestamps(dedupe.rows, ctx.options)
      : dedupe.rows,
  bypassedWhen: (options) => !viewOptions(options).correctDuplicateEventTimestamps,
});

export const markGaps = step({
  id: "mark_data_time_gaps",
  label: "Mark data-time gaps",
  description: "Stamp each row with the gap (hours) since the previous event in the stream.",
  inputs: { rows: nudgeDuplicateTimestamps },
  run: ({ rows }) => markDataTimeGaps(rows),
});

export const dedupAndOrderWiring = wireUnit<DedupAndOrderOutput>(
  "dedup_and_order",
  [exactDedupe, countDupGroups, nudgeDuplicateTimestamps, markGaps],
  {
    rows: port(markGaps),
    duplicateTimestampsCorrected: port(countDupGroups, (count, ctx) =>
      ctx.options.correctDuplicateEventTimestamps ? count : 0,
    ),
    exactDuplicateRowsRemoved: port(exactDedupe, (dedupe) => dedupe.removed),
  },
);
