/**
 * Execution records — the SINGLE source of truth for runtime lineage.
 *
 * Every observability/lineage/expectation surface consumes these types:
 * the engine emits a UnitExecutionRecord per node, the step runner emits a
 * StepExecutionRecord per step, browserPipeline joins them into the
 * ExecutionLedger carried on ProcessedFileResult, and the run manifest,
 * the PROV-O sidecar (chron:NodeExecution activities) and the graph panel
 * are all projections of that one ledger. Nothing else counts rows, times
 * steps, or accounts for dropped data.
 *
 * Design rules:
 *  - Deterministic core (ids, statuses, row counts, expectation results)
 *    is kept SEPARATE from wall-clock timing so determinism tests can pin
 *    the core while tolerating timing.
 *  - Expectations are ALWAYS severity "warn": provenance describes what
 *    the pipeline did — it never decides what it does (research-ontology
 *    design doc 13). A violated expectation is report data, not a throw.
 */

import type { NodeStatus } from "@/lib/pipelineGraph/graphTypes";

export type ExpectationKind = "row_count" | "conservation" | "monotonic" | "custom";

export interface ExpectationResult {
  /** Stable id, unique within its record (e.g. "conservation"). */
  id: string;
  kind: ExpectationKind;
  ok: boolean;
  /** Human-readable expected condition (also present when ok). */
  expected: string;
  /** Human-readable observed value. */
  actual: string;
  /** Populated only when !ok. */
  message: string;
  /** Always "warn" — expectations never change pipeline behavior. */
  severity: "warn";
}

/** Deterministic per-step core — safe to pin byte-for-byte in tests. */
export interface StepExecutionCore {
  stepId: string;
  /** Execution unit (memoization boundary) the step ran inside. */
  unit: string;
  /**
   * "ran" = body executed live. "bypassed" = body executed but the step's
   * own option gate marks it a pass-through (display honesty; the runner
   * always runs bodies — units are the cache boundary, not steps).
   */
  status: "ran" | "bypassed";
  /** Row count of the primary row-shaped input, when derivable. */
  rowsIn: number | null;
  /** Row count of the output, when row-shaped. */
  rowsOut: number | null;
  /** Rows this step dropped (lossy steps only — from its `dropped` decl). */
  droppedRows: number | null;
  expectations: ExpectationResult[];
}

