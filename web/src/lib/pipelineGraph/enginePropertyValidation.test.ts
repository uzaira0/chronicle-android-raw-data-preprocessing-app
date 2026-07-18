import { beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { GraphEngine, hashValue } from "@/lib/pipelineGraph/engine";
import { buildChronicleGraph } from "@/lib/pipelineGraph/graphDef";
import type { PipelineCtx } from "@/lib/pipelineGraph/graphDef";
import type { GraphDef, NodeDef } from "@/lib/pipelineGraph/graphTypes";
import type { BrowserProcessingOptions } from "@/lib/types";
import {
  ALL_ON,
  VALID_SUPPORT_FILE_KEYS,
  altValue,
  boundOptionKeys,
  def,
  ensureWasm,
  expectedBypassed,
  makeCtx,
  predictRecomputeCone,
} from "@/lib/pipelineGraph/validationHarness";

/**
 * Property-based validation of the GraphEngine + chronicle graph under
 * ARBITRARY MUTATION SEQUENCES — the two gaps the example-based suite
 * (graphValidation.test.ts) leaves open, stated in the field's canonical
 * vocabulary (Acar self-adjusting computation; Build Systems à la Carte;
 * BuildFS):
 *
 *  1. FROM-SCRATCH CONSISTENCY — after any sequence of option flips,
 *     support-file changes and input changes, every node's output equals a
 *     from-scratch build on the final state. (The single-flip dirty-cone
 *     tests are the depth-1 special case.)
 *  2. MINIMALITY / recompute-set SET-EQUALITY — per step, the set of nodes
 *     that actually EXECUTED equals the dirty cone predicted by an
 *     independent reachability walk, in BOTH directions (no stale under-
 *     recompute, no wasted over-recompute), and every node executes ≤ 1×
 *     per run. Execution is observed via body counters, not statuses —
 *     statuses cannot distinguish a bypassed-cached from a bypassed-rerun
 *     node.
 *  3. Engine METAMORPHIC RELATIONS — idempotent re-run, edit-order
 *     commutativity on distinct keys, and edit+inverse value round-trip.
 *  4. EARLY CUTOFF (Salsa "backdating") — on a synthetic graph with a
 *     declared outputHash, a rerun yielding an identical output must keep
 *     the downstream cone cached, under random value sequences.
 *
 * Run counts stay modest because every step executes the real pipeline with
 * the real WASM matcher; override with ENGINE_PBT_RUNS for a deep soak.
 */

const NUM_RUNS = Number(process.env.ENGINE_PBT_RUNS ?? 50);
/** Optional deterministic replay: ENGINE_PBT_SEED=<n> reruns a failing seed. */
const FC_PARAMS = process.env.ENGINE_PBT_SEED
  ? { numRuns: NUM_RUNS, seed: Number(process.env.ENGINE_PBT_SEED) }
  : { numRuns: NUM_RUNS };

// ── Mutation model over (options, supportFileHashes, inputHash) ─────────────

interface EngineState {
  options: BrowserProcessingOptions;
  supportFileHashes: Record<string, string>;
  inputHash: string;
}

type Mutation =
  | { kind: "toggleOption"; key: string }
  | { kind: "toggleUnbound" }
  | { kind: "supportHash"; file: string; value: number }
  | { kind: "inputHash"; value: number };

const OPTION_BASE = ALL_ON as unknown as Record<string, unknown>;

/** Toggle between the ALL_ON base value and its altValue — involutive, so
 * sequences stay within a two-point domain per key and edits are invertible. */
function toggledValue(key: string, current: unknown): unknown {
  const base = OPTION_BASE[key];
  return hashValue(current) === hashValue(base) ? altValue(key, base) : base;
}

function applyMutation(state: EngineState, mutation: Mutation): EngineState {
  switch (mutation.kind) {
    case "toggleOption": {
      const record = { ...(state.options as unknown as Record<string, unknown>) };
      record[mutation.key] = toggledValue(mutation.key, record[mutation.key]);
      return { ...state, options: record as unknown as BrowserProcessingOptions };
    }
    case "toggleUnbound": {
      const record = { ...(state.options as unknown as Record<string, unknown>) };
      record.enablePlotting = !record.enablePlotting;
      return { ...state, options: record as unknown as BrowserProcessingOptions };
    }
    case "supportHash":
      return {
        ...state,
        supportFileHashes: { ...state.supportFileHashes, [mutation.file]: `h${mutation.value}` },
      };
    case "inputHash":
      return { ...state, inputHash: `fixture-${mutation.value}` };
  }
}

/** Independent dirty-seed prediction: which nodes' cache keys change. */
function changedSeeds(prev: EngineState, next: EngineState): Set<string> {
  const seeds = new Set<string>();
  for (const key of boundOptionKeys) {
    const before = (prev.options as unknown as Record<string, unknown>)[key];
    const after = (next.options as unknown as Record<string, unknown>)[key];
    if (hashValue(before) !== hashValue(after)) {
      for (const node of def.nodes) {
        if (node.knobs.some((knob) => knob.optionKey === key)) seeds.add(node.id);
      }
    }
  }
  for (const file of Object.keys({ ...prev.supportFileHashes, ...next.supportFileHashes })) {
    if (prev.supportFileHashes[file] !== next.supportFileHashes[file]) {
      for (const node of def.nodes) {
        if ((node.supportFiles ?? []).includes(file)) seeds.add(node.id);
      }
    }
  }
  if (prev.inputHash !== next.inputHash) {
    for (const node of def.nodes) {
      if (node.inputs.length === 0) seeds.add(node.id);
    }
  }
  return seeds;
}

/** Fresh graph def whose node bodies count executions. */
function instrumentedGraph(counters: Map<string, number>): GraphDef<PipelineCtx> {
  const base = buildChronicleGraph();
  return {
    nodes: base.nodes.map((node) => ({
      ...node,
      run: (ctx: PipelineCtx, inputs: Record<string, unknown>) => {
        counters.set(node.id, (counters.get(node.id) ?? 0) + 1);
        return node.run(ctx, inputs);
      },
    })),
  };
}

function runKeysOf(state: EngineState) {
  return {
    options: state.options as unknown as Record<string, unknown>,
    supportFileHashes: state.supportFileHashes,
    inputHash: state.inputHash,
  };
}

/** hash of every node output — the whole-graph value fingerprint. */
function outputFingerprint(outputs: Map<string, unknown>): Record<string, string> {
  const fingerprint: Record<string, string> = {};
  for (const [id, value] of outputs) fingerprint[id] = hashValue(value);
  return fingerprint;
}

const INITIAL_STATE: EngineState = {
  options: ALL_ON,
  supportFileHashes: {},
  inputHash: "fixture-1",
};

// ── Arbitraries ──────────────────────────────────────────────────────────────

const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...boundOptionKeys).map((key): Mutation => ({ kind: "toggleOption", key })) },
  { weight: 1, arbitrary: fc.constant<Mutation>({ kind: "toggleUnbound" }) },
  {
    weight: 2,
    arbitrary: fc
      .tuple(fc.constantFrom(...VALID_SUPPORT_FILE_KEYS), fc.integer({ min: 1, max: 4 }))
      .map(([file, value]): Mutation => ({ kind: "supportHash", file, value })),
  },
  { weight: 1, arbitrary: fc.integer({ min: 1, max: 4 }).map((value): Mutation => ({ kind: "inputHash", value })) },
);

