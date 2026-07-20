import { describe, expect, it, vi } from "vitest";
import { alg } from "@dagrejs/graphlib";
import { GraphEngine, hashValue, topoSort, valuesEqual } from "@/lib/pipelineGraph/engine";
import type { GraphDef, NodeDef } from "@/lib/pipelineGraph/graphTypes";

// Wrap graphlib's topsort in a mock that delegates to the real implementation
// by default (so every other test uses genuine topological sorting), leaving
// it overridable for the one test that forces a non-cycle failure.
vi.mock("@dagrejs/graphlib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dagrejs/graphlib")>();
  return { ...actual, alg: { ...actual.alg, topsort: vi.fn(actual.alg.topsort) } };
});

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

  it("re-throws a non-cycle error from graphlib unchanged", () => {
    // graphlib's topsort only throws CycleException in practice; the catch
    // re-raises anything else untouched. Force a non-cycle failure to prove it.
    vi.mocked(alg.topsort).mockImplementationOnce(() => {
      throw new Error("non-cycle graphlib failure");
    });
    const def: GraphDef<Ctx> = { nodes: [node("a", [], () => 0)] };
    expect(() => topoSort(def as GraphDef<unknown>)).toThrow("non-cycle graphlib failure");
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

  it("is insertion-order independent for Map and Set, but content-sensitive", () => {
    expect(hashValue(new Map<string, number>([["a", 1], ["b", 2]]))).toBe(
      hashValue(new Map<string, number>([["b", 2], ["a", 1]])),
    );
    expect(hashValue(new Map([["a", 1]]))).not.toBe(hashValue(new Map([["a", 2]])));
    expect(hashValue(new Set(["x", "y"]))).toBe(hashValue(new Set(["y", "x"])));
    expect(hashValue(new Set(["x"]))).not.toBe(hashValue(new Set(["z"])));
  });
});

