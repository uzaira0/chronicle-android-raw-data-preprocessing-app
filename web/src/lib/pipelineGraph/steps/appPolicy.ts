import { labelFilteredApps, type CanonicalRow } from "@/lib/browserPipeline";
import { dedupAndOrderWiring } from "@/lib/pipelineGraph/steps/dedupAndOrder";
import { port, stepsOf, wireUnit } from "@/lib/pipelineGraph/stepTypes";

const step = stepsOf("app_policy");

export const tagFilteredPackages = step({
  id: "tag_filtered_packages",
  label: "Tag filtered packages",
  description:
    "TAGGING ONLY: relabel filter-listed packages' raw events 'Filtered App *' so the list is visible downstream. Nothing is dropped or blanked here.",
  inputs: { rows: dedupAndOrderWiring.ports.rows },
  run: ({ rows }, ctx) =>
    ctx.options.useFilterFile ? labelFilteredApps(rows, ctx.support.filterMap) : rows,
});

export const appPolicyWiring = wireUnit<{ rows: CanonicalRow[] }>(
  "app_policy",
  [tagFilteredPackages],
  { rows: port(tagFilteredPackages) },
);
