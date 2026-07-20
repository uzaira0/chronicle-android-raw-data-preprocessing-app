/**
 * Step wiring — the fine-grained pipeline DAG as EXECUTABLE DATA.
 *
 * Every real transformation in the pipeline is a `Step` whose `inputs` are
 * live references to the producing steps (same unit) or to `UnitPort`s
 * (named fields of an upstream unit's engine output). The step runner
 * executes units by walking this wiring, and the graph view, the contract
 * artifact and the ontology projection are all DERIVED from the same
 * objects — there is no second, prose declaration that could drift from
 * the code.
 *
 * Scale note: the 15 execution units are an ARBITRARY grouping — they are
 * the engine's memoization boundary, nothing more. A step's `unit` is an
 * annotation, not an ontological distinction; the DAG of record is the
 * flat step graph.
 *
 * Typing: `defineStep` infers each run body's input types from the
 * referenced producers, so the TypeScript compiler enforces input/output
 * compatibility along every edge.
 */

import type { BrowserProcessingOptions } from "@/lib/types";
import type { StepExpectation } from "@/lib/pipelineGraph/executionRecords";
import type { PipelineCtx } from "@/lib/pipelineGraph/unitContracts";

/**
 * Typed view over the untyped options bag `bypassedWhen` receives (the
 * engine and the graph panel both hand it a plain record).
 */
export function viewOptions(options: Record<string, unknown>): BrowserProcessingOptions {
  return options as unknown as BrowserProcessingOptions;
}

/** A reference a step input can hold: a producing step or a unit port. */
export type StepInputRef<T> = Step<T> | UnitPort<T>;

/** Output type carried by a reference. */
export type ResolvedRef<R> = R extends StepInputRef<infer T> ? T : never;

export interface Step<Out> {
  readonly kind: "step";
  /** Globally unique snake_case id. */
  readonly id: string;
  /** Execution/memoization unit (graph NodeDef id) this step runs inside. */
  readonly unit: string;
  readonly label: string;
  /** One-liner: what the transformation actually does. */
  readonly description: string;
  /**
   * Dataflow inputs, keyed by the name the run body receives. Same-unit
   * inputs are Step references; cross-unit inputs are UnitPort references.
   */
  readonly inputs: Readonly<Record<string, StepInputRef<unknown>>>;
  /** The transformation. Must only read its declared inputs and ctx. */
  readonly run: (
    inputs: Record<string, unknown>,
    ctx: PipelineCtx,
  ) => Out | Promise<Out>;
  /**
   * True when the current options make THIS step a pass-through (its own
   * gate, beyond the unit-level bypass it always inherits). Display-level
   * metadata only — the body still runs.
   */
  readonly bypassedWhen?: (options: Record<string, unknown>) => boolean;
  /**
   * Declares this step intentionally removes rows. Loss accounting: the
   * runner records droppedRows (from `dropped`, else rowsIn − rowsOut) and
   * evaluates a warn-only conservation / no-row-creation expectation.
   */
  readonly lossy?: true;
  /**
   * Rows dropped, read off the step's OWN output counter (lossy steps).
   * Method syntax (not a property arrow type) keeps `Step<Out>` bivariant
   * in Out so `Step<X>` stays assignable to `Step<unknown>` collections;
   * `this: void` because the runner passes the function around unbound.
   */
  dropped?(this: void, output: Out): number;
  /**
   * Row count of an output deriveRowCount can't see (neither an array nor
   * `{rows: []}`-shaped) — e.g. a selection object carrying `nextRows`.
   * Method syntax for the same variance reason as `dropped`.
   */
  rowCount?(this: void, output: Out): number;
  /** Warn-only runtime expectations over the step's own output. */
  readonly expectations?: readonly StepExpectation<Out>[];
  /** Phantom output type carrier (never assigned). */
  readonly __out?: Out;
}

/**
 * A named piece of a unit's engine output, with provenance: `source` is the
 * step whose value realizes it, `project` the (pure) projection applied at
 * assembly time. `field: null` means the port IS the unit's whole output.
 * Ports are both the unit's output contract and the only legal way for a
 * downstream unit's step to consume upstream data.
 */
export interface UnitPort<T> {
  readonly kind: "port";
  /** Owning (upstream) unit id. */
  readonly unit: string;
  /** Field name on the unit's engine output object; null = whole output. */
  readonly field: string | null;
  /** The step inside `unit` that produces this value. */
  readonly source: Step<unknown>;
  /** Projection from the source step's value to the port value. */
  readonly project: (value: unknown, ctx: PipelineCtx) => T;
  readonly __out?: T;
}

export interface StepSpec<I extends Record<string, StepInputRef<unknown>>, Out> {
  id: string;
  label: string;
  description: string;
  inputs: I;
  run: (
    inputs: { [K in keyof I]: ResolvedRef<I[K]> },
    ctx: PipelineCtx,
  ) => Out | Promise<Out>;
  bypassedWhen?: (options: Record<string, unknown>) => boolean;
  lossy?: true;
  dropped?: (output: Out) => number;
  rowCount?: (output: Out) => number;
  expectations?: readonly StepExpectation<Out>[];
}

