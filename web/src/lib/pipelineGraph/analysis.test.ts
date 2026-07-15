import { describe, expect, it } from "vitest";
import {
  affectedBy,
  builtFrom,
  joinPoints,
  mustPassThrough,
  sentenceFor,
  sharedUpstream,
  spliceOut,
} from "@/lib/pipelineGraph/analysis";
import type { GraphDef, NodeDef } from "@/lib/pipelineGraph/graphTypes";

function node(id: string, inputs: string[], knobs: string[] = []): NodeDef<unknown> {
  return {
    id,
    label: id,
    section: "preprocess",
    inputs,
    knobs: knobs.map((optionKey) => ({ optionKey, edge: "tunes" as const })),
    run: () => null,
  };
}

// Diamond: a → b → d, a → c → d; option k tunes b.
const DIAMOND: GraphDef<unknown> = {
  nodes: [node("a", []), node("b", ["a"], ["k"]), node("c", ["a"]), node("d", ["b", "c"])],
};

describe("affectedBy", () => {
  it("resolves an option key to its bound node plus the downstream cone", () => {
    expect(affectedBy(DIAMOND, "k")).toEqual(["b", "d"]);
  });

  it("for a node id, returns strictly downstream nodes", () => {
    expect(affectedBy(DIAMOND, "a")).toEqual(["b", "c", "d"]);
    expect(affectedBy(DIAMOND, "d")).toEqual([]);
  });
});

describe("builtFrom", () => {
  it("returns the upstream cone plus bound option keys along it", () => {
    expect(builtFrom(DIAMOND, "d")).toEqual(["a", "b", "c", "k"]);
  });
});

describe("sharedUpstream", () => {
  it("finds the common ancestor of two branches", () => {
    expect(sharedUpstream(DIAMOND, "b", "c")).toEqual(["a"]);
  });

  it("is empty for genuinely independent nodes", () => {
    const def: GraphDef<unknown> = { nodes: [node("x", []), node("y", [])] };
    expect(sharedUpstream(def, "x", "y")).toEqual([]);
  });
});

describe("mustPassThrough", () => {
  it("is empty when two disjoint routes exist", () => {
    expect(mustPassThrough(DIAMOND, "a", "d")).toEqual([]);
  });

  it("finds the single funnel for an option that reaches the target one way", () => {
    expect(mustPassThrough(DIAMOND, "k", "d")).toEqual(["b"]);
  });

  it("is empty when the target is unreachable", () => {
    expect(mustPassThrough(DIAMOND, "k", "c")).toEqual([]);
  });
});

describe("joinPoints", () => {
  it("flags nodes where disjoint chains merge", () => {
    expect(joinPoints(DIAMOND)).toEqual(["d"]);
  });

  it("does not flag a node whose two inputs lie on one chain", () => {
    // a → b, and c consumes both a and b — but b is downstream of a, so no disjoint pair.
    const def: GraphDef<unknown> = {
      nodes: [node("a", []), node("b", ["a"]), node("c", ["a", "b"])],
    };
    expect(joinPoints(def)).toEqual([]);
  });
});

describe("spliceOut", () => {
  const inputsOf = (def: GraphDef<unknown>, id: string) =>
    def.nodes.find((n) => n.id === id)?.inputs;

  it("rewires a consumer past one hidden pass-through", () => {
    const def: GraphDef<unknown> = {
      nodes: [node("a", []), node("b", ["a"]), node("c", ["b"])],
    };
    const spliced = spliceOut(def, new Set(["b"]));
    expect(spliced.nodes.map((n) => n.id)).toEqual(["a", "c"]);
    expect(inputsOf(spliced, "c")).toEqual(["a"]);
  });

  it("collapses a chain of hidden nodes to the nearest visible ancestor", () => {
    const def: GraphDef<unknown> = {
      nodes: [node("a", []), node("b", ["a"]), node("c", ["b"]), node("d", ["c"])],
    };
    const spliced = spliceOut(def, new Set(["b", "c"]));
    expect(inputsOf(spliced, "d")).toEqual(["a"]);
  });

  it("keeps a diamond intact and dedupes rewired inputs", () => {
    // a → {b, c} → d with b hidden: d gets a (via b) + c, no duplicate a.
    const def: GraphDef<unknown> = {
      nodes: [node("a", []), node("b", ["a"]), node("c", ["a"]), node("d", ["b", "c"])],
    };
    const spliced = spliceOut(def, new Set(["b"]));
    expect(inputsOf(spliced, "d")).toEqual(["a", "c"]);
    expect(joinPoints(spliced)).toEqual([]);
  });

  it("a hidden source node simply drops its edge", () => {
    const def: GraphDef<unknown> = {
      nodes: [node("a", []), node("b", []), node("c", ["a", "b"])],
    };
    const spliced = spliceOut(def, new Set(["b"]));
    expect(inputsOf(spliced, "c")).toEqual(["a"]);
  });

  it("is the identity when nothing is hidden", () => {
    const spliced = spliceOut(DIAMOND, new Set());
    expect(spliced.nodes.map((n) => n.id)).toEqual(DIAMOND.nodes.map((n) => n.id));
    expect(spliced.nodes.map((n) => n.inputs)).toEqual(DIAMOND.nodes.map((n) => n.inputs));
  });
});

describe("sentenceFor", () => {
  it("emits plain-English sentences with no taxonomy words", () => {
    const sentences = [
      sentenceFor("affectedBy", { source: "the app policy", count: 3, outputs: "2 outputs" }),
      sentenceFor("sharedUpstream", { a: "Compliance", b: "Effective usage", shared: "episode reconstruction" }),
      sentenceFor("mustPassThrough", { source: "this setting", target: "the compliance report", through: "person attribution" }),
      sentenceFor("joinPoint", { node: "effective usage" }),
      sentenceFor("chain", { from: "App policy", to: "Compliance scoring", how: "along several parallel paths" }),
    ];
    const banned = /mediat|confound|collid|moderat|dominat|fan[s_-]?out|merges_at|collider|dag\b/i;
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(banned);
      expect(sentence.length).toBeGreaterThan(20);
    }
  });
});
