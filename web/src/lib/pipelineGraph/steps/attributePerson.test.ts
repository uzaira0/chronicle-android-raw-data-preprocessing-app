/**
 * Mutation-killing tests for the attribute_person step bodies: both empty-array
 * fallbacks (`?? []`) surface observably once the support inputs are absent.
 */

import { describe, expect, it } from "vitest";
// Enter the wiring module graph through graphDef (the back-edge of the
// browserPipeline↔graphDef import cycle) so every wiring is fully
// initialized before this file imports an individual step module directly.
import "@/lib/pipelineGraph/graphDef";
import type { CanonicalRow } from "@/lib/browserPipeline";
import type { PipelineCtx } from "@/lib/pipelineGraph/unitContracts";
import type { SharingResolution } from "@/lib/stages/attributePerson";
import {
  buildSurveyLookupStep,
  resolveSharingStatus,
} from "@/lib/pipelineGraph/steps/attributePerson";

describe("attribute_person resolve_sharing_status", () => {
  it("treats an absent sharing table as unconfigured (empty-array fallback)", () => {
    // Real: `?? []` â empty table â lookupDeviceSharing short-circuits to
    // "Non-Shared". Mutant `?? ["Stryker was here"]` â non-empty malformed table
    // â no match â throws. So the empty fallback is what keeps this from throwing.
    const rows = [{ participant_id: "P1" }] as unknown as CanonicalRow[];
    const ctx = { options: {}, support: {} } as unknown as PipelineCtx;
    const result = resolveSharingStatus.run({ rows }, ctx) as SharingResolution;
    expect(result.nonSharedParticipants).toEqual(["P1"]);
    expect(result.sharedParticipants).toEqual([]);
  });
});

describe("attribute_person build_survey_lookup", () => {
  it("yields an empty lookup when survey answers are absent (empty-array fallback)", () => {
    // Real: `?? []` â empty map. Mutant `?? ["Stryker was here"]` â one bogus
    // entry keyed "undefined undefined" â size 1.
    const ctx = { options: {}, support: {} } as unknown as PipelineCtx;
    const result = buildSurveyLookupStep.run({}, ctx) as Map<string, string>;
    expect(result.size).toBe(0);
  });
});
