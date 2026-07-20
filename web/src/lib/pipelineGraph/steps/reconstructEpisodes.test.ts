/**
 * Mutation-killing tests for the reconstruct_episodes step wiring: the three
 * useFilterFile bypass gates, the two-clause split-concurrent gate (full truth
 * table), and the "no valid app usage" guard inside build_matcher_input.
 */

import { describe, expect, it } from "vitest";
// Enter the wiring module graph through graphDef (the back-edge of the
// browserPipeline↔graphDef import cycle) so every wiring is fully
// initialized before this file imports an individual step module directly.
import "@/lib/pipelineGraph/graphDef";
import type { CanonicalRow } from "@/lib/browserPipeline";
import type { PipelineCtx } from "@/lib/pipelineGraph/unitContracts";
import {
  buildMatcherInputStep,
  computeJunkPackages,
  junkBlindFold,
  junkDownstreamMark,
  splitConcurrent,
} from "@/lib/pipelineGraph/steps/reconstructEpisodes";

const RESUMED = "Activity Resumed";
const PAUSED = "Activity Paused";

// A ctx with enough runtime for buildMatcherInput to succeed once the guard
// lets it through (avoids NaNâBigInt blowups that would mask the guard).
const matcherCtx = {
  options: {
    modelConcurrentUsage: false,
    longDurationThresholdHours: 1,
    proximityIntervalSeconds: 0,
    allowStopEventReuse: false,
    useActivityStoppedAsFallback: false,
    applyThresholdToFallback: false,
  },
  support: { backgroundAppsSet: new Set<string>() },
} as unknown as PipelineCtx;

const rowOf = (interactionType: string): CanonicalRow =>
  ({
    app_package_name: "com.example.app",
    interaction_type: interactionType,
    event_timestamp_ns: 0n,
  }) as unknown as CanonicalRow;

describe("reconstruct_episodes useFilterFile gates", () => {
  // Kills the `!` removal (BooleanLiteral) on each gate: real is the negation
  // of useFilterFile, the mutant is useFilterFile itself.
  it("gates compute_junk_packages on useFilterFile", () => {
    expect(computeJunkPackages.bypassedWhen!({ useFilterFile: true })).toBe(false);
    expect(computeJunkPackages.bypassedWhen!({ useFilterFile: false })).toBe(true);
  });

  it("gates junk_blind_fold on useFilterFile", () => {
    expect(junkBlindFold.bypassedWhen!({ useFilterFile: true })).toBe(false);
    expect(junkBlindFold.bypassedWhen!({ useFilterFile: false })).toBe(true);
  });

  it("gates junk_downstream_mark on useFilterFile", () => {
    expect(junkDownstreamMark.bypassedWhen!({ useFilterFile: true })).toBe(false);
    expect(junkDownstreamMark.bypassedWhen!({ useFilterFile: false })).toBe(true);
  });
});

describe("reconstruct_episodes split_concurrent two-clause gate", () => {
  // Full truth table over (modelConcurrentUsage, useBackgroundAppsFile) pins the
  // AND, both negations, and the whole-condition true/false replacements:
  //   real = !model && !background  â true ONLY when both are false.
  const bypass = (model: boolean, background: boolean) =>
    splitConcurrent.bypassedWhen!({
      modelConcurrentUsage: model,
      useBackgroundAppsFile: background,
    });

  it("is bypassed only when neither concurrent modeling nor background apps are on", () => {
    expect(bypass(false, false)).toBe(true); // kills whole-conditionâfalse
    expect(bypass(true, false)).toBe(false); // kills âtrue, ||, and first-! removal
    expect(bypass(false, true)).toBe(false); // kills âtrue and second-! removal
    expect(bypass(true, true)).toBe(false); // kills whole-conditionâtrue
  });
});

describe("reconstruct_episodes build_matcher_input guard", () => {
  it("throws the exact 'no valid app usage' message when no resumes/pauses are present", () => {
    // Kills the emptied-block mutant (which would fall through to the matcher
    // and NOT throw) and the blanked message literal (which would throw "").
    expect(() =>
      buildMatcherInputStep.run({ rows: [rowOf("App Usage")] }, matcherCtx),
    ).toThrow(/No valid app usage data during the study period/);
  });

  it("does NOT fire the guard when a paused row is present (=== PAUSED, not !==)", () => {
    // Under the EqualityOperator mutant (`=== PAUSED` â `!== PAUSED`), a lone
    // PAUSED row no longer satisfies `some(...)`, so the guard fires and throws.
    // Real code lets it through and build_matcher_input succeeds.
    expect(() =>
      buildMatcherInputStep.run({ rows: [rowOf(PAUSED)] }, matcherCtx),
    ).not.toThrow();
  });

  it("also lets a resumed row through the guard", () => {
    expect(() =>
      buildMatcherInputStep.run({ rows: [rowOf(RESUMED)] }, matcherCtx),
    ).not.toThrow();
  });
});
