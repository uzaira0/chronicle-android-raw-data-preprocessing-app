/** UI-only graph shape projected from Rust's typed stage view. */
export type Section = "preprocess" | "clean" | "analyze" | "output";
export type NodeStatus = "cached" | "recomputed" | "error" | "skipped" | "bypassed";

export type ViewGraphNode = {
  id: string;
  label: string;
  description?: string;
  section: Section;
  inputs: string[];
};

export type ViewGraph = { nodes: ViewGraphNode[] };

type Adjacency = {
  downstream: Map<string, string[]>;
  upstream: Map<string, string[]>;
  ids: string[];
};

function adjacency(graph: ViewGraph): Adjacency {
  const downstream = new Map<string, string[]>();
  const upstream = new Map<string, string[]>();
  for (const node of graph.nodes) {
    upstream.set(node.id, [...node.inputs]);
    if (!downstream.has(node.id)) downstream.set(node.id, []);
    for (const input of node.inputs) {
      const targets = downstream.get(input) ?? [];
      targets.push(node.id);
      downstream.set(input, targets);
    }
  }
  return { downstream, upstream, ids: graph.nodes.map((node) => node.id) };
}

function reach(start: string[], edges: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of edges.get(id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

export function affectedBy(graph: ViewGraph, source: string): string[] {
  const links = adjacency(graph);
  const affected = reach([source], links.downstream);
  return links.ids.filter((id) => affected.has(id));
}

export function builtFrom(graph: ViewGraph, nodeId: string): string[] {
  const links = adjacency(graph);
  const upstream = reach([nodeId], links.upstream);
  return links.ids.filter((id) => upstream.has(id));
}

export function sharedUpstream(graph: ViewGraph, left: string, right: string): string[] {
  const links = adjacency(graph);
  const leftUpstream = reach([left], links.upstream);
  const rightUpstream = reach([right], links.upstream);
  return links.ids.filter((id) => leftUpstream.has(id) && rightUpstream.has(id));
}

export function mustPassThrough(
  graph: ViewGraph,
  source: string,
  target: string,
): string[] {
  const links = adjacency(graph);
  if (!links.upstream.has(source) || !links.upstream.has(target)) return [];
  if (!reach([source], links.downstream).has(target)) return [];
  const candidates = links.ids.filter(
    (id) => id !== source && id !== target && reach([source], links.downstream).has(id),
  );
  return candidates.filter((candidate) => {
    const without = new Map<string, string[]>();
    for (const [from, targets] of links.downstream) {
      if (from === candidate) continue;
      without.set(from, targets.filter((next) => next !== candidate));
    }
    return !reach([source], without).has(target);
  });
}

export function joinPoints(graph: ViewGraph): string[] {
  const links = adjacency(graph);
  return graph.nodes
    .filter((node) => {
      if (node.inputs.length < 2) return false;
      for (let left = 0; left < node.inputs.length; left += 1) {
        for (let right = left + 1; right < node.inputs.length; right += 1) {
          const leftUpstream = reach([node.inputs[left]], links.upstream);
          const rightUpstream = reach([node.inputs[right]], links.upstream);
          if (
            !leftUpstream.has(node.inputs[right]) &&
            !rightUpstream.has(node.inputs[left])
          ) {
            return true;
          }
        }
      }
      return false;
    })
    .map((node) => node.id);
}

/** Hide bypassed nodes while preserving visible paths for display. */
export function spliceOut(graph: ViewGraph, hidden: ReadonlySet<string>): ViewGraph {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const resolved = new Map<string, string[]>();
  const resolve = (id: string): string[] => {
    if (!hidden.has(id)) return [id];
    const cached = resolved.get(id);
    if (cached) return cached;
    resolved.set(id, []);
    const ancestors = [...new Set((byId.get(id)?.inputs ?? []).flatMap(resolve))];
    resolved.set(id, ancestors);
    return ancestors;
  };
  return {
    nodes: graph.nodes
      .filter((node) => !hidden.has(node.id))
      .map((node) => ({
        ...node,
        inputs: [...new Set(node.inputs.flatMap(resolve))],
      })),
  };
}

export function sentenceFor(
  query: "affectedBy" | "sharedUpstream" | "mustPassThrough" | "chain",
  args: Record<string, string | number>,
): string {
  switch (query) {
    case "affectedBy":
      return `Changing ${args.source} re-runs ${args.count} step${args.count === 1 ? "" : "s"} and changes ${args.outputs ?? "the downstream results"}.`;
    case "chain":
      return `${args.from} feeds ${args.to} ${args.how} — one chain: the second step is built from the first, so they can never disagree independently.`;
    case "sharedUpstream":
      return `${args.a} and ${args.b} both depend on ${args.shared} — they move together, so they are not independent checks.`;
    case "mustPassThrough":
      return `Everything ${args.source} does to ${args.target} goes through ${args.through}.`;
  }
}
