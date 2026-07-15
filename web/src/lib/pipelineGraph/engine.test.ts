import { describe, expect, it } from "vitest";
import { GraphEngine, hashValue, topoSort } from "@/lib/pipelineGraph/engine";
import type { GraphDef, NodeDef } from "@/lib/pipelineGraph/graphTypes";

type Ctx = Record<string, never>;
const CTX: Ctx = {};

function node(
  id: string,
  inputs: string[],
  run: NodeDef<Ctx>["run"],
  extra: Partial<NodeDef<Ctx>> = {},
): NodeDef<Ctx> {
  return { id, label: id, section: "preprocess", inputs, knobs: [], run, ...extra };
}

const KEYS = { options: {}, supportFileHashes: {}, inputHash: "input-1" };

describe("topoSort", () => {
  it("orders nodes so every input precedes its consumer", () => {
    const def: GraphDef<Ctx> = {
      nodes: [
        node("c", ["b"], () => "c"),
        node("a", [], () => "a"),
        node("b", ["a"], () => "b"),
      ],
    };
    expect(topoSort(def as GraphDef<unknown>)).toEqual(["a", "b", "c"]);
  });

  it("throws on a cycle", () => {
    const def: GraphDef<Ctx> = {
      nodes: [node("a", ["b"], () => 0), node("b", ["a"], () => 0)],
    };
    expect(() => topoSort(def as GraphDef<unknown>)).toThrow(/cycle/);
  });

  it("throws on an unknown input reference", () => {
    const def: GraphDef<Ctx> = { nodes: [node("a", ["ghost"], () => 0)] };
    expect(() => topoSort(def as GraphDef<unknown>)).toThrow(/unknown node "ghost"/);
  });
});

describe("hashValue", () => {
  it("hashes bigint, Map and Set without throwing, key-order independent", () => {
    expect(hashValue({ b: 2n, a: new Map([["k", 1]]), s: new Set(["x"]) })).toBe(
      hashValue({ s: new Set(["x"]), a: new Map([["k", 1]]), b: 2n }),
    );
  });

  it("distinguishes different bigints", () => {
    expect(hashValue(1n)).not.toBe(hashValue(2n));
  });
});