/** Wall-clock timing — kept separate from the deterministic core. */
export interface StepTiming {
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

export interface StepExecutionRecord extends StepExecutionCore {
  timing: StepTiming;
}

/** Per-unit (engine node) record; carries its steps when the unit ran live. */
export interface UnitExecutionRecord {
  unit: string;
  status: NodeStatus;
  rowsIn: number | null;
  rowsOut: number | null;
  expectations: ExpectationResult[];
  /** Step records for this unit (empty for cached/skipped units). */
  steps: StepExecutionRecord[];
  timing: StepTiming;
}

/** The append-only run ledger: one record per engine node, in run order. */
export type ExecutionLedger = UnitExecutionRecord[];

/**
 * Row count of a value when it is row-shaped: an array, or an object with
 * a `rows` array (the common `{rows, report}` unit-output shape). Null
 * otherwise — never guess.
 */
export function deriveRowCount(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (value !== null && typeof value === "object" && "rows" in value) {
    const rows = value.rows;
    if (Array.isArray(rows)) return rows.length;
  }
  return null;
}

/**
 * Combined rows-in across a step/node's resolved inputs: the SUM of the
 * row counts of row-shaped inputs (null when none are row-shaped). Summing
 * (not max) keeps the conservation law meaningful for join-shaped steps.
 */
export function deriveRowsIn(inputs: Record<string, unknown>): number | null {
  let total: number | null = null;
  for (const value of Object.values(inputs)) {
    const count = deriveRowCount(value);
    if (count !== null) total = (total ?? 0) + count;
  }
  return total;
}

/**
 * Primary rows-in for UNIT records: the MAX row count across row-shaped
 * inputs. A unit with several row-shaped upstreams (e.g. a cleaned frame
 * plus the policy-annotated variant of the same frame) is not a join —
 * summing would double-count the same underlying rows in the graph panel
 * and the profiler tables. Steps keep the summing `deriveRowsIn`, where
 * genuine join steps need it for conservation.
 */
export function deriveRowsInPrimary(inputs: Record<string, unknown>): number | null {
  let best: number | null = null;
  for (const value of Object.values(inputs)) {
    const count = deriveRowCount(value);
    if (count !== null && (best === null || count > best)) best = count;
  }
  return best;
}

/**
 * Join the engine's unit records with the step records the runner
 * collected: each step record nests under its unit's record. Unit records
 * for cached/bypassed-cached units keep empty step lists — steps only ran
 * when the unit body ran.
 */
export function assembleLedger(
  units: readonly UnitExecutionRecord[],
  steps: readonly StepExecutionRecord[],
): ExecutionLedger {
  const byUnit = new Map<string, StepExecutionRecord[]>();
  for (const step of steps) {
    const bucket = byUnit.get(step.unit);
    if (bucket) bucket.push(step);
    else byUnit.set(step.unit, [step]);
  }
  const ledger: ExecutionLedger = units.map((unit) => ({
    ...unit,
    steps: byUnit.get(unit.unit) ?? [],
  }));
  // Lineage is observation-only: a step record naming a unit the engine
  // never emitted (a wiring drift) must not abort the user's processing.
  // Surface it loudly IN the ledger instead — a synthetic record carrying
  // the orphan steps and a violated expectation.
  const known = new Set(units.map((unit) => unit.unit));
  for (const [unit, orphanSteps] of byUnit) {
    if (known.has(unit)) continue;
    ledger.push({
      unit,
      status: "error",
      rowsIn: null,
      rowsOut: null,
      expectations: [
        {
          id: "unit_record_present",
          kind: "custom",
          ok: false,
          expected: `engine emitted a unit record for "${unit}"`,
          actual: `${orphanSteps.length} step record(s) with no matching unit record`,
          message: `step records name unit "${unit}" but the engine emitted no unit record — step/unit wiring drift`,
          severity: "warn",
        },
      ],
      steps: orphanSteps,
      timing: orphanSteps[0]?.timing ?? { startedAt: "", endedAt: "", durationMs: 0 },
    });
  }
  return ledger;
}

/**
 * A declarative, warn-only runtime expectation over a STEP'S OWN OUTPUT.
 * Steps declare these next to their wiring (`StepSpec.expectations`); the
 * step runner evaluates them after each live run. Checks read only the
 * output — never inputs or ctx — so the AST dataflow verifier's input
 * discipline is untouched.
 */
export interface StepExpectation<Out> {
  /** Stable id, unique within the step. */
  id: string;
  kind: ExpectationKind;
  /** Human-readable expected condition. */
  expected: string;
  /**
   * Evaluate over the step's output. Return null when not applicable this
   * run. Must not throw — a throw is caught and recorded as a violated
   * expectation, never surfaced to the pipeline. Method syntax keeps
   * `StepExpectation<Out>` bivariant in Out (so typed expectations fit the
   * erased `Step<unknown>` collections).
   */
  check(output: Out): { ok: boolean; actual: string; message?: string } | null;
}

/**
 * Evaluate one StepExpectation into an ExpectationResult (null = not
 * applicable). A throwing check is converted into a violated result:
 * expectations are observation-only and must never break the run.
 */
export function evaluateStepExpectation<Out>(
  expectation: StepExpectation<Out>,
  output: Out,
): ExpectationResult | null {
  try {
    const outcome = expectation.check(output);
    if (outcome === null) return null;
    return {
      id: expectation.id,
      kind: expectation.kind,
      ok: outcome.ok,
      expected: expectation.expected,
      actual: outcome.actual,
      message: outcome.ok ? "" : (outcome.message ?? `${expectation.id} violated`),
      severity: "warn",
    };
  } catch (error) {
    return {
      id: expectation.id,
      kind: expectation.kind,
      ok: false,
      expected: expectation.expected,
      actual: "expectation check threw",
      message: `expectation "${expectation.id}" threw: ${error instanceof Error ? error.message : String(error)}`,
      severity: "warn",
    };
  }
}

/**
 * Monotonicity expectation factory for sort steps: `value` must be
 * non-decreasing across the output rows.
 */
export function monotonicNonDecreasing<Row>(options: {
  id: string;
  /** Human name of the sorted quantity (e.g. "event_timestamp_ns"). */
  describe: string;
  value: (row: Row) => bigint | number;
}): StepExpectation<Row[]> {
  return {
    id: options.id,
    kind: "monotonic",
    expected: `${options.describe} non-decreasing across output rows`,
    check: (rows) => {
      for (let index = 1; index < rows.length; index += 1) {
        if (options.value(rows[index]) < options.value(rows[index - 1])) {
          return {
            ok: false,
            actual: `${options.describe} decreases at row ${index}`,
            message: `sort order violated: ${options.describe} decreases at index ${index} of ${rows.length}`,
          };
        }
      }
      return { ok: true, actual: `${rows.length} rows non-decreasing` };
    },
  };
}

/**
 * Loss-sanity expectation for lossy steps WITHOUT an explicit dropped
 * counter: filtering must not create rows. Null when either side is not
 * row-shaped.
 */
export function evaluateNoRowCreation(
  rowsIn: number | null,
  rowsOut: number | null,
): ExpectationResult | null {
  if (rowsIn === null || rowsOut === null) return null;
  const ok = rowsOut <= rowsIn;
  return {
    id: "no_row_creation",
    kind: "row_count",
    ok,
    expected: `rows_out (${rowsOut}) <= rows_in (${rowsIn}) — a lossy step never creates rows`,
    actual: `rows_in ${rowsIn}, rows_out ${rowsOut}`,
    message: ok ? "" : `lossy step CREATED ${rowsOut - rowsIn} rows (out ${rowsOut} > in ${rowsIn})`,
    severity: "warn",
  };
}

/**
 * The conservation expectation: rowsIn === rowsOut + dropped. Evaluated by
 * the step runner for every step that declares `dropped`. Skipped (returns
 * null) when either side is not row-shaped.
 */
export function evaluateConservation(
  rowsIn: number | null,
  rowsOut: number | null,
  dropped: number | null,
): ExpectationResult | null {
  if (rowsIn === null || rowsOut === null || dropped === null) return null;
  const ok = rowsIn === rowsOut + dropped;
  return {
    id: "conservation",
    kind: "conservation",
    ok,
    expected: `rows_in (${rowsIn}) = rows_out (${rowsOut}) + dropped (${dropped})`,
    actual: `rows_in ${rowsIn}, rows_out ${rowsOut}, dropped ${dropped}`,
    message: ok
      ? ""
      : `conservation violated: ${rowsIn} != ${rowsOut} + ${dropped} (unaccounted ${rowsIn - rowsOut - dropped} rows)`,
    severity: "warn",
  };
}

/** All violated expectations across a ledger (report/UI convenience). */
export function ledgerViolations(
  ledger: ExecutionLedger,
): { unit: string; stepId: string | null; result: ExpectationResult }[] {
  const violations: { unit: string; stepId: string | null; result: ExpectationResult }[] = [];
  for (const unit of ledger) {
    for (const result of unit.expectations) {
      if (!result.ok) violations.push({ unit: unit.unit, stepId: null, result });
    }
    for (const step of unit.steps) {
      for (const result of step.expectations) {
        if (!result.ok) violations.push({ unit: unit.unit, stepId: step.stepId, result });
      }
    }
  }
  return violations;
}
