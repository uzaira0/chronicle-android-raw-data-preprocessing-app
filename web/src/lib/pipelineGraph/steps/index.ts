/**
 * Step-wiring registry: every unit's executable wiring, in pipeline order.
 * The graph view, the contract artifact, and the ontology projection all
 * derive the full step DAG from these objects — the same objects the step
 * runner executes.
 */

import type { UnitWiring } from "@/lib/pipelineGraph/stepTypes";

import { parseEventsWiring } from "@/lib/pipelineGraph/steps/parseEvents";
import { normalizeTimezonesWiring } from "@/lib/pipelineGraph/steps/normalizeTimezones";
import { dedupAndOrderWiring } from "@/lib/pipelineGraph/steps/dedupAndOrder";
import { appPolicyWiring } from "@/lib/pipelineGraph/steps/appPolicy";
import { deviceStateTimelineWiring } from "@/lib/pipelineGraph/steps/deviceStateTimeline";
import { reconstructEpisodesWiring } from "@/lib/pipelineGraph/steps/reconstructEpisodes";
import { categorizeAppsWiring } from "@/lib/pipelineGraph/steps/categorizeApps";
import { episodeAnnotationsWiring } from "@/lib/pipelineGraph/steps/episodeAnnotations";
import { intervalCleaningWiring } from "@/lib/pipelineGraph/steps/intervalCleaning";
import { effectiveUsageWiring } from "@/lib/pipelineGraph/steps/effectiveUsage";
import { observationWindowWiring } from "@/lib/pipelineGraph/steps/observationWindow";
import { attributePersonWiring } from "@/lib/pipelineGraph/steps/attributePerson";
import { dayCoverageWiring } from "@/lib/pipelineGraph/steps/dayCoverage";
import { scoreComplianceWiring } from "@/lib/pipelineGraph/steps/scoreCompliance";
import { outputsWiring } from "@/lib/pipelineGraph/steps/outputs";

export {
  parseEventsWiring,
  normalizeTimezonesWiring,
  dedupAndOrderWiring,
  appPolicyWiring,
  deviceStateTimelineWiring,
  reconstructEpisodesWiring,
  categorizeAppsWiring,
  episodeAnnotationsWiring,
  intervalCleaningWiring,
  effectiveUsageWiring,
  observationWindowWiring,
  attributePersonWiring,
  dayCoverageWiring,
  scoreComplianceWiring,
  outputsWiring,
};

/** All unit wirings in pipeline (declaration) order. */
export const ALL_UNIT_WIRINGS: readonly UnitWiring<unknown>[] = [
  parseEventsWiring,
  normalizeTimezonesWiring,
  dedupAndOrderWiring,
  appPolicyWiring,
  deviceStateTimelineWiring,
  reconstructEpisodesWiring,
  categorizeAppsWiring,
  episodeAnnotationsWiring,
  intervalCleaningWiring,
  effectiveUsageWiring,
  observationWindowWiring,
  attributePersonWiring,
  dayCoverageWiring,
  scoreComplianceWiring,
  outputsWiring,
];
