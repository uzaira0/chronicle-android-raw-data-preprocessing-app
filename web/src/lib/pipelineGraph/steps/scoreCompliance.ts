import {
  accumulateAttributionMinutes,
  scoreComplianceDays,
  type ComplianceResult,
} from "@/lib/stages/scoreCompliance";
import { attributePersonWiring } from "@/lib/pipelineGraph/steps/attributePerson";
import { dayCoverageWiring } from "@/lib/pipelineGraph/steps/dayCoverage";
import { port, stepsOf, wireUnitWhole } from "@/lib/pipelineGraph/stepTypes";

const step = stepsOf("score_compliance");

export const accumulateMinutes = step({
  id: "accumulate_attribution_minutes",
  label: "Accumulate attribution minutes",
  description:
    "Bucket known vs unknown attributed minutes per (participant, day) using the attribution SSOT.",
  inputs: { rows: dayCoverageWiring.ports.rows },
  run: ({ rows }) => accumulateAttributionMinutes(rows),
});

export const scoreDays = step({
  id: "score_days",
  label: "Score days",
  description:
    "known/(known+unknown)×100 per shared-device day vs the threshold; Non-Shared days are 100; zero-usage days flagged.",
  inputs: { accumulation: accumulateMinutes, report: attributePersonWiring.ports.report },
  run: ({ accumulation, report }, ctx) =>
    scoreComplianceDays(
      accumulation,
      new Set(report?.sharedParticipants ?? []),
      ctx.options.complianceThresholdPercent,
    ),
});

export const scoreComplianceWiring = wireUnitWhole<ComplianceResult | null>(
  "score_compliance",
  [accumulateMinutes, scoreDays],
  port(scoreDays),
);
