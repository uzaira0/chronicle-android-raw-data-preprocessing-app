import { Graph, alg } from "@dagrejs/graphlib";

import {
  deriveRowCount,
  deriveRowsInPrimary,
  type UnitExecutionRecord,
} from "@/lib/pipelineGraph/executionRecords";
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

/**
 * Deterministic deep equality for node outputs — the early-cutoff test.
 * Mirrors the equivalence classes of the serialized form hashValue used
 * to produce (undefined-valued object keys are ignored, like JSON), but
 * walks both values directly: no serialization, no allocation, and an
 * exit at the first difference. NaN equals NaN (SameValueZero) — being
 * stricter or looser here only trades backdating opportunities, never
 * correctness, EXCEPT looseness: two unequal values must never compare
 * equal, or downstream would serve stale caches.
 *
 * Cyclic values compare unequal instead of overflowing the stack: a cycle
 * on the current descent path returns false (stricter-only, so still safe),
 * while acyclic sharing of the same sub-object is unaffected.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  return valuesEqualInner(a, b, new WeakSet());
}

function valuesEqualInner(a: unknown, b: unknown, path: WeakSet<object>): boolean {
  if (a === b) return true;
  // SameValueZero: NaN is equal to itself.
  if (typeof a === "number" && typeof b === "number") {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (path.has(a)) return false;
  path.add(a);
  try {
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for (let index = 0; index < a.length; index += 1) {
        if (!valuesEqualInner(a[index], b[index], path)) return false;
      }
      return true;
    }
    if (a instanceof Date || b instanceof Date) {
      return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    }
    if (a instanceof Map || b instanceof Map) {
      if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false;
      for (const [key, value] of a) {
        if (!b.has(key) || !valuesEqualInner(value, b.get(key), path)) return false;
      }
      return true;
    }
    if (a instanceof Set || b instanceof Set) {
      if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false;
      for (const value of a) if (!b.has(value)) return false;
      return true;
    }
    const recordA = a as Record<string, unknown>;
    const recordB = b as Record<string, unknown>;
    // Keys with undefined values are treated as absent (JSON semantics).
    for (const key of Object.keys(recordA)) {
      if (recordA[key] === undefined) continue;
      if (!valuesEqualInner(recordA[key], recordB[key], path)) return false;
    }
    for (const key of Object.keys(recordB)) {
      if (recordB[key] !== undefined && recordA[key] === undefined) return false;
    }
    return true;
  } finally {
    path.delete(a);
  }
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

/**
 * Topological execution order via graphlib's `alg.topsort` (the graph library
 * dagre already ships). We keep the two domain validations graphlib does not do
 * — duplicate node ids and feeds-from-unknown-node — and translate its generic
 * CycleException into a message naming the nodes on the cycle. Every edge runs
 * input → consumer, so the result orders each input before every node that
 * reads it; the engine's outputs are order-independent across valid sorts.
 */
export function topoSort(def: GraphDef<unknown>): string[] {
  const byId = new Map<string, NodeDef<unknown>>();
  for (const node of def.nodes) {
    if (byId.has(node.id)) throw new Error(`pipelineGraph: duplicate node id "${node.id}"`);
    byId.set(node.id, node);
  }
  const graph = new Graph({ directed: true });
  for (const node of def.nodes) graph.setNode(node.id);
  for (const node of def.nodes) {
    for (const input of node.inputs) {
      if (!byId.has(input)) {
        throw new Error(`pipelineGraph: node "${node.id}" feeds from unknown node "${input}"`);
      }
      graph.setEdge(input, node.id);
    }
  }
  try {
    return alg.topsort(graph);
  } catch (error) {
    if (error instanceof alg.CycleException) {
      const stuck = [...new Set(alg.findCycles(graph).flat())];
      throw new Error(`pipelineGraph: cycle involving [${stuck.join(", ")}]`);
    }
    throw error;
  }
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
 * A recomputed node gets a fresh stamp — unless it declares `earlyCutoff`
 * and its output is deep-equal to the cached value, in which case it keeps
 * the old stamp (Salsa backdating) and the downstream cone stays cached.
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
    const executions: UnitExecutionRecord[] = [];
    const stamps = new Map<string, string>();
    const failed = new Set<string>();

    // One ledger record per node, whatever its status — the engine half of
    // the ExecutionLedger (steps are recorded by the step runner and joined
    // downstream). Timing is wall-clock and lives apart from the
    // deterministic fields.
    const record = (
      id: string,
      status: NodeStatus,
      startedAt: string,
      startMark: number,
      inputValues: Record<string, unknown> | null,
      value: unknown,
      node: NodeDef<Ctx>,
    ): void => {
      const durationMs = performance.now() - startMark;
      executions.push({
        unit: id,
        status,
        rowsIn: inputValues ? deriveRowsInPrimary(inputValues) : null,
        rowsOut: status === "error" || status === "skipped" ? null : deriveRowCount(value),
        // Expectations are pure over (output, inputs) and warn-only, so they
        // are evaluated on cached values too — every run gets a full ledger.
        expectations:
          status === "error" || status === "skipped" || !node.expectations
            ? []
            : node.expectations(value, inputValues ?? {}),
        steps: [],
        timing: { startedAt, endedAt: new Date().toISOString(), durationMs },
      });
    };

    for (const id of this.order) {
      const node = this.byId.get(id)!;
      const startedAt = new Date().toISOString();
      const startMark = performance.now();

      if (node.inputs.some((input) => failed.has(input))) {
        statuses[id] = "skipped";
        failed.add(id);
        this.cache.delete(id);
        record(id, "skipped", startedAt, startMark, null, null, node);
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

      const inputValues: Record<string, unknown> = {};
      for (const input of node.inputs) inputValues[input] = outputs.get(input);

      const cached = this.cache.get(id);
      if (cached && cached.key === key) {
        const status = bypassed ? "bypassed" : "cached";
        statuses[id] = status;
        outputs.set(id, cached.value);
        stamps.set(id, cached.stamp);
        record(id, status, startedAt, startMark, inputValues, cached.value, node);
        continue;
      }

      try {
        const value = await node.run(ctx, inputValues);
        // Early cutoff: a rerun whose output is deep-equal to the cached
        // value keeps the old stamp downstream even though this node reran.
        let finalStamp: string;
        if (cached !== undefined && node.earlyCutoff === true && valuesEqual(cached.value, value)) {
          finalStamp = cached.stamp;
        } else {
          this.stampCounter += 1;
          finalStamp = `run-${this.stampCounter}`;
        }
        this.cache.set(id, { key, value, stamp: finalStamp });
        const status = bypassed ? "bypassed" : "recomputed";
        statuses[id] = status;
        outputs.set(id, value);
        stamps.set(id, finalStamp);
        record(id, status, startedAt, startMark, inputValues, value, node);
      } catch (error) {
        statuses[id] = "error";
        errors[id] = error instanceof Error ? error.message : String(error);
        failed.add(id);
        this.cache.delete(id);
        record(id, "error", startedAt, startMark, inputValues, null, node);
      }
    }

    return { outputs, report: { statuses, errors, executions } };
  }
}
