/**
 * Tests for the step wiring core: the runner's resolution semantics and the
 * flat step-DAG derivation, both on synthetic wirings (error paths) and on
 * the real pipeline (the graph of record).
 */

import { describe, expect, it } from "vitest";
import type { StepExecutionRecord } from "@/lib/pipelineGraph/executionRecords";
import { buildChronicleGraph } from "@/lib/pipelineGraph/graphDef";
import { buildStepGraph, stepInputIds } from "@/lib/pipelineGraph/stepGraph";
import { runUnit } from "@/lib/pipelineGraph/stepRunner";
import { port, stepsOf, wireUnit, wireUnitWhole } from "@/lib/pipelineGraph/stepTypes";
import type { PipelineCtx } from "@/lib/pipelineGraph/unitContracts";
import { ALL_UNIT_WIRINGS } from "@/lib/pipelineGraph/steps";
import {
  blankJunkTiming,
  dropSelectedTypes,
  dropZeroDuration,
  intervalCleaningWiring,
} from "@/lib/pipelineGraph/steps/intervalCleaning";
import { assembleResult, outputsWiring } from "@/lib/pipelineGraph/steps/outputs";

const ctx = { options: {}, support: {} } as unknown as PipelineCtx;

function syntheticWiring() {
  const step = stepsOf("alpha");
  const first = step({
    id: "first",
    label: "First",
    description: "Produces a number.",
    inputs: {},
    run: () => 2,
  });
  const second = step({
    id: "second",
    label: "Second",
    description: "Doubles it.",
    inputs: { n: first },
    run: ({ n }) => n * 2,
  });
  const wiring = wireUnit<{ value: number; doubled: number }>("alpha", [first, second], {
    value: port(first),
    doubled: port(second),
  });
  return { first, second, wiring };
}

