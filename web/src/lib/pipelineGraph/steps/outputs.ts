import { attributePersonWiring } from "@/lib/pipelineGraph/steps/attributePerson";
import { dayCoverageWiring } from "@/lib/pipelineGraph/steps/dayCoverage";
import { deviceStateTimelineWiring } from "@/lib/pipelineGraph/steps/deviceStateTimeline";
import { effectiveUsageWiring } from "@/lib/pipelineGraph/steps/effectiveUsage";
import { observationWindowWiring } from "@/lib/pipelineGraph/steps/observationWindow";
import { appPolicyWiring } from "@/lib/pipelineGraph/steps/appPolicy";
import { scoreComplianceWiring } from "@/lib/pipelineGraph/steps/scoreCompliance";
import { port, stepsOf, wireUnitWhole } from "@/lib/pipelineGraph/stepTypes";
import type { PipelineOutputs } from "@/lib/pipelineGraph/unitContracts";

const step = stepsOf("outputs");

export const assembleResult = step({
  id: "assemble_result",
  label: "Assemble result",
  description:
    "Assemble everything the run produced — app rows, screen sessions, credited usage, window/attribution/coverage/compliance reports — into the downloadable result set.",
  inputs: {
    policyRows: appPolicyWiring.ports.rows,
    appRows: dayCoverageWiring.ports.rows,
    coverage: dayCoverageWiring.ports.coverage,
    screenRows: deviceStateTimelineWiring.wholePort,
    credited: effectiveUsageWiring.wholePort,
    droppedRows: observationWindowWiring.ports.droppedRows,
    participantsWithoutWindow: observationWindowWiring.ports.participantsWithoutWindow,
    attribution: attributePersonWiring.ports.report,
    compliance: scoreComplianceWiring.wholePort,
  },
  run: ({
    policyRows,
    appRows,
    coverage,
    screenRows,
    credited,
    droppedRows,
    participantsWithoutWindow,
    attribution,
    compliance,
  }): PipelineOutputs => ({
    policyRows,
    appRows,
    screenRows,
    credited,
    windowReport: { droppedRows, participantsWithoutWindow },
    attribution,
    coverage,
    compliance,
  }),
});

export const outputsWiring = wireUnitWhole<PipelineOutputs>(
  "outputs",
  [assembleResult],
  port(assembleResult),
);
