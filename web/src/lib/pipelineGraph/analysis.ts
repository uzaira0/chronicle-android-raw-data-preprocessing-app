import type { GraphDef } from "@/lib/pipelineGraph/graphTypes";

/**
 * Derived path queries over the declared graph.
 *
 * Deliberately taxonomy-free: these are structural facts about the
 * pipeline rendered as highlights + plain-English sentences, never
 * causal or graph-theory jargon (docs/pipeline-graph/06).
 *
 * A `source` may be a node id OR a bound option key — option keys are
 * resolved to the node(s) they gate/tune.
 */

interface Adjacency {
  downstream: Map<string, string[]>; // node -> consumers
  upstream: Map<string, string[]>; // node -> inputs
  optionTargets: Map<string, string[]>; // optionKey -> bound nodes
  ids: string[];
}

function adjacency(def: GraphDef<unknown>): Adjacency {
  const downstream = new Map<string, string[]>();
  const upstream = new Map<string, string[]>();
  const optionTargets = new Map<string, string[]>();
  for (const node of def.nodes) {
    upstream.set(node.id, [...node.inputs]);
    if (!downstream.has(node.id)) downstream.set(node.id, []);
    for (const input of node.inputs) {
      const list = downstream.get(input) ?? [];
      list.push(node.id);
      downstream.set(input, list);
    }
    for (const knob of node.knobs) {
      const list = optionTargets.get(knob.optionKey) ?? [];
      list.push(node.id);
      optionTargets.set(knob.optionKey, list);
    }
  }
  return { downstream, upstream, optionTargets, ids: def.nodes.map((node) => node.id) };
}

function resolveSources(adj: Adjacency, source: string): string[] {
  if (adj.upstream.has(source)) return [source];
  return adj.optionTargets.get(source) ?? [];
}

