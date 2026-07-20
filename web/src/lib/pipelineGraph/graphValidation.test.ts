import { describe, expect, it, beforeAll } from "vitest";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { GraphEngine, hashValue } from "@/lib/pipelineGraph/engine";
import { buildChronicleGraph, UNBOUND_OPTION_KEYS } from "@/lib/pipelineGraph/graphDef";
import type { PipelineCtx, PipelineOutputs } from "@/lib/pipelineGraph/graphDef";
import type { BrowserProcessingOptions } from "@/lib/types";
import {
  ALL_ON,
  CONTRACT_KEYS,
  FILTER_DEPENDENT_ANNOTATION_COLUMNS,
  FIXTURE_CSV,
  JUNK_PACKAGE,
  RUN_KEYS,
  VALID_SUPPORT_FILE_KEYS,
  altValue,
  buildSupport,
  byId,
  def,
  descendantsOf,
  ensureWasm,
  expectedBypassed,
  makeCtx,
  order,
  predictRecomputeCone,
  serializeRows,
  traceGraphExecution,
} from "@/lib/pipelineGraph/validationHarness";

/**
 * Full validation of the chronicle pipeline graph as a DAG and as a state
 * machine over the option space:
 *
 *  1. DAG structure — acyclicity, single source/sink, connectivity, edge
 *     integrity, knob/support-file reference integrity.
 *  2. Gate-space state machine — bypassedWhen evaluated over the FULL
 *     boolean gate space (4096 states) against a closed-form spec, plus
 *     purity (a predicate may only read that node's own declared knobs).
 *  3. Cache-key soundness (the staleness guarantee) — every node body is
 *     executed under read-tracing proxies across many configurations;
 *     option reads must be ⊆ declared knobs, support reads ⊆ declared
 *     supportFiles, raw-input reads confined to source nodes, and upstream
 *     reads ⊆ declared inputs.
 *  4. Execution state machine — the real graph is run end-to-end (REAL wasm
 *     matcher + splitter) across a 2^7 gate subspace; node statuses must
 *     match the predicted bypass vector exactly, output shapes must match
 *     the state, error states must propagate as error→skipped, and the
 *     junk-blind invariance (valid-app rows independent of useFilterFile)
 *     must hold pairwise across the whole subspace.
 *  5. Incremental recompute — for EVERY bound option key, flipping it must
 *     recompute exactly the binding nodes plus their downstream cone;
 *     unbound keys must recompute nothing; support-file hash changes must
 *     dirty exactly the declaring nodes' cones.
 */

beforeAll(async () => {
  await ensureWasm();
}, 30_000);

