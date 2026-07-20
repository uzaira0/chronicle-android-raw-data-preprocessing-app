/**
 * Executes a unit's wired steps. The wiring IS the execution path: each
 * step's declared input references are resolved (same-unit step values, or
 * upstream unit outputs through ports) and its run body is invoked with
 * exactly those values — so the DAG the graph view / contract / ontology
 * derive from the wiring is, by construction, the dataflow that actually ran.
 *
 * Steps run sequentially in declaration order, which is guaranteed
 * topological (same-unit inputs are direct const references, so JavaScript
 * forces producers to be declared first); the runner asserts it anyway.
 */

import {
  deriveRowCount,
  deriveRowsIn,
  evaluateConservation,
  evaluateNoRowCreation,
  evaluateStepExpectation,
  type ExpectationResult,
} from "@/lib/pipelineGraph/executionRecords";
import type { PipelineCtx } from "@/lib/pipelineGraph/unitContracts";
import type { Step, StepInputRef, UnitWiring } from "@/lib/pipelineGraph/stepTypes";

export async function runUnit<Output>(
  wiring: UnitWiring<Output>,
  ctx: PipelineCtx,
  engineInputs: Record<string, unknown>,
): Promise<Output> {
  const values = new Map<string, unknown>();
  for (const step of wiring.steps) {
    const resolved: Record<string, unknown> = {};
    for (const [key, ref] of Object.entries(step.inputs)) {
      resolved[key] = resolveRef(ref, step, values, engineInputs);
    }
    const startedAt = new Date().toISOString();
    const startMark = performance.now();
    const value = await step.run(resolved, ctx);
    values.set(step.id, value);
    // Lineage: one record per executed step, reported to the ctx sink.
    // Observation only — records never influence the run.
    const rowsIn = deriveRowsIn(resolved);
    const rowsOut = safeCount(step.rowCount, value) ?? deriveRowCount(value);
    const droppedRows = deriveDroppedRows(step, value, rowsIn, rowsOut);
    ctx.stepRecorder?.({
      stepId: step.id,
      unit: step.unit,
      status:
        step.bypassedWhen?.(ctx.options) === true
          ? "bypassed"
          : "ran",
      rowsIn,
      rowsOut,
      droppedRows,
      expectations: evaluateExpectations(step, value, rowsIn, rowsOut, droppedRows),
      timing: {
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: performance.now() - startMark,
      },
    });
  }
  return assembleOutput(wiring, values, ctx);
}

/**
 * Loss accounting for the step record: an explicit `dropped` counter wins;
 * a `lossy` step without one gets the derived difference. Non-lossy steps
 * record null. Observation only — a throwing extractor yields null, never
 * a failed run.
 */
function deriveDroppedRows(
  step: Step<unknown>,
  value: unknown,
  rowsIn: number | null,
  rowsOut: number | null,
): number | null {
  const declared = safeCount(step.dropped, value);
  if (declared !== null) return declared;
  if (step.lossy && rowsIn !== null && rowsOut !== null) return rowsIn - rowsOut;
  return null;
}

/**
 * Warn-only expectations for one executed step: the conservation law for
 * steps with an explicit dropped counter, no-row-creation for counterless
 * lossy steps, plus the step's own declared expectations.
 */
function evaluateExpectations(
  step: Step<unknown>,
  value: unknown,
  rowsIn: number | null,
  rowsOut: number | null,
  droppedRows: number | null,
): ExpectationResult[] {
  const results: ExpectationResult[] = [];
  if (step.dropped) {
    const conservation = evaluateConservation(rowsIn, rowsOut, droppedRows);
    if (conservation) results.push(conservation);
  } else if (step.lossy) {
    const noCreation = evaluateNoRowCreation(rowsIn, rowsOut);
    if (noCreation) results.push(noCreation);
  }
  for (const expectation of step.expectations ?? []) {
    const result = evaluateStepExpectation(expectation, value);
    if (result) results.push(result);
  }
  return results;
}

/** Run a declared count extractor defensively (observation must not throw). */
function safeCount(
  extract: ((output: unknown) => number) | undefined,
  value: unknown,
): number | null {
  if (!extract) return null;
  try {
    const count = extract(value);
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

function resolveRef(
  ref: StepInputRef<unknown>,
  consumer: Step<unknown>,
  values: ReadonlyMap<string, unknown>,
  engineInputs: Record<string, unknown>,
): unknown {
  if (ref.kind === "step") {
    if (ref.unit !== consumer.unit) {
      throw new Error(
        `stepRunner: step "${consumer.id}" (unit "${consumer.unit}") references step ` +
          `"${ref.id}" of unit "${ref.unit}" directly — cross-unit dataflow must go through a UnitPort`,
      );
    }
    if (!values.has(ref.id)) {
      throw new Error(
        `stepRunner: step "${consumer.id}" runs before its input "${ref.id}" — declaration order is not topological`,
      );
    }
    return values.get(ref.id);
  }
  if (ref.unit === consumer.unit) {
    throw new Error(
      `stepRunner: step "${consumer.id}" consumes its own unit's port — reference the source step directly`,
    );
  }
  if (!(ref.unit in engineInputs)) {
    throw new Error(
      `stepRunner: step "${consumer.id}" needs unit "${ref.unit}" output, but the engine did not ` +
        `provide it — the unit's NodeDef.inputs must declare "${ref.unit}"`,
    );
  }
  const upstream = engineInputs[ref.unit];
  if (ref.field === null) return upstream;
  return (upstream as Record<string, unknown>)[ref.field];
}

function assembleOutput<Output>(
  wiring: UnitWiring<Output>,
  values: ReadonlyMap<string, unknown>,
  ctx: PipelineCtx,
): Output {
  if (wiring.output.kind === "whole") {
    const { source, project } = wiring.output.port;
    return project(values.get(source.id), ctx);
  }
  const assembled: Record<string, unknown> = {};
  for (const [field, fieldPort] of Object.entries(wiring.output.ports)) {
    assembled[field] = fieldPort.project(values.get(fieldPort.source.id), ctx);
  }
  return assembled as Output;
}