describe("runUnit", () => {
  it("resolves same-unit step refs and assembles the object output via ports", async () => {
    const { wiring } = syntheticWiring();
    await expect(runUnit(wiring, ctx, {})).resolves.toEqual({ value: 2, doubled: 4 });
  });

  it("applies port projections at assembly time", async () => {
    const step = stepsOf("alpha");
    const make = step({
      id: "make",
      label: "Make",
      description: "Produces an object.",
      inputs: {},
      run: () => ({ kept: 1, dropped: 2 }),
    });
    const wiring = wireUnit<{ kept: number }>("alpha", [make], {
      kept: port(make, (value) => value.kept),
    });
    await expect(runUnit(wiring, ctx, {})).resolves.toEqual({ kept: 1 });
  });

  it("resolves upstream unit ports from engineInputs (field and whole)", async () => {
    const { wiring: upstream } = syntheticWiring();
    const step = stepsOf("beta");
    const consume = step({
      id: "consume",
      label: "Consume",
      description: "Reads the upstream field.",
      inputs: { v: upstream.ports.value },
      run: ({ v }) => v + 10,
    });
    const wiring = wireUnitWhole<number>("beta", [consume], port(consume));
    await expect(runUnit(wiring, ctx, { alpha: { value: 5, doubled: 10 } })).resolves.toBe(15);
  });

  it("throws when the engine did not provide a consumed upstream unit", async () => {
    const { wiring: upstream } = syntheticWiring();
    const step = stepsOf("beta");
    const consume = step({
      id: "consume_missing",
      label: "Consume",
      description: "Reads a missing upstream.",
      inputs: { v: upstream.ports.value },
      run: ({ v }) => v,
    });
    const wiring = wireUnitWhole<number>("beta", [consume], port(consume));
    await expect(runUnit(wiring, ctx, {})).rejects.toThrow(/did not\s+provide/);
  });

  it("throws on a direct cross-unit step reference", async () => {
    const { first } = syntheticWiring();
    const step = stepsOf("beta");
    const bad = step({
      id: "bad_cross_ref",
      label: "Bad",
      description: "References another unit's step directly.",
      inputs: { n: first },
      run: ({ n }) => n,
    });
    const wiring = wireUnitWhole<number>("beta", [bad], port(bad));
    await expect(runUnit(wiring, ctx, { alpha: {} })).rejects.toThrow(/UnitPort/);
    // Pin the first half of the two-part message too (only it says "references
    // step"), so blanking that literal cannot pass on the surviving "UnitPort".
    await expect(runUnit(wiring, ctx, { alpha: {} })).rejects.toThrow(/references step/);
  });

  it("throws when a step consumes its own unit's port", async () => {
    const step = stepsOf("alpha");
    const first = step({
      id: "own_first",
      label: "First",
      description: "Produces a number.",
      inputs: {},
      run: () => 1,
    });
    const partial = wireUnit<{ value: number }>("alpha", [first], { value: port(first) });
    const second = step({
      id: "own_port_consumer",
      label: "Second",
      description: "Consumes its own unit's port.",
      inputs: { v: partial.ports.value },
      run: ({ v }) => v,
    });
    const wiring = wireUnit<{ value: number; echoed: number }>(
      "alpha",
      [first, second],
      { value: port(first), echoed: port(second) },
    );
    await expect(runUnit(wiring, ctx, {})).rejects.toThrow(/own unit's port/);
  });

  it("throws when a same-unit step is declared before its input (non-topological order)", async () => {
    const step = stepsOf("alpha");
    const producer = step({
      id: "producer",
      label: "Producer",
      description: "Produces a value.",
      inputs: {},
      run: () => 1,
    });
    const consumer = step({
      id: "consumer",
      label: "Consumer",
      description: "Consumes the producer — but is declared before it.",
      inputs: { n: producer },
      run: ({ n }) => n,
    });
    // consumer BEFORE producer: declaration order is not topological, so the
    // runner reaches consumer with producer's value not yet computed.
    const wiring = wireUnitWhole<number>("alpha", [consumer, producer], port(consumer));
    await expect(runUnit(wiring, ctx, {})).rejects.toThrow(
      /runs before its input "producer" — declaration order is not topological/,
    );
  });
});

describe("runUnit lineage records (loss accounting + warn-only expectations)", () => {
  function recordingCtx(records: StepExecutionRecord[]): PipelineCtx {
    return {
      options: {},
      support: {},
      stepRecorder: (record: StepExecutionRecord) => records.push(record),
    } as unknown as PipelineCtx;
  }

  it("a violated conservation law is recorded as warn — the run still succeeds", async () => {
    const step = stepsOf("beta");
    const makeRows = step({
      id: "make_rows",
      label: "Make rows",
      description: "Produces four rows.",
      inputs: {},
      run: () => [1, 2, 3, 4],
    });
    const badFilter = step({
      id: "bad_filter",
      label: "Bad filter",
      description: "Drops two rows but claims one — a seeded conservation violation.",
      inputs: { rows: makeRows },
      run: ({ rows }) => ({ rows: rows.slice(0, 2), removed: 1 }),
      lossy: true,
      dropped: (out) => out.removed,
    });
    const wiring = wireUnitWhole<{ rows: number[]; removed: number }>(
      "beta",
      [makeRows, badFilter],
      port(badFilter),
    );
    const records: StepExecutionRecord[] = [];
    await expect(runUnit(wiring, recordingCtx(records), {})).resolves.toEqual({
      rows: [1, 2],
      removed: 1,
    });
    const bad = records.find((record) => record.stepId === "bad_filter");
    expect(bad).toMatchObject({ rowsIn: 4, rowsOut: 2, droppedRows: 1 });
    expect(bad!.expectations).toEqual([
      expect.objectContaining({ id: "conservation", kind: "conservation", ok: false, severity: "warn" }),
    ]);
  });

  it("counterless lossy steps get derived droppedRows + a passing no-row-creation check", async () => {
    const step = stepsOf("gamma");
    const makeRows = step({
      id: "make_rows",
      label: "Make rows",
      description: "Produces three rows.",
      inputs: {},
      run: () => ["a", "b", "c"],
    });
    const dropOne = step({
      id: "drop_one",
      label: "Drop one",
      description: "Drops the last row without an explicit counter.",
      inputs: { rows: makeRows },
      run: ({ rows }) => rows.slice(0, 2),
      lossy: true,
    });
    const wiring = wireUnitWhole<string[]>("gamma", [makeRows, dropOne], port(dropOne));
    const records: StepExecutionRecord[] = [];
    await runUnit(wiring, recordingCtx(records), {});
    const record = records.find((r) => r.stepId === "drop_one");
    expect(record).toMatchObject({ rowsIn: 3, rowsOut: 2, droppedRows: 1 });
    expect(record!.expectations).toEqual([
      expect.objectContaining({ id: "no_row_creation", kind: "row_count", ok: true }),
    ]);
  });

  it("declared rowCount overrides derivation for non-row-shaped outputs", async () => {
    const step = stepsOf("delta");
    const makeRows = step({
      id: "make_rows",
      label: "Make rows",
      description: "Produces rows.",
      inputs: {},
      run: () => [10, 20, 30],
    });
    const select = step({
      id: "select",
      label: "Select",
      description: "Selection object whose row count lives on nextRows.",
      inputs: { rows: makeRows },
      run: ({ rows }) => ({ nextRows: rows.slice(1), rowsBefore: rows.length }),
      lossy: true,
      rowCount: (out) => out.nextRows.length,
      dropped: (out) => out.rowsBefore - out.nextRows.length,
    });
    const wiring = wireUnitWhole<{ nextRows: number[]; rowsBefore: number }>(
      "delta",
      [makeRows, select],
      port(select),
    );
    const records: StepExecutionRecord[] = [];
    await runUnit(wiring, recordingCtx(records), {});
    const record = records.find((r) => r.stepId === "select");
    expect(record).toMatchObject({ rowsIn: 3, rowsOut: 2, droppedRows: 1 });
    expect(record!.expectations).toEqual([
      expect.objectContaining({ id: "conservation", ok: true }),
    ]);
  });

  it("runs without a stepRecorder behave identically (observation only)", async () => {
    const { wiring } = syntheticWiring();
    await expect(runUnit(wiring, ctx, {})).resolves.toEqual({ value: 2, doubled: 4 });
  });

  it("a throwing count extractor is swallowed — the record falls back to the derived count", async () => {
    const step = stepsOf("alpha");
    const make = step({
      id: "make_rows_bad_count",
      label: "Make rows",
      description: "Produces three rows but its rowCount extractor throws.",
      inputs: {},
      run: () => [1, 2, 3],
      // Observation must never fail the run: a throwing extractor yields null,
      // and the runner falls back to the derived row count.
      rowCount: () => {
        throw new Error("count blew up");
      },
    });
    const wiring = wireUnitWhole<number[]>("alpha", [make], port(make));
    const records: StepExecutionRecord[] = [];
    await expect(runUnit(wiring, recordingCtx(records), {})).resolves.toEqual([1, 2, 3]);
    const record = records.find((r) => r.stepId === "make_rows_bad_count");
    expect(record!.rowsOut).toBe(3);
  });

  it("records status 'ran' for a live step and 'bypassed' for an option-gated one", async () => {
    const step = stepsOf("status_unit");
    const gated = step({
      id: "gated_step",
      label: "Gated",
      description: "A pass-through when its option gate is on.",
      inputs: {},
      run: () => 1,
      bypassedWhen: (options) => options.off === true,
    });
    const plain = step({
      id: "plain_step",
      label: "Plain",
      description: "Always runs live.",
      inputs: {},
      run: () => 2,
    });
    const wiring = wireUnitWhole<number>("status_unit", [gated, plain], port(plain));
    const records: StepExecutionRecord[] = [];
    const gatedCtx = {
      options: { off: true },
      support: {},
      stepRecorder: (record: StepExecutionRecord) => records.push(record),
    } as unknown as PipelineCtx;
    await runUnit(wiring, gatedCtx, {});
    expect(records.find((r) => r.stepId === "gated_step")!.status).toBe("bypassed");
    expect(records.find((r) => r.stepId === "plain_step")!.status).toBe("ran");
  });

  it("records real timing: a numeric duration bounded by the wall-clock the call spent", async () => {
    const { wiring } = syntheticWiring();
    const records: StepExecutionRecord[] = [];
    const before = performance.now();
    await runUnit(wiring, recordingCtx(records), {});
    const elapsed = performance.now() - before;
    const record = records[0];
    expect(typeof record.timing.startedAt).toBe("string");
    expect(typeof record.timing.endedAt).toBe("string");
    // {} for the timing object would make durationMs undefined.
    expect(typeof record.timing.durationMs).toBe("number");
    // now() - startMark is a small non-negative span; now() + startMark would
    // be ~twice the process uptime, far larger than the call's own elapsed.
    expect(record.timing.durationMs).toBeGreaterThanOrEqual(0);
    expect(record.timing.durationMs).toBeLessThanOrEqual(elapsed + 5);
  });

  it("records null droppedRows for a NON-lossy step even when it changes row count", async () => {
    const step = stepsOf("drop_unit");
    const makeRows = step({
      id: "make_rows",
      label: "Make rows",
      description: "Produces three rows.",
      inputs: {},
      run: () => [1, 2, 3],
    });
    const shrink = step({
      id: "shrink_not_lossy",
      label: "Shrink",
      description: "Drops a row but is NOT declared lossy — loss must not be attributed.",
      inputs: { rows: makeRows },
      run: ({ rows }) => rows.slice(0, 2),
    });
    const wiring = wireUnitWhole<number[]>("drop_unit", [makeRows, shrink], port(shrink));
    const records: StepExecutionRecord[] = [];
    await runUnit(wiring, recordingCtx(records), {});
    expect(records.find((r) => r.stepId === "shrink_not_lossy")!.droppedRows).toBeNull();
  });

  it("records null droppedRows for a lossy step whose input is not row-shaped", async () => {
    const step = stepsOf("drop_unit_b");
    const emit = step({
      id: "emit_from_nothing",
      label: "Emit",
      description: "Lossy, but its inputs carry no row count — nothing to subtract from.",
      inputs: {},
      run: () => [1, 2],
      lossy: true,
    });
    const wiring = wireUnitWhole<number[]>("drop_unit_b", [emit], port(emit));
    const records: StepExecutionRecord[] = [];
    await runUnit(wiring, recordingCtx(records), {});
    expect(records[0].droppedRows).toBeNull();
  });

  it("records null droppedRows for a lossy step whose output is not row-shaped", async () => {
    const step = stepsOf("drop_unit_c");
    const makeRows = step({
      id: "make_rows",
      label: "Make rows",
      description: "Produces three rows.",
      inputs: {},
      run: () => [1, 2, 3],
    });
    const summarize = step({
      id: "summarize",
      label: "Summarize",
      description: "Lossy, but its output is a scalar-shaped object — no rows-out to subtract.",
      inputs: { rows: makeRows },
      run: () => ({ total: 3 }),
      lossy: true,
    });
    const wiring = wireUnitWhole<{ total: number }>(
      "drop_unit_c",
      [makeRows, summarize],
      port(summarize),
    );
    const records: StepExecutionRecord[] = [];
    await runUnit(wiring, recordingCtx(records), {});
    expect(records.find((r) => r.stepId === "summarize")!.droppedRows).toBeNull();
  });

  it("falls back to the derived drop count when the declared `dropped` extractor throws", async () => {
    const step = stepsOf("drop_unit_d");
    const makeRows = step({
      id: "make_rows",
      label: "Make rows",
      description: "Produces three rows.",
      inputs: {},
      run: () => [1, 2, 3],
    });
    const filter = step({
      id: "filter_bad_counter",
      label: "Filter",
      description: "Drops one row; its dropped-counter throws, so the derived count must win.",
      inputs: { rows: makeRows },
      run: ({ rows }) => rows.slice(0, 2),
      lossy: true,
      dropped: () => {
        throw new Error("counter blew up");
      },
    });
    const wiring = wireUnitWhole<number[]>("drop_unit_d", [makeRows, filter], port(filter));
    const records: StepExecutionRecord[] = [];
    await runUnit(wiring, recordingCtx(records), {});
    // A swallowed throw must yield null (→ derived 3-2=1), never undefined
    // (which would leak through the `!== null` guard as the recorded value).
    expect(records.find((r) => r.stepId === "filter_bad_counter")!.droppedRows).toBe(1);
  });

  it("does not attach a no-row-creation expectation to a non-lossy row-shaped step", async () => {
    const step = stepsOf("exp_unit_a");
    const makeRows = step({
      id: "make_rows",
      label: "Make rows",
      description: "Produces three rows.",
      inputs: {},
      run: () => [1, 2, 3],
    });
    const passthrough = step({
      id: "passthrough",
      label: "Passthrough",
      description: "Row-shaped in and out but NOT lossy — no loss expectation applies.",
      inputs: { rows: makeRows },
      run: ({ rows }) => rows.slice(0, 2),
    });
    const wiring = wireUnitWhole<number[]>("exp_unit_a", [makeRows, passthrough], port(passthrough));
    const records: StepExecutionRecord[] = [];
    await runUnit(wiring, recordingCtx(records), {});
    expect(records.find((r) => r.stepId === "passthrough")!.expectations).toEqual([]);
  });

  it("pushes no expectation when the loss check is not applicable (non-row lossy step)", async () => {
    const step = stepsOf("exp_unit_b");
    const emit = step({
      id: "emit_scalar",
      label: "Emit scalar",
      description: "Lossy with non-row I/O — the no-row-creation check returns not-applicable.",
      inputs: {},
      run: () => 5,
      lossy: true,
    });
    const wiring = wireUnitWhole<number>("exp_unit_b", [emit], port(emit));
    const records: StepExecutionRecord[] = [];
    await runUnit(wiring, recordingCtx(records), {});
    // A null (not-applicable) check must be skipped, never pushed as a record.
    expect(records[0].expectations).toEqual([]);
  });

  it("pushes no conservation expectation when the check is not applicable (dropped, non-row I/O)", async () => {
    const step = stepsOf("exp_unit_c");
    const emit = step({
      id: "emit_scalar_dropped",
      label: "Emit scalar with dropped",
      description: "Declares dropped but has non-row I/O — conservation is not applicable.",
      inputs: {},
      run: () => 5,
      dropped: () => 0,
    });
    const wiring = wireUnitWhole<number>("exp_unit_c", [emit], port(emit));
    const records: StepExecutionRecord[] = [];
    await runUnit(wiring, recordingCtx(records), {});
    expect(records[0].expectations).toEqual([]);
  });

  it("evaluates declared step expectations, keeping applicable results and dropping null ones", async () => {
    const step = stepsOf("exp_unit_d");
    const withExpectations = step({
      id: "declared_expectations",
      label: "Declared expectations",
      description: "Carries one applicable expectation and one that returns not-applicable.",
      inputs: {},
      run: () => [1, 2, 3],
      expectations: [
        {
          id: "nonempty",
          kind: "custom",
          expected: "at least one row",
          check: (rows: number[]) => ({ ok: rows.length > 0, actual: `${rows.length} rows` }),
        },
        {
          id: "never_applicable",
          kind: "custom",
          expected: "never fires",
          check: () => null,
        },
      ],
    });
    const wiring = wireUnitWhole<number[]>("exp_unit_d", [withExpectations], port(withExpectations));
    const records: StepExecutionRecord[] = [];
    await runUnit(wiring, recordingCtx(records), {});
    const record = records[0];
    // The applicable expectation is recorded; the null one is not — so exactly
    // one result, with the applicable id, survives.
    expect(record.expectations).toHaveLength(1);
    expect(record.expectations[0]).toMatchObject({ id: "nonempty", ok: true });
  });
});

describe("wireUnit invariants", () => {
  it("rejects a step wired into the wrong unit", () => {
    const foreign = stepsOf("gamma")({
      id: "foreign",
      label: "Foreign",
      description: "Belongs elsewhere.",
      inputs: {},
      run: () => 0,
    });
    expect(() => wireUnitWhole<number>("alpha", [foreign], port(foreign))).toThrow(
      /belongs to unit/,
    );
  });

  it("rejects a unit wiring with a duplicate step id", () => {
    const step = stepsOf("alpha");
    const first = step({
      id: "dup",
      label: "First",
      description: "First step with the shared id.",
      inputs: {},
      run: () => 0,
    });
    const second = step({
      id: "dup",
      label: "Second",
      description: "Second step reusing the same id.",
      inputs: {},
      run: () => 1,
    });
    expect(() => wireUnitWhole<number>("alpha", [first, second], port(first))).toThrow(
      /duplicate step id "dup" in unit "alpha"/,
    );
  });

  it("rejects a port whose source step is not wired into the unit", () => {
    const step = stepsOf("alpha");
    const inside = step({
      id: "inside",
      label: "Inside",
      description: "Wired.",
      inputs: {},
      run: () => 0,
    });
    const outside = step({
      id: "outside",
      label: "Outside",
      description: "Not wired.",
      inputs: {},
      run: () => 0,
    });
    expect(() =>
      wireUnit<{ value: number }>("alpha", [inside], { value: port(outside) }),
    ).toThrow(/not wired into unit/);
  });
});

describe("buildStepGraph on the real pipeline", () => {
  const unitDef = buildChronicleGraph();
  // Built INSIDE each test body (not at collection scope): a defect injected
  // into buildStepGraph must surface as a TEST failure — a throw during file
  // collection reports zero test results, which mutation tooling cannot
  // attribute as a kill.
  const build = () => buildStepGraph(unitDef, ALL_UNIT_WIRINGS);

  it("derives a flat DAG covering every unit, acyclic, globally unique ids", () => {
    // buildStepGraph itself validates: unit↔wiring bijection, snake_case ids,
    // port discipline, unit-edge witnessing both directions, acyclicity.
    const { def, stepToUnit } = build();
    expect(def.nodes.length).toBeGreaterThanOrEqual(50);
    const ids = def.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    const unitsCovered = new Set(stepToUnit.values());
    expect(unitsCovered).toEqual(new Set(unitDef.nodes.map((node) => node.id)));
  });

  it("every step edge points at an existing step", () => {
    const { def } = build();
    const ids = new Set(def.nodes.map((node) => node.id));
    for (const node of def.nodes) {
      for (const input of node.inputs) {
        expect(ids.has(input), `${node.id} <- ${input}`).toBe(true);
      }
    }
  });

  it("steps inherit their unit's section", () => {
    const { def, stepToUnit } = build();
    const sectionByUnit = new Map(unitDef.nodes.map((node) => [node.id, node.section]));
    for (const node of def.nodes) {
      expect(node.section).toBe(sectionByUnit.get(stepToUnit.get(node.id)!));
    }
  });

  it("stepInputIds resolves ports to their source step", () => {
    const { stepToUnit } = build();
    for (const wiring of ALL_UNIT_WIRINGS) {
      for (const step of wiring.steps) {
        for (const id of stepInputIds(step)) {
          expect(stepToUnit.has(id), `${step.id} input ${id}`).toBe(true);
        }
      }
    }
  });
});

describe("buildStepGraph rejects malformed wirings (every validation branch)", () => {
  // Hand-crafted raw wiring objects (bypassing wireUnit's own construction
  // checks) so each of buildStepGraph's validations is hit directly.
  type RawStep = {
    kind: "step";
    id: string;
    unit: string;
    label: string;
    description: string;
    inputs: Record<string, unknown>;
    run: () => unknown;
    bypassedWhen?: (options: Record<string, unknown>) => boolean;
  };
  type AnyWiring = import("@/lib/pipelineGraph/stepTypes").UnitWiring<unknown>;
  type AnyGraphDef = import("@/lib/pipelineGraph/graphTypes").GraphDef<unknown>;

  const mkStep = (unit: string, id: string, inputs: Record<string, unknown> = {}, extra: Partial<RawStep> = {}): RawStep => ({
    kind: "step",
    id,
    unit,
    label: id,
    description: id,
    inputs,
    run: () => null,
    ...extra,
  });
  const stepRef = (step: RawStep) => ({ kind: "step", id: step.id, unit: step.unit });
  const portRef = (unit: string, source: RawStep) => ({ kind: "port", unit, field: "value", source });
  const mkWiring = (unit: string, steps: RawStep[]): AnyWiring =>
    ({ unit, steps, output: { kind: "whole" } }) as unknown as AnyWiring;
  const mkDef = (
    nodes: Array<{ id: string; inputs?: string[]; bypassedWhen?: (options: Record<string, unknown>) => boolean }>,
  ): AnyGraphDef =>
    ({
      nodes: nodes.map((node) => ({
        id: node.id,
        label: node.id,
        description: node.id,
        section: "preprocess",
        inputs: node.inputs ?? [],
        knobs: [],
        run: () => null,
        ...(node.bypassedWhen ? { bypassedWhen: node.bypassedWhen } : {}),
      })),
    }) as unknown as AnyGraphDef;

  it("rejects a wiring for an unknown unit", () => {
    const def = mkDef([{ id: "alpha" }]);
    expect(() =>
      buildStepGraph(def, [mkWiring("alpha", [mkStep("alpha", "a_one")]), mkWiring("gamma", [mkStep("gamma", "g_one")])]),
    ).toThrow(/unknown unit "gamma"/);
  });

  it("rejects a unit whose wiring declares no steps", () => {
    const def = mkDef([{ id: "alpha" }]);
    expect(() => buildStepGraph(def, [mkWiring("alpha", [])])).toThrow(/declares no steps/);
  });

  it("rejects a declared unit with no wiring at all", () => {
    const def = mkDef([{ id: "alpha" }, { id: "beta" }]);
    expect(() => buildStepGraph(def, [mkWiring("alpha", [mkStep("alpha", "a_one")])])).toThrow(
      /unit "beta" has no step wiring/,
    );
  });

  it("rejects a non-snake_case step id (regex boundaries pinned)", () => {
    const def = mkDef([{ id: "alpha" }]);
    const build = (id: string) => () => buildStepGraph(def, [mkWiring("alpha", [mkStep("alpha", id)])]);
    for (const bad of ["BadId", "1bad", "bad__id", "bad_id!", "_bad", "bad_"]) {
      expect(build(bad), bad).toThrow(/not snake_case/);
    }
    // Single-letter and digit-bearing ids are legal snake_case.
    for (const good of ["a", "a1", "a_1", "long_step_name_2"]) {
      expect(build(good), good).not.toThrow();
    }
  });

  it("rejects a duplicate step id across units", () => {
    const def = mkDef([{ id: "alpha" }, { id: "beta", inputs: ["alpha"] }]);
    const aStep = mkStep("alpha", "same_id");
    const bStep = mkStep("beta", "same_id", { x: portRef("alpha", aStep) });
    expect(() => buildStepGraph(def, [mkWiring("alpha", [aStep]), mkWiring("beta", [bStep])])).toThrow(
      /duplicate step id "same_id"/,
    );
  });

  it("rejects a direct cross-unit step reference", () => {
    const def = mkDef([{ id: "alpha" }, { id: "beta", inputs: ["alpha"] }]);
    const aStep = mkStep("alpha", "a_one");
    const bStep = mkStep("beta", "b_one", { x: stepRef(aStep) });
    expect(() => buildStepGraph(def, [mkWiring("alpha", [aStep]), mkWiring("beta", [bStep])])).toThrow(
      /cross-unit dataflow must go through a UnitPort/,
    );
    // Pin the first line of the two-part message too (only it says "references
    // step"), so blanking that literal cannot pass on the surviving second half.
    expect(() => buildStepGraph(def, [mkWiring("alpha", [aStep]), mkWiring("beta", [bStep])])).toThrow(
      /references step/,
    );
  });

  it("rejects a step consuming its own unit's port", () => {
    const def = mkDef([{ id: "alpha" }]);
    const aOne = mkStep("alpha", "a_one");
    const aTwo = mkStep("alpha", "a_two", { x: portRef("alpha", aOne) });
    expect(() => buildStepGraph(def, [mkWiring("alpha", [aOne, aTwo])])).toThrow(
      /consumes its own unit's port/,
    );
    // Pin the second line of the message so blanking it cannot survive.
    expect(() => buildStepGraph(def, [mkWiring("alpha", [aOne, aTwo])])).toThrow(
      /reference the source step directly/,
    );
  });

  it("rejects consuming a unit the consumer never declared as an input", () => {
    const def = mkDef([{ id: "alpha" }, { id: "beta" }]);
    const aStep = mkStep("alpha", "a_one");
    const bStep = mkStep("beta", "b_one", { x: portRef("alpha", aStep) });
    expect(() => buildStepGraph(def, [mkWiring("alpha", [aStep]), mkWiring("beta", [bStep])])).toThrow(
      /does not declare it as an input/,
    );
    // Pin the first line of the message ("consumes unit") so blanking that
    // literal cannot pass on the surviving second half.
    expect(() => buildStepGraph(def, [mkWiring("alpha", [aStep]), mkWiring("beta", [bStep])])).toThrow(
      /consumes unit/,
    );
  });

  it("rejects a declared unit edge that no step witnesses", () => {
    const def = mkDef([{ id: "alpha" }, { id: "beta", inputs: ["alpha"] }]);
    expect(() =>
      buildStepGraph(def, [mkWiring("alpha", [mkStep("alpha", "a_one")]), mkWiring("beta", [mkStep("beta", "b_one")])]),
    ).toThrow(/declared but no step consumes it/);
  });

  it("rejects a cyclic step DAG", () => {
    const def = mkDef([{ id: "alpha" }]);
    const aOne = mkStep("alpha", "a_one");
    const aTwo = mkStep("alpha", "a_two");
    aOne.inputs.x = stepRef(aTwo);
    aTwo.inputs.y = stepRef(aOne);
    expect(() => buildStepGraph(def, [mkWiring("alpha", [aOne, aTwo])])).toThrow();
  });

  it("composes bypass: a step is off when its unit is off OR its own gate is off", () => {
    const def = mkDef([
      { id: "alpha", bypassedWhen: (options) => options.unitOff === true },
      { id: "beta", inputs: ["alpha"] },
    ]);
    const aStep = mkStep("alpha", "a_one");
    const bStep = mkStep("beta", "b_one", { x: portRef("alpha", aStep) }, {
      bypassedWhen: (options) => options.stepOff === true,
    });
    const graph = buildStepGraph(def, [mkWiring("alpha", [aStep]), mkWiring("beta", [bStep])]);
    const byId = new Map(graph.def.nodes.map((node) => [node.id, node]));

    const aBypass = byId.get("a_one")!.bypassedWhen!;
    expect(aBypass({ unitOff: true })).toBe(true);
    expect(aBypass({ unitOff: false })).toBe(false);

    // b_one's unit has NO bypass; its own gate alone must decide.
    const bBypass = byId.get("b_one")!.bypassedWhen!;
    expect(bBypass({ stepOff: true })).toBe(true);
    expect(bBypass({ stepOff: false, unitOff: true })).toBe(false);
  });

  it("leaves bypassedWhen undefined when neither unit nor step declares a gate", () => {
    const def = mkDef([{ id: "alpha" }]);
    const graph = buildStepGraph(def, [mkWiring("alpha", [mkStep("alpha", "a_one")])]);
    expect(graph.def.nodes[0].bypassedWhen).toBeUndefined();
  });

  it("projects step nodes with a placeholder run (layout-only DAG, never executed)", () => {
    // The step GraphDef is a layout/analysis projection — its node bodies are
    // placeholders that return null; the real execution goes through runUnit.
    const def = mkDef([{ id: "alpha" }]);
    const graph = buildStepGraph(def, [mkWiring("alpha", [mkStep("alpha", "a_one")])]);
    expect(graph.def.nodes[0].run({}, {})).toBeNull();
    // Projected step nodes carry an EMPTY knobs array (knobs live on units, not
    // on the flat step DAG) — a non-empty default would leak phantom knobs.
    expect(graph.def.nodes[0].knobs).toEqual([]);
  });
});

describe("interval_cleaning wiring", () => {
  it("stamps the unit id onto its wiring and every step", () => {
    expect(intervalCleaningWiring.unit).toBe("interval_cleaning");
    expect(blankJunkTiming.unit).toBe("interval_cleaning");
    expect(dropSelectedTypes.unit).toBe("interval_cleaning");
    expect(dropZeroDuration.unit).toBe("interval_cleaning");
  });

  it("wires exactly the three cleaning steps in order, ending on drop_zero_duration", () => {
    expect(intervalCleaningWiring.steps.map((step) => step.id)).toEqual([
      "blank_junk_timing",
      "drop_selected_types",
      "drop_zero_duration",
    ]);
    expect(intervalCleaningWiring.wholePort.source).toBe(dropZeroDuration);
  });

  it("gates blank_junk_timing on useFilterFile", () => {
    expect(blankJunkTiming.bypassedWhen!({ useFilterFile: true })).toBe(false);
    expect(blankJunkTiming.bypassedWhen!({ useFilterFile: false })).toBe(true);
  });

  it("gates drop_selected_types on a non-empty removal list (missing key → bypassed, never a throw)", () => {
    expect(dropSelectedTypes.bypassedWhen!({ interactionTypesToRemove: ["Screen Usage"] })).toBe(false);
    expect(dropSelectedTypes.bypassedWhen!({ interactionTypesToRemove: [] })).toBe(true);
    // Optional-chaining + ?? 0: an absent key must read as bypassed, not throw.
    expect(dropSelectedTypes.bypassedWhen!({})).toBe(true);
  });

  it("gates drop_zero_duration on filterZeroDurationSessions", () => {
    expect(dropZeroDuration.bypassedWhen!({ filterZeroDurationSessions: true })).toBe(false);
    expect(dropZeroDuration.bypassedWhen!({ filterZeroDurationSessions: false })).toBe(true);
  });
});

describe("outputs wiring", () => {
  it("stamps the unit id onto its wiring and step", () => {
    expect(outputsWiring.unit).toBe("outputs");
    expect(assembleResult.unit).toBe("outputs");
    expect(outputsWiring.steps.map((step) => step.id)).toEqual(["assemble_result"]);
    expect(outputsWiring.wholePort.source).toBe(assembleResult);
  });

  it("assembles the window report from the dropped-row count and no-window participants", () => {
    const result = assembleResult.run(
      {
        appRows: [{ tag: "app" }],
        coverage: [{ tag: "coverage" }],
        screenRows: [{ tag: "screen" }],
        credited: [{ tag: "credited" }],
        droppedRows: 7,
        participantsWithoutWindow: ["P999"],
        attribution: { tag: "attribution" },
        compliance: { tag: "compliance" },
      },
      ctx,
    ) as {
      appRows: unknown;
      screenRows: unknown;
      credited: unknown;
      coverage: unknown;
      attribution: unknown;
      compliance: unknown;
      windowReport: { droppedRows: number; participantsWithoutWindow: string[] };
    };
    // The window report must carry BOTH fields — an empty object would silently
    // drop the loss count and the un-windowed participant list.
    expect(result.windowReport).toEqual({ droppedRows: 7, participantsWithoutWindow: ["P999"] });
    // The other streams pass straight through under their own keys.
    expect(result.appRows).toEqual([{ tag: "app" }]);
    expect(result.screenRows).toEqual([{ tag: "screen" }]);
    expect(result.credited).toEqual([{ tag: "credited" }]);
    expect(result.coverage).toEqual([{ tag: "coverage" }]);
    expect(result.attribution).toEqual({ tag: "attribution" });
    expect(result.compliance).toEqual({ tag: "compliance" });
  });
});
