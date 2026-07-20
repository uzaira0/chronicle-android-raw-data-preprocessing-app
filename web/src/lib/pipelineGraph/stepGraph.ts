/**
 * Derives the FLAT step DAG (every real transformation, with its real
 * dataflow edges) from the executable unit wirings, and cross-checks it
 * against the unit-level graph declaration.
 *
 * The unit boundary is an arbitrary scale choice (the engine's memoization
 * boundary); the step graph is the DAG of record. Because both the runner
 * and this projection read the same wiring objects, the projected DAG
 * cannot drift from what actually executes.
 */

import type { GraphDef, NodeDef, Section } from "@/lib/pipelineGraph/graphTypes";
import { topoSort } from "@/lib/pipelineGraph/engine";
import type { Step, UnitWiring } from "@/lib/pipelineGraph/stepTypes";

export interface StepGraph {
  /**
   * GraphDef-shaped view of the step DAG — layoutGraph and the analysis
   * helpers (spliceOut/affectedBy/…) operate on it unchanged. Each node's
   * section and bypass predicate are inherited from its unit.
   */
  def: GraphDef<unknown>;
  /** step id → unit id (the arbitrary-scale grouping / memoization boundary). */
  stepToUnit: Map<string, string>;
}

const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/** Dataflow input step-ids of one step (ports resolve to their source step). */
export function stepInputIds(step: Step<unknown>): string[] {
  return Object.values(step.inputs).map((ref) =>
    ref.kind === "step" ? ref.id : ref.source.id,
  );
}

/**
 * Build the flat step GraphDef from the wirings, validating:
 *  - every unit in the graph declaration has a wiring and vice versa;
 *  - step ids are globally unique snake_case;
 *  - same-unit inputs are Step refs, cross-unit inputs are UnitPort refs;
 *  - every cross-unit step edge is covered by a declared unit feeds edge;
 *  - every declared unit feeds edge is witnessed by ≥1 step edge;
 *  - the step DAG is acyclic (topoSort throws otherwise).
 */
export function buildStepGraph<Ctx>(
  unitDef: GraphDef<Ctx>,
  wirings: readonly UnitWiring<unknown>[],
): StepGraph {
  const unitById = new Map<string, NodeDef<Ctx>>(unitDef.nodes.map((node) => [node.id, node]));
  const wiredUnits = new Set(wirings.map((wiring) => wiring.unit));
  for (const wiring of wirings) {
    if (!unitById.has(wiring.unit)) {
      throw new Error(`stepGraph: wiring for unknown unit "${wiring.unit}"`);
    }
    if (wiring.steps.length === 0) {
      throw new Error(`stepGraph: unit "${wiring.unit}" declares no steps`);
    }
  }
  for (const node of unitDef.nodes) {
    if (!wiredUnits.has(node.id)) {
      throw new Error(`stepGraph: unit "${node.id}" has no step wiring`);
    }
  }

  const stepToUnit = new Map<string, string>();
  const sectionByUnit = new Map<string, Section>(
    unitDef.nodes.map((node) => [node.id, node.section]),
  );
  for (const wiring of wirings) {
    for (const step of wiring.steps) {
      if (!SNAKE_CASE.test(step.id)) {
        throw new Error(`stepGraph: step id "${step.id}" is not snake_case`);
      }
      if (stepToUnit.has(step.id)) {
        throw new Error(`stepGraph: duplicate step id "${step.id}" across units`);
      }
      stepToUnit.set(step.id, step.unit);
    }
  }

  const witnessed = new Set<string>(); // "upstream->consumerUnit" unit edges seen in step wiring
  const nodes: NodeDef<unknown>[] = [];
  for (const wiring of wirings) {
    const unitNode = unitById.get(wiring.unit)!;
    for (const step of wiring.steps) {
      for (const [key, ref] of Object.entries(step.inputs)) {
        if (ref.kind === "step") {
          if (ref.unit !== step.unit) {
            throw new Error(
              `stepGraph: step "${step.id}" input "${key}" references step "${ref.id}" of ` +
                `unit "${ref.unit}" directly — cross-unit dataflow must go through a UnitPort`,
            );
          }
        } else {
          if (ref.unit === step.unit) {
            throw new Error(
              `stepGraph: step "${step.id}" input "${key}" consumes its own unit's port — ` +
                `reference the source step directly`,
            );
          }
          if (!unitNode.inputs.includes(ref.unit)) {
            throw new Error(
              `stepGraph: step "${step.id}" consumes unit "${ref.unit}" but unit ` +
                `"${step.unit}" does not declare it as an input`,
            );
          }
          witnessed.add(`${ref.unit}->${step.unit}`);
        }
      }
      const unitBypass = unitNode.bypassedWhen;
      const stepBypass = step.bypassedWhen;
      nodes.push({
        id: step.id,
        label: step.label,
        description: step.description,
        section: sectionByUnit.get(step.unit)!,
        inputs: stepInputIds(step),
        knobs: [],
        run: () => null,
        // A step is off when its unit is off OR its own gate is off.
        bypassedWhen:
          unitBypass || stepBypass
            ? (options) => (unitBypass?.(options) ?? false) || (stepBypass?.(options) ?? false)
            : undefined,
      });
    }
  }

  for (const node of unitDef.nodes) {
    for (const upstream of node.inputs) {
      if (!witnessed.has(`${upstream}->${node.id}`)) {
        throw new Error(
          `stepGraph: unit edge ${upstream} -> ${node.id} is declared but no step consumes it`,
        );
      }
    }
  }

  const def: GraphDef<unknown> = { nodes };
  topoSort(def); // throws with the cycle named if the step DAG is cyclic
  return { def, stepToUnit };
}
