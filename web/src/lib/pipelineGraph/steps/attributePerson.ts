import {
  attributeRows,
  buildSurveyLookup,
  resolveSharingStatuses,
} from "@/lib/stages/attributePerson";
import { observationWindowWiring } from "@/lib/pipelineGraph/steps/observationWindow";
import { port, stepsOf, wireUnit } from "@/lib/pipelineGraph/stepTypes";
import type { AttributePersonOutput } from "@/lib/pipelineGraph/unitContracts";

const step = stepsOf("attribute_person");

export const resolveSharingStatus = step({
  id: "resolve_sharing_status",
  label: "Resolve sharing status",
  description:
    "Resolve every participant to Shared / Non-Shared from the device-sharing file (throws on gaps — never defaults).",
  inputs: { rows: observationWindowWiring.ports.rows },
  run: ({ rows }, ctx) => resolveSharingStatuses(rows, ctx.support.sharingEntries ?? []),
});

export const buildSurveyLookupStep = step({
  id: "build_survey_lookup",
  label: "Build survey lookup",
  description: "(participant, exact event timestamp) → user map from survey answers; later rows win.",
  inputs: {},
  run: (_inputs, ctx) => buildSurveyLookup(ctx.support.surveyAnswers ?? []),
});

export const attributeRowsStep = step({
  id: "attribute_rows",
  label: "Attribute rows",
  description:
    "Fill null usernames (kids-shell → Target Child), apply survey relabels, re-mark non-target App Usage on shared devices.",
  inputs: {
    rows: observationWindowWiring.ports.rows,
    resolution: resolveSharingStatus,
    survey: buildSurveyLookupStep,
  },
  run: ({ rows, resolution, survey }) => attributeRows(rows, resolution, survey),
});

export const attributePersonWiring = wireUnit<AttributePersonOutput>(
  "attribute_person",
  [resolveSharingStatus, buildSurveyLookupStep, attributeRowsStep],
  {
    rows: port(attributeRowsStep, (result) => result.rows),
    report: port(attributeRowsStep, (result) => result.report),
  },
);
