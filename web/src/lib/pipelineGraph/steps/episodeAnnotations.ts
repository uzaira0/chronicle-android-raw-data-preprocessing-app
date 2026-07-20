import {
  addAppUsageDetailColumns,
  markAppUsageFlags,
  type CanonicalRow,
} from "@/lib/browserPipeline";
import { categorizeAppsWiring } from "@/lib/pipelineGraph/steps/categorizeApps";
import { port, stepsOf, wireUnitWhole } from "@/lib/pipelineGraph/stepTypes";

const step = stepsOf("episode_annotations");

export const engagementWalk = step({
  id: "engagement_walk",
  label: "Engagement walk",
  description:
    "Sequential walk over foreground episodes computing new-engagement (30 s / custom), app switches, and inter-episode gaps — any-app and valid-app variants.",
  inputs: { rows: categorizeAppsWiring.wholePort },
  run: ({ rows }, ctx) => addAppUsageDetailColumns(rows, ctx.options),
});

export const flagAndRetain = step({
  id: "flag_and_retain",
  label: "Flag & retain",
  description:
    "Stamp quality flags for long usage sessions and long data gaps — flag, never drop.",
  inputs: { rows: engagementWalk },
  run: ({ rows }, ctx) => markAppUsageFlags(rows, ctx.options),
});

export const episodeAnnotationsWiring = wireUnitWhole<CanonicalRow[]>(
  "episode_annotations",
  [engagementWalk, flagAndRetain],
  port(flagAndRetain),
);
