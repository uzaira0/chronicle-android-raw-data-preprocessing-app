import { describe, expect, it } from "vitest";

import {
  affectedBy,
  builtFrom,
  joinPoints,
  mustPassThrough,
  sharedUpstream,
  spliceOut,
  type ViewGraph,
} from "@/components/GraphPanel/viewGraph";

const graph: ViewGraph = {
  nodes: [
    { id: "a", label: "a", section: "source", inputs: [] },
    { id: "b", label: "b", section: "operation", inputs: ["a"] },
    { id: "c", label: "c", section: "operation", inputs: ["a"] },
    { id: "d", label: "d", section: "artifact", inputs: ["b", "c"] },
  ],
};

describe("Rust-view graph interaction", () => {
  it("answers path questions without owning execution semantics", () => {
    expect(affectedBy(graph, "a")).toEqual(["b", "c", "d"]);
    expect(builtFrom(graph, "d")).toEqual(["a", "b", "c"]);
    expect(sharedUpstream(graph, "b", "c")).toEqual(["a"]);
    expect(mustPassThrough(graph, "a", "d")).toEqual([]);
    expect(joinPoints(graph)).toEqual(["d"]);
  });

  it("splices a hidden display node without changing the Rust source view", () => {
    const hidden = spliceOut(graph, new Set(["b"]));
    expect(hidden.nodes.map((node) => node.id)).toEqual(["a", "c", "d"]);
    expect(hidden.nodes.find((node) => node.id === "d")?.inputs).toEqual(["a", "c"]);
    expect(graph.nodes.map((node) => node.id)).toEqual(["a", "b", "c", "d"]);
  });
});
