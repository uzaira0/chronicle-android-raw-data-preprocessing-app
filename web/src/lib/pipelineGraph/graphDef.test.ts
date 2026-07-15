import { describe, expect, it } from "vitest";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { topoSort } from "@/lib/pipelineGraph/engine";
import { buildChronicleGraph, UNBOUND_OPTION_KEYS } from "@/lib/pipelineGraph/graphDef";
import type { GraphDef } from "@/lib/pipelineGraph/graphTypes";

describe("buildChronicleGraph", () => {
  const def = buildChronicleGraph();

  it("topo-sorts cleanly and ends at the outputs sink", () => {
    const order = topoSort(def as GraphDef<unknown>);
    expect(order[0]).toBe("parse_events");
    expect(order[order.length - 1]).toBe("outputs");
  });

  it("binds every pipeline-semantic option to at least one node", () => {
    const bound = new Set<string>();
    for (const node of def.nodes) {
      for (const knob of node.knobs) bound.add(knob.optionKey);
    }
    const missing = Object.keys(DEFAULT_BROWSER_OPTIONS).filter(
      (key) => !bound.has(key) && !UNBOUND_OPTION_KEYS.has(key),
    );
    expect(missing).toEqual([]);
  });

  it("does not bind options declared presentation/runtime-only", () => {
    const bound = new Set<string>();
    for (const node of def.nodes) {
      for (const knob of node.knobs) bound.add(knob.optionKey);
    }
    const wrongly = [...UNBOUND_OPTION_KEYS].filter((key) => bound.has(key));
    expect(wrongly).toEqual([]);
  });

  it("is a genuine DAG, not a chain: episodes and the state timeline both feed downstream joins", () => {
    const byId = new Map(def.nodes.map((node) => [node.id, node]));
    expect(byId.get("outputs")!.inputs.length).toBeGreaterThan(1);
    expect(byId.get("device_state_timeline")!.inputs).toEqual(["app_policy"]);
    expect(byId.get("reconstruct_episodes")!.inputs).toEqual(["app_policy"]);
  });

  describe("bypassedWhen (gated-off = off in the graph, never 'ran')", () => {
    const byId = new Map(def.nodes.map((node) => [node.id, node]));
    const ALL_ON: Record<string, unknown> = {
      processAppUsage: true,
      processScreenUsage: true,
      useFilterFile: true,
      useAppCodebook: true,
      enableScreenGatedCrediting: true,
      enableStudyWindowFilter: true,
      enablePersonAttribution: true,
      enableComplianceScoring: true,
      addNoActivityPlaceholderDays: true,
      enableDayCoverage: true,
      interactionTypesToRemove: ["Usage Stat"],
      filterZeroDurationSessions: true,
    };
    const bypassed = (id: string, options: Record<string, unknown>): boolean =>
      byId.get(id)!.bypassedWhen?.(options) === true;

    it("no node is bypassed with every gate on", () => {
      for (const node of def.nodes) {
        expect(node.bypassedWhen?.(ALL_ON) ?? false).toBe(false);
      }
    });

    it("each analyze/clean stage goes off with its own gate", () => {
      expect(bypassed("app_policy", { ...ALL_ON, useFilterFile: false })).toBe(true);
      expect(bypassed("device_state_timeline", { ...ALL_ON, processScreenUsage: false })).toBe(true);
      expect(bypassed("categorize_apps", { ...ALL_ON, useAppCodebook: false })).toBe(true);
      expect(bypassed("effective_usage", { ...ALL_ON, enableScreenGatedCrediting: false })).toBe(true);
      expect(bypassed("observation_window", { ...ALL_ON, enableStudyWindowFilter: false })).toBe(true);
      expect(bypassed("attribute_person", { ...ALL_ON, enablePersonAttribution: false })).toBe(true);
      expect(bypassed("score_compliance", { ...ALL_ON, enableComplianceScoring: false })).toBe(true);
    });

    it("processAppUsage off turns the whole app chain off", () => {
      const appOff = { ...ALL_ON, processAppUsage: false };
      for (const id of [
        "reconstruct_episodes",
        "categorize_apps",
        "episode_annotations",
        "interval_cleaning",
        "effective_usage",
        "observation_window",
        "attribute_person",
        "day_coverage",
        "score_compliance",
      ]) {
        expect(bypassed(id, appOff)).toBe(true);
      }
      // The screen chain is independent of the app gate.
      expect(bypassed("device_state_timeline", appOff)).toBe(false);
    });

    it("interval_cleaning needs ALL THREE lossy sub-steps off to be a pass-through", () => {
      const allLossyOff = {
        ...ALL_ON,
        useFilterFile: false,
        interactionTypesToRemove: [],
        filterZeroDurationSessions: false,
      };
      expect(bypassed("interval_cleaning", allLossyOff)).toBe(true);
      expect(bypassed("interval_cleaning", { ...allLossyOff, useFilterFile: true })).toBe(false);
      expect(
        bypassed("interval_cleaning", { ...allLossyOff, interactionTypesToRemove: ["Usage Stat"] }),
      ).toBe(false);
      expect(
        bypassed("interval_cleaning", { ...allLossyOff, filterZeroDurationSessions: true }),
      ).toBe(false);
    });

    it("day_coverage needs BOTH halves off to be a pass-through", () => {
      expect(bypassed("day_coverage", { ...ALL_ON, addNoActivityPlaceholderDays: false })).toBe(false);
      expect(bypassed("day_coverage", { ...ALL_ON, enableDayCoverage: false })).toBe(false);
      expect(
        bypassed("day_coverage", {
          ...ALL_ON,
          addNoActivityPlaceholderDays: false,
          enableDayCoverage: false,
        }),
      ).toBe(true);
    });

    it("always-on spine nodes declare no predicate", () => {
      for (const id of ["parse_events", "normalize_timezones", "dedup_and_order", "outputs"]) {
        expect(byId.get(id)!.bypassedWhen).toBeUndefined();
      }
    });
  });

  it("uses community-vocabulary ids and sections only", () => {
    const validSections = new Set(["preprocess", "clean", "analyze", "output"]);
    for (const node of def.nodes) {
      expect(node.id).toMatch(/^[a-z][a-z_]+$/);
      expect(validSections.has(node.section)).toBe(true);
    }
    const ids = def.nodes.map((node) => node.id);
    expect(ids).toContain("device_state_timeline");
    expect(ids).toContain("reconstruct_episodes");
    expect(ids).toContain("episode_annotations");
    expect(ids).toContain("interval_cleaning");
    expect(ids).toContain("day_coverage");
  });

  it("every node carries a plain-English description", () => {
    for (const node of def.nodes) {
      expect(node.description, node.id).toBeTruthy();
      expect(node.description!.length).toBeGreaterThan(40);
    }
  });

  it("phase separation: lossless annotation is preprocess, lossy steps are clean", () => {
    const byId = new Map(def.nodes.map((node) => [node.id, node]));
    // The engagement walk + quality flags add columns only — preprocessing.
    expect(byId.get("episode_annotations")!.section).toBe("preprocess");
    // Blanking + row drops are the lossy half — cleaning, AFTER episodes are built.
    expect(byId.get("interval_cleaning")!.section).toBe("clean");
    expect(byId.get("interval_cleaning")!.inputs).toEqual(["episode_annotations"]);
    // app_policy is the ONE clean decision pinned upstream (episode passes
    // read its marks) — it must feed the episode builder, and its lossy
    // treatment must NOT live there (it lives in interval_cleaning).
    expect(byId.get("reconstruct_episodes")!.inputs).toEqual(["app_policy"]);
    expect(byId.get("app_policy")!.label.toLowerCase()).toContain("mark");
  });
});