describe("GraphEngine", () => {
  function diamond(runs: Record<string, number>): GraphDef<Ctx> {
    const count = (id: string) => {
      runs[id] = (runs[id] ?? 0) + 1;
    };
    return {
      nodes: [
        node("a", [], () => { count("a"); return "A"; }),
        node("b", ["a"], () => { count("b"); return "B"; }, {
          knobs: [{ optionKey: "knobB", edge: "tunes" }],
        }),
        node("c", ["a"], () => { count("c"); return "C"; }),
        node("d", ["b", "c"], () => { count("d"); return "D"; }),
      ],
    };
  }

  it("second run with unchanged keys serves everything from cache", async () => {
    const runs: Record<string, number> = {};
    const engine = new GraphEngine(diamond(runs));
    const first = await engine.run(CTX, KEYS);
    expect(Object.values(first.report.statuses)).toEqual([
      "recomputed", "recomputed", "recomputed", "recomputed",
    ]);
    const second = await engine.run(CTX, KEYS);
    expect(second.report.statuses).toEqual({ a: "cached", b: "cached", c: "cached", d: "cached" });
    expect(runs).toEqual({ a: 1, b: 1, c: 1, d: 1 });
    expect(second.outputs.get("d")).toBe("D");
  });

  it("changing a bound option recomputes exactly the bound node and its downstream cone", async () => {
    const runs: Record<string, number> = {};
    const engine = new GraphEngine(diamond(runs));
    await engine.run(CTX, { ...KEYS, options: { knobB: 1 } });
    const second = await engine.run(CTX, { ...KEYS, options: { knobB: 2 } });
    expect(second.report.statuses).toEqual({
      a: "cached", c: "cached", b: "recomputed", d: "recomputed",
    });
  });

  it("changing the input hash recomputes source nodes and everything downstream", async () => {
    const runs: Record<string, number> = {};
    const engine = new GraphEngine(diamond(runs));
    await engine.run(CTX, KEYS);
    const second = await engine.run(CTX, { ...KEYS, inputHash: "input-2" });
    expect(Object.values(second.report.statuses)).toEqual([
      "recomputed", "recomputed", "recomputed", "recomputed",
    ]);
  });

  it("a throwing node reports error, downstream skips, independent branches still run", async () => {
    const def: GraphDef<Ctx> = {
      nodes: [
        node("a", [], () => "A"),
        node("b", ["a"], () => { throw new Error("boom in b"); }),
        node("c", ["a"], () => "C"),
        node("d", ["b", "c"], () => "D"),
      ],
    };
    const engine = new GraphEngine(def);
    const result = await engine.run(CTX, KEYS);
    expect(result.report.statuses).toEqual({
      a: "recomputed", b: "error", c: "recomputed", d: "skipped",
    });
    expect(result.report.errors.b).toBe("boom in b");
    expect(result.outputs.has("d")).toBe(false);
    expect(result.outputs.get("c")).toBe("C");
  });

  it("an errored node is retried on the next run (no poisoned cache)", async () => {
    let shouldFail = true;
    const def: GraphDef<Ctx> = {
      nodes: [
        node("a", [], () => "A"),
        node("b", ["a"], () => {
          if (shouldFail) throw new Error("first time");
          return "B";
        }),
      ],
    };
    const engine = new GraphEngine(def);
    const first = await engine.run(CTX, KEYS);
    expect(first.report.statuses.b).toBe("error");
    shouldFail = false;
    // Same keys — but the errored node must not be served from cache.
    const second = await engine.run(CTX, KEYS);
    expect(second.report.statuses.b).toBe("recomputed");
    expect(second.outputs.get("b")).toBe("B");
  });

  it("outputHash early cutoff keeps downstream cached when a rerun yields identical output", async () => {
    const runs: Record<string, number> = {};
    const count = (id: string) => { runs[id] = (runs[id] ?? 0) + 1; };
    const def: GraphDef<Ctx> = {
      nodes: [
        node("a", [], () => { count("a"); return "A"; }, {
          knobs: [{ optionKey: "knobA", edge: "tunes" }],
          outputHash: (value) => hashValue(value),
        }),
        node("b", ["a"], () => { count("b"); return "B"; }),
      ],
    };
    const engine = new GraphEngine(def);
    await engine.run(CTX, { ...KEYS, options: { knobA: 1 } });
    // knobA changes → a reruns, but produces the same output hash → b stays cached.
    const second = await engine.run(CTX, { ...KEYS, options: { knobA: 2 } });
    expect(second.report.statuses).toEqual({ a: "recomputed", b: "cached" });
    expect(runs).toEqual({ a: 2, b: 1 });
  });

  it("a gated-off node reports 'bypassed' (never 'ran'/'cached'), body still executes", async () => {
    const runs: Record<string, number> = {};
    const def: GraphDef<Ctx> = {
      nodes: [
        node("a", [], () => "A"),
        node("b", ["a"], () => { runs.b = (runs.b ?? 0) + 1; return "pass-through"; }, {
          knobs: [{ optionKey: "gateB", edge: "gates" }],
          bypassedWhen: (options) => options.gateB !== true,
        }),
        node("c", ["b"], () => "C"),
      ],
    };
    const engine = new GraphEngine(def);

    const off = await engine.run(CTX, { ...KEYS, options: { gateB: false } });
    expect(off.report.statuses.b).toBe("bypassed");
    // The body ran anyway — downstream consumes its pass-through value.
    expect(runs.b).toBe(1);
    expect(off.outputs.get("b")).toBe("pass-through");
    expect(off.report.statuses.c).toBe("recomputed");

    // Unchanged keys: served from cache, but STILL reported off — a cache
    // hit must not resurrect a "cached" badge on a disabled step.
    const offAgain = await engine.run(CTX, { ...KEYS, options: { gateB: false } });
    expect(offAgain.report.statuses.b).toBe("bypassed");
    expect(runs.b).toBe(1);

    // Turning the gate on recomputes (gate knob is in the cache key).
    const on = await engine.run(CTX, { ...KEYS, options: { gateB: true } });
    expect(on.report.statuses.b).toBe("recomputed");
    expect(runs.b).toBe(2);
  });

  it("support-file hash changes dirty the nodes declaring that file", async () => {
    const def: GraphDef<Ctx> = {
      nodes: [
        node("a", [], () => "A", { supportFiles: ["filterFile"] }),
        node("b", [], () => "B"),
      ],
    };
    const engine = new GraphEngine(def);
    await engine.run(CTX, { ...KEYS, supportFileHashes: { filterFile: "h1" } });
    const second = await engine.run(CTX, { ...KEYS, supportFileHashes: { filterFile: "h2" } });
    expect(second.report.statuses).toEqual({ a: "recomputed", b: "cached" });
  });
});