function reach(start: string[], edges: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of edges.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/**
 * Downstream cone: every node whose result changes when `source`
 * (a node id or option key) changes. Option keys include their bound
 * node(s); node ids exclude the node itself.
 */
export function affectedBy(def: GraphDef<unknown>, source: string): string[] {
  const adj = adjacency(def);
  const roots = resolveSources(adj, source);
  const cone = reach(roots, adj.downstream);
  // An option's bound nodes are themselves affected by the option.
  if (!adj.upstream.has(source)) for (const root of roots) cone.add(root);
  return adj.ids.filter((id) => cone.has(id));
}

/** Upstream cone: node ids this node is built from, plus bound option keys along that cone. */
export function builtFrom(def: GraphDef<unknown>, nodeId: string): string[] {
  const adj = adjacency(def);
  const cone = reach([nodeId], adj.upstream);
  const nodes = adj.ids.filter((id) => cone.has(id));
  const options: string[] = [];
  for (const node of def.nodes) {
    if ((cone.has(node.id) || node.id === nodeId) && node.knobs.length > 0) {
      options.push(...node.knobs.map((knob) => knob.optionKey));
    }
  }
  return [...nodes, ...options];
}

/** Common ancestors of two nodes — the reason their outputs are not independent. */
export function sharedUpstream(def: GraphDef<unknown>, a: string, b: string): string[] {
  const adj = adjacency(def);
  const upA = reach([a], adj.upstream);
  const upB = reach([b], adj.upstream);
  return adj.ids.filter((id) => upA.has(id) && upB.has(id));
}

/**
 * Nodes lying on EVERY path from `source` (node id or option key) to
 * `target`. Excludes source-resolved roots and the target itself.
 */
export function mustPassThrough(def: GraphDef<unknown>, source: string, target: string): string[] {
  const adj = adjacency(def);
  const roots = resolveSources(adj, source);
  if (roots.length === 0) return [];
  const isOptionSource = !adj.upstream.has(source);
  const baseReach = reach(roots, adj.downstream);
  const reachesTarget = roots.includes(target) || baseReach.has(target);
  if (!reachesTarget) return [];
  // For an option source the bound node(s) themselves are candidates —
  // the option only acts on the target THROUGH them. For a node source,
  // the node itself is excluded (it is the origin, not a waypoint).
  const candidates = adj.ids.filter(
    (id) =>
      id !== target &&
      (isOptionSource ? roots.includes(id) || baseReach.has(id) : !roots.includes(id) && baseReach.has(id)),
  );
  const result: string[] = [];
  for (const candidate of candidates) {
    // Remove the candidate and test whether target is still reachable.
    const filteredEdges = new Map<string, string[]>();
    for (const [from, tos] of adj.downstream) {
      if (from === candidate) continue;
      filteredEdges.set(from, tos.filter((to) => to !== candidate));
    }
    const remainingRoots = isOptionSource ? roots.filter((id) => id !== candidate) : roots;
    const without = reach(remainingRoots, filteredEdges);
    const stillReaches = remainingRoots.includes(target) || without.has(target);
    if (!stillReaches) result.push(candidate);
  }
  return result;
}

/** Nodes where ≥2 upstream chains with no path between them merge. */
export function joinPoints(def: GraphDef<unknown>): string[] {
  const adj = adjacency(def);
  const result: string[] = [];
  for (const node of def.nodes) {
    if (node.inputs.length < 2) continue;
    // Disjoint = some pair of inputs where neither is upstream of the other.
    let disjointPair = false;
    for (let i = 0; i < node.inputs.length && !disjointPair; i += 1) {
      for (let j = i + 1; j < node.inputs.length && !disjointPair; j += 1) {
        const upI = reach([node.inputs[i]], adj.upstream);
        const upJ = reach([node.inputs[j]], adj.upstream);
        if (!upI.has(node.inputs[j]) && !upJ.has(node.inputs[i])) disjointPair = true;
      }
    }
    if (disjointPair) result.push(node.id);
  }
  return result;
}

/**
 * The graph with `hidden` nodes spliced out: each consumer of a hidden
 * node is rewired to that node's nearest visible ancestors (transitively,
 * so chains of hidden nodes collapse). Sound because hidden nodes are
 * gated-off pass-throughs — data flows through them unchanged, so the
 * spliced edge is the path the data actually takes.
 */
export function spliceOut<Ctx>(def: GraphDef<Ctx>, hidden: ReadonlySet<string>): GraphDef<Ctx> {
  const byId = new Map(def.nodes.map((node) => [node.id, node]));
  const resolved = new Map<string, string[]>();
  const resolve = (id: string): string[] => {
    if (!hidden.has(id)) return [id];
    const memo = resolved.get(id);
    if (memo) return memo;
    resolved.set(id, []); // cycle guard (a DAG never hits it, but stay total)
    const ancestors = [...new Set((byId.get(id)?.inputs ?? []).flatMap(resolve))];
    resolved.set(id, ancestors);
    return ancestors;
  };
  return {
    nodes: def.nodes
      .filter((node) => !hidden.has(node.id))
      .map((node) => ({
        ...node,
        inputs: [...new Set(node.inputs.flatMap(resolve))],
      })),
  };
}

/** Plain-English sentence for a query result. No jargon, no taxonomy. */
export function sentenceFor(
  query: "affectedBy" | "sharedUpstream" | "mustPassThrough" | "joinPoint" | "chain",
  args: Record<string, string | number>,
): string {
  switch (query) {
    case "affectedBy":
      return `Changing ${args.source} re-runs ${args.count} step${args.count === 1 ? "" : "s"} and changes ${args.outputs ?? "the downstream results"}.`;
    case "chain":
      // `how` is one of: "directly", "through <steps>", "along several parallel paths".
      return `${args.from} feeds ${args.to} ${args.how} — one chain: the second step is built from the first, so they can never disagree independently.`;
    case "sharedUpstream":
      return `${args.a} and ${args.b} both depend on ${args.shared} — they move together, so they are not independent checks.`;
    case "mustPassThrough":
      return `Everything ${args.source} does to ${args.target} goes through ${args.through}.`;
    case "joinPoint":
      return `Two separate chains combine at ${args.node} — results after this point link everything that feeds it.`;
  }
}