describe("valuesEqual (early-cutoff predicate)", () => {
  it("deep-equal structures compare equal across fresh allocations", () => {
    expect(
      valuesEqual(
        { rows: [{ id: "a", ts: 5n, n: 1 }], meta: { tz: "UTC" } },
        { rows: [{ id: "a", ts: 5n, n: 1 }], meta: { tz: "UTC" } },
      ),
    ).toBe(true);
  });

  it("any leaf difference breaks equality (value, key, length, bigint)", () => {
    expect(valuesEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(valuesEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(valuesEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(valuesEqual([1, 2], [2, 1])).toBe(false);
    expect(valuesEqual(1n, 2n)).toBe(false);
    expect(valuesEqual(1n, 1)).toBe(false);
    expect(valuesEqual("1", 1)).toBe(false);
    expect(valuesEqual(null, {})).toBe(false);
    expect(valuesEqual([], {})).toBe(false);
  });

  it("treats undefined-valued keys as absent (JSON semantics), both directions", () => {
    expect(valuesEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(valuesEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(valuesEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(valuesEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it("NaN equals NaN; 0 equals -0 (SameValueZero)", () => {
    expect(valuesEqual(Number.NaN, Number.NaN)).toBe(true);
    expect(valuesEqual({ x: Number.NaN }, { x: Number.NaN })).toBe(true);
    expect(valuesEqual(0, -0)).toBe(true);
    expect(valuesEqual(Number.NaN, 0)).toBe(false);
  });

  it("compares Date by time, Map by entries, Set by membership", () => {
    expect(valuesEqual(new Date(1000), new Date(1000))).toBe(true);
    expect(valuesEqual(new Date(1000), new Date(2000))).toBe(false);
    expect(valuesEqual(new Map([["k", [1n]]]), new Map([["k", [1n]]]))).toBe(true);
    expect(valuesEqual(new Map([["k", 1]]), new Map([["k", 2]]))).toBe(false);
    expect(valuesEqual(new Map([["k", 1]]), new Map())).toBe(false);
    expect(valuesEqual(new Set(["x", "y"]), new Set(["y", "x"]))).toBe(true);
    expect(valuesEqual(new Set(["x"]), new Set(["z"]))).toBe(false);
    expect(valuesEqual(new Map(), new Set())).toBe(false);
  });

  it("never conflates types across branches (guards, both argument orders)", () => {
    // Date vs non-Date: a mutated guard would call getTime() on the plain
    // object and throw instead of returning false.
    expect(valuesEqual(new Date(0), { x: 1 })).toBe(false);
    expect(valuesEqual({ x: 1 }, new Date(0))).toBe(false);
    // Map/Set vs plain object of the same shape.
    expect(valuesEqual(new Map([["k", 1]]), { k: 1 })).toBe(false);
    expect(valuesEqual({ k: 1 }, new Map([["k", 1]]))).toBe(false);
    expect(valuesEqual(new Set(["x"]), { x: true })).toBe(false);
    expect(valuesEqual({ x: true }, new Set(["x"]))).toBe(false);
    // Array vs Set with the same members.
    expect(valuesEqual(["x"], new Set(["x"]))).toBe(false);
    expect(valuesEqual(new Set(["x"]), ["x"])).toBe(false);
    // Primitive vs object, both orders; null on either side.
    expect(valuesEqual(5, {})).toBe(false);
    expect(valuesEqual({}, 5)).toBe(false);
    expect(valuesEqual({}, null)).toBe(false);
    expect(valuesEqual(null, undefined)).toBe(false);
    // Same-type sanity at the far end of the guards.
    expect(valuesEqual({}, {})).toBe(true);
    expect(valuesEqual(new Map(), new Map())).toBe(true);
    expect(valuesEqual(new Set(), new Set())).toBe(true);
  });
});

describe("ExecutionLedger records per status (engine half)", () => {
  it("pins rowsOut/expectations across recomputed, cached, error and skipped records", async () => {
    const expectationStub = (output: unknown) => [
      {
        id: "probe",
        kind: "custom" as const,
        ok: Array.isArray(output),
        expected: "array",
        actual: typeof output,
        message: "probe expectation",
        severity: "warn" as const,
      },
    ];
    let shouldFail = false;
    const def: GraphDef<Ctx> = {
      nodes: [
        node("a", [], () => [1, 2, 3], { expectations: expectationStub }),
        node("b", ["a"], () => {
          if (shouldFail) throw new Error("boom");
          return [4];
        }),
        node("c", ["b"], () => [5]),
      ],
    };
    const engine = new GraphEngine(def);

    const first = await engine.run(CTX, KEYS);
    const firstA = first.report.executions.find((record) => record.unit === "a")!;
    expect(firstA.status).toBe("recomputed");
    expect(firstA.rowsOut).toBe(3);
    expect(firstA.expectations).toEqual(expectationStub([1, 2, 3]));

    // Cached rerun: expectations are still evaluated (full ledger every run).
    const second = await engine.run(CTX, KEYS);
    const secondA = second.report.executions.find((record) => record.unit === "a")!;
    expect(secondA.status).toBe("cached");
    expect(secondA.rowsOut).toBe(3);
    expect(secondA.expectations).toEqual(expectationStub([1, 2, 3]));

    shouldFail = true;
    const third = await engine.run(CTX, { ...KEYS, inputHash: "input-err" });
    const thirdB = third.report.executions.find((record) => record.unit === "b")!;
    const thirdC = third.report.executions.find((record) => record.unit === "c")!;
    expect(thirdB.status).toBe("error");
    expect(thirdB.rowsOut).toBeNull();
    expect(thirdB.expectations).toEqual([]);
    expect(thirdC.status).toBe("skipped");
    expect(thirdC.rowsIn).toBeNull();
    expect(thirdC.rowsOut).toBeNull();
    expect(thirdC.expectations).toEqual([]);
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

  it("earlyCutoff keeps downstream cached when a rerun yields a deep-equal output", async () => {
    const runs: Record<string, number> = {};
    const count = (id: string) => { runs[id] = (runs[id] ?? 0) + 1; };
    const def: GraphDef<Ctx> = {
      nodes: [
        // Fresh object per run: the cutoff must hold on VALUE equality, not
        // reference identity.
        node("a", [], () => { count("a"); return { rows: [1n, 2n] }; }, {
          knobs: [{ optionKey: "knobA", edge: "tunes" }],
          earlyCutoff: true,
        }),
        node("b", ["a"], () => { count("b"); return "B"; }),
      ],
    };
    const engine = new GraphEngine(def);
    await engine.run(CTX, { ...KEYS, options: { knobA: 1 } });
    // knobA changes → a reruns, but produces a deep-equal output → b stays cached.
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

  it("invalidateAll clears the cache so the next run recomputes everything", async () => {
    const runs: Record<string, number> = {};
    const engine = new GraphEngine(diamond(runs));
    await engine.run(CTX, KEYS);
    const cached = await engine.run(CTX, KEYS);
    expect(cached.report.statuses).toEqual({ a: "cached", b: "cached", c: "cached", d: "cached" });

    engine.invalidateAll();
    const afterInvalidate = await engine.run(CTX, KEYS);
    expect(afterInvalidate.report.statuses).toEqual({
      a: "recomputed", b: "recomputed", c: "recomputed", d: "recomputed",
    });
    // Every node body ran twice total: once initially, once after invalidation.
    expect(runs).toEqual({ a: 2, b: 2, c: 2, d: 2 });
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

describe("valuesEqual cycle safety", () => {
  it("returns false (not a stack overflow) for cyclic values", () => {
    type Cyclic = { name: string; self?: Cyclic };
    const a: Cyclic = { name: "a" };
    a.self = a;
    const b: Cyclic = { name: "a" };
    b.self = b;
    expect(valuesEqual(a, b)).toBe(false);
    expect(valuesEqual(a, { name: "a" })).toBe(false);
  });

  it("still compares acyclic shared sub-objects as equal", () => {
    const shared = [1n, 2n];
    expect(valuesEqual({ x: shared, y: shared }, { x: [1n, 2n], y: [1n, 2n] })).toBe(true);
  });
});

describe("mutation coverage — engine", () => {
  // id 180 (L134 StringLiteral): the duplicate-id message must name the id.
  it("topoSort names the duplicate node id in its error (id 180)", () => {
    const def: GraphDef<Ctx> = {
      nodes: [node("dup", [], () => 0), node("dup", [], () => 1)],
    };
    expect(() => topoSort(def as GraphDef<unknown>)).toThrow(/duplicate node id "dup"/);
  });

  // id 195 (L151 ArrayDeclaration → []) + id 197 (L152 StringLiteral → ""):
  // the cycle error must both carry the "cycle involving" phrasing and list
  // the actual nodes on the cycle.
  it("cycle error names the nodes on the cycle (ids 195, 197)", () => {
    const def: GraphDef<Ctx> = {
      nodes: [node("a", ["b"], () => 0), node("b", ["a"], () => 0)],
    };
    let message = "";
    try {
      topoSort(def as GraphDef<unknown>);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("pipelineGraph: cycle involving");
    const inner = message.match(/involving \[([^\]]*)\]/)?.[1] ?? "";
    expect(inner).toContain("a");
    expect(inner).toContain("b");
    // The join separator ", " must be literal: blanking it (→ "") would
    // concatenate the ids as "ab"/"ba", still containing "a" and "b" but no
    // separator. Pinning the exact two-id join kills the string mutant.
    expect(inner).toMatch(/^(a, b|b, a)$/);
  });

  // id 4 (L29 EqualityOperator `<`→`<=` in fnv1a): the extra loop iteration
  // does one more Math.imul, changing every digest. Pin exact outputs.
  it("hashValue returns the exact FNV-1a digest (id 4)", () => {
    expect(hashValue("chronicle")).toBe("7a8e4a0-dec9d456");
    expect(hashValue({ a: 1, b: [2, 3] })).toBe("2c571be4-f27f6fc2");
  });

  // id 229 (L227 LogicalOperator `??`→`&&`): expectations must be evaluated
  // against the real resolved inputs, not an empty bag.
  it("node expectations receive the resolved inputs, not an empty bag (id 229)", async () => {
    const def: GraphDef<Ctx> = {
      nodes: [
        node("a", [], () => [1, 2, 3]),
        node("b", ["a"], () => "B", {
          expectations: (_output, inputs) => [
            {
              id: "rows_in_seen",
              kind: "custom" as const,
              ok: Array.isArray(inputs.a),
              expected: "input a is an array",
              actual: `a=${JSON.stringify(inputs.a)}`,
              message: "input a missing",
              severity: "warn" as const,
            },
          ],
        }),
      ],
    };
    const engine = new GraphEngine(def);
    const result = await engine.run(CTX, KEYS);
    const b = result.report.executions.find((record) => record.unit === "b")!;
    expect(b.expectations[0].ok).toBe(true);
    expect(b.expectations[0].actual).toBe("a=[1,2,3]");
  });
});

describe("mutation coverage — valuesEqual guards", () => {
  // ids 17, 20 (L57 ConditionalExpression → true): forcing the number guard
  // true would return `NaN(a) && NaN(b)` (false) for equal non-number objects.
  it("equal non-number objects compare equal — number guard not forced true (ids 17, 20)", () => {
    expect(valuesEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(valuesEqual({ x: "s" }, { x: "s" })).toBe(true);
  });

  // id 76 (L73 LogicalOperator `||`→`&&`): a Date vs an EMPTY object — with
  // `&&` the Date branch is skipped and both fall through to the (empty) key
  // comparison, wrongly equal.
  it("a Date is never equal to a plain object, either order (id 76)", () => {
    expect(valuesEqual(new Date(0), {})).toBe(false);
    expect(valuesEqual({}, new Date(0))).toBe(false);
  });

  // id 87 (L76 LogicalOperator `||`→`&&`): a Map vs an EMPTY object.
  it("a Map is never equal to a plain object, either order (id 87)", () => {
    expect(valuesEqual(new Map(), {})).toBe(false);
    expect(valuesEqual({}, new Map())).toBe(false);
  });

  // id 109 (L83 LogicalOperator `||`→`&&`): a Set vs an EMPTY object.
  it("a Set is never equal to a plain object, either order (id 109)", () => {
    expect(valuesEqual(new Set(), {})).toBe(false);
    expect(valuesEqual({}, new Set())).toBe(false);
  });

  // id 96 (L77 ConditionalExpression → false): the Map size guard. Using a
  // strict superset (b contains all of a's keys) so the membership loop can
  // NOT catch the mismatch — only the size check can.
  it("Maps of different sizes are unequal even when one is a subset (id 96)", () => {
    expect(
      valuesEqual(new Map([["k", 1]]), new Map([["k", 1], ["j", 2]])),
    ).toBe(false);
    expect(
      valuesEqual(new Map([["k", 1], ["j", 2]]), new Map([["k", 1]])),
    ).toBe(false);
  });

  // ids 113, 114, 115, 118 (L84 Set size/type guards). Superset kills the
  // conditional/second-`||` flips; empty-Set vs `{size:0}` kills the
  // first-`||`→`&&` flip (the size term alone can't rescue it).
  it("Set size + type guards hold at every boundary (ids 113, 114, 115, 118)", () => {
    expect(valuesEqual(new Set(["x"]), new Set(["x", "y"]))).toBe(false);
    expect(valuesEqual(new Set(["x", "y"]), new Set(["x"]))).toBe(false);
    expect(valuesEqual(new Set(), { size: 0 })).toBe(false);
    expect(valuesEqual({ size: 0 }, new Set())).toBe(false);
  });

  // ids 57, 58 (L67 array length + type guards). Superset arrays (subset
  // prefix equal) isolate the length term; type-mismatch both orders isolates
  // the Array.isArray terms.
  it("array length and type guards hold at every boundary (ids 57, 58)", () => {
    expect(valuesEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(valuesEqual([1, 2, 3], [1, 2])).toBe(false);
    expect(valuesEqual([], {})).toBe(false);
    expect(valuesEqual({}, [])).toBe(false);
    // Array-vs-array-like of EQUAL length + matching indices: the length term
    // agrees, so only the `!Array.isArray(a) || !Array.isArray(b)` guard can
    // reject it. Dropping that guard (→ false) or flipping `||`→`&&` would walk
    // the indices and wrongly report equality.
    expect(valuesEqual([1, 2], { 0: 1, 1: 2, length: 2 })).toBe(false);
    expect(valuesEqual({ 0: 1, 1: 2, length: 2 }, [1, 2])).toBe(false);
    expect(valuesEqual([1, 2], [1, 2])).toBe(true);
  });
});