/**
 * Per-unit step factory: `const step = stepsOf("parse_events")`. Binding the
 * unit once keeps every declaration in a unit module stamped consistently.
 *
 * Declaration order IS execution order guarantee: because same-unit inputs
 * are direct const references, JavaScript forces a producer to be declared
 * before its consumers, so a unit module's declaration order is always a
 * valid topological order (the runner asserts this at execution time).
 */
export function stepsOf(unit: string) {
  return function defineStep<I extends Record<string, StepInputRef<unknown>>, Out>(
    spec: StepSpec<I, Out>,
  ): Step<Out> {
    return {
      kind: "step",
      id: spec.id,
      unit,
      label: spec.label,
      description: spec.description,
      inputs: spec.inputs,
      run: spec.run as unknown as Step<Out>["run"],
      bypassedWhen: spec.bypassedWhen,
      lossy: spec.lossy,
      dropped: spec.dropped,
      rowCount: spec.rowCount,
      expectations: spec.expectations,
    };
  };
}

/** Unbound port spec, before `wireUnit` stamps unit/field onto it. */
export interface PortSpec<T> {
  readonly source: Step<unknown>;
  readonly project: (value: unknown, ctx: PipelineCtx) => T;
}

/** Port over a step's raw value. */
export function port<S>(source: Step<S>): PortSpec<S>;
/** Port projecting a step's value (e.g. a count off a result object). */
export function port<S, T>(source: Step<S>, project: (value: S, ctx: PipelineCtx) => T): PortSpec<T>;
export function port<S, T>(
  source: Step<S>,
  project?: (value: S, ctx: PipelineCtx) => T,
): PortSpec<T | S> {
  return {
    source,
    project: (project ?? ((value: S) => value)) as PortSpec<T | S>["project"],
  };
}

/**
 * Output contract of a unit: an object assembled from named ports… The
 * field→port map is erased here (per-field typing lives on `wireUnit`'s
 * returned `ports`) so `UnitWiring<X>` stays covariant in X — a mapped type
 * over a nullable Output would distribute over the union and break
 * `UnitWiring<unknown>` collections.
 */
export interface ObjectOutputContract<Output> {
  readonly kind: "object";
  readonly ports: Readonly<Record<string, UnitPort<unknown>>>;
  readonly __out?: Output;
}
/** …or a single port passed through as the whole output. */
export interface WholeOutputContract<Output> {
  readonly kind: "whole";
  readonly port: UnitPort<Output>;
}
export type OutputContract<Output> =
  | ObjectOutputContract<Output>
  | WholeOutputContract<Output>;

export interface UnitWiring<Output> {
  readonly unit: string;
  /** All steps of the unit, in declaration (= topological) order. */
  readonly steps: readonly Step<unknown>[];
  readonly output: OutputContract<Output>;
}

/**
 * Wire a unit: steps + an object output contract typed against the unit's
 * engine output interface (tsc rejects missing/mistyped fields).
 */
export function wireUnit<Output extends object>(
  unit: string,
  steps: readonly Step<unknown>[],
  outputPorts: { [K in keyof Output]-?: PortSpec<Output[K]> },
): UnitWiring<Output> & { ports: { [K in keyof Output]-?: UnitPort<Output[K]> } } {
  assertUnitSteps(unit, steps);
  const ports = Object.fromEntries(
    Object.entries<PortSpec<unknown>>(outputPorts as Record<string, PortSpec<unknown>>).map(
      ([field, spec]) => {
        assertPortSource(unit, steps, spec, field);
        return [
          field,
          { kind: "port", unit, field, source: spec.source, project: spec.project },
        ];
      },
    ),
  ) as { [K in keyof Output]-?: UnitPort<Output[K]> };
  return { unit, steps, output: { kind: "object", ports }, ports };
}

/** Wire a unit whose whole engine output is one port. */
export function wireUnitWhole<Output>(
  unit: string,
  steps: readonly Step<unknown>[],
  outputPort: PortSpec<Output>,
): UnitWiring<Output> & { wholePort: UnitPort<Output> } {
  assertUnitSteps(unit, steps);
  assertPortSource(unit, steps, outputPort, "(whole)");
  const wholePort: UnitPort<Output> = {
    kind: "port",
    unit,
    field: null,
    source: outputPort.source,
    project: outputPort.project,
  };
  return { unit, steps, output: { kind: "whole", port: wholePort }, wholePort };
}

function assertUnitSteps(unit: string, steps: readonly Step<unknown>[]): void {
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.unit !== unit) {
      throw new Error(
        `stepWiring: step "${step.id}" belongs to unit "${step.unit}", not "${unit}"`,
      );
    }
    if (seen.has(step.id)) {
      throw new Error(`stepWiring: duplicate step id "${step.id}" in unit "${unit}"`);
    }
    seen.add(step.id);
  }
}

function assertPortSource(
  unit: string,
  steps: readonly Step<unknown>[],
  spec: PortSpec<unknown>,
  field: string,
): void {
  if (!steps.includes(spec.source)) {
    throw new Error(
      `stepWiring: port "${unit}.${field}" sources step "${spec.source.id}" which is not wired into unit "${unit}"`,
    );
  }
}
