import { addNoActivityPlaceholderRows } from "@/lib/browserPipeline";
import {
  buildDayCoverage,
  buildRawEventDateIndex,
  type DayCoverageResult,
} from "@/lib/stages/dayCoverage";
import { appPolicyWiring } from "@/lib/pipelineGraph/steps/appPolicy";
import { attributePersonWiring } from "@/lib/pipelineGraph/steps/attributePerson";
import { port, stepsOf, viewOptions, wireUnit } from "@/lib/pipelineGraph/stepTypes";
import type { DayCoverageNodeOutput } from "@/lib/pipelineGraph/unitContracts";

const step = stepsOf("day_coverage");

export const injectPlaceholders = step({
  id: "inject_placeholders",
  label: "Inject placeholders",
  description:
    "Inject one zero-duration 'No Activity' placeholder per participant-day that has raw events but no usage. Gated by addNoActivityPlaceholderDays.",
  inputs: { attributed: attributePersonWiring.ports.rows, events: appPolicyWiring.ports.rows },
  run: ({ attributed, events }, ctx) =>
    ctx.options.addNoActivityPlaceholderDays
      ? addNoActivityPlaceholderRows(attributed, events)
      : attributed,
  bypassedWhen: (options) => !viewOptions(options).addNoActivityPlaceholderDays,
});

export const buildRawDateIndex = step({
  id: "build_raw_date_index",
  label: "Build raw date index",
  description: "Per-participant set of raw event dates — the 'device was alive' evidence.",
  inputs: { events: appPolicyWiring.ports.rows },
  run: ({ events }) => buildRawEventDateIndex(events),
});

export const buildCoverageTable = step({
  id: "build_coverage_table",
  label: "Build coverage table",
  description:
    "Classify every spine day usage / no_activity / no_data (hard invariant: a data day the spine misses is an error). Gated by enableDayCoverage.",
  inputs: { rows: injectPlaceholders, rawDates: buildRawDateIndex },
  run: ({ rows, rawDates }, ctx): DayCoverageResult | null =>
    ctx.options.enableDayCoverage
      ? buildDayCoverage(rows, rawDates, ctx.support.studyWindows ?? [])
      : null,
  bypassedWhen: (options) => !viewOptions(options).enableDayCoverage,
});

export const dayCoverageWiring = wireUnit<DayCoverageNodeOutput>(
  "day_coverage",
  [injectPlaceholders, buildRawDateIndex, buildCoverageTable],
  {
    rows: port(injectPlaceholders),
    coverage: port(buildCoverageTable),
  },
);
