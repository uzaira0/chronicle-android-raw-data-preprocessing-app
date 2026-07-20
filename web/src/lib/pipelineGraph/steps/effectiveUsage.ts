import {
  assembleCreditResult,
  buildSubstrate,
  countDayApps,
  creditAllSessions,
  emitCreditedRows,
  partitionCreditSessions,
  type CreditResult,
} from "@/lib/stages/effectiveUsage";
import { appPolicyWiring } from "@/lib/pipelineGraph/steps/appPolicy";
import { intervalCleaningWiring } from "@/lib/pipelineGraph/steps/intervalCleaning";
import { screenIncapableParticipants } from "@/lib/stages/effectiveUsage";
import { port, stepsOf, wireUnitWhole } from "@/lib/pipelineGraph/stepTypes";

const step = stepsOf("effective_usage");

export const partitionSessions = step({
  id: "partition_credit_sessions",
  label: "Partition sessions",
  description:
    "Split the cleaned rows into credit-eligible App-Usage sessions (positive duration) vs pass-through rest.",
  inputs: { rows: intervalCleaningWiring.wholePort },
  run: ({ rows }) => partitionCreditSessions(rows),
});

export const buildSubstrateStep = step({
  id: "build_liveness_substrate",
  label: "Build liveness substrate",
  description:
    "Per participant: screen ON/OFF change points, boot timestamps, all event timestamps, and screen-capability — from the RAW event stream.",
  inputs: { events: appPolicyWiring.ports.rows },
  run: ({ events }) => buildSubstrate(events),
});

export const reportScreenIncapable = step({
  id: "report_screen_incapable",
  label: "Report screen-incapable",
  description: "Participants whose stream carries no usable screen change points.",
  inputs: { partition: partitionSessions, sub: buildSubstrateStep },
  run: ({ partition, sub }) => screenIncapableParticipants(partition.sessions, sub),
});

export const countDayAppsStep = step({
  id: "count_day_apps",
  label: "Count day apps",
  description: "Distinct apps per (participant, date) — the no-witness fallback gate.",
  inputs: { partition: partitionSessions },
  run: ({ partition }) => countDayApps(partition.sessions),
});

export const creditSessionsStep = step({
  id: "credit_sessions",
  label: "Credit sessions",
  description:
    "Per session: cap the end, intersect device-alive with screen-creditable intervals (auto-lock bridging), apply the no-witness fallback.",
  inputs: { partition: partitionSessions, sub: buildSubstrateStep, dayApps: countDayAppsStep },
  run: ({ partition, sub, dayApps }, ctx) =>
    creditAllSessions(partition.sessions, sub, dayApps, {
      capMinutes: ctx.options.creditedSessionCapMinutes,
      livenessToleranceMinutes: ctx.options.deviceLivenessGapToleranceMinutes,
      autoLockBridgeSeconds: ctx.options.autoLockBridgeSeconds,
      noWitnessMinDayApps: ctx.options.noWitnessMinDayApps,
    }),
});

export const emitCreditedRowsStep = step({
  id: "emit_credited_rows",
  label: "Emit credited rows",
  description:
    "Rewrite each session into one clone row per credited interval, recomputing duration and calendar columns.",
  inputs: { outcomes: creditSessionsStep },
  run: ({ outcomes }) => emitCreditedRows(outcomes),
});

export const assembleCreditResultStep = step({
  id: "assemble_credit_result",
  label: "Assemble credit result",
  description: "Credited rows first, then the pass-through rest, plus the credit report.",
  inputs: {
    partition: partitionSessions,
    incapable: reportScreenIncapable,
    emission: emitCreditedRowsStep,
  },
  run: ({ partition, incapable, emission }) =>
    assembleCreditResult(partition, incapable, emission),
});

export const effectiveUsageWiring = wireUnitWhole<CreditResult | null>(
  "effective_usage",
  [
    partitionSessions,
    buildSubstrateStep,
    reportScreenIncapable,
    countDayAppsStep,
    creditSessionsStep,
    emitCreditedRowsStep,
    assembleCreditResultStep,
  ],
  port(assembleCreditResultStep),
);