// ─────────────────────────────────────────────────────────────────────────────
describe("1. DAG structure", () => {
  it("has unique node ids", () => {
    const ids = def.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is acyclic with a total topological order", () => {
    expect(order).toHaveLength(def.nodes.length);
  });

  it("has no self-loops and no duplicate input edges", () => {
    for (const node of def.nodes) {
      expect(node.inputs, node.id).not.toContain(node.id);
      expect(new Set(node.inputs).size, node.id).toBe(node.inputs.length);
    }
  });

  it("every input edge references an existing node", () => {
    for (const node of def.nodes) {
      for (const input of node.inputs) {
        expect(byId.has(input), `${node.id} ← ${input}`).toBe(true);
      }
    }
  });

  it("has exactly one source (parse_events) and one sink (outputs)", () => {
    const sources = def.nodes.filter((node) => node.inputs.length === 0);
    expect(sources.map((node) => node.id)).toEqual(["parse_events"]);
    const consumed = new Set(def.nodes.flatMap((node) => node.inputs));
    const sinks = def.nodes.filter((node) => !consumed.has(node.id));
    expect(sinks.map((node) => node.id)).toEqual(["outputs"]);
  });

  it("every node is reachable from the source and reaches the sink", () => {
    const fromSource = descendantsOf(new Set(["parse_events"]));
    expect([...fromSource].sort()).toEqual(def.nodes.map((node) => node.id).sort());
    // Reverse reachability: every node's forward cone must contain the sink.
    for (const node of def.nodes) {
      const cone = descendantsOf(new Set([node.id]));
      expect(cone.has("outputs"), `${node.id} does not reach outputs`).toBe(true);
    }
  });

  it("every knob binds a real contract option, once per node, with a valid edge type", () => {
    for (const node of def.nodes) {
      const keys = node.knobs.map((knob) => knob.optionKey);
      expect(new Set(keys).size, `duplicate knob on ${node.id}`).toBe(keys.length);
      for (const knob of node.knobs) {
        expect(CONTRACT_KEYS.has(knob.optionKey), `${node.id}.${knob.optionKey}`).toBe(true);
        expect(["gates", "tunes"]).toContain(knob.edge);
        expect(UNBOUND_OPTION_KEYS.has(knob.optionKey), `${node.id} binds declared-unbound ${knob.optionKey}`).toBe(false);
      }
    }
  });

  it("every declared support file is a real BrowserSupportFiles key, once per node", () => {
    for (const node of def.nodes) {
      const files = node.supportFiles ?? [];
      expect(new Set(files).size, `duplicate support file on ${node.id}`).toBe(files.length);
      for (const file of files) {
        expect(VALID_SUPPORT_FILE_KEYS.has(file), `${node.id} → ${file}`).toBe(true);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("2. Gate-space state machine (full 2^12 enumeration)", () => {
  const GATE_BOOLEANS = [
    "processAppUsage",
    "processScreenUsage",
    "useFilterFile",
    "useAppCodebook",
    "enableScreenGatedCrediting",
    "enableStudyWindowFilter",
    "enablePersonAttribution",
    "enableComplianceScoring",
    "addNoActivityPlaceholderDays",
    "enableDayCoverage",
    "filterZeroDurationSessions",
  ] as const;

  it("bypassedWhen matches the closed-form spec in every one of the 4096 gate states, and each predicate only reads its own node's knobs", () => {
    const combos = 1 << (GATE_BOOLEANS.length + 1);
    for (let mask = 0; mask < combos; mask += 1) {
      const options: BrowserProcessingOptions = { ...DEFAULT_BROWSER_OPTIONS };
      GATE_BOOLEANS.forEach((key, bit) => {
        (options as unknown as Record<string, boolean>)[key] = Boolean(mask & (1 << bit));
      });
      // The 12th axis: interactionTypesToRemove empty vs non-empty.
      options.interactionTypesToRemove = mask & (1 << GATE_BOOLEANS.length) ? ["Usage Stat"] : [];

      for (const node of def.nodes) {
        if (!node.bypassedWhen) {
          expect(expectedBypassed(node.id, options), `${node.id} should never be off`).toBe(false);
          continue;
        }
        const reads = new Set<string>();
        const optionsRecord: Record<string, unknown> = options;
        const traced = new Proxy(optionsRecord, {
          get(target, prop, receiver) {
            if (typeof prop === "string") reads.add(prop);
            return Reflect.get(target, prop, receiver) as unknown;
          },
        });
        const actual = node.bypassedWhen(traced);
        expect(actual, `${node.id} @ mask ${mask}`).toBe(expectedBypassed(node.id, options));
        const declared = new Set(node.knobs.map((knob) => knob.optionKey));
        for (const read of reads) {
          expect(declared.has(read), `${node.id}.bypassedWhen reads undeclared option "${read}"`).toBe(true);
        }
      }
    }
    // 4096 masks × every node × a tracing Proxy is legitimately ~5 s of work;
    // give it headroom so a loaded machine doesn't trip the 5 s default.
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("3. Cache-key soundness — traced execution (reads ⊆ declarations)", () => {
  // Configurations chosen to drive every conditional branch inside node
  // bodies (concurrent split, background construction, filter mark, screen
  // off, app off, fallback paths, removals, remap).
  const TRACE_CONFIGS: Array<[string, BrowserProcessingOptions]> = [
    ["defaults", { ...DEFAULT_BROWSER_OPTIONS }],
    ["all-on", { ...ALL_ON }],
    ["app-only", { ...ALL_ON, processScreenUsage: false }],
    ["screen-only", { ...ALL_ON, processAppUsage: false }],
    ["no-filter", { ...ALL_ON, useFilterFile: false }],
    ["no-background", { ...ALL_ON, useBackgroundAppsFile: false }],
    ["no-concurrent", { ...ALL_ON, modelConcurrentUsage: false }],
    ["remap+removals", {
      ...ALL_ON,
      interactionTypeRemap: ["Notification Seen=>Activity Paused"],
      interactionTypesToRemove: ["Usage Stat", "Notification Seen"],
    }],
    ["no-dedup", { ...ALL_ON, deduplicateExactRows: false, correctDuplicateEventTimestamps: false }],
    ["stop-reuse+fallback-off", { ...ALL_ON, allowStopEventReuse: true, useActivityStoppedAsFallback: false }],
  ];

  for (const [name, options] of TRACE_CONFIGS) {
    it(`config "${name}": every node reads only declared knobs, support files, and inputs`, async () => {
      const result = await traceGraphExecution(options);
      expect(result.error, `node "${result.error?.nodeId}" threw: ${result.error?.message}`).toBeNull();
      expect(result.violations).toEqual([]);
    }, 30_000);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe("4. Execution state machine (real engine, real matcher)", () => {
  const EXEC_GATES = [
    "processAppUsage",
    "processScreenUsage",
    "useFilterFile",
    "useBackgroundAppsFile",
    "modelConcurrentUsage",
    "enableScreenGatedCrediting",
    "enableDayCoverage",
  ] as const;

  interface ExecResult {
    statuses: Record<string, string>;
    errors: Record<string, string>;
    outputs: PipelineOutputs;
  }

  async function execute(options: BrowserProcessingOptions): Promise<ExecResult> {
    const engine = new GraphEngine<PipelineCtx>(buildChronicleGraph());
    const run = await engine.run(makeCtx(options), RUN_KEYS(options));
    return {
      statuses: run.report.statuses,
      errors: run.report.errors,
      outputs: run.outputs.get("outputs") as PipelineOutputs,
    };
  }

  it("all 128 gate states: no errors, statuses match the bypass vector, output shapes match the state", async () => {
    const byCombo = new Map<number, ExecResult>();
    for (let mask = 0; mask < 1 << EXEC_GATES.length; mask += 1) {
      const options: BrowserProcessingOptions = { ...ALL_ON };
      EXEC_GATES.forEach((key, bit) => {
        (options as unknown as Record<string, boolean>)[key] = Boolean(mask & (1 << bit));
      });
      const result = await execute(options);
      byCombo.set(mask, result);

      expect(result.errors, `mask ${mask}`).toEqual({});
      for (const node of def.nodes) {
        const expected = expectedBypassed(node.id, options) ? "bypassed" : "recomputed";
        expect(result.statuses[node.id], `mask ${mask} node ${node.id}`).toBe(expected);
      }

      // Output shape ⇔ state.
      const out = result.outputs;
      expect(out.appRows.length === 0, `mask ${mask} appRows`).toBe(!options.processAppUsage);
      expect(out.screenRows.length === 0, `mask ${mask} screenRows`).toBe(!options.processScreenUsage);
      expect(out.credited === null, `mask ${mask} credited`).toBe(
        !options.processAppUsage || !options.enableScreenGatedCrediting,
      );
      expect(out.coverage === null, `mask ${mask} coverage`).toBe(
        !options.processAppUsage || !options.enableDayCoverage,
      );
      expect(out.compliance === null, `mask ${mask} compliance`).toBe(!options.processAppUsage);
    }

    // Junk-blind invariance, graph level: for every pair of states differing
    // ONLY in useFilterFile, the valid apps' App Usage EPISODES (row set,
    // timestamps, durations, every non-walk column) are identical. The
    // engagement-walk annotation columns are excluded — they are defined
    // over filter-dependent universes (see FILTER_DEPENDENT_ANNOTATION_COLUMNS).
    const filterBit = EXEC_GATES.indexOf("useFilterFile");
    for (let mask = 0; mask < 1 << EXEC_GATES.length; mask += 1) {
      if (mask & (1 << filterBit)) continue;
      const off = byCombo.get(mask)!;
      const on = byCombo.get(mask | (1 << filterBit))!;
      const validRows = (result: ExecResult) =>
        result.outputs.appRows.filter(
          (row) => row.app_package_name !== JUNK_PACKAGE && row.interaction_type === "App Usage",
        );
      expect(
        serializeRows(validRows(on), FILTER_DEPENDENT_ANNOTATION_COLUMNS),
        `filter on/off episode divergence at mask ${mask}`,
      ).toBe(serializeRows(validRows(off), FILTER_DEPENDENT_ANNOTATION_COLUMNS));
    }
  }, 120_000);

  it("analyze-tier gates: statuses and report presence across the 2^4 subspace", async () => {
    const ANALYZE_GATES = [
      "enableStudyWindowFilter",
      "enablePersonAttribution",
      "enableComplianceScoring",
      "addNoActivityPlaceholderDays",
    ] as const;
    for (let mask = 0; mask < 1 << ANALYZE_GATES.length; mask += 1) {
      const options: BrowserProcessingOptions = { ...ALL_ON };
      ANALYZE_GATES.forEach((key, bit) => {
        (options as unknown as Record<string, boolean>)[key] = Boolean(mask & (1 << bit));
      });
      const result = await execute(options);
      expect(result.errors, `mask ${mask}`).toEqual({});
      for (const node of def.nodes) {
        const expected = expectedBypassed(node.id, options) ? "bypassed" : "recomputed";
        expect(result.statuses[node.id], `mask ${mask} node ${node.id}`).toBe(expected);
      }
      expect(result.outputs.attribution === null, `mask ${mask} attribution`).toBe(
        !options.enablePersonAttribution,
      );
      expect(result.outputs.compliance === null, `mask ${mask} compliance`).toBe(
        !options.enableComplianceScoring,
      );
    }
  }, 60_000);

  it("error state: an enabled analyze gate with its study file missing fails loud and skips exactly the downstream cone", async () => {
    const options = { ...ALL_ON };
    const support = buildSupport(options);
    support.studyWindows = null; // window filter enabled but no study-dates file
    const engine = new GraphEngine<PipelineCtx>(buildChronicleGraph());
    const run = await engine.run(makeCtx(options, support), RUN_KEYS(options));

    expect(run.report.statuses.observation_window).toBe("error");
    expect(run.report.errors.observation_window).toMatch(/study-dates file/);
    for (const id of ["attribute_person", "day_coverage", "score_compliance", "outputs"]) {
      expect(run.report.statuses[id], id).toBe("skipped");
    }
    // Independent branches keep running.
    expect(run.report.statuses.device_state_timeline).toBe("recomputed");
    expect(run.report.statuses.effective_usage).toBe("recomputed");
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("5. Incremental recompute (dirty cone per option key)", () => {
  const boundKeys = [...new Set(def.nodes.flatMap((node) => node.knobs.map((knob) => knob.optionKey)))];

  it("covers every bound key with a binder → cone expectation", () => {
    expect(boundKeys.length).toBeGreaterThan(0);
    for (const key of boundKeys) {
      expect(CONTRACT_KEYS.has(key), key).toBe(true);
    }
  });

  for (const key of [...new Set(def.nodes.flatMap((node) => node.knobs.map((knob) => knob.optionKey)))]) {
    it(`flipping "${key}" recomputes exactly its binding nodes plus their downstream cone`, async () => {
      const engine = new GraphEngine<PipelineCtx>(buildChronicleGraph());
      const base = await engine.run(makeCtx(ALL_ON), RUN_KEYS(ALL_ON));

      const allOnRecord: Record<string, unknown> = ALL_ON;
      const flipped = {
        ...ALL_ON,
        [key]: altValue(key, allOnRecord[key]),
      };
      const run = await engine.run(makeCtx(flipped), RUN_KEYS(flipped));
      expect(run.report.errors).toEqual({});

      const binders = new Set(
        def.nodes.filter((node) => node.knobs.some((knob) => knob.optionKey === key)).map((node) => node.id),
      );
      // Value-driven: a binder whose output is unchanged by the flip (e.g. a
      // remap of an absent event type, or a dedup flag on a file with no
      // duplicates) cuts off, keeping its cone cached. predictRecomputeCone
      // collapses to descendantsOf when no cutoff fires.
      const cone = predictRecomputeCone(binders, base.outputs, run.outputs);
      for (const node of def.nodes) {
        const expected = expectedBypassed(node.id, flipped)
          ? "bypassed"
          : cone.has(node.id)
            ? "recomputed"
            : "cached";
        expect(run.report.statuses[node.id], `${key} → ${node.id}`).toBe(expected);
      }
    }, 30_000);
  }

  it("flipping an unbound (presentation/runtime) key recomputes nothing", async () => {
    const engine = new GraphEngine<PipelineCtx>(buildChronicleGraph());
    await engine.run(makeCtx(ALL_ON), RUN_KEYS(ALL_ON));
    const flipped = { ...ALL_ON, enablePlotting: !ALL_ON.enablePlotting };
    const run = await engine.run(makeCtx(flipped), RUN_KEYS(flipped));
    for (const node of def.nodes) {
      expect(["cached", "bypassed"], `${node.id}`).toContain(run.report.statuses[node.id]);
      expect(run.report.statuses[node.id]).not.toBe("recomputed");
    }
  }, 30_000);

  it("a support-file content change dirties exactly the declaring nodes' cones", async () => {
    const engine = new GraphEngine<PipelineCtx>(buildChronicleGraph());
    const base = await engine.run(
      makeCtx(ALL_ON),
      RUN_KEYS(ALL_ON, { supportFileHashes: { filterFile: "h1" } }),
    );
    const run = await engine.run(makeCtx(ALL_ON), RUN_KEYS(ALL_ON, { supportFileHashes: { filterFile: "h2" } }));

    const binders = new Set(
      def.nodes.filter((node) => (node.supportFiles ?? []).includes("filterFile")).map((node) => node.id),
    );
    expect(binders.size).toBeGreaterThan(0);
    // The filter map content is identical (same buildSupport), only the
    // declared hash differs, so app_policy reruns but its tagged output is
    // unchanged → early cutoff keeps the matcher cone cached.
    const cone = predictRecomputeCone(binders, base.outputs, run.outputs);
    for (const node of def.nodes) {
      const expected = expectedBypassed(node.id, ALL_ON)
        ? "bypassed"
        : cone.has(node.id)
          ? "recomputed"
          : "cached";
      expect(run.report.statuses[node.id], node.id).toBe(expected);
    }
  }, 30_000);

  it("a genuine input-content change recomputes the entire graph (parse output differs, no cutoff)", async () => {
    const engine = new GraphEngine<PipelineCtx>(buildChronicleGraph());
    // A real content change alters the parsed rows, so parse_events restamps
    // and the whole graph reruns. (Contrast the next test: an inputHash change
    // whose content is identical cuts off at parse_events.)
    const variantCsv = `${FIXTURE_CSV}\nStudy,P01,Target Child,Chat,Unknown importance: 1,com.valid.chat,2026-03-08 10:00:00,America/Chicago`;
    await engine.run(
      { ...makeCtx(ALL_ON), csvText: FIXTURE_CSV },
      RUN_KEYS(ALL_ON, { inputHash: hashValue([FIXTURE_CSV]) }),
    );
    const run = await engine.run(
      { ...makeCtx(ALL_ON), csvText: variantCsv },
      RUN_KEYS(ALL_ON, { inputHash: hashValue([variantCsv]) }),
    );
    for (const node of def.nodes) {
      const expected = expectedBypassed(node.id, ALL_ON) ? "bypassed" : "recomputed";
      expect(run.report.statuses[node.id], node.id).toBe(expected);
    }
  }, 30_000);

  it("an inputHash change with identical content cuts off at parse_events", async () => {
    const engine = new GraphEngine<PipelineCtx>(buildChronicleGraph());
    // Same csvText, different declared inputHash: parse_events reruns but its
    // output is byte-identical, so early cutoff keeps every downstream node
    // cached — the whole point of declaring earlyCutoff on the source.
    await engine.run(makeCtx(ALL_ON), RUN_KEYS(ALL_ON, { inputHash: hashValue(["a"]) }));
    const run = await engine.run(makeCtx(ALL_ON), RUN_KEYS(ALL_ON, { inputHash: hashValue(["b"]) }));
    expect(run.report.statuses.parse_events).toBe("recomputed");
    for (const node of def.nodes) {
      if (node.id === "parse_events") continue;
      const expected = expectedBypassed(node.id, ALL_ON) ? "bypassed" : "cached";
      expect(run.report.statuses[node.id], node.id).toBe(expected);
    }
  }, 30_000);
});
