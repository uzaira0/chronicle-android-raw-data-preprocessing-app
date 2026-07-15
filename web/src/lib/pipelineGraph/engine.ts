import type {
  GraphDef,
  NodeDef,
  NodeStatus,
  RunKeys,
  RunResult,
} from "@/lib/pipelineGraph/graphTypes";

/**
 * Stable stringify + FNV-1a hash. Handles bigint, Map, Set and plain
 * objects (keys sorted) so option bags and small structures hash
 * deterministically. Not cryptographic — cache keying only.
 */
export function hashValue(value: unknown): string {
  const text = stableStringify(value);
  // Two FNV-1a passes with different offsets → 64 bits of key space.
  return `${fnv1a(text, 0x811c9dc5) .toString(16)}-${fnv1a(text, 0x01000193).toString(16)}`;
}

function fnv1a(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (typeof entry === "bigint") return `bigint:${entry.toString()}`;
    if (entry instanceof Map) {
      return { __map: [...entry.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))) };
    }
    if (entry instanceof Set) {
      return { __set: [...entry.values()].map(String).sort() };
    }
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort()) sorted[key] = record[key];
      return sorted;
    }
    return entry;
  });
}

/** Kahn topological sort. Throws on unknown input references and cycles. */
export function topoSort(def: GraphDef<unknown>): string[] {
  const byId = new Map<string, NodeDef<unknown>>();
  for (const node of def.nodes) {
    if (byId.has(node.id)) throw new Error(`pipelineGraph: duplicate node id "${node.id}"`);
    byId.set(node.id, node);
  }
  const dependents = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const node of def.nodes) {
    inDegree.set(node.id, node.inputs.length);
    for (const input of node.inputs) {
      if (!byId.has(input)) {
        throw new Error(`pipelineGraph: node "${node.id}" feeds from unknown node "${input}"`);
      }
      const list = dependents.get(input) ?? [];
      list.push(node.id);
      dependents.set(input, list);
    }
  }
  const queue = def.nodes.filter((node) => node.inputs.length === 0).map((node) => node.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const remaining = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) queue.push(dependent);
    }
  }
  if (order.length !== def.nodes.length) {
    const stuck = def.nodes.filter((node) => !order.includes(node.id)).map((node) => node.id);
    throw new Error(`pipelineGraph: cycle involving [${stuck.join(", ")}]`);
  }
  return order;
}

interface CacheEntry {
  key: string;
  value: unknown;
  /** Identity stamp of this output — changes iff downstream must rerun. */
  stamp: string;
}

/**
 * Executes a GraphDef with dirty-propagation and per-node memoization.
 *
 * Cache key per node = hash(upstream output stamps, bound option values,
 * support-file hashes, and — for source nodes — the raw input hash).
 * A node whose key is unchanged serves its cached output ("cached").
 * A recomputed node gets a fresh stamp (or its outputHash when declared,
 * enabling early cutoff), which dirties exactly the downstream cone.
 *
 * A node that throws is reported as "error" with its message; every node
 * downstream of it is "skipped". Independent branches keep running.
 */
export class GraphEngine<Ctx> {
  private readonly def: GraphDef<Ctx>;
  private readonly order: string[];
  private readonly byId: Map<string, NodeDef<Ctx>>;
  private cache = new Map<string, CacheEntry>();
  private stampCounter = 0;

  constructor(def: GraphDef<Ctx>) {
    this.def = def;
    this.order = topoSort(def as GraphDef<unknown>);
    this.byId = new Map(def.nodes.map((node) => [node.id, node]));
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  async run(ctx: Ctx, keys: RunKeys): Promise<RunResult> {
    const outputs = new Map<string, unknown>();
    const statuses: Record<string, NodeStatus> = {};
    const errors: Record<string, string> = {};
    const stamps = new Map<string, string>();
    const failed = new Set<string>();

    for (const id of this.order) {
      const node = this.byId.get(id)!;

      if (node.inputs.some((input) => failed.has(input))) {
        statuses[id] = "skipped";
        failed.add(id);
        this.cache.delete(id);
        continue;
      }

      const key = hashValue([
        node.inputs.map((input) => stamps.get(input)),
        node.knobs.map((knob) => [knob.optionKey, keys.options[knob.optionKey]]),
        (node.supportFiles ?? []).map((file) => [file, keys.supportFileHashes[file]]),
        node.inputs.length === 0 ? keys.inputHash : null,
      ]);

      // A gated-off node still executes (downstream needs its pass-through
      // value) but must never claim it "ran" — that would show e.g. a "ran"
      // badge on Compliance scoring with the option off.
      const bypassed = node.bypassedWhen?.(keys.options) === true;

      const cached = this.cache.get(id);
      if (cached && cached.key === key) {
        statuses[id] = bypassed ? "bypassed" : "cached";
        outputs.set(id, cached.value);
        stamps.set(id, cached.stamp);
        continue;
      }

      const inputValues: Record<string, unknown> = {};
      for (const input of node.inputs) inputValues[input] = outputs.get(input);

      try {
        const value = await node.run(ctx, inputValues);
        this.stampCounter += 1;
        const stamp = node.outputHash
          ? node.outputHash(value)
          : `run-${this.stampCounter}`;
        // Early cutoff: identical declared output hash keeps the old stamp
        // downstream even though this node reran.
        const finalStamp = cached && node.outputHash && cached.stamp === stamp ? cached.stamp : stamp;
        this.cache.set(id, { key, value, stamp: finalStamp });
        statuses[id] = bypassed ? "bypassed" : "recomputed";
        outputs.set(id, value);
        stamps.set(id, finalStamp);
      } catch (error) {
        statuses[id] = "error";
        errors[id] = error instanceof Error ? error.message : String(error);
        failed.add(id);
        this.cache.delete(id);
      }
    }

    return { outputs, report: { statuses, errors } };
  }
}