const sequenceArb = fc.array(mutationArb, { minLength: 1, maxLength: 5 });

beforeAll(async () => {
  await ensureWasm();
}, 30_000);

// ─────────────────────────────────────────────────────────────────────────────
describe("6. Mutation-sequence properties (from-scratch consistency + minimality)", () => {
  it(
    "any mutation sequence: executed set == predicted dirty cone (both directions, ≤1 run each), " +
      "final outputs == from-scratch build, and an idempotent re-run recomputes nothing",
    async () => {
      await fc.assert(
        fc.asyncProperty(sequenceArb, async (mutations) => {
          const counters = new Map<string, number>();
          const engine = new GraphEngine<PipelineCtx>(instrumentedGraph(counters));

          let state = INITIAL_STATE;
          let lastRun = await engine.run(makeCtx(state.options), runKeysOf(state));
          expect(lastRun.report.errors).toEqual({});

          // Nodes whose cache entry the engine WIPED last run (error/skipped):
          // they must execute on the next error-free run regardless of which
          // keys changed, and their fresh stamps dirty their own cones.
          let wiped = new Set<string>();

          for (const mutation of mutations) {
            const prev = state;
            state = applyMutation(state, mutation);
            const seeds = new Set([...changedSeeds(prev, state), ...wiped]);
            // Cutoff makes the cone value-dependent, so predict it from the
            // two runs' outputs (the previous run's output is the cached value
            // this run backdates against).
            const prevOutputs = lastRun.outputs;

            const before = new Map(counters);
            lastRun = await engine.run(makeCtx(state.options), runKeysOf(state));

            if (Object.keys(lastRun.report.errors).length > 0) {
              // A fail-loud state is legal (e.g. selected-filter timezone
              // removing every row) — but it must be DETERMINISTIC: a cold
              // engine at the same state reports the identical errors and the
              // identical error/skipped/bypassed topology. (cached vs
              // recomputed legitimately differs warm-vs-cold — both "ran".)
              const cold = new GraphEngine<PipelineCtx>(buildChronicleGraph());
              const coldRun = await cold.run(makeCtx(state.options), runKeysOf(state));
              expect(coldRun.report.errors).toEqual(lastRun.report.errors);
              const collapse = (statuses: Record<string, string>) =>
                Object.fromEntries(
                  Object.entries(statuses).map(([id, status]) => [
                    id,
                    status === "cached" || status === "recomputed" ? "ran" : status,
                  ]),
                );
              expect(collapse(coldRun.report.statuses)).toEqual(collapse(lastRun.report.statuses));
              wiped = new Set(
                def.nodes
                  .map((node) => node.id)
                  .filter((id) => lastRun.report.statuses[id] === "error" || lastRun.report.statuses[id] === "skipped"),
              );
              continue;
            }

            const predicted =
              seeds.size === 0
                ? new Set<string>()
                : predictRecomputeCone(seeds, prevOutputs, lastRun.outputs);
            for (const node of def.nodes) {
              const delta = (counters.get(node.id) ?? 0) - (before.get(node.id) ?? 0);
              const shouldRun = predicted.has(node.id);
              // Set-equality, both directions: an unpredicted execution is an
              // over-recompute; a missing predicted one is a stale-cache bug.
              expect(delta, `${node.id} after ${JSON.stringify(mutation)}`).toBe(shouldRun ? 1 : 0);
              const expectedStatus = expectedBypassed(node.id, state.options)
                ? "bypassed"
                : shouldRun
                  ? "recomputed"
                  : "cached";
              expect(lastRun.report.statuses[node.id], node.id).toBe(expectedStatus);
            }
            wiped = new Set();
          }

          // From-scratch consistency: a cold engine on the FINAL state must
          // reproduce exactly what the incremental engine ended with — the
          // same outputs when error-free, the same error vector otherwise.
          const fresh = new GraphEngine<PipelineCtx>(buildChronicleGraph());
          const scratch = await fresh.run(makeCtx(state.options), runKeysOf(state));
          expect(scratch.report.errors).toEqual(lastRun.report.errors);
          expect(outputFingerprint(lastRun.outputs)).toEqual(outputFingerprint(scratch.outputs));

          if (Object.keys(lastRun.report.errors).length === 0) {
            // Idempotent re-run: same state again — zero executions anywhere.
            // (Errored states re-execute their error cone by design: the
            // engine never caches a failure.)
            const before = new Map(counters);
            const again = await engine.run(makeCtx(state.options), runKeysOf(state));
            for (const node of def.nodes) {
              expect((counters.get(node.id) ?? 0) - (before.get(node.id) ?? 0), node.id).toBe(0);
              expect(again.report.statuses[node.id]).not.toBe("recomputed");
            }
            expect(outputFingerprint(again.outputs)).toEqual(outputFingerprint(lastRun.outputs));
          }
        }),
        FC_PARAMS,
      );
    },
    600_000,
  );

  it("edit-order commutativity: two mutations on distinct targets yield the same final outputs in either order", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .tuple(mutationArb, mutationArb)
          .filter(([a, b]) => JSON.stringify(a) !== JSON.stringify(b)),
        async ([first, second]) => {
          async function runOrder(edits: Mutation[]): Promise<Record<string, string>> {
            const engine = new GraphEngine<PipelineCtx>(buildChronicleGraph());
            let state = INITIAL_STATE;
            await engine.run(makeCtx(state.options), runKeysOf(state));
            let fingerprint: Record<string, string> = {};
            for (const edit of edits) {
              state = applyMutation(state, edit);
              const run = await engine.run(makeCtx(state.options), runKeysOf(state));
              fingerprint = outputFingerprint(run.outputs);
            }
            return fingerprint;
          }
          // Distinct-target edits commute at the STATE level (each toggle only
          // touches its own key), so outputs must agree; same-target pairs are
          // filtered only when they would produce different final states.
          const stateAB = applyMutation(applyMutation(INITIAL_STATE, first), second);
          const stateBA = applyMutation(applyMutation(INITIAL_STATE, second), first);
          fc.pre(hashValue(runKeysOf(stateAB)) === hashValue(runKeysOf(stateBA)));
          expect(await runOrder([first, second])).toEqual(await runOrder([second, first]));
        },
      ),
      { numRuns: Math.max(6, Math.floor(NUM_RUNS / 2)) },
    );
  }, 600_000);

  it("edit + inverse round-trip: toggling any bound key twice restores the original outputs byte-for-byte", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...boundOptionKeys), async (key) => {
        const engine = new GraphEngine<PipelineCtx>(buildChronicleGraph());
        const original = await engine.run(makeCtx(ALL_ON), runKeysOf(INITIAL_STATE));

        const flipped = applyMutation(INITIAL_STATE, { kind: "toggleOption", key });
        await engine.run(makeCtx(flipped.options), runKeysOf(flipped));

        const restored = applyMutation(flipped, { kind: "toggleOption", key });
        const roundTrip = await engine.run(makeCtx(restored.options), runKeysOf(restored));
        expect(outputFingerprint(roundTrip.outputs)).toEqual(outputFingerprint(original.outputs));
      }),
      { numRuns: Math.min(boundOptionKeys.length, NUM_RUNS * 2) },
    );
  }, 600_000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("7. Early cutoff (backdating) — engine-level property on a synthetic graph", () => {
  type Ctx = Record<string, never>;

  function syntheticNode(
    id: string,
    inputs: string[],
    run: NodeDef<Ctx>["run"],
    extra: Partial<NodeDef<Ctx>> = {},
  ): NodeDef<Ctx> {
    return { id, label: id, section: "preprocess", inputs, knobs: [], run, ...extra };
  }

  it("a rerun with an unchanged declared outputHash never recomputes downstream; a changed one always does", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: 0, max: 7 }), { minLength: 1, maxLength: 20 }), async (knobValues) => {
        const counters = new Map<string, number>();
        const count = (id: string) => counters.set(id, (counters.get(id) ?? 0) + 1);
        let currentKnob = 0;
        // a collapses knob to parity → collisions exercise the cutoff;
        // b and c are the downstream cone that must only see parity changes.
        const graph: GraphDef<Ctx> = {
          nodes: [
            syntheticNode("a", [], () => {
              count("a");
              return currentKnob % 2;
            }, {
              knobs: [{ optionKey: "knob", edge: "tunes" }],
              outputHash: (value) => hashValue(value),
            }),
            syntheticNode("b", ["a"], (_ctx, inputs) => {
              count("b");
              return `b:${String(inputs.a)}`;
            }),
            syntheticNode("c", ["b"], (_ctx, inputs) => {
              count("c");
              return `c:${String(inputs.b)}`;
            }),
          ],
        };
        const engine = new GraphEngine<Ctx>(graph);
        const keys = (knob: number) => ({ options: { knob }, supportFileHashes: {}, inputHash: "i" });
        await engine.run({}, keys(currentKnob));

        let lastParity = currentKnob % 2;
        for (const value of knobValues) {
          const previousKnob = currentKnob;
          currentKnob = value;
          const before = new Map(counters);
          const run = await engine.run({}, keys(value));
          const keyChanged = value !== previousKnob;
          const parityChanged = value % 2 !== lastParity;

          const deltaA = (counters.get("a") ?? 0) - (before.get("a") ?? 0);
          const deltaB = (counters.get("b") ?? 0) - (before.get("b") ?? 0);
          const deltaC = (counters.get("c") ?? 0) - (before.get("c") ?? 0);

          // a reruns iff its cache key changed.
          expect(deltaA).toBe(keyChanged ? 1 : 0);
          // Early cutoff: b/c rerun iff a's VALUE (parity) actually changed.
          expect(deltaB, `knob ${previousKnob}→${value}`).toBe(parityChanged ? 1 : 0);
          expect(deltaC, `knob ${previousKnob}→${value}`).toBe(parityChanged ? 1 : 0);
          // From-scratch consistency of the visible value regardless of path.
          expect(run.outputs.get("c")).toBe(`c:b:${value % 2}`);
          lastParity = value % 2;
        }
      }),
      { numRuns: 100 },
    );
  }, 60_000);
});
